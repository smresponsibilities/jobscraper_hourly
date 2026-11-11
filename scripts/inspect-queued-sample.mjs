import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('state/autoapply/portal-review/queue.sqlite');
const tableInfo = db.prepare(`PRAGMA table_info(applications)`).all();
console.log('Columns:', tableInfo.map(c => c.name));

const rows = db.prepare(`
  SELECT id, status, payload FROM applications
  WHERE status = 'queued'
  ORDER BY id ASC
  LIMIT 20
`).all();

console.log('Queued sample:');
for (const r of rows) {
  const p = JSON.parse(r.payload || '{}');
  console.log(`- [${r.id}] ${p.company || 'Unknown'} | ${p.title || 'Unknown'} | ${p.applyUrl || p.url}`);
}
db.close();
