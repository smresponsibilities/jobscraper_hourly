/**
 * Per-rate-limit-key latency/error summary — measurement only, changes no
 * behavior. Exists to answer one question before touching HOST_CONCURRENCY's
 * static numbers again: is a fixed per-host cap actually leaving throughput
 * on the table anywhere, or costing 429s anywhere? Right now that's a guess;
 * this makes it a number. Logged every run, acted on only if evidence
 * accumulates — same "measure before touching" rule as BOARDS_PER_RUN.
 */
export interface PollTiming {
  key: string;
  durationMs: number;
  error?: string;
}

export interface HostStat {
  key: string;
  count: number;
  errors: number;
  p50: number;
  p95: number;
}

export function summarizeHostStats(results: readonly PollTiming[]): HostStat[] {
  const byKey = new Map<string, { durations: number[]; errors: number }>();
  for (const { key, durationMs, error } of results) {
    const bucket = byKey.get(key) ?? { durations: [], errors: 0 };
    bucket.durations.push(durationMs);
    if (error) bucket.errors++;
    byKey.set(key, bucket);
  }

  const stats: HostStat[] = [];
  for (const [key, { durations, errors }] of byKey) {
    const sorted = [...durations].sort((a, b) => a - b);
    const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
    stats.push({ key, count: sorted.length, errors, p50: at(0.5), p95: at(0.95) });
  }
  return stats.sort((a, b) => b.p95 - a.p95);
}

/** One line per host, worst-p95-first, so a slow/error-prone host is visible without reading a wall of numbers. */
export function formatHostStats(stats: readonly HostStat[], limit = 10): string {
  return stats
    .slice(0, limit)
    .map((s) => `    ${s.key.padEnd(20)} p50 ${String(s.p50).padStart(5)}ms  p95 ${String(s.p95).padStart(5)}ms  ${s.errors}/${s.count} errors`)
    .join('\n');
}
