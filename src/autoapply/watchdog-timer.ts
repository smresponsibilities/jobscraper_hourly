// src/autoapply/watchdog-timer.ts

export class JobActivityWatchdog {
  private lastActivityAt = Date.now();
  private readonly startedAt = Date.now();
  private lastStage = 'init';

  constructor(
    public readonly maxTotalMs = 120_000, // 2 minutes max ceiling (GEN-98)
    public readonly maxIdleMs = 45_000   // 45 seconds max stall without progress
  ) {}

  public heartbeat(stage: string): void {
    this.lastActivityAt = Date.now();
    this.lastStage = stage;
  }

  public getElapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  public getIdleMs(): number {
    return Date.now() - this.lastActivityAt;
  }

  public checkOrThrow(): void {
    const now = Date.now();
    const totalElapsed = now - this.startedAt;
    const idleElapsed = now - this.lastActivityAt;
    if (totalElapsed > this.maxTotalMs) {
      throw new Error(`WATCHDOG_TOTAL_TIMEOUT: Exceeded ${this.maxTotalMs / 1000}s total budget (last stage: ${this.lastStage})`);
    }
    if (idleElapsed > this.maxIdleMs) {
      throw new Error(`WATCHDOG_IDLE_STALL: No progress for ${this.maxIdleMs / 1000}s at stage: ${this.lastStage}`);
    }
  }
}

export function getProviderTimeoutConfig(urlStr: string): { maxTotalMs: number; maxIdleMs: number } {
  const u = urlStr.toLowerCase();
  // Ticket GEN-98: Lower watchdog hard timeouts from 300s to 90s-120s fail-fast
  if (u.includes('myworkdayjobs.com')) {
    return { maxTotalMs: 120_000, maxIdleMs: 45_000 }; // Workday: 120s total, 45s idle
  }
  // Greenhouse, Ashby, Lever, SmartRecruiters, and others: 90s total, 40s idle
  return { maxTotalMs: 90_000, maxIdleMs: 40_000 };
}
