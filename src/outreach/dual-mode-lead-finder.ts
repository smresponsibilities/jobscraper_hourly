import fs from 'node:fs';
import path from 'node:path';
import {
  isPoisonPrefixEmail,
  verifyDomainDeliverability,
  generatePermutedEmail,
  discoverGithubOrgCommitContacts,
} from './free-contact-discovery.js';
import { isSafeOutreachEmailSyntax } from '../../scripts/sync-applied-to-outreach.js';

export interface WonderPillDeadEnd {
  sourceOrigin: string;
  whatWentWrong: string;
  whyDisqualifying: string;
  company?: string;
  domain?: string;
  timestamp?: string;
}

export interface DiscoveredOutreachContact {
  email: string;
  name: string;
  role?: string;
  company: string;
  domain: string;
  confidence: number;
  source: 'mode1_osint' | 'mode2_npm_maintainer' | 'mode2_git_patch' | 'mode1_permutation' | string;
  archetype?: string;
}

const DEFAULT_DEAD_ENDS_PATH = path.resolve('state/autoapply/portal-review/outreach-dead-ends.json');

/**
 * Loads the dead-end ledger recording lateral search dead ends.
 */
export function loadWonderPillDeadEnds(ledgerPath = DEFAULT_DEAD_ENDS_PATH): WonderPillDeadEnd[] {
  if (!fs.existsSync(ledgerPath)) return [];
  try {
    const raw = fs.readFileSync(ledgerPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Appends a 3-field dead end audit record to outreach-dead-ends.json.
 */
export function recordWonderPillDeadEnd(deadEnd: WonderPillDeadEnd, ledgerPath = DEFAULT_DEAD_ENDS_PATH): void {
  try {
    const dir = path.dirname(ledgerPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const current = loadWonderPillDeadEnds(ledgerPath);
    const entry: WonderPillDeadEnd = {
      sourceOrigin: deadEnd.sourceOrigin,
      whatWentWrong: deadEnd.whatWentWrong,
      whyDisqualifying: deadEnd.whyDisqualifying,
      company: deadEnd.company,
      domain: deadEnd.domain,
      timestamp: deadEnd.timestamp || new Date().toISOString(),
    };
    current.push(entry);
    fs.writeFileSync(ledgerPath, JSON.stringify(current, null, 2), 'utf8');
  } catch (err) {
    console.warn('[DEAD_END_LEDGER] Failed to write dead end:', err);
  }
}

/**
 * Mode 1: Standard 5-Step OSINT (Without Wonder-Pill).
 * Performs DNS MX check, GitHub org commit author scan, and recruiter permutations.
 */
export async function runMode1StandardOsintLeadFinder(params: {
  company: string;
  domain: string;
  recruiterName?: string;
}): Promise<DiscoveredOutreachContact[]> {
  const { company, domain, recruiterName } = params;
  const cleanDomain = (domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || '').trim();
  const contacts: DiscoveredOutreachContact[] = [];

  // Step 1: DNS MX verification
  const deliverability = await verifyDomainDeliverability(cleanDomain);
  if (!deliverability.hasMx) {
    recordWonderPillDeadEnd({
      sourceOrigin: 'dns_mx',
      whatWentWrong: `No MX records found for domain ${cleanDomain}`,
      whyDisqualifying: 'Domain cannot receive inbound mail; sending would hard bounce',
      company,
      domain: cleanDomain,
    });
    return [];
  }

  // Step 2: Named Recruiter Permutations (if recruiter name is available)
  if (recruiterName && recruiterName.trim()) {
    const patterns: Array<'first.last' | 'first' | 'flast' | 'first_last'> = ['first.last', 'first', 'flast'];
    for (const pat of patterns) {
      const email = generatePermutedEmail(recruiterName, cleanDomain, pat);
      if (email && !isPoisonPrefixEmail(email)) {
        contacts.push({
          email,
          name: recruiterName.trim(),
          role: 'Recruiter / Talent Acquisition',
          company,
          domain: cleanDomain,
          confidence: 0.85,
          source: 'mode1_permutation',
        });
      }
    }
  }

  // Step 3: GitHub Org Public Commits OSINT
  const orgSlug = cleanDomain ? cleanDomain.split('.')[0] : company.toLowerCase().replace(/[^a-z0-9]/g, '');
  try {
    const ghContacts = await discoverGithubOrgCommitContacts(company, cleanDomain, orgSlug);
    for (const gh of ghContacts) {
      if (isSafeOutreachEmailSyntax(gh.email) && !isPoisonPrefixEmail(gh.email)) {
        contacts.push({
          email: gh.email,
          name: gh.name || 'Engineering Lead',
          role: gh.role || 'Staff Engineer',
          company,
          domain: cleanDomain,
          confidence: gh.confidence || 0.88,
          source: 'mode1_osint',
        });
      }
    }
  } catch (err: any) {
    recordWonderPillDeadEnd({
      sourceOrigin: 'github_org_events',
      whatWentWrong: `GitHub org commits lookup failed: ${err?.message || 'unknown'}`,
      whyDisqualifying: 'Cannot extract commit author emails from GitHub org',
      company,
      domain: cleanDomain,
    });
  }

  // Step 4: Fallback talent inbox (if no contacts found yet and talent@ is safe)
  if (contacts.length === 0) {
    const fallbackTalent = `talent@${cleanDomain}`;
    if (!isPoisonPrefixEmail(fallbackTalent) && isSafeOutreachEmailSyntax(fallbackTalent)) {
      contacts.push({
        email: fallbackTalent,
        name: `${company} Talent Team`,
        role: 'Talent Acquisition',
        company,
        domain: cleanDomain,
        confidence: 0.70,
        source: 'mode1_osint',
      });
    }
  }

  return contacts;
}

/**
 * Mode 2: Wonder-Pill Inverted-Assumption Lateral Discovery (STRICTLY NO MINDMAPS).
 *
 * Inversion 1: Invert assumption that hiring contacts must be HR/recruiters.
 * Instead, engineering leaders publish open-source libraries on npm (registry.npmjs.org).
 *
 * Inversion 2: Invert assumption that commit author emails are shielded by GitHub UI/API.
 * Public commits on GitHub expose raw git patches (.patch) via HTTP Range headers.
 */
export async function runMode2WonderPillInvertedLeadFinder(params: {
  company: string;
  domain: string;
  githubOrg?: string;
  npmPackage?: string;
}): Promise<DiscoveredOutreachContact[]> {
  const { company, domain, githubOrg, npmPackage } = params;
  const cleanDomain = (domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || '').trim();
  const contacts: DiscoveredOutreachContact[] = [];
  const companySlug = company.toLowerCase().replace(/[^a-z0-9]/g, '');

  // =========================================================================
  // Inversion 1: NPM Maintainer Registry Lookup (registry.npmjs.org)
  // =========================================================================
  try {
    const queries = [
      npmPackage ? `https://registry.npmjs.org/${encodeURIComponent(npmPackage)}` : null,
      `https://registry.npmjs.org/-/v1/search?text=scope:${encodeURIComponent(companySlug)}&size=3`,
      `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(company)}&size=3`,
    ].filter(Boolean) as string[];

    let npmFound = false;
    for (const url of queries) {
      if (npmFound) break;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(url, {
        headers: { 'User-Agent': 'jobscraper-npm-discovery' },
        signal: ctrl.signal,
      }).catch(() => null);
      clearTimeout(timer);

      if (!res || !res.ok) continue;
      const data = await res.json().catch(() => null);
      if (!data) continue;

      // Extract maintainers from search results or direct package metadata
      const candidateList: Array<{ name?: string; email?: string; pkgName?: string }> = [];

      if (Array.isArray(data.objects)) {
        for (const obj of data.objects) {
          const pkgName = obj.package?.name;
          if (obj.package?.maintainers && Array.isArray(obj.package.maintainers)) {
            candidateList.push(...obj.package.maintainers.map((m: any) => ({ ...m, pkgName })));
          }
          if (obj.package?.publisher?.email) {
            candidateList.push({ name: obj.package.publisher.username, email: obj.package.publisher.email, pkgName });
          }
          if (obj.package?.author?.email) {
            candidateList.push({ name: obj.package.author.name, email: obj.package.author.email, pkgName });
          }
        }
      } else if (data.maintainers && Array.isArray(data.maintainers)) {
        const pkgName = data.name;
        candidateList.push(...data.maintainers.map((m: any) => ({ ...m, pkgName })));
      } else if (data.author?.email) {
        candidateList.push({ ...data.author, pkgName: data.name });
      }

      for (const cand of candidateList) {
        if (!cand.email || typeof cand.email !== 'string') continue;
        const em = cand.email.trim().toLowerCase();
        if (
          isSafeOutreachEmailSyntax(em) &&
          !isPoisonPrefixEmail(em) &&
          !em.includes('noreply') &&
          !em.includes('example.com')
        ) {
          contacts.push({
            email: em,
            name: cand.name || 'NPM Maintainer / Core Engineer',
            role: cand.pkgName ? `Maintainer (${cand.pkgName})` : 'Engineering Lead / Maintainer',
            company,
            domain: cleanDomain,
            confidence: 0.92,
            source: 'mode2_npm_maintainer',
          });
          npmFound = true;
        }
      }
    }

    if (!npmFound) {
      recordWonderPillDeadEnd({
        sourceOrigin: 'npm_registry',
        whatWentWrong: `No active npm packages or maintainer emails found for scope: ${companySlug}`,
        whyDisqualifying: 'NPM search yielded no unmasked author emails',
        company,
        domain: cleanDomain,
      });
    }
  } catch (err: any) {
    recordWonderPillDeadEnd({
      sourceOrigin: 'npm_registry',
      whatWentWrong: `NPM registry query failed: ${err?.message || 'unknown'}`,
      whyDisqualifying: 'Network error or unresolvable npm package endpoint',
      company,
      domain: cleanDomain,
    });
  }

  // =========================================================================
  // Inversion 2: Raw Git Commit .patch Header Extraction (Range: bytes=0-1200)
  // =========================================================================
  try {
    const org = githubOrg || (cleanDomain ? cleanDomain.split('.')[0] || '' : '') || companySlug || 'company';
    // Find a public repo from GitHub
    const ctrl1 = new AbortController();
    const timer1 = setTimeout(() => ctrl1.abort(), 4000);
    const reposRes = await fetch(`https://api.github.com/orgs/${encodeURIComponent(org)}/repos?sort=pushed&per_page=3`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'jobscraper-git-patch-discovery',
        ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
      signal: ctrl1.signal,
    }).catch(() => null);
    clearTimeout(timer1);

    if (reposRes && reposRes.ok) {
      const repos = (await reposRes.json().catch(() => [])) as Array<{ name: string }>;
      let patchFound = false;

      for (const repo of repos.slice(0, 2)) {
        if (patchFound) break;
        // Fetch latest commit SHA
        const ctrl2 = new AbortController();
        const timer2 = setTimeout(() => ctrl2.abort(), 4000);
        const commitsRes = await fetch(`https://api.github.com/repos/${org}/${repo.name}/commits?per_page=3`, {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'jobscraper-git-patch-discovery',
            ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
          },
          signal: ctrl2.signal,
        }).catch(() => null);
        clearTimeout(timer2);

        if (!commitsRes || !commitsRes.ok) continue;
        const commits = (await commitsRes.json().catch(() => [])) as Array<{ sha: string }>;

        for (const c of commits) {
          if (!c.sha) continue;
          // Inversion 2 magic: Fetch raw .patch header via Range: bytes=0-1200
          const patchUrl = `https://github.com/${org}/${repo.name}/commit/${c.sha}.patch`;
          const ctrl3 = new AbortController();
          const timer3 = setTimeout(() => ctrl3.abort(), 4000);
          const patchRes = await fetch(patchUrl, {
            headers: {
              Range: 'bytes=0-1200',
              'User-Agent': 'jobscraper-git-patch-discovery',
            },
            signal: ctrl3.signal,
          }).catch(() => null);
          clearTimeout(timer3);

          if (!patchRes || (!patchRes.ok && patchRes.status !== 206)) continue;
          const patchText = await patchRes.text().catch(() => '');

          // Extract "From: Full Name <author@domain>"
          const fromMatch = patchText.match(/^From:\s*([^<]+)<([^>]+)>/m);
          if (fromMatch && fromMatch[1] && fromMatch[2]) {
            const authorName = fromMatch[1].trim();
            const authorEmail = fromMatch[2].trim().toLowerCase();

            if (
              isSafeOutreachEmailSyntax(authorEmail) &&
              !isPoisonPrefixEmail(authorEmail) &&
              !authorEmail.includes('noreply.github.com')
            ) {
              contacts.push({
                email: authorEmail,
                name: authorName,
                role: `Open-Source Contributor (${repo.name})`,
                company,
                domain: cleanDomain,
                confidence: 0.95,
                source: 'mode2_git_patch',
              });
              patchFound = true;
              break;
            } else {
              recordWonderPillDeadEnd({
                sourceOrigin: 'git_patch',
                whatWentWrong: `Author email masked with privacy relay: ${authorEmail}`,
                whyDisqualifying: 'GitHub noreply mask prevents direct SMTP delivery',
                company,
                domain: cleanDomain,
              });
            }
          }
        }
      }
    } else {
      recordWonderPillDeadEnd({
        sourceOrigin: 'git_patch',
        whatWentWrong: `Could not list GitHub repos for org: ${org}`,
        whyDisqualifying: 'No public GitHub repositories accessible for git patch header scan',
        company,
        domain: cleanDomain,
      });
    }
  } catch (err: any) {
    recordWonderPillDeadEnd({
      sourceOrigin: 'git_patch',
      whatWentWrong: `Git patch fetch failed: ${err?.message || 'unknown'}`,
      whyDisqualifying: 'Unexpected network or parsing exception during patch read',
      company,
      domain: cleanDomain,
    });
  }

  return contacts;
}

/**
 * Unified Dual-Mode Lead Finder.
 * Runs Mode 1 (Standard OSINT) and Mode 2 (Wonder-Pill Inverted Assumption Discovery).
 * Dedupes contacts, records dead ends, and returns comprehensive leads.
 */
export async function discoverCompanyContactsDualMode(params: {
  company: string;
  domain: string;
  recruiterName?: string;
  githubOrg?: string;
}): Promise<{ contacts: DiscoveredOutreachContact[]; deadEnds: WonderPillDeadEnd[] }> {
  const [mode1Contacts, mode2Contacts] = await Promise.all([
    runMode1StandardOsintLeadFinder(params).catch(() => []),
    runMode2WonderPillInvertedLeadFinder(params).catch(() => []),
  ]);

  const seen = new Set<string>();
  const deduped: DiscoveredOutreachContact[] = [];

  for (const c of [...mode2Contacts, ...mode1Contacts]) {
    const key = c.email.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }

  const deadEnds = loadWonderPillDeadEnds();
  return { contacts: deduped, deadEnds };
}
