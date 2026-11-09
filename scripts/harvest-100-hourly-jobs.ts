import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { syncHourlyFreshJobsFromOriginMain } from './sync-hourly-from-origin.js';
import { isSupportedDirectAtsJobUrl } from '../src/autoapply/priority-scheduler.js';
import { unwrapDirectAtsApplicationUrl } from '../src/autoapply/url-unwrapper.js';
import { evaluateCandidateJobFit } from '../src/autoapply/candidate-fit-filter.js';
import { enforceQueueDatabaseInvariants } from '../src/contracts/system-invariants.js';

export const TARGET_DB_PATHS = [
  'state/autoapply/portal-review/queue.sqlite',
  'data/queue.sqlite',
].filter((p) => fs.existsSync(p));

export const DEAD_SLUGS_PATH = path.resolve('state/dead-board-slugs.json');
export const VERIFIED_LIVE_BOARDS_PATH = path.resolve('state/verified-live-boards.json');
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function loadDeadBoardSlugs(): Record<string, number> {
  try {
    if (fs.existsSync(DEAD_SLUGS_PATH)) {
      return JSON.parse(fs.readFileSync(DEAD_SLUGS_PATH, 'utf8'));
    }
  } catch {}
  return {};
}

export function saveDeadBoardSlugs(store: Record<string, number>): void {
  try {
    fs.mkdirSync(path.dirname(DEAD_SLUGS_PATH), { recursive: true });
    fs.writeFileSync(DEAD_SLUGS_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch {}
}

export function loadVerifiedLiveBoards(): Array<{ ats: string; slug: string; name: string }> {
  try {
    if (fs.existsSync(VERIFIED_LIVE_BOARDS_PATH)) {
      const data = JSON.parse(fs.readFileSync(VERIFIED_LIVE_BOARDS_PATH, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch {}
  return [];
}

export function saveVerifiedLiveBoards(boards: Array<{ ats: string; slug: string; name: string }>): void {
  try {
    fs.mkdirSync(path.dirname(VERIFIED_LIVE_BOARDS_PATH), { recursive: true });
    fs.writeFileSync(VERIFIED_LIVE_BOARDS_PATH, JSON.stringify(boards, null, 2), 'utf8');
  } catch {}
}

export interface HarvestedJob {
  company: string;
  title: string;
  location: string;
  url: string;
  ats: string;
  postedRecent?: boolean;
}

export function isPostedWithinHours(rawDate: unknown, maxHours = 72): boolean {
  if (!rawDate) return false;
  const ts = typeof rawDate === 'number' ? rawDate : Date.parse(String(rawDate));
  if (!Number.isFinite(ts) || ts <= 0) return false;
  const ageMs = Date.now() - ts;
  return ageMs >= -3600_000 && ageMs <= maxHours * 3600_000;
}

export function inferAts(url: string): string {
  if (/greenhouse\.io/i.test(url)) return 'greenhouse';
  if (/ashbyhq\.com/i.test(url)) return 'ashby';
  if (/lever\.co/i.test(url)) return 'lever';
  if (/smartrecruiters\.com/i.test(url)) return 'smartrecruiters';
  if (/myworkdayjobs\.com|myworkdaysite\.com/i.test(url)) return 'workday';
  return 'other';
}

export interface FetchResult {
  data: any;
  status: number;
}

async function fetchJsonFast(url: string, timeoutMs = 4500, postBody?: string): Promise<FetchResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: postBody ? 'POST' : 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0',
        Accept: 'application/json',
        ...(postBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: postBody,
      signal: ctrl.signal,
    });
    if (!res.ok) return { data: null, status: res.status };
    const data = await res.json();
    return { data, status: res.status };
  } catch {
    return { data: null, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

export const TIER_0_HIGH_YIELD_BOARDS: Array<{ ats: string; slug: string; name: string }> = [
  { ats: 'greenhouse', slug: 'razorpay', name: 'Razorpay' },
  { ats: 'greenhouse', slug: 'meesho', name: 'Meesho' },
  { ats: 'greenhouse', slug: 'postman', name: 'Postman' },
  { ats: 'greenhouse', slug: 'rubrik', name: 'Rubrik' },
  { ats: 'greenhouse', slug: 'databricks', name: 'Databricks' },
  { ats: 'greenhouse', slug: 'cloudflare', name: 'Cloudflare' },
  { ats: 'greenhouse', slug: 'confluent', name: 'Confluent' },
  { ats: 'greenhouse', slug: 'gitlab', name: 'GitLab' },
  { ats: 'greenhouse', slug: 'grafanalabs', name: 'Grafana Labs' },
  { ats: 'greenhouse', slug: 'elastic', name: 'Elastic' },
  { ats: 'greenhouse', slug: 'mongodb', name: 'MongoDB' },
  { ats: 'greenhouse', slug: 'cockroachlabs', name: 'Cockroach Labs' },
  { ats: 'greenhouse', slug: 'coinbase', name: 'Coinbase' },
  { ats: 'greenhouse', slug: 'twilio', name: 'Twilio' },
  { ats: 'greenhouse', slug: 'okta', name: 'Okta' },
  { ats: 'greenhouse', slug: 'zscaler', name: 'Zscaler' },
  { ats: 'greenhouse', slug: 'nutanix', name: 'Nutanix' },
  { ats: 'greenhouse', slug: 'cohesity', name: 'Cohesity' },
  { ats: 'greenhouse', slug: 'harness', name: 'Harness' },
  { ats: 'greenhouse', slug: 'druva', name: 'Druva' },
  { ats: 'greenhouse', slug: 'chargebee', name: 'Chargebee' },
  { ats: 'greenhouse', slug: 'clevertap', name: 'CleverTap' },
  { ats: 'greenhouse', slug: 'moengage', name: 'MoEngage' },
  { ats: 'greenhouse', slug: 'innovaccer', name: 'Innovaccer' },
  { ats: 'greenhouse', slug: 'clickhouse', name: 'ClickHouse' },
  { ats: 'greenhouse', slug: 'airbyte', name: 'Airbyte' },
  { ats: 'greenhouse', slug: 'temporaltechnologies', name: 'Temporal' },
  { ats: 'greenhouse', slug: 'truveta', name: 'Truveta' },
  { ats: 'greenhouse', slug: 'enterpret', name: 'Enterpret' },
  { ats: 'ashby', slug: 'sarvam-ai', name: 'Sarvam AI' },
  { ats: 'ashby', slug: 'supabase', name: 'Supabase' },
  { ats: 'ashby', slug: 'linear', name: 'Linear' },
  { ats: 'ashby', slug: 'LangChain', name: 'LangChain' },
  { ats: 'ashby', slug: 'qdrant', name: 'Qdrant' },
  { ats: 'ashby', slug: 'posthog', name: 'PostHog' },
  { ats: 'ashby', slug: 'railway', name: 'Railway' },
  { ats: 'ashby', slug: 'replit', name: 'Replit' },
  { ats: 'lever', slug: 'hevodata', name: 'Hevo Data' },
  { ats: 'lever', slug: 'zepto', name: 'Zepto' },
  { ats: 'lever', slug: 'cred', name: 'CRED' },
  { ats: 'lever', slug: 'zeta', name: 'Zeta' },
  // Additional Verified High-Velocity India / Bengaluru / Remote Tech Boards
  { ats: 'greenhouse', slug: 'browserstack', name: 'BrowserStack' },
  { ats: 'greenhouse', slug: 'freshworks', name: 'Freshworks' },
  { ats: 'greenhouse', slug: 'datadog', name: 'Datadog' },
  { ats: 'greenhouse', slug: 'crowdstrike', name: 'CrowdStrike' },
  { ats: 'greenhouse', slug: 'snyk', name: 'Snyk' },
  { ats: 'greenhouse', slug: 'hashicorp', name: 'HashiCorp' },
  { ats: 'greenhouse', slug: 'figma', name: 'Figma' },
  { ats: 'greenhouse', slug: 'canva', name: 'Canva' },
  { ats: 'greenhouse', slug: 'notion', name: 'Notion' },
  { ats: 'greenhouse', slug: 'airtable', name: 'Airtable' },
  { ats: 'greenhouse', slug: 'vercel', name: 'Vercel' },
  { ats: 'greenhouse', slug: 'newrelic', name: 'New Relic' },
  { ats: 'greenhouse', slug: 'pagerduty', name: 'PagerDuty' },
  { ats: 'greenhouse', slug: 'sentinelone', name: 'SentinelOne' },
  { ats: 'greenhouse', slug: 'digitalocean', name: 'DigitalOcean' },
  { ats: 'greenhouse', slug: 'braze', name: 'Braze' },
  { ats: 'greenhouse', slug: 'amplitude', name: 'Amplitude' },
  { ats: 'greenhouse', slug: 'mixpanel', name: 'Mixpanel' },
  { ats: 'greenhouse', slug: 'fivetran', name: 'Fivetran' },
  { ats: 'greenhouse', slug: 'dbtlabs', name: 'dbt Labs' },
  { ats: 'greenhouse', slug: 'starburst', name: 'Starburst' },
  { ats: 'greenhouse', slug: 'singlestore', name: 'SingleStore' },
  { ats: 'greenhouse', slug: 'timescale', name: 'Timescale' },
  { ats: 'greenhouse', slug: 'neo4j', name: 'Neo4j' },
  { ats: 'greenhouse', slug: 'algolia', name: 'Algolia' },
  { ats: 'greenhouse', slug: 'contentful', name: 'Contentful' },
  { ats: 'greenhouse', slug: 'launchdarkly', name: 'LaunchDarkly' },
  { ats: 'greenhouse', slug: 'circleci', name: 'CircleCI' },
  { ats: 'greenhouse', slug: 'buildkite', name: 'Buildkite' },
  { ats: 'greenhouse', slug: 'jfrog', name: 'JFrog' },
  { ats: 'greenhouse', slug: 'tanium', name: 'Tanium' },
  { ats: 'greenhouse', slug: 'illumio', name: 'Illumio' },
  { ats: 'greenhouse', slug: 'netskope', name: 'Netskope' },
  { ats: 'greenhouse', slug: 'mindtickle', name: 'Mindtickle' },
  { ats: 'greenhouse', slug: 'icertis', name: 'Icertis' },
  { ats: 'greenhouse', slug: 'zenoti', name: 'Zenoti' },
  { ats: 'greenhouse', slug: 'whatfix', name: 'Whatfix' },
  { ats: 'greenhouse', slug: 'acceldata', name: 'Acceldata' },
  { ats: 'greenhouse', slug: 'robinhood', name: 'Robinhood' },
  { ats: 'greenhouse', slug: 'reddit', name: 'Reddit' },
  { ats: 'greenhouse', slug: 'pinterest', name: 'Pinterest' },
  { ats: 'greenhouse', slug: 'dropbox', name: 'Dropbox' },
  { ats: 'greenhouse', slug: 'asana', name: 'Asana' },
  { ats: 'greenhouse', slug: 'duolingo', name: 'Duolingo' },
  { ats: 'greenhouse', slug: 'coursera', name: 'Coursera' },
  { ats: 'greenhouse', slug: 'udemy', name: 'Udemy' },
  { ats: 'greenhouse', slug: 'grammarly', name: 'Grammarly' },
  { ats: 'greenhouse', slug: 'affirm', name: 'Affirm' },
  { ats: 'greenhouse', slug: 'toast', name: 'Toast' },
  { ats: 'greenhouse', slug: 'coupa', name: 'Coupa' },
  { ats: 'greenhouse', slug: 'agoda', name: 'Agoda' },
  { ats: 'ashby', slug: 'elevenlabs', name: 'ElevenLabs' },
  { ats: 'ashby', slug: 'perplexity', name: 'Perplexity' },
  { ats: 'ashby', slug: 'togetherai', name: 'Together AI' },
  { ats: 'ashby', slug: 'weaviate', name: 'Weaviate' },
  { ats: 'ashby', slug: 'modal', name: 'Modal' },
  { ats: 'ashby', slug: 'baseten', name: 'Baseten' },
  { ats: 'ashby', slug: 'anyscale', name: 'Anyscale' },
  { ats: 'ashby', slug: 'portkey', name: 'Portkey' },
  { ats: 'ashby', slug: 'composio', name: 'Composio' },
  { ats: 'ashby', slug: 'truefoundry', name: 'TrueFoundry' },
  { ats: 'ashby', slug: 'emergentlabsinc', name: 'Emergent Labs' },
  { ats: 'ashby', slug: 'smallest', name: 'Smallest AI' },
  { ats: 'ashby', slug: 'bjak', name: 'Bjak' },
  { ats: 'ashby', slug: 'ramp', name: 'Ramp' },
  { ats: 'ashby', slug: 'deel', name: 'Deel' },
  { ats: 'ashby', slug: 'mercury', name: 'Mercury' },
  { ats: 'ashby', slug: 'brex', name: 'Brex' },
  { ats: 'ashby', slug: 'vanta', name: 'Vanta' },
  { ats: 'ashby', slug: 'drata', name: 'Drata' },
  { ats: 'ashby', slug: 'sardine', name: 'Sardine' },
  { ats: 'ashby', slug: 'persona', name: 'Persona' },
  { ats: 'ashby', slug: 'resend', name: 'Resend' },
  { ats: 'ashby', slug: 'inngest', name: 'Inngest' },
  { ats: 'ashby', slug: 'upstash', name: 'Upstash' },
  { ats: 'ashby', slug: 'neon', name: 'Neon' },
  { ats: 'ashby', slug: 'turso', name: 'Turso' },
  { ats: 'ashby', slug: 'convex', name: 'Convex' },
  { ats: 'ashby', slug: 'tinybird', name: 'Tinybird' },
  { ats: 'ashby', slug: 'zed', name: 'Zed' },
  { ats: 'ashby', slug: 'warp', name: 'Warp' },
  { ats: 'ashby', slug: 'sourcegraph', name: 'Sourcegraph' },
  { ats: 'ashby', slug: 'codeium', name: 'Codeium' },
  { ats: 'lever', slug: 'palantir', name: 'Palantir' },
  { ats: 'lever', slug: 'plaid', name: 'Plaid' },
  { ats: 'lever', slug: 'kraken', name: 'Kraken' },
  { ats: 'lever', slug: 'chainalysis', name: 'Chainalysis' },
  { ats: 'lever', slug: 'alchemy', name: 'Alchemy' },
  { ats: 'lever', slug: 'polygon', name: 'Polygon' },
  { ats: 'lever', slug: 'outreach', name: 'Outreach' },
  { ats: 'lever', slug: 'gong', name: 'Gong' },
  { ats: 'lever', slug: 'clari', name: 'Clari' },
  { ats: 'lever', slug: 'highspot', name: 'Highspot' },
  { ats: 'lever', slug: 'attentive', name: 'Attentive' },
  { ats: 'lever', slug: 'klaviyo', name: 'Klaviyo' },
  { ats: 'lever', slug: 'intercom', name: 'Intercom' },
  { ats: 'lever', slug: 'zendesk', name: 'Zendesk' },
  { ats: 'lever', slug: 'plivo', name: 'Plivo' },
  { ats: 'lever', slug: 'exotel', name: 'Exotel' },
  { ats: 'lever', slug: 'observe-ai', name: 'Observe.AI' },
  { ats: 'lever', slug: 'sprinklr', name: 'Sprinklr' },
  { ats: 'lever', slug: 'urbancompany', name: 'Urban Company' },
  { ats: 'lever', slug: 'nobroker', name: 'NoBroker' },
  { ats: 'lever', slug: 'spinny', name: 'Spinny' },
  { ats: 'lever', slug: 'cars24', name: 'CARS24' },
  { ats: 'lever', slug: 'porter', name: 'Porter' },
  { ats: 'lever', slug: 'shiprocket', name: 'Shiprocket' },
  { ats: 'lever', slug: 'moglix', name: 'Moglix' },
  { ats: 'lever', slug: 'zetwerk', name: 'Zetwerk' },
  { ats: 'lever', slug: 'cropin', name: 'Cropin' },
];

export async function harvestLiveFastAtsBoardsFromCompaniesJson(maxBoards = 650): Promise<HarvestedJob[]> {
  const harvested: HarvestedJob[] = [];
  if (!fs.existsSync('companies.json')) return harvested;

  let companies: any[] = [];
  try {
    const parsed = JSON.parse(fs.readFileSync('companies.json', 'utf8'));
    companies = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.companies) ? parsed.companies : [];
  } catch {
    return harvested;
  }

  const deadSlugs = loadDeadBoardSlugs();
  const verifiedLiveBoards = loadVerifiedLiveBoards();
  const verifiedMap = new Map<string, { ats: string; slug: string; name: string }>();
  for (const b of verifiedLiveBoards) {
    const k = `${String(b.ats || '').toLowerCase()}:${String(b.slug || '').toLowerCase()}`;
    if (k !== ':') verifiedMap.set(k, b);
  }
  const now = Date.now();

  // Prioritize Greenhouse, Ashby, Lever, SmartRecruiters, and Workday boards
  // Skip any board quarantined within the last 7 days
  const fastBoards = companies.filter((c) => {
    const ats = String(c.ats || c.provider || c.type || '').toLowerCase();
    const slug = String(c.slug || c.board || c.id || c.token || '').trim().toLowerCase();
    if (!['greenhouse', 'ashby', 'lever', 'smartrecruiters', 'workday'].includes(ats) || !slug) return false;
    const deadTimestamp = deadSlugs[`${ats}:${slug}`];
    if (deadTimestamp && now - deadTimestamp < SEVEN_DAYS_MS) {
      return false;
    }
    return true;
  });

  // Rotate starting offset by current hour so every hour sweeps a fresh slice + top India boards
  const hourOffset = (new Date().getUTCHours() * 150) % Math.max(1, fastBoards.length);
  const rotatedSlice = [
    ...fastBoards.slice(hourOffset, hourOffset + maxBoards),
    ...fastBoards.slice(0, Math.max(0, maxBoards - (fastBoards.length - hourOffset))),
  ].slice(0, maxBoards);

  // Prepend Tier-0 High-Yield boards and persistent verified live boards, deduplicated by ats:slug
  const seenSlugs = new Set<string>();
  const selected: any[] = [];
  for (const b of [...TIER_0_HIGH_YIELD_BOARDS, ...verifiedLiveBoards, ...rotatedSlice]) {
    const ats = String(b.ats || b.provider || b.type || '').toLowerCase();
    const slug = String(b.slug || b.board || b.id || b.token || '').trim().toLowerCase();
    const key = `${ats}:${slug}`;
    if (slug && !seenSlugs.has(key)) {
      seenSlugs.add(key);
      selected.push(b);
    }
  }

  const concurrency = 40;
  for (let i = 0; i < selected.length; i += concurrency) {
    const batch = selected.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (b): Promise<HarvestedJob[]> => {
        const ats = String(b.ats || b.provider || b.type || '').toLowerCase();
        const slug = String(b.slug || b.board || b.id || b.token || '').trim();
        const companyName = String(b.name || b.company || slug).trim();
        if (!slug) return [];

        const jobsOut: HarvestedJob[] = [];
        if (ats === 'greenhouse') {
          const { data, status } = await fetchJsonFast(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`);
          if (status === 404) deadSlugs[`${ats}:${slug.toLowerCase()}`] = now;
          const list = Array.isArray(data?.jobs) ? data.jobs : [];
          for (const j of list) {
            const offLocs = Array.isArray(j.offices)
              ? j.offices.map((o: any) => o?.name || o?.location || '').filter(Boolean).join(', ')
              : '';
            const loc = [j.location?.name, offLocs].filter(Boolean).join(', ');
            const rawAbs = String(j.absolute_url || '');
            const url =
              /greenhouse\.io/i.test(rawAbs) && rawAbs
                ? rawAbs
                : j.id
                ? `https://boards.greenhouse.io/${slug}/jobs/${j.id}`
                : rawAbs;
            if (url) jobsOut.push({ company: companyName, title: String(j.title || ''), location: loc, url, ats: 'greenhouse', postedRecent: isPostedWithinHours(j.updated_at || j.first_published, 72) });
          }
        } else if (ats === 'ashby') {
          const { data, status } = await fetchJsonFast(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`);
          if (status === 404) deadSlugs[`${ats}:${slug.toLowerCase()}`] = now;
          const list = Array.isArray(data?.jobs) ? data.jobs : [];
          for (const j of list) {
            const secLocs = Array.isArray(j.secondaryLocations)
              ? j.secondaryLocations.map((s: any) => String(s?.location || s || '')).filter(Boolean).join(', ')
              : '';
            const remoteTag = j.isRemote ? 'Remote' : '';
            const loc = [j.location, j.address?.postalAddress?.addressLocality, secLocs, remoteTag]
              .filter(Boolean)
              .join(', ');
            const rawUrl = String(j.jobUrl || j.applyUrl || '');
            const url =
              /ashbyhq\.com/i.test(rawUrl) && rawUrl
                ? rawUrl
                : j.id
                ? `https://jobs.ashbyhq.com/${slug}/${j.id}/application`
                : rawUrl;
            if (url) jobsOut.push({ company: companyName, title: String(j.title || ''), location: loc, url, ats: 'ashby', postedRecent: isPostedWithinHours(j.publishedAt || j.updatedAt, 72) });
          }
        } else if (ats === 'lever') {
          const { data, status } = await fetchJsonFast(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`);
          if (status === 404) deadSlugs[`${ats}:${slug.toLowerCase()}`] = now;
          const list = Array.isArray(data) ? data : [];
          for (const j of list) {
            const allLocs = Array.isArray(j.categories?.allLocations) ? j.categories.allLocations.filter(Boolean).join(', ') : '';
            const loc = [j.categories?.location, allLocs, j.workplaceType].filter(Boolean).join(', ');
            const rawUrl = String(j.applyUrl || j.hostedUrl || '');
            const url =
              /jobs\.lever\.co/i.test(rawUrl) && rawUrl
                ? rawUrl
                : j.id
                ? `https://jobs.lever.co/${slug}/${j.id}/apply`
                : rawUrl;
            if (url) jobsOut.push({ company: companyName, title: String(j.text || ''), location: loc, url, ats: 'lever', postedRecent: isPostedWithinHours(j.createdAt, 72) });
          }
        } else if (ats === 'smartrecruiters') {
          const { data, status } = await fetchJsonFast(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=50`);
          if (status === 404) deadSlugs[`${ats}:${slug.toLowerCase()}`] = now;
          const list = Array.isArray(data?.content) ? data.content : [];
          for (const j of list) {
            const loc = [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(', ');
            const url = `https://jobs.smartrecruiters.com/${slug}/${j.id}`;
            if (j.id) jobsOut.push({ company: companyName, title: String(j.name || ''), location: loc, url, ats: 'smartrecruiters', postedRecent: isPostedWithinHours(j.releasedDate, 72) });
          }
        } else if (ats === 'workday') {
          const tenant = slug;
          const site = String(b.site || 'External_Career_Site');
          const host = String(b.host || 'wd3');
          const hostPrefix = host.includes('.') ? host : `${host}.myworkdayjobs.com`;
          const cxsUrl = `https://${tenant}.${hostPrefix}/wday/cxs/${tenant}/${site}/jobs`;
          const { data, status } = await fetchJsonFast(
            cxsUrl,
            5000,
            JSON.stringify({ limit: 20, offset: 0, searchText: 'Bengaluru' })
          );
          if (status === 404) deadSlugs[`${ats}:${slug.toLowerCase()}`] = now;
          const postings = Array.isArray(data?.jobPostings) ? data.jobPostings : [];
          for (const p of postings) {
            const loc = String(p.locationsText || 'Bengaluru, India');
            const pathPart = String(p.externalPath || '');
            const url = pathPart ? `https://${tenant}.${hostPrefix}/en-US/${site}${pathPart.startsWith('/') ? '' : '/'}${pathPart}` : '';
            if (url) {
              jobsOut.push({ company: companyName, title: String(p.title || ''), location: loc, url, ats: 'workday', postedRecent: isPostedWithinHours(p.postedOn, 72) });
            }
          }
        }
        if (jobsOut.length > 0) {
          verifiedMap.set(`${ats}:${slug.toLowerCase()}`, { ats, slug, name: companyName });
        }
        return jobsOut;
      })
    );
    for (const res of batchResults) harvested.push(...res);
  }

  saveDeadBoardSlugs(deadSlugs);
  saveVerifiedLiveBoards(Array.from(verifiedMap.values()));
  return harvested;
}

const VERIFIED_WORKDAY_BENGALURU_GCCS: Array<{ name: string; origin: string; tenant: string; site: string }> = [
  { name: 'Cisco', origin: 'https://cisco.wd5.myworkdayjobs.com', tenant: 'cisco', site: 'Cisco_Careers' },
  { name: 'Salesforce', origin: 'https://salesforce.wd12.myworkdayjobs.com', tenant: 'salesforce', site: 'External_Career_Site' },
  { name: 'Adobe', origin: 'https://adobe.wd5.myworkdayjobs.com', tenant: 'adobe', site: 'external_experienced' },
  { name: 'NVIDIA', origin: 'https://nvidia.wd5.myworkdayjobs.com', tenant: 'nvidia', site: 'NVIDIAExternalCareerSite' },
  { name: 'Mastercard', origin: 'https://mastercard.wd1.myworkdayjobs.com', tenant: 'mastercard', site: 'CorporateCareers' },
  { name: 'NatWest Group', origin: 'https://natwest.wd3.myworkdayjobs.com', tenant: 'natwest', site: 'RBS' },
  { name: 'AstraZeneca', origin: 'https://astrazeneca.wd3.myworkdayjobs.com', tenant: 'astrazeneca', site: 'Careers' },
  { name: 'ServiceNow', origin: 'https://servicenow.wd1.myworkdayjobs.com', tenant: 'servicenow', site: 'Careers' },
  { name: 'Dell', origin: 'https://dell.wd1.myworkdayjobs.com', tenant: 'dell', site: 'External' },
];

export async function harvestLiveWorkdayBengaluruGccJobs(): Promise<HarvestedJob[]> {
  const out: HarvestedJob[] = [];
  await Promise.all(
    VERIFIED_WORKDAY_BENGALURU_GCCS.map(async (gcc) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4500);
      try {
        const cxsUrl = `${gcc.origin}/wday/cxs/${gcc.tenant}/${gcc.site}/jobs`;
        const res = await fetch(cxsUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0',
          },
          body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: 'Software Engineer Bengaluru' }),
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const data = (await res.json().catch(() => null)) as any;
        const postings = Array.isArray(data?.jobPostings) ? data.jobPostings : [];
        for (const p of postings) {
          if (!p.externalPath || !p.title) continue;
          const loc = String(p.locationsText || 'Bengaluru, India');
          const url = `${gcc.origin}/${gcc.site}${p.externalPath}`;
          out.push({
            company: gcc.name,
            title: String(p.title),
            location: loc,
            url,
            ats: 'workday',
          });
        }
      } catch {
        // Ignore single GCC timeout
      } finally {
        clearTimeout(timer);
      }
    })
  );
  return out;
}

