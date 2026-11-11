import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

export function syncQueueSummaryFromDb(
  sqlitePath = 'state/autoapply/portal-review/queue.sqlite',
  summaryPath = 'state/autoapply/portal-review/queue-summary.json'
) {
  if (!fs.existsSync(sqlitePath)) return null;
  const db = new DatabaseSync(sqlitePath);
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 15000;');
    const rows = db.prepare('SELECT status, COUNT(*) as cnt FROM applications GROUP BY status').all();
    const counts = {
      applied: 0,
      failed: 0,
      paused_for_review: 0,
      queued: 0,
      skipped: 0,
    };
    for (const r of rows) {
      if (counts[r.status] !== undefined) counts[r.status] = Number(r.cnt);
    }
    const summary = {
      ...counts,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
    return summary;
  } finally {
    db.close();
  }
}

const res = syncQueueSummaryFromDb();
console.log('SYNCED_SUMMARY:', res);
