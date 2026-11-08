import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { syncHourlyFreshJobsFromOriginMain } from './sync-hourly-from-origin.js';
import { isSupportedDirectAtsJobUrl } from '../src/autoapply/priority-scheduler.js';
import { unwrapDirectAtsApplicationUrl } from '../src/autoapply/url-unwrapper.js';
import { evaluateCandidateJobFit } from '../src/autoapply/candidate-fit-filter.js';

export const TARGET_DB_PATHS = [
  'state/autoapply/portal-review/queue.sqlite',
  'data/queue.sqlite',
].filter((p) => fs.existsSync(p));

export interface HarvestedJob {
  company: string;
  title: string;
  location: string;
  url: string;
  ats: string;
}

export function inferAts(url: string): string {
  if (/greenhouse\.io/i.test(url)) return 'greenhouse';
  if (/ashbyhq\.com/i.test(url)) return 'ashby';
  if (/lever\.co/i.test(url)) return 'lever';
  if (/smartrecruiters\.com/i.test(url)) return 'smartrecruiters';
  if (/myworkdayjobs\.com|myworkdaysite\.com/i.test(url)) return 'workday';
  return 'other';
}

async function fetchJsonFast(url: string, timeoutMs = 4500): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0',
        Accept: 'application/json',
      },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const TIER_0_HIGH_YIELD_BOARDS: Array<{ ats: string; slug: string; name: string }> = [
  { ats: 'greenhouse', slug: 'razorpay', name: 'Razorpay' },
  { ats: 'greenhouse', slug: 'meesho', name: 'Meesho' },
  { ats: 'greenhouse', slug: 'postman', name: 'Postman' },
  { ats: 'greenhouse', slug: 'rubrik', name: 'Rubrik' },
  { ats: 'greenhouse', slug: 'databricks', name: 'Databricks' },
  { ats: 'greenhouse', slug: 'cloudflare', name: 'Cloudflare' },
  { ats: 'greenhouse', slug: 'confluent', name: 'Confluent' },
  { ats: 'greenhouse', slug: 'gitlab', name: 'GitLab' },
  { ats: 'greenhouse', slug: 'grafanalabs', name: 'Grafana Labs' },
  { ats: 'greenhouse', slug: 'elastic', name: 'Elastic' },
  { ats: 'greenhouse', slug: 'mongodb', name: 'MongoDB' },
  { ats: 'greenhouse', slug: 'cockroachlabs', name: 'Cockroach Labs' },
  { ats: 'greenhouse', slug: 'coinbase', name: 'Coinbase' },
  { ats: 'greenhouse', slug: 'twilio', name: 'Twilio' },
  { ats: 'greenhouse', slug: 'okta', name: 'Okta' },
  { ats: 'greenhouse', slug: 'zscaler', name: 'Zscaler' },
  { ats: 'greenhouse', slug: 'nutanix', name: 'Nutanix' },
  { ats: 'greenhouse', slug: 'cohesity', name: 'Cohesity' },
  { ats: 'greenhouse', slug: 'harness', name: 'Harness' },
  { ats: 'greenhouse', slug: 'druva', name: 'Druva' },
  { ats: 'greenhouse', slug: 'chargebee', name: 'Chargebee' },
  { ats: 'greenhouse', slug: 'clevertap', name: 'CleverTap' },
  { ats: 'greenhouse', slug: 'moengage', name: 'MoEngage' },
  { ats: 'greenhouse', slug: 'innovaccer', name: 'Innovaccer' },
  { ats: 'greenhouse', slug: 'clickhouse', name: 'ClickHouse' },
  { ats: 'greenhouse', slug: 'airbyte', name: 'Airbyte' },
  { ats: 'greenhouse', slug: 'temporaltechnologies', name: 'Temporal' },
  { ats: 'greenhouse', slug: 'truveta', name: 'Truveta' },
  { ats: 'greenhouse', slug: 'enterpret', name: 'Enterpret' },
  { ats: 'ashby', slug: 'sarvam-ai', name: 'Sarvam AI' },
  { ats: 'ashby', slug: 'supabase', name: 'Supabase' },
  { ats: 'ashby', slug: 'linear', name: 'Linear' },
  { ats: 'ashby', slug: 'LangChain', name: 'LangChain' },
  { ats: 'ashby', slug: 'qdrant', name: 'Qdrant' },
  { ats: 'ashby', slug: 'posthog', name: 'PostHog' },
  { ats: 'ashby', slug: 'railway', name: 'Railway' },
  { ats: 'ashby', slug: 'replit', name: 'Replit' },
  { ats: 'lever', slug: 'hevodata', name: 'Hevo Data' },
  { ats: 'lever', slug: 'zepto', name: 'Zepto' },
  { ats: 'lever', slug: 'cred', name: 'CRED' },
  { ats: 'lever', slug: 'zeta', name: 'Zeta' },
];

