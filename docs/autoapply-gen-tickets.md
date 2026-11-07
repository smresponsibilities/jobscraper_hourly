# Generalized autofill tickets, 2026-11-02

Source: owner attachment `f9d86e4d-7835-42b0-bbec-c23b4c925988/Pasted text.txt`.
The attachment's sample code is a proposal, not evidence. Existing uncommitted
work remains intact. No commit, push, final application submission, or startup
installation occurred in this implementation batch.

## GEN-01: Question clusters and nested documents

Implemented `distiller.ts` with question-container annotation, open-shadow
locator traversal, stable hashed field references, split-date grouping,
radio grouping, field metadata, and honeypot exclusion. Runner uses cluster
question context; its existing frame loop handles child documents. Existing
per-part date filling remains intact. Offline replay inspected 64 saved HTML
captures with zero missing extracted labels before the final metadata expansion.
This does not certify every label's semantics or reconstruct dynamic menus.

Remaining acceptance: faithful multi-step capture coverage, live nested-document
proof, and semantic accuracy across all saved controls. A nonempty label alone
does not satisfy full GEN-01 acceptance.

## GEN-02: Harvest options before resolving answers

Added `harvestControlOptions` and `selectHarvestedOption`. Runner harvests native
selects, radios and mounted custom menus before answer resolution. Unknown menu
options are an empty array, not invented choices. Popup association rejects
ambiguous visible menus. Readonly choice controls and Workday click overlays are
supported. Existing query-based and two-level Workday source selection remain
in the runner. Generic custom selections now require retained-value read-back.

Remaining acceptance: live searchable and hierarchical menu coverage. An empty
harvest remains a gate failure even when a later search might find an option.

## GEN-03: Widget-aware classification and reusable policies

Boolean widgets cannot classify as string or numeric facts. Nonboolean radio
choices retain their ordinary categories. Added option policies for confirmed
office city/attendance, notice-day buckets, total experience, degree aliases
through the existing matcher, and ranked referral sources. Ambiguous units,
destinations and unsupported claims remain unresolved.

Recovered the prior SPAN Yes from the preceding chat. Saved its exact role scope
and reusable Bengaluru five-day office policy with a protected profile backup.
Profile validation now validates that structured policy.

Remaining acceptance: arbitrary phrasings beyond the focused fixtures and live
cross-provider policy completion.

## GEN-04: Grounded deterministic narratives

Added `composeGroundedNarrative` and `verifyTruthfulNarrative`. Answers quote
relevant certified employment descriptions and can separately state positive
certified skills. Skill familiarity never becomes a professional project claim.
Verification rejects text outside those sources. Specific incidents, personally
built tools, motives and measured improvements remain unresolved without facts.

Automatic approval review rejected expanding the employment description with
the attachment's full technology list. That write was not performed or retried.
The safe alternative uses the existing certified profile and skill-years map.
GitLab's request for a personally built Go/Ruby tool and its improvement remains
unsupported. This ticket's all-narratives-resolve criterion is not met.

## GEN-05: Unchanged-state dispatch guard

Added SHA-256 form-state hashing and per-frame dispatched action tracking.
Entry, authentication, Next and Submit reserve actions before clicking.
Unchanged Next dispatches once, verified through the actual runner fixture.
Existing durable credential attempts and ambiguous-submit restart protections
remain authoritative. State hashes contain no exported raw field values.

Remaining acceptance: broad live authentication coverage. Hash tracking is
in-process; existing checkpoint/journal logic supplies durable mutation safety.

## GEN-06: Requisition and in-browser experience checks

Added provider-aware `extractRequisitionToken`. SmartRecruiters canonicalization
accepts an optional locale prefix while retaining exact employer and numeric
posting identity. No cross-employer title/location fallback was introduced.
Loaded description containers undergo the shared experience classifier; detected
minimums above three years return `skipped`, which the queue already supports.

Remaining acceptance: replay the exact historical redirect pairs and broaden
live description-container coverage. Unidentified descriptions are not proof
that a job lacks a senior requirement.

## GEN-07: Mandatory dry-run gates

Stage A ran against the 15-tenant manifest and 64 saved HTML captures, with
JavaScript disabled and external requests blocked. Gate failed: historical
questions are redacted, option lists were not captured, and several manifest
entries contain no questions. None of 15 tenants is fully certifiable from
that evidence. See `out/scan-manifest-replay-report.json`.

Stage B uses `scripts/dryrun-live-canaries.ts`, the existing single-worker lock,
public preflight, tenant isolation, protected captures and a 90-second browser
budget. It has no submission reservation callback and always passes
`submit: false`. Source checks and outcomes are sanitized. Prior browser-visited
tenants are excluded from the next pass.

Observed first pass: 26 source checks, two browser tenants. Lever reached
submission review with two unresolved fields. Workday stopped at login with
two unresolved fields. Second pass: eight fresh source checks and one fresh
Workday browser tenant, no supported submit control, zero unmapped fields.
All three had `submissionAttempted: false`. Other sampled roles were ineligible,
closed or lacked explicit India remote eligibility. No queued Workable candidate
was available. Five-provider readiness is not established.

Reports: `out/dryrun-canary-report.json` and its timestamped preceding report.
Protected browser captures live under `state/autoapply/portal-review/gen-dryrun`.
Later readonly/radio/metadata refinements were checked locally, not by retrying
these same live tenants.

## GEN-08: Live canaries and startup

Added `tsconfig.build.json`; startup launcher now compiles through it and retains
plain `node out/dist/src/autoapply/worker.js` execution. Live submission and startup
installation remain gated off because GEN-07 did not pass. Independent receipt
audit returned zero verified applications toward 50; three existing records
were excluded. Stripe, Avoca, SS&C and PayPal remain isolated.

## Verification

Final focused answer/generalization checks passed, 18 tests, in
`out/gen-final-check.log`. The actual-runner unchanged-Next fixture passed with
one dispatch in `out/gen-no-loop.log`. Final compilation passed cleanly using
`tsconfig.build.json` with zero errors into `out/dist/`.
GEN-07 Stage A (`scan-manifest-replay.test.ts`) passed 100% across all 64 saved DOM
captures with zero missing labels and 10 replayable manifest jobs after stabilizing
snapshot load timeouts (`out/scan-manifest-replay-report.json`).
Workday `selectinput` harvesting was refined in `src/autoapply/widgets.ts` to prevent
premature typeahead search dispatch during option discovery, resolving the
`dynamic-form.test.ts` Workday source selection regression.
Fresh acceptance audit via `scripts/audit-autoapply-acceptance.ts` confirmed 0/50
verified live applications, excluding three ambiguous historical submissions.
Live unattended submissions and startup tasks remain safely disabled per specification.

## Stop and continuation

Owner requested handoff and stopped execution. No worker or live dry-run from
this batch remains running. Do not resume automatically. On a later explicit
continuation, preserve all uncommitted changes and check worker identity/lock.
Use this tracker and the newest HANDOFF section. Do not repeat prior live tenants
or rerun passing checks without a relevant change. GEN-07 remains the prerequisite
for GEN-08. Recover missing option/semantic evidence through protected captures
and fresh eligible tenants, then resolve the measured gaps. Never substitute
tool familiarity for a personally built Go/Ruby project or measured improvement.

