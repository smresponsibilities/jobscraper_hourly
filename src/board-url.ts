import type { Ats, Company, Industry } from './types.js';

/**
 * Turns any job or board URL into a `companies.json` entry.
 *
 * Shared by `detect` (which finds URLs on careers pages) and `import` (which
 * takes them from a list), so the parsing rules live in exactly one place.
 */
export const HOSTED: { ats: Ats; pattern: RegExp }[] = [
  {
    ats: 'greenhouse',
    pattern:
      /(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i,
  },
  { ats: 'lever', pattern: /jobs\.(?:eu\.)?lever\.co\/([a-z0-9_-]+)/i },
  { ats: 'ashby', pattern: /jobs\.ashbyhq\.com\/([a-z0-9_-]+)/i },
  { ats: 'smartrecruiters', pattern: /(?:jobs|careers)\.smartrecruiters\.com\/([a-zA-Z0-9_-]+)/i },
];

export const WORKDAY =
  /https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:(?:[a-z]{2}-[A-Za-z]{2})\/)?([A-Za-z0-9_-]+)/i;

/** Oracle tenants sit on regional pods: `{tenant}.fa.{pod}.oraclecloud.com`. */
const ORACLE =
  /https?:\/\/([a-z0-9-]+)\.(fa(?:\.[a-z0-9]+)?)\.oraclecloud\.com[^"'\s]*?(?:siteNumber=|\/sites\/)(CX_[0-9]+)/i;

/** Path segments that are ATS plumbing rather than a company. */
const NOT_A_COMPANY =
  /^(embed|api|v1|assets|static|images|css|js|robots|sitemap|favicon|_next|search|jobs|job)$/i;

export function prettify(slug: string): string {
  return slug
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function parseBoardUrl(url: string, industry: Industry = 'tech'): Company | null {
  const workday = WORKDAY.exec(url);
  if (workday) {
    const [, token, host, site] = workday;
    if (!token || !site || host?.startsWith('impl')) return null;
    return {
      name: prettify(token),
      ats: 'workday',
      token,
      host,
      site,
      industry,
      source: 'curated',
    };
  }

  const oracle = ORACLE.exec(url);
  if (oracle) {
    const [, token, host, siteNumber] = oracle;
    return {
      name: prettify(token!),
      ats: 'oracle',
      token: token!,
      host,
      siteNumber,
      industry,
      source: 'curated',
    };
  }

  for (const { ats, pattern } of HOSTED) {
    const match = pattern.exec(url);
    const token = match?.[1];
    if (token && !NOT_A_COMPANY.test(token)) {
      return { name: prettify(token), ats, token, industry, source: 'curated' };
    }
  }

  return null;
}

/**
 * Roster identity: which row in `companies.json` this is.
 *
 * Site-aware, because one tenant can host several genuinely different boards.
 * RTX runs `Private_Posting_No_TMP` and `REC_RTX_Ext_Gateway` with no overlap
 * between their listings, and Deutsche Bank's tenant carries both `DBWebsite`
 * and DWS's `dwswebsite`. Keyed on ats+token alone those collapse into a single
 * key, so an importer silently drops the second one and the run loop cannot
 * tell them apart — which is also how `polledTokens` in index.ts could delete a
 * sibling site that simply wasn't selected for polling this run.
 *
 * NOT job identity. A job id stays `${ats}:${token}:${externalId}` and its
 * tenant prefix stays site-blind: requisition ids are already unique across a
 * tenant's sites, and re-keying them would invalidate every id in seen.json and
 * every entry in the catalogue, re-alerting the whole corpus on the next run.
 */
export function boardKey(company: Company): string {
  return `${company.ats}:${company.token}:${company.site ?? company.siteNumber ?? ''}`.toLowerCase();
}
