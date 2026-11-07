import { classify } from '../classify.js';
import { INDIA, MAX_YEARS } from '../config.js';
import { isServiceCompany, locationMatches } from '../filter.js';
import { toPlainText } from '../fetchers/util.js';
import { canonicalRequisition, sameRequisition, type RequisitionIdentity } from './identity.js';
import type { CandidateExtendedProfile } from './types.js';

export interface IntakeJob {
  id?: string;
  externalJobId?: string;
  title: string;
  company: string;
  url?: string;
  jobUrl?: string;
  location?: string;
  postedAt?: string;
  lastSeen?: string;
  closedAt?: string;
  text?: string;
  minYears?: number | null;
}

export interface PreflightResult {
  status: 'eligible' | 'skipped' | 'retry';
  reason: string;
  identity?: RequisitionIdentity;
  description?: string;
  checkedAt: string;
}

export function exceedsExperienceGate(description: string, title = ''): boolean {
  const words: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const text = description.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b(?=\s*(?:(?:\+|[-–—]|to)\s*\d+|or\s+more)?\s*(?:years?|yrs?)\b)/gi, word => String(words[word.toLowerCase()])).replace(/\b(\d+)\s+or\s+more\s+(years?|yrs?)\b/gi, '$1+ $2');
  return (classify({ externalId: '', title, url: '', location: 'India', text }, 'tech').minYears ?? 0) > MAX_YEARS;
}

export function isAtsRootUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (/^(?:jobs\.lever\.co|boards\.greenhouse\.io|jobs\.ashbyhq\.com|jobs\.smartrecruiters\.com)$/i.test(host)) {
      return parts.length <= 1;
    }
    if (host.endsWith('.myworkdayjobs.com')) {
      return !parsed.pathname.includes('/job/');
    }
    return false;
  } catch {
    return false;
  }
}

export const UNSUPPORTED_PROPRIETARY_PORTAL_REGEX = /(?:google\.com\/about\/careers|metacareers\.com|facebook\.com\/careers|jobs\.apple\.com|amazon\.jobs|careers\.microsoft\.com|jobs\.sap\.com|ibm\.com\/careers|oracle\.com\/careers|oraclecloud\.com|successfactors\.com|jobs\.mahindra\.com|ycombinator\.com\/companies\/|linkedin\.com\/jobs\/view\/|news\.ycombinator\.com|turbohire\.co|careers\.bajajauto\.com|jobs\.mahindracareers\.com|eightfold\.ai)/i;

export function isUnsupportedProprietaryPortal(urlStr: string): boolean {
  return UNSUPPORTED_PROPRIETARY_PORTAL_REGEX.test(urlStr);
}

