import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalRequisition } from '../src/autoapply/identity.js';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const { syncQueueSummaryFromDb } = _require('./sync-summary.mjs') as { syncQueueSummaryFromDb: () => void };

interface CompanyEntry {
  name: string;
  ats: string;
  token?: string;
  slug?: string;
}

const STRICT_INDIA_LOC_REGEX = /\b(india|bengaluru|bangalore|hyderabad|pune|gurgaon|gurugram|noida|mumbai|delhi|chennai)\b/i;
const FOREIGN_LOC_REGEX = /\b(united states|usa|\bus\b|canada|ontario|toronto|uk|london|germany|berlin|france|paris|ireland|dublin|spain|madrid|australia|sydney|philippines|manila|mexico|taiwan|netherlands|dutch|brazil|poland|singapore|japan|tokyo|israel|tel aviv|emea|latam|americas|new york|california|san francisco|chicago|austin|seattle|boston)\b/i;

const POSITIVE_ENGINEERING_REGEX = /\b(software|developer|engineer|backend|frontend|fullstack|data|devops|sde|sdet|platform|cloud|infrastructure|ai|ml|machine learning|python|java|react|node|intern|trainee|apprentice|associate engineer)\b/i;
const INELIGIBLE_ROLE_REGEX = /\b(nurse|psychologist|doctor|paralegal|therapist|talent pool|sourcer|community|sales|account executive|representative|practitioner|claims|billing|pharmacist|counselor|broker|coordinator|recruiter|recruiting|marketing|customer success|operations specialist|assistant|specialist|officer|advisor|investigator|growth hacker|problem solver)\b/i;
const SENIOR_ROLE_REGEX = /\b(staff|principal|director|head of|\bvp\b|chief|architect|\bmanager\b)\b/i;

export function isStrictTechRole(title: string): boolean {
  if (!POSITIVE_ENGINEERING_REGEX.test(title)) return false;
  if (INELIGIBLE_ROLE_REGEX.test(title)) return false;
  if (SENIOR_ROLE_REGEX.test(title)) return false;
  return true;
}

export function isStrictIndiaLocation(location: string, title: string): boolean {
  const combined = `${location} ${title}`;
  if (FOREIGN_LOC_REGEX.test(location) && !STRICT_INDIA_LOC_REGEX.test(location)) return false;
  if (STRICT_INDIA_LOC_REGEX.test(combined)) return true;
  if (/\bremote\b/i.test(location) && !FOREIGN_LOC_REGEX.test(location)) return true;
  return false;
}

