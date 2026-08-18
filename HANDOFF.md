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
- **The web UI (`web/`) is built but NOT deployed to Vercel yet.** This matters —
  it's why the email backlog section exists (see below). Deploying it is an
  outstanding step: `vercel.com/new` → import repo → Root Directory `web` →
  env var `NEXT_PUBLIC_REPO` = `smresponsibilities/jobscraper_hourly`.
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

## In progress — pick up here

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

**Zwayam identified but not built** — its API lives on `public.zwayam.com`,
unreachable from the research runner (connection failures), so the response
shape was never confirmed. Only one known example (Loadshare) anyway. Retry
from a different network if it comes up again, otherwise leave it.

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
