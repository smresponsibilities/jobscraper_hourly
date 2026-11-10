import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  NON_TECH_TITLE_REGEX,
  WHITELIST_SOFTWARE_TITLE_REGEX,
} from '../src/autoapply/candidate-fit-filter.js';

export function scrubNonTechJobs(
  dbPath = path.resolve('state/autoapply/portal-review/queue.sqlite')
): { scrubbedApplications: number; scrubbedJobs: number } {
  if (!fs.existsSync(dbPath)) {
    console.log(`[SCRUB-NON-TECH] Database not found at ${dbPath}`);
    return { scrubbedApplications: 0, scrubbedJobs: 0 };
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout = 15000; PRAGMA journal_mode = WAL;');
  let scrubbedApplications = 0;
  let scrubbedJobs = 0;

  try {
    let retries = 10;
    while (retries-- > 0) {
      try {
        db.exec('BEGIN IMMEDIATE');
        break;
      } catch (err: any) {
        if (/database is locked/i.test(err?.message || '') && retries > 0) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
          continue;
        }
        throw err;
      }
    }

    // 1. Process applications table
    const hasAppsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='applications'").get();
    if (hasAppsTable) {
      let appCols = (db.prepare("PRAGMA table_info(applications)").all() as Array<{ name: string }>).map(c => c.name);
      if (!appCols.includes('last_error')) {
        try {
          db.exec("ALTER TABLE applications ADD COLUMN last_error TEXT;");
          appCols.push('last_error');
        } catch {}
      }

      const rows = db.prepare(
        "SELECT id, payload, status FROM applications WHERE status IN ('queued', 'paused_for_review')"
      ).all() as Array<{ id: string; payload: string; status: string }>;

      const updateApp = db.prepare(
        "UPDATE applications SET status = 'skipped', last_error = 'REJECTED_NON_TECH_TITLE', payload = json_set(payload, '$.error', 'REJECTED_NON_TECH_TITLE', '$.last_error', 'REJECTED_NON_TECH_TITLE') WHERE id = ?"
      );

      for (const row of rows) {
        let p: any = {};
        try {
          p = JSON.parse(row.payload || '{}');
        } catch {
          continue;
        }

        const title = String(p.title || '').trim();
        if (!title) continue;

        if (NON_TECH_TITLE_REGEX.test(title) && !WHITELIST_SOFTWARE_TITLE_REGEX.test(title)) {
          updateApp.run(row.id);
          scrubbedApplications++;
        }
      }
    }

    // 2. Process jobs table if it exists
    const hasJobsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'").get();
    if (hasJobsTable) {
      let jobCols = (db.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>).map(c => c.name);
      if (!jobCols.includes('last_error')) {
        try {
          db.exec("ALTER TABLE jobs ADD COLUMN last_error TEXT;");
          jobCols.push('last_error');
        } catch {}
      }
      const hasLastErrorCol = jobCols.includes('last_error');
      const hasTitleCol = jobCols.includes('title');
      const hasPayloadCol = jobCols.includes('payload');

      const jobRows = db.prepare(
        "SELECT * FROM jobs WHERE status IN ('queued', 'paused_for_review')"
      ).all() as Array<any>;

      for (const j of jobRows) {
        let p: any = {};
        if (hasPayloadCol && j.payload) {
          try {
            p = JSON.parse(j.payload);
          } catch {}
        }

        const title = String((hasTitleCol ? j.title : '') || p.title || '').trim();
        if (!title) continue;

        if (NON_TECH_TITLE_REGEX.test(title) && !WHITELIST_SOFTWARE_TITLE_REGEX.test(title)) {
          if (hasLastErrorCol) {
            db.prepare("UPDATE jobs SET status = 'skipped', last_error = 'REJECTED_NON_TECH_TITLE' WHERE id = ?").run(j.id);
          } else if (hasPayloadCol) {
            db.prepare("UPDATE jobs SET status = 'skipped', payload = json_set(payload, '$.last_error', 'REJECTED_NON_TECH_TITLE') WHERE id = ?").run(j.id);
          } else {
            db.prepare("UPDATE jobs SET status = 'skipped' WHERE id = ?").run(j.id);
          }
          scrubbedJobs++;
        }
      }
    }

    db.exec('COMMIT');
    console.log(`[SCRUB-NON-TECH] Scrubbed ${scrubbedApplications} applications and ${scrubbedJobs} jobs.`);

    // Compact disk space via VACUUM
    try {
      db.exec('VACUUM');
      console.log('[SCRUB-NON-TECH] VACUUM completed successfully.');
    } catch (vErr) {
      console.warn('[SCRUB-NON-TECH] VACUUM skipped or warning:', vErr);
    }

    return { scrubbedApplications, scrubbedJobs };
  } catch (err) {
    db.exec('ROLLBACK');
    console.error('[SCRUB-NON-TECH] Failed to scrub queue:', err);
    throw err;
  } finally {
    db.close();
  }
}

if (process.argv[1] && process.argv[1].includes('scrub-non-tech-jobs')) {
  scrubNonTechJobs();
}
