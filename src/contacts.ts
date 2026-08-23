/**
 * Contact discovery from public git commit metadata.
 *
 * Every commit carries its author's email in plain text, and engineers pushing
 * from a work laptop commit under their work address. A company's own public
 * repositories therefore publish their corporate addresses directly, through
 * GitHub's REST API, with no scraping and no LinkedIn involved.
 *
 * Measured on 2026-08-21 across fifteen Indian product companies (top three
 * most-recently-pushed repos each): twelve yielded corporate addresses. It
 * also returns the *real* mail domain rather than a guess, which matters more
 * than it sounds — swiggy.in, juspay.in and cred.club would all have been got
 * wrong by inferring a domain from the company name.
 *
 * This is a long-established OSINT technique (theHarvester, gitrecon, gitSome
 * all do it) rather than anything novel. None of those are worth taking as a
 * dependency for what fits in one file, but their existence is the evidence
 * that the approach holds up.
 */
import { readJson } from './state.js';

/** Addresses that are real but useless: bots, forwarders, and personal mail. */
/**
 * Consumer mail providers. Split in two because some are named by their
 * second-level label (anything under `yahoo.`) and some only make sense as a
 * whole domain — writing `web.de` in the first group would demand a trailing
 * dot that never comes, which is exactly how `x@web.de` slipped through once.
 */
const FREEMAIL_LABEL =
  /@(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|protonmail|proton|icloud|aol|gmx|yandex|zoho|rediffmail|fastmail|hey|qq|foxmail|163|126|sina|naver|daum|hanmail|seznam|libero|t-online)\./i;

const FREEMAIL_EXACT =
  /@(me\.com|mac\.com|pm\.me|web\.de|mail\.ru|orange\.fr|free\.fr|bol\.com\.br|uol\.com\.br)$/i;

const MACHINE =
  /^(noreply|no-reply|notifications?|bot|ci|build|jenkins|actions|dependabot|renovate|support|admin|root|git|github)([+.-]|@)|users\.noreply\.github\.com$|@(github|users\.noreply\.github)\.com$/i;

export interface CommitAuthor {
  name: string;
  email: string;
  /**
   * Highest-scoring recent commit message (first line) plus its date — the
   * raw material for an outreach mail's opening fact. Undefined when every
   * message seen was trivial (merges, version bumps).
   */
  subject?: string;
  date?: string;
  /** Quality of `subject` per factScore() — lets callers prefer strong hooks. */
  score?: number;
}

export interface CompanyContacts {
  org: string;
  /** The mail domain most of the corporate addresses share. */
  domain: string | null;
  /**
   * Whether that domain plausibly belongs to this company rather than to an
   * outside contributor. False means the result is evidence of something, but
   * not of this company's address format — see `domainMatchesOrg`.
   */
  domainMatchesOrg: boolean;
  /** The address pattern inferred from name/address pairs, if one is clear. */
  pattern: Pattern | null;
  authors: CommitAuthor[];
}

/**
 * Does this mail domain plausibly belong to this company?
 *
 * The dominant domain among commit authors is usually the company's own, but
 * not always: open-source repositories attract outside contributors, and a repo
 * where two Nordic Semiconductor engineers out-commit one employee will report
 * `nordicsemi.no` with total confidence. Left unchecked that produces addresses
 * at the wrong company entirely — which is worse than finding nothing, because
 * it turns into bounces, and bounces damage the sending domain for everyone.
 *
 * The test is deliberately crude: flatten both sides and ask whether the
 * company name appears in the domain. It rejects the wrong-company case cleanly
 * and costs only the companies whose mail domain shares nothing with their name
 * (Alphabet mailing as google.com). Those become misses rather than errors,
 * which is the right way to be wrong.
 */
