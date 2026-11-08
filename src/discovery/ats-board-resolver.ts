import dns from 'node:dns';

export interface DiscoveredAtsBoard {
  company: string;
  domain: string;
  ats: 'greenhouse' | 'ashby' | 'lever' | 'smartrecruiters' | 'workday';
  boardSlug: string;
  boardUrl: string;
  discoveredVia: 'slug_permutation' | 'career_html' | 'dns_cname';
  jobCount?: number;
}

export function generateCandidateSlugs(companyName: string, domain?: string): string[] {
  const slugs = new Set<string>();
  const cleanName = String(companyName || '')
    .toLowerCase()
    .replace(/\b(?:pvt|ltd|private|limited|inc|llc|corp|corporation|technologies|technology|solutions|labs|india|global)\b/g, '')
    .trim();
  const compactName = cleanName.replace(/[^a-z0-9]/g, '');
  const hyphenName = cleanName.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  if (compactName.length >= 2) {
    slugs.add(compactName);
    slugs.add(`${compactName}ai`);
    slugs.add(`${compactName}hq`);
    slugs.add(`${compactName}inc`);
    slugs.add(`${compactName}tech`);
    slugs.add(`${compactName}labs`);
    slugs.add(`${compactName}data`);
  }
  if (hyphenName.length >= 2) {
    slugs.add(hyphenName);
  }
  if (domain) {
    const cleanDomain = (domain
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0] || '').trim();
    const base = (cleanDomain.split('.')[0] || '').replace(/[^a-z0-9-]/g, '');
    const domainCompact = cleanDomain.replace(/\./g, '');
    if (base.length >= 2) {
      slugs.add(base);
      slugs.add(`${base}hq`);
      slugs.add(`${base}ai`);
      slugs.add(`${base}inc`);
    }
    if (domainCompact.length >= 3) {
      slugs.add(domainCompact);
    }
  }
  return Array.from(slugs).slice(0, 10);
}

export function extractAtsLinksFromHtml(html: string): Array<{
  ats: DiscoveredAtsBoard['ats'];
  boardSlug: string;
  boardUrl: string;
}> {
  const found: Array<{ ats: DiscoveredAtsBoard['ats']; boardSlug: string; boardUrl: string }> = [];
  const seen = new Set<string>();
  const add = (ats: DiscoveredAtsBoard['ats'], boardSlug: string, boardUrl: string) => {
    const key = `${ats}:${boardSlug.toLowerCase()}`;
    if (seen.has(key) || /^(?:embed|js|api|v1|v0|oneclick-ui|company|assets|static)$/i.test(boardSlug)) return;
    seen.add(key);
    found.push({ ats, boardSlug, boardUrl });
  };

  const ghMatches = html.matchAll(
    /https?:\/\/(?:boards|job-boards(?:\.eu)?)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-zA-Z0-9_-]{2,50})/g
  );
  for (const m of ghMatches) {
    if (m[1]) add('greenhouse', m[1], `https://boards.greenhouse.io/${m[1]}`);
  }

  const ashbyMatches = html.matchAll(/https?:\/\/jobs\.ashbyhq\.com\/([a-zA-Z0-9_.-]{2,50})/g);
  for (const m of ashbyMatches) {
    if (m[1]) add('ashby', m[1], `https://jobs.ashbyhq.com/${m[1]}`);
  }

  const leverMatches = html.matchAll(/https?:\/\/jobs\.lever\.co\/([a-zA-Z0-9_-]{2,50})/g);
  for (const m of leverMatches) {
    if (m[1]) add('lever', m[1], `https://jobs.lever.co/${m[1]}`);
  }

  const srMatches = html.matchAll(/https?:\/\/jobs\.smartrecruiters\.com\/([a-zA-Z0-9_-]{2,50})/g);
  for (const m of srMatches) {
    if (m[1]) add('smartrecruiters', m[1], `https://jobs.smartrecruiters.com/${m[1]}`);
  }

  const wdMatches = html.matchAll(
    /https?:\/\/([a-zA-Z0-9-]+)\.wd\d+\.myworkdayjobs\.com\/([a-zA-Z0-9_-]{2,50})/g
  );
  for (const m of wdMatches) {
    if (m[1] && m[2]) add('workday', `${m[1]}:${m[2]}`, m[0]);
  }

  return found;
}

