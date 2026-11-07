import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isSupportedDirectAtsJobUrl } from '../src/autoapply/preflight.js';

const dbPath = path.resolve('state/autoapply/portal-review/queue.sqlite');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 15000; PRAGMA journal_mode = WAL;');

console.log('[RECOVERY] Purging non-direct ATS jobs from queue.sqlite...');

// 1. Fetch all queued jobs from applications table
const queuedRows = db.prepare(`SELECT candidate_id, id, status, payload FROM applications WHERE status = 'queued'`).all() as Array<{
  candidate_id: string;
  id: string;
  status: string;
  payload: string;
}>;

let nonAtsSkipped = 0;
const skipStmt = db.prepare(`UPDATE applications SET status = 'skipped', payload = ? WHERE candidate_id = ? AND id = ?`);

db.exec('BEGIN IMMEDIATE');
for (const row of queuedRows) {
  let job: any;
  try {
    job = JSON.parse(row.payload);
  } catch {
    continue;
  }
  const jobUrl = job.jobUrl || job.url;
  if (!isSupportedDirectAtsJobUrl(jobUrl)) {
    job.status = 'skipped';
    job.error = 'unsupported_non_direct_ats_url';
    job.reasonCode = 'SKIPPED_UNSUPPORTED_ATS';
    skipStmt.run(JSON.stringify(job), row.candidate_id, row.id);
    nonAtsSkipped++;
  }
}
db.exec('COMMIT');
console.log(`[RECOVERY] Marked ${nonAtsSkipped} non-direct ATS jobs as skipped: unsupported_non_direct_ats_url`);

// 2. Reset failed/paused/skipped jobs on target companies back to 'queued'
const targetCompanies = [
  'yipitdata',
  'gitlab',
  'flextrade',
  'skild ai',
  'eurofins',
  'trimble',
  'pwc',
  'harman',
  'synechron',
  'barclays',
  'hpe',
  'intel',
  'cisco',
  'citi',
  'roche'
];

let resetCount = 0;
const resetStmt = db.prepare(`UPDATE applications SET status = 'queued', payload = ? WHERE candidate_id = ? AND id = ?`);

const targetRows = db.prepare(`SELECT candidate_id, id, status, payload FROM applications WHERE status IN ('skipped', 'paused_for_review', 'failed')`).all() as Array<{
  candidate_id: string;
  id: string;
  status: string;
  payload: string;
}>;

const recoveredIds = new Set<string>();

db.exec('BEGIN IMMEDIATE');
for (const row of targetRows) {
  let job: any;
  try {
    job = JSON.parse(row.payload);
  } catch {
    continue;
  }
  const compLower = (job.company || '').toLowerCase();
  const jobUrl = job.jobUrl || job.url;
  const isTarget = targetCompanies.some(tc => compLower.includes(tc));
  if (isTarget && isSupportedDirectAtsJobUrl(jobUrl)) {
    job.status = 'queued';
    delete job.error;
    delete job.reasonCode;
    resetStmt.run(JSON.stringify(job), row.candidate_id, row.id);
    recoveredIds.add(row.id);
    resetCount++;
  }
}
db.exec('COMMIT');

console.log(`[RECOVERY] Reset ${resetCount} failed/paused jobs on target companies back to 'queued'`);

// 3. Remove recovered IDs from attempted-job-ids.json and job-attempts.json
const attemptedPath = path.resolve('state/autoapply/portal-review/attempted-job-ids.json');
if (fs.existsSync(attemptedPath)) {
  try {
    const list: string[] = JSON.parse(fs.readFileSync(attemptedPath, 'utf8'));
    const filtered = list.filter(id => !recoveredIds.has(id));
    fs.writeFileSync(attemptedPath, JSON.stringify(filtered, null, 2), 'utf8');
    console.log(`[RECOVERY] Scrubbed ${list.length - filtered.length} recovered job IDs from attempted-job-ids.json`);
  } catch {}
}

const jobAttemptsPath = path.resolve('state/autoapply/portal-review/job-attempts.json');
if (fs.existsSync(jobAttemptsPath)) {
  try {
    const map: Record<string, any> = JSON.parse(fs.readFileSync(jobAttemptsPath, 'utf8'));
    let removed = 0;
    for (const id of recoveredIds) {
      if (map[id]) {
        delete map[id];
        removed++;
      }
    }
    fs.writeFileSync(jobAttemptsPath, JSON.stringify(map, null, 2), 'utf8');
    console.log(`[RECOVERY] Scrubbed ${removed} entries from job-attempts.json`);
  } catch {}
}

// 4. Clean any stale locks
const stateDir = path.resolve('state/autoapply/portal-review');
for (const file of fs.readdirSync(stateDir)) {
  if (file.endsWith('.lock')) {
    try {
      fs.unlinkSync(path.join(stateDir, file));
      console.log(`[RECOVERY] Deleted stale lock file: ${file}`);
    } catch {}
  }
}

db.close();
console.log('[RECOVERY] Database and cache cleanup complete!');
