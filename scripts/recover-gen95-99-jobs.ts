import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadAttemptedRegistry, saveAttemptedRegistry, normalizeAttemptUrl } from '../src/autoapply/attempted-registry.js';

const dbPath = path.resolve('state/autoapply/portal-review/queue.sqlite');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 15000; PRAGMA journal_mode = WAL;');

console.log('--- RECOVERING HISTORICAL MAINTENANCE & UNMAPPED JOBS (GEN-97.4 & GEN-99.1) ---');

// 1. Mark remaining Stripe rows in Greenhouse as skipped
const stripeResult = db.prepare(`
  UPDATE applications
  SET status = 'skipped',
      payload = json_set(payload, '$.status', 'skipped', '$.error', 'stripe_unsupported', '$.reasonCode', 'SKIPPED_UNSUPPORTED_ATS')
  WHERE status = 'queued'
    AND (json_extract(payload, '$.company') LIKE '%stripe%' OR json_extract(payload, '$.jobUrl') LIKE '%stripe%')
`).run();
console.log(`[GEN-97.4] Marked ${stripeResult.changes} Stripe rows as skipped.`);

// 2. Identify Workday maintenance rows & target company rows to recover
const targetCompanies = ['gitlab', 'yipitdata', 'graviton', 'eurofins', 'miratech', 'citi', 'state street'];

const rowsToInspect = db.prepare(`
  SELECT id, status, payload
  FROM applications
  WHERE status IN ('failed', 'paused_for_review', 'skipped')
`).all();

const recoveredIds = new Set<string>();
const recoveredUrls = new Set<string>();

let maintenanceResetCount = 0;
let companyResetCount = 0;

for (const row of rowsToInspect as Array<{ id: string; status: string; payload: string }>) {
  try {
    const p = JSON.parse(row.payload);
    const url = p.jobUrl || p.url || '';
    const company = (p.company || '').toLowerCase();
    const errorText = `${p.lastError || ''} ${p.error || ''} ${p.stepHeading || ''} ${p.failureReason || ''}`.toLowerCase();

    // Check if it's a Workday maintenance row falsely marked as missing submit button
    const isWorkdayMaintenance =
      url.includes('myworkdayjobs.com') &&
      (errorText.includes('workday is currently unavailable') ||
       errorText.includes('service is temporarily unavailable') ||
       errorText.includes('no supported submit control found'));

    // Check if it's a target company failed/paused
    const isTargetCompany = targetCompanies.some(tc => company.includes(tc)) &&
      (row.status === 'failed' || row.status === 'paused_for_review');

    if (isWorkdayMaintenance || isTargetCompany) {
      recoveredIds.add(row.id);
      if (url) recoveredUrls.add(url);

      const updatedPayload = {
        ...p,
        status: 'queued',
        error: null,
        lastError: null,
        failureReason: null,
        reasonCode: null,
        skipReason: null,
        reason: null,
        retryCount: 0,
      };

      db.prepare(`
        UPDATE applications
        SET status = 'queued', payload = ?
        WHERE id = ?
      `).run(JSON.stringify(updatedPayload), row.id);

      if (isWorkdayMaintenance) maintenanceResetCount++;
      if (isTargetCompany) companyResetCount++;
    }
  } catch (e) {}
}

console.log(`[GEN-99.1] Reset ${maintenanceResetCount} Workday maintenance / submit-control rows to queued.`);
console.log(`[GEN-99.1] Reset ${companyResetCount} target company rows (GitLab, YipitData, Graviton, Eurofins, Miratech, Citi, State Street) to queued.`);
console.log(`Total unique jobs recovered to queued: ${recoveredIds.size}`);

// 3. Clear recovered job IDs from attempted-job-ids.json and job-attempts.json
const registry = loadAttemptedRegistry();
let regCleared = 0;
for (const id of recoveredIds) {
  if (registry.jobIds[id]) {
    delete registry.jobIds[id];
    regCleared++;
  }
}
for (const url of recoveredUrls) {
  const norm = normalizeAttemptUrl(url);
  if (registry.normalizedUrls[norm]) {
    delete registry.normalizedUrls[norm];
  }
}
saveAttemptedRegistry(registry);
console.log(`[GEN-99.1] Cleared ${regCleared} recovered IDs from attempted registry.`);

// Also clear job-attempts.json if present
const attemptsPath = path.resolve('state/autoapply/portal-review/job-attempts.json');
if (fs.existsSync(attemptsPath)) {
  try {
    const attempts = JSON.parse(fs.readFileSync(attemptsPath, 'utf8'));
    let attemptsCleared = 0;
    for (const id of recoveredIds) {
      if (attempts[id] !== undefined) {
        delete attempts[id];
        attemptsCleared++;
      }
    }
    fs.writeFileSync(attemptsPath, JSON.stringify(attempts, null, 2), 'utf8');
    console.log(`[GEN-99.1] Cleared ${attemptsCleared} entries from job-attempts.json.`);
  } catch (e) {}
}

db.close();
console.log('Recovery completed successfully.');
