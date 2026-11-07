import * as fs from 'node:fs';
import * as path from 'node:path';
import * as dns from 'node:dns/promises';
import type { CandidateExtendedProfile } from '../autoapply/types.js';

export interface EnrichedContactLead {
  company: string;
  domain: string;
  personName?: string;
  personTitle?: string;
  linkedinUrl?: string;
  emails: Array<{
    email: string;
    confidence: number;
    source: 'hn_direct' | 'github_commit_pattern' | 'website_scrape' | 'permutation_mx_verified' | 'role_fallback';
  }>;
  mxProvider: string | null;
}

export interface OutreachDraft {
  company: string;
  roleTitle: string;
  targetEmail: string;
  recipientName?: string;
  recipientTitle?: string;
  subject: string;
  body: string;
  generatedAt: string;
  source: string;
}

const DEFAULT_OUTREACH_PATH = path.resolve('state/autoapply/portal-review/outreach-leads.json');

export const ATS_DOMAINS = /(?:greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|smartrecruiters\.com|workable\.com|bamboohr\.com|breezy\.hr|icims\.com|taleo\.net|recruitee\.com)$/i;

/**
 * Resolves the genuine employer corporate domain, shielding against accidental
 * attribution of ATS vendor domains (e.g. jobs.ashbyhq.com or boards.greenhouse.io).
 */
export async function resolveEmployerDomain(company: string, hintUrlOrDomain?: string): Promise<string> {
  if (hintUrlOrDomain) {
    try {
      const raw = hintUrlOrDomain.startsWith('http') ? hintUrlOrDomain : `https://${hintUrlOrDomain}`;
      const host = new URL(raw).hostname.replace(/^www\./, '').toLowerCase();
      if (!ATS_DOMAINS.test(host) && host.includes('.')) {
        return host;
      }
    } catch {}
  }

  // 1. Lookup in committed contact-sweep index (only accept verified matched === true)
  try {
    const indexPath = path.resolve('state/contact-sweep-index.json');
    if (fs.existsSync(indexPath)) {
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      if (index[company]?.matched === true && index[company]?.domain && !ATS_DOMAINS.test(index[company].domain)) {
        return index[company].domain;
      }
      const norm = company.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const [key, val] of Object.entries(index) as [string, any][]) {
        if (key.toLowerCase().replace(/[^a-z0-9]/g, '') === norm && val?.matched === true && val?.domain && !ATS_DOMAINS.test(val.domain)) {
          return val.domain;
        }
      }
    }
  } catch {}

  // 2. Candidate domain probing via DNS MX
  const slug = company.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (slug) {
    for (const tld of ['.com', '.io', '.ai', '.in', '.co']) {
      const cand = `${slug}${tld}`;
      const mx = await verifyDomainMx(cand);
      if (mx.valid) return cand;
    }
  }

  return `${slug || 'company'}.com`;
}

export async function verifyDomainMx(domain: string): Promise<{ valid: boolean; provider: string | null }> {
  try {
    const records = await dns.resolveMx(domain);
    if (!records || records.length === 0) return { valid: false, provider: null };
    const sorted = records.sort((a, b) => a.priority - b.priority);
    const top = sorted[0]?.exchange?.toLowerCase() || '';
    let provider = 'custom_mx';
    if (/google|googlemail/i.test(top)) provider = 'google_workspace';
    else if (/outlook|protection\.outlook/i.test(top)) provider = 'microsoft_365';
    else if (/protonmail/i.test(top)) provider = 'protonmail';
    else if (/zoho/i.test(top)) provider = 'zoho';
    return { valid: true, provider };
  } catch {
    return { valid: false, provider: null };
  }
}

export const NON_HIRING_EMAILS_REGEX =
  /^(?:security|psirt|vuln|abuse|privacy|legal|dmca|compliance|postmaster|hostmaster|webmaster|support|help|billing|finance|sales|press|media|ir|noreply|no-reply|donotreply|info|contact|admin|partnerships?|partner|investor|investors|bizdev|marketing)@/i;

