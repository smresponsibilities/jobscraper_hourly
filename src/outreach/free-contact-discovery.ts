import dns from 'node:dns';
import { isSafeOutreachEmailSyntax } from '../../scripts/sync-applied-to-outreach.js';

export type EmailNamingPattern = 'first.last' | 'first' | 'flast' | 'first_last' | 'unknown';

export interface DiscoveredContactLead {
  name: string;
  email: string;
  role: string;
  company: string;
  domain: string;
  source: 'github_commit_osint' | 'public_page_osint' | 'pattern_permutation' | 'verified_talent_inbox';
  confidence: number;
  mxVerified: boolean;
}

export function inferEmailPatternFromSamples(
  samples: Array<{ name?: string; email: string }>
): EmailNamingPattern {
  for (const s of samples) {
    const local = (s.email.split('@')[0] || '').toLowerCase();
    if (!local) continue;
    if (local.includes('.')) return 'first.last';
    if (local.includes('_')) return 'first_last';
    if (s.name) {
      const parts = s.name
        .toLowerCase()
        .replace(/[^a-z\s]/g, '')
        .trim()
        .split(/\s+/);
      if (parts.length >= 2) {
        const first = parts[0];
        const last = parts[1];
        if (first && last) {
          if (local === `${first}.${last}`) return 'first.last';
          if (local === first) return 'first';
          if (local === `${first[0]}${last}`) return 'flast';
          if (local === `${first}_${last}`) return 'first_last';
        }
      }
    }
  }
  return 'first.last';
}

export function generatePermutedEmail(
  fullName: string,
  domain: string,
  pattern: EmailNamingPattern = 'first.last'
): string | null {
  const parts = String(fullName || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0 || !domain) return null;
  const first = parts[0];
  if (!first) return null;
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  const cleanDomain = (domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || '').trim();
  if (!cleanDomain) return null;

  let candidate = '';
  if (!last || pattern === 'first') candidate = `${first}@${cleanDomain}`;
  else if (pattern === 'flast') candidate = `${first[0]}${last}@${cleanDomain}`;
  else if (pattern === 'first_last') candidate = `${first}_${last}@${cleanDomain}`;
  else candidate = `${first}.${last}@${cleanDomain}`;

  return isSafeOutreachEmailSyntax(candidate) ? candidate : null;
}

export async function verifyDomainDeliverability(domain: string): Promise<{
  hasMx: boolean;
  mxProvider: string;
  hasSpf: boolean;
}> {
  const cleanDomain = (domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || '').trim();
  let hasMx = false;
  let mxProvider = 'none';
  let hasSpf = false;
  if (!cleanDomain) return { hasMx, mxProvider, hasSpf };

  try {
    const mx = await dns.promises.resolveMx(cleanDomain);
    if (Array.isArray(mx) && mx.length > 0) {
      hasMx = true;
      const sorted = mx.slice().sort((a, b) => a.priority - b.priority);
      const topExchange = (sorted[0]?.exchange || '').toLowerCase();
      if (topExchange.includes('google') || topExchange.includes('gmail')) mxProvider = 'google_workspace';
      else if (topExchange.includes('outlook') || topExchange.includes('protection.outlook')) mxProvider = 'microsoft_365';
      else mxProvider = topExchange;
    }
  } catch {}

  try {
    const txtRecords = await dns.promises.resolveTxt(cleanDomain);
    for (const chunks of txtRecords) {
      const joined = chunks.join('');
      if (/v=spf1/i.test(joined)) {
        hasSpf = true;
        break;
      }
    }
  } catch {}

  return { hasMx, mxProvider, hasSpf };
}

export async function discoverGithubOrgCommitContacts(
  company: string,
  domain: string,
  orgSlug?: string
): Promise<DiscoveredContactLead[]> {
  const leads: DiscoveredContactLead[] = [];
  const cleanDomain = (domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || '').trim();
  const slug = (orgSlug || (cleanDomain ? cleanDomain.split('.')[0] : '') || company.toLowerCase().replace(/[^a-z0-9]/g, '') || '').trim();
  if (!slug || !cleanDomain) return leads;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'jobscraper-osint-contact-resolver',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const reposRes = await fetch(
      `https://api.github.com/orgs/${encodeURIComponent(slug)}/repos?sort=pushed&per_page=3`,
      { headers, signal: ctrl.signal }
    ).catch(() => null);
    clearTimeout(timer);
    if (!reposRes || !reposRes.ok) return leads;

    const repos = (await reposRes.json().catch(() => [])) as Array<{ name?: string; full_name?: string }>;
    const seenEmails = new Set<string>();

    for (const repo of repos.slice(0, 2)) {
      if (!repo.full_name) continue;
      const cCtrl = new AbortController();
      const cTimer = setTimeout(() => cCtrl.abort(), 5000);
      const commitsRes = await fetch(
        `https://api.github.com/repos/${repo.full_name}/commits?per_page=20`,
        { headers, signal: cCtrl.signal }
      ).catch(() => null);
      clearTimeout(cTimer);
      if (!commitsRes || !commitsRes.ok) continue;

      const commits = (await commitsRes.json().catch(() => [])) as Array<{
        commit?: { author?: { name?: string; email?: string } };
      }>;
      for (const c of commits) {
        const rawEmail = String(c.commit?.author?.email || '').trim().toLowerCase();
        const rawName = String(c.commit?.author?.name || '').trim();
        if (!rawEmail || seenEmails.has(rawEmail)) continue;
        if (rawEmail.endsWith(`@${cleanDomain}`) && isSafeOutreachEmailSyntax(rawEmail)) {
          seenEmails.add(rawEmail);
          leads.push({
            name: rawName || rawEmail.split('@')[0] || 'Engineering Team',
            email: rawEmail,
            role: 'Engineering Team / Maintainer',
            company,
            domain: cleanDomain,
            source: 'github_commit_osint',
            confidence: 0.96,
            mxVerified: true,
          });
        }
      }
    }
  } catch {
    // Non-fatal OSINT fallback
  }

  return leads;
}
