// src/autoapply/permissive-fallback.ts
import * as fs from 'node:fs';
import * as path from 'node:path';

export const ATTEMPTS_PATH = path.resolve('state/autoapply/portal-review/job-attempts.json');

export function getAndIncrementJobAttempt(jobId: string, filePath = ATTEMPTS_PATH): number {
  let store: Record<string, number> = {};
  try {
    if (fs.existsSync(filePath)) {
      store = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch {}
  const next = (store[jobId] || 0) + 1;
  store[jobId] = next;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
  } catch {}
  return next;
}

export function getJobAttemptCount(jobId: string, filePath = ATTEMPTS_PATH): number {
  try {
    if (fs.existsSync(filePath)) {
      const store = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return store[jobId] || 0;
    }
  } catch {}
  return 0;
}

/**
 * Guaranteed Universal Fallback Resolver ("Submit-All" Mode):
 * Ensures ZERO required fields are ever left blank when strict classification returns null.
 */
export function resolveUniversalPermissiveFallback(params: {
  questionText: string;
  widgetKind: string;
  options: string[] | null;
  placeholder?: string;
  inputType?: string;
  profileEmail?: string;
}): string | undefined {
  // A required field is not evidence for an answer.
  return undefined;
}
