export { recoverStaleInProgressJobs } from './stale-recovery.js';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { identifyApplicationAts } from './wizard.js';

export interface SqliteMaintenanceResult {
  integrityOk: boolean;
  walCheckpointed: boolean;
  backupPath: string;
  backupCreated: boolean;
  appliedCount: number;
  unknownProviderCount: number;
  backupError?: string;
}

/** Snapshot the existing queue without modifying application records. */
export function runSqliteMaintenanceAndBackup(dbPath = path.resolve('state/autoapply/portal-review/queue.sqlite')): SqliteMaintenanceResult {
  const source = path.resolve(dbPath);
  const backupPath = path.join(path.dirname(source), 'queue.backup.sqlite');
  if (source.toLowerCase() === backupPath.toLowerCase()) throw new Error('Queue and backup paths must differ');
  if (!existsSync(source)) throw new Error('Queue database does not exist');
  const temp = `${backupPath}.${randomUUID()}.tmp`;
  const result: SqliteMaintenanceResult = { integrityOk: false, walCheckpointed: false, backupPath, backupCreated: false, appliedCount: 0, unknownProviderCount: 0 };
  const db = new DatabaseSync(source);
  try {
    db.exec('PRAGMA busy_timeout=5000');
    const checks = db.prepare('PRAGMA quick_check').all() as Array<{ quick_check: string }>;
    result.integrityOk = checks.length > 0 && checks.every(row => row.quick_check === 'ok');
    if (!result.integrityOk) return result;
    const checkpoint = db.prepare('PRAGMA wal_checkpoint(PASSIVE)').get() as { busy: number; log: number; checkpointed: number } | undefined;
    result.walCheckpointed = !!checkpoint && checkpoint.busy === 0 && (checkpoint.log < 0 || checkpoint.log === checkpoint.checkpointed);
    db.exec('PRAGMA optimize');
    const counts = db.prepare("SELECT count(*) AS count FROM applications WHERE status='applied'").get() as { count: number };
    result.appliedCount = Number(counts.count);
    const rows = db.prepare('SELECT normalized_url FROM applications').all() as Array<{ normalized_url: string }>;
    result.unknownProviderCount = rows.filter(row => {
      try { return ['unknown', 'generic'].includes(identifyApplicationAts(row.normalized_url || '')); }
      catch { return true; }
    }).length;
    try {
      db.prepare('VACUUM INTO ?').run(temp);
      chmodSync(temp, 0o600);
      // A failed snapshot never replaces the previous verified backup.
      const snapshot = new DatabaseSync(temp, { readOnly: true });
      try {
        const verify = snapshot.prepare('PRAGMA quick_check').all() as Array<{ quick_check: string }>;
        if (!verify.length || !verify.every(row => row.quick_check === 'ok')) throw new Error('Snapshot integrity check failed');
      } finally { snapshot.close(); }
      renameSync(temp, backupPath);
      result.backupCreated = true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'SQLITE_BUSY' || /database is locked|database is busy/i.test(String(error))) result.backupError = 'SQLITE_BUSY';
      else throw error;
    }
    return result;
  } finally {
    db.close();
    try { unlinkSync(temp); } catch { /* No temporary snapshot remains. */ }
  }
}
