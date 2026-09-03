import { readFile } from 'node:fs/promises';
import type { Ats, Company, Industry } from './types.js';
import { FETCHERS } from './fetchers/index.js';
import { mapLimitByKey, UA } from './fetchers/util.js';
import { HOST_CONCURRENCY } from './config.js';
import { isServiceCompany, locationMatches, roleFamily } from './filter.js';
import { classify } from './classify.js';
import { loadCompanies, saveCompanies } from './state.js';
import { boardKey, prettify, WORKDAY } from './board-url.js';
import { discoverSites } from './fetchers/workday.js';

/**
 * Bulk-imports boards from kalil0321/ats-scrapers' published tenant lists.
 *
 *   npm run bulk-import -- [--bar india|fresher|live] [--limit N] [--platform X]
 *   npm run bulk-import -- --rediscover [--bar india|fresher|live] [--limit N]
 *   npm run bulk-import -- --file <path> [--bar india|fresher|live] [--limit N]
 *   npm run bulk-import -- --file <path> --platform X [--bar ...] [--limit N]
 *
 * `--rediscover` skips the CSV import entirely and instead walks every
 * existing Workday tenant's robots.txt for career-site names we don't already
 * track (see `discoverCandidateSites` below) — a different candidate source,
 * same validate+checkpoint pipeline.
 *
 * `--file <path>` alone is the same site-discovery step, but the tenants come
 * from a local text file of Workday hostnames (one per line, e.g.
 * `3m.wd1.myworkdayjobs.com`) instead of our own companies.json — for a
 * published hostname list, like open-jobs' `slugs.json`, that carries no site
 * at all. `--file <path> --platform X` (X other than workday) is simpler:
 * every line is a bare subdomain slug for that one ATS, no site concept to
 * resolve, straight into the validate+checkpoint loop below.
 *
 * That project crawls ~77,000 ATS tenants, ~21,000 of them on platforms this
 * codebase already reads. `detect` and `probe` cannot reach these: detect needs
 * a careers page that links its own board, and probe only guesses tokens that
 * match the brand name. A published tenant list sidesteps both.
 *
 * Every candidate is polled before it is kept, because a tenant slug that
 * resolves is not evidence of a real company — three plausible-looking "IBM"
 * Oracle tenants turned out to be a Guatemalan retailer, an Iowa college and a
 * Syracuse school district.
 */
const RAW = 'https://raw.githubusercontent.com/kalil0321/ats-scrapers/main/ats-companies';

/** Platforms whose CSV row carries everything the fetcher needs. */
const IMPORTABLE: Ats[] = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workday', 'oracle', 'workable'];

const ORACLE_URL =
  /https?:\/\/([a-z0-9-]+)\.(fa\.[a-z0-9]+)\.oraclecloud\.com\/.*?\/sites\/([A-Za-z0-9_]+)/i;

type Bar = 'india' | 'fresher' | 'live';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const bar = (flag('bar') ?? 'india') as Bar;
const limit = Number(flag('limit') ?? 0);
const onlyPlatform = flag('platform') as Ats | undefined;
const rediscover = args.includes('--rediscover');
const filePath = flag('file');

/** Naive CSV split is enough here: only the trailing url field can contain commas. */
function parseRow(platform: Ats, line: string): Company | null {
  const [rawName, slug, url] = line.split(',');
  const name = (rawName ?? '').trim().replace(/^"|"$/g, '');
  if (!name || !slug) return null;
  const base = { name, ats: platform, industry: 'tech' as Industry, source: 'discovered' as const };

  if (platform === 'workday') {
    const m = WORKDAY.exec(url ?? '');
    return m ? { ...base, token: m[1]!, host: m[2]!, site: m[3]! } : null;
  }
  if (platform === 'oracle') {
    const m = ORACLE_URL.exec(url ?? '');
    return m ? { ...base, token: m[1]!, host: m[2]!, siteNumber: m[3]! } : null;
  }
  const token = slug.trim();
  if (!token || token.includes('/') || token.startsWith('http')) return null;
  return { ...base, token };
}

