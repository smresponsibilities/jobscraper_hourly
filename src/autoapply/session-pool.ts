import type { BrowserContext } from 'patchright';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { canonicalRequisition } from './identity.js';
import { SessionPool, type Session } from '@crawlee/core';
import type { PortalCredentials } from './env-credentials.js';

export const INDIAN_LOCALE_OPTIONS = {
  locale: 'en-IN',
  timezoneId: 'Asia/Calcutta',
} as const;

export interface HostHealthEntry {
  hostname: string;
  lastRequestAt: number;
  backoffUntil?: number;
  consecutiveFailures?: number;
  lastOutcome?: 'success' | 'rate_limited' | 'challenge' | 'error' | 'request';
  updatedAt?: string;
}

export type HostHealthMap = Record<string, HostHealthEntry>;

const DEFAULT_SESSIONS_DIR = path.resolve('state/autoapply/sessions');
const DEFAULT_HOST_HEALTH_PATH = path.resolve('state/autoapply/portal-review/host-health.json');

export function getHostStorageStatePath(urlStr: string, baseDir?: string): string {
  const dir = baseDir || DEFAULT_SESSIONS_DIR;
  let hostname = 'unknown-host';
  try {
    hostname = new URL(urlStr).hostname.toLowerCase();
  } catch {
    // If not a full URL, sanitize string to safe filename
    hostname = urlStr.replace(/[^a-zA-Z0-9.-]/g, '_').toLowerCase();
  }
  return path.join(dir, `${hostname}.json`);
}

export async function saveHostSessionState(
  context: BrowserContext,
  urlStr: string,
  baseDir?: string
): Promise<string> {
  const statePath = getHostStorageStatePath(urlStr, baseDir);
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    await context.storageState({ path: statePath });
    return statePath;
  } catch {
    return statePath;
  }
}

export async function loadHostSessionState(
  context: BrowserContext,
  urlStr: string,
  baseDir?: string
): Promise<boolean> {
  const statePath = getHostStorageStatePath(urlStr, baseDir);
  if (!fs.existsSync(statePath)) return false;
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    const state = JSON.parse(raw);
    let loaded = false;

    if (state.cookies && Array.isArray(state.cookies) && state.cookies.length > 0) {
      const nowSec = Date.now() / 1000;
      const validCookies = state.cookies.filter(
        (c: any) => !c.expires || c.expires === -1 || c.expires > nowSec
      );
      if (validCookies.length > 0) {
        await context.addCookies(validCookies);
        loaded = true;
      }
    }

    if (state.origins && Array.isArray(state.origins)) {
      for (const origin of state.origins) {
        if (origin.localStorage && Array.isArray(origin.localStorage) && origin.localStorage.length > 0) {
          await context
            .addInitScript(
              ({ originUrl, items }: { originUrl: string; items: Array<{ name: string; value: string }> }) => {
                if (window.location.origin === originUrl) {
                  for (const item of items) {
                    try {
                      window.localStorage.setItem(item.name, item.value);
                    } catch {}
                  }
                }
              },
              { originUrl: origin.origin, items: origin.localStorage }
            )
            .catch(() => {});
          loaded = true;
        }
      }
    }

    return loaded;
  } catch {
    return false;
  }
}

let cachedHealthMap: HostHealthMap | null = null;
let cachedHealthPath = '';
let cachedHealthMtime = 0;

export function loadHostHealth(stateFilePath?: string): HostHealthMap {
  const filePath = stateFilePath || DEFAULT_HOST_HEALTH_PATH;
  if (!fs.existsSync(filePath)) return {};
  try {
    const stat = fs.statSync(filePath);
    if (cachedHealthMap && cachedHealthPath === filePath && cachedHealthMtime === stat.mtimeMs) {
      return cachedHealthMap;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    cachedHealthMap = JSON.parse(raw);
    cachedHealthPath = filePath;
    cachedHealthMtime = stat.mtimeMs;
    return cachedHealthMap || {};
  } catch {
    return cachedHealthMap ? cachedHealthMap : {};
  }
}

export function saveHostHealth(health: HostHealthMap, stateFilePath?: string): void {
  const filePath = stateFilePath || DEFAULT_HOST_HEALTH_PATH;
  cachedHealthMap = health;
  cachedHealthPath = filePath;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(health, null, 2), 'utf8');
    try { cachedHealthMtime = fs.statSync(filePath).mtimeMs; } catch {}
  } catch {
    // Non-fatal error on disk write
  }
}

