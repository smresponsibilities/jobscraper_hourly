/**
 * Cold-reach draft generator — the human-sends-everything model.
 *
 *   npm run outreach              # build the batch, write out/outbox/today.html
 *                                 # + batch.json, cache verdicts — no server
 *   npm run outreach -- --serve   # the same batch, served at localhost:7700
 *
 *   npx tsx src/outreach.ts --sent-manual addr@company.com
 *                                 # record a mail you sent by hand, so the
 *                                 # follow-up schedule and the 24h send cap
 *                                 # both stay honest
 *   npm run outreach -- --print   # text-only plan, no server
 *   npm run outreach -- --static  # write out/outbox/today.html, no server
 *   npm run outreach -- --mbox    # write out/outbox/<date>/*.txt for git
 *                                 # send-email; review, then npm run
 *                                 # outreach:send -- out/outbox/<date>
 *
 * Two independent first-touch lanes plus shared follow-ups:
 *
 *   triggered lane — companies whose newest catalogue role opened within the
 *                    last TRIGGER_WINDOW_DAYS; the hourly-fresh trigger.
 *   random lane    — everything else with an open role, rotated daily.
 *
 * Every candidate address passes SMTP verification (verify-email.ts) before
 * it can reach the page: `invalid` is dropped, `unknown` ships with a warning
 * badge, `valid` ships clean. The verdict is stored on the contact with a
 * timestamp and reused for VERDICT_TTL_DAYS so a mailbox is probed once, not
 * every reload. No fact, no mail; no near-twin bodies in one batch; the human
 * is the transport — nothing here speaks SMTP as a sender.
 */
