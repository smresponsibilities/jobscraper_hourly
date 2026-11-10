// src/autoapply/watchdog-timer.ts

export class JobActivityWatchdog {
  private lastActivityAt = Date.now();
  private readonly startedAt = Date.now();
  private lastStage = 'init';
  public onHeartbeat?: (stage: string) => void;

  constructor(
    public readonly maxTotalMs = 180_000, // 180s OTP-safe ceiling for Fast-ATS (GEN-302/304)
    public readonly maxIdleMs = 60_000   // 60s max stall without progress
  ) {}

  public heartbeat(stage: string): void {
    this.lastActivityAt = Date.now();
    this.lastStage = stage;
    try {
      this.onHeartbeat?.(stage);
    } catch {}
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
    // Allow active progress extension up to 1.5x maxTotalMs if actively heartbeating
    const effectiveTotalCeiling = (idleElapsed < 25_000) ? Math.round(this.maxTotalMs * 1.5) : this.maxTotalMs;
    if (totalElapsed > effectiveTotalCeiling) {
      throw new Error(`WATCHDOG_TOTAL_TIMEOUT: Exceeded ${effectiveTotalCeiling / 1000}s total budget (last stage: ${this.lastStage})`);
    }
    if (idleElapsed > this.maxIdleMs) {
      throw new Error(`WATCHDOG_IDLE_STALL: No progress for ${this.maxIdleMs / 1000}s at stage: ${this.lastStage}`);
    }
  }
}

export function getProviderTimeoutConfig(urlStr: string): { maxTotalMs: number; maxIdleMs: number } {
  const u = (urlStr || '').toLowerCase();
  // Ticket GEN-302 & GEN-304: 180s OTP-safe timeout on Greenhouse, Ashby, Lever; 210s on Workday & SmartRecruiters
  const isFastAts = /greenhouse\.io|ashbyhq\.com|lever\.co/i.test(u);
  if (isFastAts) {
    return { maxTotalMs: 180_000, maxIdleMs: 60_000 };
  }
  const isSlowAts = /myworkdayjobs\.com|smartrecruiters\.com/i.test(u);
  if (isSlowAts) {
    return { maxTotalMs: 210_000, maxIdleMs: 70_000 };
  }
  return { maxTotalMs: 180_000, maxIdleMs: 60_000 };
}
