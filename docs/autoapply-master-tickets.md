# Autoapply master tickets

GEN-01 through GEN-08 implementation, dry-run outcomes and remaining acceptance
are tracked in [autoapply-gen-tickets.md](autoapply-gen-tickets.md). Shared code
changes do not by themselves complete the live acceptance gates.

Created 2026-11-01 from the owner's master specification and the 2026-10-31
audit. Each checkbox requires implementation or verified existing behavior and
evidence. Local fixtures are not live acceptance. Owner's latest instructions
supersede older handoff restrictions. Do not place candidate values in this file.

## Owner profile and semantics

- [ ] OWNER-01: Apply owner-certified profile facts, respecting the latest résumé clarification.
- [ ] OWNER-02: Implement owner-certified declarations and employer-scoped facts.
- [ ] SEM-01: Standard autocomplete and ATS field signals.
- [ ] SEM-02: Normalize question semantics and polarity.
- [ ] SEM-03: Ranges, units, polarity and date handling.
- [ ] SEM-04: Role, company, jurisdiction and global answer precedence.
- [ ] SEM-05: Required versus optional unknown fields.
- [ ] SEM-06: Measure recognition against real captures.
- [ ] SEM-07: Read back each widget after interaction.

## Form runtime and portals

- [ ] SOTA-01: Verify browser actions and read-back.
- [ ] SOTA-03: Detect stalled page transitions.
- [ ] SOTA-04: Capture sanitized structural step snapshots.
- [ ] SOTA-05: Offline multi-step portal replay.
- [ ] SOTA-06: Workday authentication state machine.
- [ ] SOTA-07: Evaluate against real captured forms.
- [ ] SOTA-08: Prior application and résumé reuse with validation.
- [ ] SOTA-09: Aggregate recurring unanswered questions.
- [ ] SOTA-10: Tenant session and authentication budget.
- [ ] SOTA-11: Back up source and user data safely.
- [ ] SOTA-ADD-01: Generate truthful tailored cover letter when required.
- [ ] SOTA-ADD-02: Sleep/wake and network recovery.
- [ ] FIX-00: Revalidate historical parked roles.
- [ ] FIX-01: Normalize and verify requisition identity.
- [ ] FIX-02: Apply entry, interstitials and readiness.
- [ ] FIX-03: Zero-field pages, same-origin iframes and shadow DOM.
- [ ] FIX-04: Discover submit controls.
- [ ] FIX-05: Workday prompts, dates, repeaters and upload.
- [ ] FIX-06: Resume ABB and verify its outcome.
- [ ] FIX-07: Greenhouse dynamic controls and uploads.
- [ ] FIX-08: Consistent browser configuration.
- [ ] FIX-09: Greenhouse post-submit verification.
- [ ] REA-01: Inspect runtime availability and build if needed.
- [ ] REA-02: Portal capture and conformance across requested providers.
- [ ] REA-03: Reuse applicable third-party findings.
- [ ] TST-03: Read-only portal conformance sweep.

## Intake, scheduling and safety

- [ ] FUN-02: Revalidate old experience skips.
- [ ] FUN-03: Provider-diverse scheduling with company batching.
- [ ] FUN-04: Explain catalogue-to-queue funnel.
- [ ] FUN-05: Target 0–3 years without changing candidate experience.
- [ ] FIT-01: Deterministic résumé-based fit scoring and ordering.
- [ ] CAP-01: Durable configurable daily submission cap, default 50.
- [ ] PIPE-01: Fifteen-minute ETag intake and durable history.
- [ ] SEC-01: Restrict sensitive state and manage retention.
- [ ] MAIL-01: Multi-folder mailbox and verification coverage.
- [ ] OUT-01: Track employer replies by outcome.
- [ ] DET-01: Browser consistency checks.
- [ ] DET-02: Detection diagnostics based on evidence.
- [ ] DET-03: Pacing and tenant budgets.
- [ ] DET-04: Challenge cooldown and circuit breaker.
- [ ] DET-05: Remove unsupported reliability claims.
- [ ] DET-06: Record tenant terms considerations.

## Observability

