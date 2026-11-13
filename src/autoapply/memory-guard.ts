import os from 'node:os';

export interface MemoryPressure {
  pressureLevel: 'NORMAL' | 'ELEVATED' | 'CRITICAL';
  recommendedLaneCount: 1 | 2 | 4;
  shouldUseZeroMsPdfFallback: boolean;
  shouldRecycleBrowserContext: boolean;
}

export function assessSystemMemoryPressure(overrides: { freeMemBytes?: number; rssBytes?: number } = {}): MemoryPressure {
  let free: number, rss: number;
  try { free = overrides.freeMemBytes ?? os.freemem(); rss = overrides.rssBytes ?? process.memoryUsage().rss; }
  catch { return { pressureLevel: 'ELEVATED', recommendedLaneCount: 2, shouldUseZeroMsPdfFallback: true, shouldRecycleBrowserContext: true }; }
  if (![free, rss].every(value => Number.isFinite(value) && value >= 0)) return { pressureLevel: 'ELEVATED', recommendedLaneCount: 2, shouldUseZeroMsPdfFallback: true, shouldRecycleBrowserContext: true };
  const level = free < 1024 ** 3 || rss > 1.2 * 1024 ** 3 ? 'CRITICAL' : free < 1.8 * 1024 ** 3 || rss > 800 * 1024 ** 2 ? 'ELEVATED' : 'NORMAL';
  return { pressureLevel: level, recommendedLaneCount: level === 'CRITICAL' ? 1 : level === 'ELEVATED' ? 2 : 4, shouldUseZeroMsPdfFallback: level !== 'NORMAL', shouldRecycleBrowserContext: level !== 'NORMAL' };
}

/** This check must be combined with process ownership and in-flight guards. */
export function isSafeToReapChromeCommandLine(commandLine: string, _activeWorkerPid?: number): boolean {
  return /(?:^|\s)--headless=new(?:\s|$)/i.test(commandLine)
    && /(?:state[\\/]autoapply|playwright_chromiumdev_profile)/i.test(commandLine)
    && !/--profile-directory(?:=|\s+)["']?(?:Default|Profile(?:\s|$|["']))/i.test(commandLine);
}
