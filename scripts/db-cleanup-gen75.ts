import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const dbPath = path.resolve('state/autoapply/portal-review/queue.sqlite');
if (!fs.existsSync(dbPath)) {
  console.log(`[GEN-75 DB] ${dbPath} does not exist, skipping.`);
  process.exit(0);
}

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=30000;');

const cols = db.prepare("PRAGMA table_info(applications)").all() as Array<{ name: string }>;
console.log('[GEN-75 DB] Applications columns:', cols.map(c => c.name));

const urlCol = cols.some(c => c.name === 'url') ? 'url' : 'normalized_url';

let updated = false;
for (let attempt = 1; attempt <= 10; attempt++) {
  try {
    const countRes = db.prepare(
      `SELECT count(*) as cnt FROM applications WHERE status = 'queued' AND (${urlCol} LIKE '%oraclecloud.com%' OR ${urlCol} LIKE '%ycombinator.com/companies/%' OR ${urlCol} LIKE '%linkedin.com/jobs/view/%')`
    ).get() as { cnt: number };
    console.log(`[GEN-75 DB] Found ${countRes?.cnt ?? 0} matching queued rows in applications.`);

    const updateRes = db.prepare(
      `UPDATE applications SET status = 'skipped' WHERE status = 'queued' AND (${urlCol} LIKE '%oraclecloud.com%' OR ${urlCol} LIKE '%ycombinator.com/companies/%' OR ${urlCol} LIKE '%linkedin.com/jobs/view/%')`
    ).run();
    console.log(`[GEN-75 DB] Updated to 'skipped':`, (updateRes as any).changes);
    updated = true;
    break;
  } catch (e: any) {
    console.log(`[GEN-75 DB] Attempt ${attempt} failed: ${e.message}, retrying...`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  }
}

if (!updated) {
  console.error('[GEN-75 DB] Could not update due to persistent lock');
  process.exit(1);
}
console.log('[GEN-75 DB] Successfully completed bulk update.');
