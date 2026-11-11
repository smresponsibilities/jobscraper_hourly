// src/autoapply/health-and-ram-watchdog.ts
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readJobRunHistory } from './run-history.js';

export interface SystemRamAndHealthSnapshot {
  timestamp: string;
  totalRamGb: number;
  freeRamGb: number;
  usedRamPct: number;
  chromeProcessCount: number;
  chromeWorkingSetMb: number;
  recommendedLaneCount: number;
  zombiesReapedLastSweep: number;
  zombiesReapedTotal: number;
  healthStatus: 'OPTIMAL_SCALE_UP' | 'NORMAL' | 'THROTTLE_DOWN_LOW_RAM' | 'CRITICAL_RAM_RECOVERY';
}

export const ActiveBrowserRegistry = new Set<number>();
export const ActiveJobRegistry = new Set<string>();

/**
 * GEN-436: Returns true ONLY for chrome.exe processes that belong to our automation profiles.
 * Personal Chrome (--profile-directory="Default" or "Profile N") must NEVER be killed.
 */
export function isAutomationChromeCommandLine(cmdLine: string): boolean {
  if (!cmdLine) return false;
  return (
    /browser-profile-lane|state[\\/]autoapply|--enable-automation|playwright_chromiumdev_profile/i.test(cmdLine) &&
    !/--profile-directory(?:=|\s+)["']?(?:Default|Profile\s+\d+)(?:["']|\s|$)/i.test(cmdLine)
  );
}

export function registerActiveBrowserPid(pid: number): void {
  if (typeof pid === 'number' && pid > 0) {
    ActiveBrowserRegistry.add(pid);
  }
}

export function unregisterActiveBrowserPid(pid: number): void {
  ActiveBrowserRegistry.delete(pid);
}

export function identifyOrphanedChromePids(
  runningProcesses: Array<{ pid: number; ageSeconds: number }>,
  maxAgeSeconds = 180
): number[] {
  return runningProcesses
    .filter((p) => p.ageSeconds > maxAgeSeconds && !ActiveBrowserRegistry.has(p.pid))
    .map((p) => p.pid);
}

let totalZombiesReaped = 0;

export function hasJobsInFlight(): boolean {
  if (ActiveJobRegistry.size > 0) return true;
  try {
    const journalPath = path.resolve('state/autoapply/portal-review/in-flight-checkpoint.json');
    if (fs.existsSync(journalPath)) {
      const data = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
      if (typeof data === 'object' && data !== null && Object.keys(data).length > 0) {
        return true;
      }
    }
  } catch { return true; }
  return ActiveBrowserRegistry.size > 0;
}

/**
 * Queries Windows chrome.exe processes and kills any chrome.exe older than maxAgeSeconds not in ActiveBrowserRegistry.
 * Cleanup remains bounded to this worker and never overrides an active job.
 */
export interface ChromeProcessSnapshot {
  pid: number; parentPid: number; commandLine: string; ageSeconds: number; workingSetMb: number;
}

/** Only this worker's descendants can be reaped, never another worker's Chrome. */
export function selectOwnedChromeForReaping(processes: ChromeProcessSnapshot[], ownerPid: number, maxAgeSeconds: number): number[] {
  const descendants = new Set([ownerPid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const proc of processes) {
      if (descendants.has(proc.parentPid) && !descendants.has(proc.pid)) { descendants.add(proc.pid); changed = true; }
    }
  }
  const protectedPids = new Set(ActiveBrowserRegistry);
  for (let changed = true; changed;) {
    changed = false;
    for (const proc of processes) {
      if (protectedPids.has(proc.parentPid) && !protectedPids.has(proc.pid)) { protectedPids.add(proc.pid); changed = true; }
      if (protectedPids.has(proc.pid) && !protectedPids.has(proc.parentPid)) { protectedPids.add(proc.parentPid); changed = true; }
    }
  }
  return processes.filter(proc => descendants.has(proc.pid) && !protectedPids.has(proc.pid) &&
    isAutomationChromeCommandLine(proc.commandLine) && proc.ageSeconds > maxAgeSeconds).map(proc => proc.pid);
}

export function reapZombieChromeProcesses(maxAgeSeconds = 180, forceKillAll = false): {
  remainingChromeCount: number; chromeWorkingSetMb: number; reapedCount: number;
} {
  const empty = { remainingChromeCount: 0, chromeWorkingSetMb: 0, reapedCount: 0 };
  if (process.platform !== 'win32' || hasJobsInFlight()) return empty;
  try {
    const script = `$now = Get-Date; @(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | ForEach-Object { [pscustomobject]@{ pid=[int]$_.ProcessId; parentPid=[int]$_.ParentProcessId; commandLine=[string]$_.CommandLine; ageSeconds=($now - $_.CreationDate).TotalSeconds; workingSetMb=[double]$_.WorkingSetSize / 1MB } }) | ConvertTo-Json -Compress`;
    const raw = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    const data = raw.trim() ? JSON.parse(raw) : [];
    const processes: ChromeProcessSnapshot[] = Array.isArray(data) ? data : [data];
    const reaped = new Set<number>();
    for (const pid of selectOwnedChromeForReaping(processes, process.pid, forceKillAll ? 0 : maxAgeSeconds)) {
      try {
        execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore', timeout: 6000, windowsHide: true });
        reaped.add(pid);
      } catch {}
    }
    totalZombiesReaped += reaped.size;
    const remaining = processes.filter(proc => !reaped.has(proc.pid));
    return { remainingChromeCount: remaining.length, chromeWorkingSetMb: remaining.reduce((sum, proc) => sum + proc.workingSetMb, 0), reapedCount: reaped.size };
  } catch { return empty; }
}

/**
 * Scrubs Chromium profile caches and stale temp folders to free disk & memory-mapped cache files
 */
export function scrubBrowserCachesAndTempDirs(): number {
  if (hasJobsInFlight()) return 0;
  let cleaned = 0;
  const bases = ['state/autoapply', 'data'];
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    try {
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith('browser-profile-lane')) continue;
        const profDir = path.join(base, entry.name);
        for (const sub of ['Default/Code Cache', 'Default/GPUCache', 'Default/Cache', 'GrShaderCache', 'ShaderCache']) {
          const target = path.join(profDir, sub);
          if (fs.existsSync(target)) {
            try {
              const relative = path.relative(fs.realpathSync(base), fs.realpathSync(target));
              if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
              fs.rmSync(target, { recursive: true, force: true });
              cleaned++;
            } catch {}
          }
        }
      }
    } catch {}
  }

  try {
    if (typeof (global as any).gc === 'function') {
      (global as any).gc();
    }
  } catch {}

  return cleaned;
}

