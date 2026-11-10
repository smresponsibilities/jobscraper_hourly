import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("state/autoapply/portal-review/queue.sqlite", { readOnly: true });
const stats = db.prepare(`
  SELECT 
    count(1) as total,
    sum(case when status = 'applied' then 1 else 0 end) as applied,
    sum(case when status = 'queued' then 1 else 0 end) as queued,
    sum(case when status = 'skipped' then 1 else 0 end) as skipped,
    sum(case when status = 'failed' then 1 else 0 end) as failed,
    sum(case when status = 'paused_for_review' then 1 else 0 end) as paused
  FROM applications
`).get();

console.log("=== QUEUE APPLICATIONS STATS ===");
console.log(JSON.stringify(stats, null, 2));

const latest = db.prepare(`
  SELECT id, status, payload
  FROM applications 
  WHERE status = 'applied' 
  ORDER BY json_extract(payload, '$.appliedAt') DESC 
  LIMIT 25
`).all();

console.log("\n=== LATEST 25 APPLIED ===");
latest.forEach((row: any, i: number) => {
  let title = '', company = '', ats = '', appliedAt = '', receipt = '';
  try {
    const p = JSON.parse(row.payload);
    title = p.title || '';
    company = p.company || '';
    ats = p.ats || '';
    appliedAt = p.appliedAt || p.applied_at || '';
    receipt = p.receiptUrl || p.receipt_url || '';
  } catch {}
  console.log(`${i+1}. [${ats.toUpperCase()}] ${company} - ${title} | ${appliedAt}`);
});
