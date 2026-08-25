/**
 * Additional contact-discovery sources beyond git-commit metadata.
 *
 * COLDMAIL-PLAN.md's "rest of the ladder" listed these; only source 1 (git
 * commits, in contacts.ts) was built. This file implements the next three,
 * all free and unauthenticated:
 *
 *   1b. npm registry — maintainers/author emails on packages published by or
 *       for the company. Covers companies whose GitHub org is named nothing
 *       like the company, or who publish packages without a public org at all.
 *   3.  Role addresses — careers@/jobs@/hr@... at a known domain. No name, so
 *       not draft-composable today (buildFirstDraft needs a person), but it is
 *       the floor for companies with no public engineers anywhere.
 *   5.  Company website surfaces — mailto: links and plaintext addresses on
 *       their own pages. Mostly confirms domain + pattern rather than people.
 *
 * Gravatar existence checks are deliberately NOT duplicated here — outreach.ts
 * already has gravatarExists() on the verification path.
 */
import { domainMatchesOrg, isCorporateAddress } from './contacts.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url: string, timeoutMs = 10_000): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'jobscraper-next' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return res.json();
}

// ── 1b. npm registry ─────────────────────────────────────────────────────────

export interface RegistryContact {
  name: string;
  email: string;
  /** Package that yielded this address — provenance when a human reviews. */
  viaPackage: string;
}

/**
 * Search npm for packages whose name matches the company, then read each
 * package's latest manifest for maintainer/author addresses.
 *
 * The /latest endpoint returns just the newest manifest instead of every
 * version ever published — `registry.npmjs.org/left-pad` is megabytes, its
 * /latest document is kilobytes.
 *
 * The domainMatchesOrg guard here does the same job it does in contacts.ts:
 * npm hosts thousands of community packages named after companies they have
 * nothing to do with (`slack` the CLI tool predates Slack-the-company). An
 * address only counts if its domain plausibly belongs to the company.
 */
export async function npmContacts(company: string, limit = 10): Promise<RegistryContact[]> {
  const searchUrl = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(company)}&size=25`;
  const results = (await getJson(searchUrl)) as { objects?: { package?: { name?: string } }[] };
  const names = (results.objects ?? [])
    .map((o) => o.package?.name)
    .filter((n): n is string => Boolean(n))
    .slice(0, 15);

  const byEmail = new Map<string, RegistryContact>();
  for (const name of names) {
    try {
      const manifest = (await getJson(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`)) as {
        maintainers?: { name?: string; email?: string }[];
        author?: { email?: string; name?: string } | string;
      };
      const entries: { name?: string; email?: string }[] = [...(manifest.maintainers ?? [])];
      if (typeof manifest.author === 'object' && manifest.author?.email) entries.push(manifest.author);
      for (const entry of entries) {
        const email = entry.email?.toLowerCase().trim();
        if (!email || !isCorporateAddress(email)) continue;
        const domain = email.split('@')[1] ?? '';
        if (!domain || !domainMatchesOrg(company, domain)) continue;
        if (!byEmail.has(email)) {
          byEmail.set(email, {
            name: entry.name?.trim() || email.split('@')[0]!,
            email,
            viaPackage: name,
          });
        }
        if (byEmail.size >= limit) return [...byEmail.values()];
      }
    } catch {
      continue; // Unpublished-in-practice or deleted package; move on.
    }
    await sleep(150); // Politeness; npm has no published rate limit but bursts look like abuse.
  }
  return [...byEmail.values()];
}

// ── 5. Company website surfaces ──────────────────────────────────────────────