export function domainMatchesOrg(org: string, domain: string): boolean {
  const slug = org.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (slug.length < 3) return false;
  // Compare per label, not against the flattened whole domain: "cred" appears
  // inside "accredited.com" but is not that company, while "aurora-solar.com"
  // is the same company as "Aurora Solar" once punctuation is dropped.
  const labels = domain.toLowerCase().split('.').map((label) => label.replace(/[^a-z0-9]/g, ''));
  if (labels.includes(slug)) return true;
  // Longer names are distinctive enough that appearing inside a label is
  // evidence — "razorpaycorp", "swiggyindia". Short ones are not.
  return slug.length >= 5 && labels.some((label) => label.includes(slug));
}

/**
 * The eight shapes that cover almost every corporate address. Published
 * analysis puts `first.last` at ~48% of B2B addresses and bare `first` at
 * ~27%; the split tracks headcount, with large employers standardising on
 * `first.last` and small ones defaulting to `first` until name collisions
 * force something longer.
 */
export type Pattern =
  | 'first.last'
  | 'firstlast'
  | 'first_last'
  | 'first-last'
  | 'f.last'
  | 'flast'
  | 'first'
  | 'last.first';

const PATTERNS: Pattern[] = [
  'first.last',
  'firstlast',
  'first_last',
  'first-last',
  'f.last',
  'flast',
  'first',
  'last.first',
];

/** Strip accents and anything that can't appear in a local part. */
const slug = (s: string): string =>
  s
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z]/g, ''); // NFD above splits accents off; this drops the marks with everything else

/**
 * First and last name from a display name. Middle names are dropped rather
 * than guessed at, and single-token names return no last name — which is
 * common enough in Indian datasets that silently treating the only token as a
 * surname would corrupt the pattern tally.
 */
export function splitName(name: string): { first: string; last: string } | null {
  const parts = name.trim().split(/\s+/).map(slug).filter(Boolean);
  if (parts.length < 2) return null;
  return { first: parts[0]!, last: parts[parts.length - 1]! };
}

export function buildLocalPart(pattern: Pattern, first: string, last: string): string {
  switch (pattern) {
    case 'first.last':
      return `${first}.${last}`;
    case 'firstlast':
      return `${first}${last}`;
    case 'first_last':
      return `${first}_${last}`;
    case 'first-last':
      return `${first}-${last}`;
    case 'f.last':
      return `${first[0]}.${last}`;
    case 'flast':
      return `${first[0]}${last}`;
    case 'first':
      return first;
    case 'last.first':
      return `${last}.${first}`;
  }
}

/**
 * Which pattern produced this address, given the author's name. Returns null
 * when nothing matches — a nickname, an initial-only handle, a shared alias.
 * Order matters: `flast` would also match `first` for a one-letter first name,
 * so the more specific patterns are tested first via PATTERNS' ordering.
 */
export function inferPattern(name: string, email: string): Pattern | null {
  const parts = splitName(name);
  if (!parts) return null;
  const local = (email.split('@')[0] ?? '').toLowerCase();
  return PATTERNS.find((p) => buildLocalPart(p, parts.first, parts.last) === local) ?? null;
}

export function applyPattern(pattern: Pattern, name: string, domain: string): string | null {
  const parts = splitName(name);
  if (!parts) return null;
  return `${buildLocalPart(pattern, parts.first, parts.last)}@${domain}`;
}

export const isCorporateAddress = (email: string): boolean =>
  email.includes('@') && !FREEMAIL_LABEL.test(email) && !FREEMAIL_EXACT.test(email) && !MACHINE.test(email);

/**
 * Commit messages that carry no usable opening fact. Housekeeping noise —
 * merges, dependency bumps, release tags — reads worse than no fact at all.
 */
export function isTrivialCommit(message: string): boolean {
  return /^(merge\b|bump |v?\d+\.\d+|release |revert |chore\b|update\s+(?:readme|security|[\w-]+\.(?:md|json|ya?ml)))/i.test(
    message.trim(),
  );
}

/**
 * How good is this commit message as an outreach opening fact?
 *
 * Survivors of isTrivialCommit still range from "rebuilt the CI config" to
 * "fixed a race in order matching" — both true, only one impresses a reader.
 * Prefix conventions are the cheapest signal; substance keywords and length
 * break ties. Relative, never absolute: the best available fact wins, and a
 * weak one still ships when it is all there is.
 */
