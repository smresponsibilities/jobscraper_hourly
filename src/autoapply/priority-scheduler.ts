// src/autoapply/priority-scheduler.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
export { isSupportedDirectAtsJobUrl } from './preflight.js';
import { isSupportedDirectAtsJobUrl } from './preflight.js';
import { evaluateCandidateJobFit } from './candidate-fit-filter.js';
import { computeJobSurvivalPriorityScore } from './survival-priority-scorer.js';
import { identifyApplicationAts } from './wizard.js';

export interface QueuedJobCandidate {
  id: string;
  company: string;
  title: string;
  url: string;
  location?: string;
  provider?: string;
  createdAtMs?: number;
  rowId?: number;
  isHourlyFresh?: boolean | number;
  is_hourly_fresh?: number;
  discoveredAt?: string;
  hourlySource?: 'github_hunt' | 'linkedin_1h' | 'yc_hiring' | 'hn_hiring' | string;
  payload?: any;
}

const ISOLATED_TENANTS_REGEX = /\b(stripe|avoca|ssctech|ss&c|paypal)\b/i;

export const INELIGIBLE_ROLE_TITLE_REGEX =
  /\b(senior|sr\.?|staff|principal|lead|manager|director|vp|head of|architect|lv\.?\s*[4-9]|level\s*[4-9]|scrum master|product manager|project manager|marketer|marketing|sales|business develop(?:er|ment)?|account executive|recruiter|talent acquisition|human resources|hr\b|legal|counsel|finance analyst|accountant|copywriter|designer|illustrator|playable ads|data collector|annotator|data collection|licensing specialist|customer support|technical writer)\b/i;

export const HIGH_VALUE_ROLE_TITLE_REGEX =
  /\b(new grad|graduate|entry[- ]level|associate|apprentice|intern|sde\s*1|sde\s*i\b|software engineer\s*1|software engineer\s*i\b|junior|backend|full[- ]?stack|data engineer|software engineer|software developer|ai|ml|machine learning|platform engineer|devops)\b/i;

let cachedOfficeCompanies: Set<string> | null = null;
export function getConfirmedOfficeCompanies(): Set<string> {
  if (cachedOfficeCompanies) return cachedOfficeCompanies;
  const set = new Set<string>();
  try {
    const officesPath = path.resolve('web/public/data/offices.json');
    if (fs.existsSync(officesPath)) {
      const data = JSON.parse(fs.readFileSync(officesPath, 'utf8'));
      for (const off of data.offices || []) {
        if (off.company) set.add(off.company.toLowerCase().trim());
      }
    }
  } catch {}
  cachedOfficeCompanies = set;
  return set;
}

export function isStrictlyIsolatedTenant(company: string, url: string): boolean {
  return ISOLATED_TENANTS_REGEX.test(`${company || ''} ${url || ''}`);
}

export function isEligibleEngineeringRoleTitle(title: string): { eligible: boolean; reason?: string } {
  if (!title || title.trim().length === 0) return { eligible: true };
  if (INELIGIBLE_ROLE_TITLE_REGEX.test(title)) {
    return { eligible: false, reason: `Ineligible role title/level: ${title}` };
  }
  return { eligible: true };
}

export function hasConfirmedOffice(company: string): boolean {
  const companyKey = (company || '').toLowerCase().trim();
  if (!companyKey) return false;
  const offices = getConfirmedOfficeCompanies();
  if (offices.has(companyKey)) return true;
  for (const c of offices) {
    if (c.length < 4) continue;
    if (companyKey === c) return true;
    if (
      companyKey.startsWith(c + ' ') ||
      companyKey.endsWith(' ' + c) ||
      companyKey.includes(' ' + c + ' ') ||
      c.startsWith(companyKey + ' ') ||
      c.endsWith(' ' + companyKey) ||
      c.includes(' ' + companyKey + ' ')
    ) {
      return true;
    }
  }
  return false;
}

export const FILLABLE_ATS_REGEX = /greenhouse\.io|gh_jid=|ashbyhq\.com|lever\.co|myworkdayjobs\.com|smartrecruiters\.com|workable\.com/i;

export function isFillableAtsUrl(url?: string): boolean {
  if (!url) return false;
  return isSupportedDirectAtsJobUrl(url);
}

