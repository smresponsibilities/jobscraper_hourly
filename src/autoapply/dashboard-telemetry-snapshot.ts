import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { verifyStoredEvidenceMerkleLedger } from './evidence-auditor.js';

export interface DashboardTelemetrySnapshot {
  timestamp: string;
  /** Raw queue status count; it does not prove employer receipts. */
  totalApplied: number;
  queuedByProvider: Record<string, number>;
  fastAtsQueuedTotal: number;
  merkleChainVerified: boolean;
  supervisorAlive: boolean;
  stopFlagPresent: boolean;
}

type Counts = Pick<DashboardTelemetrySnapshot, 'totalApplied' | 'queuedByProvider' | 'fastAtsQueuedTotal'>;
const cachedCounts = new Map<string, Counts>();
const fast = new Set(['greenhouse', 'ashby', 'lever', 'smartrecruiters', 'workable', 'recruitee', 'breezy']);

function provider(raw: string): string {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    if (host === 'greenhouse.io' || host.endsWith('.greenhouse.io')) return 'greenhouse';
    if (host === 'jobs.ashbyhq.com') return 'ashby';
    if (host === 'jobs.lever.co') return 'lever';
    if (host === 'smartrecruiters.com' || host.endsWith('.smartrecruiters.com')) return 'smartrecruiters';
    if (host === 'apply.workable.com') return 'workable';
    if (host.endsWith('.recruitee.com')) return 'recruitee';
    if (host.endsWith('.breezy.hr')) return 'breezy';
    if (host.endsWith('.myworkdayjobs.com')) return 'workday';
  } catch { /* Unparseable URLs are unknown. */ }
  return 'unknown';
}

export function buildLiveDashboardTelemetrySnapshot(options: { dbPath?: string; ledgerPath?: string; supervisorLockPath?: string; stopFlagPath?: string } = {}): DashboardTelemetrySnapshot {
  const dbPath = path.resolve(options.dbPath || 'state/autoapply/portal-review/queue.sqlite');
  const ledger = options.ledgerPath || path.resolve('state/autoapply/evidence/merkle-ledger.json');
  const lock = options.supervisorLockPath || path.resolve('state/autoapply/portal-review/supervisor.lock');
  const flags = options.stopFlagPath ? [options.stopFlagPath] : [path.resolve('STOP_AUTOAPPLY.flag'), path.resolve('state/autoapply/portal-review/STOP_AUTOAPPLY.flag')];
  if (!existsSync(dbPath)) throw new Error('Queue database unavailable');
  let counts: Counts;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 50');
    const totalApplied = Number((db.prepare("SELECT COUNT(*) AS count FROM applications WHERE status='applied'").get() as { count: number }).count);
    const rows = db.prepare("SELECT normalized_url FROM applications WHERE status='queued'").all() as Array<{ normalized_url: string }>;
    const queuedByProvider: Record<string, number> = Object.create(null);
    for (const row of rows) { const name = provider(row.normalized_url); queuedByProvider[name] = (queuedByProvider[name] || 0) + 1; }
    counts = { totalApplied, queuedByProvider, fastAtsQueuedTotal: Object.entries(queuedByProvider).filter(([key]) => fast.has(key)).reduce((sum, [, count]) => sum + count, 0) };
    cachedCounts.set(dbPath, counts);
  } catch (error) {
    const previous = cachedCounts.get(dbPath);
    if (!previous || !/database is (?:locked|busy)|SQLITE_BUSY/i.test(String(error))) throw error;
    counts = previous;
  } finally { db?.close(); }
  let supervisorAlive = false;
  try { const raw = readFileSync(lock, 'utf8').trim(); if (/^[1-9]\d*$/.test(raw)) { const pid = Number(raw); if (Number.isSafeInteger(pid)) { process.kill(pid, 0); supervisorAlive = true; } } } catch { /* Missing or unverifiable lock is not proof of a live supervisor. */ }
  return { timestamp: new Date().toISOString(), ...counts, merkleChainVerified: verifyStoredEvidenceMerkleLedger(ledger), supervisorAlive, stopFlagPresent: flags.some(flag => existsSync(flag)) };
}
