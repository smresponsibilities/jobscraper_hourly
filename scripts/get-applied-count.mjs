import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('state/autoapply/portal-review/queue.sqlite');
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 15000;');
const row = db.prepare("SELECT COUNT(*) as c FROM applications WHERE status = 'applied'").get();
console.log('CURRENT_APPLIED:', row.c);
db.close();
