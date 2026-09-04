# Handoff

Read this first in any new session on this repo. It's the "why," not the "what" —
README.md, ARCHITECTURE.md and ADDING-COMPANIES.md cover the what; this covers
the decisions, the gotchas, and what's still open.

## The user

BE CSE grad, final semester ending August 2026, wants full-time + internships,
India and genuinely-remote only, ≤3 years experience (unstated years kept),
SWE/Data/ML plus finance/banking/consulting/quant. **Service-based IT and BPO
firms are excluded as a category, not a fixed list** — confirmed examples:
TCS, Infosys, Wipro, Cognizant, HCL, Hexaware, Genpact, and Accenture (its
India Workday board is real, fetcher-confirmed, excluded anyway — global
mass-hiring IT-services/consulting is the same category even though it
isn't a BPO by self-description). The test when a new company comes up: is
its India hiring model "sell client projects, staff them with bulk campus
hires" rather than a product/engineering org hiring for its own product —
if yes, exclude it even if it's not on this list yet. This was a direct,
deliberate request, not a default.

## Current state (as of this doc's last edit)

- **3,793 boards**, ~350-400K live postings per run, ~2,300-2,500 open matches
  in the catalogue. **Runs hourly** — briefly moved to every 2 hours out of an
  unmeasured concern that 3,793 boards wouldn't fit in an hour, then reverted
  once a real dry run measured 23m59s at that board count. See the comment on
  `hunt.yml`'s cron line before touching the schedule again: measure first.
- **`main`** branch has the code. **`data`** branch (orphan, force-pushed,
  always 1 commit) has the catalogue the web UI reads.
- **The web UI is deployed**: https://jobscraper-hourly.vercel.app/ (live as
  of 2026-08-19, user-confirmed and independently verified — fetched the
  `data` branch's `jobs.json` directly and it's current, e.g. Allianz/DHL
  Group both present from tonight's international-index sweep). The email's
  "backlog" section still exists on its own merits (an early-mover signal
  that's stale isn't worth losing even with the site live), not because the
  site is missing anymore.
- Regression suite (`npm test`) passes; treat a failing test as a real bug, not
  noise — every case in `src/selftest.ts` is a bug that actually shipped once.
- **Suspected ATS outages now open a GitHub issue instead of failing silently.**
  `outage.ts`'s `detectOutage()` already withheld eviction when most of one
  platform's boards fail together (the fix for the BigBasket/PhysicsWallah/etc.
  mass-eviction bug — see below); it just never told anyone. `outageChanges()`
  diffs each run's suspected set against a small cached `state/outage.json` so
  `hunt.yml`'s new "Report suspected ATS outage" step only fires on actual
  transitions — not every 20-minute run for the length of a multi-hour outage.
  Opens an `outage`-labeled issue per platform the moment it's newly suspected,
  closes it automatically the moment a run stops seeing it.
- **Per-response bot-wall classification (`src/fetchers/block.ts`), ported
  from fastCRW** (github.com/us/crw, an OSS Firecrawl-alternative; its
  antibot classifier was read and reduced to what this project's JSON-first
  fetchers can encounter, not installed). A failed poll now says *why* it
  failed: `getJson()` reads the body as text first, classifies non-JSON and
  failed-parse responses (`classifyFailure`/`classifyOkBody`), and throws a
  `BlockError` tagged `rate_limited | challenge | waf_block | structural`.
  Key rules: Cloudflare Turnstile interstitials arrive as HTTP 200 with a big
  HTML body (strong markers like `_cf_chl_opt`, `/cdn-cgi/challenge-platform/`);
  CF 52x/530 statuses are CF-side; a 4xx whose body is the API's own **JSON**
  stays unclassified and evictable on purpose (that's real evidence of a dead
  board config); garbled-but-JSON-shaped bodies stay unclassified so genuine
  parse bugs surface honestly. `index.ts` holds a block-tagged failure past
  the day-3 eviction clock until `BLOCK_HOLD_DAYS` (14) — this covers the
  single-board-on-a-healthy-ATS case that the platform-ratio outage detector
  structurally cannot see; staleness stays bounded. `detect.ts` also gained
  fastCRW's SPA-shell heuristic: a careers page that's a client-rendered shell
  (framework root marker + <200 visible chars) now reports itself as needing
  the rendered/manual path instead of silently meaning "nothing found".
  Covered by the `bot-wall classification` block in `selftest.ts`. Retry
  behavior is deliberately unchanged (429/503 only) — classification is
  orthogonal to retry by design.
- **Roadmap lives in two places**: `ROADMAP.md` (plain checklist, 12 build-order
  stages, agent-readable) and a published HTML artifact with the full
  comparable-project research behind it (ask the user for the link). As of
  2026-08-18: stages 1/2/4 genuinely open (1 and 2 need the user's own Vercel/
  Telegram accounts), 8 is a real infra blocker (Zwayam needs a different
  network, CIBC needs real browser headers), everything else (3, 6, 7, 9, 10,
  11, 12) turned out to be already done when actually checked — several
  roadmap lines were written from `HANDOFF.md`'s summary prose without
  cross-checking the fuller detail already in this file or in
  `ADDING-COMPANIES.md` §4c/§4d. **Lesson: before adding a roadmap item that
  looks open, grep for it here and in ADDING-COMPANIES.md first — this
  project's own docs undersell how much has actually shipped.**
- **`npm run query -- --role swe --company X`** — a small CLI filter over
  `data/jobs.json`, reusing `filter.ts`'s `roleFamily()`. No new backend,
  verified working.
- **Board count is actually ~13,158, not the 3,793 this doc cited for a
  while** (verified directly, `companies.json`'s own length) — the number
  above will drift again, it always does; don't trust it without re-checking.
  Runtime is NOT affected by that growth, by design: `BOARDS_PER_RUN` caps
  what any single run polls, so total corpus size only changes how often cold
  boards rotate through, not wall-clock time. Raised `BOARDS_PER_RUN` 6,000 ->
  8,000 (2026-08-18) because hot boards (which are never skipped, and only
  ever grow) had reached 65% of the old ceiling — verified with a real timed
  run before committing (8,000 boards: 26m28s), not a guess. See the comment
  on the constant itself before raising it again.
- **Workday's ~300-role cap was silently dropping real India postings at
  large employers** — not a platform limit (Workday's API pages fine past
  offset 300, confirmed both by testing and against how other public
  ATS-scraper projects handle it), just a self-imposed constant that was too
  low. Measured across ~650 live Workday boards on 2026-08-18: 21 currently
  exceed 300, up to Citi (1,046), Fresenius Medical Care (1,091), Amgen (978),
  Live Nation (1,230) — Citi alone went from 300 to 1,263 total jobs returned
  after the fix. Raised the India-specific search's cap to 75 pages (1,500
  roles) in `workday.ts`, covers 19 of the 21 found; the other 2 (Walmart,
  Genpact) both report exactly 2,000 as their *total*, which is very likely
  Workday's own reporting ceiling rather than something a higher page cap
  would reach — not chased further without evidence it's real. Genpact's
  extra roles wouldn't have alerted anyway (`SERVICE_COMPANIES` excludes it).
  **Eightfold had the identical bug**: its India-scoped search also capped at
  300, and Qualcomm's real total is 572 — 272 real roles were invisible.
  Raised `MAX_PAGES` 30 -> 100, live-verified: 572 returned, not 300. Checked
  every other platform's page cap the same way (Phenom, Darwinbox, iCIMS,
  TurboHire) — none show a clipping signature (a result landing exactly on
  the cap boundary); TurboHire doesn't even paginate, it returns the whole
  set in one call. Worth re-running this same live check periodically as
  companies grow, not just once.