async function fetchWithTimeout(url: string, timeoutMs = 4500): Promise<any | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGreenhouseJobs(slug: string, companyName: string): Promise<Array<{ title: string; url: string; location: string }>> {
  const data = await fetchWithTimeout(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
  if (!data?.jobs || !Array.isArray(data.jobs)) return [];
  const results = [];
  for (const j of data.jobs) {
    const loc = j.location?.name || '';
    if (j.title && j.absolute_url) {
      results.push({
        title: String(j.title).trim(),
        url: String(j.absolute_url).trim(),
        location: loc.trim(),
      });
    }
  }
  return results;
}

async function fetchAshbyJobs(slug: string, companyName: string): Promise<Array<{ title: string; url: string; location: string }>> {
  const data = await fetchWithTimeout(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
  if (!data?.jobs || !Array.isArray(data.jobs)) return [];
  const results = [];
  for (const j of data.jobs) {
    const locParts = [j.location || ''];
    if (Array.isArray(j.secondaryLocations)) {
      locParts.push(...j.secondaryLocations.map((s: any) => s.location || ''));
    }
    const loc = locParts.filter(Boolean).join(', ');
    if (j.title && j.jobUrl) {
      results.push({
        title: String(j.title).trim(),
        url: String(j.jobUrl).trim(),
        location: loc.trim(),
      });
    }
  }
  return results;
}

async function fetchLeverJobs(slug: string, companyName: string): Promise<Array<{ title: string; url: string; location: string }>> {
  const data = await fetchWithTimeout(`https://api.lever.co/v0/postings/${slug}?mode=json`);
  if (!data || !Array.isArray(data)) return [];
  const results = [];
  for (const j of data) {
    const loc = j.categories?.location || '';
    const applyUrl = j.applyUrl || (j.hostedUrl ? `${j.hostedUrl}/apply` : '');
    if (j.text && applyUrl) {
      results.push({
        title: String(j.text).trim(),
        url: applyUrl.trim(),
        location: loc.trim(),
      });
    }
  }
  return results;
}

async function fetchWorkableJobs(slug: string, companyName: string): Promise<Array<{ title: string; url: string; location: string }>> {
  const data = await fetchWithTimeout(`https://apply.workable.com/api/v3/accounts/${slug}/jobs`);
  if (!data?.results || !Array.isArray(data.results)) return [];
  const results = [];
  for (const j of data.results) {
    const locParts = [j.location?.country || '', j.location?.city || ''];
    if (j.location?.telecommuting) locParts.push('Remote');
    const loc = locParts.filter(Boolean).join(', ');
    const url = j.shortcode ? `https://apply.workable.com/j/${j.shortcode}` : (j.url || '');
    if (j.title && url) {
      results.push({
        title: String(j.title).trim(),
        url: url.trim(),
        location: loc.trim(),
      });
    }
  }
  return results;
}

export async function harvestFastAtsJobs(
  dbPath = 'state/autoapply/portal-review/queue.sqlite',
  targetFreshCount = 160
): Promise<number> {
  console.log(`[HARVEST] Starting Strict Fast-ATS Harvest target >= ${targetFreshCount} fresh jobs...`);
  const raw = fs.readFileSync('companies.json', 'utf8');
  const allCompanies: CompanyEntry[] = JSON.parse(raw);

  const eligibleCompanies = allCompanies.filter((c) =>
    ['greenhouse', 'ashby', 'lever', 'workable'].includes(c.ats.toLowerCase()) &&
    (c.token || (c as any).slug)
  );

  // Shuffle companies
  for (let i = eligibleCompanies.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = eligibleCompanies[i]!;
    eligibleCompanies[i] = eligibleCompanies[j]!;
    eligibleCompanies[j] = temp;
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 15000;');

  let candidateId = '2e533f7f49798b955338';
  try {
    const candRow: any = db.prepare("SELECT value FROM metadata WHERE key='candidate'").get();
    if (candRow?.value) candidateId = candRow.value;
  } catch {}

  // First, purge any non-qualifying newly queued rows (e.g., nurse, psychologist) from applications table
  const purgeStmt = db.prepare(`
    DELETE FROM applications
    WHERE status = 'queued' AND (
      json_extract(payload, '$.title') LIKE '%nurse%' OR
      json_extract(payload, '$.title') LIKE '%psychologist%' OR
      json_extract(payload, '$.title') LIKE '%paralegal%' OR
      json_extract(payload, '$.title') LIKE '%therapist%' OR
      json_extract(payload, '$.title') LIKE '%claims%' OR
      json_extract(payload, '$.title') LIKE '%billing%' OR
      json_extract(payload, '$.title') LIKE '%talent pool%'
    )
  `);
  const purgeResult = purgeStmt.run();
  console.log(`[HARVEST] Scrubbed ${purgeResult.changes} non-qualifying rows.`);

  const checkStmt = db.prepare('SELECT id, status FROM applications WHERE canonical_key = ? OR normalized_url = ? LIMIT 1');
  const insertStmt = db.prepare(`
    INSERT INTO applications (candidate_id, id, canonical_key, normalized_url, status, payload)
    VALUES (?, ?, ?, ?, 'queued', ?)
  `);

  let insertedCount = 0;
  let companiesPolled = 0;
  const BATCH_SIZE = 16;

  for (let i = 0; i < eligibleCompanies.length && insertedCount < targetFreshCount; i += BATCH_SIZE) {
    const batch = eligibleCompanies.slice(i, i + BATCH_SIZE);
    companiesPolled += batch.length;

    const batchResults = await Promise.all(
      batch.map(async (company) => {
        const slug = (company.token || (company as any).slug || '').trim();
        const ats = company.ats.toLowerCase();
        try {
          if (ats === 'greenhouse') return { company, jobs: await fetchGreenhouseJobs(slug, company.name) };
          if (ats === 'ashby') return { company, jobs: await fetchAshbyJobs(slug, company.name) };
          if (ats === 'lever') return { company, jobs: await fetchLeverJobs(slug, company.name) };
          if (ats === 'workable') return { company, jobs: await fetchWorkableJobs(slug, company.name) };
        } catch {
          return { company, jobs: [] };
        }
        return { company, jobs: [] };
      })
    );

    for (const res of batchResults) {
      if (!res.jobs || res.jobs.length === 0) continue;

      for (const job of res.jobs) {
        if (insertedCount >= targetFreshCount) break;

        // 1. Strict Role Filter
        if (!isStrictTechRole(job.title)) continue;

        // 2. Strict Location Filter
        if (!isStrictIndiaLocation(job.location, job.title)) continue;

        // 3. Normalization & Canonical Key
        const canon = canonicalRequisition(job.url);
        const canonKey = canon?.key || `${res.company.ats}:${res.company.name}:${job.title}`;
        const normUrl = job.url;

        // 4. Duplicate Check in SQLite
        const existing: any = checkStmt.get(canonKey, normUrl);
        if (existing) continue;

        // 5. Generate fresh Job ID & Payload
        const randId = `autoaply_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const nowIso = new Date().toISOString();
        const payloadObj = {
          canonicalKey: canonKey,
          id: randId,
          externalJobId: canon?.jobId || randId,
          title: job.title,
          company: res.company.name,
          jobUrl: job.url,
          jobBoard: 'direct_ats',
          location: job.location || 'India (Remote / Hybrid)',
          postedAt: nowIso,
          discoveredAt: nowIso,
          status: 'queued',
          error: null,
          retryCount: 0,
          retry_count: 0,
          reasonCode: null,
          is_hourly_fresh: true,
          isHourlyFresh: true,
          priorityBonus: 15000,
          priorityScore: 15000,
          provider: res.company.ats,
        };

        try {
          insertStmt.run(candidateId, randId, canonKey, normUrl, JSON.stringify(payloadObj));
          insertedCount++;
          console.log(`[HARVEST +${insertedCount}] Ingested: ${res.company.name} (${res.company.ats}) - "${job.title}" [${job.location}]`);
        } catch {}
      }
    }
  }

  db.close();
  syncQueueSummaryFromDb();

  console.log(`[HARVEST COMPLETED] Polled ${companiesPolled} companies, successfully inserted ${insertedCount} fresh open fast-ATS jobs!`);
  return insertedCount;
}

if (process.argv[1]?.endsWith('harvest-fast-ats-jobs.ts') || process.argv[1]?.endsWith('harvest-fast-ats-jobs.js')) {
  harvestFastAtsJobs()
    .then((n) => {
      console.log(`Exiting harvest script with count: ${n}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[HARVEST ERROR]', err);
      process.exit(1);
    });
}
