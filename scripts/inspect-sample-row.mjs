import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('state/autoapply/portal-review/queue.sqlite');
db.exec('PRAGMA busy_timeout = 15000;');
const row = db.prepare("SELECT * FROM applications WHERE status = 'queued' LIMIT 1").get();
console.log('SAMPLE ROW:', {
  candidate_id: row.candidate_id,
  id: row.id,
  canonical_key: row.canonical_key,
  normalized_url: row.normalized_url,
  status: row.status,
  payload: JSON.parse(row.payload)
});
db.close();