import http from 'node:http';
import { createHash } from 'node:crypto';
import { writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { readJson } from './state.js';
import { mapLimit } from './fetchers/util.js';
import { githubContacts, splitName, applyPattern, type CommitAuthor } from './contacts.js';
import { dmarcRua, npmContacts, pypiContacts, mavenContacts, smartRecruitersCreators, websiteContacts, leadershipContacts } from './contact-sources.js';
import { verifyEmail, type Verdict } from './verify-email.js';

// ── knobs ────────────────────────────────────────────────────────────────────

/**
 * These three caps double as the ATTEMPT pool size, not just the output
 * ceiling — `buildBatch()` selects exactly `min(laneBudget, budget)`
 * companies per lane before resolving any contact, so a low cap starves
 * resolution of candidates rather than merely trimming a longer result.
 *
 * First raised 50→100 on 2026-09-02 off a real local measurement (one build
 * attempted 50/50 and resolved 38/29 — both well under cap, so the cap itself
 * was the binding constraint, not a lack of real contacts; the triggered
 * lane's real pool measured 139 companies with a posting inside
 * TRIGGER_WINDOW_DAYS that day). Raised again to 500 the same day on direct
 * request — more cards to manually pick from, independent of what the
 * measured pool needs. The triggered lane still can't exceed its real
 * same-day pool regardless of this number (139 that day; it moves daily), so
 * 500 there is harmless headroom, not 500 real triggered contacts — the
 * random lane's pool is large enough that 500 there is a real target. This is
 * no longer sized off the "measure before raising" ceiling that governed the
 * first bump; if a build starts taking noticeably longer than the hourly
 * cadence can absorb, that is the next thing to measure.
 */
const RANDOM_BUDGET = Number(process.env.OUTREACH_RANDOM ?? 40);
const TRIGGERED_BUDGET = Number(process.env.OUTREACH_TRIGGERED ?? 40);
/**
 * Hard ceiling on total cards per build (follow-ups count toward this). Not a
 * literal per-24h counter despite the name — `buildBatch()` recomputes a
 * fresh `DAILY_BUDGET` allowance on every invocation with no cross-run
 * persistence, so moving `outreach.yml` to hourly means this is really "per
 * build" now, not "per day". Must stay >= the two caps above combined or it
 * silently becomes the binding constraint instead of them.
 */
const DAILY_BUDGET = Number(process.env.OUTREACH_DAILY ?? 100);
/**
 * The real send ceiling, counted across state's own `sentAt` timestamps on a
 * rolling 24h window — the way providers count, not per local midnight and not
 * per process. Shared by the click-through server here and by outreach-send.ts,
 * which is where this lived while the *primary* send path (a human clicking
 * cards) had no cap at all. OUTREACH-DESIGN.md §1 sizes it: 20/day/mailbox
 * while ramping, and a new mailbox jumping to 50/day flags within days.
 */
export const SEND_CAP = Number(process.env.OUTREACH_AUTO_CAP ?? 12);
export function sentInLast24h(state: OutreachState): number {
  const cutoff = Date.now() - 24 * 60 * 60_000;
  let count = 0;
  for (const entry of Object.values(state)) {
    for (const iso of entry.sentAt ?? []) if (new Date(iso).getTime() >= cutoff) count++;
  }
  return count;
}
/**
 * A role younger than this puts its company in the triggered lane. Widened
 * 7→21 on 2026-09-02 after measuring the real pool directly against the live
 * catalogue: 105 unique companies at 7 days, 130 at 21 — a real ~24% lift.
 * Stopped at 21, not pushed further: many ATS platforms report age as the
 * bucket string "Posted 30+ Days Ago" rather than a real number, which
 * `postedAgeDays()` parses as literally 30 — so the pool jumps to 201 the
 * instant the window reaches 30, not from genuinely fresher roles but from
 * swallowing that entire "who knows how old, could be years" bucket as if it
 * meant exactly 30 days. Widening past 21 would trade lead quality for a
 * fake volume number, which is the opposite of what this knob is for.
 */
export const TRIGGER_WINDOW_DAYS = 21;
const TOUCH_GAPS = [0, 4, 9, 16];
const FACT_MAX_AGE_DAYS = 90;
/** Bound the wall-clock cost of SMTP probing per company per build. */
const MAX_PROBES_PER_COMPANY = Number(process.env.OUTREACH_PROBES ?? 4);
/** ATSes whose `token` is the company's own hostname, not an ATS subdomain — see `alternates()`. */
export const HOSTNAME_ATS = new Set(['phenom', 'icims', 'zohorecruit', 'successfactors']);
const VERDICT_TTL_DAYS = 14;
/**
 * A bounce is evidence about the guessed pattern at a domain, not just about
 * the one address that bounced — a second independent bounce at the same
 * domain means the pattern itself is probably wrong, not that two people in
 * a row happened to have typo'd inboxes. 1 stays silent (could be noise, a
 * fat-fingered hiccup); 2+ stops drafting new candidates at that domain
 * until a human clears it by fixing the pattern or the guard.
 * `domainRiskTally()`/`domainRiskBounces` already computed this per company
 * build — it only reached the card as a warning badge until now.
 */
const DOMAIN_RISK_MAX_BOUNCES = Number(process.env.OUTREACH_DOMAIN_RISK_MAX ?? 2);
/**
 * Signed with the full name, matching the From header. Signing two initials
 * while the envelope says a full name is a small mismatch the reader notices
 * before anything else in the mail.
 */
const SIGNATURE = process.env.OUTREACH_NAME ?? 'Shivam Mahajan';
/**
 * Who is writing, in one line, plus the standing opt-out. Both are deliberately
 * constant across every touch (OUTREACH-DESIGN.md §3: a rotating signature is
 * its own tell; §7: the opt-out is the etiquette baseline that keeps a sending
 * domain off blocklists).
 *
 * They exist because the rendered mail previously never said who was writing or
 * what they wanted. An unnamed stranger quoting your commit and telling you
 * about your own employer's job posting reads as a scraper, and leaves nobody
 * to reply to — the most expensive omission in the whole template. Both are
 * env-overridable; `--check` warns while OUTREACH_NAME is still the default.
 */
const IDENTITY =
  process.env.OUTREACH_IDENTITY ??
  'Final-semester BE CSE, graduating Aug 2026 — looking at 0–3 yr roles.';
const OPT_OUT = process.env.OUTREACH_OPT_OUT ?? 'Tell me to stop and I will.';
/**
 * The one link, in the signature rather than the body. OUTREACH-DESIGN.md §3
 * allows exactly one and §6 asks for none in the body of a first touch; a URL
 * sitting in a signature block is ordinary mail furniture rather than a call to
 * action, which is the distinction those two rules are really drawing.
 *
 * LinkedIn over a portfolio or a LeetCode profile on purpose: it is the link a
 * recipient expects to see, the one they are least suspicious of, and it is
 * where a claimed employer becomes checkable. Swap it for a portfolio once
 * there is a real one to swap in — an empty page is worse than no link.
 */
const PROFILE_LINK = process.env.OUTREACH_LINK ?? 'linkedin.com/in/mahajanshivam';
/**
 * Which signed-in Gmail the compose link opens as. The default '0' is whatever
 * account the browser happens to consider first, which on a machine signed into
 * the alert inbox means the first cold mail goes out from the address the whole
 * ramp exists to protect — invisibly, and only discoverable afterwards by
 * reading Sent Mail. Set it to the outreach account's index or full address.
 */
const GMAIL_USER = process.env.OUTREACH_GMAIL_USER ?? '0';
const PORT = Number(process.env.OUTREACH_PORT ?? 7700);
/**
 * Deployed mode: when set (e.g. "https://site.vercel.app/api"), card buttons
 * point at the hosted API routes instead of the local server, so clicks from
 * the published page record state exactly like localhost does.
 */
const LINK_BASE = (process.env.OUTREACH_LINK_BASE ?? '').replace(/\/$/, '');
/**
 * Shared secret for the hosted routes. The draft ids are the recipients' own
 * addresses, so an ungated API plus a published batch would let anyone mark
 * the whole campaign skipped. Only appended in deployed mode; the localhost
 * server needs no key.
 */
const LINK_KEY = process.env.OUTREACH_KEY ?? '';
const actionUrl = (path: string) =>
  LINK_BASE ? `${LINK_BASE}/${path}${LINK_KEY ? `?k=${encodeURIComponent(LINK_KEY)}` : ''}` : `/${path}`;

export const STATE_PATH = process.env.OUTREACH_STATE_PATH ?? 'state/contacted.json';
const SWEEP_PATH = 'state/contact-sweep.json';
const SWEEP_INDEX_PATH = 'state/contact-sweep-index.json';
const CATALOG_PATH = 'data/jobs.json';
const PID_PATH = 'state/outreach.pid';
const PAGE_PATH = 'out/outbox/today.html';
/**
 * The standing pool of options. Gitignored for the same reason contacted.json
 * is: it is keyed by real people's work addresses and holds unsent mail bodies,
 * and this repo is public. It round-trips through the private data repo with
 * the rest of the outreach state.
 */
const DRAFTS_PATH = process.env.OUTREACH_DRAFTS_PATH ?? 'state/drafts.json';

// Deterministic daily rotation. OUTREACH_SEED exists so a day's batch can be
// reproduced exactly (tests, "what did I see yesterday"); default is today.
const daySeed = () => process.env.OUTREACH_SEED ?? new Date().toISOString().slice(0, 10);

// ── state ────────────────────────────────────────────────────────────────────

export interface ContactState {
  company: string;
  role: string;
  location?: string;
  jobUrl: string;
  firstName?: string;
  /** Completed touches; TOUCH_GAPS.length means sequence finished. */
  touch: number;
  sentAt: string[];
  nextDueAt: string;
  fact?: string;
  subject: string;
  verdict?: Verdict;
  verifiedAt?: string;
  /** Gravatar confirmed the exact address exists (positive-only signal). */
  gravatar?: boolean;
  /** Full name as the contact ladder found it — needed to search LinkedIn for
   *  this person later; firstName alone is not enough to identify anybody. */
  name?: string;
  /** When the LinkedIn connection request was sent, so the weekly list can
   *  stop offering them. Set by a click; nothing here talks to LinkedIn. */
  connectedAt?: string;
  replied?: boolean;
  skipped?: boolean;
  bounced?: boolean;
  bouncedAt?: string;
  /** Which rung of the ladder found this contact — git/npm/pypi/maven. Lets
   *  reply/bounce outcomes eventually be measured per source, not just per
   *  address; CONTACT-DISCOVERY.md's hit-rate numbers have never had a reply
   *  signal to check them against. */
  source?: string;
}
export type OutreachState = Record<string, ContactState>;

export interface CatalogJob {
  id: string;
  title: string;
  company: string;
  industry?: string;
  location?: string;
  url: string;
  postedAt?: string;
  /** When catalog.ts first recorded this exact job id — always a real ISO
   *  timestamp, unlike postedAt which some ATS platforms only report as a
   *  vague bucket ("Posted 30+ Days Ago"). */
  firstSeen?: string;
  minYears?: number | null;
  maxYears?: number | null;
  closedAt?: string;
  postedBy?: string;
}

/**
 * Triggered by either signal, not just the ATS's self-reported postedAt:
 * a role this tracker only just started seeing is exactly what "triggered"
 * means, even when the ATS itself won't say how old the posting really is.
 * Shared by loadCompanyPool() (selection) and buildFirstDraft() (the
 * rendered card's own lane label) so the two can never disagree about which
 * lane a company landed in.
 */
export function isTriggered(job: CatalogJob): boolean {
  const byPostedAt = (postedAgeDays(job.postedAt) ?? Infinity) <= TRIGGER_WINDOW_DAYS;
  if (byPostedAt) return true;
  if (!job.firstSeen) return false;
  const firstSeenDays = (Date.now() - new Date(job.firstSeen).getTime()) / 86_400_000;
  return Number.isFinite(firstSeenDays) && firstSeenDays <= TRIGGER_WINDOW_DAYS;
}

async function saveState(state: OutreachState): Promise<void> {
  await mkdir('state', { recursive: true });
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

// ── single-instance lock ─────────────────────────────────────────────────────

/**
 * Two concurrent runs would double-draft the same people and race the state
 * file. The pidfile refuses a second live instance; a stale file (crashed
 * run) is detected by probing the pid and overwritten.
 */
async function acquireLock(): Promise<boolean> {
  let prevPid: number | null = null;
  try {
    prevPid = Number((await readFile(PID_PATH, 'utf8')).trim());
  } catch {
    /* first run */
  }
  if (prevPid && Number.isFinite(prevPid) && prevPid !== process.pid) {
    try {
      process.kill(prevPid, 0); // throws ESRCH if dead
      console.error(`outreach already running (pid ${prevPid}). Close it or delete ${PID_PATH}.`);
      return false;
    } catch {
      /* stale — fall through and take over */
    }
  }
  await mkdir('state', { recursive: true });
  await writeFile(PID_PATH, `${process.pid}\n`, 'utf8');
  const release = async () => {
    try {
      const txt = await readFile(PID_PATH, 'utf8');
      if (Number(txt.trim()) === process.pid) await rm(PID_PATH);
    } catch {
      /* already gone */
    }
  };
  process.once('exit', () => void release());
  process.once('SIGINT', () => { void release().finally(() => process.exit(0)); });
  process.once('SIGTERM', () => { void release().finally(() => process.exit(0)); });
  return true;
}

// ── pure helpers (selftested) ────────────────────────────────────────────────

export function touchGap(touch: number): number {
  return TOUCH_GAPS[Math.min(Math.max(touch, 0), TOUCH_GAPS.length - 1)]!;
}

export function nextDueAt(fromIso: string, touchJustSent: number): string {
  return new Date(new Date(fromIso).getTime() + touchGap(touchJustSent) * 86_400_000).toISOString();
}

/**
 * Age in days of a catalogue posting. Handles ISO timestamps and Workday's
 * relative strings ("Posted Today", "Posted 30+ Days Ago"); anything else
 * parses as null, which reads as "unknown age", never as fresh.
 */
export function postedAgeDays(postedAt?: string): number | null {
  if (!postedAt) return null;
  // 'Yesterday' is its own word on Workday and iCIMS boards — not a number,
  // not 'today'. Without it those postings fall through to the Date parse,
  // come back NaN, and are treated as age-unknown: the single freshest slice
  // of the catalogue (71 of 2,367 entries when this was found) was landing in
  // the random lane instead of the triggered one.
  const rel = /^posted\s+(?<today>today)|^posted\s+(?<yday>yesterday)|^posted\s+(?<n>\d+)\+?\s+days?\s+ago/i.exec(postedAt.trim());
  if (rel) {
    if (rel.groups?.n != null) return Number(rel.groups.n);
    return rel.groups?.yday ? 1 : 0;
  }
  const t = new Date(postedAt).getTime();
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

/** Catalogue names arrive raw from auto-discovery; lowercase ones read badly in mail. */
export function displayName(name: string): string {
  return name === name.toLowerCase()
    ? name.replace(/\b[a-z]/g, (c) => c.toUpperCase())
    : name;
}

export function bodySimilarity(a: string, b: string): number {
  const tokens = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3),
    );
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.min(A.size, B.size);
}

export interface BodyInput {
  greet: string;
  first: string;
  fact?: string;
  roleLine: string;
  ask: string;
  passAlong: string;
}

export function renderBody(o: BodyInput): string {
  const lines = [`${o.greet} ${o.first},`, ''];
  if (o.fact) lines.push(`${o.fact}`, '');
  lines.push(o.roleLine, '', IDENTITY, '', o.ask, '', o.passAlong, '', `— ${SIGNATURE}`);
  if (PROFILE_LINK) lines.push(PROFILE_LINK);
  lines.push(OPT_OUT);
  return lines.join('\n');
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
const GREETINGS = ['Hi', 'Hello', 'Hey'];
/**
 * What kind of work a commit subject describes. Conventional-Commits prefixes
 * first, since a repo that uses them is unambiguous; keyword shapes after, for
 * the majority that do not.
 *
 * The point is not taxonomy for its own sake — it is that a fix, a perf change
 * and a refactor each deserve a different sentence. "Saw your recent commit"
 * followed by a quoted subject reads identically whatever the person actually
 * did, which is precisely what makes it feel generated.
 */
export type CommitKind = 'fix' | 'feat' | 'perf' | 'refactor' | 'test' | 'infra' | 'docs' | 'revert' | 'other';

export function commitKind(subject: string): CommitKind {
  const m = subject.trim().toLowerCase();
  const conventional = /^([a-z]+)(\([^)]*\))?!?:/.exec(m)?.[1];
  const byPrefix: Record<string, CommitKind> = {
    fix: 'fix', bugfix: 'fix', hotfix: 'fix',
    feat: 'feat', feature: 'feat',
    perf: 'perf',
    refactor: 'refactor', style: 'refactor',
    test: 'test', tests: 'test',
    build: 'infra', ci: 'infra', chore: 'infra', deps: 'infra',
    docs: 'docs', doc: 'docs',
    revert: 'revert',
  };
  if (conventional && byPrefix[conventional]) return byPrefix[conventional]!;
  // A revert is somebody's bad day and must be caught even unprefixed — see
  // FACT_TEMPLATES below for why it never becomes an opening line.
  if (/^revert\b|\brevert(s|ing|ed)?\b/.test(m)) return 'revert';
  if (/^(fix|bugfix|hotfix|resolve|correct|patch)\b|\bfixes\b/.test(m)) return 'fix';
  if (/^(perf|optimi[sz]e|speed ?up|reduce latency|cache)\b|\b(latency|throughput|faster)\b/.test(m)) return 'perf';
  if (/^(refactor|clean ?up|simplify|rename|extract|deduplicate|tidy)\b/.test(m)) return 'refactor';
  if (/^(test|spec)\b|\b(unit test|integration test|coverage|e2e)\b/.test(m)) return 'test';
  if (/^(build|ci|chore|bump|release|deploy|infra)\b|\b(pipeline|dockerfile|workflow)\b/.test(m)) return 'infra';
  if (/^(doc|docs|readme)\b/.test(m)) return 'docs';
  if (/^(feat|add|implement|introduce|support|enable)\b|\badds\b/.test(m)) return 'feat';
  return 'other';
}

/**
 * One opener per kind of work, each ending in the commit's own subject.
 *
 * Two things every variant does deliberately:
 *
 *   1. It says HOW the sender found them — "going through {company}'s public
 *      repos". Unexplained knowledge of a stranger's work is the single thing
 *      that makes this kind of mail feel like surveillance; explained knowledge
 *      reads as research. It is also simply true: that is exactly what
 *      contacts.ts did to find this address.
 *   2. It reacts to the *kind* of work rather than praising the person. "Perf
 *      work is the part I like most" is a statement about the sender and cannot
 *      be wrong; "great fix!" is a judgement on code nobody here has read, and
 *      an engineer can tell the difference instantly.
 *
 * Nothing here claims to have read the diff, used the product, or understood
 * the problem. Everything that could only be known by doing so is absent on
 * purpose — the quoted subject is the whole of the evidence, and the opener
 * never pretends otherwise.
 *
 * 'revert' has no templates and never will: opening a cold email by mentioning
 * that somebody had to undo their own work is a bad first impression that no
 * phrasing rescues. It falls through to no fact at all, and buildFirstDraft
 * simply omits the paragraph.
 */
const FACT_TEMPLATES: Record<Exclude<CommitKind, 'revert'>, string[]> = {
  fix: [
    'Was going through {company}\'s public repos and ran into your fix — “{subject}”. Good catch.',
    'Your “{subject}” fix came up while I was reading through {company}\'s repos.',
  ],
  feat: [
    'Was going through {company}\'s public repos and saw you shipped “{subject}”.',
    'Came across “{subject}” in {company}\'s public repos — looks like a real chunk of work.',
  ],
  perf: [
    'Was reading {company}\'s public repos and found your “{subject}”. Performance work is the part I like reading most.',
    'Came across “{subject}” in {company}\'s repos — perf changes are my favourite kind to read.',
  ],
  refactor: [
    'Was going through {company}\'s public repos and saw “{subject}” — the sort of cleanup nobody gets thanked for.',
    'Your “{subject}” showed up while I was reading through {company}\'s repos.',
  ],
  test: [
    'Was reading {company}\'s public repos and found “{subject}” — test and harness work is badly underrated.',
    'Came across “{subject}” in {company}\'s public repos.',
  ],
  infra: [
    'Was going through {company}\'s public repos and saw “{subject}” — the thankless half of the job.',
    'Your “{subject}” came up while I was reading through {company}\'s repos.',
  ],
  docs: [
    'Was going through {company}\'s public repos and your name came up on “{subject}”.',
    'Came across “{subject}” in {company}\'s public repos.',
  ],
  other: [
    'Was going through {company}\'s public repos and your “{subject}” came up.',
    'Came across “{subject}” in {company}\'s public repos.',
  ],
};

/**
 * The rendered opening line, or null when there should not be one. Pure and
 * exported so the selftest can assert the revert rule and the kind mapping
 * without building a whole draft.
 */
/**
 * Drop a Conventional-Commits prefix before quoting. The opener already says
 * what kind of change it was, so quoting “fix: null check in order parser”
 * after the words "your fix" labels it twice and reads like a machine pasted a
 * field in. A non-conventional subject is left exactly as its author wrote it.
 */
export function cleanSubject(subject: string): string {
  const trimmed = subject.trim();
  const stripped = trimmed.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '');
  // Never strip away the whole subject: a commit literally called "fix:" has
  // nothing left to quote, and the raw form is better than an empty string.
  return stripped.length >= 3 ? stripped : trimmed;
}