export function getRateLimitKey(urlStr: string): string {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    try {
      parsed = new URL(`https://${urlStr}`);
    } catch {
      return 'unknown';
    }
  }
  const host = parsed.hostname.toLowerCase();
  // Shared multi-tenant ATS platforms where company is first path segment
  if (/^(?:boards|job-boards|boards\.eu|job-boards\.eu)\.greenhouse\.io$/i.test(host) ||
      host === 'jobs.ashbyhq.com' ||
      host === 'jobs.lever.co' ||
      host === 'jobs.smartrecruiters.com') {
    const parts = parsed.pathname.split('/').filter(Boolean);
    const tenant = parts[0] ? parts[0].toLowerCase() : '';
    if (tenant) {
      return `${host}/${tenant}`;
    }
  }
  return host;
}

export function isHostReadyForRequest(
  urlStr: string,
  minGapMs: number = 45000,
  stateFilePath?: string
): boolean {
  const hostKey = getRateLimitKey(urlStr);
  if (hostKey === 'unknown') return false;

  const health = loadHostHealth(stateFilePath);
  const entry = health[hostKey];
  if (!entry) return true;

  const now = Date.now();
  if (entry.backoffUntil && now < entry.backoffUntil) {
    return false;
  }

  if (entry.lastRequestAt && now - entry.lastRequestAt < minGapMs) {
    return false;
  }

  return true;
}

export function markHostOutcome(
  urlStr: string,
  outcome: 'success' | 'rate_limited' | 'challenge' | 'error' | 'request',
  stateFilePath?: string
): void {
  const hostKey = getRateLimitKey(urlStr);
  if (hostKey === 'unknown') return;

  const filePath = stateFilePath || DEFAULT_HOST_HEALTH_PATH;
  const health = loadHostHealth(filePath);
  const entry = health[hostKey] || {
    hostname: hostKey,
    lastRequestAt: 0,
  };

  const now = Date.now();
  if (outcome === 'request') {
    entry.lastRequestAt = now;
  } else if (outcome === 'rate_limited') {
    entry.lastRequestAt = now;
    const failures = (entry.consecutiveFailures || 0) + 1;
    entry.consecutiveFailures = failures;
    const cap = Math.min(600_000, 30_000 * 2 ** Math.min(failures, 32));
    const backoffMs = Math.floor(cap / 2 + Math.random() * cap / 2);
    entry.backoffUntil = Math.max(entry.backoffUntil || 0, now + backoffMs);
    entry.lastOutcome = 'rate_limited';
  } else if (outcome === 'challenge') {
    entry.lastRequestAt = now;
    const failures = (entry.consecutiveFailures || 0) + 1;
    entry.consecutiveFailures = failures;
    // Challenge backoff: 30m for first, up to 60m for subsequent
    const backoffMs = Math.min(60 * 60 * 1000, 30 * 60 * 1000 * failures);
    entry.backoffUntil = now + backoffMs;
    entry.lastOutcome = 'challenge';
  } else if (outcome === 'success') {
    entry.lastRequestAt = now;
    entry.lastOutcome = 'success';
    if (!entry.backoffUntil || entry.backoffUntil <= now) entry.backoffUntil = undefined;
    entry.consecutiveFailures = 0;
  } else if (outcome === 'error') {
    entry.lastRequestAt = now;
    entry.lastOutcome = 'error';
    entry.consecutiveFailures = (entry.consecutiveFailures || 0) + 1;
  }

  entry.updatedAt = new Date().toISOString();
  health[hostKey] = entry;
  saveHostHealth(health, filePath);
}

