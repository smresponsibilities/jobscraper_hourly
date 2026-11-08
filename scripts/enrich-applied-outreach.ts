import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';
import { fileURLToPath } from 'node:url';
import {
  verifyDomainDeliverability,
  discoverGithubOrgCommitContacts,
  type DiscoveredContactLead,
} from '../src/outreach/free-contact-discovery.js';
import { syncAppliedJobsToOutreachTargets } from './sync-applied-to-outreach.js';

export interface EnrichedCompanyOutreach {
  company: string;
  domain: string | null;
  deliverability: {
    hasMx: boolean;
    mxProvider: string;
    hasSpf: boolean;
  } | null;
  contacts: DiscoveredContactLead[];
  jobTitles: string[];
}

export interface EnrichedAppliedOutreachSummary {
  updatedAt: string;
  companiesProcessed: number;
  contactsDiscovered: number;
  companies: EnrichedCompanyOutreach[];
}

export async function resolveCompanyOfficialDomain(companyName: string): Promise<string | null> {
  const cleanName = String(companyName || '').trim();
  if (!cleanName || cleanName.length < 2) return null;

  // 1. Try Clearbit autocomplete API
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const url = `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(cleanName)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'jobscraper-domain-resolver/1.0',
        Accept: 'application/json',
      },
      signal: ctrl.signal,
    }).catch(() => null);
    clearTimeout(timer);

    if (res && res.ok) {
      const data = (await res.json().catch(() => [])) as Array<{ domain?: string }>;
      if (Array.isArray(data) && data.length > 0) {
        const topDomain = String(data[0]?.domain || '').trim().toLowerCase();
        if (topDomain && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(topDomain)) {
          return topDomain;
        }
      }
    }
  } catch {
    // Non-fatal, try fallback
  }

  // 2. Fallback heuristic: clean alphanumeric slug + .com
  const slug = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!slug) return null;

  const candidateDomain = `${slug}.com`;
  try {
    const records = await dns.promises.resolveMx(candidateDomain);
    if (Array.isArray(records) && records.length > 0) {
      return candidateDomain;
    }
  } catch {}

  return null;
}

export async function enrichAppliedOutreachQueue(
  maxCompanies = 25
): Promise<{ companiesProcessed: number; contactsDiscovered: number }> {
  const targetsPath = path.resolve('state/autoapply/applied-outreach-targets.json');
  if (!fs.existsSync(targetsPath)) {
    syncAppliedJobsToOutreachTargets();
  }

  let targetsData: { targets?: Array<{ company?: string; title?: string }> } = {};
  if (fs.existsSync(targetsPath)) {
    try {
      targetsData = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));
    } catch {}
  }

  const targets = targetsData.targets || [];
  if (targets.length === 0) {
    syncAppliedJobsToOutreachTargets();
    try {
      targetsData = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));
    } catch {}
  }

  const allTargets = targetsData.targets || [];
  const companyJobsMap = new Map<string, string[]>();

  for (const t of allTargets) {
    const c = String(t.company || '').trim();
    if (!c) continue;
    const current = companyJobsMap.get(c) || [];
    if (t.title && !current.includes(t.title)) {
      current.push(t.title);
    }
    companyJobsMap.set(c, current);
  }

  const selectedCompanies = Array.from(companyJobsMap.keys()).slice(0, maxCompanies);
  const enrichedResults: EnrichedCompanyOutreach[] = [];
  let totalContactsDiscovered = 0;

  for (const company of selectedCompanies) {
    const jobTitles = companyJobsMap.get(company) || [];
    const domain = await resolveCompanyOfficialDomain(company);

    let deliverability: { hasMx: boolean; mxProvider: string; hasSpf: boolean } | null = null;
    let contacts: DiscoveredContactLead[] = [];

    if (domain) {
      deliverability = await verifyDomainDeliverability(domain);
      contacts = await discoverGithubOrgCommitContacts(company, domain);
      totalContactsDiscovered += contacts.length;
    }

    enrichedResults.push({
      company,
      domain,
      deliverability,
      contacts,
      jobTitles,
    });
  }

  const summary: EnrichedAppliedOutreachSummary = {
    updatedAt: new Date().toISOString(),
    companiesProcessed: selectedCompanies.length,
    contactsDiscovered: totalContactsDiscovered,
    companies: enrichedResults,
  };

  const outPath = path.resolve('state/outreach/enriched-applied-outreach.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');

  return {
    companiesProcessed: selectedCompanies.length,
    contactsDiscovered: totalContactsDiscovered,
  };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()
) {
  const max = Number(process.argv[2]) || 25;
  enrichAppliedOutreachQueue(max).then(res => {
    console.log(
      `Enriched ${res.companiesProcessed} companies, discovered ${res.contactsDiscovered} contacts -> state/outreach/enriched-applied-outreach.json`
    );
  });
}