export function factLine(subject: string, company: string, seed: string): string | null {
  const kind = commitKind(subject);
  if (kind === 'revert') return null;
  return pick(FACT_TEMPLATES[kind], seed)
    .replace('{company}', company)
    .replace('{subject}', cleanSubject(subject));
}
const SR_FACT_VERBS = ['Saw you posted', 'Noticed you opened', "Saw you're listed as the creator of"];
const ASK_T1 = [
  'Is this req open to 0–3 yrs? y/n works.',
  'Should I apply through the portal, or is there someone better to send this to?',
  'Is it open to early-career folks? One word helps.',
];
/**
 * Asks for when the req's own listed band already covers an early-career
 * candidate. "Is this open to 0-3 yrs?" is a wasted question when the posting
 * says 0-3 on its face — the reader has to wonder whether you read it. Ask the
 * thing the posting cannot answer instead: routing, timing, what a good
 * application looks like.
 */
const ASK_MATCHED = [
  'Worth applying through the portal, or is there someone better to send it to?',
  'Anything you would want to see in an application for it?',
  'Is the team still actively interviewing, or is it early days?',
];
const ASK_T2 = [
  'Following up once — still open? A one-word reply is plenty.',
  'Circling back on this. Still live?',
];
const ASK_T3 = [
  "Last nudge from me — if it's filled or off-target, a 'no' closes the loop and I won't write again.",
  'Closing this out on my side — worth keeping in touch for the next one, or should I stop writing?',
  "One line either way and I'll stop bothering you: still hiring for this, or not?",
];
const PASS_ALONG = [
  'Not you? Happy if you point me right.',
  "If this isn't yours, who should it go to?",
];
const pick = <T>(pool: T[], seed: string): T => pool[hash(seed) % pool.length]!;

function experienceLabel(minYears?: number | null, maxYears?: number | null): string {
  if (minYears == null && maxYears == null) return '';
  if (minYears != null && maxYears != null) return `${minYears}–${maxYears} yrs`;
  if (minYears != null) return `${minYears}+ yrs`;
  return `up to ${maxYears} yrs`;
}

// ── target selection ─────────────────────────────────────────────────────────

interface CompanyTarget {
  company: string;
  job: CatalogJob;
  lane: 'triggered' | 'random';
}

export function loadCompanyPool(catalog: CatalogJob[], state: OutreachState): CompanyTarget[] {
  const byCompany = new Map<string, CatalogJob>();
  for (const job of catalog) {
    if (job.closedAt) continue;
    const key = job.company.toLowerCase();
    const prev = byCompany.get(key);
    if (!prev || (postedAgeDays(job.postedAt) ?? Infinity) < (postedAgeDays(prev.postedAt) ?? Infinity)) {
      byCompany.set(key, job);
    }
  }
  /**
   * Keyed on an actual send (touch > 0), not on mere presence in the state
   * file. syncVerdicts() writes an entry for every draft it merely *renders* —
   * that is what caches the SMTP verdict — so keying on presence meant one
   * hourly `--static` build permanently excluded every company it displayed,
   * having sent nothing. Two or three builds and the pool was empty forever:
   * the feature would have died before its first email. It also matches what
   * OUTREACH-DESIGN.md §6 actually specifies ("dedupe is by address only, a
   * company may re-enter the pool for each new job opening").
   *
   * A skipped-but-never-mailed contact deliberately does NOT retire its
   * company — "wrong person" is not "wrong company". The address itself stays
   * retired, in buildBatch below.
   */
  const contactedCompanies = new Set(
    Object.values(state)
      .filter((c) => c.touch > 0)
      .map((c) => c.company.toLowerCase()),
  );
  return [...byCompany.values()]
    .filter((job) => !contactedCompanies.has(job.company.toLowerCase()))
    // Seed is PREFIXED, not suffixed: a suffix change adds one uniform
    // constant to every polynomial hash and provably preserves sort order
    // (shipped broken once — ten test runs came back byte-identical).
    .map((job) => ({ rank: hash(`${daySeed()}::${job.company}`), job }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ job }) => ({
      company: displayName(job.company),
      job,
      lane: isTriggered(job) ? 'triggered' : 'random',
    }));
}

// ── contacts, facts, verification ────────────────────────────────────────────

interface SweepEntry {
  org: string | null;
  domain: string | null;
  matched: boolean;
}

interface Candidate extends CommitAuthor {
  verdict?: Verdict;
  gravatar?: boolean;
  source?: string;
}

/**
 * companies.json is the bridge between catalogue display names and GitHub
 * orgs. Catalogue names are often the raw ATS *tenant* string ("valtech",
 * "tracelinkinc"), so a company's own board token is frequently the real org
 * slug. Indexed under both name and token, lowercased — sweep, catalogue and
 * companies.json disagree on casing constantly.
 */
async function buildCompanyIndex(): Promise<{
  byName: Map<string, { token: string; ats: string }>;
}> {
  const companies = await readJson<{ name: string; ats: string; token: string }[]>('companies.json', []);
  const byName = new Map<string, { token: string; ats: string }>();
  for (const c of companies) {
    if (!byName.has(c.name.toLowerCase())) byName.set(c.name.toLowerCase(), { token: c.token, ats: c.ats });
  }
  return { byName };
}

/**
 * Sweep entries are keyed by exact display name; lowercase both sides.
 *
 * Prefers the full local sweep, falls back to the committed index. The full
 * file is gitignored (1.6 MB, rewritten wholesale), so on a runner it is
 * simply absent — and without the fallback every hosted build resolves orgs
 * by guessing at ATS tokens and ignores everything the sweep already
 * established. See the comment on save() in src/contacts-sweep.ts.
 */
async function loadSweepLower(): Promise<Map<string, SweepEntry>> {
  const full = await readJson<Record<string, SweepEntry>>(SWEEP_PATH, {});
  const sweep =
    Object.keys(full).length > 0 ? full : await readJson<Record<string, SweepEntry>>(SWEEP_INDEX_PATH, {});
  return new Map(Object.entries(sweep).map(([k, v]) => [k.toLowerCase(), v]));
}

let companyIndex: Awaited<ReturnType<typeof buildCompanyIndex>> | null = null;
let sweepLower: Map<string, SweepEntry> | null = null;

