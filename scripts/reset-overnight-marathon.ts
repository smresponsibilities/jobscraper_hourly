// scripts/reset-overnight-marathon.ts
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

const resetQuery = `
  UPDATE applications
  SET status = 'queued',
      payload = json_set(payload, '$.status', 'queued', '$.error', null, '$.reason', null, '$.skipReason', null)
  WHERE status IN ('failed', 'paused_for_review')
    AND (
      normalized_url LIKE '%greenhouse.io%'
      OR normalized_url LIKE '%gh_jid=%'
      OR normalized_url LIKE '%ashbyhq.com%'
      OR normalized_url LIKE '%lever.co%'
      OR normalized_url LIKE '%workable.com%'
      OR payload LIKE '%"provider":"greenhouse"%'
      OR payload LIKE '%"provider":"ashby"%'
      OR payload LIKE '%"provider":"lever"%'
      OR payload LIKE '%"provider":"workable"%'
    )
    AND normalized_url NOT LIKE '%stripe%'
    AND normalized_url NOT LIKE '%avoca%'
    AND normalized_url NOT LIKE '%ssctech%'
    AND normalized_url NOT LIKE '%paypal%'
    AND payload NOT LIKE '%"job_closed"%'
    AND payload NOT LIKE '%status_404%'
    AND payload NOT LIKE '%404 Not Found%'
`;

const result = db.prepare(resetQuery).run() as { changes: number };
console.log(`Reset ${result.changes} failed/paused applications back to queued.`);

// Clean attempt registries: retain only applied jobs
const appliedRows = db.prepare("SELECT id, normalized_url FROM applications WHERE status = 'applied'").all() as Array<{ id: string; normalized_url: string }>;
const appliedIds = new Set(appliedRows.map(r => r.id));
const appliedUrls = new Set(appliedRows.map(r => r.normalized_url));
console.log(`Total applied jobs in database: ${appliedIds.size}`);

const attemptedIdsPath = path.resolve('state/autoapply/portal-review/attempted-job-ids.json');
if (fs.existsSync(attemptedIdsPath)) {
  try {
    const raw = JSON.parse(fs.readFileSync(attemptedIdsPath, 'utf8'));
    const cleanedJobIds: Record<string, any> = {};
    const cleanedUrls: Record<string, any> = {};
    if (raw && typeof raw === 'object') {
      const sourceJobIds = raw.jobIds || raw;
      for (const [k, v] of Object.entries(sourceJobIds)) {
        if (appliedIds.has(k)) cleanedJobIds[k] = v;
      }
      if (raw.normalizedUrls) {
        for (const [k, v] of Object.entries(raw.normalizedUrls)) {
          if (appliedUrls.has(k) || (v as any)?.status === 'applied') cleanedUrls[k] = v;
        }
      }
    }
    const cleaned = {
      jobIds: cleanedJobIds,
      normalizedUrls: cleanedUrls,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(attemptedIdsPath, JSON.stringify(cleaned, null, 2), 'utf8');
    console.log(`Cleaned attempted-job-ids.json to retain only applied (${Object.keys(cleanedJobIds).length} ids).`);
  } catch (err) {
    console.warn('Failed cleaning attempted-job-ids.json:', err);
  }
}

const jobAttemptsPath = path.resolve('state/autoapply/portal-review/job-attempts.json');
if (fs.existsSync(jobAttemptsPath)) {
  try {
    const raw = JSON.parse(fs.readFileSync(jobAttemptsPath, 'utf8'));
    if (typeof raw === 'object' && raw !== null) {
      const cleaned: Record<string, any> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (appliedIds.has(k)) cleaned[k] = v;
      }
      fs.writeFileSync(jobAttemptsPath, JSON.stringify(cleaned, null, 2), 'utf8');
      console.log(`Cleaned job-attempts.json to retain only applied (${Object.keys(cleaned).length} ids).`);
    }
  } catch (err) {
    console.warn('Failed cleaning job-attempts.json:', err);
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
    console.log('Updated queue-summary.json with fresh counts:', counts);
  } catch (err) {
    console.warn('Failed updating queue-summary.json:', err);
  }
}

db.close();