export const KNOWN_STARTUPS =
  /\b(?:sarvam|firstwork|supabase|aiprise|reacher|loopfour|voltic|epsilon3|cin7|lyra|atomic)\b/i;

export const KNOWN_ENTERPRISES =
  /\b(?:gitlab|clickhouse|shift|uipath|gehc|ge healthcare|general electric|abacus|abacusinsights|headout|tekion|cisco|marvell|nxp|barclays|caterpillar|lilly|airbus|fnz|eisneramper|qualys|lloyds|flexera|movado|nielseniq|google|amazon|microsoft|apple|meta|salesforce|oracle|sap|adobe|uber|spotify|stripe|paypal|intel|ibm|morgan stanley|jpmorgan|goldman|walmart|target|siemens|boeing)\b/i;

export function isHiringEmail(email: string, isStartup = false): boolean {
  if (!email || typeof email !== 'string') return false;
  const lower = email.trim().toLowerCase();
  if (NON_HIRING_EMAILS_REGEX.test(lower)) return false;
  if (!isStartup && /^(?:founders|hello)@/i.test(lower)) return false;
  return true;
}

export function isStartupCompany(company: string, domain?: string, hint?: boolean): boolean {
  if (hint !== undefined) return hint;
  const name = company.toLowerCase().trim();
  const dom = (domain || '').toLowerCase().trim();
  if (KNOWN_ENTERPRISES.test(name) || KNOWN_ENTERPRISES.test(dom)) return false;
  if (KNOWN_STARTUPS.test(name) || KNOWN_STARTUPS.test(dom)) return true;
  return false;
}

/**
 * When scraping /.well-known/security.txt, use it ONLY to verify the canonical employer domain,
 * never as a recipient address.
 */
export async function verifyDomainViaSecurityTxt(domain: string): Promise<string | null> {
  const cleanDomain = domain.toLowerCase().replace(/^www\./, '');
  try {
    const res = await fetch(`https://${cleanDomain}/.well-known/security.txt`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept': 'text/plain,*/*',
      },
      signal: AbortSignal.timeout(4000),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const text = await res.text();
    const canonicalMatch = text.match(/Canonical:\s*https?:\/\/([^/\s]+)/i);
    if (canonicalMatch?.[1]) {
      return canonicalMatch[1].replace(/^www\./, '').toLowerCase();
    }
    const contactMatch = text.match(/Contact:\s*(?:mailto:)?([a-zA-Z0-9._%+-]+@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,10}))/i);
    if (contactMatch?.[2]) {
      return contactMatch[2].replace(/^www\./, '').toLowerCase();
    }
    return cleanDomain;
  } catch {
    return null;
  }
}

/**
 * Layer 1: Website Careers Page Scraper for published corporate hiring contact emails.
 * Security.txt is strictly excluded from recipient addresses.
 * Form placeholder emails (e.g. placeholder="john@domain.com") and contact/sales paths are excluded.
 */
export async function scrapeWebsiteSecurityAndCareersEmails(domain: string, isStartup = false): Promise<string[]> {
  const cleanDomain = domain.toLowerCase().replace(/^www\./, '');
  // Note: /.well-known/security.txt and /contact are deliberately NOT scraped for outreach contacts (Ticket GEN-21)
  const paths = ['/careers', '/jobs', '/about'];
  const emails = new Set<string>();

  for (const p of paths) {
    try {
      const res = await fetch(`https://${cleanDomain}${p}`, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          'Accept': 'text/html,text/plain,*/*',
        },
        signal: AbortSignal.timeout(4000),
        redirect: 'follow',
      });
      if (!res.ok) continue;
      const rawText = await res.text();

      // Extract explicit mailto links first
      const mailtoMatches = [...rawText.matchAll(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,10})/gi)].map(m => m[1]!);

      // Strip script, style, inputs, textareas, and placeholder attributes to prevent dummy form examples from being extracted
      const sanitizedText = rawText
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<input[^>]*>/gi, ' ')
        .replace(/<textarea[^>]*>/gi, ' ')
        .replace(/placeholder=["'][^"']*["']/gi, ' ')
        .replace(/<[^>]+>/g, ' ');

      const textMatches = sanitizedText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,10}/g) || [];
      const combined = [...mailtoMatches, ...textMatches];

      for (const m of combined) {
        const lower = m.toLowerCase().trim();
        // Discard generic placeholder names like john@, jane@, user@, someone@, etc.
        if (/^(?:john|jane|user|someone|you|yourname|name|test)@/i.test(lower)) continue;
        if (
          lower.endsWith(`@${cleanDomain}`) &&
          isHiringEmail(lower, isStartup) &&
          !lower.includes('example.com')
        ) {
          emails.add(lower);
        }
      }
    } catch {}
  }
  return [...emails];
}

