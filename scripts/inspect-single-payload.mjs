import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('state/autoapply/portal-review/queue.sqlite');
const row = db.prepare(`SELECT normalized_url, payload FROM applications WHERE status = 'queued' LIMIT 1`).get();
console.log('Sample row normalized_url:', row.normalized_url);
console.log('Sample row payload:', JSON.parse(row.payload));
db.close();
