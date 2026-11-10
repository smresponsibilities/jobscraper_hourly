import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  NON_TECH_TITLE_REGEX,
  WHITELIST_SOFTWARE_TITLE_REGEX,
} from '../src/autoapply/candidate-fit-filter.js';

export function scrubNonTechJobs(
  dbPath = path.resolve(process.cwd(), 'state/autoapply/portal-review/queue.sqlite')
): { scrubbedApplications: number; scrubbedJobs: number } {
  console.log(`[SCRUB] Opening SQLite database at: ${dbPath}`);

  if (!fs.existsSync(dbPath)) {
    console.log(`[SCRUB] Database not found at: ${dbPath}`);
    return { scrubbedApplications: 0, scrubbedJobs: 0 };
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout = 15000;');
  db.exec('PRAGMA journal_mode = WAL;');

  let scrubbedApplications = 0;
  let scrubbedJobs = 0;

  const now = new Date().toISOString();

  // 1. Scrub applications table
  const hasAppsTable = Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='applications'").get()
  );

  if (hasAppsTable) {
    const appCols = (db.prepare('PRAGMA table_info(applications)').all() as Array<{ name: string }>).map(
      (c) => c.name
    );
    const hasTitleCol = appCols.includes('title');
    const hasUpdatedAtCol = appCols.includes('updated_at');
    const hasLastErrorCol = appCols.includes('last_error');

    if (!hasLastErrorCol) {
      try {
        db.exec('ALTER TABLE applications ADD COLUMN last_error TEXT;');
      } catch {}
    }

    const selectQuery = hasTitleCol
      ? "SELECT id, title, payload FROM applications WHERE status IN ('queued', 'running', 'paused_for_review')"
      : "SELECT id, payload FROM applications WHERE status IN ('queued', 'running', 'paused_for_review')";

    const rows = db.prepare(selectQuery).all() as Array<{ id: string; title?: string; payload?: string }>;

    let updateSql = "UPDATE applications SET status = 'skipped'";
    if (hasLastErrorCol || !appCols.includes('last_error')) updateSql += ", last_error = 'REJECTED_NON_TECH_TITLE'";
    if (hasUpdatedAtCol) updateSql += ', updated_at = ?';
    updateSql += ' WHERE id = ?';

    const updateApp = db.prepare(updateSql);

    db.exec('BEGIN IMMEDIATE;');
    try {
      for (const row of rows) {
        let title = String(row.title || '').trim();
        if (!title && row.payload) {
          try {
            const p = JSON.parse(row.payload);
            title = String(p.title || '').trim();
          } catch {}
        }
        if (!title) continue;

        if (NON_TECH_TITLE_REGEX.test(title)) {
          if (hasUpdatedAtCol) {
            updateApp.run(now, row.id);
          } else {
            updateApp.run(row.id);
          }
          scrubbedApplications++;
        }
      }
      db.exec('COMMIT;');
      console.log(`[SCRUB] Applications table: scrubbed ${scrubbedApplications} non-tech jobs.`);
    } catch (err) {
      db.exec('ROLLBACK;');
      console.error('[SCRUB] Applications update failed, rolled back:', err);
      process.exit(1);
    }
  } else {
    console.log('[SCRUB] Applications table: scrubbed 0 non-tech jobs.');
  }

  // 2. Scrub jobs table
  const hasJobsTable = Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'").get()
  );

  if (hasJobsTable) {
    const jobCols = (db.prepare('PRAGMA table_info(jobs)').all() as Array<{ name: string }>).map(
      (c) => c.name
    );
    const hasTitleCol = jobCols.includes('title');
    const hasPayloadCol = jobCols.includes('payload');
    const hasUpdatedAtCol = jobCols.includes('updated_at');
    const hasLastErrorCol = jobCols.includes('last_error');

    const selectQuery = hasTitleCol
      ? "SELECT id, title FROM jobs WHERE status IN ('queued', 'running', 'paused_for_review')"
      : "SELECT * FROM jobs WHERE status IN ('queued', 'running', 'paused_for_review')";

    const jobRows = db.prepare(selectQuery).all() as Array<any>;

    let updateJobSql = "UPDATE jobs SET status = 'skipped'";
    if (hasLastErrorCol) updateJobSql += ", last_error = 'REJECTED_NON_TECH_TITLE'";
    if (hasUpdatedAtCol) updateJobSql += ', updated_at = ?';
    updateJobSql += ' WHERE id = ?';

    const updateJob = db.prepare(updateJobSql);

    db.exec('BEGIN IMMEDIATE;');
    try {
      for (const row of jobRows) {
        let title = String(row.title || '').trim();
        if (!title && hasPayloadCol && row.payload) {
          try {
            const p = JSON.parse(row.payload);
            title = String(p.title || '').trim();
          } catch {}
        }
        if (!title) continue;

        if (NON_TECH_TITLE_REGEX.test(title)) {
          if (hasUpdatedAtCol) {
            updateJob.run(now, row.id);
          } else {
            updateJob.run(row.id);
          }
          scrubbedJobs++;
        }
      }
      db.exec('COMMIT;');
      console.log(`[SCRUB] Jobs table: scrubbed ${scrubbedJobs} non-tech jobs.`);
    } catch (err) {
      db.exec('ROLLBACK;');
      console.error('[SCRUB] Jobs update failed, rolled back:', err);
      process.exit(1);
    }
  } else {
    console.log('[SCRUB] Jobs table: scrubbed 0 non-tech jobs.');
  }

  // 3. Compact database
  db.exec('PRAGMA wal_checkpoint(PASSIVE);');
  console.log('[SCRUB] Queue scrubbing completed successfully.');

  try {
    db.close();
  } catch {}

  return { scrubbedApplications, scrubbedJobs };
}

if (process.argv[1] && process.argv[1].includes('scrub-non-tech-jobs')) {
  scrubNonTechJobs();
}