export function computeRecommendedLanes(
  freeRamGb: number,
  usedRamPct: number,
  remainingChromeCount = 0
): {
  recommendedLaneCount: number;
  healthStatus: SystemRamAndHealthSnapshot['healthStatus'];
} {
  let recommendedLaneCount = 4;
  let healthStatus: SystemRamAndHealthSnapshot['healthStatus'] = 'NORMAL';

  if (freeRamGb < 0.50 || usedRamPct >= 95) {
    recommendedLaneCount = 1;
    healthStatus = 'CRITICAL_RAM_RECOVERY';
    try {
      if (typeof (global as any).gc === 'function') {
        (global as any).gc();
      }
    } catch {}
    console.warn('[WATCHDOG] CRITICAL_RAM_RECOVERY: Free RAM below 500MB, clamped to 1 lane');
  } else if (freeRamGb < 1.0 || usedRamPct >= 90 || remainingChromeCount > 38) {
    recommendedLaneCount = 2;
    healthStatus = 'THROTTLE_DOWN_LOW_RAM';
  } else if (freeRamGb >= 2.4 && usedRamPct <= 80 && remainingChromeCount < 24) {
    recommendedLaneCount = 6;
    healthStatus = 'OPTIMAL_SCALE_UP';
  } else {
    recommendedLaneCount = 4;
    healthStatus = 'NORMAL';
  }

  return { recommendedLaneCount, healthStatus };
}

/**
 * Adaptive RAM Usage Increaser / Decreaser & Health Evaluator
 */