/**
 * Layer 2: GitHub public org events scraper for real @domain commit author emails and pattern detection.
 */
export async function discoverGithubOrgEmailsAndPattern(
  orgSlug: string,
  domain: string
): Promise<{ observedEmails: string[]; detectedPattern: 'first' | 'first.last' | 'flast' | null }> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'Jobscraper-Lead-Enricher/1.0',
  };
  if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
  const observed = new Set<string>();

  try {
    const res = await fetch(`https://api.github.com/orgs/${encodeURIComponent(orgSlug)}/events?per_page=30`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const events = (await res.json()) as Array<{
        payload?: { commits?: Array<{ author?: { email?: string; name?: string } }> };
      }>;
      for (const ev of events) {
        for (const c of ev.payload?.commits || []) {
          const email = (c.author?.email || '').toLowerCase().trim();
          if (email.endsWith(`@${domain.toLowerCase()}`) && isHiringEmail(email)) {
            observed.add(email);
          }
        }
      }
    }
  } catch {}

  const list = [...observed];
  let detectedPattern: 'first' | 'first.last' | 'flast' | null = null;
  if (list.some(e => e.split('@')[0]!.includes('.'))) detectedPattern = 'first.last';
  else if (list.length > 0) detectedPattern = 'first';
  return { observedEmails: list, detectedPattern };
}

/**
 * Layer 3: DuckDuckGo Lite X-Ray search for recruiter, engineering manager, or founder names.
 */
