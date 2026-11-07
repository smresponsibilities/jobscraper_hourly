// src/autoapply/priority-scheduler.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isSupportedDirectAtsJobUrl } from './preflight.js';

export interface QueuedJobCandidate {
  id: string;
  company: string;
  title: string;
  url: string;
  provider?: string;
  createdAtMs?: number;
  rowId?: number;
  isHourlyFresh?: boolean;
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

export function computeJobPriorityScore(job: QueuedJobCandidate, nowMs = Date.now()): number {
  let score = 0;

  // 0. Hourly Fresh Job Super Priority (+10,000 pts)
  // ONLY grant the +10,000 hourly priority boost when candidate.url is a fillable ATS URL!
  const isFresh = Boolean(
    job.isHourlyFresh ||
    job.payload?.isHourlyFresh ||
    (job.discoveredAt && (nowMs - new Date(job.discoveredAt).getTime()) <= 86400_000) ||
    (job.payload?.discoveredAt && (nowMs - new Date(job.payload.discoveredAt).getTime()) <= 86400_000)
  );
  if (isFresh && isFillableAtsUrl(job.url)) {
    score += 10000;
  }

  // 1. Recency / Freshness Score (Newest jobs get massive priority: up to +2000 pts)
  const createdAt = job.createdAtMs || 0;
  const ageHours = createdAt > 0 ? Math.max(0, (nowMs - createdAt) / 3_600_000) : 999;
  if (ageHours <= 2) score += 2000;       // Posted in last 2 hours!
  else if (ageHours <= 24) score += 1200; // Posted today!
  else if (ageHours <= 72) score += 600;  // Posted in last 3 days
  else score += Math.max(0, 300 - Math.floor(ageHours / 24) * 5);

  // Also tie-break by SQLite rowId / timestamp so newer DB inserts always beat older ones
  score += Math.min(500, Math.floor((job.rowId || 0) / 50));

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

  return score;
}
