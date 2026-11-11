import fs from 'node:fs';
import path from 'node:path';
import type { BotRunReport } from './types.js';

export const stopFlagPath = (stateDir: string): string => path.join(stateDir, 'STOP_AUTOAPPLY.flag');

/** Wait without creating browsers; notice an operator stop within 250ms. */
export async function waitForDaemonWake(stateDir: string, delayMs = 30_000, stopping = () => false): Promise<void> {
  const deadline = Date.now() + delayMs;
  while (!stopping() && !fs.existsSync(stopFlagPath(stateDir)) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, Math.min(250, deadline - Date.now())));
  }
}

export function hasObservedApplicationReceipt(report: BotRunReport): boolean {
  const receipt = report.receipt;
  return !!receipt && !!receipt.text?.trim() && !!receipt.url && Number.isFinite(Date.parse(receipt.verifiedAt));
}