async function loadCsv(platform: Ats): Promise<Company[]> {
  const res = await fetch(`${RAW}/${platform}.csv`, { headers: { 'user-agent': UA } });
  if (!res.ok) {
    console.warn(`  ! ${platform}.csv: ${res.status}`);
    return [];
  }
  const lines = (await res.text()).trim().split('\n').slice(1);
  return lines.map((l) => parseRow(platform, l)).filter((c): c is Company => c !== null);
}

const WORKDAY_HOSTNAME = /^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/i;

/**
 * `--file`: a plain-text hostname list carries no `site`, unlike the CSVs
 * above — open-jobs' `slugs.json` crawled the tenant, not any one career
 * page, so `discoverCandidateSites` below has to resolve the site the same
 * way `--rediscover` does for our own tenants.
 */
async function loadSlugFile(path: string): Promise<{ token: string; host: string }[]> {
  const lines = (await readFile(path, 'utf8')).split(/\r?\n/);
  const tenants = new Map<string, { token: string; host: string }>();
  for (const line of lines) {
    const m = WORKDAY_HOSTNAME.exec(line.trim());
    if (!m) continue;
    tenants.set(`${m[1]}:${m[2]}`, { token: m[1]!, host: m[2]! });
  }
  return [...tenants.values()];
}

/**
 * `--file` for a non-Workday platform: open-jobs' `slugs.json` lists these as
 * bare subdomains (`"11bitstudios"`, one per line), not hostnames — the ATS
 * itself has no multi-site concept, so unlike Workday there's no site to
 * resolve. Each line becomes a candidate directly.
 */
async function loadPlainSlugFile(path: string, platform: Ats): Promise<Company[]> {
  const lines = (await readFile(path, 'utf8')).split(/\r?\n/);
  const tokens = new Set(lines.map((l) => l.trim()).filter(Boolean));
  return [...tokens].map((token) => ({
    name: prettify(token),
    ats: platform,
    token,
    industry: 'tech' as Industry,
    source: 'discovered' as const,
  }));
}

/** Same shape as the hourly run's scheduler, so imports respect the same host caps. */
const rateLimitKey = (c: Company) => (c.ats === 'workday' ? `workday:${c.host}` : c.ats);
const limitForHost = (key: string) =>
  HOST_CONCURRENCY[key.split(':')[0]!] ?? HOST_CONCURRENCY.default!;

/**
 * Shared by `--rediscover` and `--file`: neither source carries a `site`, so
 * both resolve it the same way — one robots.txt hit per tenant, one candidate
 * row per site it lists. A resolved site is not proof of a useful board on
 * its own; that's what the validate+checkpoint loop below is for.
 */
async function discoverCandidateSites(
  tenants: { name: string; token: string; host: string; industry: Industry }[],
  known: Set<string>,
): Promise<Company[]> {
  const found: Company[] = [];
  let checked = 0;
  await mapLimitByKey(
    tenants,
    (c) => `workday:${c.host}`,
    limitForHost,
    async (tenant) => {
      if (++checked % 100 === 0) console.log(`  ...${checked}/${tenants.length} tenants`);
      let sites: string[] | 'gone';
      try {
        sites = await discoverSites({ ...tenant, ats: 'workday', source: 'discovered' });
      } catch {
        return;
      }
      if (sites === 'gone') return;
      for (const site of sites) {
        const candidate: Company = { ...tenant, ats: 'workday', source: 'discovered', site };
        if (!known.has(boardKey(candidate))) found.push(candidate);
      }
    },
  );

  const deduped = new Map(found.map((c) => [boardKey(c), c]));
  console.log(`${tenants.length} tenants checked, ${deduped.size} untracked sites found`);
  return [...deduped.values()];
}

