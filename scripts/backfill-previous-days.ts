import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { isAtsRootUrl } from '../src/autoapply/preflight.js';
import { canonicalRequisition } from '../src/autoapply/identity.js';
import { classifyJobBoard } from '../src/autoapply/autoaply.js';
import {
  fetchLinkedInBackfillJobs,
  matchLinkedInJobToCompany,
  getCompanyAtsUrl,
  appendCompanyRegistry,
  enrichLinkedInGuestJobDetail,
} from '../src/sources/linkedin-guest.js';
import {
  fetchYcHiringCompanies,
  fetchHnWhoIsHiringLeads,
  probeStartupAts,
} from '../src/sources/yc-hn-discovery.js';
import { loadProfile } from '../src/autoapply/profile.js';
import type { AutoaplyJobItem } from '../src/autoapply/types.js';

const EXCLUDED_TENANTS = /stripe|avoca|ssctech|paypal/i;
const INELIGIBLE_SENIOR = /\b(?:senior|sr\.?|staff|principal|lead|manager|director|head|vp|vice president|architect)\b/i;
const ELIGIBLE_TECH_ROLE = /\b(?:software|sde|swe|developer|data|machine learning|ml|backend|back[- ]end|full[- ]stack|frontend|front[- ]end|web|mobile|android|ios|systems|infrastructure|qa|quality assurance|sdet|test|platform|devops|cloud|security|ai|engineer(?:ing)?|graduate engineer(?:ing)?)\b/i;
const YOE_OVER_3 = /\b(?:[4-9]|\d{2,})\+?\s*years?\b/i;
const INDIA_OR_REMOTE_REGEX = /\b(?:india|bengaluru|bangalore|hyderabad|pune|mumbai|delhi|noida|gurgaon|gurugram|chennai|remote)\b/i;

function normalizeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^utm_|^(source|ref|referrer|gh_src)$/i.test(key)) parsed.searchParams.delete(key);
    }
    const host = parsed.hostname.toLowerCase();
    if (host === 'jobs.ashbyhq.com') parsed.pathname = parsed.pathname.replace(/\/application\/?$/, '');
    if (host === 'jobs.lever.co') parsed.pathname = parsed.pathname.replace(/\/apply\/?$/, '');
    if (host.endsWith('.myworkdayjobs.com') && parsed.pathname.includes('/job/')) {
      parsed.pathname = parsed.pathname.replace(/\/apply(?:\/.*)?$/, '');
    }
    if (host === 'apply.workable.com') {
      const id = /\/j\/([a-f0-9]+)(?:\/apply)?\/?$/i.exec(parsed.pathname)?.[1];
      if (id) parsed.pathname = `/j/${id.toUpperCase()}`;
    }
    if (host.endsWith('.greenhouse.io')) {
      const id = /\/jobs\/(\d+)\/?$/.exec(parsed.pathname)?.[1];
      if (id && parsed.searchParams.get('gh_jid') === id) parsed.searchParams.delete('gh_jid');
    }
    parsed.hash = '';
    parsed.searchParams.sort();
    return parsed.href;
  } catch {
    return rawUrl.trim();
  }
}

function printStatusTable(db: DatabaseSync, candidateId: string, label: string): void {
  const rows = db.prepare(`
    SELECT status, count(*) AS count
    FROM applications
    WHERE candidate_id = ?
    GROUP BY status
    ORDER BY status
  `).all(candidateId) as Array<{ status: string; count: number }>;

  console.log(`\n=== APPLICATION STATUS COUNTS [${label}] ===`);
  console.table(rows);
  const total = rows.reduce((acc, r) => acc + Number(r.count), 0);
  console.log(`Total records: ${total}\n`);
}