/** No browser, credentials or candidate details are sent to public job endpoints. */
export async function preflightJob(job: IntakeJob, profile: CandidateExtendedProfile, options: {
  latestPollAt?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
} = {}): Promise<PreflightResult> {
  const url = job.url || job.jobUrl;
  const checkedAt = new Date().toISOString();
  if (!url || !URL.canParse(url) || !['https:', 'http:'].includes(new URL(url).protocol)) return { status: 'skipped', reason: 'invalid_application_url', checkedAt };
  if (isAtsRootUrl(url)) {
    return { status: 'skipped', reason: 'board_root_not_requisition', checkedAt };
  }
  if (isUnsupportedProprietaryPortal(url)) {
    return { status: 'skipped', reason: 'Unsupported proprietary SSO/SAP portal', checkedAt };
  }
  const identity = canonicalRequisition(url, job.id || job.externalJobId);
  const result = (status: PreflightResult['status'], reason: string, description?: string): PreflightResult => ({ status, reason, identity, description, checkedAt });
  const urlIdentity = canonicalRequisition(url);
  if (identity && urlIdentity && !sameRequisition(identity, urlIdentity)) return result('skipped', 'requisition_identity_mismatch');
  if (job.closedAt) return result('skipped', 'closed_in_catalogue');
  if (options.latestPollAt && (!job.lastSeen || !Number.isFinite(Date.parse(job.lastSeen)) || Date.parse(job.lastSeen) < Date.parse(options.latestPollAt))) return result('skipped', 'stale_catalogue_entry');
  if (job.title && !/\b(?:software|sde|swe|developer|data|machine learning|ml|backend|back[- ]end|full[- ]stack|frontend|front[- ]end|web|mobile|android|ios|systems|infrastructure|qa|quality assurance|sdet|test|platform|devops|cloud|security|ai|engineer(?:ing)?|graduate engineer(?:ing)?)\b/i.test(job.title)) return result('skipped', 'ineligible_role');
  if (job.title && /\b(?:senior|sr\.?|staff|principal|lead|manager|director|head|vp|vice president|architect)\b/i.test(job.title)) return result('skipped', 'ineligible_senior_role');
  if (job.company && isServiceCompany(job.company)) return result('skipped', 'ineligible_service_company');

  const request = options.fetcher || fetch;
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000);
  let description = job.text || '';
  let location = job.location || '';
  let title = job.title;
  try {
    let endpoint: string | undefined;
    if (identity?.provider === 'greenhouse') endpoint = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(identity.tenant)}/jobs/${encodeURIComponent(identity.jobId)}`;
    if (identity?.provider === 'lever') endpoint = `https://api.lever.co/v0/postings/${encodeURIComponent(identity.tenant)}/${encodeURIComponent(identity.jobId)}`;
    if (identity?.provider === 'ashby') endpoint = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(identity.tenant)}`;
    if (identity?.provider === 'recruitee') endpoint = `https://${identity.tenant}.recruitee.com/api/offers/${encodeURIComponent(identity.jobId)}`;
    if (identity?.provider === 'smartrecruiters') endpoint = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(identity.tenant)}/postings/${encodeURIComponent(identity.jobId)}`;
    if (identity?.provider === 'workday') {
      const parsed = new URL(url);
      const parts = parsed.pathname.split('/').filter(Boolean);
      const site = /^[a-z]{2}-[A-Z]{2}$/.test(parts[0] || '') ? parts[1] : parts[0];
      if (site && parsed.pathname.includes('/job/')) endpoint = `${parsed.origin}/wday/cxs/${encodeURIComponent(identity.tenant)}/${encodeURIComponent(site)}${parsed.pathname.slice(parsed.pathname.indexOf('/job/')).replace(/\/apply(?:\/.*)?$/, '')}`;
    }
    const response = await request(endpoint || url, { signal, headers: { Accept: endpoint ? 'application/json' : 'text/html' }, redirect: 'follow' });
    if ([404, 410].includes(response.status)) return result('skipped', 'closed_at_source');
    if (!response.ok) return result('retry', `source_http_${response.status}`);
    if (endpoint) {
      let data = await response.json() as any;
      if (identity?.provider === 'ashby') {
        if (!Array.isArray(data.jobs)) return result('retry', 'unrecognized_source_schema');
        data = data.jobs.find((entry: any) => String(entry.id) === identity.jobId);
        if (!data || data.isListed === false) return result('skipped', 'closed_at_source');
      }
      if (identity?.provider === 'recruitee') data = data.offer;
      if (identity?.provider === 'workday') data = data.jobPostingInfo;
      if (!data || typeof data !== 'object') return result('retry', 'unrecognized_source_schema');
      if (identity?.provider === 'smartrecruiters' && data.active === false) return result('skipped', 'closed_at_source');
      if (data.isListed === false || data.published === false || data.closed === true) return result('skipped', 'closed_at_source');
      description = data.descriptionPlain || data.jobDescription || data.content || data.description || description;
      if (Array.isArray(data.lists)) description += '\n' + data.lists.map((entry: any) => `${entry.text || ''} ${entry.content || ''}`).join('\n');
      if (data.jobAd?.sections) description += '\n' + Object.values(data.jobAd.sections).map((entry: any) => entry?.text || '').join('\n');
      location = typeof data.location === 'string' ? data.location : data.location?.name || data.categories?.location || data.location?.city || location;
      title = data.title || data.text || title;
    } else {
      const html = await response.text();
      // Restrict closure detection to rendered headline/explicit JSON-LD, not JS templates.
      const headline = [...html.matchAll(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/gi)].map(match => toPlainText(match[1] || '')).join(' ');
      if (/this job is no longer available|position (?:has been|is) (?:filled|closed)|job (?:has )?expired/i.test(headline)) return result('skipped', 'closed_at_source');
      for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
        try {
          const parsed = JSON.parse(match[1]!);
          const entries = Array.isArray(parsed) ? parsed : parsed['@graph'] || [parsed];
          const posting = entries.find((entry: any) => entry['@type'] === 'JobPosting');
          if (posting) {
            if (posting.validThrough && Date.parse(posting.validThrough) < Date.now()) return result('skipped', 'closed_at_source');
            description = posting.description || description;
            title = posting.title || title;
          }
        } catch { /* Other schema blocks do not establish job state. */ }
      }
      if (!description) return result('retry', 'liveness_requires_browser_review');
    }
  } catch (error) {
    return result('retry', options.signal?.aborted ? 'cancelled' : 'source_unavailable');
  }
  description = toPlainText(description.replace(/&#x([\da-f]+);/gi, (_, value: string) => {
    const code = Number.parseInt(value, 16);
    return code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
  }));
  if (!description.trim()) return result('retry', 'source_description_missing');
  if (/\b(?:must|required to)\s+(?:be\s+)?(?:a\s+)?(?:u\.?s\.?|united states)\s+citizen|\b(?:active|current|required)\s+(?:ts\/sci|top secret)\b/i.test(description)) return result('skipped', 'ineligible_jd_citizenship_or_clearance', description);
  if (!locationMatches(location)) return result('skipped', 'ineligible_jd_location', description);
  // Bare "Remote" does not establish that the employer hires from India.
  if (!INDIA.test(location) && !/\b(?:worldwide|global|anywhere)\b/i.test(location)) return result('skipped', 'unconfirmed_india_remote', description);
  if (isServiceCompany(job.company)) return result('skipped', 'ineligible_service_company', description);
  if (!/\b(?:software|sde|swe|developer|data|machine learning|ml|backend|back[- ]end|full[- ]stack|graduate engineer(?:ing)?)\b/i.test(title)) return result('skipped', 'ineligible_role', description);
  if (!/\b(?:senior|sr\.?|staff|principal|lead)\b/i.test(title) && /\bto be successful as (?:an? )?(?:senior|staff|principal|lead)\s+(?:software|data|backend|full[- ]stack)\s+engineer\b/i.test(description)) return result('retry', 'source_role_level_conflict', description);
  const numberWords: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const experienceText = description.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b(?=\s*(?:(?:\+|[-–—]|to)\s*(?:\d{1,2}|zero|one|two|three|four|five|six|seven|eight|nine|ten)|or\s+more)?\s*(?:years?|yrs?)\b)/gi, word => String(numberWords[word.toLowerCase()])).replace(/\b(\d{1,2})\s+or\s+more\s+(years?|yrs?)\b/gi, '$1+ $2');
  const classification = classify({ externalId: identity?.jobId || job.id || '', title, url, location, text: experienceText }, 'tech');
  const minimum = classification.minYears ?? job.minYears;
  // Target eligibility is independent of the truthful experience sent to employers.
  if (minimum != null && minimum > MAX_YEARS) return result('skipped', 'ineligible_jd_experience', description);
  return result('eligible', 'live_and_eligible', description);
}
