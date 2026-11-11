import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const dbPath = 'state/autoapply/portal-review/queue.sqlite';
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=15000;');

// Direct supported ATS patterns
const supportedRegex = /(?:greenhouse\.io|gh_jid=|jobs\.ashbyhq\.com|jobs\.lever\.co|apply\.workable\.com|\.recruitee\.com|\.breezy\.hr|jobs\.smartrecruiters\.com|\.myworkdayjobs\.com)/i;
const isolatedTenants = /(?:stripe|avoca|ssctech|paypal)/i;

const allRows = db.prepare("SELECT id, canonical_key, normalized_url, status, last_error FROM applications WHERE status IN ('failed', 'paused_for_review')").all();
console.log(`Found ${allRows.length} total rows in failed or paused_for_review.`);

let resetCount = 0;
const resetStmt = db.prepare("UPDATE applications SET status = 'queued', last_error = NULL WHERE id = ?");

db.exec('BEGIN TRANSACTION;');
for (const row of allRows) {
  const url = row.normalized_url || '';
  const error = String(row.last_error || '').toLowerCase();
  // Exclude 404 / closed postings
  if (/job_closed|404|not found|no longer available|position has been filled|closed_in_catalogue/i.test(error)) {
    continue;
  }
  // Exclude isolated tenants
  if (isolatedTenants.test(url)) {
    continue;
  }
  // Check if supported ATS
  if (supportedRegex.test(url)) {
    resetStmt.run(row.id);
    resetCount++;

    const key = row.canonical_key || row.normalized_url;
    if (key) {
      const hash = createHash('sha256').update(key).digest('hex').slice(0, 20);
      const chk = path.join('state/autoapply/portal-review/applications', hash, 'checkpoint.json');
      if (fs.existsSync(chk)) {
        try { fs.unlinkSync(chk); } catch {}
      }
      const chk2 = path.join('state/autoapply/applications', hash, 'checkpoint.json');
      if (fs.existsSync(chk2)) {
        try { fs.unlinkSync(chk2); } catch {}
      }
    }
  }
}
db.exec('COMMIT;');
console.log(`Successfully reset ${resetCount} jobs back to status='queued'!`);

// Clear job-attempts.json and attempted-job-ids.json if present
for (const file of ['state/autoapply/portal-review/attempted-job-ids.json', 'state/autoapply/portal-review/job-attempts.json']) {
  if (fs.existsSync(file)) {
    try {
      fs.writeFileSync(file, '[]', 'utf8');
      console.log(`Cleared ${file}`);
    } catch {}
  }
}

const breakdown = db.prepare('SELECT status, COUNT(*) as cnt FROM applications GROUP BY status').all();
console.log('Updated Queue Breakdown:', JSON.stringify(breakdown));
db.close();