async function main(): Promise<void> {
  console.log('=== TICKET GEN-26: BACKFILL PREVIOUS DAYS & RECOVER LEFT-BEHIND JOBS ===');

  const profilePath = path.resolve('state/autoapply/portal-review/candidate.json');
  const profile = loadProfile(profilePath);
  const candidateId = createHash('sha256').update(profile.personal.email.trim().toLowerCase()).digest('hex').slice(0, 20);
  const dbPath = path.resolve('state/autoapply/portal-review/queue.sqlite');

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Queue database not found at ${dbPath}`);
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;');

  try {
    // Print Initial Table
    printStatusTable(db, candidateId, 'BEFORE BACKFILL');

    // =========================================================================
    // STEP A: Recover Left-Behind Paused & Failed Jobs
    // =========================================================================
    console.log('[STEP A] Recovering left-behind paused_for_review & failed jobs...');
    const pausedOrFailed = db.prepare(`
      SELECT id, normalized_url, status, payload
      FROM applications
      WHERE candidate_id = ? AND status IN ('paused_for_review', 'failed')
    `).all(candidateId) as Array<{ id: string; normalized_url: string; status: string; payload: string }>;

    let stepARecovered = 0;
    let stepASkippedRoots = 0;

    db.exec('BEGIN IMMEDIATE;');
    try {
      const updateQueued = db.prepare(`
        UPDATE applications
        SET status = 'queued',
            payload = json_set(
              payload,
              '$.status', 'queued',
              '$.retryCount', 0,
              '$.retry_count', 0,
              '$.error', null,
              '$.reasonCode', null
            )
        WHERE candidate_id = ? AND id = ?
      `);
      const updateSkipped = db.prepare(`
        UPDATE applications
        SET status = 'skipped',
            payload = json_set(payload, '$.status', 'skipped', '$.skipReason', 'board_root_not_requisition')
        WHERE candidate_id = ? AND id = ?
      `);

      for (const row of pausedOrFailed) {
        if (isAtsRootUrl(row.normalized_url)) {
          updateSkipped.run(candidateId, row.id);
          stepASkippedRoots++;
          continue;
        }

        let payload: any = {};
        try {
          payload = JSON.parse(row.payload);
        } catch {
          payload = {};
        }

        const comp = payload.company || '';
        const url = row.normalized_url;
        if (EXCLUDED_TENANTS.test(comp) || EXCLUDED_TENANTS.test(url)) {
          continue;
        }

        const rc = Number(payload.retryCount ?? payload.retry_count ?? 0);
        const isVisualCaptcha = /captcha|recaptcha|hcaptcha|arkoselabs|cloudflare/i.test(payload.error || payload.reason || '');
        if (rc >= 3 && isVisualCaptcha) {
          continue;
        }

        updateQueued.run(candidateId, row.id);
        stepARecovered++;
      }
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
    console.log(`[STEP A] Complete: Recovered ${stepARecovered} jobs to queued (${stepASkippedRoots} marked root ATS skip).`);

    // =========================================================================
    // STEP B: Recover Falsely Skipped Jobs from Pre-Fix Runs
    // =========================================================================
    console.log('[STEP B] Recovering falsely skipped jobs from pre-fix runs...');
    const skippedRows = db.prepare(`
      SELECT id, normalized_url, payload
      FROM applications
      WHERE candidate_id = ? AND status = 'skipped'
    `).all(candidateId) as Array<{ id: string; normalized_url: string; payload: string }>;

    let stepBRecovered = 0;

    db.exec('BEGIN IMMEDIATE;');
    try {
      const updateQueued = db.prepare(`
        UPDATE applications
        SET status = 'queued',
            payload = json_set(
              payload,
              '$.status', 'queued',
              '$.retryCount', 0,
              '$.retry_count', 0,
              '$.error', null,
              '$.reasonCode', null
            )
        WHERE candidate_id = ? AND id = ?
      `);

      for (const row of skippedRows) {
        let payload: any = {};
        try {
          payload = JSON.parse(row.payload);
        } catch {
          continue;
        }

        const title = payload.title || '';
        const comp = payload.company || '';
        const url = row.normalized_url;
        const desc = payload.description || '';
        const loc = payload.location || '';
        const err = payload.error || payload.reason || payload.skipReason || '';

        if (EXCLUDED_TENANTS.test(comp) || EXCLUDED_TENANTS.test(url)) continue;
        if (isAtsRootUrl(url)) continue;

        // Strictly keep non-engineering and Senior / Lead / Manager skipped
        if (!ELIGIBLE_TECH_ROLE.test(title)) continue;
        if (INELIGIBLE_SENIOR.test(title)) continue;

        // Strictly keep 4+ YOE skipped
        if (YOE_OVER_3.test(`${title} ${desc}`)) continue;
        if (typeof payload.minYears === 'number' && payload.minYears >= 4) continue;

        // Strictly keep non-India / verified closed / service-company skipped
        if (err === 'closed_in_catalogue' || err === 'closed_at_source' || err === 'ineligible_service_company') continue;
        if (err === 'ineligible_jd_location' || err === 'unconfirmed_india_remote' || err === 'ineligible_jd_citizenship_or_clearance') continue;
        if (err === 'ineligible_role' || err === 'ineligible_jd_experience') continue;

        const isIndiaOrRemote = INDIA_OR_REMOTE_REGEX.test(loc) || INDIA_OR_REMOTE_REGEX.test(url);
        if (!isIndiaOrRemote) continue;

        // Check if skip reason was a pre-fix technical issue
        const isTechSkip =
          /requisition_identity_mismatch|requisition mismatch|redirect|timeout|login|missing submit|no supported submit control|preflight/i.test(err) ||
          err === 'experience_recheck_pending' ||
          err === 'captcha_deferred' ||
          !err;

        if (isTechSkip) {
          updateQueued.run(candidateId, row.id);
          stepBRecovered++;
        }
      }
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
    console.log(`[STEP B] Complete: Recovered ${stepBRecovered} falsely skipped jobs back to queued.`);

    // =========================================================================
    // STEP C: Ingest Local Historical Scraper Files (state/, data/)
    // =========================================================================
    console.log('[STEP C] Ingesting local historical scraper snapshots from state/ and data/...');
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO applications (
        candidate_id, id, canonical_key, normalized_url, status, payload
      ) VALUES (?, ?, ?, ?, 'queued', ?)
    `);

    let stepCIngested = 0;
    const historicalFiles = [
      path.resolve('data/jobs.json'),
      path.resolve('state/board-state.json'),
      path.resolve('state/catalogue-snapshot.json'),
    ];

    for (const fpath of historicalFiles) {
      if (!fs.existsSync(fpath)) continue;
      try {
        console.log(`- Scanning ${fpath}...`);
        const content = fs.readFileSync(fpath, 'utf8');
        let items: any[] = [];
        try {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) items = parsed;
          else if (parsed.jobs && Array.isArray(parsed.jobs)) items = parsed.jobs;
        } catch {
          continue;
        }

        db.exec('BEGIN IMMEDIATE;');
        try {
          for (const item of items) {
            const rawUrl = item.url || item.jobUrl;
            const title = item.title;
            const comp = item.company;
            const loc = item.location || '';
            if (!rawUrl || !title || !comp) continue;
            if (EXCLUDED_TENANTS.test(comp) || EXCLUDED_TENANTS.test(rawUrl)) continue;

            // Check eligibility
            if (!ELIGIBLE_TECH_ROLE.test(title)) continue;
            if (INELIGIBLE_SENIOR.test(title)) continue;
            if (typeof item.minYears === 'number' && item.minYears >= 4) continue;
            if (YOE_OVER_3.test(title)) continue;
            if (!INDIA_OR_REMOTE_REGEX.test(loc) && !INDIA_OR_REMOTE_REGEX.test(rawUrl)) continue;

            const normUrl = normalizeUrl(rawUrl);
            if (isAtsRootUrl(normUrl)) continue;

            const canonicalKey = canonicalRequisition(rawUrl, item.id || item.externalJobId)?.key;
            const jobId = `autoaply_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const jobBoard = classifyJobBoard(rawUrl);

            const jobPayload: AutoaplyJobItem = {
              canonicalKey,
              id: jobId,
              externalJobId: item.id || item.externalJobId || `hist_${createHash('sha256').update(normUrl).digest('hex').slice(0, 16)}`,
              title,
              company: comp,
              jobUrl: rawUrl,
              jobBoard,
              location: loc,
              postedAt: item.postedAt || '',
              status: 'queued',
            };

            const res = insertStmt.run(
              candidateId,
              jobId,
              canonicalKey || null,
              normUrl,
              JSON.stringify(jobPayload)
            );
            if (Number(res.changes) > 0) {
              stepCIngested++;
            }
          }
          db.exec('COMMIT;');
        } catch (err) {
          db.exec('ROLLBACK;');
          throw err;
        }
      } catch (err: any) {
        console.warn(`[STEP C] Warning while scanning ${fpath}:`, err?.message || err);
      }
    }
    console.log(`[STEP C] Complete: Ingested ${stepCIngested} new eligible historical jobs into queue.sqlite.`);

    // =========================================================================
    // STEP D: Backfill Previous 24h & 7d from LinkedIn Guest API + YC/HN
    // =========================================================================
    console.log('[STEP D] Backfilling previous 24h & 7d from LinkedIn Guest API + YC/HN...');
    let stepDLinkedInIngested = 0;
    let stepDStartupIngested = 0;

    // 1. LinkedIn Guest API Backfill (r86400 = 24h, r604800 = 7d)
    try {
      console.log('- Fetching LinkedIn 24h & 7d postings for Software/Backend/Full Stack/Data Engineer in India...');
      const liJobs = await fetchLinkedInBackfillJobs({
        keywordsList: ['Software Engineer', 'Backend Engineer', 'Full Stack Engineer', 'Data Engineer'],
        location: 'India',
        timeRanges: ['r86400', 'r604800'],
        pages: [0, 25, 50, 75],
      });
      console.log(`- LinkedIn API returned ${liJobs.length} public postings. Matching against companies.json...`);

      db.exec('BEGIN IMMEDIATE;');
      try {
        for (const rawJob of liJobs) {
          if (EXCLUDED_TENANTS.test(rawJob.company)) continue;
          if (INELIGIBLE_SENIOR.test(rawJob.title)) continue;
          if (YOE_OVER_3.test(rawJob.title)) continue;

          const matched = matchLinkedInJobToCompany(rawJob.company);
          if (matched) {
            const directAtsUrl = getCompanyAtsUrl(matched);
            if (directAtsUrl && !EXCLUDED_TENANTS.test(directAtsUrl) && !isAtsRootUrl(directAtsUrl)) {
              const normUrl = normalizeUrl(directAtsUrl);
              const canonicalKey = canonicalRequisition(directAtsUrl, `li_${rawJob.jobId}`)?.key;
              const jobId = `autoaply_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
              const jobBoard = classifyJobBoard(directAtsUrl);

              const jobPayload: AutoaplyJobItem = {
                canonicalKey,
                id: jobId,
                externalJobId: `li_${rawJob.jobId}`,
                title: rawJob.title,
                company: rawJob.company,
                jobUrl: directAtsUrl,
                jobBoard,
                location: rawJob.location,
                postedAt: rawJob.listedAt,
                status: 'queued',
              };

              const res = insertStmt.run(
                candidateId,
                jobId,
                canonicalKey || null,
                normUrl,
                JSON.stringify(jobPayload)
              );
              if (Number(res.changes) > 0) {
                stepDLinkedInIngested++;
              }
            }
          }
        }
        db.exec('COMMIT;');
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }
    } catch (err: any) {
      console.warn('[STEP D] Warning during LinkedIn backfill:', err?.message || err);
    }

    // 2. YC / HN Backfill
    try {
      console.log('- Fetching YC Hiring & HN Who Is Hiring startup leads...');
      const [ycLeads, hnLeads] = await Promise.allSettled([
        fetchYcHiringCompanies(),
        fetchHnWhoIsHiringLeads(),
      ]);

      const startupLeads = [
        ...(ycLeads.status === 'fulfilled' ? ycLeads.value : []),
        ...(hnLeads.status === 'fulfilled' ? hnLeads.value : []),
      ];

      const toInsert: Array<{ title: string; company: string; url: string; location?: string; source: string }> = [];
      let probesDone = 0;

      for (const lead of startupLeads) {
        if (!lead.company || EXCLUDED_TENANTS.test(lead.company) || (lead.applyUrl && EXCLUDED_TENANTS.test(lead.applyUrl))) continue;
        if (INELIGIBLE_SENIOR.test(lead.roleTitle)) continue;

        let directAtsUrl = lead.applyUrl;
        const matched = matchLinkedInJobToCompany(lead.company);
        if (matched) {
          const atsUrl = getCompanyAtsUrl(matched);
          if (atsUrl) directAtsUrl = atsUrl;
        } else if (!directAtsUrl && probesDone < 20) {
          const slug = (lead.domain ? lead.domain.split('.')[0] : lead.company.toLowerCase().replace(/[^a-z0-9-]/g, '')) || '';
          if (slug && slug.length >= 2) {
            probesDone++;
            const probe = await probeStartupAts(slug).catch(() => null);
            if (probe) {
              appendCompanyRegistry({
                name: lead.company,
                ats: probe.ats,
                industry: 'tech',
                source: 'discovered',
                token: slug,
              });
              directAtsUrl = probe.sampleJobUrl || probe.boardUrl;
            }
          }
        }

        if (directAtsUrl && !EXCLUDED_TENANTS.test(directAtsUrl) && !isAtsRootUrl(directAtsUrl)) {
          toInsert.push({
            title: lead.roleTitle,
            company: lead.company,
            url: directAtsUrl,
            location: lead.location,
            source: lead.source,
          });
        }
      }

      db.exec('BEGIN IMMEDIATE;');
      try {
        for (const item of toInsert) {
          const normUrl = normalizeUrl(item.url);
          const canonicalKey = canonicalRequisition(item.url)?.key;
          const jobId = `autoaply_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const jobBoard = classifyJobBoard(item.url);

          const jobPayload: AutoaplyJobItem = {
            canonicalKey,
            id: jobId,
            externalJobId: `${item.source === 'yc_hiring_api' ? 'yc' : 'hn'}_${createHash('sha256').update(normUrl).digest('hex').slice(0, 16)}`,
            title: item.title,
            company: item.company,
            jobUrl: item.url,
            jobBoard,
            location: item.location,
            postedAt: '',
            status: 'queued',
          };

          const res = insertStmt.run(
            candidateId,
            jobId,
            canonicalKey || null,
            normUrl,
            JSON.stringify(jobPayload)
          );
          if (Number(res.changes) > 0) {
            stepDStartupIngested++;
          }
        }
        db.exec('COMMIT;');
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }
    } catch (err: any) {
      console.warn('[STEP D] Warning during YC/HN backfill:', err?.message || err);
    }

    console.log(`[STEP D] Complete: Backfilled ${stepDLinkedInIngested} LinkedIn + ${stepDStartupIngested} YC/HN jobs.`);

    // =========================================================================
    // STEP 26.2: Print Final Table
    // =========================================================================
    printStatusTable(db, candidateId, 'AFTER BACKFILL');
    console.log('=== TICKET GEN-26 EXECUTION COMPLETE ===');
  } finally {
    db.close();
  }
}

main().catch(err => {
  console.error('[FATAL] Failed to run backfill-previous-days:', err);
  process.exit(1);
});
