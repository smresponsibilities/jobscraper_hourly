import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('state/autoapply/portal-review/queue.sqlite');
const rows = db.prepare(`
  SELECT id, status, payload FROM applications
  WHERE status = 'queued'
  ORDER BY id DESC
  LIMIT 15
`).all();

console.log('Top 15 queued jobs in queue.sqlite:');
for (const r of rows) {
  const p = JSON.parse(r.payload || '{}');
  console.log(`- [${r.id}] ${p.company || 'Unknown'} | ${p.title || 'Unknown'} | ${p.location || 'Unknown'}`);
}
db.close();
