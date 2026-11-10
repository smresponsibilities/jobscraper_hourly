import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { evaluateCandidateJobFit } from '../src/autoapply/candidate-fit-filter.js';

const dbPath = path.resolve('state/autoapply/portal-review/queue.sqlite');
const db = new DatabaseSync(dbPath);

console.log('[SCRUB] Starting queue cleanup and India/Remote priority boost...');

const INDIA_REMOTE_REGEX = /\b(?:india|bengaluru|bangalore|hyderabad|pune|gurugram|gurgaon|noida|mumbai|chennai|delhi|karnataka|telangana|remote)\b/i;

let skippedCount = 0;
let boostedCount = 0;

db.exec('BEGIN TRANSACTION');
try {
  // 1. Process applications table
  const rows = db.prepare("SELECT id, payload FROM applications WHERE status = 'queued'").all() as Array<{ id: string; payload: string }>;
  console.log(`[SCRUB] Total queued applications to evaluate: ${rows.length}`);

  const updateSkipped = db.prepare(`
    UPDATE applications
    SET status = 'skipped',
        payload = json_set(payload, '$.reason', 'candidate_fit_filtered', '$.skippedAt', ?)
    WHERE id = ?
  `);

  const updateBoosted = db.prepare(`
    UPDATE applications
    SET payload = json_set(payload, '$.isHourlyFresh', 5, '$.is_hourly_fresh', 5, '$.priorityBonus', 5000)
    WHERE id = ?
  `);

  const nowIso = new Date().toISOString();

  for (const row of rows) {
    let p: any = {};
    try {
      p = JSON.parse(row.payload || '{}');
    } catch {
      continue;
    }

    const fit = evaluateCandidateJobFit({
      title: p.title,
      company: p.company,
      location: p.location,
      url: p.jobUrl || p.url,
      description: p.description,
    });

    if (!fit.allowed) {
      updateSkipped.run(nowIso, row.id);
      skippedCount++;
    } else {
      const locStr = `${p.location || ''} ${p.title || ''} ${JSON.stringify(p)}`;
      if (INDIA_REMOTE_REGEX.test(locStr)) {
        updateBoosted.run(row.id);
        boostedCount++;
      }
    }
  }

  // 2. Process jobs table if it exists
  const hasJobsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'").get();
  if (hasJobsTable) {
    const jobRows = db.prepare("SELECT id, title, company, location, url, payload FROM jobs WHERE status = 'queued'").all() as Array<any>;
    console.log(`[SCRUB] Total queued jobs to evaluate: ${jobRows.length}`);
    const updateJobSkipped = db.prepare("UPDATE jobs SET status = 'skipped' WHERE id = ?");
    const updateJobBoosted = db.prepare("UPDATE jobs SET is_hourly_fresh = 5 WHERE id = ?");

    for (const j of jobRows) {
      let p: any = {};
      try { p = JSON.parse(j.payload || '{}'); } catch {}
      const fit = evaluateCandidateJobFit({
        title: j.title || p.title,
        company: j.company || p.company,
        location: j.location || p.location,
        url: j.url || j.jobUrl || p.url,
      });
      if (!fit.allowed) {
        updateJobSkipped.run(j.id);
      } else {
        const locStr = `${j.location || ''} ${p.location || ''} ${j.title || ''} ${p.title || ''}`;
        if (INDIA_REMOTE_REGEX.test(locStr)) {
          updateJobBoosted.run(j.id);
        }
      }
    }
  }

  db.exec('COMMIT');
  console.log(`[SCRUB] Transaction complete! Skipped incompatible roles: ${skippedCount}, Boosted India/Remote roles: ${boostedCount}`);
} catch (err) {
  db.exec('ROLLBACK');
  console.error('[SCRUB] Transaction failed:', err);
  throw err;
} finally {
  db.close();
}