export async function searchDuckDuckGoLiteRecruiter(
  company: string
): Promise<{ firstName: string; lastName: string; roleTitle: string; linkedinUrl: string } | null> {
  try {
    const query = `site:linkedin.com/in/ "${company}" ("Technical Recruiter" OR "Talent Acquisition" OR "Engineering Manager" OR "Founder" OR "CTO") ("Bengaluru" OR "India")`;
    const res = await fetch('https://lite.duckduckgo.com/lite/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      },
      body: new URLSearchParams({ q: query }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const linkMatch = html.match(/href="?(https:\/\/[a-z]+\.linkedin\.com\/in\/[^"&\s]+)"?/i);
    const titleMatch = html.match(/class="result-link"[^>]*>([\s\S]*?)<\/a>/i);
    if (linkMatch && titleMatch) {
      const rawTitle = titleMatch[1]!.replace(/<[^>]+>/g, '').trim();
      const parts = rawTitle.split(/[-–|]/).map(p => p.trim());
      const namePart = parts[0] || '';
      const nameTokens = namePart.split(/\s+/);
      if (nameTokens.length >= 2) {
        return {
          firstName: nameTokens[0]!,
          lastName: nameTokens.slice(1).join(' '),
          roleTitle: parts[1] || 'Technical Recruiter',
          linkedinUrl: linkMatch[1]!,
        };
      }
    }
  } catch {}
  return null;
}

/**
 * Layer 4: Smart email permutation generator.
 */
export function generateEmailPermutations(
  firstName: string,
  lastName: string,
  domain: string,
  preferredPattern: 'first' | 'first.last' | 'flast' | null = null
): Array<{ email: string; confidence: number }> {
  const f = firstName.toLowerCase().replace(/[^a-z]/g, '');
  const l = lastName.toLowerCase().replace(/[^a-z]/g, '');
  if (!f || !domain) return [];
  const cleanDomain = domain.toLowerCase().replace(/^www\./, '');

  const candidates = [
    { pattern: 'first', email: `${f}@${cleanDomain}`, confidence: preferredPattern === 'first' ? 0.92 : 0.80 },
    ...(l
      ? [
          { pattern: 'first.last', email: `${f}.${l}@${cleanDomain}`, confidence: preferredPattern === 'first.last' ? 0.94 : 0.85 },
          { pattern: 'flast', email: `${f[0]}${l}@${cleanDomain}`, confidence: preferredPattern === 'flast' ? 0.90 : 0.72 },
        ]
      : []),
  ];
  return candidates.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Ticket GEN-19 & GEN-21: 5-Layer Multi-Source Lead & Sanitized Email Finder.
 */
export async function findFreeCompanyLeads(params: {
  company: string;
  domain?: string;
  personName?: string;
  personTitle?: string;
  linkedinUrl?: string;
  directEmails?: string[];
  isStartup?: boolean;
}): Promise<EnrichedContactLead> {
  let domain = (await resolveEmployerDomain(params.company, params.domain)).toLowerCase().replace(/^www\./, '');
  if (/^headout/i.test(params.company)) domain = 'headout.com';
  const mx = await verifyDomainMx(domain);
  const emails: EnrichedContactLead['emails'] = [];

  if (!mx.valid) {
    return { company: params.company, domain, emails: [], mxProvider: null };
  }

  const isStartup = isStartupCompany(params.company, domain, params.isStartup);

  // 1. Direct emails (e.g. from HN Who Is Hiring or explicit job posting)
  for (const d of params.directEmails || []) {
    const clean = d.toLowerCase().trim();
    if (isHiringEmail(clean, isStartup)) {
      emails.push({ email: clean, confidence: 0.98, source: 'hn_direct' });
    }
  }

  // 2. Layer 1: Website careers/about page scraper (security.txt strictly excluded from recipient addresses)
  const scraped = await scrapeWebsiteSecurityAndCareersEmails(domain, isStartup);
  for (const s of scraped) {
    if (isHiringEmail(s, isStartup) && !emails.some(x => x.email === s)) {
      emails.push({ email: s, confidence: 0.90, source: 'website_scrape' });
    }
  }

  // 3. Layer 2: GitHub org commit email pattern discovery
  const slug = params.company.toLowerCase().replace(/[^a-z0-9-]/g, '');
  const gh = await discoverGithubOrgEmailsAndPattern(slug, domain);
  for (const e of gh.observedEmails.slice(0, 3)) {
    if (isHiringEmail(e, isStartup) && !emails.some(x => x.email === e)) {
      emails.push({ email: e, confidence: 0.95, source: 'github_commit_pattern' });
    }
  }

  // Determine detected pattern from GitHub or scraped emails
  let effectivePattern = gh.detectedPattern;
  if (!effectivePattern && scraped.some(e => e.split('@')[0]!.includes('.'))) {
    effectivePattern = 'first.last';
  }

  // 4. Layer 3: Discover recruiter / hiring manager if personName is not supplied
  let personName = params.personName;
  let personTitle = params.personTitle;
  let linkedinUrl = params.linkedinUrl;

  if (!personName) {
    const discoveredPerson = await searchDuckDuckGoLiteRecruiter(params.company);
    if (discoveredPerson) {
      personName = `${discoveredPerson.firstName} ${discoveredPerson.lastName}`;
      personTitle = discoveredPerson.roleTitle;
      linkedinUrl = discoveredPerson.linkedinUrl;
    }
  }

  // 5. Layer 4: Person name permutations
  if (personName) {
    const parts = personName.trim().split(/\s+/);
    const first = parts[0] || '';
    const last = parts.length > 1 ? parts[parts.length - 1]! : '';
    for (const perm of generateEmailPermutations(first, last, domain, effectivePattern)) {
      if (isHiringEmail(perm.email, isStartup) && !emails.some(x => x.email === perm.email)) {
        emails.push({ email: perm.email, confidence: perm.confidence, source: 'permutation_mx_verified' });
      }
    }
  }

  // 6. Role fallbacks:
  // For startups: include founders@ and hello@
  // For established/enterprise companies: prioritize talent@, recruiting@, careers@ (never founders@ or hello@)
  const roleFallbacks = isStartup
    ? [`founders@${domain}`, `hello@${domain}`, `talent@${domain}`, `recruiting@${domain}`, `careers@${domain}`]
    : [`talent@${domain}`, `recruiting@${domain}`, `careers@${domain}`];

  for (const fallback of roleFallbacks) {
    if (isHiringEmail(fallback, isStartup) && !emails.some(x => x.email === fallback)) {
      emails.push({ email: fallback, confidence: 0.65, source: 'role_fallback' });
    }
  }

  // Sort candidate emails by confidence descending
  emails.sort((a, b) => b.confidence - a.confidence);

  return {
    company: params.company,
    domain,
    personName,
    personTitle,
    linkedinUrl,
    emails,
    mxProvider: mx.provider,
  };
}

/**
 * Ticket GEN-20 & GEN-21: Generates a tailored 4-sentence Morgan Stanley / CSE '26 cold outreach draft.
 * Grounded in Shivam Mahajan's candidate.json profile facts.
 */
export function generateColdOutreachDraft(
  company: string,
  roleTitle: string,
  lead?: EnrichedContactLead,
  profile?: CandidateExtendedProfile
): OutreachDraft {
  const isStartup = isStartupCompany(company, lead?.domain);
  const validEmails = (lead?.emails || []).filter(e => isHiringEmail(e.email, isStartup));
  const fallbackEmail = isStartup
    ? `founders@${lead?.domain || 'company.com'}`
    : `talent@${lead?.domain || 'company.com'}`;
  const topEmail = validEmails[0]?.email || fallbackEmail;
  const recipientName = lead?.personName ? lead.personName.split(' ')[0] : 'Team';
  const subject = `Applied for ${roleTitle} — Shivam Mahajan (Morgan Stanley Tech Apprentice / CSE '26)`;

  const phone = process.env.AUTOAPPLY_PHONE
    ? process.env.AUTOAPPLY_PHONE
    : profile?.personal?.phone
    ? `${profile.personal.phoneCountryCode || '+91'} ${profile.personal.phone}`
    : '+91 9000000000';
  const linkedin = profile?.personal?.linkedinUrl || 'https://www.linkedin.com/in/mahajanshivam';
  const github = profile?.personal?.githubUrl || 'https://github.com/smresponsibilities';

  const body = [
    `Hi ${recipientName},`,
    `I recently submitted my application for the ${roleTitle} role at ${company}.`,
    `I am currently a Technology Apprentice at Morgan Stanley in Bengaluru completing my B.E. in Computer Science at Chitkara University (9.35 CGPA, graduating 2026).`,
    `Over the past year, I have engineered production Java Spring Boot microservices, high-throughput PySpark ETL pipelines, and Apache Kafka event streams processing millions of daily records.`,
    `With immediate availability (0 days notice) and full readiness for in-office work in Bengaluru, I would love the opportunity to contribute to your engineering team.`,
    `Best regards,`,
    `Shivam Mahajan`,
    `${phone} | ${linkedin} | ${github}`,
  ].join('\n\n');

  return {
    company,
    roleTitle,
    targetEmail: topEmail,
    recipientName: lead?.personName,
    recipientTitle: lead?.personTitle,
    subject,
    body,
    generatedAt: new Date().toISOString(),
    source: validEmails[0]?.source || 'fallback',
  };
}

export function recordOutreachLead(
  record: OutreachDraft,
  filePath = DEFAULT_OUTREACH_PATH
): void {
  let list: OutreachDraft[] = [];
  try {
    if (fs.existsSync(filePath)) {
      list = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!Array.isArray(list)) list = [];
    }
  } catch {
    list = [];
  }

  // Deduplicate by company + roleTitle
  const idx = list.findIndex(
    item => item.company.toLowerCase() === record.company.toLowerCase() && item.roleTitle.toLowerCase() === record.roleTitle.toLowerCase()
  );
  if (idx >= 0) {
    list[idx] = record;
  } else {
    list.unshift(record);
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf8');
}