export function evaluateSystemHealthAndAdaptiveLanes(runReaper = true): SystemRamAndHealthSnapshot {
  const totalBytes = os.totalmem();
  let freeBytes = os.freemem();
  const totalRamGb = Number((totalBytes / 1073741824).toFixed(2));
  let freeRamGb = Number((freeBytes / 1073741824).toFixed(2));
  let usedRamPct = Number((((totalBytes - freeBytes) / totalBytes) * 100).toFixed(1));

  // If RAM is tight (< 2.8 GB free or > 82% used), reap stale chrome processes > 140s old; otherwise > 200s old
  const maxChromeAgeSec = freeRamGb < 2.8 || usedRamPct > 82 ? 140 : 200;
  const reaperStats = runReaper
    ? reapZombieChromeProcesses(maxChromeAgeSec, false)
    : { remainingChromeCount: 0, chromeWorkingSetMb: 0, reapedCount: 0 };

  if (!hasJobsInFlight() && (reaperStats.reapedCount > 0 || freeRamGb < 2.5)) {
    scrubBrowserCachesAndTempDirs();
    freeBytes = os.freemem();
    freeRamGb = Number((freeBytes / 1073741824).toFixed(2));
    usedRamPct = Number((((totalBytes - freeBytes) / totalBytes) * 100).toFixed(1));
  }

  const { recommendedLaneCount, healthStatus } = computeRecommendedLanes(
    freeRamGb,
    usedRamPct,
    reaperStats.remainingChromeCount
  );

  const snapshot: SystemRamAndHealthSnapshot = {
    timestamp: new Date().toISOString(),
    totalRamGb,
    freeRamGb,
    usedRamPct,
    chromeProcessCount: reaperStats.remainingChromeCount,
    chromeWorkingSetMb: reaperStats.chromeWorkingSetMb,
    recommendedLaneCount,
    zombiesReapedLastSweep: reaperStats.reapedCount,
    zombiesReapedTotal: totalZombiesReaped,
    healthStatus,
  };

  try {
    const outPath = path.resolve('state/autoapply/ram-health.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  } catch {}

  return snapshot;
}

export class ContinuousRamAndHealthWatchdog {
  private timer: NodeJS.Timeout | null = null;
  private latestSnapshot: SystemRamAndHealthSnapshot;

  constructor(private readonly intervalMs = 45_000) {
    this.latestSnapshot = evaluateSystemHealthAndAdaptiveLanes(true);
  }

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.latestSnapshot = evaluateSystemHealthAndAdaptiveLanes(true);
      } catch {}
    }, this.intervalMs);
    this.timer.unref?.();
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public getRecommendedLanes(): number {
    return this.latestSnapshot.recommendedLaneCount;
  }

  public getSnapshot(): SystemRamAndHealthSnapshot {
    return this.latestSnapshot;
  }

  /**
   * Call strictly between chunks when 0 lanes are active to guarantee 0 leaked chrome.exe processes!
   */
  public performInterChunkFullCleanup(): SystemRamAndHealthSnapshot {
    reapZombieChromeProcesses(0, true);
    scrubBrowserCachesAndTempDirs();
    this.latestSnapshot = evaluateSystemHealthAndAdaptiveLanes(false);
    return this.latestSnapshot;
  }
}

export interface DoctorSelfHealReport {
  timestamp: string;
  appliedLast30m: number;
  processedLast30m: number;
  processedLast15m: number;
  topFailureReasons: Array<{ reason: string; count: number }>;
  actionsTaken: string[];
  permissiveModeEnabled: boolean;
  cooldownsReset: boolean;
  healed: boolean;
}

let latestDoctorReport: DoctorSelfHealReport | null = null;

export function getDoctorStatus(): DoctorSelfHealReport | null {
  return latestDoctorReport;
}

/** Diagnose a lack of confirmations without changing submission or retry policy. */
export function check30MinZeroFillDroughtAndAutoHeal(params?: {
  stateDir?: string; runHistoryPath?: string; queueDbPath?: string; nowMs?: number;
}): DoctorSelfHealReport {
  const now = params?.nowMs ?? Date.now();
  const stateDir = params?.stateDir || path.resolve('state/autoapply/portal-review');
  const historyPath = params?.runHistoryPath || path.join(stateDir, 'run-history.jsonl');
  const report: DoctorSelfHealReport = {
    timestamp: new Date(now).toISOString(), appliedLast30m: 0, processedLast30m: 0, processedLast15m: 0,
    topFailureReasons: [], actionsTaken: [], permissiveModeEnabled: false, cooldownsReset: false, healed: false,
  };
  const failures: Record<string, number> = {};
  for (const run of readJobRunHistory(2000, historyPath)) {
    const legacy = run as typeof run & { timestamp?: string; createdAt?: string };
    const time = Date.parse(run.finishedAt || legacy.timestamp || legacy.createdAt || '');
    if (!Number.isFinite(time) || time > now || time < now - 30 * 60_000) continue;
    report.processedLast30m++;
    if (time >= now - 15 * 60_000) report.processedLast15m++;
    if (run.status === 'applied' && run.receiptVerified === true) report.appliedLast30m++;
    else {
      const reason = String(run.reason || 'unspecified_failure').slice(0, 100);
      failures[reason] = (failures[reason] || 0) + 1;
    }
  }
  report.topFailureReasons = Object.entries(failures).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reason, count]) => ({ reason, count }));
  // Empty history is idle/unknown, not evidence that a browser is hung.
  if (report.processedLast30m > 0 && report.appliedLast30m === 0) report.actionsTaken.push('review_failure_evidence_without_policy_changes');
  latestDoctorReport = report;
  return report;
}

if (process.argv[1] && (process.argv[1].endsWith('health-and-ram-watchdog.ts') || process.argv[1].endsWith('health-and-ram-watchdog.js'))) {
  console.log('System RAM & Health Watchdog Check:', evaluateSystemHealthAndAdaptiveLanes(true));
}