async function resolveRecipients(
  company: string,
  tokenHint: string,
  want: number,
  state: OutreachState,
  postedByHint?: string,
): Promise<Candidate[]> {
  companyIndex ??= await buildCompanyIndex();
  sweepLower ??= await loadSweepLower();

  const key = company.toLowerCase();
  const entry = sweepLower.get(key);
  const known = companyIndex.byName.get(key);
  // Org candidates in priority order: what the sweep verified → the
  // company's own ATS token (often IS the tenant/org slug) → the job-id
  // token hint → the raw name itself (covers tenant-named catalogues).
/**
 * 75.1% of the 12,988 companies swept produced no domain at all, and
 * COLDMAIL-PLAN.md §5 calls widening these candidates "the biggest single
 * lever by a wide margin" — until now only the sweep's org, the ATS token,
 * the job-id token and the raw name were ever tried. Orgs are named after
 * companies with a small, closed set of decorations: a hyphenated or
 * collapsed multi-word name, or one of a handful of suffixes.
 *
 * Ordering matters more than length: the first three candidates are the only
 * ones actually attempted (see the slice at the call site), so evidence-backed
 * names stay in front and these guesses only fill empty slots behind them.
 */
function orgNameVariants(name: string): string[] {
  const bare = name.replace(/[^a-z0-9 -]/gi, '').trim().toLowerCase();
  if (!bare) return [];
  const collapsed = bare.replace(/[\s-]+/g, '');
  const hyphenated = bare.replace(/\s+/g, '-');
  const stem = collapsed.replace(/(inc|llc|ltd|limited|corp|technologies|technology|labs|software)$/, '');
  return [
    collapsed,
    hyphenated,
    ...['-inc', '-io', '-hq', '-labs', '-eng', '-oss', '-tech', '-dev'].map((sfx) => stem + sfx),
  ];
}

  const orgCandidates = [
    ...new Set(
      [
        entry?.org ?? null,
        known?.token ?? null,
        tokenHint.replace(/[^a-z0-9-]/gi, '').toLowerCase() || null,
        key,
        ...orgNameVariants(company),
      ].filter((c): c is string => Boolean(c && c.length >= 2)),
    ),
  ];

  /** SMTP verdict + Gravatar tie-break, shared by the git path and the npm path. */
  const finalize = async (candidates: Candidate[]): Promise<Candidate[]> => {
    // DMARC pre-flight, once per company domain: a published rua record is the
    // cheapest evidence the mail domain is real and managed before any probe.
    const firstDomain = candidates[0]?.email.split('@')[1];
    if (firstDomain) {
      try {
        if (!(await dmarcRua(firstDomain))) {
          console.log(`    ! ${firstDomain}: no DMARC published — extra caution on bounces`);
        }
      } catch {
        // DNS trouble must never block the discovery path.
      }
    }
    let probes = 0;
    for (const c of candidates) {
      const prior = state[c.email];
      const freshVerdict =
        prior?.verdict && prior?.verifiedAt &&
        Date.now() - new Date(prior.verifiedAt).getTime() < VERDICT_TTL_DAYS * 86_400_000;
      if (freshVerdict) {
        c.verdict = prior.verdict;
        continue;
      }
      if (probes >= MAX_PROBES_PER_COMPANY) break;
      probes++;
      try {
        const v = await verifyEmail(c.email);
        c.verdict = v.verdict;
        console.log(`    verify ${c.email} → ${v.verdict} (${v.reason})`);
      } catch {
        c.verdict = 'unknown';
      }
    }
    // invalid never reaches the page; unknown ships but tagged, valid clean.
    // For the unknowns (catch-all / gateway), one free positive signal:
    // a Gravatar registered to this exact address proves a human owns it.
    const result: Candidate[] = [];
    for (const c of candidates.filter((c) => c.verdict !== 'invalid').slice(0, want)) {
      if (c.verdict === 'unknown' && c.gravatar === undefined) {
        const prior = state[c.email];
        if (prior?.gravatar !== undefined && prior?.verifiedAt) {
          c.gravatar = prior.gravatar;
        } else {
          const g = await gravatarExists(c.email);
          if (g !== null) c.gravatar = g;
        }
      }
      result.push(c);
    }
    return result;
  };

  try {
    let found: Awaited<ReturnType<typeof githubContacts>> | null = null;
    let usedOrg: string | null = null;
    for (const org of orgCandidates.slice(0, 3)) {
      found = await githubContacts(org);
      if (found.domain) {
        usedOrg = org;
        break;
      }
    }
    /**
     * Fallback ladder, COLDMAIL-PLAN.md §1b: npm registry maintainers cover
     * companies whose GitHub org is named nothing like them or who publish
     * packages without a public org at all. Names exist on npm maintainers,
     * so these stay draft-composable; facts don't, so they ship un-facted.
     *
     * Both git misses reach this, not just the empty-handed one. The
     * wrong-company branch below used to `return []` outright, which meant a
     * company whose public repos are dominated by outside contributors got no
     * shot at npm or PyPI at all — Citi, Sprinklr, Logitech, LSEG and Unisys
     * all died there in one real run while their npm packages went unqueried.
     * Nothing is loosened by this: npmContacts/pypiContacts/mavenContacts all
     * apply the same domainMatchesOrg guard themselves, so a wrong-company
     * address still cannot ship.
     *
     * Maven Central is third, not second: it covers corporate Java/Android
     * SDKs specifically, a narrower slice than npm/PyPI's general-purpose
     * registries, so it only runs when both of those came up empty.
     */
    const alternates = async (why: string): Promise<Candidate[]> => {
      const reg = await npmContacts(company, want).catch(() => []);
      const py = reg.length === 0 ? await pypiContacts(company, want).catch(() => []) : [];
      const mvn = reg.length === 0 && py.length === 0 ? await mavenContacts(company, want).catch(() => []) : [];
      // `token` is a real company hostname (not an ATS-hosted subdomain) only
      // for the ATSes that store the full board URL — phenom, icims,
      // zohorecruit, successfactors — so this is the one case where scanning
      // the company's own site for a mailto/plain-text address is worth trying.
      const web =
        reg.length === 0 && py.length === 0 && mvn.length === 0 && known && HOSTNAME_ATS.has(known.ats)
          ? await websiteContacts(known.token, company).catch(() => [])
          : [];
      /**
       * Last rung: a named senior contact off the company's own "about"/
       * "leadership" page, only when every real-address source above found
       * nothing. No observed address exists yet at this point, so there is no
       * inferred pattern to apply — 'first.last' is the single most common
       * corporate convention, used as a stated default guess, not a verified
       * fact. It ships through the exact same SMTP-verify + DMARC + bounce-gate
       * funnel as every other candidate, so an unverifiable guess degrades to
       * an `unknown`-tagged card rather than a false claim.
       */
      const lead =
        reg.length === 0 && py.length === 0 && mvn.length === 0 && web.length === 0 && known && HOSTNAME_ATS.has(known.ats)
          ? await leadershipContacts(known.token).catch(() => [])
          : [];
      const source = reg.length > 0 ? 'npm' : py.length > 0 ? 'pypi' : mvn.length > 0 ? 'maven' : web.length > 0 ? 'website' : 'leadership';
      const alt = [
        ...reg,
        ...py,
        ...mvn,
        ...web.map((w) => ({ name: displayName(w.email.split('@')[0] ?? ''), email: w.email })),
        // COLDMAIL-PLAN.md §4: first.last is 47.7% of B2B addresses and a bare
        // first@ is another 26.8% — emitting only the first guess threw away a
        // quarter of the reachable cases, and missed mononym names entirely
        // (applyPattern('first.last') returns null when there is no surname).
        // Both go through the same SMTP-verify funnel, which is what decides.
        ...lead
          .flatMap((l) =>
            (['first.last', 'first'] as const).map((pattern) => ({
              name: l.name,
              email: applyPattern(pattern, l.name, known!.token),
            })),
          )
          .filter((c): c is { name: string; email: string } => c.email !== null),
      ];
      if (alt.length === 0) {
        console.log(`    · ${company}: ${why}, no npm/PyPI/Maven/website/leadership contacts either`);
        return [];
      }
      console.log(`    · ${company}: ${why}; npm/PyPI/Maven/website/leadership gave ${alt.length} address(es)`);
      return finalize(alt.slice(0, MAX_PROBES_PER_COMPANY).map((r) => ({ name: r.name, email: r.email, source })));
    };

    if (!found || !found.domain || !usedOrg) {
      return await alternates(
        `no GitHub org with corporate-domain commits (tried ${orgCandidates.slice(0, 3).join(', ')})`,
      );
    }
    // Wrong-company guard: the domain must either match the org name or have
    // been accepted as matched by the sweep. Outside contributors fail this.
    if (!(found.domainMatchesOrg || (entry?.matched ?? false))) {
      return await alternates(`GitHub domain ${found.domain} does not match org ${usedOrg} — outside contributors?`);
    }

    const cutoff = Date.now() - FACT_MAX_AGE_DAYS * 86_400_000;
    const factual = found.authors.filter((a) => {
      if (!a.subject || !a.date) return false;
      const t = new Date(a.date).getTime();
      return !Number.isNaN(t) && t >= cutoff;
    });
    const base = factual.length >= want ? factual : found.authors.filter((a) => a.subject);

    // Rank facts, don't just take them: a "fix: race in order matching"
    // beats "docs: replace screenshot" as an opener. Strong facts are
    // preferred; weak ones only backfill when the company is thin.
    const FACT_MIN_SCORE = Number(process.env.OUTREACH_MIN_FACT_SCORE ?? 3);
    const ranked = [...base].sort(
      (a, b) =>
        (b.score ?? 0) - (a.score ?? 0) ||
        new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime(),
    );
    const strong = ranked.filter((c) => (c.score ?? 0) >= FACT_MIN_SCORE);
    const ordered =
      strong.length >= want
        ? strong
        : [...strong, ...ranked.filter((r) => !strong.includes(r))];

    /**
     * SmartRecruiters names a real person on every posting (`creator.name`,
     * live-verified 2026-09-02), but never an address — useless without the
     * domain+pattern git just resolved above, which is exactly what's known
     * at this point. `postedByHint` (this exact job's creator, free — the
     * fetcher already captures it) goes first: "you posted this role" beats
     * any git commit as a fact. The company-wide sweep is a second, weaker
     * pass for when that hint is absent, only spent when the company is
     * actually confirmed to be on SmartRecruiters.
     */
    const srCandidates: Candidate[] = [];
    if (found.pattern) {
      const seen = new Set<string>();
      const addSr = (name: string) => {
        const email = applyPattern(found!.pattern!, name, found!.domain!);
        if (!email || seen.has(email)) return;
        seen.add(email);
        srCandidates.push({ name, email, source: 'smartrecruiters' });
      };
      if (postedByHint) addSr(postedByHint);
      if (known?.ats === 'smartrecruiters' && known.token) {
        const creators = await smartRecruitersCreators(known.token, want).catch(() => []);
        for (const c of creators) addSr(c.name);
      }
    }

    const candidates: Candidate[] = [...srCandidates, ...ordered.map((a) => ({ ...a, source: 'git' }))].slice(
      0,
      MAX_PROBES_PER_COMPANY,
    );

    return await finalize(candidates);
  } catch (error) {
    // Distinguish "no contact" from real trouble — a silent rate-limit death
    // would look exactly like a legitimate miss (the HANDOFF lesson).
    console.log(`    ! ${company}: ${(error as Error).message}`);
    return [];
  }
}

/**
 * Gravatar existence check — a 200 on the avatar for this exact address
 * proves somebody registered it, which is near-proof the mailbox is live.
 * Positive-only: a 404 proves nothing. One plain HTTPS request, no mail
 * server involved, so it is safe where SMTP probing is not.
 */