/** Pull mailto: targets plus bare email-shaped strings out of an HTML page. */
export function extractEmails(html: string): string[] {
  const found = new Set<string>();
  const mailtos = html.matchAll(/mailto:([^"'?>\s]+)/gi);
  for (const m of mailtos) found.add(decodeURIComponent(m[1]!).trim().toLowerCase());
  // Plaintext fallback catches "hr@company.com" rendered as plain text, but it
  // also matches everything inside the mailto: URIs above — hence the set.
  const bare = html.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
  for (const m of bare) found.add(m[0].toLowerCase());
  return [...found].filter(isCorporateAddress);
}

/** Root domain from a host ("careers.zerodha.com" → "zerodha.com"), crude but
 *  enough to accept subdomain-hosted addresses without accepting strangers. */
function rootDomain(host: string): string {
  const parts = host.replace(/^www\./, '').split('.');
  return parts.slice(-2).join('.');
}

export interface WebsiteContact {
  email: string;
  path: string;
}

const PAGE_PATHS = ['', '/contact', '/contact-us', '/about', '/about-us', '/careers', '/team'];

/**
 * Scan the company site's obvious pages for published addresses.
 *
 * Only addresses on the site's own root domain (or matching the company name)
 * survive: third-party addresses on those pages are recruiters, agencies and
 * chat-widget vendors, and mailing them is worse than useless.
 */
export async function websiteContacts(siteUrl: string, companyName: string): Promise<WebsiteContact[]> {
  const base = new URL(siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`);
  const hostRoot = rootDomain(base.hostname);
  const out = new Map<string, WebsiteContact>();
  for (const path of PAGE_PATHS) {
    try {
      const res = await fetch(new URL(path, base).toString(), {
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(8_000),
        redirect: 'follow',
      });
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !type.includes('html')) continue;
      const emails = extractEmails(await res.text());
      for (const email of emails) {
        const domain = email.split('@')[1] ?? '';
        if (rootDomain(domain) === hostRoot || domainMatchesOrg(companyName, domain)) {
          if (!out.has(email)) out.set(email, { email, path: path || '/' });
        }
      }
    } catch {
      continue; // Dead path or blocked page; the other paths still count.
    }
  }
  return [...out.values()];
}

// ── 3. Role addresses ────────────────────────────────────────────────────────

export const ROLE_MAILBOXES = ['careers', 'jobs', 'hiring', 'talent', 'hr', 'recruit'] as const;

/** Candidates only — verify-email must confirm before any of these ship. */
export function roleAddresses(domain: string): string[] {
  return ROLE_MAILBOXES.map((box) => `${box}@${domain}`);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith('contact-sources.ts')) {
  const args = process.argv.slice(2);
  const [company, site, domainArg] = args;
  if (!company) {
    console.log('usage: npm run contact-find -- "Company Name" https://company.com [mail-domain]');
    console.log('  runs npm registry + website scans and lists role-address candidates.');
    console.log('  (For git commits use the existing: npm run contacts -- <org>)');
    process.exit(args.length > 0 ? 1 : 0);
  }

  console.log(`npm registry — packages matching "${company}"`);
  const reg = await npmContacts(company).catch((e: Error) => {
    console.log(`  ! ${e.message}`);
    return [];
  });
  if (reg.length === 0) console.log('  (nothing corporate)');
  for (const c of reg) console.log(`  ${c.email.padEnd(34)} ${c.name}  (${c.viaPackage})`);

  let domain = domainArg;
  if (site) {
    console.log(`\nwebsite — mailto/plain-text scan of ${site}`);
    const web = await websiteContacts(site, company).catch((e: Error) => {
      console.log(`  ! ${e.message}`);
      return [];
    });
    if (web.length === 0) console.log('  (nothing on own domain)');
    for (const c of web) console.log(`  ${c.email.padEnd(34)} (${c.path})`);
    domain ||= web[0]?.email.split('@')[1] ?? rootDomain(new URL(site.startsWith('http') ? site : `https://${site}`).hostname);
  }

  if (domain) {
    console.log(`\nrole addresses @${domain} (verify before use)`);
    for (const addr of roleAddresses(domain)) console.log(`  ${addr}`);
  }
}