export function extractJobTimestampMs(candidate: QueuedJobCandidate): { timestampMs: number; source: string } {
  const p = candidate.payload || {};
  // 1. Check explicit ISO/epoch timestamp fields in priority order
  const rawStamps: Array<[string, unknown]> = [
    ['postedAt', p.postedAt],
    ['publishedAt', p.publishedAt],
    ['updated_at', p.updated_at],
    ['first_published', p.first_published],
    ['releasedDate', p.releasedDate],
    ['published_on', p.published_on],
    ['published_at', p.published_at],
    ['published_date', p.published_date],
    ['created_at', p.created_at],
    ['updatedAt', p.updatedAt],
    ['employer_createdAt', p.createdAt],
    ['discoveredAt', candidate.discoveredAt || p.discoveredAt],
    ['scrapedAt', p.scrapedAt],
    ['createdAt', candidate.createdAtMs || p.firstSeenAt],
  ];
  for (const [src, val] of rawStamps) {
    if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
      const timestampMs = val < 1e12 ? val * 1000 : val;
      if (timestampMs <= 8.64e15) return { timestampMs, source: src };
    }
    if (typeof val === 'string' && val.trim()) {
      const numeric = /^\d{10,13}$/.test(val.trim()) ? Number(val) : NaN;
      const parsed = Number.isFinite(numeric) ? (numeric < 1e12 ? numeric * 1000 : numeric) : Date.parse(val);
      if (!Number.isNaN(parsed) && parsed > 0) {
        return { timestampMs: parsed, source: src };
      }
    }
  }
  // 2. Fallback: Extract epoch ms embedded in job ID (e.g. "autoaply_1793777090251_abc" or "job_1793840472834")
  const idMatch = String(candidate.id || '').match(/(?:^|_)(\d{13})(?:_|$)/);
  if (idMatch?.[1]) {
    return { timestampMs: Number(idMatch[1]), source: 'job_id_epoch' };
  }
  return { timestampMs: 0, source: 'rowid_only' };
}

export function computeJobPriorityScore(job: QueuedJobCandidate, nowMs = Date.now()): number {
  let score = 0;

  const provider = (() => { try { return identifyApplicationAts(job.url); } catch { return 'unknown'; } })();
  score += computeJobSurvivalPriorityScore({ provider, publishedAt: job.payload?.publishedAt ?? job.payload?.postedAt ?? job.payload?.published_at ?? job.payload?.published_on, location: job.location || job.payload?.location }, nowMs).totalScore;

  // Candidate Precision Fit Bonus (GEN-175: Bengaluru +5000, India +3500, Junior tech +3000)
  const loc = job.location || job.payload?.location || '';
  const fit = evaluateCandidateJobFit({
    company: job.company,
    title: job.title,
    location: loc,
    url: job.url,
  });
  if (fit.priorityBonus > 0) {
    score += fit.priorityBonus;
  }

  // Also tie-break by SQLite rowId / timestamp so newer DB inserts always beat older ones
  const rId = job.rowId ?? job.payload?.rowId ?? 0;
  score += Math.min(900, Math.floor(rId / 25));

  // 2. Role Match Score (+400 for exact target SWE/Data/Backend/NewGrad roles)
  if (HIGH_VALUE_ROLE_TITLE_REGEX.test(job.title || '')) score += 400;
  if (/\b(new grad|associate|intern|apprentice|i\b|1\b|junior)\b/i.test(job.title || '')) score += 300;

  // 3. Confirmed Bengaluru / India Office Score (+350 pts from office-directory.yml)
  if (hasConfirmedOffice(job.company)) {
    score += 350;
  }

  // 4. Direct ATS URL Reliability Score (+250 for direct Greenhouse/Ashby boards)
  const u = (job.url || '').toLowerCase();
  if (u.includes('boards.greenhouse.io') || u.includes('job-boards.greenhouse.io')) score += 250;
  else if (u.includes('jobs.ashbyhq.com')) score += 240;
  else if (u.includes('gh_jid=')) score += 220; // Will be unwrapped to direct embed URL by GEN-49!
  else if (u.includes('myworkdayjobs.com')) score += 150;
  else if (u.includes('jobs.lever.co')) score += 100;

  // GEN-469: India GCC / Confirmed Bengaluru Office Priority Boost (+1500 points)
  const compDomain = job.payload?.domain || job.payload?.companyDomain || job.url;
  if (isIndiaGccOrConfirmedOffice(job.company, compDomain)) {
    score += 1500;
  }

  // Priority Boost for GitHub Actions Hunt Catalog jobs (hunt.yml / github_hunt)
  const isHunt = job.id?.startsWith('hunt_') ||
    job.payload?.hourlySource === 'github_hunt' ||
    job.payload?.source === 'github_hunt' ||
    Boolean(job.isHourlyFresh);
  if (isHunt) {
    score += 50000;
  }

  return score;
}

