// src/autoapply/watchdog-timer.ts

export class JobActivityWatchdog {
  private lastActivityAt = Date.now();
  private readonly startedAt = Date.now();
  private lastStage = 'init';

  constructor(
    public readonly maxTotalMs = 240_000, // 4 minutes max ceiling (GEN-112)
    public readonly maxIdleMs = 60_000    // 60 seconds max stall without progress
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
  // Ticket GEN-112: Set maxTotalMs = 240_000 (240s) with 60s idle stall so large 30-field forms complete under multi-lane load
  return { maxTotalMs: 240_000, maxIdleMs: 60_000 };
}