export function factScore(message: string): number {
  const m = message.trim();
  const lower = m.toLowerCase();
  let score = 2;
  if (/^(fix|bugfix|hotfix)\b/.test(lower)) score += 4;
  else if (/^(feat|feature|add|implement|introduc)/.test(lower)) score += 3;
  else if (/^(refactor|perf|optimi[sz]e|speed up|migrat)/.test(lower)) score += 2;
  else if (/^([\w-]+-\d+|\[[\w-]+\])\s*[:\-]/.test(m)) score += 1; // ticketed work
  if (/\b(race|crash|leak|security|latency|memory|deadlock|corrupt|production)\b/.test(lower)) score += 1;
  // Docs-shaped work hides behind action prefixes ("Add comprehensive
  // README"); penalize the subject matter wherever it appears.
    if (/\b(readme|screenshot|changelog|code of conduct|contributing|typo|copyright year)\b/.test(lower)) score -= 4;
  if (m.split(/\s+/).length >= 6) score += 1;
  return Math.max(0, score);
}

/** Better fact = higher score; tie goes to the newer commit. */
function betterFact(
  cand: { subject: string; date?: string; score: number },
  prev?: { subject?: string; date?: string; score?: number },
): boolean {
  if (!prev?.subject) return true;
  if ((cand.score ?? 0) !== (prev.score ?? 0)) return (cand.score ?? 0) > (prev.score ?? 0);
  return new Date(cand.date ?? 0).getTime() > new Date(prev.date ?? 0).getTime();
}

/** The domain the most authors share — the company's own, in practice. */
export function dominantDomain(authors: CommitAuthor[]): string | null {
  const tally = new Map<string, number>();
  for (const { email } of authors) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (domain) tally.set(domain, (tally.get(domain) ?? 0) + 1);
  }
  const ranked = [...tally].sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? null;
}

/**
 * The pattern most name/address pairs at this domain agree on. A single pair
 * is weak evidence — one person can have a legacy or vanity address — so the
 * tally is what decides, not the first match.
 */
export function dominantPattern(authors: CommitAuthor[], domain: string): Pattern | null {
  const tally = new Map<Pattern, number>();
  for (const { name, email } of authors) {
    if (!email.toLowerCase().endsWith(`@${domain}`)) continue;
    const pattern = inferPattern(name, email);
    if (pattern) tally.set(pattern, (tally.get(pattern) ?? 0) + 1);
  }
  const ranked = [...tally].sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? null;
}

/**
 * Unauthenticated GitHub allows 60 requests an hour, which one fifteen-company
 * sweep nearly exhausts. With a token it is 5,000 — and `hunt.yml` already has
 * `GITHUB_TOKEN` — so this is effectively free at the scale needed.
 */
export class NotFound extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Rate limiting has to be waited out, not treated as a miss. A sweep over the
 * whole board list makes tens of thousands of calls, and conflating "429, come
 * back in twelve minutes" with "this org does not exist" would silently blank
 * out every company after the budget ran dry — the failure would look exactly
 * like a legitimate result.
 *
 * 404 is the genuinely common outcome (most companies have no GitHub org) and
 * gets its own type so callers can tell the two apart.
 */
const gh = async (path: string, attempt = 0): Promise<unknown> => {
  const token = process.env.GITHUB_TOKEN;
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'jobscraper-next',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (response.ok) return response.json();
  if (response.status === 404) throw new NotFound(path);

  // 403 and 429 both carry rate-limit information; primary exhaustion sets
  // x-ratelimit-remaining to 0 and names the reset, secondary limits send
  // retry-after instead.
  const retryAfter = Number(response.headers.get('retry-after'));
  const remaining = response.headers.get('x-ratelimit-remaining');
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  const rateLimited = response.status === 429 || (response.status === 403 && (remaining === '0' || retryAfter > 0));
  if (rateLimited && attempt < 5) {
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.max(1_000, reset * 1000 - Date.now() + 1_000);
    console.log(`  rate limited, waiting ${Math.round(waitMs / 1000)}s`);
    await sleep(waitMs);
    return gh(path, attempt + 1);
  }
  if (response.status >= 500 && attempt < 3) {
    await sleep(2_000 * (attempt + 1));
    return gh(path, attempt + 1);
  }
  throw new Error(`GitHub ${response.status} on ${path}`);
};

