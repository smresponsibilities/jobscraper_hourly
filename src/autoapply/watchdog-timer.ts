// src/autoapply/watchdog-timer.ts

export class JobActivityWatchdog {
  private lastActivityAt = Date.now();
  private readonly startedAt = Date.now();
  private lastStage = 'init';

  constructor(
    public readonly maxTotalMs = 95_000, // 95s max ceiling for Fast-ATS (GEN-284)
    public readonly maxIdleMs = 40_000   // 40s max stall without progress
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
  const u = (urlStr || '').toLowerCase();
  // Ticket GEN-284: 95s fast-fail timeout on Greenhouse, Ashby, Lever; 160s on Workday & SmartRecruiters
  const isFastAts = /greenhouse\.io|ashbyhq\.com|lever\.co/i.test(u);
  if (isFastAts) {
    return { maxTotalMs: 95_000, maxIdleMs: 40_000 };
  }
  const isSlowAts = /myworkdayjobs\.com|smartrecruiters\.com/i.test(u);
  if (isSlowAts) {
    return { maxTotalMs: 160_000, maxIdleMs: 65_000 };
  }
  return { maxTotalMs: 95_000, maxIdleMs: 40_000 };
}