export function detectJobProvider(url: string, externalJobId?: string): string {
  try {
    const req = canonicalRequisition(url, externalJobId);
    if (req?.provider) {
      const p = req.provider.toLowerCase();
      if (['greenhouse', 'ashby', 'workday', 'lever', 'smartrecruiters'].includes(p)) {
        return p;
      }
    }
  } catch {}

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('greenhouse.io') || parsed.searchParams.has('gh_jid')) return 'greenhouse';
    if (host.includes('ashbyhq.com')) return 'ashby';
    if (host.includes('myworkdayjobs.com') || host.includes('myworkdaysite.com')) return 'workday';
    if (host.includes('lever.co')) return 'lever';
    if (host.includes('smartrecruiters.com') || host.includes('smartr.me')) return 'smartrecruiters';
  } catch {}

  if (externalJobId) {
    if (externalJobId.startsWith('gh_') || externalJobId.startsWith('greenhouse_')) return 'greenhouse';
    if (externalJobId.startsWith('ashby_')) return 'ashby';
    if (externalJobId.startsWith('wd_') || externalJobId.startsWith('workday_')) return 'workday';
    if (externalJobId.startsWith('lever_')) return 'lever';
    if (externalJobId.startsWith('sr_') || externalJobId.startsWith('smartrecruiters_')) return 'smartrecruiters';
  }

  return 'other';
}

export const PROVIDER_ROUND_ROBIN_ORDER = [
  'greenhouse',
  'ashby',
  'workday',
  'lever',
  'smartrecruiters',
  'other',
] as const;

export function interleaveJobsByProvider<T extends { jobUrl?: string; url?: string; externalJobId?: string }>(
  jobs: T[]
): T[] {
  const buckets = new Map<string, T[]>();
  for (const prov of PROVIDER_ROUND_ROBIN_ORDER) {
    buckets.set(prov, []);
  }

  for (const job of jobs) {
    const url = job.jobUrl || job.url || '';
    const prov = detectJobProvider(url, job.externalJobId);
    const list = buckets.get(prov) || buckets.get('other')!;
    list.push(job);
  }

  const result: T[] = [];
  let hasMore = true;

  while (hasMore) {
    hasMore = false;
    for (const prov of PROVIDER_ROUND_ROBIN_ORDER) {
      const list = buckets.get(prov)!;
      if (list.length > 0) {
        result.push(list.shift()!);
        hasMore = true;
      }
    }
  }

  return result;
}

// ==========================================
// 3-TIER RESILIENT SESSION & AUTH POOL ARCHITECTURE
// ==========================================

export interface ResilientSessionResult {
  tier: 1 | 2 | 3;
  loaded: boolean;
  crawleeSession?: Session;
  storageStatePath?: string;
  credentials?: PortalCredentials | null;
  minted?: boolean;
}

export interface ResilientSessionOptions {
  forceTier?: 1 | 2 | 3;
  baseDir?: string;
  stateFilePath?: string;
  minGapMs?: number;
  credentials?: PortalCredentials | null;
}

let sharedCrawleePool: SessionPool | null = null;

export async function getSharedCrawleeSessionPool(): Promise<SessionPool> {
  if (!sharedCrawleePool) {
    sharedCrawleePool = await SessionPool.open({
      maxPoolSize: 25,
      sessionOptions: {
        maxUsageCount: 50,
      },
    });
  }
  return sharedCrawleePool;
}

/**
 * Tier 1: Crawlee SessionPool
 */
