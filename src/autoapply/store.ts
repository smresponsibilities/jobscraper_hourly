import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AutoaplyJobItem } from './types.js';
import { canonicalRequisition } from './identity.js';

/** SQLite owns durable state. Legacy JSON is imported once and retained unchanged. */
export class ApplicationStore {
  readonly filename: string;
  private db: DatabaseSync;
  private owner = randomUUID();
  private heartbeat: ReturnType<typeof setInterval>;

  constructor(statePath: string, private candidateId: string) {
    this.filename = /\.json$/i.test(statePath) ? statePath.replace(/\.json$/i, '.sqlite') : statePath;
    mkdirSync(path.dirname(this.filename), { recursive: true });
    this.db = new DatabaseSync(this.filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA temp_store=MEMORY; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workers(owner TEXT PRIMARY KEY,pid INTEGER NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS submission_attempts(candidate_id TEXT NOT NULL,day TEXT NOT NULL,attempt_id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS tenant_attempts(candidate_id TEXT NOT NULL,tenant_hash TEXT NOT NULL,occurred_at INTEGER NOT NULL,attempt_id TEXT PRIMARY KEY);
      CREATE INDEX IF NOT EXISTS tenant_attempts_window ON tenant_attempts(candidate_id,tenant_hash,occurred_at);
      CREATE TABLE IF NOT EXISTS tenant_cooldowns(candidate_id TEXT NOT NULL,tenant_hash TEXT NOT NULL,until_ms INTEGER NOT NULL,PRIMARY KEY(candidate_id,tenant_hash));
      CREATE TABLE IF NOT EXISTS application_events(candidate_id TEXT NOT NULL,job_id TEXT NOT NULL,timestamp TEXT NOT NULL,phase TEXT NOT NULL,reason_code TEXT,step_index INTEGER);
      CREATE INDEX IF NOT EXISTS application_event_job ON application_events(candidate_id,job_id,timestamp);
      CREATE TABLE IF NOT EXISTS applications(
        candidate_id TEXT NOT NULL,id TEXT NOT NULL,canonical_key TEXT,normalized_url TEXT NOT NULL,
        status TEXT NOT NULL,payload TEXT NOT NULL,owner TEXT,expires INTEGER,
        PRIMARY KEY(candidate_id,id),UNIQUE(candidate_id,canonical_key),UNIQUE(candidate_id,normalized_url));
      CREATE INDEX IF NOT EXISTS application_status ON applications(candidate_id,status);`);
    try {
      this.transaction(() => {
        const bound = this.db.prepare('SELECT value FROM metadata WHERE key=?').get('candidate') as { value: string } | undefined;
        if (bound && bound.value !== candidateId) throw new Error('Queue belongs to a different candidate');
        if (!bound) {
          this.db.prepare('INSERT INTO metadata VALUES(?,?)').run('candidate', candidateId);
          if (this.filename !== statePath && existsSync(statePath)) {
            const snapshot = JSON.parse(readFileSync(statePath, 'utf8'));
            if ((snapshot.candidateId || 'default') !== candidateId) throw new Error('Queue belongs to a different candidate');
            if (snapshot.version !== 1 || !Array.isArray(snapshot.jobs)) throw new Error('Invalid queue snapshot');
            for (const job of snapshot.jobs) {
              if (!job || typeof job.id !== 'string' || typeof job.jobUrl !== 'string' || !['queued', 'applying', 'applied', 'skipped', 'failed', 'paused_for_review'].includes(job.status)) throw new Error('Invalid saved queue job');
              if (job.status === 'applying') { job.status = 'paused_for_review'; job.error = 'Interrupted legacy run; check employer receipt before retry'; }
              job.canonicalKey ||= canonicalRequisition(job.jobUrl, job.externalJobId)?.key;
              this.insert(job, new URL(job.jobUrl).href);
            }
            if (typeof snapshot.remainingCredits === 'number') this.setMetadata('remainingCredits', snapshot.remainingCredits);
          }
          this.db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('schema', '1');
        }
        if (!this.db.prepare('SELECT value FROM metadata WHERE key=?').get('submission_budget_initialized')) {
          const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
          const rows = this.db.prepare('SELECT id,payload FROM applications WHERE candidate_id=? AND status=?').all(candidateId, 'applied') as Array<{ id: string; payload: string }>;
          for (const row of rows) {
            const job = JSON.parse(row.payload) as AutoaplyJobItem;
            const timestamp = Date.parse(job.appliedAt || '');
            if (Number.isFinite(timestamp)) this.db.prepare('INSERT OR IGNORE INTO submission_attempts VALUES(?,?,?)').run(candidateId, formatter.format(new Date(timestamp)), `legacy:${row.id}`);
          }
          this.db.prepare('INSERT INTO metadata VALUES(?,?)').run('submission_budget_initialized', '1');
        }
        if (!this.db.prepare('SELECT value FROM metadata WHERE key=?').get('experience_recheck_initialized')) {
          const rows = this.db.prepare('SELECT id,payload FROM applications WHERE candidate_id=? AND status=?').all(candidateId, 'skipped') as Array<{ id: string; payload: string }>;
          for (const row of rows) {
            const job = JSON.parse(row.payload) as AutoaplyJobItem;
            if (job.error !== 'ineligible_jd_experience' || job.receipt) continue;
            job.error = 'experience_recheck_pending';
            this.db.prepare('UPDATE applications SET payload=? WHERE candidate_id=? AND id=? AND status=?').run(JSON.stringify(job), candidateId, row.id, 'skipped');
            this.recordEvent(row.id, 'experience_recheck_pending');
          }
          this.db.prepare('INSERT INTO metadata VALUES(?,?)').run('experience_recheck_initialized', '1');
        }
      });
      this.recover();
      this.db.prepare('INSERT INTO workers VALUES(?,?,?)').run(this.owner, process.pid, Date.now() + 120000);
    } catch (error) { this.db.close(); throw error; }
    this.heartbeat = setInterval(() => {
      try {
        this.transaction(() => {
          this.db.prepare('UPDATE workers SET expires=? WHERE owner=?').run(Date.now() + 120000, this.owner);
          this.db.prepare('UPDATE applications SET expires=? WHERE owner=? AND status=?').run(Date.now() + 120000, this.owner, 'applying');
        });
      } catch { /* Existing leases expire conservatively if storage is unavailable. */ }
    }, 15000);
    this.heartbeat.unref();
  }

  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  private recover(): void {
    this.transaction(() => {
      const workers = this.db.prepare('SELECT owner,pid,expires FROM workers').all() as Array<{ owner: string; pid: number; expires: number }>;
      for (const worker of workers) {
        // A sleeping or blocked process can outlive its heartbeat and resume a
        // submission. Never transfer its claim while that process may be alive.
        let alive = true;
        try { process.kill(worker.pid, 0); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false; }
        if (!alive) {
          this.db.prepare('UPDATE applications SET status=?,owner=NULL,expires=NULL WHERE owner=? AND status=?').run('paused_for_review', worker.owner, 'applying');
          this.db.prepare('DELETE FROM workers WHERE owner=?').run(worker.owner);
        }
      }
      this.db.prepare('UPDATE applications SET status=?,owner=NULL,expires=NULL WHERE status=? AND expires<? AND (owner IS NULL OR owner NOT IN (SELECT owner FROM workers))').run('paused_for_review', 'applying', Date.now());
    });
  }

  list(): AutoaplyJobItem[] {
    this.recover();
    return (this.db.prepare('SELECT payload,status,canonical_key FROM applications WHERE candidate_id=? ORDER BY rowid').all(this.candidateId) as Array<{ payload: string; status: AutoaplyJobItem['status']; canonical_key: string | null }>).map(row => ({ ...JSON.parse(row.payload), status: row.status, canonicalKey: row.canonical_key || undefined }));
  }

  acquireWorkerLock(): boolean {
    return this.transaction(() => {
      const lock = this.db.prepare('SELECT value FROM metadata WHERE key=?').get('active_worker_owner') as { value: string } | undefined;
      if (lock && lock.value !== this.owner && this.db.prepare('SELECT 1 FROM workers WHERE owner=?').get(lock.value)) return false;
      this.db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('active_worker_owner', this.owner);
      return true;
    });
  }

  insert(job: AutoaplyJobItem, normalizedUrl: string): AutoaplyJobItem {
    const inserted = this.db.prepare('INSERT OR IGNORE INTO applications(candidate_id,id,canonical_key,normalized_url,status,payload) VALUES(?,?,?,?,?,?)').run(this.candidateId, job.id, job.canonicalKey || null, normalizedUrl, job.status, JSON.stringify(job));
    if (inserted.changes) this.recordEvent(job.id, 'queued');
    const row = this.db.prepare('SELECT payload,status,canonical_key FROM applications WHERE candidate_id=? AND (id=? OR normalized_url=? OR canonical_key=?) LIMIT 1').get(this.candidateId, job.id, normalizedUrl, job.canonicalKey || null) as { payload: string; status: AutoaplyJobItem['status']; canonical_key: string | null } | undefined;
    if (!row) throw new Error('Queue insert did not produce a stored application');
    return { ...JSON.parse(row.payload), status: row.status, canonicalKey: row.canonical_key || undefined };
  }

  save(job: AutoaplyJobItem): void {
    this.transaction(() => {
      const previous = this.db.prepare('SELECT status,payload FROM applications WHERE candidate_id=? AND id=?').get(this.candidateId, job.id) as { status: string; payload: string } | undefined;
      this.db.prepare('UPDATE applications SET canonical_key=?,status=?,payload=?,owner=CASE WHEN ?=? THEN owner ELSE NULL END,expires=CASE WHEN ?=? THEN expires ELSE NULL END WHERE candidate_id=? AND id=?').run(job.canonicalKey || null, job.status, JSON.stringify(job), job.status, 'applying', job.status, 'applying', this.candidateId, job.id);
      if (previous && (previous.status !== job.status || JSON.parse(previous.payload).reasonCode !== job.reasonCode)) this.recordEvent(job.id, job.status, job.reasonCode);
    });
  }

  recordFitProbe(id: string, checkedAt: string, description?: string, skipReason?: string): boolean {
    return this.transaction(() => {
      if (skipReason) {
        const code = /closed/i.test(skipReason) ? 'SKIPPED_CLOSED' : skipReason === 'ineligible_jd_experience' ? 'SKIPPED_YOE' : 'UNKNOWN';
        const result = this.db.prepare(`UPDATE applications SET status='skipped', payload=json_set(payload, '$.status', 'skipped', '$.fitCheckedAt', ?, '$.error', ?, '$.reasonCode', ?) WHERE candidate_id=? AND id=? AND status='queued' AND COALESCE(TRIM(json_extract(payload, '$.description')), '')=''`).run(checkedAt, skipReason, code, this.candidateId, id);
        if (result.changes) this.recordEvent(id, 'skipped', code);
        return result.changes === 1;
      }
      return this.db.prepare(`UPDATE applications SET payload=json_set(payload, '$.fitCheckedAt', ?, '$.description', COALESCE(?, json_extract(payload, '$.description'))) WHERE candidate_id=? AND id=? AND status='queued' AND COALESCE(TRIM(json_extract(payload, '$.description')), '')=''`).run(checkedAt, description?.trim() || null, this.candidateId, id).changes === 1;
    });
  }

  claim(id: string): boolean {
    return this.transaction(() => {
      const result = this.db.prepare('UPDATE applications SET status=?,owner=?,expires=? WHERE candidate_id=? AND id=? AND status=?').run('applying', this.owner, Date.now() + 120000, this.candidateId, id, 'queued');
      if (result.changes === 1) this.recordEvent(id, 'claimed');
      return result.changes === 1;
    });
  }

  recordEvent(jobId: string, phase: string, reasonCode?: AutoaplyJobItem['reasonCode'], stepIndex?: number): void {
    this.db.prepare('INSERT INTO application_events VALUES(?,?,?,?,?,?)').run(this.candidateId, jobId, new Date().toISOString(), phase, reasonCode || null, stepIndex ?? null);
  }

  submissionClickAt(jobId: string): string | undefined {
    return (this.db.prepare("SELECT timestamp FROM application_events WHERE candidate_id=? AND job_id=? AND phase IN ('submit_clicked','submit_dispatched','submit_confirmed') ORDER BY rowid LIMIT 1").get(this.candidateId, jobId) as { timestamp: string } | undefined)?.timestamp;
  }

  submissionCount(day: string): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS count FROM submission_attempts WHERE candidate_id=? AND day=?').get(this.candidateId, day) as { count: number }).count);
  }

  reserveSubmission(day: string, limit: number): boolean {
    return this.transaction(() => {
      if (this.submissionCount(day) >= limit) return false;
      this.db.prepare('INSERT INTO submission_attempts VALUES(?,?,?)').run(this.candidateId, day, randomUUID());
      return true;
    });
  }

  tenantSubmissionCount(tenantHash: string, since: number): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS count FROM tenant_attempts WHERE candidate_id=? AND tenant_hash=? AND occurred_at>?').get(this.candidateId, tenantHash, since) as { count: number }).count);
  }

  limitedTenants(since: number, limit: number): Set<string> {
    const rows = this.db.prepare('SELECT tenant_hash FROM tenant_attempts WHERE candidate_id=? AND occurred_at>? GROUP BY tenant_hash HAVING COUNT(*)>=?').all(this.candidateId, since, limit) as Array<{ tenant_hash: string }>;
    return new Set(rows.map(row => row.tenant_hash));
  }

  coolTenant(tenantHash: string, until: number): void {
    this.db.prepare('INSERT INTO tenant_cooldowns VALUES(?,?,?) ON CONFLICT(candidate_id,tenant_hash) DO UPDATE SET until_ms=MAX(until_ms,excluded.until_ms)').run(this.candidateId, tenantHash, until);
  }

  coolingTenants(now: number): Set<string> {
    return new Set((this.db.prepare('SELECT tenant_hash FROM tenant_cooldowns WHERE candidate_id=? AND until_ms>?').all(this.candidateId, now) as Array<{ tenant_hash: string }>).map(row => row.tenant_hash));
  }

  reserveTenantSubmission(day: string, dailyLimit: number, tenantHash: string, now: number, tenantLimit: number): 'ok' | 'daily' | 'tenant' {
    return this.transaction(() => {
      if (this.submissionCount(day) >= dailyLimit) return 'daily';
      if (this.tenantSubmissionCount(tenantHash, now - 3600000) >= tenantLimit) return 'tenant';
      const attemptId = randomUUID();
      this.db.prepare('INSERT INTO submission_attempts VALUES(?,?,?)').run(this.candidateId, day, attemptId);
      this.db.prepare('INSERT INTO tenant_attempts VALUES(?,?,?,?)').run(this.candidateId, tenantHash, now, attemptId);
      return 'ok';
    });
  }

  getMetadata(key: string): number | undefined {
    const row = this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key) as { value: string } | undefined;
    return row ? Number(row.value) : undefined;
  }

  getLastProvider(): string | undefined {
    return (this.db.prepare('SELECT value FROM metadata WHERE key=?').get('last_provider') as { value: string } | undefined)?.value;
  }

  setLastProvider(provider: string): void {
    this.db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('last_provider', provider);
  }

  setMetadata(key: string, value: number): void {
    this.db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run(key, String(value));
  }

  close(): void {
    clearInterval(this.heartbeat);
    this.transaction(() => {
      this.db.prepare('UPDATE applications SET status=?,owner=NULL,expires=NULL WHERE owner=? AND status=?').run('paused_for_review', this.owner, 'applying');
      this.db.prepare('DELETE FROM metadata WHERE key=? AND value=?').run('active_worker_owner', this.owner);
      this.db.prepare('DELETE FROM workers WHERE owner=?').run(this.owner);
    });
    this.db.close();
  }
}