export async function probeCnameForAts(domain: string): Promise<string | null> {
  const cleanDomain = (domain
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0] || '').trim();
  if (!cleanDomain) return null;

  for (const prefix of ['careers', 'jobs']) {
    try {
      const cnames = await dns.promises.resolveCname(`${prefix}.${cleanDomain}`);
      for (const cname of cnames) {
        if (/greenhouse\.io|ashbyhq\.com|lever\.co|smartrecruiters\.com|myworkdayjobs\.com/i.test(cname)) {
          return cname;
        }
      }
    } catch {
      // No CNAME on subdomain
    }
  }
  return null;
}

export async function resolveCompanyAtsBoards(
  company: string,
  domain: string,
  timeoutMs = 4500
): Promise<DiscoveredAtsBoard[]> {
  const discovered: DiscoveredAtsBoard[] = [];
  const fetchWithTimeout = async (url: string): Promise<Response | null> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0' },
        signal: ctrl.signal,
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  // Stage 1: Career page HTML extraction
  const cleanDomain = (domain
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0] || '').trim();

  if (cleanDomain) {
    for (const url of [`https://${cleanDomain}/careers`, `https://careers.${cleanDomain}`, `https://${cleanDomain}/jobs`]) {
      const res = await fetchWithTimeout(url);
      if (res && res.ok) {
        const html = await res.text().catch(() => '');
        const links = extractAtsLinksFromHtml(html);
        for (const l of links) {
          discovered.push({
            company,
            domain: cleanDomain,
            ats: l.ats,
            boardSlug: l.boardSlug,
            boardUrl: l.boardUrl,
            discoveredVia: 'career_html',
          });
        }
        if (discovered.length > 0) return discovered;
      }
    }
  }

  // Stage 2: Fast parallel API probe across candidate slugs
  const slugs = generateCandidateSlugs(company, cleanDomain).slice(0, 4);
  for (const slug of slugs) {
    const probes = [
      {
        ats: 'greenhouse' as const,
        apiUrl: `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
        boardUrl: `https://boards.greenhouse.io/${slug}`,
      },
      {
        ats: 'ashby' as const,
        apiUrl: `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
        boardUrl: `https://jobs.ashbyhq.com/${slug}`,
      },
      {
        ats: 'lever' as const,
        apiUrl: `https://api.lever.co/v0/postings/${slug}?mode=json&limit=1`,
        boardUrl: `https://jobs.lever.co/${slug}`,
      },
      {
        ats: 'smartrecruiters' as const,
        apiUrl: `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=1`,
        boardUrl: `https://jobs.smartrecruiters.com/${slug}`,
      },
    ];

    const responses = await Promise.all(
      probes.map(async (p) => {
        const r = await fetchWithTimeout(p.apiUrl);
        if (!r || !r.ok) return null;
        const json = (await r.json().catch(() => null)) as any;
        if (!json) return null;
        const count = Array.isArray(json)
          ? json.length
          : Array.isArray(json.jobs)
          ? json.jobs.length
          : Array.isArray(json.content)
          ? json.content.length
          : 0;
        if (count > 0) {
          return {
            company,
            domain: cleanDomain || domain,
            ats: p.ats,
            boardSlug: slug,
            boardUrl: p.boardUrl,
            discoveredVia: 'slug_permutation' as const,
            jobCount: count,
          };
        }
        return null;
      })
    );

    for (const hit of responses) {
      if (hit) discovered.push(hit);
    }
    if (discovered.length > 0) break;
  }

  return discovered;
}