export async function gravatarExists(addr: string): Promise<boolean | null> {
  const md5 = createHash('md5').update(addr.trim().toLowerCase()).digest('hex');
  try {
    const res = await fetch(`https://gravatar.com/avatar/${md5}?d=404`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    return null;
  } catch {
    return null;
  }
}

// ── linkedin ─────────────────────────────────────────────────────────────────

/**
 * How many connection requests the weekly list offers. LinkedIn's own invite
 * ceiling is around 100 a week and it throttles well before that; 20 is a
 * deliberate fraction of it, because a connection request that follows a real
 * email to a named person is a different act from bulk connecting, and doing
 * twenty of those properly beats doing a hundred badly.
 */
const LINKEDIN_WEEKLY_CAP = Number(process.env.OUTREACH_LINKEDIN_WEEKLY ?? 20);

/**
 * A LinkedIn people-SEARCH url for a name at a company — never a fetch.
 *
 * This project's own research (CONTACT-DISCOVERY.md §9) puts LinkedIn among the
 * most aggressively anti-scraped sites on the web, and calls fetching it a last
 * resort that trades an IP ban for an account ban. None of that applies to a
 * link a human clicks in their own browser, already signed in, which is all
 * this is: the search page, pre-filled. Nothing automated ever loads it.
 */
export function linkedinSearchUrl(name: string, company: string): string {
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${name} ${company}`)}`;
}

export interface ConnectRow {
  addr: string;
  name: string;
  company: string;
  role: string;
  daysSinceSent: number;
  replied: boolean;
  searchUrl: string;
}

/**
 * Who to send a LinkedIn request to this week.
 *
 * Only people already mailed (touch > 0). A connection request landing a few
 * days after a real email about a real req is a second touch on a second
 * channel and reads as persistence; the same request to somebody who has never
 * heard the name is just a cold connect, which is a different play with a
 * different hit rate and does not belong on this list.
 *
 * Anyone who replied sorts to the top — a reply is the best possible reason to
 * connect, and the request will almost certainly be accepted. After that it is
 * oldest-mailed first, so nobody ages out unnoticed. Bounced and skipped
 * contacts never appear, and a contact drops off permanently once the request
 * is marked sent.
 */
export function weeklyConnects(state: OutreachState, now: number): ConnectRow[] {
  return Object.entries(state)
    .filter(([, c]) => c.touch > 0 && !c.skipped && !c.bounced && !c.connectedAt && c.name)
    .map(([addr, c]) => ({
      addr,
      name: c.name!,
      company: c.company,
      role: c.role,
      daysSinceSent: Math.floor((now - new Date(c.sentAt[c.sentAt.length - 1] ?? 0).getTime()) / 86_400_000),
      replied: Boolean(c.replied),
      searchUrl: linkedinSearchUrl(c.name!, c.company),
    }))
    .filter((r) => Number.isFinite(r.daysSinceSent))
    .sort((a, b) => Number(b.replied) - Number(a.replied) || b.daysSinceSent - a.daysSinceSent)
    .slice(0, LINKEDIN_WEEKLY_CAP);
}

// ── drafts ───────────────────────────────────────────────────────────────────

export interface Draft {
  id: string;
  addr: string;
  name: string;
  firstName: string;
  company: string;
  role: string;
  location?: string;
  jobUrl: string;
  lane: 'triggered' | 'random';
  kind: 'first' | 'followup';
  touch: number;
  overdueDays: number;
  subject: string;
  body: string;
  gmailUrl: string;
  mailtoUrl: string;
  verdict?: Verdict;
  gravatar?: boolean;
  /** Prior async bounces recorded at this address's domain — risk memory. */
  domainRiskBounces?: number;
  fact?: string;
  /** Which rung of the ladder found this contact — git/npm/pypi/maven. */
  source?: string;
}

function composeLinks(addr: string, subject: string, body: string) {
  const q = (s: string) => encodeURIComponent(s);
  return {
    gmailUrl: `https://mail.google.com/mail/u/${encodeURIComponent(GMAIL_USER)}/?view=cm&fs=1&to=${q(addr)}&su=${q(subject)}&body=${q(body)}`,
    mailtoUrl: `mailto:${addr}?subject=${q(subject)}&body=${q(body)}`,
  };
}

export function buildFirstDraft(job: CatalogJob, author: Candidate, domainRiskBounces = 0): Draft {
  const company = displayName(job.company);
  // splitName() lowercases every part, because it exists to build email
  // local parts. Greeting a stranger "Hey max," is a machine-generated tell
  // on every single mail — real people capitalise a name. Verified against a
  // real send: a draft to Max Mansfield went out addressed to "max".
  const first = displayName(splitName(author.name)?.first ?? author.name.split(/\s+/)[0]!);
  const greet = pick(GREETINGS, author.email);
  /**
   * Only the git rung carries a commit subject. Every other rung — npm, PyPI,
   * Maven, the website scan, the leadership page — has none, and the old
   * unconditional template rendered the majority of first touches opening with
   * `Saw your recent commit — “undefined”.`: a broken mail-merge claiming a
   * commit the recipient never made, sent to a CEO or a package maintainer.
   * renderBody drops the paragraph cleanly when there is no fact.
   *
   * OUTREACH-DESIGN.md §4's stricter rule is "no fact, no mail" — skip the
   * candidate outright. That is a targeting change, not a rendering one; this
   * is the rendering half.
   */
  const fact =
    author.source === 'smartrecruiters'
      ? `${pick(SR_FACT_VERBS, author.name)} this req on SmartRecruiters — figured you'd know if it's still open.`
      : author.subject
        ? (factLine(author.subject, company, author.name) ?? undefined)
        : undefined;
  const title = job.title.trim();
  // "a Associate ML Engineer" is the tell that a machine wrote the mail, which
  // retroactively reframes the commit quote from flattering to creepy.
  const article = /^[aeiou]/i.test(title) ? 'an' : 'a';
  // Locations arrive already-phrased ("Remote - India", "Bengaluru, KA"), so
  // they read as an apposition rather than as "in Remote - India".
  const loc = job.location ? ` — ${job.location}` : '';
  const exp = experienceLabel(job.minYears ?? null, job.maxYears ?? null);
  // A req that opens at or below 3 years already answers the band question.
  const bandCoversEarlyCareer = job.minYears != null && job.minYears <= 3;
  const ask = pick(bandCoversEarlyCareer ? ASK_MATCHED : ASK_T1, author.email + job.id);
  const roleLine = `${company} just opened ${article} ${title}${loc}.${exp ? ` Band listed: ${exp}.` : ''}`;
  const body = renderBody({ greet, first, fact, roleLine, ask, passAlong: pick(PASS_ALONG, author.name) });
  const subject = pick(
    [`quick question re: ${job.title.toLowerCase().slice(0, 40)}`, `${company} ${job.title.toLowerCase().slice(0, 30)} — open?`],
    author.email,
  );
  return {
    id: author.email,
    addr: author.email,
    name: author.name,
    firstName: first,
    company,
    role: job.title,
    location: job.location,
    jobUrl: job.url,
    lane: isTriggered(job) ? 'triggered' : 'random',
    kind: 'first',
    touch: 0,
    overdueDays: 0,
    subject,
    body,
    ...composeLinks(author.email, subject, body),
    verdict: author.verdict,
    gravatar: author.gravatar,
    domainRiskBounces,
    fact: author.source === 'smartrecruiters' ? 'posted this exact role' : author.subject,
    source: author.source,
  };
}

/**
 * The line a follow-up leads with, and the whole reason a follow-up is worth
 * sending at all.
 *
 * OUTREACH-DESIGN.md §4 requires that every touch carry new information and
 * explicitly forbids "bumping this" — but the code shipped
 * "Following up on X at Y — wrote N days ago", which is exactly the mail it
 * forbids, and it was identical across every contact, so the similarity guard
 * then deleted most of them before they were ever seen.
 *
 * The new information is already sitting in the catalogue, free, no fetch:
 * whether that specific req is still open, whether it came down, and whether
 * the company has opened something else since. Those are three genuinely
 * different mails, and the third one is a better mail than the first because
 * "you have opened something closer to my band" restarts the conversation
 * instead of repeating it.
 *
 * Matching is by job URL, which is stable per requisition; a company that has
 * left the catalogue entirely falls through to the honest minimum, which still
 * names the role and the gap rather than saying nothing.
 */
export function followUpLine(
  contact: Pick<ContactState, 'company' | 'role' | 'jobUrl'>,
  catalog: CatalogJob[],
  daysSinceFirst: number,
): string {
  const mine = catalog.filter((j) => j.company.toLowerCase() === contact.company.toLowerCase());
  const original = mine.find((j) => j.url === contact.jobUrl);
  if (original?.closedAt) {
    return `That ${contact.role} req at ${contact.company} came down since I wrote — anything similar opening on your side?`;
  }
  const newer = mine
    .filter((j) => !j.closedAt && j.url !== contact.jobUrl)
    .sort((a, b) => (postedAgeDays(a.postedAt) ?? 999) - (postedAgeDays(b.postedAt) ?? 999))[0];
  if (newer) {
    return `${contact.company} has opened a ${newer.title.trim()} since I wrote about the ${contact.role} — that one may be the closer fit.`;
  }
  if (original) {
    return `That ${contact.role} req at ${contact.company} is still up, ${daysSinceFirst} days on — so I take it the search is still live.`;
  }
  return `Wrote ${daysSinceFirst} days ago about the ${contact.role} at ${contact.company}.`;
}

function buildFollowUps(state: OutreachState, catalog: CatalogJob[]): Draft[] {
  const now = Date.now();
  const drafts: Draft[] = [];
  for (const [addr, c] of Object.entries(state)) {
    if (c.skipped || c.replied || c.bounced) continue;
    if (c.touch <= 0 || c.touch >= TOUCH_GAPS.length) continue;
    const due = new Date(c.nextDueAt).getTime();
    if (Number.isNaN(due) || due > now) continue;
    const overdueDays = Math.floor((now - due) / 86_400_000);
    const daysSinceFirst = Math.round((now - new Date(c.sentAt[0]!).getTime()) / 86_400_000);
    const askPool = c.touch === 1 ? ASK_T2 : ASK_T3;
    const body = renderBody({
      greet: 'Hi',
      first: c.firstName ?? 'there',
      roleLine: followUpLine(c, catalog, daysSinceFirst),
      ask: pick(askPool, addr),
      passAlong: PASS_ALONG[c.touch % PASS_ALONG.length]!,
    });
    // Not `re: <original>`. The Gmail compose link cannot thread onto the
    // earlier message, so a "re:" prefix is a thread that does not exist — a
    // recognised content signal, and a small deception the moment the reader
    // checks. An honest subject that names the same req does the same job.
    const subject = `${c.role.toLowerCase().slice(0, 40)} at ${c.company} — still open?`;
    drafts.push({
      id: addr,
      addr,
      name: addr,
      firstName: c.firstName ?? 'there',
      company: c.company,
      role: c.role,
      jobUrl: c.jobUrl,
      lane: 'triggered',
      kind: 'followup',
      touch: c.touch,
      overdueDays,
      subject,
      body,
      ...composeLinks(addr, subject, body),
      verdict: c.verdict,
      source: c.source,
    });
  }
  return drafts.sort((a, b) => b.overdueDays - a.overdueDays);
}

export function enforceSimilarity<T extends { body: string }>(drafts: T[]): { kept: T[]; dropped: T[] } {
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const d of drafts) {
    const twin = kept.find((k) => bodySimilarity(k.body, d.body) > 0.8);
    (twin ? dropped : kept).push(d);
  }
  return { kept, dropped };
}

/**
 * Risk memory per mail domain: how many recorded bounces each domain has
 * produced. A catch-all gateway that ate one address probably ate others —
 * future ⚠ cards at that domain carry the warning forward.
 */
export function domainRiskTally(state: OutreachState): Map<string, number> {
  const tally = new Map<string, number>();
  for (const [addr, c] of Object.entries(state)) {
    if (!c.bounced || !c.sentAt?.length) continue;
    const domain = addr.split('@')[1]?.toLowerCase();
    if (!domain) continue;
    tally.set(domain, (tally.get(domain) ?? 0) + 1);
  }
  return tally;
}

// ── batch ────────────────────────────────────────────────────────────────────

export interface Batch {
  followups: Draft[];
  /** Companies whose role opened inside TRIGGER_WINDOW_DAYS. */
  triggered: Draft[];
  /** Contacts found on a company's leadership page — a named senior person,
   *  with a guessed address. Their own section rather than mixed in, because
   *  they are a different kind of mail to a different kind of recipient. */
  leadership: Draft[];
  random: Draft[];
  /** Set when the bounce gate stopped this build — rendered on the page. */
  haltReason?: string;
}

/** Every card in a batch, in the order the page shows them. */
export function allDrafts(b: Batch): Draft[] {
  return [...b.followups, ...b.triggered, ...b.leadership, ...b.random];
}

/**
 * Which section a draft belongs in. Leadership wins over lane: the lane says
 * how fresh the role is, the source says what kind of human is on the other
 * end, and the second matters more for how the mail reads.
 */
export function section(d: Draft): 'followups' | 'leadership' | 'triggered' | 'random' {
  if (d.kind === 'followup') return 'followups';
  if (d.source === 'leadership') return 'leadership';
  return d.lane === 'triggered' ? 'triggered' : 'random';
}