export async function harvestLiveFastAtsBoardsFromCompaniesJson(maxBoards = 320): Promise<HarvestedJob[]> {
  const harvested: HarvestedJob[] = [];
  if (!fs.existsSync('companies.json')) return harvested;

  let companies: any[] = [];
  try {
    const parsed = JSON.parse(fs.readFileSync('companies.json', 'utf8'));
    companies = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.companies) ? parsed.companies : [];
  } catch {
    return harvested;
  }

  // Prioritize Greenhouse, Ashby, Lever, and SmartRecruiters boards for high-velocity harvesting
  const fastBoards = companies.filter((c) => {
    const ats = String(c.ats || c.provider || c.type || '').toLowerCase();
    return ['greenhouse', 'ashby', 'lever', 'smartrecruiters'].includes(ats) && (c.slug || c.board || c.id || c.token);
  });

  // Rotate starting offset by current hour so every hour sweeps a fresh slice + top India boards
  const hourOffset = (new Date().getUTCHours() * 150) % Math.max(1, fastBoards.length);
  const rotatedSlice = [
    ...fastBoards.slice(hourOffset, hourOffset + maxBoards),
    ...fastBoards.slice(0, Math.max(0, maxBoards - (fastBoards.length - hourOffset))),
  ].slice(0, maxBoards);

  // Prepend Tier-0 High-Yield boards and deduplicate by slug
  const seenSlugs = new Set<string>();
  const selected: any[] = [];
  for (const b of [...TIER_0_HIGH_YIELD_BOARDS, ...rotatedSlice]) {
    const slug = String(b.slug || b.board || b.id || b.token || '').trim().toLowerCase();
    if (slug && !seenSlugs.has(slug)) {
      seenSlugs.add(slug);
      selected.push(b);
    }
  }

  const concurrency = 25;
  for (let i = 0; i < selected.length; i += concurrency) {
    const batch = selected.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (b): Promise<HarvestedJob[]> => {
        const ats = String(b.ats || b.provider || b.type || '').toLowerCase();
        const slug = String(b.slug || b.board || b.id || b.token || '').trim();
        const companyName = String(b.name || b.company || slug).trim();
        if (!slug) return [];

        const jobsOut: HarvestedJob[] = [];
        if (ats === 'greenhouse') {
          const data = await fetchJsonFast(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`);
          const list = Array.isArray(data?.jobs) ? data.jobs : [];
          for (const j of list) {
            const loc = String(j.location?.name || '');
            const rawAbs = String(j.absolute_url || '');
            const url =
              /greenhouse\.io/i.test(rawAbs) && rawAbs
                ? rawAbs
                : j.id
                ? `https://boards.greenhouse.io/${slug}/jobs/${j.id}`
                : rawAbs;
            if (url) jobsOut.push({ company: companyName, title: String(j.title || ''), location: loc, url, ats: 'greenhouse' });
          }
        } else if (ats === 'ashby') {
          const data = await fetchJsonFast(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`);
          const list = Array.isArray(data?.jobs) ? data.jobs : [];
          for (const j of list) {
            const loc = String(j.location || j.address?.postalAddress?.addressLocality || '');
            const rawUrl = String(j.jobUrl || j.applyUrl || '');
            const url =
              /ashbyhq\.com/i.test(rawUrl) && rawUrl
                ? rawUrl
                : j.id
                ? `https://jobs.ashbyhq.com/${slug}/${j.id}/application`
                : rawUrl;
            if (url) jobsOut.push({ company: companyName, title: String(j.title || ''), location: loc, url, ats: 'ashby' });
          }
        } else if (ats === 'lever') {
          const data = await fetchJsonFast(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`);
          const list = Array.isArray(data) ? data : [];
          for (const j of list) {
            const loc = String(j.categories?.location || j.workplaceType || '');
            const rawUrl = String(j.applyUrl || j.hostedUrl || '');
            const url =
              /jobs\.lever\.co/i.test(rawUrl) && rawUrl
                ? rawUrl
                : j.id
                ? `https://jobs.lever.co/${slug}/${j.id}/apply`
                : rawUrl;
            if (url) jobsOut.push({ company: companyName, title: String(j.text || ''), location: loc, url, ats: 'lever' });
          }
        } else if (ats === 'smartrecruiters') {
          const data = await fetchJsonFast(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=50`);
          const list = Array.isArray(data?.content) ? data.content : [];
          for (const j of list) {
            const loc = [j.location?.city, j.location?.country].filter(Boolean).join(', ');
            const url = `https://jobs.smartrecruiters.com/${slug}/${j.id}`;
            if (j.id) jobsOut.push({ company: companyName, title: String(j.name || ''), location: loc, url, ats: 'smartrecruiters' });
          }
        }
        return jobsOut;
      })
    );
    for (const res of batchResults) harvested.push(...res);
  }
  return harvested;
}

