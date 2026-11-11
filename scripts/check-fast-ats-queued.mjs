import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('state/autoapply/portal-review/queue.sqlite');
const rows = db.prepare(`
  SELECT id, normalized_url, payload FROM applications
  WHERE status = 'queued'
    AND (
      normalized_url LIKE '%boards.greenhouse.io%'
      OR normalized_url LIKE '%job-boards.greenhouse.io%'
      OR normalized_url LIKE '%jobs.lever.co%'
      OR normalized_url LIKE '%jobs.ashbyhq.com%'
      OR normalized_url LIKE '%apply.workable.com%'
    )
  LIMIT 20
`).all();

console.log(`Found ${rows.length} fast-ATS queued jobs:`);
for (const r of rows) {
  const p = JSON.parse(r.payload || '{}');
  console.log(`- [${r.id}] ${p.company} | ${p.title} | ${r.normalized_url}`);
}
db.close();
