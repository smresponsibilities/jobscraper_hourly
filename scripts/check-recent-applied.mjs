import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('state/autoapply/portal-review/queue.sqlite');
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;');
const rows = db.prepare("SELECT json_extract(payload,'$.company') as company, json_extract(payload,'$.title') as title, status, json_extract(payload,'$.discoveredAt') as discoveredAt FROM applications WHERE status='applied' ORDER BY rowid DESC LIMIT 8").all();
console.log(JSON.stringify(rows, null, 2));
const cnt = db.prepare("SELECT COUNT(*) as cnt FROM applications WHERE status='applied'").get();
console.log('TOTAL APPLIED:', cnt.cnt);
db.close();
