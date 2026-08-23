# Roadmap

Plain-text version of the roadmap for agents that can't render the HTML
artifact — same content, checklist format. Human-readable version with the
comparable-project tables lives at the published artifact (ask the user for
the link, or see `HANDOFF.md` for where it's linked from).

Survey basis: 38 comparable open-source job-alert / ATS-scraping projects
researched across two rounds (18 + 20), plus this repo's own open gaps in
`HANDOFF.md` and `ADDING-COMPANIES.md`.

## How to read this if you're an agent picking up one stage

Each stage below is meant to be handed to an agent (Claude or freebuff) on
its own. If it's tagged `freebuff: yes`, the prompt handed to freebuff must
still restate full context — freebuff has no memory of this file — per
`.claude/skills/freebuff-delegate/SKILL.md`. If it's tagged `freebuff: no`,
it touches regex correctness, dedup/rate-limit logic, or a bug class this
repo has already shipped once (see `HANDOFF.md`'s "recurring bug class"
section) — do it directly, run `npx tsc --noEmit && npm test` before calling
it done.

## Phases (priority buckets)

| Phase | What | Status |
|---|---|---|
| 0 | Ship what's already built (deploy `web/` to Vercel) | now |
| 1 | Cheap reach & observability (Telegram, outage surfacing, Discord/Slack) | now |
| 2 | Coverage expansion — freebuff-heavy research rounds | next |
| 3 | New adapters (iCIMS, Uber/Walmart) | later |
| 4 | Query surface over the catalogue (CLI) | later |
| 5 | Parked trade-offs (LLM enrichment, multi-user filtering) | parked, revisit only if priorities shift |
| — | Explicitly rejected: LinkedIn/Indeed scraping, browser-extension tracking | not on the roadmap |

## Build order — 12 stages, in sequence

- [x] **1. Deploy `web/` to Vercel** — DONE (2026-08-19). Live at https://jobscraper-hourly.vercel.app/ — verified independently, not just taken on the user's word: the site's own data source (`data` branch's `jobs.json`) fetched directly and confirmed current, including companies added the same day.
- [ ] **2. Telegram bot channel alongside email** — `freebuff: partial` (freebuff drafts the send boilerplate; Claude wires it into `email.ts`'s freshness/backlog gating — that gate broke once before, see `HANDOFF.md`). Blocks stage 4.
- [x] **3. Surface outage detection as an issue/comment** — ALREADY DONE (commit `65ba33b`, predates this roadmap). `hunt.yml`'s "Report suspected ATS outage" step already opens/closes a GitHub issue per platform on `outage_started`/`outage_recovered`. This roadmap line was wrong — written from `HANDOFF.md`'s prose without checking the actual workflow file.
- [ ] **4. Discord/Slack via the same webhook shape** — `freebuff: partial`. Depends on stage 2.
- [x] **5. freebuff round — close out the 25 CONFIRMED-but-unadded companies** — DONE (freebuff round 13, 2026-08-18). Most were already tracked (stale doc); genuinely new: BharatPe, Rapido, Upstox (migrated to Darwinbox), all fetcher-verified. Vedantu confirmed dead (`batch is not iterable`).
- [x] **6. Re-add the 8 auto-dropped Darwinbox companies** — ALREADY DONE, predates this roadmap (commit `97876f4`, 2026-08-17, one day before this roadmap existed). All 8 confirmed present in `companies.json` with real tenant tokens (PhysicsWallah `pwhr`, PharmEasy `myhr`, Tata 1mg `1mg`, etc.) — verified directly via `git log`, not freebuff. All 8 currently share one `failingSince` timestamp (a platform-wide Darwinbox block, same shape as before) — correctly *not* evicted, `outage.ts` holding as designed.
- [x] **7. Platform-parity diff vs kalil0321/ats-scrapers** — MOSTLY ALREADY DONE. `ADDING-COMPANIES.md` §4d is this exact diff, already run, already paid off: KPMG (496 India roles), PwC (328), AMD, ExxonMobil, BASF, Infineon, Microchip, Arista, Continental, Lupin, Bajaj Auto all added from it. This roadmap line was written from `HANDOFF.md`'s summary without checking `ADDING-COMPANIES.md`'s fuller detail — same staleness pattern as 3/6/10/11. Real remaining work is a periodic *refresh* (their CSVs update over time), not a first pass — ran `npm run bulk-import` fresh on 2026-08-18 to check for anything new since §4d.
- [x] **8. Zwayam retry + CIBC Workday site-slug recovery** — DONE, both resolved 2026-08-19 (`HANDOFF.md` has the detail). CIBC: real blocker, real fix — `curl` with a normal User-Agent gets past the 406, site slug is `search`. Board itself is Canada-only (302 jobs, 0 India), CIBC India hiring runs through Talent500 instead — deliberately not added, no code needed either way. Zwayam: domain reachable now (wasn't before), but it's an Angular SPA — needs real browser network inspection to find the actual API, not more curl guessing. Still not built, low priority (one known example).
- [x] **9. Re-check "unreachable" giants** — MOSTLY ALREADY DONE. `ADDING-COMPANIES.md` §4c already re-checked this exact list with real findings, not just "still unreachable": Deutsche Bank's SmartRecruiters tenant confirmed dead (`totalFound: 0`), Walmart's Workday returns an HTML bot-block page not JSON, HSBC's second (Eightfold) tenant 403s, IBM's three lookalike Oracle tenants confirmed to be unrelated orgs. Genuinely still open, never explained this thoroughly: **McKinsey, Bain, VMware** — only "no ATS link found," no confirmed reason. Worth one more real look at those three specifically, not the whole list again.
- [x] **10. iCIMS adapter** — MOSTLY ALREADY DONE, doc was stale again. `icims.ts` already reads iCIMS's real `/api/jobs` JSON endpoint (no JSON-LD parsing needed — that was a leftover premise from before the adapter existed), live-confirmed against DocuSign. D.E. Shaw checked 2026-08-18: their public careers page shows no iCIMS link at all, so the "D.E. Shaw runs iCIMS" assumption is unconfirmed — needs real research to find their actual ATS before any code gets written, not a code task.
- [x] **11. Uber / Walmart via headless render** — ALREADY DONE, doc stale a third time. `companies.json` has Uber on `ats: rendered` with `lastIndiaAt` set (live, finding roles), and Walmart tracked twice already (SmartRecruiters `Walmart30` + Workday `wd504/WalmartExternal`), both polling. Checked 2026-08-18 before starting — do not rebuild.
- [x] **12. Query CLI over `data/jobs.json`** — DONE (`src/query.ts`). `npm run query -- --role swe --company X`, reuses `filter.ts`'s `roleFamily()` — no new backend. Verified working against the live catalogue.

Stages 5–9 are five separate freebuff sessions. freebuff is single-instance
with no cross-session memory — one stage per session, prompt fully restated
each time, per the freebuff-delegate skill.

## Parked — deliberate trade-offs, not oversights

- **LLM enrichment as an opt-in secondary pass** (salary/skills only, never
  replacing `classify.ts`'s deterministic regex core — "every mistake is one
  line in `classify.ts`" is a real, load-bearing property). No comparable
  project found does per-industry seniority vocabulary the way this repo
  does; the closest thing (`rootstrap/ai-job-title-level-classification`) is
  title-only ML with no industry awareness. Confirms the regex approach is
  unusual by design, not by neglect.
- **Per-user / multi-profile filtering** — every comparable project surveyed
  except one small Telegram-bot toy hardcodes a single filter config, same as
  this repo. Only worth building if this project's audience changes from
  "for me."

## Explicitly rejected — don't re-propose without new information

- **LinkedIn/Indeed/meta-search scraping** (the JobSpy/most-Discord-bot
  approach) — breaks this repo's zero-cost, no-scraping, no-proxy identity.
  Batch 2 confirmed this is *also* the fragile path in practice: nearly every
  Discord-bot job-alert repo found scrapes LinkedIn/Glassdoor with
  Cloudflare-bypass hacks rather than reading a public JSON endpoint.
- **Browser-extension application tracking** (Huntr/Simplify-style,
  confirmed as a whole healthy genre in batch 2 — 5+ local-first extensions
  found) — a different product, the "after you found the job" half of the
  funnel, not a discovery-pipeline feature.

## Research addendum (batch 3 — 2026-08-23, 580-repo sweep)

Method: GitHub search across 7 queries (job scraper, job alert bot, ATS/careers
monitor, jobs aggregator), 580 unique repos collected, all triaged by stars,
11 most comparable deep-read: santifer/career-ops (67k★, AI evaluate/CV
pipeline), colophon-group/jobseek (5,300 companies, Typesense facets, MCP,
application tracker), elliottdehn/open-jobs (967K jobs Parquet CC0, LLM
fields + embeddings + Bradley-Terry ranker), outscal/OpenJobs (12,144-company
registry with derived hiring-countries), amikai/openings-mcp (41K-company ATS
roster behind one MCP tool), dchernopolskii/Flare (macOS watcher, repost
labels, detect-and-preview board-add flow), Feashliaa/job-board-aggregator
(1M jobs, per-platform volume anomaly detector opening issues),
adgramigna/job-board-scraper, CarterPerez-dev/exs-cyberjob-scraper (aggregate
stats over postings), kbhujbal/go-get-jobs, SESHASHAYANAN/Liopleurodon.

**Confirms again:** nobody else does per-industry seniority vocabulary, Indian
ATS coverage (Darwinbox/TurboHire/Keka/etc.), hourly cadence (all competitors
daily at best), or platform-outage-aware eviction. Those stay differentiators.

**Gaps it exposes, ranked by fit to this repo's goals:**

1. **Salary extraction from JD text (deterministic)** — open-jobs ships
   `salary_min_k`/`salary_max_k` for every row; we only pass through whatever
   the ATS API happens to include. A regex pass over `text` (₹ X–Y LPA, CTC,
   stipend formats) fits the "every mistake is one line in classify.ts"
   philosophy and directly serves the fresher-compared use case.
2. **Repost detection** — Flare labels jobs new vs *reposted*. A req that
   closes and reopens is one of the strongest urgency signals and we currently
   treat it as permanently seen (`seen.json` one-alert-per-lifetime).
   Cheap version: keep id + firstSeen; if an id vanishes from `liveIds` then
   reappears, alert again flagged as repost.
3. **Faceted web UI search** — jobseek's facet set (seniority, work mode,
   location, employment type) with URL-state sync; Feashliaa's exclude-keyword
   filter and localStorage applied/saved states. All client-side over the
   existing `data/jobs.json` — no backend needed.
4. **Derived hiring-country metadata per company** — outscal derives a
   `countries` array per company by joining postings against a geocoded
   locations table. Would have caught several wrong-company token collisions
   (Porter/Wise/Graviton class) automatically at probe time instead of by hand.
5. **Per-board volume anomaly detection** — Feashliaa opens a GitHub issue
   when a platform's daily count deviates sharply from its baseline. We cover
   *outages* (all-fail) but not *silent partial loss* (board returns 5 jobs
   instead of its usual 200 — e.g. a site-slug change or a cap regression like
   the Workday 300 bug). Natural extension of `host-stats.ts`'s history file.
6. **API/MCP surface over the catalogue** — jobseek (hosted read-only MCP),
   openings-mcp, ever-jobs all expose the corpus to AI clients. Our `query.ts`
   CLI is the seed; an MCP wrapper would be small. Parked unless the user
   wants agent access.
7. **Dataset publication** — open-jobs releases the whole corpus as daily
   Parquet, CC0. If this project ever wants external users, publishing
   `data/jobs.json` snapshots as a dataset costs nothing (the `data` branch
   already exists). Not urgent for a single-user tool.

**Second-pass notes after reading all 130 READMEs individually** (the
numbered list stands; these sharpen or extend it):

- **Cross-board dedup by content identity** (freehire): "the same role posted
  to three boards collapses into one." We dedup by canonical company name;
  a title+location hash across boards would catch multi-board reposting of
  one req. Related: MabudAlam/JobsScraper dedups on a content hash rather
  than the ATS's own id.
- **Hiring-velocity trending** (Hiring-Radar's `--recent-days` + month-over-
  month comparison): a company whose posting count is climbing is ramping —
  worth surfacing even when no single posting is new. The `host-stats.ts`
  history-file pattern would take a per-company count series cheaply.
- **Saved repeatable searches** (BjornMelin's Job Tracker): our filter config
  is hardcoded single-profile (parked decision), but named saved filters over
  `query.ts` would be the thin version.
- **Telegram channels as a source class** (JobMonitor watches Telegram
  channels, delivers via bot): many India fresher-job channels exist. New
  source category for us — but channel reads need a login (Telethon), against
  the zero-login identity. Park unless email-only proves insufficient.
- **Salary normalization** (golang-cafe keeps FX rates to normalize ranges,
  shows regional salary trends) — extends gap #1: extract, then normalize to
  ₹ LPA.
- Reconfirmed noise: the bulk of the corpus is LinkedIn/Indeed/Glassdoor/
  Upwork scrapers, auto-apply bots, resume tailors, and self-hosted job-board
  CMS kits — none applicable. Deprecated/abandoned repos are common even at
  high star counts; `pushed_at` mattered more than stars.

**Autopsy of the dead repos (~45 pre-2020 or explicitly abandoned) — why
they died, and what each death teaches this repo:**

1. **Died of the target site (the dominant cause).** olindgallet/jobscraperv2's
   own changelog names it: "Many of these job search websites now use
   Cloudflare to stop automation" — abandoned March 2025 after trying to
   out-wait rendering with Playwright. kelvinxuande/glassdoor-scraper died of
   Glassdoor's auth wall; every old LinkedIn scraper (kirkhunter 2016,
   nicolomantini 2019, xtstc131) died of login-wall/guest-API removal;
   thayton/casperjs-taleo died of Taleo UI changes. Lesson: this repo's
   anonymous-JSON-API-only identity isn't just philosophy, it's the survival
   trait — there is no private endpoint for a site to revoke or a page layout
   to change under us. Corollary: any future adapter needing headless
   rendering takes on the exact dependency that killed these — last resort,
   which the roadmap already treats it as.
2. **Died of silent breakage nobody noticed.** The scrapers above didn't fail
   loudly; they returned wrong/empty results until the owner lost interest.
   This is the strongest argument yet for gap #5 (per-board volume anomaly
   detection): a board drifting from 200 postings to 5 must open an issue,
   not just log.
3. **Died of hardcoded single-purpose config.** jobscraperv2's own comeback
   plan listed "transition from command line parameters to JSON
   configurations — things like location and position are hard-coded." Same
   for lefnire/jobpig, bbzzzz/Job-Aggregator, austintackaberry/jobsort.
   Lesson: keep `config.ts` the single data-driven brain; never let a filter
   or search param live in scraper code.
4. **Died of framework rot.** wtrevino/django-djobberbase ("incompatible with
   recent versions of Django"), jobskee/joobsbox PHP boards, jobapis/
   collector (Laravel+Algolia+S3 stack). Lesson: the runtime is `tsx` on
   GitHub Actions with near-zero dependencies — keep it that way; every added
   service is a future death sentence.
5. **Died of maintainer time — the baseline cause.** jobscraperv2 again:
   "Just don't have the time." Most common of all, stars notwithstanding.
   Lesson: the self-healing machinery (outage-aware eviction, block holds,
   host-stats history, auto-issues) is not gold-plating — it is what lets a
   solo project survive periods where its author has no time. Prefer more of
   it over more features when in doubt.
6. **Not deaths: pivots and curated-list decay.** KnlnKS pivoted the browser
   extension into a hosted site; curated markdown job lists (pmuens/
   remotework, DevOpsTW/jobs, AndreaBarghigiani/working-remotely) decay the
   moment the curator stops — an automated pipeline has no such failure mode,
   which is the other half of this repo's design paying off.

Rejected again by this sweep, consistent with prior batches: LinkedIn/Indeed
scraping (JobSpy et al. — fragile, against repo identity), auto-apply bots,
resume tailoring (huge genre, different product).

## Research addendum (batch 2 — 20 more projects)

Findings that update or sharpen the original 18-project survey:

- **`ever-jobs/ever-jobs`** is a stronger "what this could grow into"
  reference than `freehire` (batch 1) — 160+ sources, 38 ATS platforms,
  ships REST + GraphQL + CLI + MCP server simultaneously. Worth a closer look
  specifically for stage 12.
- **India-specific job tooling in the wild is Internshala clones or dead
  markdown lists** — nothing does ATS-board polling for this audience the
  way this repo does. Genuine differentiation, not one-of-many.
- **RSS-as-delivery-channel isn't a real gap.** Even RSSHub (45.8k stars, the
  category leader) has zero job-board routes. Safe to leave off the roadmap.
- **No comparable project does per-industry seniority classification** —
  confirms this repo's regex-vocabulary-per-industry design is genuinely
  unusual, reinforcing the "parked, not missing" framing on LLM enrichment.

Full per-repo detail for both survey rounds is in the published HTML
roadmap artifact (ask the user for the link if picking this up fresh).