export async function getSessionTier1(
  context: BrowserContext | null | undefined,
  urlStr: string
): Promise<ResilientSessionResult | null> {
  try {
    const pool = await getSharedCrawleeSessionPool();
    let session = (pool as any).sessions?.find(
      (s: Session) => s.isUsable() && s.getCookies(urlStr).length > 0
    );
    if (!session) {
      session = await pool.getSession();
    }
    if (!session || !session.isUsable()) return null;

    const cookies = session.getCookies(urlStr);
    const hasCookies = Boolean(cookies && cookies.length > 0);
    if (hasCookies && context) {
      await context.addCookies(cookies);
    }
    return { tier: 1, loaded: hasCookies, crawleeSession: session };
  } catch {
    return null;
  }
}

/**
 * Tier 2: Local storageState + host-health cooldowns
 */
export async function getSessionTier2(
  context: BrowserContext | null | undefined,
  urlStr: string,
  baseDir?: string,
  stateFilePath?: string,
  minGapMs: number = 45000
): Promise<ResilientSessionResult | null> {
  if (!isHostReadyForRequest(urlStr, minGapMs, stateFilePath)) {
    return null;
  }
  const statePath = getHostStorageStatePath(urlStr, baseDir);
  if (!fs.existsSync(statePath)) return null;

  if (context) {
    const loaded = await loadHostSessionState(context, urlStr, baseDir);
    if (loaded) {
      return { tier: 2, loaded: true, storageStatePath: statePath };
    }
  } else {
    try {
      const raw = fs.readFileSync(statePath, 'utf8');
      const data = JSON.parse(raw);
      if (data.cookies && data.cookies.length > 0) {
        return { tier: 2, loaded: true, storageStatePath: statePath };
      }
    } catch {}
  }
  return null;
}

/**
 * Tier 3 requires provider authentication; credentials alone do not create a session.
 */
export async function mintLiveSessionTier3(
  context: BrowserContext | null | undefined,
  urlStr: string,
  options: ResilientSessionOptions = {}
): Promise<ResilientSessionResult> {
  const statePath = getHostStorageStatePath(urlStr, options.baseDir);
  return { tier: 3, loaded: false, minted: false, storageStatePath: statePath };
}

/**
 * Master coordinator for 3-tier resilient sessions
 */
export async function getResilientSession(
  context: BrowserContext | null | undefined,
  urlStr: string,
  options: ResilientSessionOptions = {}
): Promise<ResilientSessionResult> {
  const forceTier = options.forceTier;

  if (forceTier === 1) {
    const res = await getSessionTier1(context, urlStr);
    if (res) return res;
    const pool = await getSharedCrawleeSessionPool();
    const session = await pool.getSession();
    return { tier: 1, loaded: false, crawleeSession: session };
  }

  if (forceTier === 2) {
    const res = await getSessionTier2(context, urlStr, options.baseDir, options.stateFilePath, options.minGapMs);
    if (res) return res;
    return { tier: 2, loaded: false, storageStatePath: getHostStorageStatePath(urlStr, options.baseDir) };
  }

  if (forceTier === 3) {
    return mintLiveSessionTier3(context, urlStr, options);
  }

  // Fallback: Tier 1 -> Tier 2 -> Tier 3
  const t1 = await getSessionTier1(context, urlStr);
  if (t1 && t1.loaded) return t1;

  const t2 = await getSessionTier2(context, urlStr, options.baseDir, options.stateFilePath, options.minGapMs);
  if (t2 && t2.loaded) return t2;

  return mintLiveSessionTier3(context, urlStr, options);
}

export async function markResilientSessionGood(
  urlStr: string,
  session?: Session,
  stateFilePath?: string
): Promise<void> {
  if (session) {
    try {
      session.markGood();
    } catch {}
  }
  markHostOutcome(urlStr, 'success', stateFilePath);
}

export async function markResilientSessionBad(
  urlStr: string,
  session?: Session,
  outcome: 'rate_limited' | 'challenge' | 'error' = 'error',
  stateFilePath?: string
): Promise<void> {
  if (session) {
    try {
      session.markBad();
    } catch {}
  }
  markHostOutcome(urlStr, outcome, stateFilePath);
}
