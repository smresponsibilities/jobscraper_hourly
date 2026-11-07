import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';

const dbPath = 'state/autoapply/portal-review/queue.sqlite';
if (!fs.existsSync(dbPath)) {
  console.log('Database not found at', dbPath);
  process.exit(0);
}

const db = new DatabaseSync(dbPath);

try {
  // GEN-33: Mark proprietary SSO & SAP portals as skipped
  const res33 = db.prepare(`
    UPDATE applications
    SET status = 'skipped',
        payload = json_set(payload, '$.status', 'skipped', '$.skipReason', 'Unsupported proprietary SSO/SAP portal')
    WHERE status IN ('queued', 'paused_for_review')
      AND (
        normalized_url LIKE '%google.com/about/careers%'
        OR normalized_url LIKE '%metacareers.com%'
        OR normalized_url LIKE '%facebook.com/careers%'
        OR normalized_url LIKE '%amazon.jobs%'
        OR normalized_url LIKE '%jobs.apple.com%'
        OR normalized_url LIKE '%jobs.sap.com%'
        OR normalized_url LIKE '%careers.microsoft.com%'
        OR normalized_url LIKE '%ibm.com/careers%'
        OR normalized_url LIKE '%oracle.com/careers%'
      )
  `).run();
  console.log(`[GEN-33] Skipped proprietary SSO/SAP applications: ${res33.changes}`);

  // GEN-36: Reset solvable paused applications back to queued
  const res36 = db.prepare(`
    UPDATE applications
    SET status = 'queued',
        payload = json_set(payload, '$.status', 'queued', '$.retryCount', 0, '$.retry_count', 0)
    WHERE status = 'paused_for_review'
      AND (
        normalized_url LIKE '%centreforeffectivealtruism%'
        OR normalized_url LIKE '%plane%'
        OR normalized_url LIKE '%tekion%'
        OR normalized_url LIKE '%diagrid%'
        OR normalized_url LIKE '%renesas%'
        OR normalized_url LIKE '%nielseniq%'
        OR normalized_url LIKE '%enviri%'
        OR normalized_url LIKE '%Eurofins%'
        OR normalized_url LIKE '%WesternDigital%'
        OR normalized_url LIKE '%fugro%'
        OR normalized_url LIKE '%zoom%'
        OR normalized_url LIKE '%latticesemi%'
        OR normalized_url LIKE '%selinc%'
        OR normalized_url LIKE '%athene%'
        OR normalized_url LIKE '%capco%'
        OR normalized_url LIKE '%ensono%'
        OR normalized_url LIKE '%gitlab%'
        OR normalized_url LIKE '%coupang%'
      )
  `).run();
  console.log(`[GEN-36] Reset paused solvable applications to queued: ${res36.changes}`);

  // Query updated counts
  const counts = db.prepare('SELECT status, count(*) as count FROM applications GROUP BY status').all();
  console.log('Updated application status counts:', counts);
} finally {
  db.close();
}
