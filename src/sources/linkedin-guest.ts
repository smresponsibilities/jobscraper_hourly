import * as fs from 'node:fs';
import * as path from 'node:path';
import { resilientFetch } from '../autoapply/tiered-fetcher.js';

export interface LinkedInGuestJob {
  jobId: string;
  title: string;
  company: string;
  location: string;
  listedAt: string;
  jobUrl: string;
  recruiterName?: string;
  recruiterTitle?: string;
  recruiterProfileUrl?: string;
}

export interface CompanyRegistryEntry {
  name: string;
  ats: string;
  industry?: string;
  source?: string;
  token: string;
}

export interface LinkedInSearchOptions {
  keywords?: string;
  location?: string;
  f_TPR?: string; // 'r3600' (1h), 'r86400' (24h), 'r604800' (7d)
  start?: number;
}

export async function fetchLinkedInGuestJobsPage(
  options: LinkedInSearchOptions = {}
): Promise<LinkedInGuestJob[]> {
  const {
    keywords = 'Software Engineer',
    location = 'India',
    f_TPR = 'r3600',
    start = 0,
  } = options;
  try {
    const params = new URLSearchParams({
      keywords,
      location,
      f_TPR,
      f_E: '1,2', // Entry level (1) & Associate (2)
      start: String(start),
    });
    const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${params.toString()}`;
    const res = await resilientFetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeoutMs: 15000,
    });
    if (!res.ok) return [];
    const html = await res.text();
    const cards = html.split(/<li>/i).slice(1);
    const jobs: LinkedInGuestJob[] = [];
    for (const card of cards) {
      const urnMatch = card.match(/data-entity-urn="urn:li:jobPosting:(\d+)"/i);
      const titleMatch = card.match(/class="base-search-card__title"[^>]*>([\s\S]*?)<\/h3>/i);
      const companyMatch = card.match(/class="base-search-card__subtitle"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
      const locMatch = card.match(/class="job-search-card__location"[^>]*>([\s\S]*?)<\/span>/i);
      const timeMatch = card.match(/<time[^>]*datetime="([^"]+)"/i);
      if (!urnMatch?.[1] || !titleMatch?.[1]) continue;
      const jobId = urnMatch[1];
      jobs.push({
        jobId,
        title: titleMatch[1].replace(/<[^>]+>/g, '').trim(),
        company: (companyMatch?.[1] || 'Unknown').replace(/<[^>]+>/g, '').trim(),
        location: (locMatch?.[1] || location).replace(/<[^>]+>/g, '').trim(),
        listedAt: timeMatch?.[1] || new Date().toISOString(),
        jobUrl: `https://www.linkedin.com/jobs/view/${jobId}`,
      });
    }
    return jobs;
  } catch {
    return [];
  }
}

export async function fetchLinkedInLastHourJobs(
  keywords = 'Software Engineer',
  location = 'India'
): Promise<LinkedInGuestJob[]> {
  return fetchLinkedInGuestJobsPage({ keywords, location, f_TPR: 'r3600', start: 0 });
}

export async function fetchLinkedInBackfillJobs(params?: {
  keywordsList?: string[];
  location?: string;
  timeRanges?: string[]; // ['r86400', 'r604800']
  pages?: number[]; // [0, 25, 50, 75]
}): Promise<LinkedInGuestJob[]> {
  const keywordsList = params?.keywordsList || [
    'Software Engineer',
    'Backend Engineer',
    'Full Stack Engineer',
    'Data Engineer',
  ];
  const location = params?.location || 'India';
  const timeRanges = params?.timeRanges || ['r86400', 'r604800'];
  const pages = params?.pages || [0, 25, 50, 75];

  const seenIds = new Set<string>();
  const allJobs: LinkedInGuestJob[] = [];

  for (const f_TPR of timeRanges) {
    for (const kw of keywordsList) {
      for (const start of pages) {
        try {
          const pageJobs = await fetchLinkedInGuestJobsPage({
            keywords: kw,
            location,
            f_TPR,
            start,
          });
          for (const j of pageJobs) {
            if (!seenIds.has(j.jobId)) {
              seenIds.add(j.jobId);
              allJobs.push(j);
            }
          }
          await new Promise(r => setTimeout(r, 300));
        } catch {}
      }
    }
  }
  return allJobs;
}

export async function enrichLinkedInGuestJobDetail(job: LinkedInGuestJob): Promise<LinkedInGuestJob> {
  try {
    const res = await resilientFetch(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${job.jobId}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      },
      timeoutMs: 10000,
    });
    if (!res.ok) return job;
    const html = await res.text();
    // Extract Hiring Team / Recruiter Name & Title from public job card if present
    const posterName = html.match(/class="base-main-card__title"[^>]*>([\s\S]*?)<\/h3>/i)?.[1]?.replace(/<[^>]+>/g, '').trim();
    const posterTitle = html.match(/class="base-main-card__subtitle"[^>]*>([\s\S]*?)<\/h4>/i)?.[1]?.replace(/<[^>]+>/g, '').trim();
    const posterUrl = html.match(/href="(https:\/\/[a-z]+\.linkedin\.com\/in\/[^"?]+)"/i)?.[1];
    return {
      ...job,
      recruiterName: posterName || undefined,
      recruiterTitle: posterTitle || undefined,
      recruiterProfileUrl: posterUrl || undefined,
    };
  } catch {
    return job;
  }
}

let cachedCompaniesRegistry: CompanyRegistryEntry[] | null = null;

export function loadCompanyRegistry(registryPath = path.resolve('companies.json')): CompanyRegistryEntry[] {
  if (cachedCompaniesRegistry) return cachedCompaniesRegistry;
  try {
    if (fs.existsSync(registryPath)) {
      const data = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      if (Array.isArray(data)) {
        cachedCompaniesRegistry = data;
        return data;
      }
    }
  } catch {}
  return [];
}

export function matchLinkedInJobToCompany(
  companyName: string,
  registry: CompanyRegistryEntry[] = loadCompanyRegistry()
): CompanyRegistryEntry | null {
  const norm = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!norm || norm.length < 2) return null;
  return registry.find(c => {
    const cNorm = c.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return cNorm === norm || (cNorm.length >= 4 && (cNorm.startsWith(norm) || norm.startsWith(cNorm)));
  }) || null;
}

export function getCompanyAtsUrl(company: CompanyRegistryEntry): string | null {
  const token = company.token;
  if (!token) return null;
  switch (company.ats.toLowerCase()) {
    case 'greenhouse':
      return `https://boards.greenhouse.io/${token}`;
    case 'ashby':
      return `https://jobs.ashbyhq.com/${token}`;
    case 'lever':
      return `https://jobs.lever.co/${token}`;
    case 'smartrecruiters':
      return `https://jobs.smartrecruiters.com/${token}`;
    case 'workday':
      return token.startsWith('http') ? token : `https://${token}.myworkdayjobs.com/`;
    default:
      return token.startsWith('http') ? token : null;
  }
}

export function appendCompanyRegistry(
  entry: CompanyRegistryEntry,
  registryPath = path.resolve('companies.json')
): boolean {
  const list = loadCompanyRegistry(registryPath);
  const norm = entry.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (list.some(c => c.name.toLowerCase().replace(/[^a-z0-9]/g, '') === norm)) {
    return false;
  }
  list.push(entry);
  cachedCompaniesRegistry = list;
  try {
    fs.writeFileSync(registryPath, JSON.stringify(list, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}
