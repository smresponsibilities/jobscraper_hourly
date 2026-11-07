import * as fs from 'node:fs';
import * as path from 'node:path';
import { resilientFetch } from '../autoapply/tiered-fetcher.js';

export interface DiscoveredStartupLead {
  source: 'yc_hiring_api' | 'hn_who_is_hiring';
  company: string;
  website: string;
  domain: string;
  batch?: string;
  oneLiner?: string;
  roleTitle: string;
  location: string;
  applyUrl: string;
  directEmails: string[];
  ycCompanyUrl?: string;
}

export function extractDeobfuscatedEmails(text: string): string[] {
  const normalized = text
    .replace(/&#x2F;/g, '/')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s*\[\s*at\s*\]\s*|\s*\(\s*at\s*\)\s*|\s+at\s+(?=[a-z0-9-]+\s*(\.|\[dot\]|\(dot\)))/gi, '@')
    .replace(/\s*\[\s*dot\s*\]\s*|\s*\(\s*dot\s*\)\s*/gi, '.');
  const matches = normalized.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,10}/g) || [];
  return [...new Set(matches.map(e => e.toLowerCase()).filter(e => !/example\.com|sentry\.io|w3\.org|ycombinator\.com/i.test(e)))];
}

export async function fetchYcHiringCompanies(): Promise<DiscoveredStartupLead[]> {
  try {
    const res = await resilientFetch('https://yc-oss.github.io/api/companies/hiring.json', {
      headers: { 'User-Agent': 'Jobscraper-Next-Discovery/1.0' },
      timeoutMs: 15000,
    });
    if (!res.ok) return [];
    const companies = (await res.json()) as Array<{
      name: string;
      slug: string;
      website?: string;
      one_liner?: string;
      batch?: string;
      all_locations?: string;
      url?: string;
    }>;
    const leads: DiscoveredStartupLead[] = [];
    for (const c of companies) {
      const loc = c.all_locations || '';
      // Filter for India, Bengaluru, or Remote-friendly YC startups
      if (!/india|bengaluru|bangalore|remote|anywhere|global/i.test(loc + ' ' + (c.one_liner || ''))) continue;
      let domain = '';
      try {
        if (c.website) domain = new URL(c.website).hostname.replace(/^www\./, '');
      } catch {}
      leads.push({
        source: 'yc_hiring_api',
        company: c.name,
        website: c.website || '',
        domain,
        batch: c.batch,
        oneLiner: c.one_liner,
        roleTitle: 'Software Engineer (YC Startup)',
        location: loc || 'Remote / India',
        applyUrl: c.url || `https://www.ycombinator.com/companies/${c.slug}/jobs`,
        directEmails: domain ? [`founders@${domain}`, `careers@${domain}`] : [],
        ycCompanyUrl: `https://www.ycombinator.com/companies/${c.slug}`,
      });
    }
    return leads;
  } catch {
    return [];
  }
}

