// scripts/recover-gen88.ts
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const dbPath = path.resolve('state/autoapply/portal-review/queue.sqlite');
if (!fs.existsSync(dbPath)) {
  console.log('No queue.sqlite found at', dbPath);
  process.exit(0);
}

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=30000;');

const query = `
  SELECT COUNT(*) as c FROM applications
  WHERE status = 'skipped'
    AND (
      normalized_url LIKE '%myworkdayjobs.com%'
      OR normalized_url LIKE '%ashbyhq.com%'
      OR normalized_url LIKE '%smartrecruiters.com%'
    )
    AND (
      json_extract(payload, '$.skipReason') IN ('job_closed', 'Position closed', 'fast_api_preflight_skipped')
      OR json_extract(payload, '$.reason') IN ('job_closed', 'Position closed')
      OR json_extract(payload, '$.skipReason') IS NULL
    )
`;

const count = db.prepare(query).get() as { c: number };
console.log('Falsely skipped Workday/Ashby/SmartRecruiters rows to recover:', count.c);

const updateQuery = `
  UPDATE applications
  SET status = 'queued',
      payload = json_set(payload, '$.status', 'queued', '$.skipReason', null, '$.error', null, '$.reason', null)
  WHERE status = 'skipped'
    AND (
      normalized_url LIKE '%myworkdayjobs.com%'
      OR normalized_url LIKE '%ashbyhq.com%'
      OR normalized_url LIKE '%smartrecruiters.com%'
    )
    AND (
      json_extract(payload, '$.skipReason') IN ('job_closed', 'Position closed', 'fast_api_preflight_skipped')
      OR json_extract(payload, '$.reason') IN ('job_closed', 'Position closed')
      OR json_extract(payload, '$.skipReason') IS NULL
    )
`;

const res = db.prepare(updateQuery).run() as { changes: number };
console.log('Successfully recovered and re-queued rows:', res.changes);
db.close();
