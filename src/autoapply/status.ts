import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

type WorkerSnapshot = { pid?: number; startedAt?: string; processStartedAt?: string; heartbeatAt?: string; observedAt?: string; status?: string; mailboxStatus?: string; mailboxCheckedAt?: string };
const codes = new Set(['SUBMITTED_VERIFIED', 'SKIPPED_CLOSED', 'SKIPPED_YOE', 'PARKED_MISSING_FACT', 'PARKED_CAPTCHA', 'PARKED_AUTH', 'AMBIGUOUS_DISPATCH', 'TRANSIENT_RETRY', 'UNKNOWN']);
const phases = new Set(['queued', 'claimed', 'applying', 'paused_for_review', 'applied', 'skipped', 'failed', 'experience_recheck_pending', 'step', 'submit_prepared', 'submit_clicked', 'submit_dispatched', 'submit_confirmed']);
const statusesAllowed = new Set(['queued', 'applying', 'paused_for_review', 'applied', 'skipped', 'failed']);
const safeCode = (value: unknown) => typeof value === 'string' && codes.has(value) ? value : 'UNKNOWN';
const safeCount = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const safeTime = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
const mailboxStates = new Set(['not_configured', 'unchecked', 'ok', 'error']);
function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}
function counts(value: unknown, keys: readonly string[]): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(keys.flatMap(key => {
    const count = safeCount((value as Record<string, unknown>)[key]);
    return count === undefined ? [] : [[key, count]];
  }));
}

/** An inaccessible PID or missing process-start timestamp cannot establish liveness. */
export function workerLiveness(state: WorkerSnapshot, now = Date.now(), processStart = windowsProcessStart): 'running' | 'stopped' | 'crashed' | 'unresponsive' | 'unknown' {
  if (['stopped', 'acceptance_complete'].includes(state.status || '')) return 'stopped';
  if (!Number.isSafeInteger(state.pid) || state.pid! < 1) return 'unknown';
  try { process.kill(state.pid!, 0); }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'crashed' : 'unknown'; }
  const recorded = Date.parse(state.processStartedAt || '');
  if (!Number.isFinite(recorded)) return 'unknown';
  const actual = processStart(state.pid!);
  if (actual === undefined) return 'unknown';
  if (Math.abs(actual - recorded) > 5000) return 'crashed';
  const heartbeat = Date.parse(state.heartbeatAt || state.observedAt || '');
  if (!Number.isFinite(heartbeat) || heartbeat - now > 5000) return 'unknown';
  return now - heartbeat > 45000 ? 'unresponsive' : 'running';
}

function windowsProcessStart(pid: number): number | undefined {
  if (process.platform !== 'win32') return undefined;
  try {
    const command = `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`;
    const value = Date.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim());
    return Number.isFinite(value) ? value : undefined;
  } catch { return undefined; }
}

/** Read-only summary. Raw payloads, values, URLs, errors and candidate data stay private. */
export function readApplicationStatus(stateDir: string, jobId?: string): object {
  const workerFile = path.join(stateDir, 'worker.json');
  const worker: WorkerSnapshot = existsSync(workerFile) ? parseRecord(readFileSync(workerFile, 'utf8')) : {};
  const filename = path.join(stateDir, 'queue.sqlite');
  if (!existsSync(filename)) return { worker: workerLiveness(worker), queue: 'missing' };
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    const rows = db.prepare('SELECT id,status,payload FROM applications').all() as Array<{ id: string; status: string; payload: string }>;
    if (jobId) {
      const row = rows.find(entry => entry.id === jobId);
      if (!row) return { jobId, found: false };
      const job = parseRecord(row.payload);
      const hasEvents = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='application_events'").get();
      const storedEvents = hasEvents ? db.prepare('SELECT timestamp,phase,reason_code,step_index FROM application_events WHERE job_id=? ORDER BY rowid').all(jobId) : [];
      const events = storedEvents.map(event => ({ timestamp: typeof event.timestamp === 'string' && Number.isFinite(Date.parse(event.timestamp)) ? event.timestamp : undefined, phase: typeof event.phase === 'string' && phases.has(event.phase) ? event.phase : 'unknown', reasonCode: safeCode(event.reason_code), stepIndex: typeof event.step_index === 'number' && Number.isSafeInteger(event.step_index) ? event.step_index : undefined }));
      const code = safeCode(job.reasonCode);
      const nextAction = code === 'AMBIGUOUS_DISPATCH' ? 'Reconcile the employer receipt before retrying.' : code === 'PARKED_CAPTCHA' ? 'Complete the employer challenge.' : code === 'PARKED_AUTH' ? 'Review sign-in or verification.' : code === 'PARKED_MISSING_FACT' ? 'Review the required field.' : row.status === 'queued' ? 'Await the next eligible worker run.' : row.status === 'applied' ? 'No further submission action.' : 'Inspect the saved review.';
      return { jobId, found: true, status: statusesAllowed.has(row.status) ? row.status : 'unknown', reasonCode: code, nextAction, events };
    }
    const statuses: Record<string, number> = {};
    const reasons: Record<string, number> = {};
    for (const row of rows) {
      const status = statusesAllowed.has(row.status) ? row.status : 'unknown';
      statuses[status] = (statuses[status] || 0) + 1;
      const code = safeCode(parseRecord(row.payload).reasonCode);
      reasons[code] = (reasons[code] || 0) + 1;
    }
    const acceptanceFile = path.join(stateDir, 'production-acceptance.json');
    const acceptance = existsSync(acceptanceFile) ? parseRecord(readFileSync(acceptanceFile, 'utf8')) : undefined;
    const intakeFile = path.join(stateDir, 'intake-history.jsonl');
    // A crash can leave one partial append. Retain the latest complete history record.
    const intake = existsSync(intakeFile) ? readFileSync(intakeFile, 'utf8').trim().split('\n').reverse().map(parseRecord).find(record => safeTime(record.observedAt)) : undefined;
    return { worker: workerLiveness(worker), heartbeatAt: safeTime(worker.heartbeatAt || worker.observedAt), mailbox: mailboxStates.has(worker.mailboxStatus || '') ? { status: worker.mailboxStatus, checkedAt: safeTime(worker.mailboxCheckedAt) } : undefined, statuses, reasons, acceptance: acceptance ? { auditedAt: safeTime(acceptance.auditedAt), verifiedCount: safeCount(acceptance.verifiedCount), target: safeCount(acceptance.target), byProvider: counts(acceptance.byProvider, ['workday', 'greenhouse', 'lever', 'ashby']) } : undefined, intake: intake ? { observedAt: safeTime(intake.observedAt), totals: { ...counts(intake.totals, ['imported', 'skipped', 'retry']), fetched: !!(intake.totals && typeof intake.totals === 'object' && (intake.totals as Record<string, unknown>).fetched === true) } } : undefined };
  } finally { db.close(); }
}