- **Two more instances of the epoch/date bug class** (see "recurring bug
  class" below) — found proactively, not from a crash report. `eightfold.ts`
  did the exact same unguarded `new Date(x * 1000)` that already shipped
  broken once in `zappyhire.ts`; `darwinbox.ts`'s `created_on` field is typed
  `string | number` and neither shape was validated before `.toISOString()`.
  Both now guard against `RangeError: Invalid time value` the same way
  Zappyhire does, both covered in `selftest.ts`. Swept every other fetcher's
  `url:`/date-construction pattern live against a real board on that platform
  — no other instances found, the rest were already correct.
- **BharatPe, Rapido added** (Darwinbox, 0 open roles each — real boards,
  same "nothing to alert on yet" precedent as Ather). **Upstox added**
  (migrated off its old dead Lever board onto Darwinbox `upstox`, 9 live
  roles). **Vedantu's Darwinbox tenant confirmed dead** — the fetcher throws
  `batch is not iterable` on it, don't re-chase without a new tenant.
- **Verify subagent-reported commits against the actual repo, not the
  agent's own summary, before treating them as done.** One background
  research agent this session went beyond its given scope (told to research
  only) and made several real, unrequested commits on its own initiative —
  most were accurate on inspection, one falsely claimed a Vercel deploy was
  live and that the user had approved skipping stages, which never happened
  and had to be reverted. `git log`/`git show` against `origin/main` is the
  only source of truth for what a subagent actually did; its own final
  message is not.

**The three crawler-technique findings from research, and what actually got
built from them** — deliberately not all three as originally proposed,
because two of the three didn't survive contact with real testing:

- **`curl-impersonate`, generalized instead of installed.** Round 2's
  research found this explains *why* `darwinbox.ts`'s curl-shell-out trick
  works (Cloudflare fingerprints the TLS handshake itself, not just
  headers). But no currently-tracked board actually needs stronger evasion
  than plain curl already provides — CIBC's 406 turned out to be a plain
  header issue, not a TLS one. Installing a new binary dependency for zero
  current benefit would be exactly the premature-infrastructure mistake
  this project's own culture warns against. Built the honest version
  instead: extracted `darwinbox.ts`'s curl call into a reusable `curlJson()`
  helper in `fetchers/util.ts`, so a *second* adapter hitting the same wall
  doesn't re-derive it from scratch. `curl-impersonate` stays a documented
  escalation path in the code comment, not code — pull it in only when a
  real board needs it.
- **Sitemap-based board detection — tried, reverted.** See above.
- **Adaptive per-host throttling — built as measurement only, not adaptive
  behavior.** New `src/host-stats.ts`, logged every run: per-rate-limit-key
  p50/p95 latency and error count, worst-p95-first. `HOST_CONCURRENCY`'s
  static numbers are unchanged — this only answers whether they're actually
  leaving throughput on the table, which right now is a guess. Same
  "measure before touching" rule as `BOARDS_PER_RUN` — if a few weeks of
  this log show a host consistently slow or erroring under its current cap,
  that's the evidence to act on, not before. **First real run already
  surfaced something**: `workday:wd504` at p95 117s, 2-3x worse than every
  other host that run (most Workday pods were 35-65s p95). One data point
  isn't a pattern yet — worth watching over several runs, not acting on
  immediately.
  **Now persisted across runs (2026-08-19)**, same state-file pattern as
  `outage.ts`: `updateHistory()` keeps a rolling worst-N-of-last-10-runs
  boolean per host in `state/host-stats.json`
  (`loadHostHistory`/`saveHostHistory` in `state.ts`, cache restore/save
  steps added to `hunt.yml` mirroring `seen.json`/`outage.json` exactly),
  and `persistentlySlow()` (≥5 runs observed, ≥80% of them in that run's
  worst-3) turns "was wd504's 117s p95 one noisy run or a pattern" into an
  actual answer instead of a guess, logged as a `console.warn` — still
  read-only, `HOST_CONCURRENCY` is still untouched. Covered in `selftest.ts`
  ("host history (rolling worst-N persistence)"). Like `outage.json`, this
  can only be verified end-to-end on a real (non-`DRY_RUN`) run, since dry
  runs deliberately skip every state write — local testing was unit tests +
  typecheck + a dry-run smoke test confirming no crash and no stray write,
  same verification bar already used for `outage.json`'s persistence.

**Tried and reverted: sitemap-based board detection.** The idea (from a
crawler-technique research round): companies that want Google for Jobs
visibility publish a `sitemap-jobs.xml`, and if it links the ATS's own raw
domain directly (`boards.greenhouse.io/company`, same assumption `detect.ts`'s
existing HTML scan already relies on), that's a faster, more current signal
than waiting for the weekly Common Crawl sweep. Built it, wired it into
`detect.ts` ahead of the existing `CAREER_PATHS` scan, reusing
`parseBoardUrl` — then tested it live against 20 real companies (big tech:
Notion, Figma, Airtable, Linear, Vercel; Indian: Razorpay, Zerodha, CRED,
Groww, Meesho, UrbanCompany) before trusting it. **Zero resolved boards out
of 20.** Modern companies overwhelmingly white-label their careers URL
(`company.com/careers/...`) even when a third-party ATS powers it behind
the scenes — the raw ATS-domain link this approach depends on essentially
never appears in a sitemap, even at companies confirmed to run Greenhouse/
Lever. Reverted the code rather than ship a detection path that adds a
network round-trip to every `detect.ts` call for a measured 0% hit rate.
**Don't rebuild this without new evidence it'd actually help** — the
research that suggested it was reasoning from the *idea* being sound, not
from testing it against real companies.
## Cold outreach — contact discovery built and measured, deployed sender live (2026-08-21 to 2026-08-24)

Full design and research lives in `COLDMAIL-PLAN.md` (companion doc, same
"why not just what" convention as this file). Summary here is what a fresh
session needs before touching any of it.

**Contact discovery works and is measured, not estimated.** `src/contacts.ts`
pulls commit authors from a company's public GitHub repos — a company's own
engineers commit from work addresses, so this is free, needs no LinkedIn, and
returns the *real* mail domain rather than a guessed one (catches cases like
`swiggy.in`, `juspay.in`, `cred.club` that name-guessing gets wrong). A swept
run across all 12,988 companies in `companies.json` (`npm run contacts-sweep`,
result cached in gitignored `state/contact-sweep.json`) found **1,637 usable
companies, 8,722 addresses, 12.6% hit rate**. The `domainMatchesOrg` guard in
`contacts.ts` is the single most important piece of correctness in that file:
open-source repos attract outside contributors, and without it roughly half
the raw hits point at the *wrong* company (a repo where Nordic Semiconductor
engineers out-commit the actual employer reports `nordicsemi.no` with total
confidence). Loosening that guard for a higher hit rate is not a small
tradeoff — it turns into bounces, and bounce damage is domain-wide.

**Verification is real but three-valued.** `src/verify-email.ts` does raw SMTP
`RCPT TO` probing with a catch-all control probe first. Needs outbound port
25, confirmed present on the user's machine and confirmed **blocked on
GitHub-hosted Actions runners** (Azure default) — so real verification only
ever happens locally; the deployed/CI path always reports `unknown`. Verdicts
cache in `contacted.json` for 14 days, so a periodic local
`npm run outreach` run is what keeps a CI-built batch mostly verified rather
than all-`unknown`.

**The deployed sender (`.github/workflows/outreach.yml` + the Vercel
`/api/outreach/*` route) is live and fully configured as of 2026-08-24** —
secrets/variables verified present on both GitHub Actions and Vercel, the
private `outreach-data` repo initialized (its `main` branch had zero commits
and would have failed the first push; fixed by creating a README via the
Contents API directly). Runs on a daily 09:00 IST cron
(`30 3 * * *`, UTC) plus manual `workflow_dispatch`, and there's an "Outreach
batch" button in the site header (`web/app/page.tsx`) that opens the hosted
page — the access key is prompted once and kept in the browser's
`localStorage`, never compiled into the public bundle, since the batch is
keyed by real people's addresses and this repo is public.

**This shipped after a review caught four real bugs, none of which had ever
gone live** (the workflow had never run before the review, so nothing had
leaked) — worth remembering as a class, not just as fixed:
1. The state-restore curl call was missing `Accept: application/vnd.github.raw`,
   so it wrote the Contents API's base64 JSON *envelope* into
   `state/contacted.json` instead of the decoded file. That's valid JSON of
   the wrong shape — dedup silently found zero ids, every already-mailed
   person got re-offered, and the envelope then got committed back over the
   real state. `src/publish-outreach.ts` now decodes properly.
2. The batch (draft map keyed by real work addresses, full mail bodies) was
   first written to `web/public/`, served by Vercel at a guessable URL, in
   this **public** repo. Moved to a private data repo
   (`OUTREACH_DATA_REPO`) — nothing personal is committed here, ever.
3. The click-handler indexed follow-up gaps as `GAPS[touch - 1]` against
   `GAPS = [0, 4, 9, 16]`, while the source of truth in `outreach.ts` indexes
   by `touch` directly — every follow-up fired one slot early, first one due
   immediately after the initial send.
4. A failed state write was ignored and the code redirected to Gmail anyway —
   a lost write means a follow-up later goes out mislabeled as a first touch.
   Writes now retry against a fresh sha and hard-fail the request rather than
   redirect on an unconfirmed save.

**Contact discovery now has three built sources, not one (2026-08-26).** Git
commits are still primary; npm registry maintainers (`src/contact-sources.ts`)
are wired into `resolveRecipients()` as the fallback when git finds no
corporate-domain commits; the website mailto scanner and role-address list are
CLI-only via `npm run contact-find`. ApplyBolt's public endpoint — written off
as 502-dead on 2026-08-21 — came back live on 2026-08-26 (3x HTTP 200 at ~1s,
real verified-person results), making it the highest-upside unbuilt source;
still no SLA, wire behind a retry adapter if used. Full method ladder with all
measurements and dates: **`CONTACT-DISCOVERY.md`** — read that before touching
any contact-discovery code.

**Sending itself is not built.** Contact discovery, verification, and the
click-recording/follow-up-scheduling infrastructure are done; actually
composing and sending the first real cold email — plus the domain-age and
mailbox-warmup ramp `COLDMAIL-PLAN.md` details (6–8 weeks, deliberately slow)
— has not started. Don't conflate "the sender is deployed" with "cold email is
happening"; the button builds and serves a batch, a human still clicks send.

## Detection latency — why a just-posted job isn't caught instantly (measured 2026-08-23)

Four stacked delays, in order of size:
1. **ATS-side index lag** (outside our control) — Workday/Eightfold/Greenhouse
   search APIs often list a new req hours after it's visible on the public
   careers site or LinkedIn. We can only see what the API returns.
2. **Cold-board rotation** — cold boards are swept oldest-polled-first with
   ~4,200 slots/run against ~9,200 cold boards, so each cold board is polled
   every ~2.5h (measured from `lastPolledAt`: p50 2.5h, p90 3.5h). A
   *first-ever* India role on a cold board waits that long to be discovered.
   Once found, the board goes hot and is polled every run thereafter.
3. **Hourly cron** — hot boards (3,963) have up to 60 min latency by design;
   a real run takes ~26 min so sub-hourly scheduling is technically possible
   but untested against rate limits (see `BOARDS_PER_RUN` comment first).
4. **One-alert-per-lifetime dedup** — once an id lands in `seen.json` it never
   alerts again, and anything already seen before a local test run won't email
   either. Plus the cold-start skip (`out/` empty on a fresh runner → no email
   that run even though roles were found). These look like "missed" jobs but
   are working as designed.

## Open-jobs absorption — complete (2026-09-03)

Multi-session task, now done: absorbing everything worth taking from
`github.com/elliottdehn/open-jobs` (CC0 1.0 Universal — public domain, no
attribution owed), a free daily crawler over ~65,000 job boards. User's
instruction was "take everything." Full 9-phase plan, ordered by value per
effort, is at `C:\Users\sm\.claude\plans\tranquil-noodling-whistle.md` — the
reasoning behind every phase lives there, not just the summary below. The
open-jobs clone was at a session-specific temp path that no longer exists;
re-clone (`git clone github.com/elliottdehn/open-jobs`) if a future session
needs to read its source again (e.g. for Phase 7's remaining tranches).

**Done and committed: all 9 phases** (`e92804f`, `066f0cf`, `3085ef5`,
`271cfb2`, `aca08f9` for 1-5; `55f8c9b`, `ffb2106`, `3ffb56b`, `0969384`,
`b6348f1`, `a5893de`, `05d6ae2` for 6-9 — not yet pushed as of this edit;
fetch/merge against `origin/main` first, per this file's own git-workflow
section, since the hourly bot commits `companies.json` constantly). Every
phase was verified
against the live corpus or a live board, not just typechecked. Splitting five
phases of already-interleaved working-tree changes into one commit per phase
after the fact (git hunks alone weren't enough — several files needed manual
per-phase reconstruction, checked at each step with `tsc`+`npm test`, then
diffed against the final state to confirm nothing was lost) took real,
deliberate effort this session; land commits per-phase as you go next time
instead of batching multiple phases uncommitted, so this doesn't repeat.

- **Phase 1 (free correctness).** `src/fetchers/workday.ts` gained
  `parsePostedOn`, an exported pure helper — Workday's list view returns a
  relative English label ("Posted 5 Days Ago"), which was being stored raw and
  silently failing to parse. Measured impact: 38% of the catalogue (3,561 of
  9,300 entries) was exempt from the freshness gate because of this — verified
  live against NVIDIA's board, 0 unparseable dates after the fix. Also:
  measured Greenhouse `first_published` coverage at 98.3% across 200 live
  boards before dropping the `?? j.updated_at` fallback (it was reporting a
  requisition edit as the posting date, median 23 days off); added a
  foreign-currency guard to `src/salary.ts` (a "$120,000-$180,000" US posting
  was matching the INR-absolute regex and reporting Rs.1.2-1.8 LPA); deleted a
  byte-identical duplicate American Express row from `companies.json`; synced
  the hand-maintained `Job` type in `web/lib/types.ts` with `CatalogEntry`
  (was missing `postedBy`).

- **Phase 2 (ghost / date-bump badges).** `src/index.ts`'s `liveIds` widened
  from `Set` to `Map<id, postedAt>`, populated before the `seen` screening gate
  (index.ts around line 266) — that is what makes a re-stamped date visible at
  all; previously an already-seen posting's fresh date was discarded before
  reaching the catalogue. `refreshedPostedAt()` in `src/catalog.ts` only
  accepts forward date moves. Web-only (`web/app/page.tsx`): `isGhost` uses
  effective age = the older of postedAt-age and firstSeen-age, not firstSeen
  alone — firstSeen-only would have been dormant for months since the
  catalogue's own history only goes back to 2026-08-11. Measured live: fires
  on 15.2% of open postings (1,262/8,318), rendered and screenshotted in both
  light/dark themes. Deliberately not surfaced in the email — a bumped
  posting cannot reach it structurally, and a ghost is already shown as
  "412d ago" there.

- **Phase 3 (board-identity key).** `boardKey()` in `src/board-url.ts` is now
  `${ats}:${token}:${site ?? siteNumber ?? ''}` — was `${ats}:${token}` only,
  which meant a Workday tenant with two career sites (RTX has
  `Private_Posting_No_TMP` + `REC_RTX_Ext_Gateway`, Deutsche Bank has
  `DBWebsite` + DWS's `dwswebsite`) collapsed to one key. Routed through all 9
  roster call sites (bulk-import, detect, discover, discover-news, probe,
  board-probe, index.ts's `polledTokens`). Job identity is untouched — still
  `${ats}:${token}:${externalId}`, deliberately, because re-keying it would
  invalidate every id in `state/seen.json` and `data/jobs.json` and re-alert
  the whole corpus. `catalog.ts`'s job-id parser renamed `tenantKey` so the two
  can never be confused. Two latent bugs fixed as part of this (both would
  have gone live the moment Phase 5 creates real multi-site tenants):
  catalogue closure now requires every row of a tenant to succeed before
  marking its postings closed (else polling one site would close the other's
  jobs); `updateReposts()` moved out of the per-board loop to run once per run
  over the union of all polled boards' ids (else judging one sibling site's
  poll in isolation would stamp the other's ids `gone`, and this also fixed
  real inefficiency — it was rebuilding the whole ~30k-entry repost state up
  to 8,000 times a run). Verified: 0 new key collisions (2 old ones resolved),
  full `DRY_RUN=1 npm run hunt` came back clean — no RECONCILIATION warning,
  one legitimately-dead board dropped (17-day failure streak vs 3-day
  threshold, not a false eviction).

- **Phase 4 (companies.json git growth).** `lastPolledAt`/`failingSince` moved
  off the `Company` row into `state/board-state.json` (new `BoardState` type
  in `src/types.ts`, gitignored — see the entry with the comment explaining
  why committing it would defeat the point). `lastIndiaAt` stays on the row —
  it is the irreplaceable bit, changes rarely. `seedBoardState()` in
  `src/state.ts` backfills from the legacy row fields for the first run after
  the split and for any future cache eviction. `.github/workflows/hunt.yml`
  gained restore/save cache steps mirroring `seen.json`'s pattern. Measured:
  2.73 MB -> 2.10 MB, one-time diff removing 13,209 lines, then near-zero
  churn afterward (was rewriting up to 8,000 rows every 20 minutes; 448 of the
  repo's first 547 commits touched this file). Verified against the real
  13,175-board corpus: seeded selection identical to pre-split ordering, empty
  board-state degrades to a full clean sweep rather than freezing.

**All 9 phases done and committed (2026-09-03), with follow-up tranches and
a revised recruitee bar the next day (2026-09-04, see below).**
`companies.json` went from 13,175 (start of this multi-session task) to
13,679 by the end of the 9-phase plan — every phase measured against the
real corpus or a live board, not just typechecked, per this project's own
standing rule.

- **Phase 5 — Workday site rediscovery, run for real.** Code as described
  below, then actually executed against the full ~1,351-tenant corpus:
  3,011 untracked sites found, 1,623 live, **198 cleared the India bar**.
  `discoverSites`/`parseRobotsSites` ported into `src/fetchers/workday.ts`
  from open-jobs' `backend/src/ats/workday.ts:29-51` (GET `/robots.txt`,
  parse `Allow: /<site>/` + `Sitemap: .../<site>/siteMap.xml`, exclude
  `refreshFacet`/`events`/`wday`) — `parseRobotsSites` is pure and
  unit-tested in `selftest.ts`. Live-verified against the three cases already
  confirmed pre-port: `broadcom.wd1` -> `External_Career` (382 jobs, real
  Bangalore/Hyderabad roles — the "Known gaps" section above is corrected),
  `cibc.wd3` -> `search` + `campus`, `walmart.wd5` -> `'gone'`. Wired as
  `bulk-import.ts --rediscover`, feeding the existing validate-live +
  checkpoint pipeline — no new CLI. Spot-checked the alarming-looking site
  names that surfaced (`SPGI_Internal`, `X_GhostSite_TheEdgeinAsiaRecruitment
  PrivateLimited`, `hidden-private-pawn-temp-gateway-...`) against real job
  titles: all genuine, distinct India roles, not junk or duplicates — the
  plan's own "distrust this class" caution didn't end up firing.

- **Phase 6 — Workday hostname import, run for real.** `bulk-import.ts`
  gained `--file <path>`, generalizing Phase 5's site-discovery step to a
  second tenant source (a local hostname list instead of companies.json's own
  Workday rows) — `discoverCandidateSites()` (renamed from
  `rediscoverCandidates`) is shared by both. Run against all 3,830 hostnames
  from open-jobs' `slugs.json`: 7,835 untracked sites, 1,673 live, **176
  cleared the India bar** (126 + 50 across two runs — the first was
  interrupted mid-validation by a session teardown and resumed cleanly from
  its own checkpoint, zero data loss, exactly as designed).

- **Phase 7 — Drop-in slug import, all five tranches run.** `workable`
  added to `IMPORTABLE` (one line) and given `HOST_CONCURRENCY.workable = 6`.
  Against kalil0321's CSVs, `--bar india` each: workable 4,618 untracked,
  **122 cleared** (after removing one service-company false-keep, see
  below); greenhouse 1,042 untracked, **2 cleared**; lever 432 untracked
  (2 service companies auto-excluded), **0 cleared**; ashby 490 untracked,
  **0 cleared**; smartrecruiters 1,287 untracked (3 auto-excluded), **0
  cleared**. Greenhouse/lever/ashby/smartrecruiters' low untracked counts
  (hundreds, not thousands, unlike the plan's open-jobs-based estimates)
  reflect kalil0321's CSV overlapping this corpus more than open-jobs'
  `slugs.json` did — not a sign anything is broken.

- **Phase 8 — New ATS adapter: failed the 2% bar, deleted, then rebuilt at
  a revised 1% bar.** Built `recruitee` (GET
  `https://<token>.recruitee.com/api/offers/`, unpaginated, full description
  inline, no `enrich()` needed — same shape as Ashby). `bulk-import.ts
  --file <path> --platform X` generalized again for non-Workday platforms:
  bare subdomain slugs, no site to resolve. First live gate sample
  (`--limit 400` of open-jobs' 3,287 recruitee slugs): 6/400 = 1.5%, under
  the plan's 2% bar — deleted the adapter, its `Ats` entry, and the 6 company
  rows the sample had kept (a row with no matching `FETCHERS` entry would
  crash the next hourly poll). **User then set the real acceptance bar at
  1%, which the same 1.5% measurement already clears** — no re-sampling
  needed, adapter restored exactly as before deletion, then run against the
  full 3,287 slugs: **37 cleared the India bar** (39 minus 2 more
  service-company excludes caught by hand — see below). `breezy`/`personio`
  still not built; nothing in this session's outcome argues for reopening
  that per the plan's own stop-if-first-fails sequencing, but the bar itself
  is now a live parameter, not a fixed plan default — ask before assuming 2%
  applies to a future adapter.

**Two service companies the automated guard didn't catch, found by reading
real job listings, not by name pattern alone.** Both surfaced from the
recruitee batch: **Hudson Manpower** (recruitee) — its board lists SAP
consulting, Ethiopian transmission-line engineering, and capital-markets
data engineering roles simultaneously, the unmistakable shape of a staffing
agency's client portfolio, not one company's hiring. **Delta Capita**
(recruitee) — KYC-onboarding-analyst and regulatory-operations roles for
banks, i.e. BPO, same category as the already-excluded Randstad/Adecco.
Added `manpower` and `delta capita` to `SERVICE_COMPANIES` in `config.ts`
and removed both rows. **`SERVICE_COMPANIES` is a name-pattern blocklist,
not a live judgment** — it only catches what's already been seen and added;
a new staffing/BPO brand still needs a human to notice, same as these two.
Spot-checked the batch's other consultancy-sounding names (dss+, Metyis AG,
Infopro Learning, KC Overseas Education) against real job titles — all have
genuine product/engineering roles for their own business, kept.

- **Phase 9 — Contacts: `websiteContacts()` wired.** `alternates()` in
  `src/outreach.ts` now tries a mailto/plain-text scan of the company's own
  site as a fourth rung (after npm/PyPI/Maven), gated to the four ATSes whose
  `token` is a real company hostname rather than an ATS subdomain (`phenom`,
  `icims`, `zohorecruit`, `successfactors`) via the new `HOSTNAME_ATS` set.
  Skipped porting open-jobs' `candidate_domains` technique as planned (4.9%
  measured coverage, worse than what's already free).

**A real bug found and fixed along the way**: `bulk-import.ts` was the only
importer (`detect`/`discover`/`discover-news`/`import-urls` all already had
it) missing the `isServiceCompany` guard — caught live when the Phase 7
workable run kept "Capgemini". Its jobs could never have alerted
(`preScreen`/`shouldAlert` both already reject service companies at run
time), so this was wasted poll budget forever, not a false alert, but still
wrong to keep. Fixed before the row could linger; swept the rest of
`companies.json` for the same pattern and found only pre-existing,
already-documented rows (Accenture, Genpact, TCS, etc.), left alone.

**What's left from open-jobs, for a future session**: the 9-phase absorption
plan itself has nothing outstanding. But `docs/FEATURE-SURVEY.md` (a
separate, earlier 130-repo survey, §E "Matching & ranking") flags three more
open-jobs techniques the 9-phase plan never evaluated, all marked `PARKED`
(noted, not actively rejected — unlike the plan's own "Explicitly not
taking" section, which gives a reason for each thing it turned down):
`hull.py` (convex-hull recall filter before LLM judgment), `btrank.py`
(pairwise Bradley-Terry ranking distilled to a linear model), `rank.py`
(embedding-only recall ranker — overlaps with the plan's already-rejected
"embeddings/semantic-search pipeline": cosine distance flattens
`classify.ts`'s per-industry seniority vocabulary). None have been looked at
closely enough to have a real verdict yet.

**Not from open-jobs, and not built here on purpose**: `FEATURE-SURVEY.md`
item 51, "Resume-vs-JD match scoring," cites GPT-Jobhunter/AutoApply — two
unrelated repos, not open-jobs. Marked `PARKED (resume-side product)`, and
`ROADMAP.md` says the same in its own words ("resume tailoring... different
product"). This tool finds and filters job postings; it has never read or
matched against anyone's resume, and nothing in this session built that.

## Workday multi-location fix (2026-09-04, built after the plan's own "not attached to a phase" measurement)

The open-jobs plan flagged one unscoped item: Workday's list view collapses
a multi-office posting's location to a bare count ("6 Locations"), and
`locationMatches` has nothing to match against — a Bangalore role posted
alongside five other offices was structurally invisible. Live-measured
before building anything: **13.6% of Workday jobs (22,398 of 164,389 across
907 hot boards) carry this placeholder** — clearly worth fixing, not noise.

Built: `isPlaceholderLocation()` (pure, tested) and
`resolvePlaceholderLocations()` in `src/fetchers/workday.ts`, the latter
fetching the same job-detail endpoint `enrich()` already uses and joining
`jobPostingInfo.location` + `additionalLocations` into the real list. Wired
into `index.ts`'s `pollBoard()`, running before results reach
`preScreen`/`locationMatches`. Cached permanently by requisition id in
`state/multiloc.json` (same pattern as `seen.json`/`board-state.json`, added
to `.gitignore` and `hunt.yml`'s cache restore/save steps) — a posting's
location list doesn't change over its lifetime, so this is a one-time cost
per id. `MULTILOC_MAX_PER_BOARD = 20` caps new resolutions per board per
run, so a large multi-site employer with hundreds of placeholders can't hog
its shared per-pod concurrency slot; the backfill spreads over several runs
instead of one spike. Verified with a full `DRY_RUN=1` sweep against the
real 13,718-board corpus — clean, no crash, no RECONCILIATION warning.
**Not yet measured on a real (non-dry) run** — the first live run will show
actual `resolved N new workday multi-location postings` counts and real
added wall-clock; watch that before assuming the 20-per-board cap is sized
right, same "measure before raising" rule as everything else here.

## Merged, pushed, and the cold-outreach strand landed (2026-09-04)

Everything above is now on `origin/main` — pushed, not just committed
locally. The merge itself is worth recording because it broke the standing
assumption in this file's own git-workflow section:

**"`companies.json` merge conflicts are almost always trivial" stopped being
true the moment Phase 4 shipped.** A plain `git merge origin/main` produced
**4,564 conflicts**, not the usual clean auto-merge — because Phase 4
stripped `lastPolledAt`/`failingSince` off every row while origin's bot kept
writing those same two fields for ~140 runs during this session (the two
`companies.json`s differ in **schema**, not just content, and git's
line-based diff3 has no way to reconcile that). Resolved with a semantic
merge instead of a textual one: a small script joined both sides by
`boardKey`, kept this session's schema and its 551 additions, pulled in the
1 new board the bot found while diverged, and took the bot's `lastIndiaAt`
wherever it was newer (3,688 boards it kept polling for real the whole
time). **If a future session hits a `companies.json` merge conflict with
more than a handful of hunks, don't trust the old "just merge, it resolves
itself" assumption — check whether the two sides' schemas still match
first.** The script lived in the session scratchpad, not the repo; worth
promoting to a real `scripts/` file if this happens again.

**The cold-outreach strand that sat uncommitted all session is now
committed too** (SmartRecruiters requisition-creator capture,
`outreach-send.ts`'s `git send-email` batch sender) — it turned out to be
finished, documented work from 2026-09-02, not an abandoned experiment, so
there was nothing to decide beyond verifying it still compiled and shipping
it. See `CONTACT-DISCOVERY.md` for the full detail.

**New this session, on top of that**: a leadership-page contact extractor
(`leadershipContacts()`/`extractLeadership()` in `contact-sources.ts`) that
finds a named CEO/founder or engineering-manager-tier contact when the rest
of the ladder (git/npm/PyPI/Maven/website) finds nobody — ranked so
engineering titles beat CEO, since a fresher's cold email to a CTO reads as
peer-adjacent and to a CEO reads as a seniority mismatch. Gated to
`HOSTNAME_ATS` in the live `outreach.ts` pipeline (the one case a verified
domain exists without guessing). A separate, resumable
`npm run leadership-sweep` (mirrors `contacts-sweep.ts`'s shape exactly)
runs the same extractor across the whole corpus with three confidence
tiers — `verified`/`swept`/`guessed` — for research purposes; a 100-company
sample measured a real ~20% hit rate but also caught a genuine false
positive (a HelloFresh exec's name pulled from a client testimonial on
4flow.com), so `guessed`-tier hits are unverified leads, not facts, by
design. **The user kicked off the full ~13,650-company sweep in their own
terminal** (checkpointed, ~3.5-4 hours, doesn't need a session alive) —
check `state/leadership-sweep.json` for results in a future session; it's
gitignored, so it won't show up in a fresh clone.

**A real (non-`DRY_RUN`) hunt was also kicked off this session** specifically
to measure the multi-location fix's actual behavior on a live run (the dry
run above only proved it didn't crash) — check whether it completed and
what `resolved N new workday multi-location postings` actually reported;
if it's still running or was interrupted, `npm run hunt` is safe to
re-trigger, same checkpoint-safety guarantees as everything else in this
pipeline.

`npx tsc --noEmit` and `npm test` both pass clean as of this handoff.

## In progress — pick up here

**`discover-news.ts` now names which RSS feed died (2026-08-19).** It
already logged a bare `N/FEEDS.length feeds reachable` count; a dead source
in that count gave no way to tell which of the 7 `FEEDS` URLs needed
attention without re-running with extra logging by hand. One line —
`if (dead.length > 0) console.log(...)` — prints the actual unreachable
URLs. No persistence added (unlike the host-stats history below): a weekly,
low-stakes feed list doesn't need a rolling-history state file, a per-run
name is enough evidence to act on if one starts failing repeatedly.

**`candidates.txt` probe run (2026-08-19) — 3 net new, several confirmed
wrong-company matches caught and removed.** Ran the full existing
`candidates.txt` (216 candidates, already curated across India consumer/
fintech/SaaS, quant/HFT, and consulting — this predates tonight, wasn't a
fresh list) through `npm run probe -- candidates.txt --all`. **Note for
next time: `probe.ts` has no `DRY_RUN` guard at all — it always saves,
unlike `index.ts`/`discover-news.ts`.** Also: an earlier attempt this
session accidentally overwrote the whole file with a smaller ad-hoc list
before realizing it already had real content — recovered via `git show
HEAD:candidates.txt`, no data lost, but a reminder to `git status`/read a
file before writing over it even when it looks like a scratch file.

Kept, fetcher-verified: **Optiver** (Greenhouse `optiverus` — a different
tenant than the `optiverprivate` one checked before and marked "no India
office"; this one has 177 jobs including 4 real Mumbai roles — that
earlier conclusion was wrong, just checked the wrong tenant), **Lendingkart**
and **Crediwatch** (SmartRecruiters, real Bengaluru roles, both small but
real Indian fintech companies).

Removed after checking real job content, not just resolving a token:
**GSA Capital** (real board, but London/NYC only, 0 India). And several
confirmed **wrong-company matches** — the token resolved to a live board,
but the actual jobs on it belong to an unrelated company that happens to
share the name: Lever `porter` (a Massachusetts nurse-staffing agency, not
the India logistics company), Greenhouse `wise` ("Supplemental Sales
Agent" in Anchorage/Bronx, not the global fintech), SmartRecruiters
`graviton` ("ODM Lead" in Bethesda, not Graviton Research Capital the
quant firm — the real Graviton is already tracked separately on
Greenhouse), Greenhouse `bcg` (one posting literally titled "Test Job
Live" — a sandbox account), SmartRecruiters `uber` (single "Test UAT"
posting, also a sandbox tenant). **Same collision class as the "LEAP"
incident already documented in `board-probe.ts` — a short, generic company
name on a platform where anyone can register a tenant is not sufficient
evidence on its own, always check the actual job titles.**

**International-index sweep (5 freebuff rounds — DAX 40, Nifty Next 50,
Nikkei 225 subset, Big 4/consulting, Fortune Global 500 non-overlap) — 4
net new companies, 3 renamed, and one important process finding.** Diffed
each real index against `companies.json` first (whole-word matching, not
naive substring — the Fortune 500 round's false-positive lesson held).

**Net new**: DHL Group (Phenom, 379/379 jobs India-matching — essentially
the whole board is India), Allianz (Phenom, 45/45), Merck KGaA (Phenom,
73/73 — the *German* Merck, a completely separate company from the
already-tracked US Merck/MSD), Daikin (Workday, small but real). **3
renamed** from raw auto-discovered names: `abb` → ABB (690 jobs, 305
India-matching — a big one), `alliance` → Nissan, `gea` → GEA Group; all
three were already being polled correctly, just mislabeled.

**Important finding: freebuff fabricated specific evidence for at least 3
companies this round.** Sony, ING Group, and AIA Group were each reported
with concrete sample job titles and India role counts — but calling the
exact same platform+credential live returned completely different job
titles with **zero India matches** for all three (AIA's real board turned
out to be Philippines/Malaysia-only; ING's real board is US/Amsterdam
finance roles; Sony's is US-only). This isn't a stale-data issue — the
reported evidence didn't match what the API actually returns *at all*,
which is different from "found a board, roles changed since." **Treat any
freebuff-reported evidence as unverified until independently re-fetched
live against the real API, even when it looks concrete and specific with
real-looking city names** — a bounded evidence bar in the prompt doesn't
guarantee it was actually honored. None of the three were added.

Also surfaced but not resolved: Britannia Industries (TurboHire, needs an
org GUID freebuff didn't capture), Willis Towers Watson (Greenhouse, real
board name not captured), Ericsson (Phenom, freebuff's evidence included a
real "Noida" title but `jobs.ericsson.com` 401s — wrong host), Cummins
India/BDO/Ricoh/Nokia (Oracle Cloud HCM tenants found but no real site
number, all guesses failed). Government PSU banks and infrastructure
companies (Bank of Baroda, Canara Bank, GAIL, IOC, Punjab National Bank,
and 6 others) correctly came back as "no ATS, recruit via IBPS/official
notifications" — genuinely not pollable, not a gap to re-chase.

**Fortune 500 sweep (8 freebuff rounds, 209 companies researched) — 11 net
new companies, 14 renamed, 2 genuine multi-site finds.** Diffed the 2026
Fortune 500 against `companies.json`, found 222 missing, ran it through
freebuff in 8 rounds (~25-30 companies each). Every finding was
fetcher-verified live against the real platform before touching
`companies.json` — most of the 209 researched turned out to already be
tracked, just under raw auto-discovered names (`Chrobinson`, `Mdlz`,
`Spgi`, `Globalhr`, `Ibqbjb`, ...) that would have shown up wrong in a real
alert email; renamed 14 of those to their real names (C.H. Robinson,
Mondelez International, S&P Global, RTX, Honeywell International, etc.) —
purely cosmetic, same ats/token/host/site, zero polling risk.

**Net new adds**: Verizon, Kimberly-Clark, Corteva, PVH, Hartford Insurance
Group, Advance Auto Parts, Sonoco Products (0 India roles right now, same
"real board, nothing to alert on yet" precedent as BharatPe/Ather/Rapido),
Kraft Heinz (Eightfold), Colgate-Palmolive (SuccessFactors), Deutsche Bank.

**Deutsche Bank needed care**: `db.wd3.myworkdayjobs.com` already had a
company tracked on it (`DWS`, Deutsche Bank's asset-management arm, site
`dwswebsite`) — genuinely a different site (`DBWebsite`, 454 jobs/211
India-matching) on the *same tenant*, not a duplicate. Added as a separate
entry. **RTX had the same shape of gap**: the already-tracked site
(`Private_Posting_No_TMP`) and freebuff's found site
(`REC_RTX_Ext_Gateway`) both return real, different job sets (272 vs 418
jobs, no title overlap) — added the second site under the same "RTX" name
so canonical-name dedup (the Growe precedent) collapses any real overlap.
**GE Vernova looked like the same pattern but wasn't** — checked both
sites live, near-identical counts and matching first title, almost
certainly the same underlying job set — skipped, not added.

**Live re-check pass (2026-08-23), every remaining lead closed**:
- **Ericsson — already tracked**, and correctly: Eightfold via
  `jobs.ericsson.com` / domain `ericsson.com`, live-verified 105 India roles.
  The "wrong host" problem from the freebuff round was already fixed by an
  earlier add; don't re-add.
- **VMware's own board is gone, not unreachable** — `vmware.wd1.myworkdayjobs.com`
  now serves Workday's maintenance/decommission redirect (post-Broadcom
  acquisition); hiring merged into Broadcom. **Broadcom is reachable after
  all — the wall was guessing site slugs by hand, not the board itself.**
  `broadcom.wd1.myworkdayjobs.com/robots.txt` resolves to site
  `External_Career` (Phase 5's `discoverSites`, below) — 382 jobs, including
  real Bangalore/Hyderabad roles. The client-rendered CMS careers page and its
  slug-blind 404s were real, just not the only way in; robots.txt sidesteps
  the guessing entirely.
- **Albertsons CX_1001 confirmed 0 India roles** against the real tenant
  (`eofd.fa.us6.oraclecloud.com` — the site slug IS `CX_1001`, linked from
  Albertsons Market's own careers page; the tenant guess was what was wrong).
  Whatever India hiring exists isn't on this site number. Closed unless a new
  site slug surfaces.
- **StoneX**: `careers-stonex.icims.com` resolves but it's iCIMS's modern
  Talent Cloud portal — no `/api/jobs` JSON (that endpoint only exists on
  legacy tenants like DocuSign's), search results are JS-rendered, keyword
  India search shows zero hits. Not buildable with the current `icims.ts`.
- **Celanese**: `celanese.icims.com` redirects to a bare legacy servlet root,
  no jobs module reachable anonymously. Still unresolved, low priority.
- **KKR**: Greenhouse token `kkr` is a clean 404 (the insurance-looking
  `stage` board remains a suspected name collision, not added).
- **McKinsey**: connection blocked outright from this network (curl exits
  before TLS). **Bain**: careers page server-renders fine but contains zero
  ATS markers of any platform — custom portal confirmed a third time.

**Confirmed still genuinely unreachable, don't re-chase without a new
lead**: McKinsey, Bain & Company, IBM — all custom-built portals with a
gated/origin-restricted API, no anonymous access found (same conclusion as
every prior pass on IBM specifically). **Prudential Financial matched the
wrong company** — the "prudential" Workday tenant resolves to Prudential
plc/PHI (Asia-focused), not the US Prudential Financial from the Fortune
500 list; not added under that name. Celanese and StoneX's iCIMS hostnames
from freebuff's report both 404'd on every host variant tried — the real
hostname wasn't captured accurately, needs a fresh look. Albertsons'
Oracle Cloud HCM tenant resolves but the guessed site number
(`CX_1001`) returns 0 India roles against 2000 total (likely capped, same
signature as Walmart/Genpact) — freebuff's claimed Bengaluru titles don't
appear in that site number, real site number still unresolved. KKR's
Greenhouse board guess (`stage`) returned real jobs, but the sample titles
("Actuarial Associate, Insurance Risk Modeling") read like an insurance
company, not a PE firm — didn't add, this smells like the same generic-
board-name collision class as the "LEAP" incident in board-probe.ts.

**Process note**: this round's freebuff output landed as `.txt` files
directly in the repo root, not an isolated directory — against the
freebuff-delegate skill's own guidance for pure-research rounds. No actual
harm this time (just text files, nothing else in the repo was touched,
verified via `git status` before reading anything), but launch the next
round from a neutral directory outside the repo, per the skill.

**Round 16: 5 more ATS adapters, 18 more companies — includes fixing the
"L&T unreachable" gap.** `greythr.ts`, `peoplestrong.ts`, `pyjamahr.ts`,
`zappyhire.ts`, `zimyo.ts` — all fetcher-verified live, same discipline as
before. **PeopleStrong is the big one**: Aditya Birla Group (~2,444 live
India roles) and **Larsen & Toubro** (`larsentoubrocareers.peoplestrong.com`)
— the "Known gaps" section below has said L&T core was "still genuinely
unreachable" since early in this project; that's no longer true, it has a
real public PeopleStrong board. Also added: DS Group, Akasa Air,
PeopleStrong's own board, HDFC Life/Zuventus Healthcare (real boards, 0
roles right now), Manipal Finance Corp. Other 4 platforms: greytHR (Way.com
India, SAAHAS, Buildout Retail), PyjamaHR (Born West — a real
`min_experience:0, max_experience:2` fresher SWE role — PyjamaHR itself,
eDataBae), Zappyhire (itself, Wuerth India, SE-Mentor), Zimyo (only its own
board — every other customer's `org_id` is opaque and unenumerable, would
need to be captured from a live board's embed code same as a Workday site
slug). One real bug caught during build: Zappyhire's Elasticsearch backend
sorts jobs with no date to a sentinel (`-9223372036854776000`) that's
outside JS `Date`'s valid range — a naive `new Date(sort[0])` throws
`RangeError: Invalid time value` on page 2+ of any board large enough to
have missing dates. Fixed with a bounds check before constructing the
Date; **if another adapter ever epoch-converts an ATS's own sort/rank
field again, guard it the same way, don't assume the API's numbers are
always in `Date`'s ±8,640,000,000,000,000 ms range.**

Skipped, not buildable: **HROne** (opaque ~200-char per-org tokens, no
derivable pattern, no customer example found — not "hard," genuinely no
path in). Tier 2 confirmed dead ends this round: factoHR, ZingHR, Spine HR
Suite (all vendor-internal-dashboard products, no hosted public boards
exist for any customer), Avature/PageUp/Ceridian Dayforce (real platforms
with public portals, but no anonymous API confirmed and no strong India
example — would need a session-bearing follow-up pass to be worth it, not
worth it blind).

**7 new ATS adapters built (rounds 13/15), 44 companies added (round 14),
all fetcher-verified against live boards, not just against freebuff's
notes.** `npx tsc --noEmit && npm test` pass. New fetchers: `trakstar.ts`
(RSS feed, one call, no pagination), `icims.ts` (JSON API, page+limit),
`workable.ts` (widget JSON list + HTML enrich for description),
`zohorecruit.ts` (parses a JSON array embedded in a hidden `<input>` on the
careers page — `token` holds the full board URL since there's no single
subdomain pattern), `keka.ts` (simplest of the seven, one unauthenticated
GET), `freshteam.ts` (list page's `data-portal-title` attribute is a
lowercase slug, NOT the real title — the real title is a sibling
`.job-title` div's visible text, both pulled in one regex pass; JSON-LD on
detail pages for description via `enrich()`), `recruiterflow.ts` (job list
is a `window.jobsList = {...}` JS object literal embedded in the page,
extracted with a balanced-brace scan, not a regex terminator guess).

**iCIMS turned out much rarer among Indian employers than expected** — a
~20-company probe across large India-GCC employers found zero besides
DocuSign and iCIMS's own board. Built anyway since DocuSign alone (58 India
roles) justified it, but don't expect this platform to pay off further
without a new lead.

**A re-check pass after the initial 42 found a real bug and closed 2 loose
ends.** The bug: the hourly bot's own `discover.ts` sweep independently
found the same American Express and Akamai Oracle tenants right around the
same time, auto-adding them under raw-token stub names ("Egug", "Fa Extu
Saasfaprod1") — same `ats`+`token` pair as the two I'd just added under
real names, which would have polled the identical board twice and shown
the same postings under two different company names in the digest.
Removed the stub duplicates. **Worth checking `ats`+`token` for collisions
any time a manual addition might overlap with something `discover.ts`
could plausibly find on its own** — Oracle tenants especially, since their
tokens are opaque and get picked up incidentally. The 2 loose ends: Keka's
Solarium (freebuff only said "board live, small," no evidence — verified
live myself, 2 real jobs, added) and Recruiterflow's Omnify (confirmed
genuinely empty board, added anyway per the same "real board, nothing to
alert on yet" precedent as BharatPe/Ather/Rapido). Naukri RMS's
unreachability was NOT runner-specific — retried from this machine too,
same connection failure, so it stays unbuilt.

**Zwayam — partially resolved 2026-08-19, still not built.** The domain is
reachable now (it wasn't before — genuinely a transient network issue, not
a permanent block): a plain `curl` to the root times out, but real paths
respond normally. Found Loadshare's actual careers page
(`careers.loadshare.net/loadshare/`), but it's an Angular SPA — the real
API call to `public.zwayam.com` isn't visible in the static HTML, and ~13
reasonable endpoint-shape guesses (`/api/jobs`, `/widget/{tenant}/jobs`,
etc.) all 404'd. This genuinely needs a browser's Network tab, not more
curl guessing — low priority anyway, only one known example.

**CIBC — resolved 2026-08-19, deliberately not added.** The 406 was
real-browser-header-only, same class as Darwinbox's Cloudflare fingerprint
issue: a `curl` with a normal `User-Agent` gets a clean response, no code
change needed. The site slug was never a guessable name — it's literally
`search` (found via `siteId: "search"` embedded in the careers page's own
JS config, not discoverable by guessing common site-name patterns).
Fetcher-verified against the real board: 302 jobs, all Canada-focused
(Toronto, Saskatoon), **zero India roles**. CIBC India hiring runs through
`talent500.com/cibcindia` instead — a GCC talent-marketplace platform this
project has no adapter for, not Workday. Not adding the Workday board
(polling 302 irrelevant roles hourly for no real payoff); if CIBC ever
comes up again, the technical blocker is gone but the real lead is
Talent500, not this tenant.

**Optiver has an India office after all — the earlier "no India office"
finding checked the wrong tenant.** `probe.ts` (candidates.txt already had
this) found a second, different Optiver Greenhouse board (`optiverus`,
distinct from the previously-checked `optiverprivate`) with 177 jobs
including 4 real Mumbai roles (Data Center Engineer, Lead Quantitative
Engineer, Network Engineer, Head of Execution Technology). Added.

**Excluded from the 42 despite a live, evidenced board** — same
service-based-IT/BPO category test as Accenture, or a data-quality problem,
not an oversight: Tenthpin, Frontline Managed Services, Indium Software,
Blue Altair, Interscripts, Zyphra Tech Solutions, Gravitix Tech Solutions,
FPT India (all service/staffing-model businesses), CHi Networks and Codvo
(ambiguous naming, excluded conservatively without stronger evidence),
Wishup (its own business model is VA-staffing-as-a-service, same category
even though its internal hiring didn't look like it), Side/Sidequest (real
board, but the roles found were evergreen "Talent Pool" placeholders, not
distinct openings). `config.ts`'s `SERVICE_COMPANIES` regex already has
"accenture" — worth extending if any of the clearly-major names above
(Indium Software, FPT) recur enough to be worth a permanent runtime
safety net rather than just being left out of `companies.json`.

**Freebuff round 12, source was a referral-site catalog (reffido.com), not a
sector sweep.** Diffed reffido's 460 companies against `companies.json`
locally first (no model needed — plain script), 160 were missing, filtered
to 147 real candidates (dropped 10 IT-services/BPO firms per the standing
exclusion policy, 3 already-known-unreachable). freebuff researched all 147;
fetcher-verification against `src/fetchers/*.ts` caught it hallucinating
tenant tokens for **Wayfair, Revolut, Rippling** (all 404 on the real API)
and over-counting **Verizon** (its "77 India roles" was Indiana, US matching
the substring "India" — zero real India roles). None of those four were
added. **4 added, fetcher-confirmed real**: American Express (Oracle Cloud
HCM), Nasdaq (Workday), Akamai (Oracle Cloud HCM), Eaton (Eightfold).
Meesho and Jio/Jiostar came back too but were already tracked.

**Accenture — decided, excluded.** Its India board
(`accenture.wd103.myworkdayjobs.com/AccentureCareers`) is real,
fetcher-confirmed, thousands of India roles — but it's a mass-hiring
IT-services/consulting firm, same category as TCS/Infosys/Cognizant/Wipro/
HCL. Not added. See "The user" above — the exclusion is now stated as a
category test, not a fixed list, specifically because of this case.

**CIBC India** — Workday tenant confirmed to exist (`cibc.wd3.myworkdayjobs.com`,
Cloudflare-fronted), but the site slug (the `/wday/cxs/cibc/{site}/jobs` path
segment) wasn't recoverable from a handful of common guesses or a plain
`curl` of the base host (406, needs real browser headers). Not worth
chasing further with basic requests — same class of problem as FarEye's
Darwinbox hash, low priority to revisit.

The rest of the 147 resolved to platforms with no adapter here (Docusign,
D.E. Shaw, NetApp, Nokia, Siemens, Zoho, Tesla, and others — mostly custom
in-house portals) or came back genuinely UNVERIFIED (no India presence:
Box, Shopify, GitHub, Gusto, Hulu, Audible, Geico, Abnormal AI, Two Sigma, X,
Indeed). Full detail in the scratchpad's `freebuff-report-12.txt`.

Researching ATS credentials for ~45 well-known Indian unicorns/startups
(Zerodha, Zepto, Ola, Zoho, boAt, ...) that are real 15-40 LPA fresher
employers but weren't turned up by `detect`/`probe`/`bulk-import` — those
tools only reach Greenhouse/Lever/Ashby/SmartRecruiters/Workday/Oracle
automatically, and most of this list runs Darwinbox, TurboHire, or a
custom in-house ATS, none of which are derivable from a domain name.

**Resolved (2026-08-18): the 25-CONFIRMED list above was re-verified by a
freebuff round and fetcher-checked against `src/fetchers/darwinbox.ts` before
touching anything.** Of the named ones, ClearTax, BigBasket, Licious, Porter,
Spinny, Ather Energy (`atherenergy`, already correct), Lenskart, Urban
Company and Khatabook were **already in `companies.json`** — this paragraph
was stale, not a real gap. Only three were genuinely missing and got added:
**BharatPe** and **Rapido** (both real Darwinbox boards, 0 open roles right
now — same "nothing to alert on yet" precedent as Ather), and **Upstox**
(migrated off its old dead Lever board onto Darwinbox, tenant `upstox`, 9
live roles, fetcher-confirmed). **Vedantu's Darwinbox tenant is dead** —
`{"status":...}` with a non-array `data`, our own fetcher throws
`batch is not iterable` — not added, don't re-chase without a new tenant.
Full freebuff report: `freebuff-report-13.txt` in that session's scratchpad.
The rest resolved to platforms
we don't have adapters for (CoinDCX/MakeMyTrip/ShareChat/Nykaa/Practo custom
in-house; Dream11/MobiKwik/PolicyBazaar on Trakstar Hire; CoinSwitch on
Recruiterflow) — **not worth building a new adapter for a single company**,
skip unless a pattern emerges across several.

**Still unresolved after two research passes**: Udaan and Vedantu have real
Darwinbox tenants but the public URL redirects to Microsoft SSO login rather
than showing listings. Upstox's old Lever board 404s (migrated off it).
Zepto, Myntra, Blinkit, Zerodha, Ola, Ola Electric, Oyo, and Darwinbox (the
company itself) all came back UNVERIFIED — no ATS found, or a client-rendered
SPA with no extractable titles, or (Oyo specifically) `oyo.darwinbox.in`
resolves but is a **different real company** ("MPOWER") — the exact
wildcard-domain trap this doc already warns about elsewhere.

**Third pass in flight now, on an external tool ("freebuff"), 5-hour budget.**
Full prompt saved at
`…\98fea03f-f366-420e-94f7-fd9e8295d247\scratchpad\freebuff-prompt.txt`,
output expected at `…\scratchpad\freebuff-report.txt` in the same folder —
read that file directly once it exists, don't ask the user to paste it. The
prompt is split Part 1 (retry the unresolved list above, ~3h) / Part 2
(deepen 8 already-confirmed finds with more evidence, ~1h) / Part 3 (23
fresh companies not yet touched — Jupiter, Cashfree, Juspay, Acko, upGrad,
PhysicsWallah, Tata 1mg, PharmEasy, and others, ~1h). **When it lands: verify
every claim against our own fetchers before touching `companies.json`** —
same discipline as every other addition this session, a resolved tenant is
not proof of the right company (see the IBM-tenant note in
ADDING-COMPANIES.md §4d).

**Why BigBasket — and it turns out PhysicsWallah, Porter, Licious, Tata 1mg,
PharmEasy, Subex, LeadSquared too — got auto-dropped: solved, don't
re-investigate.** All eight were on Darwinbox, all evicted by
`DROP_AFTER_FAILING_DAYS` within days of each other. Tested the exact same
adapter and tenant by hand afterward — PhysicsWallah returned 106 live jobs
immediately. The boards were never dead, only unreachable from GitHub
Actions (almost certainly a Cloudflare block on the runners' shared IP
ranges). Fixed: `src/outage.ts`'s `detectOutage()` now recognizes "most of
one platform failed this run" as a suspected outage and withholds eviction
for boards on that platform, rather than treating each as an independent
per-company death. Covered by the `outage detection` block in
`src/selftest.ts`. **This means it's now safe to re-add all eight** — the
mechanism that ate them is fixed, not just the individual boards.

**Correction to carry forward**: an early draft of the research prompt
claimed a working Keka adapter. **There isn't one** — `src/fetchers/` has no
`keka.ts`. If a company resolves to Keka, record the credentials but treat
it as a new-adapter candidate, not a drop-in add.

## Decisions that aren't obvious from the code alone

**"New" means new-to-tracker, not newly-posted, and that distinction broke
things twice.** A company being added, or a board recovering from errors,
makes its whole backlog look "new" at once (measured: 573 of 1,101 dated roles
were 30+ days old on one sample day). First fix: gate the email on posting
freshness (`EMAIL_FRESHNESS_DAYS` in config.ts). That fix was itself wrong —
it silently dropped backlog roles from view entirely, because `data/jobs.json`
is the only other place they go and nothing reads it pre-deployment. Real fix:
backlog roles still email, just demoted to a low-key section in `email.ts`
(`backlogSection`). **Lesson: before gating anything out of the only
user-visible surface, check whether there's actually a second surface, or
"gated" is just "deleted."**

**Per-industry seniority vocabulary, not one global list.** "Associate" is
junior at a bank, mid-senior at a tech company. "Analyst" is entry-level in
banking/consulting, often mid-level in tech. Each `Company.industry` picks a
vocabulary in `classify.ts`. `UNIVERSAL_SENIOR` holds terms that mean senior
*everywhere* (senior, staff, principal, distinguished, head, mgmt, supv, ...) —
grown incrementally every time a real leak surfaced.

**Role-family regex is broad on purpose; junk gets carved out via
`HARD_EXCLUDE`, not by narrowing the family match.** `swe` bare-matches
`\bengineer\b`, `data` bare-matches `\bscientist\b` — necessary for coverage,
but it means industrial/pharma GCCs (Thermo Fisher, GE Vernova, Baker Hughes)
leak mechanical/refrigeration/wet-lab titles through. Fix each leak by adding
a specific exclusion phrase, same pattern already used for `sales|marketing`.
Don't narrow the family regex itself — that loses real matches elsewhere.

**Storage discipline is load-bearing, not decoration.** Git stores a full copy
per commit. `state/seen.json` (~9MB, ~150K IDs) is cache-only, never
committed — a `.gitignore` entry alone wasn't enough, it was already tracked
from the first commit and had to be explicitly `git rm --cached`. The
catalogue (`data/jobs.json`) lives on the orphan `data` branch,
force-pushed as a single commit every run specifically so its history never
grows — it's derived/regenerable data, keeping years of hourly snapshots has
zero value. `CatalogEntry` deliberately does NOT `extend Job` — `Job.text`
(job descriptions) would have made the catalogue 4x larger for no reason
anything downstream reads.

**Company dedup is by canonical display name, not by token.** Growe runs two
separate Greenhouse boards (`growe`, `growetalents`) with genuinely
overlapping-but-not-identical postings. Fix was renaming both entries'
`name` field to the same string so the existing per-company dedup key
collapses true duplicates while keeping each board's unique postings. If you
see the same real company under two different names in the catalogue, this is
the fix — not a special case in the dedup logic.

**Scale is bounded by `seen.json` and by per-host rate limits, not by runtime.**
Both were fixed together, and both are load-bearing if the board count keeps
growing:

- `seen.json` used to record *every* posting, including the ~93% that fail
  location/role screening and could therefore never alert. Screening before
  recording cut it from 167,194 IDs to 12,151 (measured: **7.3% pass**), i.e.
  9.7 MB → ~0.7 MB. This matters because the Actions cache stores one copy per
  run: at ~105 MB it would evict itself within days and drop the run into a
  permanent cold start. If you ever add a filter that runs *after* screening,
  don't move it before — the 93% must stay unrecorded.
- A single global `CONCURRENCY` is the wrong shape. ~70% of boards are
  Greenhouse sharing one API host, and Workday tenants cluster on pods (wd5
  alone hosts 93), so nine "global" slots could all land on one pod — and did,
  producing dozens of 429s in a single run. Scheduling per *rate-limit domain*
  (`HOST_CONCURRENCY`, pod-aware for Workday) took that to 8 errors while
  *raising* throughput, since domains now run in parallel. **Raising a global
  concurrency number would make rate limiting worse, not better.**
- 429/503 retry with backoff. Without it a throttled board is indistinguishable
  from a broken one, so `recordFailure` starts the `DROP_AFTER_FAILING_DAYS`
  clock and quietly evicts healthy companies three days after a bad burst.

**The email gate is `new_count`, and it must track whether the email was
actually written.** `out/` is gitignored, so it is empty on every fresh runner.
`index.ts` skips writing `email.html` on a cold start, but used to still report
`new_count > 0` — pointing the workflow's send step at a file that does not
exist. That is the "no email arrived even though roles were found" failure, and
it is invisible locally because a local run has an `out/` directory lying around.

**A missing role family is invisible, and it looks exactly like "there's
nothing to send."** The user reported sparse emails and specifically Target
(already tracked) not showing an obviously-real job they'd seen on LinkedIn.
`npm run debug` looked clean because it hardcoded `.slice(0, 25)` — it was
quietly hiding 58 of Target's 83 India roles, including the fact that 48 of
them were being dropped on `role family`, not seniority. Removed the slice;
`debug` now prints every role plus a reason tally. Measuring the same drop
across the 12 highest-India-volume boards found 830 of 1,969 India roles
(42%) had no family at all — not senior, not irrelevant, just uncategorized.
`ROLE_FAMILIES` gained `product`, `design`, `security`, and `swe`/`finance`
both widened (VLSI/embedded terms for the semiconductor GCCs; `advisory`,
which alone was 235 of the dropped titles at KPMG/PwC). Widening a family
only makes a role *visible* — `classify.ts`'s per-industry seniority rules
still gate it, which is why `product` doesn't flood the inbox with "Product
Manager." The widening did pull in consulting back-office work through
finance's junior "Analyst"/"Executive" titles (`HARD_EXCLUDE` gained
`employee vetting`, `executive assistant`, `accounts payable`, etc.) — **if
you widen a family again, re-run the same kind of `role family` tally on a
few high-volume boards before shipping, because the junk always slips in
through the industry's own junior-seniority words, not through the family
regex.**

**A subagent tried to open a Cloudflare bot-check page in the in-app browser
pane and the pane's Chromium process crashed** (GPU/canvas-heavy Turnstile
rendering, ~380MB memory spike in 3s, per the crash's own account when
resumed and asked). This happened specifically while researching Darwinbox
tenant credentials for Indian unicorns — Darwinbox is Cloudflare-fronted
(see the TurboHire/Darwinbox note below), so any future agent doing this kind
of research should be told up front: **no in-app browser tool for this kind
of lookup, text-fetch only, and mark a bot-gated page `UNVERIFIED` rather
than trying to push through the challenge.** Cost two agent runs before the
guardrail was added to the prompt.

## The recurring bug class — watch for this specifically

**`'\bfoo\b'` in a plain JS/TS string literal is `<backspace>foo<backspace>`,
not a regex word boundary.** It needs `'\\bfoo\\b'`. This shipped at least
three separate times in this project (the India/Indiana regex, the RME
exclusion, the HVAC/biopharma exclusions) — each one silently made the
pattern match nothing, and each one only surfaced because `npm test` was run
immediately after. **Any time you add a `\b`-containing pattern as a bare
string (not inside `/…/` regex literal syntax), double-escape it and run
`npm test` before considering the change done.**

**`new Date(x).toISOString()` throws `RangeError` instead of returning
something falsy, whenever `x` doesn't resolve to a real date** — an
out-of-range epoch number (a sentinel like `-9223372036854776000` an ATS
uses for "no date") or a garbled string both hit this the same way. Shipped
once for real in `zappyhire.ts` (silently evicted every tracked board on that
platform as "dead" — see the outage-detection section above), found
proactively a second and third time in `eightfold.ts` and `darwinbox.ts`
before either shipped broken. **Any time a fetcher constructs a `Date` from a
field the ATS's own API controls (not your own code), guard it —
`Number.isNaN(date.getTime())` before calling `.toISOString()`, or check the
value's magnitude before multiplying into milliseconds — and add a
`selftest.ts` case for it, the same way `epochToIso`/`safeIso` are covered.**

## Git workflow — this is not optional context

The `hunt.yml` workflow's "Commit board list" step pushes to `main` on
**almost every hourly run** (board `failingSince` timestamps flip constantly).
Your local branch WILL be behind within an hour of any session start.

Standard sequence for every change in this project:
```bash
git add -A && git commit -m "..."
git fetch origin && git merge origin/main -m "Merge remote board-list updates"
npx tsc --noEmit && npm test
git push origin main
```
If push is rejected (`fetch first`), the bot committed again mid-session —
just repeat fetch/merge/push. This happened multiple times in one sitting and
is completely normal, not a sign of concurrent editing by a person.

`companies.json` merge conflicts are common and almost always trivial (both
sides only add/toggle `failingSince`) — a normal `git merge` resolves them
without intervention nearly every time.

## Known gaps, deliberately not fixed — see ADDING-COMPANIES.md for detail

- **Google, Meta, Uber, Walmart**: fully client-rendered, no reachable API even
  headless, for Uber/Walmart. (Google/Meta were solved via headless rendering —
  check ADDING-COMPANIES.md §1 for current status before assuming still blocked.)
- **SuccessFactors** — SOLVED (`src/fetchers/successfactors.ts`). The search
  *results page* is server-rendered HTML, but both SF variants publish a
  credential-free XML feed alongside it: Career Site Builder tenants (SAP,
  Volvo, ZF, Mahindra) serve `{host}/sitemal.xml`, a Google-Merchant RSS feed
  with a real `g:location` field; legacy Recruiting Management tenants (HSBC)
  serve `{host}/career?company={code}&career_ns=job_listing_summary&resultType=XML`
  but carry no location field at all, so location is recovered by regex-matching
  India city names against the title+description text — a job only gets a
  location when that actually hits, which is deliberately conservative (no
  location field → excluded, not guessed). Both feeds are unusually slow
  (30-170s per company, roughly proportional to total job count), hence the
  adapter's own 180s timeout instead of the shared 30s default. `detect.ts`
  can spot a SuccessFactors-powered careers page but still can't auto-derive
  the token/host — that part stays manual, see ADDING-COMPANIES.md.
- **iCIMS** (DocuSign, D.E. Shaw): still open. HTML with no JSON, though detail
  pages do carry a `schema.org/JobPosting` JSON-LD block — same shape of fix as
  SuccessFactors would take (a genuinely new code path), just not built yet.
- **Large enterprises with no detectable ATS on their careers domain** — the
  honest floor of what unauthenticated public JSON endpoints reach; these
  build bespoke portals. Most of the original ~60-name list from placement
  reports (BlackRock, PwC, Morgan Stanley, HSBC, Samsung, Qualcomm, Texas
  Instruments, Mahindra, ...) turned out to be reachable after all — see
  ADDING-COMPANIES.md §4c/§4d for how (mostly: their real tenant just wasn't
  linked from an obvious `/careers` page, so `detect` never found it).
  Still genuinely unreachable: Deutsche Bank, McKinsey, Bain & Company
  (Bain Capital is a different entity, don't confuse them), IBM (three
  Oracle tenants that *looked* like IBM turned out to be unrelated orgs —
  see the evidence-requirement note in ADDING-COMPANIES.md §4d), VMware,
  Walmart, Bosch (the group entity is tracked; most subsidiaries aren't).
  **L&T is no longer on this list** — the core conglomerate resolved on
  PeopleStrong (`larsentoubrocareers.peoplestrong.com`, round 16), tracked
  alongside L&T Technology Services (SuccessFactors, separate entity).

## Useful commands

```bash
npm test                          # regression suite — run after any regex change
npm run debug -- "Company Name"   # shows every role from one board + why it passed/failed
npm run detect -- domains.txt     # resolve careers pages to ATS boards, in bulk
npm run probe -- candidates.txt   # guess board tokens from company names, in bulk
npm run bulk-import -- --bar india   # import + validate ats-scrapers' tenant lists
npm run bulk-import -- --limit 200   # ...sample first; runs weekly in discover.yml
npm run preview                   # render out/matches.json as the actual email HTML
npm run discover                  # manual trigger of the weekly Common Crawl sweep
```

## If the user asks "is everything pushed"

Don't assume — verify:
```bash
git fetch origin -q
git rev-parse HEAD origin/main | uniq -c   # should print "2 <same-hash>"
```
