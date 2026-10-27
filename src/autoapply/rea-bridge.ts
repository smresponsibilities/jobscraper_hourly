/**
 * REA (Reverse Engineer Anything) Bridge.
 * Connects the Auto-Apply runner to D:\rea for static script inspection,
 * web bundle analysis, and evidence-backed reverse engineering of target ATS portals.
 */

import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const REA_ROOT = 'D:\\rea';
export const REA_CLI_PATH = path.join(REA_ROOT, 'scripts', 'rea.mjs');

export interface ReaInspectionResult {
  available: boolean;
  reaVersion?: string;
  output?: string;
  error?: string;
}

/**
 * Checks whether the local REA installation at D:\rea is active and functional.
 */
export function checkReaStatus(): ReaInspectionResult {
  if (!existsSync(REA_CLI_PATH)) {
    return {
      available: false,
      error: `REA CLI not found at ${REA_CLI_PATH}`,
    };
  }

  try {
    const stdout = execFileSync('node', [REA_CLI_PATH, '--version'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: 'pipe',
    });
    return {
      available: true,
      reaVersion: stdout.trim(),
    };
  } catch (err: any) {
    return {
      available: false,
      error: err.message,
    };
  }
}

/**
 * Invokes REA CLI command safely with bounded timeout.
 */
export function invokeReaCommand(command: string, args: string[] = []): string {
  if (!existsSync(REA_CLI_PATH)) {
    throw new Error(`REA not installed at ${REA_CLI_PATH}`);
  }

  return execFileSync('node', [REA_CLI_PATH, command, ...args], {
    encoding: 'utf-8',
    timeout: 30000,
  });
}
