import { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';
import { removeAttemptedJob } from '../src/autoapply/attempted-registry.js';

export function requeueCycle1Jobs(sqlitePath = path.resolve('state/autoapply/portal-review/queue.sqlite')): {
  requeuedCount: number;
  requeuedJobs: Array<{ id: string; company: string; url: string }>;
} {
  const db = new DatabaseSync(sqlitePath);
  db.exec('PRAGMA busy_timeout = 15000; PRAGMA journal_mode = WAL;');

  const targetCompanies = [
    'enterpret',
    'netgear',
    'beghou consulting',
    'coram ai',
    'capco',
    'hevo data',
    'uptimeai',
    'commvault',
    'point72',
    'centre for effective altruism',
    'joveo sandbox',
    'coface',
    'blueoptima',
    'renesas electronics',
    'hitachi solutions',
  ];

  const rows = db.prepare(`
    SELECT id, status, payload, normalized_url
    FROM applications
    WHERE status IN ('failed', 'paused_for_review')
  `).all() as Array<{ id: string; status: string; payload: string; normalized_url: string }>;

  const requeuedJobs: Array<{ id: string; company: string; url: string }> = [];

  for (const r of rows) {
    try {
      const p = JSON.parse(r.payload);
      const co = (p.company || '').toLowerCase().trim();
      const isTarget = targetCompanies.some(tc => co === tc || co.includes(tc));
      if (isTarget) {
        const url = p.jobUrl || p.url || r.normalized_url || '';
        requeuedJobs.push({ id: r.id, company: p.company || 'Company', url });
      }
    } catch {}
  }

  if (requeuedJobs.length > 0) {
    const updateStmt = db.prepare(`
      UPDATE applications
      SET status = 'queued',
          payload = json_set(payload, '$.status', 'queued', '$.retryCount', 0, '$.error', null, '$.failureReason', null)
      WHERE id = ?
    `);

    db.exec('BEGIN TRANSACTION;');
    try {
      for (const j of requeuedJobs) {
        updateStmt.run(j.id);
      }
      db.exec('COMMIT;');
    } catch (e) {
      db.exec('ROLLBACK;');
      throw e;
    }

    for (const j of requeuedJobs) {
      removeAttemptedJob(j.id, j.url);
    }
  }

  db.close();
  return { requeuedCount: requeuedJobs.length, requeuedJobs };
}

if (process.argv[1] && process.argv[1].endsWith('requeue-cycle1-jobs.ts')) {
  const res = requeueCycle1Jobs();
  console.log(`[REQUEUE] Requeued ${res.requeuedCount} Cycle #1 target jobs:`);
  for (const j of res.requeuedJobs) {
    console.log(` - ${j.company} (${j.id}): ${j.url}`);
  }
}