/**
 * A draft that has survived at least one build.
 *
 * Drafts used to be regenerated from scratch every run and thrown away, so a
 * card seen in the morning was simply gone by lunchtime and there was no way
 * to go back to one. Since the daily send cap is deliberately far below the
 * number of candidates a build can produce, most drafts were being discarded
 * unsent and unseen — the pool is what turns them into a standing set of
 * options instead.
 */
export interface PooledDraft extends Draft {
  /** When this address first entered the pool, not when it was last rebuilt. */
  firstDraftedAt: string;
}

/**
 * How many drafts to keep. Generous on purpose: the point of the pool is to
 * have more options than a day's sending could ever use, and a draft costs a
 * few hundred bytes.
 */
const POOL_MAX = Number(process.env.OUTREACH_POOL_MAX ?? 600);

/**
 * Fold a build's fresh drafts into the standing pool.
 *
 *   - A contact that has been actually mailed, skipped, bounced or replied is
 *     resolved and leaves the pool. That is the same touch > 0 rule the
 *     company dedup uses, for the same reason: rendering a card is not sending.
 *   - An address already pooled keeps its original firstDraftedAt but takes the
 *     fresh body, so an option that has been sitting there for a week still
 *     names a role that is currently open rather than a stale one.
 *   - Everything else survives. Eviction is oldest-first and only past the cap.
 */
export function mergePool(
  pool: PooledDraft[],
  fresh: Draft[],
  state: OutreachState,
  nowIso: string,
): PooledDraft[] {
  const resolved = (addr: string): boolean => {
    const c = state[addr];
    return Boolean(c && (c.touch > 0 || c.skipped || c.bounced || c.replied));
  };
  const byAddr = new Map<string, PooledDraft>();
  for (const d of pool) {
    if (resolved(d.addr)) continue;
    byAddr.set(d.addr, d);
  }
  for (const d of fresh) {
    if (resolved(d.addr)) continue;
    const prev = byAddr.get(d.addr);
    byAddr.set(d.addr, { ...d, firstDraftedAt: prev?.firstDraftedAt ?? nowIso });
  }
  return [...byAddr.values()]
    .sort((a, b) => new Date(b.firstDraftedAt).getTime() - new Date(a.firstDraftedAt).getTime())
    .slice(0, POOL_MAX);
}

/** Split a pool back into the page's sections, newest option first. */
export function poolToBatch(pool: PooledDraft[], haltReason?: string): Batch {
  const b: Batch = { followups: [], triggered: [], leadership: [], random: [], haltReason };
  for (const d of pool) b[section(d)].push(d);
  // Follow-ups are due-today work, not options to browse: most overdue first.
  b.followups.sort((a, x) => x.overdueDays - a.overdueDays);
  return b;
}

// ── bounce gate ──────────────────────────────────────────────────────────────

const BOUNCE_WINDOW_DAYS = Number(process.env.OUTREACH_BOUNCE_WINDOW_DAYS ?? 30);
const BOUNCE_MIN_SAMPLE = Number(process.env.OUTREACH_BOUNCE_MIN_SAMPLE ?? 15);
const BOUNCE_INCIDENT_RATE = 0.02;
/** Lifetime ratio that halts no matter how old the bounces are. */
const BOUNCE_BACKSTOP_RATE = 0.05;
const BOUNCE_BACKSTOP_MIN_SENDS = 50;

export interface GateInput {
  sentAt: string[];
  bounced?: boolean;
  bouncedAt?: string;
}

export interface GateDecision {
  halt: boolean;
  reason: string;
}

/**
 * Two gates replace a lifetime average, which froze on one bad week and went
 * blind under months of dilution:
 *
 *   incident — bounces vs sends inside a rolling WINDOW_DAYS window; this is
 *              the signal that catches "something broke recently" fast.
 *   backstop — lifetime ratio above BACKSTOP_RATE halts regardless of age;
 *              catches slow rot that never produces a sharp spike.
 *
 * A sparse window (paused outreach) stays silent until MIN_SAMPLE rebuilds,
 * because judging 3 sends tells you nothing.
 */
export function bounceGateDecision(contacts: GateInput[], now: number): GateDecision {
  const cutoff = now - BOUNCE_WINDOW_DAYS * 86_400_000;
  let windowSends = 0;
  let windowBounces = 0;
  let lifeSends = 0;
  let lifeBounces = 0;
  for (const c of contacts) {
    for (const s of c.sentAt ?? []) {
      lifeSends++;
      if (new Date(s).getTime() >= cutoff) windowSends++;
    }
    if (!c.bounced) continue;
    lifeBounces++;
    if (c.bouncedAt && new Date(c.bouncedAt).getTime() >= cutoff) windowBounces++;
  }

  const pct = (n: number, d: number) => (d === 0 ? '—' : `${((100 * n) / d).toFixed(1)}%`);

  if (
    windowSends >= BOUNCE_MIN_SAMPLE &&
    windowBounces / Math.max(windowSends, 1) > BOUNCE_INCIDENT_RATE
  ) {
    return {
      halt: true,
      reason: `HALTED: ${windowBounces}/${windowSends} sends in the last ${BOUNCE_WINDOW_DAYS}d bounced (${pct(windowBounces, windowSends)} > ${BOUNCE_INCIDENT_RATE * 100}%). Fix targeting before resuming.`,
    };
  }
  if (
    lifeSends >= BOUNCE_BACKSTOP_MIN_SENDS &&
    lifeBounces / Math.max(lifeSends, 1) > BOUNCE_BACKSTOP_RATE
  ) {
    return {
      halt: true,
      reason: `HALTED: lifetime bounces ${lifeBounces}/${lifeSends} (${pct(lifeBounces, lifeSends)} > ${BOUNCE_BACKSTOP_RATE * 100}%). List quality is rotting.`,
    };
  }
  return { halt: false, reason: `ok (${pct(windowBounces, windowSends)} window · ${pct(lifeBounces, lifeSends)} lifetime)` };
}

/**
 * Returns the halting decision rather than a bare boolean so the reason can
 * reach the review page. A halted build renders as an empty batch, which is
 * indistinguishable from "nothing to send today" unless the page says why —
 * and the one moment this fires is the moment the user most needs to know.
 */
async function bounceGate(): Promise<GateDecision> {
  const state = await readJson<OutreachState>(STATE_PATH, {});
  const decision = bounceGateDecision(Object.values(state), Date.now());
  if (!decision.halt) return decision;
  if (process.env.OUTREACH_IGNORE_BOUNCE === '1') {
    console.warn(`${decision.reason} — BYPASSED via OUTREACH_IGNORE_BOUNCE`);
    return { halt: false, reason: decision.reason };
  }
  console.warn(decision.reason);
  return decision;
}

async function buildBatch(): Promise<Batch> {
  const gate = await bounceGate();
  if (gate.halt) return { followups: [], triggered: [], leadership: [], random: [], haltReason: gate.reason };
  const state = await readJson<OutreachState>(STATE_PATH, {});
  let budget = DAILY_BUDGET;

  // Read once, up here: follow-ups need it to say anything new, and the
  // first-touch selection below needs the same array.
  const catalog = await readJson<CatalogJob[]>(CATALOG_PATH, []);
  const followups = buildFollowUps(state, catalog).slice(0, budget);
  budget -= followups.length;
  const riskTally = domainRiskTally(state);

  const random: Draft[] = [];
  const triggered: Draft[] = [];
  // Triggered lane builds every day — its value is time-since-posted and the
  // human chooses when to click. Only the random lane respects weekends.
  const weekend = [0, 6].includes(new Date().getDay()) && process.env.OUTREACH_WEEKEND !== '1';
  if (budget > 0 && process.env.OUTREACH_NO_NEW !== '1') {
    const pool = loadCompanyPool(catalog, state);

    // Select targets first (cheap, deterministic), then resolve contacts for
    // all of them in parallel — serial SMTP probing made full-day builds take
    // tens of minutes when gateways tarpitted.
    const selected: CompanyTarget[] = [];
    const usedCompanies = new Set<string>();
    for (const lane of ['triggered', 'random'] as const) {
      if (weekend && lane === 'random') continue;
      const cap = Math.min(lane === 'triggered' ? TRIGGERED_BUDGET : RANDOM_BUDGET, budget);
      let picked = 0;
      for (const target of pool) {
        if (picked >= cap) break;
        if (target.lane !== lane || usedCompanies.has(target.company.toLowerCase())) continue;
        usedCompanies.add(target.company.toLowerCase());
        selected.push(target);
        picked++;
      }
    }

    const concurrency = Number(process.env.OUTREACH_RESOLVE_CONCURRENCY ?? 6);
    const resolved = await mapLimit(selected, concurrency, async (target) => ({
      target,
      recipients: await resolveRecipients(target.company, target.job.id.split(':')[1] ?? '', 2, state, target.job.postedBy),
    }));

    for (const { target, recipients } of resolved) {
      if (budget <= 0) break;
      if (recipients.length === 0) {
        console.log(`  · ${target.company}: no usable contact, skipped`);
        continue;
      }
      const laneArr = target.lane === 'triggered' ? triggered : random;
      const cap = Math.min(target.lane === 'triggered' ? TRIGGERED_BUDGET : RANDOM_BUDGET, DAILY_BUDGET);
      for (const author of recipients) {
        if (budget <= 0 || laneArr.length >= cap) break;
        // Same rule as loadCompanyPool: a drafted address is not a spent
        // one. Only a real send or an explicit skip retires it.
        const priorContact = state[author.email];
        if (priorContact && (priorContact.touch > 0 || priorContact.skipped)) continue;
        const domain = author.email.split('@')[1]?.toLowerCase() ?? '';
        const priorBounces = riskTally.get(domain) ?? 0;
        if (priorBounces >= DOMAIN_RISK_MAX_BOUNCES) {
          console.log(`  · ${target.company}: skipping ${author.email} — ${priorBounces} prior bounces at ${domain}, pattern looks wrong`);
          continue;
        }
        laneArr.push(buildFirstDraft(target.job, author, priorBounces));
        budget--;
      }
    }
  }

  const all = [...followups, ...random, ...triggered];
  const { kept, dropped } = enforceSimilarity(all);
  // Silently deleting drafts hides the case that matters most: follow-ups are
  // where COLDMAIL-PLAN.md §2 puts 42% of replies, and they are the drafts most
  // likely to collide with each other because their bodies vary least.
  if (dropped.length > 0) {
    const fu = dropped.filter((d) => d.kind === 'followup').length;
    console.log(`similarity guard dropped ${dropped.length} near-twin draft(s) (${fu} follow-up(s))`);
  }
  const keepIds = new Set(kept.map((d) => d.id));

  /**
   * Fold this build's survivors into the standing pool and persist it before
   * returning. The pool is what makes the page a set of options rather than a
   * snapshot: the send cap is deliberately far below what a build can produce,
   * so without this most drafts were generated, never shown long enough to be
   * chosen, and thrown away on the next rebuild.
   */
  const nowIso = new Date().toISOString();
  const priorPool = await readJson<PooledDraft[]>(DRAFTS_PATH, []);
  const pool = mergePool(priorPool, [...followups, ...random, ...triggered].filter((d) => keepIds.has(d.id)), state, nowIso);
  await mkdir('state', { recursive: true });
  await writeFile(DRAFTS_PATH, `${JSON.stringify(pool, null, 2)}\n`, 'utf8');
  const carried = pool.length - pool.filter((d) => d.firstDraftedAt === nowIso).length;
  console.log(`pool: ${pool.length} options (${carried} carried over from earlier builds)`);

  return poolToBatch(pool, gate.halt ? gate.reason : undefined);
}