- [ ] OBS-01: Redact sensitive information from stored errors.
- [ ] OBS-02: Stable outcome reason codes.
- [ ] OBS-03: Read-only status and per-job explanation.
- [ ] OBS-04: Process identity and heartbeat liveness reader.
- [ ] OBS-05: Privacy-safe application lifecycle journal.
- [ ] OBS-06: Durable intake decisions and funnel history.
- [ ] OBS-07: Actionable handoffs for every park.
- [ ] OBS-08: Current acceptance audit and exclusions.
- [ ] OBS-09: Durable run history.
- [ ] OBS-10: One current-state view.
- [ ] OBS-11: Park expiry and revalidation.

## Acceptance and operation

- [ ] ACC-01: Live step-depth progress.
- [ ] ACC-02: Sequential ABB, Greenhouse, Lever and Ashby canaries.
- [ ] ACC-03: Live crash and duplicate prevention.
- [ ] ACC-04: Verify live receipt evidence and email reconciliation.
- [ ] ACC-05: Track 50-application multi-provider acceptance gate.
- [ ] ACC-06: Reconcile ambiguous Workday submissions using Candidate Home.
- [ ] OPS-01: Compiled JavaScript worker and Windows logon task.

SOTA-02 model fallback remains withdrawn: deterministic operation is required.
FUN-01's old fixed-URL approval was superseded by the owner's rolling scope.
Older suite and remote-CI requirements remain waived; use focused verification.

## Execution evidence, 2026-11-02

- ACC-05 / OBS-08: Fresh acceptance audit verified 0/50. Three raw applied rows
  were excluded. Queue moved from 382 queued and 16 parked to 374 queued and
  24 parked after eight distinct-tenant scans, all without final submission.
  Source eligibility and receipt verification remain separate from queue status.
- FUN-02 / FUN-05: Public preflight now rejects the observed “4 or more years”
  wording and empty source descriptions. Focused regression checks passed.
  A missing stated minimum remains an eligibility uncertainty.
- SEM-02 / SEM-04: The observed prior-employment wording now uses only
  confirmed complete employment history and a scoped employer. A focused test
  checks both values and missing context. Owner-confirmed role answers were
  saved with protected backups; other questions remain open.
- SOTA-03 / FIX-02 / ACC-01: Protected PayPal trace showed a delayed Apply link
  missed by the initial check. A local replay of the captured link structure
  passes after a bounded wait. A single post-fix scan reached one filled field,
  then stopped at the step limit without submitting. No live receipt exists.
- SOTA-06 / DET-03: The same trace exposed eleven repeated account-creation
  clicks. Credential attempts are now recorded in the job checkpoint before
  clicking. Local tests cover checkpoint-write failure and restart. Sibling-role
  protection and the actual account outcome remain unresolved; do not restart
  the affected tenant automatically.
- OBS-07 / SOTA-09: `out/autoapply-scan-manifest.json` contains redaction-checked
  failure labels for reachable scanned steps. Options are unknown, not captured.
  Protected traces require further sanitization before replay fixtures are
  exported. No raw trace belongs in ordinary output storage.
- ACC-03 / CAP-01: Synthetic mixed-tenant dispatch preserved two ambiguous
  locks while two other tenants progressed. Zero-field browser fixtures proved
  no final submission or quota reservation with either submission setting.
  These results do not establish a live canary or complete crash recovery.
- Later batch: 13 distinct tenants scanned, 12 parked and Infineon failed on a
  browser timeout. Final audit remained 0/50. GitLab and SPAN reached forms;
  Caterpillar parked at login. GitLab restriction-question classification was
  corrected and tested. The five-tenant live-submit sprint remains open because
  no scanned role was verified ready. Preserve all open master tickets.
- Final batch: 15 distinct tenants scanned, 13 parked and two failed before form
  entry. A different NielsenIQ requisition stopped on identity mismatch and a
  Barclays role parked at login. Preflight now flags the observed conflicting
  senior-role description for review. Final audit remained 0/50; no final
  application submission or live-submit canary occurred.

## Progress, 2026-11-01

