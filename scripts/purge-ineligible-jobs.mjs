import { DatabaseSync } from 'node:sqlite';
import { isStrictTechRole, isStrictIndiaLocation } from './harvest-fast-ats-jobs.js';

const db = new DatabaseSync('state/autoapply/portal-review/queue.sqlite');
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 15000;');

const rows = db.prepare(`SELECT id, payload FROM applications WHERE status = 'queued'`).all();
console.log(`Auditing ${rows.length} queued rows...`);

const idsToSkip = [];
for (const r of rows) {
  const p = JSON.parse(r.payload || '{}');
  const title = String(p.title || '');
  const location = String(p.location || '');

  if (!isStrictTechRole(title) || !isStrictIndiaLocation(location, title)) {
    idsToSkip.push(r.id);
  }
}

console.log(`Identified ${idsToSkip.length} rows to skip out of ${rows.length}. Applying in transaction...`);

db.exec('BEGIN TRANSACTION');
const updateStmt = db.prepare(`UPDATE applications SET status = 'skipped', last_error = 'ineligible_role_or_location' WHERE id = ?`);
for (const id of idsToSkip) {
  updateStmt.run(id);
}
db.exec('COMMIT');

console.log(`Transaction committed.`);
const statusCounts = db.prepare(`SELECT status, count(*) as cnt FROM applications GROUP BY status`).all();
console.log('Updated queue status breakdown:', statusCounts);

db.close();