// ── server ───────────────────────────────────────────────────────────────────

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function card(d: Draft & { firstDraftedAt?: string }): string {
  // How long this option has been sitting in the pool. Worth showing because
  // the pool now outlives a build: without it there is no way to tell a card
  // drafted an hour ago from one that has been waiting a fortnight.
  const pooledDays =
    d.firstDraftedAt && !Number.isNaN(new Date(d.firstDraftedAt).getTime())
      ? Math.floor((Date.now() - new Date(d.firstDraftedAt).getTime()) / 86_400_000)
      : null;
  const badges = [
    d.verdict === 'valid' ? '<span class="ok">verified</span>' : '',
    d.verdict === 'unknown'
      ? `<span class="warn">unverified${d.gravatar ? ' · gravatar✓' : ''}</span>`
      : '',
    d.domainRiskBounces
      ? `<span class="late">⚠ ${d.domainRiskBounces} prior bounce${d.domainRiskBounces > 1 ? 's' : ''} at this domain</span>`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `<div class="card" id="c-${esc(d.id)}">
  <div class="head"><b>${esc(d.company)}</b> · ${esc(d.role)} · touch ${d.touch + 1}
    ${pooledDays !== null && pooledDays > 0 ? `<span class="aged">in the pool ${pooledDays}d</span>` : ''}
    ${d.kind === 'followup' && d.overdueDays > 0 ? `<span class="late">${d.overdueDays}d overdue</span>` : ''}
    ${d.source === 'leadership' ? '<span class="warn">guessed address — see CONTACT-DISCOVERY.md §4b</span>' : ''}
    ${badges}
  </div>
  <div class="to">to: ${esc(d.addr)}</div>
  <pre>${esc(d.body)}</pre>
  <div class="btns">
    <a class="btn primary" href="${actionUrl(`outreach/open/${encodeURIComponent(d.id)}`)}">Open in Gmail</a>
    <a class="btn" href="${actionUrl(`outreach/mailapp/${encodeURIComponent(d.id)}`)}">Mail app</a>
    <a class="btn ghost" href="${actionUrl(`outreach/sent/${encodeURIComponent(d.id)}`)}">Sent by hand</a>
    <a class="btn ghost" href="${actionUrl(`outreach/replied/${encodeURIComponent(d.id)}`)}">Replied</a>
    <a class="btn ghost" href="${actionUrl(`outreach/bounce/${encodeURIComponent(d.id)}`)}">Bounced</a>
    <a class="btn ghost" href="${actionUrl(`outreach/skip/${encodeURIComponent(d.id)}`)}">Skip</a>
  </div>
</div>`;
}

/** Addresses mailed recently whose delayed NDR may still arrive days later. */
export function recentlySent(
  state: OutreachState,
): { addr: string; company: string; role: string; daysAgo: number }[] {
  const cutoff = Date.now() - 21 * 86_400_000;
  return Object.entries(state)
    .filter(([addr, c]) => c.touch >= 1 && !c.bounced && !c.replied && addr.includes('@'))
    .map(([addr, c]) => ({
      addr,
      company: c.company,
      role: c.role,
      daysAgo: Math.floor((Date.now() - new Date(c.sentAt[c.sentAt.length - 1] ?? c.nextDueAt).getTime()) / 86_400_000),
    }))
    .filter((r) => Number.isFinite(r.daysAgo) && r.daysAgo >= 0 && Date.now() - r.daysAgo * 86_400_000 >= cutoff)
    .sort((a, b) => a.daysAgo - b.daysAgo)
    // Not 12. Touch gaps are [0,4,9,16] days and COLDMAIL-PLAN.md §2 puts most
    // positive replies on the third-to-fifth touch, so a reply routinely lands
    // days after its send — with a 12-row cap those rows are all from today and
    // the person who replied on day 5 has nothing to click. The 21-day cutoff
    // above already bounds this; at a 20/day ramp it is a few hundred rows of
    // plain table.
    .slice(0, 200);
}

function recentRows(recent: ReturnType<typeof recentlySent>): string {
  if (recent.length === 0) return '<div class="count">nothing in flight</div>';
  return `<table width="100%">${recent
    .map(
      (r) => `<tr><td>${esc(r.addr)}</td><td>${esc(r.company)}</td><td>${r.daysAgo}d ago</td>
    <td><a href="${actionUrl(`outreach/bounce/${encodeURIComponent(r.addr)}`)}">mark bounced</a> · <a href="${actionUrl(`outreach/replied/${encodeURIComponent(r.addr)}`)}">replied</a></td></tr>`,
    )
    .join('')}</table>`;
}

function connectRows(rows: ConnectRow[]): string {
  if (rows.length === 0) return '<div class="count">nobody to connect with yet — this list fills up as you send mail</div>';
  return `<table width="100%">${rows
    .map(
      (r) => `<tr>
      <td>${esc(r.name)}${r.replied ? ' <span class="ok">replied</span>' : ''}</td>
      <td>${esc(r.company)}</td>
      <td style="color:#888">${r.daysSinceSent}d ago</td>
      <td><a class="btn" href="${esc(r.searchUrl)}" target="_blank" rel="noreferrer noopener">Find on LinkedIn</a></td>
      <td><a href="${actionUrl(`outreach/connected/${encodeURIComponent(r.addr)}`)}">mark sent</a></td>
    </tr>`,
    )
    .join('')}</table>`;
}

function page(
  b: Batch,
  recent: ReturnType<typeof recentlySent>,
  sentToday = 0,
  connects: ConnectRow[] = [],
): string {
  const total = allDrafts(b).length;
  const atCap = sentToday >= SEND_CAP;
  return `<!doctype html><html><head><meta charset="utf-8"><title>outreach — ${daySeed()}</title><style>
body{font-family:ui-monospace,monospace;background:#111;color:#ddd;max-width:780px;margin:24px auto;padding:0 12px}
h1{font-size:18px}.count{color:#666;font-size:12px;margin-bottom:4px}
h2{font-size:13px;color:#9ab;margin-top:30px;text-transform:uppercase;letter-spacing:.08em}
h2 .sub{text-transform:none;letter-spacing:0;color:#666;font-size:11px;margin-left:8px}
.card{border:1px solid #333;border-radius:8px;padding:12px;margin-bottom:14px;background:#181818}
.head{color:#fff;margin-bottom:4px}.to{color:#888;font-size:12px;margin-bottom:8px}
pre{white-space:pre-wrap;font-size:13px;line-height:1.45;color:#ccc;border-left:3px solid #2a4a2a;padding-left:10px}
.halt{border:1px solid #a33;background:#2a1414;color:#f99;padding:10px 12px;border-radius:8px;margin:10px 0}
.capped{border:1px solid #a80;background:#2a2210;color:#e0b050;padding:10px 12px;border-radius:8px;margin:10px 0}
.late{color:#f66}.ok{color:#7dcf95;font-size:11px;margin-left:6px}.warn{color:#e0b050;font-size:11px;margin-left:6px}
.aged{color:#7a8ba0;font-size:11px;margin-left:6px}
.btns{margin-top:10px;display:flex;gap:8px;flex-wrap:wrap}
.btn{padding:5px 12px;border-radius:6px;background:#26364a;color:#cfe3ff;text-decoration:none;font-size:13px}
.primary{background:#1a4a2e;color:#bfe8c8}.ghost{background:#222;color:#777}
a.refresh{color:#569;font-size:12px}
</style></head>
<body>
<h1>outreach — ${daySeed()}</h1>
${b.haltReason ? `<div class="halt">${esc(b.haltReason)}</div>` : ''}
${atCap ? `<div class="capped">${sentToday}/${SEND_CAP} sent in the last 24h — at cap. The options below keep for tomorrow; nothing is lost by stopping here.</div>` : ''}
<div class="count">${sentToday}/${SEND_CAP} sent in the last 24h · sending as Gmail account <b>${esc(GMAIL_USER)}</b> · <a class="refresh" href="/refresh">↻ rebuild</a></div>
<div class="count"><b>${total}</b> options standing. These persist across rebuilds — a card you do not send today is still here tomorrow.</div>

<h2>follow-ups due<span class="sub">${b.followups.length} — time-sensitive, do these first</span></h2>
${b.followups.length ? b.followups.map(card).join('') : `<div class="count">nothing due</div>`}

<h2>companies with a role just opened<span class="sub">${b.triggered.length} — posted inside ${TRIGGER_WINDOW_DAYS} days</span></h2>
${b.triggered.length ? b.triggered.map(card).join('') : `<div class="count">none right now</div>`}

<h2>leadership<span class="sub">${b.leadership.length} — named senior contact, address is a guess</span></h2>
${b.leadership.length ? b.leadership.map(card).join('') : `<div class="count">none right now</div>`}

<h2>random<span class="sub">${b.random.length} — open roles, rotating daily</span></h2>
${b.random.length ? b.random.map(card).join('') : `<div class="count">none right now</div>`}

<h2>connect on LinkedIn this week<span class="sub">${connects.length}</span></h2>
<div class="count">People you have already mailed, replies first then oldest. The button opens
a LinkedIn <em>search</em> for that name and company — nothing here fetches LinkedIn, you
click through and send the request yourself. Mark it sent and they drop off the list.</div>
<div class="count">${connectRows(connects)}</div>

<h2>in flight<span class="sub">delayed bounces land here — mark when the NDR arrives</span></h2>
<div class="count">${recentRows(recent)}</div>
</body></html>`;
}

/**
 * buildBatch() computed a fresh SMTP verdict (and gravatar check, for
 * catch-all/unknown addresses) per candidate, but only held it on the
 * in-memory Draft — nothing persisted it. Every static/mbox build was
 * therefore re-probing every address from scratch, silently defeating the
 * 14-day verdict cache this same file documents elsewhere. Fold the results
 * back into state before writing anything out, merging rather than
 * overwriting so an address that already has send history keeps it.
 */
async function syncVerdicts(batch: Batch): Promise<OutreachState> {
  const freshState = await readJson<OutreachState>(STATE_PATH, {});
  const now = new Date().toISOString();
  for (const d of allDrafts(batch)) {
    const prev = freshState[d.addr];
    freshState[d.addr] = {
      company: prev?.company ?? d.company,
      role: prev?.role ?? d.role,
      location: prev?.location ?? d.location,
      jobUrl: prev?.jobUrl ?? d.jobUrl,
      firstName: prev?.firstName ?? d.firstName,
      name: prev?.name ?? d.name,
      connectedAt: prev?.connectedAt,
      touch: prev?.touch ?? 0,
      sentAt: prev?.sentAt ?? [],
      nextDueAt: prev?.nextDueAt ?? now,
      fact: prev?.fact ?? d.fact,
      subject: prev?.subject ?? d.subject,
      verdict: d.verdict,
      gravatar: d.gravatar ?? prev?.gravatar,
      verifiedAt: now,
      replied: prev?.replied,
      skipped: prev?.skipped,
      bounced: prev?.bounced,
      bouncedAt: prev?.bouncedAt,
      source: prev?.source ?? d.source,
    };
  }
  await saveState(freshState);
  return freshState;
}

/**
 * `git send-email`-ready plan: one plain message file per candidate (a
 * Subject line, a blank line, the body — the same cover-letter shape
 * `git format-patch` produces) plus a manifest pairing each file with its
 * recipient. Nothing here calls SMTP; `npm run outreach:send` is the
 * separate, explicit step that shells out to `git send-email` per file,
 * after a human has reviewed the directory.
 */
async function writeMbox(batch: Batch): Promise<void> {
  const dir = `out/outbox/${daySeed()}`;
  await mkdir(dir, { recursive: true });
  const drafts = allDrafts(batch);
  const manifest = drafts.map((d) => ({ addr: d.addr, file: `${d.addr}.txt`, company: d.company, role: d.role, source: d.source }));
  await Promise.all(
    drafts.map((d) => writeFile(`${dir}/${d.addr}.txt`, `Subject: ${d.subject}\n\n${d.body}\n`, 'utf8')),
  );
  await writeFile(`${dir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`${drafts.length} message file(s) written → ${dir}`);
  console.log(`review them, then: npm run outreach:send -- ${dir}`);
}

async function markSent(state: OutreachState, d: Draft): Promise<void> {
  const now = new Date().toISOString();
  const prev = state[d.addr];
  state[d.addr] = {
    company: d.company,
    role: d.role,
    location: d.location,
    jobUrl: d.jobUrl,
    firstName: d.firstName,
    name: prev?.name ?? d.name,
    connectedAt: prev?.connectedAt,
    touch: (prev?.touch ?? 0) + 1,
    sentAt: [...(prev?.sentAt ?? []), now],
    nextDueAt: nextDueAt(now, (prev?.touch ?? 0) + 1),
    fact: prev?.fact ?? d.fact,
    subject: d.subject,
    verdict: prev?.verdict ?? d.verdict,
    verifiedAt: prev?.verifiedAt ?? new Date().toISOString(),
    gravatar: prev?.gravatar ?? d.gravatar,
    replied: prev?.replied,
    skipped: prev?.skipped,
    bounced: prev?.bounced,
    source: prev?.source ?? d.source,
  };
  await saveState(state);
}

/**
 * Record a send the tool did not perform: a mail composed by hand in Gmail, a
 * reply typed straight into a thread, anything sent outside the review page.
 *
 * Without this the state file only ever learns about clicks, so a hand-sent
 * mail leaves the contact at touch 0 — they stay in the pool, get re-drafted,
 * and eventually get the same opening line twice. It also silently
 * under-counts the rolling 24h send window that the cap depends on, which is
 * the failure that lets a genuinely enthusiastic day cross the behavioural
 * line while every counter still reads zero.
 *
 * Designed as `--sent-manual <addr>` in OUTREACH-DESIGN.md §5 and never built
 * until now. Works whether or not the address was ever drafted: an unknown
 * address gets a minimal record so its follow-ups still schedule.
 */
export async function markSentManual(state: OutreachState, addr: string): Promise<ContactState> {
  const now = new Date().toISOString();
  const prev = state[addr];
  const touch = (prev?.touch ?? 0) + 1;
  const entry: ContactState = {
    company: prev?.company ?? '(recorded by hand)',
    role: prev?.role ?? '',
    location: prev?.location,
    jobUrl: prev?.jobUrl ?? '',
    firstName: prev?.firstName,
    name: prev?.name,
    connectedAt: prev?.connectedAt,
    touch,
    sentAt: [...(prev?.sentAt ?? []), now],
    nextDueAt: nextDueAt(now, touch),
    fact: prev?.fact,
    subject: prev?.subject ?? '',
    verdict: prev?.verdict,
    verifiedAt: prev?.verifiedAt,
    gravatar: prev?.gravatar,
    replied: prev?.replied,
    skipped: prev?.skipped,
    bounced: prev?.bounced,
    bouncedAt: prev?.bouncedAt,
    source: prev?.source,
  };
  state[addr] = entry;
  await saveState(state);
  return entry;
}

async function flag(
  state: OutreachState,
  id: string,
  flagName: 'replied' | 'skipped' | 'bounced',
): Promise<void> {
  const cur = state[id];
  if (!cur) return;
  cur[flagName] = true;
  if (flagName === 'bounced') {
    cur.skipped = true; // a bounce suppresses forever
    cur.bouncedAt = new Date().toISOString();
  }
  await saveState(state);
}

async function serve(initial: Batch): Promise<void> {
  // Batch lives in memory; clicks mutate/remove cards; reload never refetches
  // GitHub. Only /refresh pays for a rebuild.
  let batch = initial;
  const byId = new Map<string, Draft>();
  const index = (b: Batch) => {
    byId.clear();
    allDrafts(b).forEach((d) => byId.set(d.id, d));
  };
  index(batch);

  const take = (id: string): Draft | undefined => {
    const d = byId.get(id);
    if (d) {
      byId.delete(id);
      batch.followups = batch.followups.filter((x) => x.id !== id);
      batch.triggered = batch.triggered.filter((x) => x.id !== id);
      batch.leadership = batch.leadership.filter((x) => x.id !== id);
      batch.random = batch.random.filter((x) => x.id !== id);
    }
    return d;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const seg = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const [action, rawId] = seg;
    try {
      const st = await readJson<OutreachState>(STATE_PATH, {});
      if ((action === 'open' || action === 'mailapp') && rawId) {
        // Counted on a rolling 24h window across the whole state file, the way
        // providers count — not per process, not per local midnight.
        const already = sentInLast24h(st);
        if (already >= SEND_CAP) {
          res.writeHead(429, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(`${already}/${SEND_CAP} already sent in the last 24h. Wait for the window to roll, or raise OUTREACH_AUTO_CAP deliberately.`);
          return;
        }
        const d = take(rawId);
        if (d) {
          await markSent(st, d);
          res.writeHead(302, { location: action === 'open' ? d.gmailUrl : d.mailtoUrl });
          res.end();
          return;
        }
      } else if (action === 'connected' && rawId) {
        // Records that the LinkedIn request was sent, so the weekly list stops
        // offering them. Nothing here talks to LinkedIn — the human clicked
        // through the search link and sent it themselves.
        const cur = st[rawId];
        if (cur) {
          cur.connectedAt = new Date().toISOString();
          await saveState(st);
        }
        res.writeHead(302, { location: '/' });
        res.end();
        return;
      } else if (action === 'sent' && rawId) {
        // Same bookkeeping as clicking Gmail, minus the redirect — for a mail
        // that was written and sent by hand rather than from this page.
        take(rawId);
        await markSentManual(st, rawId);
        res.writeHead(302, { location: '/' });
        res.end();
        return;
      } else if (action === 'replied' || action === 'skip' || action === 'bounce') {
        // Works for in-flight addresses even after their card left the page —
        // delayed NDRs arrive days later; the state file outlives the batch.
        take(rawId ?? '');
        await flag(st, rawId!, action === 'bounce' ? 'bounced' : (action as 'replied' | 'skipped'));
        res.writeHead(302, { location: '/' });
        res.end();
        return;
      } else if (action === 'refresh') {
        batch = await buildBatch();
        index(batch);
        res.writeHead(302, { location: '/' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page(batch, recentlySent(st), sentInLast24h(st), weeklyConnects(st, Date.now())));
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(String(error));
    }
  });

  server.listen(PORT, () => {
    const total = allDrafts(initial).length;
    console.log(`\noutreach ready → http://localhost:${PORT}`);
    console.log(`(${total} options: ${initial.followups.length} follow-ups, ${initial.triggered.length} just-opened, ${initial.leadership.length} leadership, ${initial.random.length} random)`);
  });
}

