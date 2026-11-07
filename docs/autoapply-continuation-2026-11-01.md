# Autoapply continuation, 2026-11-01

Read `HANDOFF.md`, this document, `docs/autoapply-master-tickets.md`, and the
owner's master specification in
`C:\Users\sm\.codex\attachments\b7412d72-e2fc-48dd-bc51-46d39c36a5d5\pasted-text-1.txt`.
The specification's latest request supersedes older audit waivers where it asks
for those tickets. Work in this checkout, including existing uncommitted changes.
Do not commit or push. Track actual evidence for each ticket. Do not print
candidate values, credentials, email bodies, OTPs, browser storage or tokens.

## Scope and owner decisions

The owner explicitly authorized rolling applications from the published
catalogue for eligible India or India-remote software, data, ML, backend,
full-stack and graduate engineering roles with minimum experience at most
three years. Exclude service-based firms per `HANDOFF.md`. The earlier 50-URL
restriction is superseded for this scope. The target band does not change
employer-facing experience. Use only confirmed profile facts and résumé data.
The owner confirmed age 22, India-only work authorization and one employment
entry, then supplied a certified profile and skills map in the specification.
Uncertain legal, employer-specific, mixed-consent or skill questions must not
be guessed. No model runtime fallback. The worker no longer constructs a model.

## Architecture and work completed locally

The pipeline is catalogue → `intake.ts` → `preflight.ts` → candidate-bound
SQLite (`store.ts`, `autoaply.ts`) → `worker.ts` → tenant browser owner and
role-specific `runner.ts` session → scoped `answers.ts` / `classifier.ts` →
review or observed submit → receipt / `evidence.ts` → `acceptance.ts` audit.
Company identity comes from `identity.ts`; a role retains its own claim and
receipt. The local dashboard groups reviews, with role answers overriding
company answers. Mailbox verification and the vault support portal login and
receipt reconciliation. Old architecture documentation may describe superseded
model or static-approval behavior.

- Preflight applies the shared India/remote and service-company gates plus a
  software/data title filter and three-year ceiling. Intake defaults to a
  15-minute ETag poll. Old experience skips are marked once for live-source
  revalidation; they are not blindly requeued.
- Candidate profile was updated and validated from the owner specification.
  A prior copy is in the sensitive state directory. Confirmed employer history,
  India-only authorization, salutation, phone type, age and some declarations
  have deterministic handling. The certified skill-years map and referral
  preferences are saved. Workday hierarchical source selection passed local
  fixtures for scoped answers and company-specific fallback. Some declarations,
  question variants and truthful matching remain incomplete.
- The worker preserves a 50-attempt daily cap in SQLite, configurable by
  `--max-daily-submissions`. It reserves before a click and counts by India
  local day, conservatively consuming a slot if a crash occurs before clicking.
  A five-attempt per-tenant rolling-hour budget shares the reservation. Local
  tests checked persistence, shared workers and the submit barrier. A 15–45 second
  inter-job cooldown was added; vault reset limit was tightened to one hour.
  These controls have not been proven in a live campaign.
- The worker blocks sibling roles for unresolved final submissions or live OTP,
  not ordinary unfinished pre-submit requests. Recorded clicked/dispatched
  phases remain ambiguous even if `submissionAttempted` is absent. Reconcile
  before repeating a final submit. The old ABB request was not re-run here.
- Standard `autocomplete` fields feed classification; OTP and explicit
  third-party-contact labels are excluded. Numeric options require a unique
  range match. More native controls have immediate read-back checks. A no-op
  Next-step retry limit was added but its latest browser fixture **did not run**:
  automatic approval review returned a 502. Re-run that focused fixture.
- A required cover-letter upload can generate a role-specific PDF from the
  existing deterministic preparation and preflight description. A synthetic
  browser fixture passed. Restored reviews without a saved brief may still park.
- New SQLite lifecycle events and reason codes, intake history, read-only
  `worker.js --status` / `--explain`, and PID/start/heartbeat liveness exist.
  They are partial: historical rows have no event history or codes, status lacks
  full funnel/provider detail, and privacy/crash proof is incomplete. A real
  read-only status returned the old worker as crashed, 9 parked and 410 queued.
  The 0/50 acceptance record was last audited 2026-10-30, not freshly verified.
- Completed roles' old `review.html` files are pruned after 14 days, without
  deleting receipt bundles; a local fixture passed. Windows ACL protection is
  **not installed**. Automatic approval rejected removing inherited access to
  `state\autoapply`, citing owner-lockout risk and lack of trusted authorization
  for that exact mutation. Do not bypass the rejection. Explain the block and
  seek any approval required by the review system after independent work.
- `scripts/run-autoapply.ps1` compiles to `out/dist` and launches JavaScript
  without tsx. A compiled-worker local fixture passed. Direct Node type stripping
  failed because source imports use `.js` paths. The Windows startup task has not
  been installed or verified.
- Company batching fixture passed after the browser-owner and pacing changes:
  A1, A2, B1 ordering; same-tenant cookies; cross-tenant isolation; separate
  POSTs and receipt directories. This is local evidence, not production proof.
- `out/autoapply-working-tree-backup.zip` contains a source snapshot, not state.
  `out/autoapply-backup.bundle` passed `git bundle verify` and includes all refs,
  including an old pre-secret-scrub ref. Treat it as sensitive and do not upload.
  Both backups predate the most recent edits.

## Verification and outstanding work

Latest TypeScript no-emit check passed after the no-op change. Focused local
checks passed for profile answers, intake, status privacy and liveness, company
batching, daily/tenant budgets, retention, Workday source choices and cover-letter
PDF. The latest no-op browser fixture was blocked by an approval-review 502,
not run. No full suite was run, consistent with the owner's previous decision.

Complete the unchecked tickets in the master tracker rather than claiming the
partial implementations satisfy them. In particular: finish deterministic
semantics and widget read-back; verify snapshots and privacy; score and schedule
the queue; finish event/status detail, mailbox and outcome tracking; revalidate
stale reviews; handle ATS failures from actual captures; finish Windows startup,
sleep/network recovery and safe data retention; verify tenant budgets and
challenge cooldown. Run ABB and one Greenhouse, Lever and Ashby canary
sequentially under the authorized rolling scope. Verify each actual receipt and
reconcile ambiguous submits before retries. Then install and verify the requested
Windows logon task. Production acceptance, 50 real verified applications and
the remaining ticket completion are unproven. No live application was submitted
and no startup task was installed in this continuation.