- Sleep recovery preserves an application claim while its worker process still
  exists, even if its heartbeat expired. A dead process still parks its claim
  for review. Focused live-process, concurrent-claim and killed-process tests
  passed. PID reuse may conservatively delay recovery; this does not establish
  complete sleep/network recovery. A SQLite-backed singleton-worker lock now
  prevents two application workers from sharing a queue. Local exclusivity,
  killed-worker lock recovery, and one-shot worker startup fixtures passed.
- A refreshed protected local state archive was created and all 3,120 archived files
  passed SHA-256 comparison with their sources. A restored queue passed SQLite
  integrity checking; the referenced résumé is inside the archive scope. This
  is a same-disk snapshot, and the DPAPI vault remains tied to the owner's
  Windows account; independent recovery is not yet proven.
- A protected source snapshot verified 1,798 tracked and unignored files. It
  predates the latest mail-reconciliation edit and should be refreshed after
  remaining implementation.
- Remote location preflight now rejects a bare `Remote` location unless the
  source explicitly identifies India or a global location. Skipped roles can be
  rechecked and reopened when source location changes. Compilation and two
  focused preflight/intake tests passed. This does not prove that every global
  listing lacks conflicting restrictions elsewhere in its description.
- The ASG role did not establish India eligibility; G2i advertised a talent
  pool with location-dependent eligibility. Jobgether did not identify the
  hiring company, so its service-company eligibility remains unverified.
  A current Stripe Bangalore new-grad listing passed source review. A single-role
  worker parked before submission with no receipt. Stripe's visible entry links
  include a decorative word joiner in their accessible names; entry matching
  now accepts it, and a focused browser fixture passed. The single-role retry
  reached the Greenhouse form, recorded 14 field fills, and parked with required
  answers and interaction issues unresolved. It did not attempt submission and
  produced no receipt. Two owner-confirmed Stripe-scoped answers were saved after
  retaining the previous profile. Other required fields and widget issues remain
  unresolved. A browser fixture passed for a specific bachelor's degree
  falling back to one generic bachelor's-level option with selection read-back.
- The Diagrid Ashby canary reached its application, recorded 12 fills, and parked
  without attempting submission or producing a receipt. Its required questions
  include individual work narratives and compensation expectations; these must
  not be guessed. Brillio's public business description identifies a client IT
  services firm; the shared service-company filter now excludes it. The required
  `npm test` passed after correcting recognition of the explicit Workday marker.
- The Warner Music Lever canary reached its form, recorded five fills, and
  parked without a submission attempt or receipt. Its required questions include
  compensation, working-model preference and notice period. The SS&C Workday
  software engineering role was selected as an eligible substitute for the
  out-of-scope ABB role. Its first run stopped at catalogue intake failure. The
  retry recorded `submit_clicked` on a zero-field page, then reset its checkpoint
  to `prepared` after a client-side error; no request or receipt was observed.
  Treat the outcome as ambiguous and reconcile it before retrying. The checkpoint
  was changed to preserve the click, with its original retained. Autoapply later
  signed in and observed an explicit empty application-list control; the latest
  stable-empty-list check has not yet run against the live page. Zero-field and
  journal-restart fixtures passed,
  including a missing checkpoint and an untouched same-company sibling.
- Autoapply now attempts Workday Candidate Home reconciliation itself on restart,
  using the tenant session and existing authentication flow without enabling a
  second application submission. Exact requisition and submitted-status matching,
  delayed loading, automatic sign-in and one-attempt worker scheduling passed
  local fixtures. A durable one-hour cooldown now spans restarts; matching rejects
  statuses from neighbouring or hidden rows. The observed empty-list control does
  not alone prove a delayed submission cannot appear.
- Unsubmitted parked roles are revalidated against their live source before
  reopening. Closed roles are skipped; transient failures are persisted with a
  five-minute retry time. Focused closed-source, retry-across-restart and
  ambiguous-click protection checks passed. Bulk historical revalidation remains
  unproven.
- Authenticated confirmation mail now requires whole employer and title phrases
  or a bounded exact requisition ID. A focused fixture rejects employer-name and
  requisition-ID substrings; same-title jobs at one tenant require the ID.
  Mailbox regressions passed.
- Challenge detection persists a one-hour tenant cooldown, including challenges
  encountered during Workday reconciliation. Queued and parked tenant roles wait
  across restarts. Store, worker, new-challenge sibling blocking and simultaneous
  login/challenge fixtures passed; broader live challenge behavior remains unproven.
