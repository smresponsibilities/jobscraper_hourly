import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isSupportedDirectAtsJobUrl } from '../src/autoapply/preflight.js';
import { isEligibleEngineeringRoleTitle, isStrictlyIsolatedTenant } from '../src/autoapply/priority-scheduler.js';
import { removeAttemptedJob } from '../src/autoapply/attempted-registry.js';

export function executeFullDatabaseRecovery(sqlitePath = path.resolve('state/autoapply/portal-review/queue.sqlite')): {
  recoveredCount: number;
  providerBreakdown: Record<string, number>;
  totalQueued: number;
  queuedBreakdown: Record<string, number>;
} {
  const db = new DatabaseSync(sqlitePath);
  db.exec('PRAGMA busy_timeout = 15000; PRAGMA journal_mode = WAL;');

  const rows = db.prepare(`
    SELECT id, status, payload, normalized_url
    FROM applications
    WHERE status IN ('failed', 'paused_for_review')
  `).all() as Array<{ id: string; status: string; payload: string; normalized_url: string }>;

  const idsToRequeue: string[] = [];
  const urlsToRequeue: string[] = [];
  const providerBreakdown = {
    greenhouse: 0,
    ashby: 0,
    lever: 0,
    smartrecruiters: 0,
    workday: 0,
    other: 0,
  };

  for (const r of rows) {
    try {
      const p = JSON.parse(r.payload);
      const url = p.jobUrl || p.url || r.normalized_url || '';
      const title = p.title || '';
      const company = p.company || '';

      if (!isSupportedDirectAtsJobUrl(url)) continue;
      if (isStrictlyIsolatedTenant(company, url)) continue;
      const titleCheck = isEligibleEngineeringRoleTitle(title);
      if (!titleCheck.eligible) continue;

      idsToRequeue.push(r.id);
      urlsToRequeue.push(url);

      const u = url.toLowerCase();
      if (u.includes('greenhouse.io')) providerBreakdown.greenhouse++;
      else if (u.includes('ashbyhq.com')) providerBreakdown.ashby++;
      else if (u.includes('lever.co')) providerBreakdown.lever++;
      else if (u.includes('myworkdayjobs.com')) providerBreakdown.workday++;
      else if (u.includes('smartrecruiters.com')) providerBreakdown.smartrecruiters++;
      else providerBreakdown.other++;
    } catch {}
  }

  if (idsToRequeue.length > 0) {
    const updateStmt = db.prepare(`
      UPDATE applications
      SET status = 'queued',
          payload = json_set(payload, '$.status', 'queued', '$.retryCount', 0, '$.error', null, '$.failureReason', null)
      WHERE id = ?
    `);

    db.exec('BEGIN TRANSACTION;');
    try {
      for (const id of idsToRequeue) {
        updateStmt.run(id);
      }
      db.exec('COMMIT;');
    } catch (e) {
      db.exec('ROLLBACK;');
      throw e;
    }

    // Clear from attempted registry
    for (let i = 0; i < idsToRequeue.length; i++) {
      removeAttemptedJob(idsToRequeue[i]!, urlsToRequeue[i]!);
    }
  }

  // Count total and per-provider queued
  const countQueued = (pattern: string) => {
    const row = db.prepare(`SELECT count(*) as c FROM applications WHERE status = 'queued' AND normalized_url LIKE ?`).get(`%${pattern}%`) as any;
    return row ? row.c : 0;
  };

  const queuedBreakdown = {
    greenhouse: countQueued('greenhouse.io'),
    ashby: countQueued('ashbyhq.com'),
    lever: countQueued('lever.co'),
    smartrecruiters: countQueued('smartrecruiters.com'),
    workday: countQueued('myworkdayjobs.com'),
  };

  const totalQueuedRow = db.prepare(`SELECT count(*) as c FROM applications WHERE status = 'queued'`).get() as any;
  const totalQueued = totalQueuedRow ? totalQueuedRow.c : 0;

  db.close();
  return {
    recoveredCount: idsToRequeue.length,
    providerBreakdown,
    totalQueued,
    queuedBreakdown,
  };
}

if (process.argv[1] && (process.argv[1].endsWith('recover-gen100-103-jobs.ts') || process.argv[1].endsWith('recover-gen100-103-jobs.js'))) {
  console.log('--- EXECUTING TICKET GEN-102 DATABASE RECOVERY ---');
  const res = executeFullDatabaseRecovery();
  console.log(`[GEN-102] Successfully recovered ${res.recoveredCount} jobs back to 'queued'!`);
  console.log('[GEN-102] Recovered by Provider:', JSON.stringify(res.providerBreakdown, null, 2));
  console.log(`[GEN-102] Total Queued Jobs in DB: ${res.totalQueued}`);
  console.log('[GEN-102] Replenished Queue by Provider:', JSON.stringify(res.queuedBreakdown, null, 2));
}