async function main(): Promise<void> {
  const existing = await loadCompanies();
  const known = new Set(existing.map(boardKey));

  let candidates: Company[] = [];
  if (rediscover) {
    const workdayRows = existing.filter(
      (c): c is Company & { host: string } => c.ats === 'workday' && Boolean(c.host),
    );
    const tenants = new Map(workdayRows.map((c) => [`${c.token}:${c.host}`, c]));
    console.log(`rediscovering sites on ${tenants.size} workday tenants\n`);
    candidates = await discoverCandidateSites([...tenants.values()], known);
  } else if (filePath && onlyPlatform && onlyPlatform !== 'workday') {
    const rows = await loadPlainSlugFile(filePath, onlyPlatform);
    const fresh = rows.filter((c) => !known.has(boardKey(c)));
    console.log(`${filePath}: ${rows.length} listed, ${fresh.length} untracked`);
    candidates = fresh;
  } else if (filePath) {
    const tenants = await loadSlugFile(filePath);
    console.log(`${filePath}: ${tenants.length} workday tenants\n`);
    candidates = await discoverCandidateSites(
      tenants.map((t) => ({ ...t, name: prettify(t.token), industry: 'tech' as Industry })),
      known,
    );
  } else {
    const platforms = onlyPlatform ? [onlyPlatform] : IMPORTABLE;
    for (const platform of platforms) {
      const rows = await loadCsv(platform);
      const fresh = rows.filter((c) => !known.has(boardKey(c)));
      // One tenant can appear under several names in a crawled list. Keyed by
      // board, not tenant, so a Workday tenant's second career site is a genuine
      // new candidate rather than a duplicate of the site we already track.
      const deduped = new Map(fresh.map((c) => [boardKey(c), c]));
      console.log(`${platform.padEnd(16)} ${rows.length} listed, ${deduped.size} untracked`);
      candidates.push(...deduped.values());
    }
  }

  // Same guard every other importer (detect/discover/probe/import-urls) already
  // applies. Missing it here let Capgemini through a real workable run — its
  // jobs can never alert (preScreen rejects it too), so a kept row here is
  // pure wasted poll budget forever, not a false alert, but still wrong to keep.
  const before = candidates.length;
  candidates = candidates.filter((c) => !isServiceCompany(c.name));
  if (candidates.length < before) {
    console.log(`excluded ${before - candidates.length} service-company candidate(s)`);
  }

  if (limit > 0) {
    const step = Math.max(1, Math.floor(candidates.length / limit));
    candidates = candidates.filter((_, i) => i % step === 0).slice(0, limit);
  }
  console.log(`\nvalidating ${candidates.length} boards (bar: ${bar})\n`);

  const keep: Company[] = [];
  let live = 0;
  let done = 0;

  /**
   * Checkpoint as we go. A full sweep is ~16,600 network round trips and takes
   * over an hour, and saving only at the end means anything that interrupts it
   * throws the whole run away — a first attempt died at 15,000/16,618 and lost
   * all 2,086 boards it had already validated.
   *
   * Writes are serialised by chaining onto the previous one rather than by a
   * boolean "busy" flag. A flag makes concurrent callers *skip* their write,
   * which silently drops whatever they had added since the last save — the
   * final write raced a checkpoint that way and landed 3,793 boards on disk
   * when 3,798 had been validated. Chaining makes every caller wait its turn
   * instead, so the last write always reflects the full set.
   */
  let pendingSave: Promise<void> = Promise.resolve();
  const checkpoint = (): Promise<void> => {
    pendingSave = pendingSave.then(() => saveCompanies([...existing, ...keep]));
    return pendingSave;
  };

  await mapLimitByKey(candidates, rateLimitKey, limitForHost, async (company) => {
    if (++done % 250 === 0) {
      console.log(`  ...${done}/${candidates.length}, ${keep.length} kept`);
      await checkpoint();
    }
    try {
      const jobs = await FETCHERS[company.ats].list(company);
      if (jobs.length === 0) return;
      live++;
      if (bar === 'live') return void keep.push(company);

      const india = jobs.filter((j) => locationMatches(j.location));
      if (india.length === 0) return;
      if (bar === 'india') return void keep.push(company);

      const fresher = india.some((j) => {
        if (!roleFamily(j.title, company.industry)) return false;
        const c = classify(j, company.industry);
        return !c.excluded && c.isJunior;
      });
      if (fresher) keep.push(company);
    } catch {
      /* dead or unreachable board — silently skipped, same as detect */
    }
  });

  console.log(`\n${live}/${candidates.length} live, ${keep.length} cleared the "${bar}" bar`);
  if (keep.length === 0) return;

  keep.sort((a, b) => a.name.localeCompare(b.name));
  for (const c of keep.slice(0, 40)) console.log(`  + ${c.name} [${c.ats}:${c.token}]`);
  if (keep.length > 40) console.log(`  ... and ${keep.length - 40} more`);

  await checkpoint();
  console.log(`\ncompanies.json: ${existing.length} -> ${existing.length + keep.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
