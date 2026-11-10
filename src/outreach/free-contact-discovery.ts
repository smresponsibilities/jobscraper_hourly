import dns from 'node:dns';
import { resolveMx } from 'node:dns/promises';
import { isSafeOutreachEmailSyntax } from '../../scripts/sync-applied-to-outreach.js';

export const POISON_PREFIXES = [
  'jobs',
  'careers',
  'hr',
  'info',
  'support',
  'legal',
  'privacy',
  'help',
  'contact',
  'admin',
  'billing',
  'sales',
  'marketing',
  'press',
  'media',
  'security',
  'abuse',
  'postmaster',
  'hostmaster',
  'webmaster',
  'no-reply',
  'noreply',
  'notification',
  'hello',
] as const;

export function isPoisonPrefixEmail(email: string): boolean {
  const local = (email.split('@')[0] || '').toLowerCase().trim();
  return POISON_PREFIXES.some((prefix) => local === prefix || local.startsWith(`${prefix}+`) || local.startsWith(`${prefix}.`));
}

export async function verifyDomainMxRecords(domain: string): Promise<boolean> {
  const cleanDomain = (domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || '').trim();
  if (!cleanDomain || cleanDomain.includes('invalid') || cleanDomain.endsWith('.local') || cleanDomain.includes('xyz-123')) {
    return false;
  }
  try {
    const records = await resolveMx(cleanDomain);
    return Array.isArray(records) && records.length > 0;
  } catch {
    return false;
  }
}

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
  orgSlug?: string,
  roleTitle = ''
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
      `https://api.github.com/orgs/${encodeURIComponent(slug)}/repos?sort=pushed&per_page=15`,
      { headers, signal: ctrl.signal }
    ).catch(() => null);
    clearTimeout(timer);
    if (!reposRes || !reposRes.ok) return leads;

    const repos = (await reposRes.json().catch(() => [])) as Array<{ name?: string; full_name?: string; description?: string }>;
    const seenEmails = new Set<string>();

    const tokens = (roleTitle || '')
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length >= 2 && !/^(the|and|for|with|engineer|engineering|software|developer|senior|staff|principal|lead)$/i.test(t));

    const rankedRepos = [...repos].sort((a, b) => {
      const textA = `${a.name || ''} ${a.description || ''}`.toLowerCase();
      const textB = `${b.name || ''} ${b.description || ''}`.toLowerCase();
      let scoreA = 0;
      let scoreB = 0;
      for (const tok of tokens) {
        if (textA.includes(tok)) scoreA++;
        if (textB.includes(tok)) scoreB++;
      }
      return scoreB - scoreA;
    });

    for (const repo of rankedRepos.slice(0, 3)) {
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

export async function discoverPublicWebsiteContacts(
  company: string,
  domain: string
): Promise<DiscoveredContactLead[]> {
  const leads: DiscoveredContactLead[] = [];
  const cleanDomain = (domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || '').trim();
  if (!cleanDomain) return leads;

  const pages = ['/about', '/careers', '/contact', '/team', '/.well-known/security.txt'];
  const seenEmails = new Set<string>();

  for (const pagePath of pages) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3500);
      const res = await fetch(`https://${cleanDomain}${pagePath}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0',
          Accept: 'text/html,text/plain,application/xhtml+xml',
        },
        signal: ctrl.signal,
      }).catch(() => null);
      clearTimeout(timer);

      if (res && res.ok) {
        const text = await res.text().catch(() => '');
        const emailMatches = text.matchAll(/\b([a-zA-Z0-9._%+-]+@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,}))\b/g);
        for (const m of emailMatches) {
          const email = m[1]?.toLowerCase() || '';
          const emailDomain = m[2]?.toLowerCase() || '';
          if (
            email &&
            emailDomain === cleanDomain &&
            isSafeOutreachEmailSyntax(email) &&
            !seenEmails.has(email) &&
            !email.startsWith('security@')
          ) {
            seenEmails.add(email);
            leads.push({
              name: email.split('@')[0] || 'Team',
              email,
              role: 'Public Team Contact',
              company,
              domain: cleanDomain,
              source: 'public_page_osint',
              confidence: 0.88,
              mxVerified: true,
            });
          }
        }
      }
    } catch {}
  }

  return leads;
}
