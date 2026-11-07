// src/autoapply/watchdog-timer.ts

export class JobActivityWatchdog {
  private lastActivityAt = Date.now();
  private readonly startedAt = Date.now();
  private lastStage = 'init';

  constructor(
    public readonly maxTotalMs = 300_000, // 5 minutes max ceiling
    public readonly maxIdleMs = 90_000   // 90 seconds max stall without progress
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
  if (u.includes('myworkdayjobs.com') || u.includes('smartrecruiters.com') || u.includes('icims.com')) {
    return { maxTotalMs: 300_000, maxIdleMs: 95_000 }; // 5 mins total, 95s idle
  }
  return { maxTotalMs: 180_000, maxIdleMs: 75_000 };    // 3 mins total, 75s idle
}
