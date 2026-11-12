import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';

const db = new DatabaseSync('state/autoapply/portal-review/queue.sqlite');
const statusCounts = db.prepare('SELECT status, COUNT(*) as cnt FROM applications GROUP BY status').all();
console.log('=== QUEUE BREAKDOWN ===');
for (const s of statusCounts) {
  console.log(`${s.status}: ${s.cnt}`);
}
db.close();

console.log('\n=== LAST 10 COMPLETED RUNS (run-history.jsonl) ===');
const histPath = 'state/autoapply/portal-review/run-history.jsonl';
if (fs.existsSync(histPath)) {
  const lines = fs.readFileSync(histPath, 'utf8').trim().split('\n').filter(Boolean);
  const last10 = lines.slice(-10);
  for (const line of last10) {
    try {
      const j = JSON.parse(line);
      console.log(`- [${j.finishedAt || j.startedAt}] ${j.company} (${j.provider || 'ats'}): status=${j.status}, dur=${(j.durationMs/1000).toFixed(1)}s, reason="${j.reason || ''}"`);
    } catch {}
  }
}
