# Continuous worker and question-answer audit

Audit date: 12 November 2026. Local code and read-only state inspection were combined with primary-source web research. Resume and form-answer changes are being handled in the parallel Terra chat. This report records the independent lifecycle and evidence work.

## Is the infinite runner reliable?

It needed corrections. The previous continuous drain exited on an empty queue,
performed discovery only once, used a duplicated `portal-review` stop path,
and could repeatedly cycle through cooled-down jobs. The supervisor deleted
worker and browser locks before restarting, matched unrelated process command
lines, and retried crashes every five seconds without backoff.

The revised drain polls idle queues, refreshes discovery on its existing
55-minute cadence, honors the stop file inside the configured queue directory,
and stops accepting new work on termination signals. It respects tenant cooldowns
without a fallback chunk that ignores readiness. Active lane slots are released
for other provider lanes instead of permanently excluding higher lane indices
when RAM allows only one lane. Browser-job starts have a per-batch budget.
Worker lock publication is exclusive, and unreadable locks fail closed.

The supervisor is restricted to one instance per repository through a Windows
named mutex, detects the worker through its lock owner or exact project script,
starts hidden windows, and applies bounded restart backoff. It no longer removes
worker or browser locks. `-CheckOnly` is read-only.

A zero-application drought no longer enables permissive submission, resets
server backoff, kills browsers, or deletes live profile locks. Diagnostics read
actual `finishedAt` values and require `receiptVerified` for applied counts.
Chrome reaping is limited to descendants of the current worker; active browser
and job trees, personal profiles and other workers are excluded. Global temporary
browser directories and system-wide working-set trimming are no longer touched.
Cache cleanup validates resolved targets remain inside the selected root.

Narrative reason strings no longer manufacture applied status or receipt proof.
Importing run-history no longer rewrites historical state. The drain requires an
observed receipt object. Power/network recovery preserves interrupted evidence
and parks uncertain outcomes, rather than promoting confirmation-looking URLs
or replaying possible submissions. Startup resets no longer release arbitrary
company reviews or reset retry counts to zero. Only bounded, known browser-launch
failures are eligible for automatic startup retry.

These are local source changes, not a production rollout. The supervisor status
snapshot found no matching worker. No worker or supervisor was started or restarted,
no live application or outreach was sent, and no production queue migration was run.
Historical false receipt promotions were not reversed without independent evidence.

## Do we have answers to every question?

No. A read-only snapshot found 234 actual question entries in the historical
unknown-field ledger, including 229 marked required. The profile had two legacy
QA-bank entries and 40 scoped answers. Semantic memory had 248 rules, including
15 with stored confidence below 0.85. These counts are not independent sets and
must not be added together to calculate coverage.

An offline replay of those 234 labels through the current deterministic classifier
and answer resolver, without model calls or printing candidate answers, returned:

| Replay result | Question entries |
| --- | ---: |
| Answer with a fact-key reference | 108 |
| Answer without a fact-key reference | 7 |
| Unresolved | 119 |

This snapshot was taken while Terra was correcting the answer code. It is not a
live-form pass rate or an assertion that every fact reference is correct. The
ledger includes stale labels and known fields such as names and emails. File
uploads, widget commits, dependent questions, employer scope and language variants
need separate validation. Missing questionnaire context can make a replay unresolved
even when an underlying profile fact exists.

Recurring labels include French/English proficiency, ERP experience, desired and
current compensation, relocation, visa sponsorship and legal work authorization.
Some have answerable aliases; others require actual candidate facts or preferences.
A model can improve interpretation of a supplied fact but cannot discover an
unsupplied salary, consent or employer-specific history. No unknown personal
answers were invented during this audit. Terra was given the concrete unsafe
salary/notice/experience defaults and arbitrary checkbox/option fallbacks to fix.

## What recent execution evidence says

The latest 200 run-history records contained 17 marked applied, 108 failed,
44 paused and 31 skipped. Ninety-three had `Job timed out or runner closed`.
Other frequent outcomes were 27 CAPTCHA deferrals and 26 validation/field reviews.
The latest sampled event finished at `2026-11-11T18:18:27.917Z`.

Those are telemetry labels, not independently audited receipts. Previous code
could promote reason strings to applied/receipt-verified status, so 17/200 must
not be advertised as a verified application success rate. Timeout diagnosis and
independent receipt reconciliation matter more than claiming every field filled.

## Research and open-source findings

| Primary source | Finding and application here |
| --- | --- |
| [WebArena](https://arxiv.org/abs/2307.13854), ICLR 2024 | Evaluates functional task completion in realistic, reproducible environments. Its historical benchmark score is not a current performance claim for this applier. Measure completed workflows rather than successful clicks. |
| [WorkArena](https://proceedings.mlr.press/v235/drouin24a.html), ICML 2024 | Enterprise workflow benchmark with BrowserGym. Use representative multi-step fixtures, not only isolated selector tests. |
| [BrowserArena](https://arxiv.org/abs/2510.02418), 2025 | Uses live-web tasks and step-level feedback to expose brittle navigation, pop-up and challenge behavior. Keep step traces for timeout diagnosis. This does not establish universal CAPTCHA support. |
| [WebArena-Verified](https://github.com/ServiceNow/webarena-verified), available through Docker/uvx in February 2026 | Audited tasks, deterministic typed evaluators and network-trace replay replace loose substring matching. Apply that principle to receipt proof, retained upload identity and reproducible ATS fixtures. |
| [AgentLab](https://github.com/ServiceNow/AgentLab) and [BrowserGym](https://github.com/ServiceNow/BrowserGym) | Open-source evaluation tools. Borrow reproducible evaluation discipline; installing their entire stack is unnecessary for the existing TypeScript runner. |
| [Browser Use](https://github.com/browser-use/browser-use) | Typed results, explicit upload paths, domain controls and scoped secrets are useful implementation patterns. The README distinguishes library/cloud capabilities and states that challenge avoidance or solving is not guaranteed. No cloud service was installed or enabled. |
| [Conformal abstention](https://arxiv.org/abs/2405.01563), 2024 | Studies calibrated refusal to answer under uncertainty. Our inference is to preserve a review outcome for missing candidate facts. A hardcoded confidence score is not a calibrated correctness guarantee, and this code does not implement the paper's statistical guarantees. |
| [BullMQ idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs), [graceful shutdown](https://docs.bullmq.io/guide/workers/graceful-shutdown), and [Temporal retry policies](https://docs.temporal.io/encyclopedia/retry-policies) | Separate retryable infrastructure work from non-idempotent external submission; stop new work and preserve active-job state. Apply these principles in the existing SQLite design without adding Redis or Temporal. |

These sources support specific design and evaluation choices. They do not prove
that a single project is the state of the art for all job portals, or that any
system can truthfully answer every possible screening question.

## Verification and remaining boundaries

Focused temporary-fixture tests cover stop responsiveness, receipt provenance,
drought diagnosis, owned Chrome selection, unchanged historical evidence,
concurrent worker lock publication, bounded retry and interrupted-dispatch
recovery. A read-only supervisor check and PowerShell parsing were performed.
Eight new lifecycle tests and four existing focused regressions passed. Production build type checking passed, and scraper self-tests reported all checks pass. Final results were also sent to Terra for its handoff update.

Live long-duration behavior, Windows restart behavior under a real crash, and
historical receipt reconciliation were not exercised. The changes do not restore
missing candidate facts. Terra remains responsible for resume parity, uploads,
answer grounding, seven-source freshness and offline browser workflow acceptance.