// ── cli ──────────────────────────────────────────────────────────────────────
// Guarded exactly like contacts.ts: importing this module (selftest does)
// must never trigger the network build or the pidfile lock.

const args = process.argv.slice(2);

if (process.argv[1]?.endsWith('outreach.ts')) {
  // Before the lock and before any build: recording a hand-sent mail is a
  // one-line state edit, not a batch build, and must work while a served
  // instance is running.
  const manualIdx = args.indexOf('--sent-manual');
  if (manualIdx !== -1) {
    const addr = args[manualIdx + 1];
    if (!addr || !addr.includes('@')) {
      console.error('usage: npx tsx src/outreach.ts --sent-manual someone@company.com');
      process.exit(1);
    }
    const st = await readJson<OutreachState>(STATE_PATH, {});
    const entry = await markSentManual(st, addr);
    console.log('recorded touch ' + entry.touch + ' to ' + addr + '; next follow-up due ' + entry.nextDueAt.slice(0, 10));
    process.exit(0);
  }

  if (!(await acquireLock())) process.exit(1);

  const batch = await buildBatch();
  console.log(`batch: ${batch.followups.length} follow-ups + ${batch.triggered.length} just-opened + ${batch.leadership.length} leadership + ${batch.random.length} random`);
  for (const d of allDrafts(batch)) {
    const v = d.verdict === 'valid' ? '✓' : d.verdict === 'unknown' ? '?' : '-';
    console.log(`  [t${d.touch + 1}] ${d.company.padEnd(20)} ${d.addr.padEnd(32)} ${v} ${d.fact ? `"${d.fact.slice(0, 40)}"` : ''}`);
  }

  if (args.includes('--serve')) {
    await serve(batch);
  } else if (args.includes('--mbox')) {
    await syncVerdicts(batch);
    await writeMbox(batch);
  } else if (!args.includes('--print')) {
    const freshState = await syncVerdicts(batch);

    await mkdir('out/outbox', { recursive: true });
    await writeFile(
      PAGE_PATH,
      page(batch, recentlySent(freshState), sentInLast24h(freshState), weeklyConnects(freshState, Date.now())),
      'utf8',
    );
    console.log(`static page written → ${PAGE_PATH}`);
    // Deployed mode companion: the hosted click-API needs each draft's
    // redirect targets (the Gmail/mailto URLs are computed at build time from
    // subject+body, and the API route never sees them otherwise).
    const drafts = Object.fromEntries(
      allDrafts(batch).map((d) => [
        d.id,
        { gmailUrl: d.gmailUrl, mailtoUrl: d.mailtoUrl, company: d.company, role: d.role, touch: d.touch },
      ]),
    );
    await writeFile('out/outbox/batch.json', `${JSON.stringify(drafts, null, 2)}\n`, 'utf8');
    console.log(`draft map written → out/outbox/batch.json`);
  }
}