let cachedGccDomains: Set<string> | null = null;
export function getIndiaGccDomains(): Set<string> {
  if (cachedGccDomains) return cachedGccDomains;
  const set = new Set<string>();
  const paths = [
    path.resolve('domains-gcc.txt'),
    path.resolve('domains-gcc2.txt'),
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      try {
        const lines = fs.readFileSync(p, 'utf8').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const dom = trimmed.split(',')[0]!.trim().toLowerCase();
          if (dom) set.add(dom);
        }
      } catch {}
    }
  }
  cachedGccDomains = set;
  return set;
}

export function isIndiaGccOrConfirmedOffice(company: string, domainOrUrl?: string): boolean {
  if (hasConfirmedOffice(company)) return true;
  const gcc = getIndiaGccDomains();
  const cleanComp = (company || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  if (domainOrUrl) {
    let host = domainOrUrl.toLowerCase().trim();
    try {
      if (host.startsWith('http://') || host.startsWith('https://')) {
        host = new URL(host).hostname;
      }
    } catch {}
    host = host.replace(/^www\./, '');
    if (gcc.has(host)) return true;
    for (const d of gcc) {
      if (host.endsWith('.' + d) || host === d) return true;
    }
  }

  for (const d of gcc) {
    const slug = d.split('.')[0]!;
    if (slug.length >= 4 && cleanComp.includes(slug)) return true;
  }
  return false;
}

export function normalizeCompanyRoleSignature(company: string, roleTitle: string): string {
  const c = (company || '')
    .toLowerCase()
    .replace(/\b(india|pvt|ltd|llc|inc|corp|corporation|technologies|labs)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
  const r = (roleTitle || '')
    .toLowerCase()
    .replace(/\(\s*(?:req(?:uisition)?|job)\s*(?:id|#|no\.?|number)?\s*[:#-]?\s*[a-z0-9-]+\s*\)/g, '')
    .replace(/\s*\[[\w-]+\]/g, '')
    .replace(/\b(india|bengaluru|bangalore|remote|hybrid|hyderabad|pune)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
  return `${c}::${r}`;
}

export function isAlreadyAppliedSameCompanyRoleWithin30Days(
  company: string,
  roleTitle: string,
  appliedRows: Array<{ company?: string; title?: string; appliedAt?: string; payload?: string | any }>,
  nowMs = Date.now()
): boolean {
  if (!company?.trim() || !roleTitle?.trim()) {
    return false;
  }
  const targetSig = normalizeCompanyRoleSignature(company, roleTitle);
  if (targetSig.startsWith('::') || targetSig.endsWith('::')) return false;
  const thirtyDaysMs = 30 * 86_400_000;

  for (const row of appliedRows) {
    let rowComp = row.company;
    let rowTitle = row.title;
    let appliedAt = row.appliedAt;

    if (row.payload) {
      try {
        const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
        rowComp = rowComp || p.company;
        rowTitle = rowTitle || p.title;
        appliedAt = appliedAt || p.appliedAt || p.updatedAt || p.submittedAt;
      } catch {}
    }

    if (!rowComp || !rowTitle) continue;
    const rowSig = normalizeCompanyRoleSignature(rowComp, rowTitle);
    if (rowSig === targetSig) {
      if (appliedAt) {
        const ms = Date.parse(appliedAt);
        if (!isNaN(ms)) {
          if (nowMs - ms <= thirtyDaysMs) {
            return true;
          }
          continue;
        }
      }
      return true;
    }
  }
  return false;
}