export async function runHourly100JobsHarvester(): Promise<{
  databasesUpdated: string[];
  rawHarvested: number;
  targetFitMatched: number;
  insertedOrBoosted: number;
}> {
  const liveJobs = await harvestLiveFastAtsBoardsFromCompaniesJson(240);
  const fitJobs: HarvestedJob[] = [];

  for (const j of liveJobs) {
    const unwrapped = unwrapDirectAtsApplicationUrl(j.url);
    if (!isSupportedDirectAtsJobUrl(unwrapped)) continue;
    const fit = evaluateCandidateJobFit({
      company: j.company,
      title: j.title,
      location: j.location,
      url: unwrapped,
    });
    if (!fit.allowed) continue;
    // Prefer India / Bengaluru / Remote roles
    if (!fit.isIndia && !/\b(?:remote|anywhere|global|india)\b/i.test(j.location)) continue;
    fitJobs.push({ ...j, url: unwrapped, ats: inferAts(unwrapped) });
  }

  let totalInsertedOrBoosted = 0;
  const currentDbPaths = [
    'state/autoapply/portal-review/queue.sqlite',
    'data/queue.sqlite',
  ].filter((p) => fs.existsSync(p));

  for (const dbPath of currentDbPaths) {
    // 1. Run origin/main sync against this exact DB path
    const syncRes = syncHourlyFreshJobsFromOriginMain(dbPath);
    totalInsertedOrBoosted += syncRes.insertedFresh + syncRes.boostedExisting;

    // 2. Upsert live harvested jobs into this DB path
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA busy_timeout = 15000; PRAGMA journal_mode = WAL;');

    try {
      const hasAppsTable = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='applications'").all() as any[]).length > 0;
      const hasJobsTable = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'").all() as any[]).length > 0;

      if (hasAppsTable) {
        const existingRows = db.prepare('SELECT id, normalized_url, status, payload FROM applications').all() as any[];
        const existingByUrl = new Map<string, { id: string; status: string; payload: any }>();
        for (const row of existingRows) {
          if (row.normalized_url) {
            let p: any = {};
            try { p = JSON.parse(row.payload); } catch {}
            existingByUrl.set(String(row.normalized_url).trim(), { id: row.id, status: row.status, payload: p });
          }
        }

        const candidateId = '2e533f7f49798b955338';
        const insertStmt = db.prepare(`
          INSERT OR IGNORE INTO applications (candidate_id, id, canonical_key, normalized_url, status, payload, owner, expires)
          VALUES (?, ?, ?, ?, 'queued', ?, NULL, NULL)
        `);
        const updateStmt = db.prepare('UPDATE applications SET payload = ? WHERE id = ?');

        db.exec('BEGIN TRANSACTION');
        for (const j of fitJobs) {
          const ex = existingByUrl.get(j.url);
          if (ex) {
            if (ex.status === 'queued' && !ex.payload.isHourlyFresh) {
              ex.payload.isHourlyFresh = true;
              ex.payload.priorityBonus = (ex.payload.priorityBonus || 0) + 10000;
              updateStmt.run(JSON.stringify(ex.payload), ex.id);
              totalInsertedOrBoosted++;
            }
            continue;
          }

          const jobId = 'autoaply_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
          const payload = {
            id: jobId,
            externalJobId: '',
            title: j.title || 'Software Engineer',
            company: j.company || 'Unknown',
            jobUrl: j.url,
            jobBoard: 'direct_ats',
            location: j.location || 'India',
            postedAt: new Date().toISOString(),
            status: 'queued',
            isHourlyFresh: true,
            priorityBonus: 10000,
            ats: j.ats,
          };

          try {
            insertStmt.run(candidateId, jobId, j.url, j.url, JSON.stringify(payload));
            existingByUrl.set(j.url, { id: jobId, status: 'queued', payload });
            totalInsertedOrBoosted++;
          } catch {}
        }
        db.exec('COMMIT');
      } else if (hasJobsTable) {
        const cols = new Set(
          (db.prepare('PRAGMA table_info(jobs)').all() as Array<{ name: string }>).map((c) => c.name)
        );
        const existingUrls = new Map<string, { id: number; status: string }>();
        for (const row of db.prepare('SELECT id, url, status FROM jobs').all() as any[]) {
          if (row.url) existingUrls.set(String(row.url).trim(), row);
        }

        db.exec('BEGIN TRANSACTION');
        for (const j of fitJobs) {
          const ex = existingUrls.get(j.url);
          if (ex) {
            if (ex.status === 'queued' && cols.has('is_hourly_fresh')) {
              const info = db
                .prepare('UPDATE jobs SET is_hourly_fresh = 1 WHERE id = ? AND COALESCE(is_hourly_fresh, 0) = 0')
                .run(ex.id) as any;
              totalInsertedOrBoosted += (info?.changes || 0);
            }
            continue;
          }
          try {
            const insertCols = ['company', 'title', 'url', 'status'];
            const insertVals: Array<string | number | null> = [j.company, j.title, j.url, 'queued'];
            if (cols.has('location')) {
              insertCols.push('location');
              insertVals.push(j.location || 'India');
            }
            if (cols.has('ats')) {
              insertCols.push('ats');
              insertVals.push(j.ats);
            }
            if (cols.has('is_hourly_fresh')) {
              insertCols.push('is_hourly_fresh');
              insertVals.push(1);
            }
            const ph = insertCols.map(() => '?').join(', ');
            db.prepare(`INSERT OR IGNORE INTO jobs (${insertCols.join(', ')}) VALUES (${ph})`).run(...insertVals);
            existingUrls.set(j.url, { id: -1, status: 'queued' });
            totalInsertedOrBoosted++;
          } catch {}
        }
        db.exec('COMMIT');
      }
    } catch (err: any) {
      if (!/database is locked/i.test(err?.message || '')) {
        console.warn('[HARVESTER NOTICE]', err?.message || err);
      }
    } finally {
      try { db.close(); } catch {}
    }
  }

  return {
    databasesUpdated: currentDbPaths,
    rawHarvested: liveJobs.length,
    targetFitMatched: fitJobs.length,
    insertedOrBoosted: totalInsertedOrBoosted,
  };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()
) {
  runHourly100JobsHarvester().then((r) => console.log('Hourly 100+ Jobs Harvester Result:', r));
}