- Client validation or JavaScript errors no longer clear a recorded submit click.
  Bounce and client-error fixtures confirm that a subsequent resume does not submit
  again before reconciliation.
- FIT-01 / FUN-03: Deterministic skill/title/freshness ranking and provider
  rotation now preserve warm tenant batches. Public descriptions are saved for
  new intake rows. The rotation cursor now persists across worker restarts.
  Focused fit, restart and company-batch dispatch tests passed; compilation
  passed. Historical rows lack descriptions, so full ranking coverage remains
  open. See `docs/autoapply-terra-handoff-2026-11-01.md` for exact score weights.
- ACC-02: Public canary preflight skipped ABB as `ineligible_role`; selected one
  Greenhouse, Lever and Ashby role as eligible. No submissions or receipts yet.

- SOTA-03: The previously blocked no-op browser fixture passed against compiled
  JavaScript, proving two attempts then halt on an unchanged page.
- OBS-01/03: Status filters summary counters, provider keys and timestamps;
  incomplete history writes and malformed worker JSON no longer break status.
  Three focused status checks passed, including injected private summary data.
- MAIL-01: Read-only INBOX/archive/junk scans, Message-ID deduplication and
  terminal authentication errors passed six focused mailbox checks. Live folder
  behavior and OUT-01 employer-outcome tracking still need proof.
- SEC-01: Owner-preserving root ACL restriction passed automatic review and ran.
  Existing owner, SYSTEM and Administrators retain full control. Owner read/write
  passed; original ACL is backed up locally. Browser child rules remain intact.
  Complete child-file permission and retention verification remains open.
- Owner approved live submissions and Windows startup installation through
  applicable review. These outcomes still require actual execution and evidence.

- OWNER-01: Owner profile validated and updated, including age, one employment
  entry, the explicitly supplied skill-years map and India-only authorization.
  Additional declaration semantics remain open. Previous profile was preserved
  locally before the update; both files contain sensitive data.
- OWNER-02 / SEM-04: Resolver now uses the explicitly confirmed complete
  employment history for a supplied employer and handles India-only work
  authorization. Focused answer and eligibility checks passed. Other consents
  and question variants remain open.
- OPS-01: TypeScript compiles to `out/dist`; `run-autoapply.ps1` builds and starts
  compiled JavaScript. Direct worker import reached argument parsing without tsx.
  End-to-end startup and scheduled-task installation remain unverified.
- FUN-02: Old experience skips are marked once for live-source revalidation;
  the migration and restart fixture passed. Real queue revalidation remains open.
- OBS-02/03/04/05/06: New outcomes have a closed code, status/explain read the
  database without candidate fields, liveness checks PID/start/heartbeat, and
  lifecycle/intake records are written. These are partial: historical rows have
  no codes/events, status lacks the full funnel and per-provider breakdown, and
  complete crash/restart and privacy proof is still needed. The real queue status
  returned crashed worker, 9 parked and 410 queued; the 0/50 acceptance file was
  last audited 2026-10-30, so it is not a fresh acceptance result.
- SEM-01: Browser autofill tokens now feed candidate field classification; OTP
  and explicit third-party contact labels do not become candidate autofill.
  Broader ATS hooks and live-capture proof remain open.
- CAP-01: Fifty-attempt daily cap is configurable, persisted and guarded before
  submit. Multi-worker/restart and local submit-barrier fixtures passed. The full
  pacing and tenant-budget requirements remain open. The worker now adds a
  15–45 second inter-job cooldown and five-attempt per-tenant rolling-hour limit;
  the two-reset vault window was tightened to one hour. These need live proof.
- SEM-03/07: Numeric option ranges now require a unique match. Native selects,
  radios, checkboxes, typed values and uploads have additional immediate
  read-back checks. Other widget classes and post-remount behavior remain open.
- OBS-03/04: `worker.js --status` and `--explain <jobId>` are read-only. A local
  fixture checked PID/start/heartbeat classification and omitted candidate data.
  The live queue status was read without starting the worker; the acceptance
  summary is dated and must not be treated as a fresh audit.