export async function runHourly100JobsHarvester(): Promise<{
  databasesUpdated: string[];
  rawHarvested: number;
  targetFitMatched: number;
  insertedOrBoosted: number;
}> {
  const [fastAtsJobs, workdayJobs] = await Promise.all([
    harvestLiveFastAtsBoardsFromCompaniesJson(650),
    harvestLiveWorkdayBengaluruGccJobs().catch(() => []),
  ]);
  const liveJobs = [...fastAtsJobs, ...workdayJobs];
  const fitJobs: HarvestedJob[] = [];

  for (const j of liveJobs) {
    const unwrapped = unwrapDirectAtsApplicationUrl(j.url);
    if (!isSupportedDirectAtsJobUrl(unwrapped)) continue;
    const fit = evaluateCandidateJobFit({
      company: j.company,
      title: j.title,
      location: j.location,
      url: unwrapped,
    });
    if (!fit.allowed) continue;
    // Prefer India / Bengaluru / Remote roles
    if (!fit.isIndia && !/\b(?:remote|anywhere|global|india)\b/i.test(j.location)) continue;
    fitJobs.push({ ...j, url: unwrapped, ats: inferAts(unwrapped) });
  }

  let totalInsertedOrBoosted = 0;
  const currentDbPaths = [
    'state/autoapply/portal-review/queue.sqlite',
    'data/queue.sqlite',
  ].filter((p) => fs.existsSync(p));

  for (const dbPath of currentDbPaths) {
    // 1. Run origin/main sync against this exact DB path
    const syncRes = syncHourlyFreshJobsFromOriginMain(dbPath);
    totalInsertedOrBoosted += syncRes.insertedFresh + syncRes.boostedExisting;

    // 2. Upsert live harvested jobs into this DB path
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA busy_timeout = 15000; PRAGMA journal_mode = WAL;');

    try {
      let acquired = false;
      let retries = 10;
      while (retries-- > 0) {
        try {
          db.exec('BEGIN IMMEDIATE');
          acquired = true;
          break;
        } catch (err: any) {
          if (/database is locked/i.test(err?.message || '') && retries > 0) {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
            continue;
          }
          break;
        }
      }

      const hasAppsTable = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='applications'").all() as any[]).length > 0;
      const hasJobsTable = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'").all() as any[]).length > 0;

      if (hasAppsTable) {
        const existingRows = db.prepare('SELECT id, normalized_url, status, payload FROM applications').all() as any[];
        const existingByUrl = new Map<string, { id: string; status: string; payload: any }>();
        for (const row of existingRows) {
          if (row.normalized_url) {
            let p: any = {};
            try { p = JSON.parse(row.payload); } catch {}
            const u = String(row.normalized_url).trim();
            existingByUrl.set(u, { id: row.id, status: row.status, payload: p });
            existingByUrl.set(u.replace(/\/$/, ''), { id: row.id, status: row.status, payload: p });
          }
        }

        const candidateId = '2e533f7f49798b955338';
        const insertStmt = db.prepare(`
          INSERT OR IGNORE INTO applications (candidate_id, id, canonical_key, normalized_url, status, payload, owner, expires)
          VALUES (?, ?, ?, ?, 'queued', ?, 'hourly_harvester', ?)
        `);
        const updateStmt = db.prepare(`
          UPDATE applications SET payload = ?, expires = ? WHERE id = ?
        `);
        const resurrectAppStmt = db.prepare(`
          UPDATE applications SET status = 'queued' WHERE id = ?
        `);

        for (const job of fitJobs) {
          const normUrl = job.url.trim();
          const existing = existingByUrl.get(normUrl) || existingByUrl.get(normUrl.replace(/\/$/, ''));
          const expiresDate = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
          const freshTier = job.postedRecent ? 3 : 2;

          if (!existing) {
            const id = `harvest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const payload = JSON.stringify({
              url: normUrl,
              jobUrl: normUrl,
              company: job.company,
              title: job.title,
              location: job.location,
              ats: job.ats,
              discoveredAt: new Date().toISOString(),
              is_hourly_fresh: freshTier,
            });
            insertStmt.run(candidateId, id, normUrl, normUrl, payload, expiresDate);
            totalInsertedOrBoosted++;
          } else if (existing.status === 'queued' || existing.status === 'skipped') {
            const p = existing.payload || {};
            p.url = p.url || normUrl;
            p.jobUrl = p.jobUrl || normUrl;
            p.location = job.location || p.location || 'India';
            p.title = job.title || p.title;
            p.company = job.company || p.company;
            p.is_hourly_fresh = Math.max(p.is_hourly_fresh || 0, freshTier);
            p.boostedAt = new Date().toISOString();
            delete p.last_error;
            delete p.error;
            delete p.reasonCode;
            updateStmt.run(JSON.stringify(p), expiresDate, existing.id);
            if (existing.status === 'skipped') {
              resurrectAppStmt.run(existing.id);
            }
            totalInsertedOrBoosted++;
          }
        }
      }

      if (hasJobsTable) {
        const existingJobRows = db.prepare('SELECT id, url, status FROM jobs').all() as any[];
        const existingJobsByUrl = new Map<string, { id: number; status: string }>();
        for (const row of existingJobRows) {
          if (row.url) {
            const u = String(row.url).trim();
            existingJobsByUrl.set(u, { id: row.id, status: row.status });
            existingJobsByUrl.set(u.replace(/\/$/, ''), { id: row.id, status: row.status });
          }
        }

        const insertJobStmt = db.prepare(`
          INSERT OR IGNORE INTO jobs (company, title, url, location, ats, status, is_hourly_fresh)
          VALUES (?, ?, ?, ?, ?, 'queued', ?)
        `);
        const updateJobStmt = db.prepare(`
          UPDATE jobs SET status = 'queued', is_hourly_fresh = MAX(COALESCE(is_hourly_fresh, 0), ?), location = ?, last_error = NULL WHERE id = ? AND status IN ('queued', 'skipped')
        `);

        for (const job of fitJobs) {
          const normUrl = job.url.trim();
          const existing = existingJobsByUrl.get(normUrl) || existingJobsByUrl.get(normUrl.replace(/\/$/, ''));
          const freshTier = job.postedRecent ? 3 : 2;
          if (!existing) {
            insertJobStmt.run(job.company, job.title, normUrl, job.location, job.ats, freshTier);
            totalInsertedOrBoosted++;
          } else if (existing.status === 'queued' || existing.status === 'skipped') {
            updateJobStmt.run(freshTier, job.location || 'India', existing.id);
            totalInsertedOrBoosted++;
          }
        }
      }

      if (acquired) {
        db.exec('COMMIT');
      }
    } catch (err: any) {
      try { db.exec('ROLLBACK'); } catch {}
      if (!/database is locked/i.test(err?.message || '')) {
        throw err;
      }
    } finally {
      db.close();
    }
  }

  // Ticket GEN-282: Re-enforce queue database invariants immediately after batch commit
  try {
    for (const dbPath of currentDbPaths) {
      enforceQueueDatabaseInvariants(dbPath);
    }
  } catch (err: any) {
    console.warn('[HARVESTER] Invariant enforcement warning:', err?.message || err);
  }

  return {
    databasesUpdated: currentDbPaths,
    rawHarvested: liveJobs.length,
    targetFitMatched: fitJobs.length,
    insertedOrBoosted: totalInsertedOrBoosted,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runHourly100JobsHarvester()
    .then((r) => console.log('Hourly harvester run completed:', r))
    .catch((err) => {
      console.error('Hourly harvester failed:', err);
      process.exit(1);
    });
}