export async function githubContacts(org: string, repoLimit = 3): Promise<CompanyContacts> {
  let repos: { full_name: string }[];
  try {
    repos = (await gh(`/orgs/${org}/repos?sort=pushed&per_page=${repoLimit}`)) as { full_name: string }[];
  } catch (error) {
    // No such org is the common case, not an error worth propagating — most
    // companies in companies.json have no GitHub presence at all. Anything
    // else (rate limits that outlasted their retries, network trouble) has to
    // surface, or a sweep quietly records thousands of false misses.
    if (error instanceof NotFound) return { org, domain: null, domainMatchesOrg: false, pattern: null, authors: [] };
    throw error;
  }

  const seen = new Set<string>();
  const authors: CommitAuthor[] = [];
  const latestByAuthor = new Map<string, { subject: string; date?: string; score: number }>();
  for (const repo of repos) {
    let commits: {
      commit: { author: { name: string; email: string; date?: string }; message: string };
    }[];
    try {
      commits = (await gh(`/repos/${repo.full_name}/commits?per_page=100`)) as typeof commits;
    } catch {
      continue; // Empty or disabled repos 409; nothing to do but move on.
    }
    for (const entry of commits) {
      const email = entry.commit?.author?.email?.toLowerCase();
      const name = entry.commit?.author?.name;
      if (!email || !name) continue;

      // Fact capture runs before the corporate filter so a personal-address
      // author's work still informs the tally below. Only the first line
      // counts, trivial housekeeping never qualifies, and the best-scoring
      // commit wins rather than merely the first-seen one.
      if (!isTrivialCommit(entry.commit.message)) {
        const subject = entry.commit.message.split('\n')[0]!.slice(0, 120);
        const cand = {
          subject,
          date: entry.commit.author?.date,
          score: factScore(subject),
        };
        if (betterFact(cand, latestByAuthor.get(email))) latestByAuthor.set(email, cand);
      }

      if (seen.has(email) || !isCorporateAddress(email)) continue;
      if (!seen.has(email)) {
        seen.add(email);
        authors.push({ name, email, ...latestByAuthor.get(email) });
      }
    }
  }
  for (const author of authors) Object.assign(author, latestByAuthor.get(author.email) ?? {});

  const domain = dominantDomain(authors);
  return {
    org,
    domain,
    domainMatchesOrg: domain ? domainMatchesOrg(org, domain) : false,
    pattern: domain ? dominantPattern(authors, domain) : null,
    authors: domain ? authors.filter((a) => a.email.endsWith(`@${domain}`)) : authors,
  };
}

if (process.argv[1]?.endsWith('contacts.ts')) {
  const orgs = process.argv.slice(2);
  if (orgs.length === 0) {
    console.log('usage: npm run contacts -- razorpay meesho zomato');
    process.exit(1);
  }
  for (const org of orgs) {
    const result = await githubContacts(org);
    console.log(
      `${org.padEnd(18)} ${(result.domain ?? '—').padEnd(22)} ${(result.pattern ?? '—').padEnd(12)} ${result.authors.length} authors${result.domain && !result.domainMatchesOrg ? '   [domain does not match org name]' : ''}`,
    );
    for (const author of result.authors.slice(0, 5)) console.log(`    ${author.email}  (${author.name})`);
  }
}

/** Kept for the eventual outreach step: never mail the same address twice. */
export const loadContacted = () => readJson<Record<string, string>>('state/contacted.json', {});
