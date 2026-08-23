# Build phases — post-survey plan (2026-08-23)

Clubs the ~20 MISS features from `docs/FEATURE-SURVEY.md` into six phases,
ordered by value-per-effort and dependency. Each phase is one sitting's work,
ends green (`npx tsc --noEmit && npm test`), and ships alone. Numbering
continues the mental model of ROADMAP.md's old 12 stages; stages 2/4
(Telegram/Discord) stay deferred per user decision.

## Phase A — Signal quality (deterministic classification)

The three features that make every future alert smarter. All regex/
bookkeeping — no new surfaces, all covered in `selftest.ts`.

1. **Salary extraction** (#38) — parse ₹ LPA / CTC / stipend / K-monthly
   formats out of title+description into normalized `salaryMin`/`salaryMax`
   (₹ LPA). Put on email cards + web UI cards. Extend `HARD_EXCLUDE` for
   unpaid/ commission-only junk this surfaces.
2. **Repost detection** (#28) — track ids that leave `liveIds` then return;
   alert again flagged "reposted". Bounded memory: only remember ids for a
   rolling window (e.g. 30 days) in the existing state-file pattern.
3. **Visa-sponsorship + work-mode normalization** (#42/#43) — deterministic
   keyword pass ("visa sponsorship", "remote" scope) into typed fields so the
   email/UI can filter on them later.

Why first: pure signal gain, zero infra risk, directly improves every email.

## Phase B — Silent-failure defenses (self-healing)

The autopsy's #1 lesson: projects die of unnoticed breakage. This phase makes
quiet rot loud.

4. **Per-board volume anomaly detection** (#96) — append per-board posting
   counts to a rolling history file (same pattern as `state/host-stats.json`);
   when a board drops sharply below its own baseline (e.g. >80% below median
   of last N runs, minimum sample size), open/close an auto-issue exactly like
   outage.ts does.
5. **Expected-vs-actual reconciliation** (#98) — assert polled-board count vs
   selection count each run; warn on shortfall (catches partial workflow
   failures adgramigna built compare_workflow_success.py for).
6. **Cross-board content dedup** (#25) — title+location hash collapse across
   companies' boards so multi-posted reqs alert once, labeled.

## Phase C — Web UI depth (client-side only, no backend)

Everything over the existing `data/jobs.json`, static-hostable as today.

7. **Faceted filters** (#64) — seniority, role family, work mode, salary band
   (feeds from Phase A fields), experience range.
8. **URL-state sync + shareable views** (#65) — filter state in query params.
9. **Exclude-keyword filter + saved/applied localStorage marks** (#45/#80 thin
   version) — personal junk list without touching server config.
10. **Company pages** (#69) — active/last-30d counts per company, generated
    statically at catalogue push time.
11. **Recency sort within sections** (#53) + CSV export flag on `query.ts`
    (#76). Small finishers.

## Phase D — Trend intelligence

Needs Phase B's history files as input.

12. **Hiring-velocity trending** (#54) — month-over-month posting-count delta
    per company; surface "ramping" companies in the email footer or a weekly
    section even when no single posting is new.
13. **Salary trend aggregates** (#39 partial) — median offered band per role
    family per month, from Phase A's extracted salaries. Answers "is the
    market moving" for the fresher segment.
14. **Cert/skill demand analytics** (#47) — aggregate keyword frequency over
    the JD corpus; optional, fun, cheap once histories exist.

## Phase E — Interfaces (only if wanted)

15. **MCP server over the catalogue** (#73) — wrap `query.ts`'s filtering in
    read-only MCP tools; makes the corpus usable from any AI client.
16. **Public REST API** (#74) — same core behind HTTP if ever hosted beyond
    Vercel-static.
17. **Dataset publication** (#105) — the `data` branch already exists; add a
    daily Parquet/JSON snapshot job only if external users become real.

Trigger for starting E: the user asks for agent access or an audience forms.
Not before.

## Phase F — Deferred by user decision

Telegram bot channel, Discord/Slack webhooks (old stages 2/4). Code stays a
small, isolated sender module whenever activated; nothing else depends on it.

## Explicitly not phased (rejected classes, unchanged)

Proxies/CAPTCHA solving, login-based scraping (LinkedIn/Indeed/Upwork),
auto-apply bots, resume generation, Airtable/Sheets service backends, curated
list maintenance. See FEATURE-SURVEY rejected items and ROADMAP's rejected
section.

## Sequencing logic

A → B because extracted fields make anomaly baselines richer; B → C/D because
UI facets and trends both consume histories/fields; E and F are opt-in. A and
B together are roughly two sessions; C is the biggest single chunk and can be
split (7–8 then 9–11) without harm.
