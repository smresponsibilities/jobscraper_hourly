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

// Find rows to reset:
// Rows in paused_for_review or failed whose payload reason matches 'Ready for submission review'
// OR Workday 'Login needs browser review' (including Fidelity, Dyson, HPE, Lloyds, Micron, ABB, Amgen)
const targetCompanies = ['fidelity', 'dyson', 'hpe', 'lloyds', 'micron', 'abb', 'amgen'];
const companyConditions = targetCompanies
  .map(c => `lower(normalized_url) LIKE '%${c}%' OR lower(payload) LIKE '%${c}%'`)
  .join(' OR ');

const selectQuery = `
  SELECT id, normalized_url, status, payload
  FROM applications
  WHERE status IN ('paused_for_review', 'failed')
    AND (
      json_extract(payload, '$.reason') LIKE '%Ready for submission review%'
      OR json_extract(payload, '$.error') LIKE '%Ready for submission review%'
      OR (
        (json_extract(payload, '$.reason') LIKE '%Login needs browser review%' OR json_extract(payload, '$.error') LIKE '%Login needs browser review%')
        AND (
          normalized_url LIKE '%myworkdayjobs.com%'
          OR payload LIKE '%myworkdayjobs.com%'
          OR ${companyConditions}
        )
      )
    )
`;

const rowsToReset = db.prepare(selectQuery).all() as Array<{ id: string; normalized_url: string; status: string; payload: string }>;
console.log(`Found ${rowsToReset.length} rows to recover back to queued.`);

const resetIds = new Set(rowsToReset.map(r => r.id));
const resetUrls = new Set(rowsToReset.map(r => r.normalized_url));

if (rowsToReset.length > 0) {
  const updateQuery = `
    UPDATE applications
    SET status = 'queued',
        payload = json_set(payload, '$.status', 'queued', '$.error', null, '$.reason', null, '$.skipReason', null)
    WHERE status IN ('paused_for_review', 'failed')
      AND (
        json_extract(payload, '$.reason') LIKE '%Ready for submission review%'
        OR json_extract(payload, '$.error') LIKE '%Ready for submission review%'
        OR (
          (json_extract(payload, '$.reason') LIKE '%Login needs browser review%' OR json_extract(payload, '$.error') LIKE '%Login needs browser review%')
          AND (
            normalized_url LIKE '%myworkdayjobs.com%'
            OR payload LIKE '%myworkdayjobs.com%'
            OR ${companyConditions}
          )
        )
      )
  `;
  const result = db.prepare(updateQuery).run() as { changes: number };
  console.log(`Successfully reset ${result.changes} applications to 'queued'.`);

  // Remove reset jobs from attempted-job-ids.json
  const attemptedIdsPath = path.resolve('state/autoapply/portal-review/attempted-job-ids.json');
  if (fs.existsSync(attemptedIdsPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(attemptedIdsPath, 'utf8'));
      if (raw && typeof raw === 'object') {
        const sourceJobIds = raw.jobIds || raw;
        let removedIds = 0;
        for (const id of resetIds) {
          if (sourceJobIds[id]) {
            delete sourceJobIds[id];
            removedIds++;
          }
        }
        if (raw.normalizedUrls) {
          for (const u of resetUrls) {
            if (raw.normalizedUrls[u]) delete raw.normalizedUrls[u];
          }
        }
        raw.updatedAt = new Date().toISOString();
        fs.writeFileSync(attemptedIdsPath, JSON.stringify(raw, null, 2), 'utf8');
        console.log(`Removed ${removedIds} reset jobs from attempted-job-ids.json.`);
      }
    } catch (err) {
      console.warn('Failed updating attempted-job-ids.json:', err);
    }
  }

  // Remove reset jobs from job-attempts.json
  const jobAttemptsPath = path.resolve('state/autoapply/portal-review/job-attempts.json');
  if (fs.existsSync(jobAttemptsPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(jobAttemptsPath, 'utf8'));
      if (raw && typeof raw === 'object') {
        let removedAttempts = 0;
        for (const id of resetIds) {
          if (raw[id]) {
            delete raw[id];
            removedAttempts++;
          }
        }
        fs.writeFileSync(jobAttemptsPath, JSON.stringify(raw, null, 2), 'utf8');
        console.log(`Removed ${removedAttempts} reset jobs from job-attempts.json.`);
      }
    } catch (err) {
      console.warn('Failed updating job-attempts.json:', err);
    }
  }

  // Update queue-summary.json
  const summaryPath = path.resolve('state/autoapply/portal-review/queue-summary.json');
  if (fs.existsSync(summaryPath)) {
    try {
      const counts = db.prepare("SELECT status, count(*) as c FROM applications GROUP BY status").all() as Array<{ status: string; c: number }>;
      const summary: Record<string, any> = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
      for (const row of counts) {
        summary[row.status] = row.c;
      }
      summary.updatedAt = new Date().toISOString();
      fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
      console.log('Updated queue-summary.json counts:', counts);
    } catch (err) {
      console.warn('Failed updating queue-summary.json:', err);
    }
  }
}

db.close();
