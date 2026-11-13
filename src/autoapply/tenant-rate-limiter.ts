import * as fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

interface TenantState { lastAttemptMs: number; consecutive429s: number; blockedUntilMs: number }
const defaultPath = () => path.resolve('state/autoapply/tenant-rate-limits.json');

function load(filePath: string): Record<string, TenantState> {
  let text: string;
  try { text = fs.readFileSync(filePath, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Object.create(null); throw error; }
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid tenant rate-limit state');
  const state: Record<string, TenantState> = Object.create(null);
  for (const [key, value] of Object.entries(raw)) {
    const entry = value as TenantState;
    if (!entry || !Number.isFinite(entry.lastAttemptMs) || !Number.isFinite(entry.blockedUntilMs) || !Number.isInteger(entry.consecutive429s) || entry.consecutive429s < 0) throw new Error('Invalid tenant rate-limit entry');
    state[key] = entry;
  }
  return state;
}

function save(filePath: string, state: Record<string, TenantState>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, filePath);
  } finally { try { fs.unlinkSync(temporary); } catch {} }
}

function validate(tenantKey: string, nowMs: number): void {
  if (!tenantKey || tenantKey.length > 512 || /[\x00-\x1f\x7f]/.test(tenantKey) || !Number.isFinite(nowMs) || nowMs < 0) throw new Error('Invalid tenant rate-limit input');
}

/** Serialize file read-modify-write across workers; a stranded lock fails closed. */
function withStateLock<T>(filePath: string, action: () => T): T {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lock = `${filePath}.lock`;
  let fd: number | undefined;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { fd = fs.openSync(lock, 'wx', 0o600); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  if (fd === undefined) throw new Error('Tenant rate-limit state is locked');
  try { return action(); }
  finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}

export function computeTenantCooldownWaitMs(tenantKey: string, minCooldownMs = 45_000, nowMs = Date.now(), stateFilePath = defaultPath()): number {
  validate(tenantKey, nowMs);
  if (!Number.isFinite(minCooldownMs) || minCooldownMs < 0) throw new Error('Invalid cooldown');
  const entry = load(stateFilePath)[tenantKey];
  return entry ? Math.max(0, entry.lastAttemptMs + minCooldownMs - nowMs, entry.blockedUntilMs - nowMs) : 0;
}

/** Call synchronously before starting network work. */
export function reserveTenantRequest(tenantKey: string, minCooldownMs = 45_000, nowMs = Date.now(), stateFilePath = defaultPath()): boolean {
  validate(tenantKey, nowMs);
  if (!Number.isFinite(minCooldownMs) || minCooldownMs < 0) throw new Error('Invalid cooldown');
  return withStateLock(stateFilePath, () => {
    const state = load(stateFilePath);
    const current = state[tenantKey] || { lastAttemptMs: 0, consecutive429s: 0, blockedUntilMs: 0 };
    if (state[tenantKey] && Math.max(current.lastAttemptMs + minCooldownMs, current.blockedUntilMs) > nowMs) return false;
    current.lastAttemptMs = nowMs;
    state[tenantKey] = current;
    save(stateFilePath, state);
    return true;
  });
}

export function recordTenantHttpOutcome(tenantKey: string, httpStatus: number, nowMs = Date.now(), stateFilePath = defaultPath()): { backoffMs: number; consecutive429s: number } {
  validate(tenantKey, nowMs);
  if (!Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599) throw new Error('Invalid HTTP status');
  return withStateLock(stateFilePath, () => {
    const state = load(stateFilePath);
    const entry = state[tenantKey] || { lastAttemptMs: 0, consecutive429s: 0, blockedUntilMs: 0 };
    entry.lastAttemptMs = Math.max(entry.lastAttemptMs, nowMs);
    let backoffMs = 0;
    if (httpStatus === 429 || httpStatus === 503) {
      entry.consecutive429s = Math.min(entry.consecutive429s + 1, 32);
      const cap = Math.min(600_000, 30_000 * 2 ** entry.consecutive429s);
      backoffMs = Math.floor(cap / 2 + Math.random() * cap / 2);
      entry.blockedUntilMs = Math.max(entry.blockedUntilMs, nowMs + backoffMs);
    } else if (httpStatus < 400) {
      entry.consecutive429s = 0;
    }
    state[tenantKey] = entry;
    save(stateFilePath, state);
    return { backoffMs, consecutive429s: entry.consecutive429s };
  });
}


export function parseRetryAfterHeaderMs(header: string | null | undefined, nowMs = Date.now()): number | null {
  if (!header || !Number.isFinite(nowMs)) return null;
  const seconds = /^\s*(\d+(?:\.\d+)?)\s*$/.exec(header);
  if (seconds) { const ms = Number(seconds[1]) * 1000; return Number.isFinite(ms) ? Math.ceil(ms) : null; }
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - nowMs) : null;
}

export function computeAutoThrottleDelayMs(params: { previousDelayMs: number; responseLatencyMs: number; targetConcurrency?: number; minDelayMs?: number; maxDelayMs?: number; httpStatus?: number; retryAfterHeader?: string | null }, nowMs = Date.now()): number {
  const min = params.minDelayMs ?? 1000, max = params.maxDelayMs ?? (params.retryAfterHeader ? 600_000 : 60_000), concurrency = params.targetConcurrency ?? 2;
  if (![min, max, concurrency, params.previousDelayMs, params.responseLatencyMs].every(Number.isFinite) || min < 0 || max < min || concurrency <= 0 || params.previousDelayMs < 0 || params.responseLatencyMs < 0) throw new Error('Invalid throttle parameters');
  const retry = parseRetryAfterHeaderMs(params.retryAfterHeader, nowMs);
  if (retry !== null) return Math.min(max, Math.max(min, retry));
  const delay = (params.previousDelayMs + params.responseLatencyMs / concurrency) / 2;
  return Math.min(params.maxDelayMs ?? 60_000, Math.max(min, params.httpStatus && params.httpStatus >= 400 ? Math.max(params.previousDelayMs, delay) : delay));
}
