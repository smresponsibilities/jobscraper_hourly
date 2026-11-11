import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('state/autoapply/portal-review/queue.sqlite');
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;');
const rows = db.prepare("SELECT id, json_extract(payload, '$.company') as company, json_extract(payload, '$.title') as title, last_error, status FROM applications WHERE status = 'paused_for_review' LIMIT 40").all();
console.log('--- 34 PAUSED_FOR_REVIEW ROWS ---');
rows.forEach((r, i) => console.log(`${i+1}. ${r.company} | ${r.title} | ${String(r.last_error || 'None').slice(0, 70)}`));
db.close();
