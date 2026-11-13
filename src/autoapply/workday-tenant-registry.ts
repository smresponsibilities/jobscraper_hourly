import { createHmac, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';

export interface WorkdayTenantQuirk {
  requiresNumericNoticeDays?: boolean;
  requiresNationalIdNA?: boolean;
  customPasswordRule?: string;
  verifiedLocale?: string;
}

const defaultPath = () => path.resolve('state/autoapply/workday-tenant-quirks.json');
let cached: { path: string; mtime: number; size: number; value: Record<string, WorkdayTenantQuirk> } | undefined;

export function extractWorkdayTenantKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
    const match = /^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/i.exec(parsed.hostname);
    if (!match || /^(?:stripe|avoca|ssctech|paypal)(?:[-.]|$)/i.test(match[1]!)) return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (/^[a-z]{2}[-_][a-z]{2}$/i.test(parts[0] || '')) parts.shift();
    const site = parts[0];
    if (!site || !/^[a-z0-9._~-]+$/i.test(site) || /^(?:\.|\.\.|wday)$/i.test(site)) return null;
    return `${parsed.hostname.toLowerCase()}/${site.toLowerCase()}`;
  } catch { return null; }
}

function read(filePath: string): Record<string, WorkdayTenantQuirk> {
  try {
    const stat = fs.statSync(filePath);
    if (cached?.path === filePath && cached.mtime === stat.mtimeMs && cached.size === stat.size) return cached.value;
    const data: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid tenant registry');
    cached = { path: filePath, mtime: stat.mtimeMs, size: stat.size, value: data as Record<string, WorkdayTenantQuirk> };
    return cached.value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

export function getWorkdayTenantQuirks(url: string, filePath = defaultPath()): WorkdayTenantQuirk {
  const key = extractWorkdayTenantKey(url);
  if (!key) return {};
  try { return { ...(read(filePath)[key] || {}) }; } catch { return {}; }
}

export function recordWorkdayTenantQuirk(url: string, quirk: WorkdayTenantQuirk, filePath = defaultPath()): void {
  const key = extractWorkdayTenantKey(url);
  if (!key) throw new Error('Invalid or isolated Workday tenant');
  const safe: WorkdayTenantQuirk = {};
  for (const property of ['requiresNumericNoticeDays', 'requiresNationalIdNA'] as const) {
    if (quirk[property] !== undefined) {
      if (typeof quirk[property] !== 'boolean') throw new Error('Invalid tenant quirk');
      safe[property] = quirk[property];
    }
  }
  for (const property of ['customPasswordRule', 'verifiedLocale'] as const) {
    if (quirk[property] !== undefined) {
      if (typeof quirk[property] !== 'string' || quirk[property]!.length > 200 || /[\x00-\x1f\x7f]/.test(quirk[property]!)) throw new Error('Invalid tenant quirk');
      safe[property] = quirk[property];
    }
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lockPath = `${filePath}.lock`;
  const lock = fs.openSync(lockPath, 'wx', 0o600);
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    cached = undefined;
    const entries = read(filePath);
    const updated = { ...entries, [key]: { ...entries[key], ...safe } };
    fs.writeFileSync(temporary, JSON.stringify(updated, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, filePath);
    cached = undefined;
  } finally {
    try { fs.unlinkSync(temporary); } catch {}
    fs.closeSync(lock);
    try { fs.unlinkSync(lockPath); } catch {}
  }
}

/** Derive credentials for new accounts only; never change an existing password. */
export function deriveWorkdayCompliantPassword(baseSecret: string, tenantKey: string, policy: { minLength?: number; maxLength?: number; allowedSymbols?: string } = {}): string {
  const secret = baseSecret || process.env.AUTOAPPLY_PASSWORD || '';
  if (!secret || !tenantKey) throw new Error('A secret and tenant key are required');
  if (policy.minLength !== undefined && (!Number.isInteger(policy.minLength) || policy.minLength < 1)) throw new Error('Unsupported password length policy');
  const min = Math.max(12, policy.minLength ?? 12);
  const max = policy.maxLength ?? Math.max(16, min);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min > max || max > 128) throw new Error('Unsupported password length policy');
  const symbols = [...'!@#'].filter(symbol => policy.allowedSymbols === undefined || policy.allowedSymbols.includes(symbol)).join('');
  if (!symbols) throw new Error('No supported password symbols');
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', lower = 'abcdefghijklmnopqrstuvwxyz', digits = '0123456789';
  let block = Buffer.alloc(0), offset = 0, counter = 0;
  const pick = (limit: number): number => {
    const ceiling = 256 - 256 % limit;
    for (;;) {
      if (offset >= block.length) { block = createHmac('sha256', secret).update(`workday-password-v1\0${tenantKey}\0${counter++}`).digest(); offset = 0; }
      const byte = block[offset++]!;
      if (byte < ceiling) return byte % limit;
    }
  };
  const categories = [upper, upper, lower, lower, digits, digits, symbols];
  while (categories.length < max) categories.push(upper + lower + digits + symbols);
  for (let i = categories.length - 1; i > 0; i--) { const j = pick(i + 1); [categories[i], categories[j]] = [categories[j]!, categories[i]!]; }
  let password = '';
  for (let i = 0; i < categories.length; i++) {
    const category = categories[i]!;
    const next = categories[i + 1];
    const available = [...category].filter(char => char !== password.at(-1) && !(next?.length === 1 && char === next)).join('');
    if (!available) throw new Error('Unsupported password policy');
    password += available[pick(available.length)];
  }
  return password;
}
