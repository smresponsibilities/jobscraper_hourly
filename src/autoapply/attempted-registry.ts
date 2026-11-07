// src/autoapply/attempted-registry.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AutoaplyJobItem } from './types.js';
import { getJobAttemptCount, getAndIncrementJobAttempt } from './permissive-fallback.js';

export const DEFAULT_ATTEMPTED_REGISTRY_PATH = path.resolve('state/autoapply/portal-review/attempted-job-ids.json');
const RUN_HISTORY_PATH = path.resolve('state/autoapply/portal-review/run-history.jsonl');
const OVERNIGHT_ERRORS_PATH = path.resolve('state/autoapply/portal-review/overnight-errors.jsonl');

export interface AttemptedRecord {
  jobId: string;
  company: string;
  url: string;
  status: string;
  attemptedAt: string;
}

export interface AttemptedRegistryData {
  jobIds: Record<string, AttemptedRecord>;
  normalizedUrls: Record<string, AttemptedRecord>;
  updatedAt: string;
}

export function normalizeAttemptUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    // Strip hash and common marketing/tracking query parameters
    u.hash = '';
    const paramsToDrop = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gh_src', 'ref', 'source'];
    for (const p of paramsToDrop) {
      u.searchParams.delete(p);
    }
    let s = u.toString().toLowerCase();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch {
    return rawUrl.trim().toLowerCase().replace(/\/+$/, '');
  }
}

let inMemoryRegistry: AttemptedRegistryData | null = null;

export function loadAttemptedRegistry(filePath = DEFAULT_ATTEMPTED_REGISTRY_PATH): AttemptedRegistryData {
  if (inMemoryRegistry) return inMemoryRegistry;

  let reg: AttemptedRegistryData = {
    jobIds: {},
    normalizedUrls: {},
    updatedAt: new Date().toISOString(),
  };

  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (data && typeof data.jobIds === 'object' && typeof data.normalizedUrls === 'object') {
        reg = data;
        inMemoryRegistry = reg;
        return reg;
      }
    } catch {}
  }

  // Bootstrap from run-history.jsonl
  if (fs.existsSync(RUN_HISTORY_PATH)) {
    try {
      const lines = fs.readFileSync(RUN_HISTORY_PATH, 'utf8').split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          const jid = String(item.jobId || '').trim();
          const u = String(item.url || item.jobUrl || '').trim();
          const rec: AttemptedRecord = {
            jobId: jid,
            company: String(item.company || 'Unknown'),
            url: u,
            status: String(item.status || 'attempted'),
            attemptedAt: String(item.finishedAt || item.startedAt || new Date().toISOString()),
          };
          if (jid) reg.jobIds[jid] = rec;
          if (u) reg.normalizedUrls[normalizeAttemptUrl(u)] = rec;
        } catch {}
      }
    } catch {}
  }

  // Bootstrap from overnight-errors.jsonl
  if (fs.existsSync(OVERNIGHT_ERRORS_PATH)) {
    try {
      const lines = fs.readFileSync(OVERNIGHT_ERRORS_PATH, 'utf8').split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          const jid = String(item.jobId || '').trim();
          const u = String(item.url || item.jobUrl || '').trim();
          const rec: AttemptedRecord = {
            jobId: jid,
            company: String(item.company || 'Unknown'),
            url: u,
            status: String(item.status || 'failed'),
            attemptedAt: String(item.timestamp || new Date().toISOString()),
          };
          if (jid) reg.jobIds[jid] = rec;
          if (u) reg.normalizedUrls[normalizeAttemptUrl(u)] = rec;
        } catch {}
      }
    } catch {}
  }

  reg.updatedAt = new Date().toISOString();
  saveAttemptedRegistry(reg, filePath);
  inMemoryRegistry = reg;
  return reg;
}

export function saveAttemptedRegistry(registry: AttemptedRegistryData, filePath = DEFAULT_ATTEMPTED_REGISTRY_PATH): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    registry.updatedAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(registry, null, 2), 'utf8');
    inMemoryRegistry = registry;
  } catch {}
}

export function isJobAlreadyAttempted(jobId: string, url: string, registry?: AttemptedRegistryData): boolean {
  const reg = registry || loadAttemptedRegistry();
  // Completed/submitted jobs are never re-attempted
  if (jobId && reg.jobIds[jobId]?.status === 'applied') return true;
  if (url) {
    const norm = normalizeAttemptUrl(url);
    if (reg.normalizedUrls[norm]?.status === 'applied') return true;
  }
  // Strategy-Mutating 2-Attempt Escalation (Ticket GEN-57 & GEN-62)
  const attemptCount = getJobAttemptCount(jobId);
  if (attemptCount >= 2) return true;
  if (jobId && reg.jobIds[jobId]) return true;
  if (url && reg.normalizedUrls[normalizeAttemptUrl(url)]) return true;
  return false;
}

export function recordAttemptedJob(entry: {
  jobId: string;
  url: string;
  company: string;
  status: string;
}, filePath = DEFAULT_ATTEMPTED_REGISTRY_PATH): void {
  const attemptCount = getAndIncrementJobAttempt(entry.jobId);
  const reg = loadAttemptedRegistry(filePath);
  const rec: AttemptedRecord = {
    jobId: entry.jobId,
    company: entry.company || 'Unknown',
    url: entry.url || '',
    status: entry.status || 'attempted',
    attemptedAt: new Date().toISOString(),
  };

  // Persist permanently in registry if applied or if max attempts (2) reached
  if (entry.status === 'applied' || attemptCount >= 2) {
    if (entry.jobId) reg.jobIds[entry.jobId] = rec;
    if (entry.url) reg.normalizedUrls[normalizeAttemptUrl(entry.url)] = rec;
    saveAttemptedRegistry(reg, filePath);
  }
}

export function removeAttemptedJob(
  jobId: string,
  url: string,
  filePath = DEFAULT_ATTEMPTED_REGISTRY_PATH
): void {
  const reg = loadAttemptedRegistry(filePath);
  if (jobId && reg.jobIds[jobId]) {
    delete reg.jobIds[jobId];
  }
  const normUrl = normalizeAttemptUrl(url);
  if (normUrl && reg.normalizedUrls[normUrl]) {
    delete reg.normalizedUrls[normUrl];
  }
  saveAttemptedRegistry(reg, filePath);
}

/**
 * Filters out all previously attempted jobs so every job runs at most ONCE.
 * Prunes/marks any still-queued duplicate rows in SQLite as failed or paused_for_review.
 */
export function filterUnattemptedJobs(
  jobs: AutoaplyJobItem[],
  dbPath?: string
): AutoaplyJobItem[] {
  const registry = loadAttemptedRegistry();
  const unattempted: AutoaplyJobItem[] = [];
  const prunedIds: string[] = [];

  for (const job of jobs) {
    const alreadyRun = isJobAlreadyAttempted(job.id, job.jobUrl, registry);
    if (alreadyRun) {
      prunedIds.push(job.id);
    } else {
      unattempted.push(job);
    }
  }

  if (prunedIds.length > 0 && dbPath && fs.existsSync(dbPath)) {
    try {
      const db = new DatabaseSync(dbPath);
      db.exec('PRAGMA busy_timeout = 3000;');
      const stmt = db.prepare(`UPDATE applications SET status = 'failed' WHERE id = ? AND status = 'queued'`);
      for (const id of prunedIds) {
        stmt.run(id);
      }
      db.close();
    } catch {}
  }

  return unattempted;
}
