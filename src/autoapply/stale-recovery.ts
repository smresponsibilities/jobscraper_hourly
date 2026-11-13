import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isStrictlyIsolatedTenant } from './priority-scheduler.js';

/** Recover only checkpoints proving no submission or credential dispatch occurred. */
export function recoverStaleInProgressJobs(dbPath = path.resolve('state/autoapply/portal-review/queue.sqlite'), staleMinutes = 15, maxCrashRetries = 2, nowMs = Date.now()): { recoveredIds: string[]; quarantinedCrashLoopIds: string[] } {
  if (!existsSync(dbPath)) throw new Error('Queue database unavailable');
  if (!Number.isFinite(staleMinutes) || staleMinutes < 0 || !Number.isInteger(maxCrashRetries) || maxCrashRetries < 0 || !Number.isFinite(nowMs)) throw new Error('Invalid recovery parameters');
  const root = path.dirname(path.resolve(dbPath));
  const db = new DatabaseSync(dbPath);
  const recoveredIds: string[] = [], quarantinedCrashLoopIds: string[] = [];
  try {
    db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
    const rows = db.prepare("SELECT candidate_id, id, canonical_key, normalized_url, payload, owner FROM applications WHERE status='applying' AND expires < ?").all(nowMs - staleMinutes * 60_000) as Array<{ candidate_id: string; id: string; canonical_key: string | null; normalized_url: string; payload: string; owner: string | null }>;
    const journalPath = path.join(root, 'in-flight-checkpoint.json');
    let journal: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(readFileSync(journalPath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid in-flight journal');
      journal = parsed as Record<string, unknown>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    for (const row of rows) {
      if (!row.owner || Object.hasOwn(journal, row.id)) continue;
      const worker = db.prepare('SELECT pid FROM workers WHERE owner=?').get(row.owner) as { pid: number } | undefined;
      if (!worker || !Number.isSafeInteger(worker.pid) || worker.pid <= 0) continue;
      let dead = false;
      try { process.kill(worker.pid, 0); } catch (error) { dead = (error as NodeJS.ErrnoException).code === 'ESRCH'; }
      if (!dead) continue;
      let payload: Record<string, any>;
      try { payload = JSON.parse(row.payload); } catch { continue; }
      const url = typeof payload.jobUrl === 'string' ? payload.jobUrl : row.normalized_url;
      if (!url || isStrictlyIsolatedTenant(String(payload.company || ''), url) || payload.receipt) continue;
      const dispatched = db.prepare("SELECT 1 FROM application_events WHERE candidate_id=? AND job_id=? AND phase IN ('submit_clicked','submit_dispatched','submit_confirmed') LIMIT 1").get(row.candidate_id, row.id);
      if (dispatched) continue;
      const key = row.canonical_key || payload.canonicalKey || url;
      const session = createHash('sha256').update(key).digest('hex').slice(0, 20);
      let checkpoint: any;
      try { checkpoint = JSON.parse(readFileSync(path.join(root, 'applications', session, 'checkpoint.json'), 'utf8')); } catch { continue; }
      const report = checkpoint?.report;
      if (checkpoint.applicationUrl !== url || report?.recoveryGuardVersion !== 1 || report.submissionAttempted !== false || !Array.isArray(report.credentialAttempts) || report.credentialAttempts.length || report.submission || report.pendingFormRequests || report.automaticVerificationPending || report.humanInterventionRequired || report.receipt) continue;
      const oldCount = payload.crashRetryCount ?? 0;
      if (!Number.isInteger(oldCount) || oldCount < 0) continue;
      const count = oldCount + 1;
      const failed = count > maxCrashRetries;
      payload.crashRetryCount = count;
      payload.status = failed ? 'failed' : 'queued';
      if (failed) payload.error = 'CRASH_LOOP_GUARD_EXCEEDED';
      const result = db.prepare("UPDATE applications SET status=?, payload=?, owner=NULL, expires=NULL WHERE candidate_id=? AND id=? AND status='applying' AND owner=?").run(payload.status, JSON.stringify(payload), row.candidate_id, row.id, row.owner);
      if (result.changes === 1) {
        db.prepare('INSERT INTO application_events(candidate_id,job_id,timestamp,phase,reason_code,step_index) VALUES(?,?,?,?,?,?)').run(row.candidate_id, row.id, new Date(nowMs).toISOString(), failed ? 'failed' : 'queued', failed ? 'CRASH_LOOP_GUARD_EXCEEDED' : 'RECOVERED_PRE_DISPATCH', null);
        (failed ? quarantinedCrashLoopIds : recoveredIds).push(row.id);
      }
    }
    db.exec('COMMIT');
    return { recoveredIds, quarantinedCrashLoopIds };
  } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
  finally { db.close(); }
}
