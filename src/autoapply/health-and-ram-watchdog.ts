// src/autoapply/health-and-ram-watchdog.ts
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

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

let totalZombiesReaped = 0;

/**
 * Queries Windows chrome.exe processes and kills any chrome.exe older than maxAgeSeconds.
 * If forceKillAll is true (used strictly at 0-in-flight chunk boundaries), kills ALL chrome.exe processes.
 */
export function reapZombieChromeProcesses(maxAgeSeconds = 195, forceKillAll = false): {
  remainingChromeCount: number;
  chromeWorkingSetMb: number;
  reapedCount: number;
} {
  if (process.platform !== 'win32') {
    return { remainingChromeCount: 0, chromeWorkingSetMb: 0, reapedCount: 0 };
  }

  if (forceKillAll) {
    try {
      execSync('taskkill /F /IM chrome.exe /T', { stdio: 'ignore', timeout: 4000 });
      totalZombiesReaped += 1;
    } catch {}
    return { remainingChromeCount: 0, chromeWorkingSetMb: 0, reapedCount: 1 };
  }

  try {
    const psCmd = `powershell -NoProfile -Command "$now = Get-Date; $procs = @(Get-Process chrome -ErrorAction SilentlyContinue); $reaped = 0; $rem = 0; $ws = 0; foreach ($p in $procs) { try { $age = ($now - $p.StartTime).TotalSeconds; if ($age -gt ${maxAgeSeconds}) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; $reaped++ } else { $rem++; $ws += $p.WorkingSet64 } } catch {} }; Write-Output ($rem.ToString() + '|' + [math]::Round($ws / 1048576) + '|' + $reaped.ToString())"`;
    const out = execSync(psCmd, { encoding: 'utf8', timeout: 5000 }).trim();
    const [remStr, wsStr, reapedStr] = out.split('|');
    const reaped = Number(reapedStr) || 0;
    totalZombiesReaped += reaped;
    return {
      remainingChromeCount: Number(remStr) || 0,
      chromeWorkingSetMb: Number(wsStr) || 0,
      reapedCount: reaped,
    };
  } catch {
    return { remainingChromeCount: 0, chromeWorkingSetMb: 0, reapedCount: 0 };
  }
}

/**
 * Scrubs Chromium profile caches and stale temp folders to free disk & memory-mapped cache files
 */
export function scrubBrowserCachesAndTempDirs(): number {
  let cleaned = 0;
  const bases = ['state/autoapply', 'data'];
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    try {
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith('browser-profile-lane')) continue;
        const profDir = path.join(base, entry.name);
        for (const sub of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile', 'Default/Code Cache', 'Default/GPUCache', 'Default/Cache', 'GrShaderCache', 'ShaderCache']) {
          const target = path.join(profDir, sub);
          if (fs.existsSync(target)) {
            try {
              fs.rmSync(target, { recursive: true, force: true });
              cleaned++;
            } catch {}
          }
        }
      }
    } catch {}
  }

  // Clean old playwright temp folders (> 25 minutes old) in os.tmpdir()
  try {
    const tmp = os.tmpdir();
    const cutoff = Date.now() - 25 * 60 * 1000;
    for (const entry of fs.readdirSync(tmp, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!/^(?:playwright|puppeteer|scoped_dir|autoapply)/i.test(entry.name)) continue;
      const full = path.join(tmp, entry.name);
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs < cutoff) {
          fs.rmSync(full, { recursive: true, force: true });
          cleaned++;
        }
      } catch {}
    }
  } catch {}

  // Windows Working-Set trimmer: trim unused memory pages from background processes via PowerShell [System.GC]::Collect() & Node global.gc?.()
  if (process.platform === 'win32') {
    try {
      execSync(
        'powershell -NoProfile -NonInteractive -Command "try { Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.WorkingSet64 -gt 30MB } | ForEach-Object { try { $_.MinWorkingSet = $_.MinWorkingSet } catch {} } } catch {}; [System.GC]::Collect()"',
        { stdio: 'ignore', timeout: 4000, windowsHide: true }
      );
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

  if (freeRamGb < 0.45 || usedRamPct >= 95) {
    recommendedLaneCount = 1;
    healthStatus = 'CRITICAL_RAM_RECOVERY';
  } else if (freeRamGb < 0.85 || usedRamPct >= 91 || remainingChromeCount > 38) {
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

  if (reaperStats.reapedCount > 0 || freeRamGb < 2.5) {
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

if (process.argv[1] && (process.argv[1].endsWith('health-and-ram-watchdog.ts') || process.argv[1].endsWith('health-and-ram-watchdog.js'))) {
  console.log('System RAM & Health Watchdog Check:', evaluateSystemHealthAndAdaptiveLanes(true));
}
