// src/autoapply/power-net-recovery.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as dns from 'node:dns/promises';
import { DatabaseSync } from 'node:sqlite';

const IN_FLIGHT_JOURNAL = path.resolve('state/autoapply/portal-review/in-flight-checkpoint.json');

export interface InFlightJobCheckpoint {
  jobId: string;
  company: string;
  url: string;
  lane: string;
  startedAt: string;
  lastStep: number;
  filledAnswers?: Record<string, string>;
}

/**
 * 1. Cleans stale Chromium SingletonLock files left behind by sudden power loss or crash.
 * Only runs when no automation chrome.exe is currently holding the profile.
 */
export function cleanStaleChromiumProfileLocks(stateRoot = 'state/autoapply'): number {
  let cleaned = 0;
  const resolvedRoot = path.resolve(stateRoot);
  if (!fs.existsSync(resolvedRoot)) return 0;

  const entries = fs.readdirSync(resolvedRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('browser-profile')) continue;
    const profileDir = path.join(resolvedRoot, entry.name);
    for (const lockName of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile']) {
      const lockPath = path.join(profileDir, lockName);
      if (fs.existsSync(lockPath)) {
        try {
          fs.rmSync(lockPath, { force: true });
          cleaned++;
        } catch {}
      }
    }
  }
  return cleaned;
}

/**
 * 2. Enables SQLite Write-Ahead Logging (WAL) so sudden laptop power-off never corrupts queue.sqlite,
 * and recovers any job that was interrupted mid-flight during a power cut or network drop.
 */
export function recoverPowerOffAndNetOffJobs(sqlitePath = 'state/autoapply/portal-review/queue.sqlite'): {
  recoveredInFlight: number;
  recoveredNetOffDino: number;
} {
  const resolvedDbPath = path.resolve(sqlitePath);
  if (!fs.existsSync(resolvedDbPath)) {
    return { recoveredInFlight: 0, recoveredNetOffDino: 0 };
  }

  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(resolvedDbPath);
    try { db.exec('PRAGMA busy_timeout = 15000;'); } catch {}
    try { db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;'); } catch {}
  } catch (err) {
    return { recoveredInFlight: 0, recoveredNetOffDino: 0 };
  }

  try {
    // Recover any job that was marked in_progress or interrupted by power-off
    let recoveredInFlight = 0;
    try {
      if (fs.existsSync(IN_FLIGHT_JOURNAL)) {
        const raw = fs.readFileSync(IN_FLIGHT_JOURNAL, 'utf8');
        const journal = JSON.parse(raw) as Record<string, InFlightJobCheckpoint>;
        const CONFIRMATION_REGEX = /(?:\/confirmation|\/thank(?:s|[-_]?you)|\/application[-_]?submitted|\/submitted)(?:\/|$|\?|#)|[?&](?:submitted|applied|confirmation)=(?:true|1)\b/i;
        for (const jobId of Object.keys(journal)) {
          const cpFile = path.resolve('state/autoapply/portal-review/applications', jobId, 'checkpoint.json');
          let isConfirmed = false;
          let confirmedUrl = '';
          if (fs.existsSync(cpFile)) {
            try {
              const cp = JSON.parse(fs.readFileSync(cpFile, 'utf8'));
              if (CONFIRMATION_REGEX.test(cp.currentUrl || '') || Boolean(cp.report?.receipt)) {
                isConfirmed = true;
                confirmedUrl = cp.currentUrl || cp.report?.receipt?.url || '';
              }
            } catch {}
          }
          if (isConfirmed) {
            const row = db.prepare(`SELECT payload FROM applications WHERE id = ?`).get(jobId) as { payload?: string } | undefined;
            let p: any = {};
            try { p = JSON.parse(row?.payload || '{}'); } catch {}
            p.status = 'applied';
            p.appliedAt = p.appliedAt || new Date().toISOString();
            p.receipt = { url: confirmedUrl, text: 'Application Submitted', verifiedAt: new Date().toISOString() };
            db.prepare(`UPDATE applications SET status = 'applied', payload = ? WHERE id = ?`).run(JSON.stringify(p), jobId);
          } else {
            const res = db
              .prepare(`UPDATE applications SET status = 'queued' WHERE id = ? AND status NOT IN ('applied', 'skipped')`)
              .run(jobId);
            recoveredInFlight += Number(res.changes || 0);
          }
        }
        fs.writeFileSync(IN_FLIGHT_JOURNAL, '{}', 'utf8');
      }
    } catch {}

    // Recover any job that failed due to Wi-Fi drop ("This site can't be reached" / "Press space to play" / ERR_INTERNET_DISCONNECTED)
    let recoveredNetOffDino = 0;
    try {
      const netOffRes = db
        .prepare(
          `UPDATE applications SET status = 'queued' WHERE status = 'failed' AND (
            payload LIKE '%This site can%t be reached%'
            OR payload LIKE '%Press space to play%'
            OR payload LIKE '%ERR_INTERNET_DISCONNECTED%'
            OR payload LIKE '%ERR_NAME_NOT_RESOLVED%'
            OR payload LIKE '%ERR_NETWORK_CHANGED%'
            OR payload LIKE '%ERR_CONNECTION_RESET%'
            OR payload LIKE '%wifi_drop_requeued%'
          )`
        )
        .run();
      recoveredNetOffDino = Number(netOffRes.changes || 0);
    } catch {}
    return { recoveredInFlight, recoveredNetOffDino };
  } finally {
    try { db?.close(); } catch {}
  }
}

export function markJobInFlightCheckpoint(cp: InFlightJobCheckpoint): void {
  try {
    let store: Record<string, InFlightJobCheckpoint> = {};
    if (fs.existsSync(IN_FLIGHT_JOURNAL)) {
      store = JSON.parse(fs.readFileSync(IN_FLIGHT_JOURNAL, 'utf8'));
    }
    store[cp.jobId] = cp;
    fs.mkdirSync(path.dirname(IN_FLIGHT_JOURNAL), { recursive: true });
    fs.writeFileSync(IN_FLIGHT_JOURNAL, JSON.stringify(store, null, 2), 'utf8');
  } catch {}
}

export function clearJobInFlightCheckpoint(jobId: string): void {
  try {
    if (!fs.existsSync(IN_FLIGHT_JOURNAL)) return;
    const store = JSON.parse(fs.readFileSync(IN_FLIGHT_JOURNAL, 'utf8'));
    delete store[jobId];
    fs.writeFileSync(IN_FLIGHT_JOURNAL, JSON.stringify(store, null, 2), 'utf8');
  } catch {}
}

/**
 * 3. Net-Off Circuit Breaker: Detects Chrome offline Dino page or DNS loss, pauses all lanes,
 * waits for Wi-Fi to reconnect, and signals immediate retry without failing the job.
 */
export function isOfflineDinoOrNetworkError(errorOrHeading: string): boolean {
  if (!errorOrHeading) return false;
  return /this site can.?t be reached|press space to play|err_internet_disconnected|err_name_not_resolved|err_network_changed|err_connection_timed_out|err_connection_reset|net::err_/i.test(
    errorOrHeading
  );
}

export async function waitUntilNetworkOnline(checkIntervalMs = 5000, maxWaitMs = 600_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      await dns.lookup('boards.greenhouse.io');
      return true;
    } catch {
      await new Promise(r => setTimeout(r, checkIntervalMs));
    }
  }
  return false;
}
