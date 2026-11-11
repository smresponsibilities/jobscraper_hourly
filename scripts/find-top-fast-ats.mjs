import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('state/autoapply/portal-review/queue.sqlite');
const rows = db.prepare(`
  SELECT id, canonical_key, normalized_url, status, payload
  FROM applications
  WHERE status = 'queued'
    AND (normalized_url LIKE '%greenhouse.io%' OR normalized_url LIKE '%ashbyhq.com%' OR normalized_url LIKE '%lever.co%')
  LIMIT 15
`).all();

for (const r of rows) {
  let p = {};
  try { p = JSON.parse(r.payload); } catch {}
  console.log(`${p.company || 'Unknown'} | ${p.title || 'Unknown'} | ${r.normalized_url}`);
}
db.close();
