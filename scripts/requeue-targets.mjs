import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

const dbPath = 'state/autoapply/portal-review/queue.sqlite';
const db = new DatabaseSync(dbPath);

const targetKeywords = ['snowflake', 'particle41', 'rwazi'];

for (const kw of targetKeywords) {
  const rows = db.prepare(`SELECT id, status, payload FROM applications WHERE payload LIKE ?`).all(`%${kw}%`);
  console.log(`Found ${rows.length} rows matching "${kw}":`);
  for (const r of rows) {
    db.prepare(`UPDATE applications SET status = 'queued', last_error = null WHERE id = ?`).run(r.id);
    const sessionDir = path.resolve('state/autoapply/portal-review/applications', String(r.id));
    const ck = path.join(sessionDir, 'checkpoint.json');
    if (fs.existsSync(ck)) {
      try { fs.unlinkSync(ck); console.log(`Deleted stale checkpoint for ${r.id}`); } catch {}
    }
  }
}

// Clear attempted-job-ids and job-attempts if present
for (const fname of ['state/autoapply/portal-review/attempted-job-ids.json', 'state/autoapply/portal-review/job-attempts.json']) {
  if (fs.existsSync(fname)) {
    try {
      const data = JSON.parse(fs.readFileSync(fname, 'utf8'));
      if (Array.isArray(data)) {
        fs.writeFileSync(fname, '[]', 'utf8');
      } else if (typeof data === 'object' && data) {
        fs.writeFileSync(fname, '{}', 'utf8');
      }
    } catch {}
  }
}

const statusCounts = db.prepare(`SELECT status, count(*) as cnt FROM applications GROUP BY status`).all();
console.log('Queue status breakdown:', statusCounts);
db.close();
