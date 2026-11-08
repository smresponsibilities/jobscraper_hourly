import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export function printLiveScoreboardSnapshot(): void {
  const dbPath = fs.existsSync('state/autoapply/portal-review/queue.sqlite')
    ? 'state/autoapply/portal-review/queue.sqlite'
    : 'data/queue.sqlite';
  if (!fs.existsSync(dbPath)) {
    console.log('No queue.sqlite found');
    return;
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 5000;');

  const hasJobs = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'").get();
  const hasApps = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='applications'").get();

  let counts: any[] = [];
  let freshCounts: any[] = [];
  let recentApplied: any[] = [];

  if (hasJobs) {
    counts = db
      .prepare('SELECT status, COUNT(*) as cnt FROM jobs GROUP BY status ORDER BY cnt DESC')
      .all();
    freshCounts = db
      .prepare(
        "SELECT COALESCE(is_hourly_fresh, 0) as tier, COUNT(*) as cnt FROM jobs WHERE status = 'queued' GROUP BY COALESCE(is_hourly_fresh, 0) ORDER BY tier DESC"
      )
      .all();
    recentApplied = db
      .prepare(
        "SELECT company, SUBSTR(title, 1, 48) as title, updated_at FROM jobs WHERE status = 'applied' ORDER BY id DESC LIMIT 12"
      )
      .all();
  } else if (hasApps) {
    counts = db
      .prepare('SELECT status, COUNT(*) as cnt FROM applications GROUP BY status ORDER BY cnt DESC')
      .all();
    freshCounts = db
      .prepare(
        "SELECT COALESCE(json_extract(payload, '$.is_hourly_fresh'), 0) as tier, COUNT(*) as cnt FROM applications WHERE status = 'queued' GROUP BY tier ORDER BY tier DESC"
      )
      .all();
    recentApplied = db
      .prepare(
        "SELECT json_extract(payload, '$.company') as company, SUBSTR(json_extract(payload, '$.title'), 1, 48) as title, id FROM applications WHERE status = 'applied' ORDER BY id DESC LIMIT 12"
      )
      .all();
  }

  db.close();

  console.log('=== LIVE SCOREBOARD (' + dbPath + ') ===');
  console.log('Status Counts:', counts);
  console.log('Queued Freshness Tiers (2 = Live API Verified, 1 = Fresh, 0 = Backfill):', freshCounts);
  console.log('Latest Confirmed Applied Jobs:', recentApplied);
}

const isDirectRun = Boolean(
  process.argv[1] &&
    (path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase() ||
      process.argv[1].replace(/\\/g, '/').endsWith('watch-live-scoreboard.ts'))
);

if (isDirectRun) {
  printLiveScoreboardSnapshot();
}