export async function fetchHnWhoIsHiringLeads(): Promise<DiscoveredStartupLead[]> {
  try {
    const searchUrl = 'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=Who%20is%20hiring&hitsPerPage=5';
    const storyRes = await resilientFetch(searchUrl, {
      headers: { 'User-Agent': 'Jobscraper-Next-Discovery/1.0' },
      timeoutMs: 15000,
    });
    if (!storyRes.ok) return [];
    const storyJson = (await storyRes.json()) as { hits: Array<{ objectID: string; title: string }> };
    const thread = storyJson.hits.find(h => /ask hn:\s*who is hiring/i.test(h.title));
    if (!thread) return [];

    const commentsUrl = `https://hn.algolia.com/api/v1/search_by_date?tags=comment,story_${thread.objectID}&hitsPerPage=500`;
    const commRes = await resilientFetch(commentsUrl, {
      headers: { 'User-Agent': 'Jobscraper-Next-Discovery/1.0' },
      timeoutMs: 20000,
    });
    if (!commRes.ok) return [];
    const commJson = (await commRes.json()) as {
      hits: Array<{ objectID: string; parent_id: number; comment_text?: string }>;
    };

    const leads: DiscoveredStartupLead[] = [];
    for (const hit of commJson.hits) {
      if (String(hit.parent_id) !== String(thread.objectID) || !hit.comment_text) continue;
      const text = hit.comment_text;
      if (!/\b(remote|india|bengaluru|bangalore|worldwide|global|anywhere)\b/i.test(text)) continue;
      if (!/\b(software|backend|full[- ]?stack|data|platform|engineer|developer|python|java|typescript)\b/i.test(text)) continue;

      const firstLine = text.split(/<p>|\n/i)[0]!.replace(/<[^>]+>/g, '').trim();
      const parts = firstLine.split('|').map(p => p.trim());
      const company = parts[0]?.slice(0, 80) || 'HN Startup';
      const roleTitle = parts[1]?.slice(0, 100) || 'Software Engineer';
      const location = parts[2]?.slice(0, 80) || 'Remote';
      const urls = text.match(/https?:\/\/[^\s"<>)']+/g) || [];
      const applyUrl = urls.find(u => /greenhouse|ashbyhq|lever\.co|workatastartup|myworkdayjobs|workable|careers|jobs/i.test(u)) || urls[0] || `https://news.ycombinator.com/item?id=${hit.objectID}`;
      const directEmails = extractDeobfuscatedEmails(text);
      let domain = '';
      if (directEmails[0]) {
        domain = directEmails[0].split('@')[1]!;
      } else if (urls[0]) {
        try {
          const host = new URL(urls[0]).hostname.replace(/^www\./, '');
          if (!/ycombinator|greenhouse|lever\.co|ashbyhq|workatastartup/i.test(host)) domain = host;
        } catch {}
      }

      leads.push({
        source: 'hn_who_is_hiring',
        company,
        website: domain ? `https://${domain}` : applyUrl,
        domain,
        roleTitle,
        location,
        applyUrl,
        directEmails,
      });
    }
    return leads;
  } catch {
    return [];
  }
}

/**
 * Step 17.2: Probes Greenhouse, Ashby, and Lever APIs for a startup slug.
 * Returns the detected ATS platform and job board URL if active.
 */
export async function probeStartupAts(slug: string): Promise<{ ats: 'greenhouse' | 'ashby' | 'lever'; boardUrl: string; sampleJobUrl?: string } | null> {
  const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!cleanSlug || cleanSlug.length < 2) return null;

  // 1. Greenhouse
  try {
    const ghRes = await fetch(`https://boards-api.greenhouse.io/v1/boards/${cleanSlug}/jobs`, {
      method: 'GET',
      headers: { 'User-Agent': 'Jobscraper-Next/1.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (ghRes.ok) {
      const data = await ghRes.json() as { jobs?: Array<{ id: number; absolute_url: string; title: string }> };
      if (Array.isArray(data.jobs) && data.jobs.length > 0) {
        const engJob = data.jobs.find((j: any) => /engineer|developer|software/i.test(j.title)) || data.jobs[0];
        return { ats: 'greenhouse', boardUrl: `https://boards.greenhouse.io/${cleanSlug}`, sampleJobUrl: engJob?.absolute_url };
      }
    }
  } catch {}

  // 2. Ashby
  try {
    const ashbyRes = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${cleanSlug}`, {
      method: 'GET',
      headers: { 'User-Agent': 'Jobscraper-Next/1.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (ashbyRes.ok) {
      const data = await ashbyRes.json() as { jobs?: Array<{ id: string; jobUrl?: string; applyUrl?: string; title: string }> };
      if (Array.isArray(data.jobs) && data.jobs.length > 0) {
        const engJob = data.jobs.find((j: any) => /engineer|developer|software/i.test(j.title)) || data.jobs[0];
        const jobUrl = engJob?.jobUrl || (engJob?.id ? `https://jobs.ashbyhq.com/${cleanSlug}/${engJob.id}` : undefined);
        return { ats: 'ashby', boardUrl: `https://jobs.ashbyhq.com/${cleanSlug}`, sampleJobUrl: jobUrl };
      }
    }
  } catch {}

  // 3. Lever
  try {
    const leverRes = await fetch(`https://api.lever.co/v0/postings/${cleanSlug}?mode=json`, {
      method: 'GET',
      headers: { 'User-Agent': 'Jobscraper-Next/1.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (leverRes.ok) {
      const data = await leverRes.json() as Array<{ id: string; hostedUrl?: string; applyUrl?: string; text: string }>;
      if (Array.isArray(data) && data.length > 0) {
        const engJob = data.find((j: any) => /engineer|developer|software/i.test(j.text)) || data[0];
        return { ats: 'lever', boardUrl: `https://jobs.lever.co/${cleanSlug}`, sampleJobUrl: engJob?.hostedUrl || engJob?.applyUrl };
      }
    }
  } catch {}

  return null;
}
