# Autonomous application completion plan

Source requirements: user attachment `e3def207-0bcf-46d7-a406-ae769f2209ad/pasted-text-1.txt`.
This checklist preserves the full requested scope. Items require implementation
and direct verification; earlier happy-path tests do not establish completion.

- [x] Browser: evaluate Patchright/rebrowser, branded Chrome, realistic interaction pacing, and local CDP leak diagnostics. Record actual results, not an undetectability claim.
- [x] Form engine: rescan conditional/remounted controls, shadow DOM, mutation settling, and final validation.
- [x] Answers: explicit global/jurisdiction/employer scopes, polarity and skill boundaries, salary/notice units, and schema-validated grounded model fallback with source-fact checks.
- [x] Identity: canonical ATS/tenant/requisition keys, queue and loaded-page identity checks, URL alias deduplication.
- [x] Intake: continuously consume published hourly catalogue, reject closed/stale entries, perform live ATS probes and hard-requirement eligibility before browser launch.
- [x] Storage: SQLite WAL queue, transactional claims, crash recovery and migration preserving existing applications/receipts.
- [x] Authentication: encrypted per-tenant credentials, sign-in/account creation, verified activation links and automatic OTP entry.
- [x] Mail: read-only scoped inbox polling, sender/recipient/time correlation, split-code inputs, confirmation-email reconciliation; local mailbox integration proof.
- [x] Handoffs: park browser/storage/DOM/question state, notify through local UI or configured webhook, continue processing other jobs, resume safely.
- [x] Submission: prepared/clicked/dispatched/confirmed states, context-wide network evidence, safe validation-bounce recovery and ambiguous-dispatch retry protection.
- [x] Evidence: immutable receipt/payload/document-hash/screenshot/sanitized-HTML/network-hash bundles, candidate/requisition association and employer application ID.
- [x] Fault tests: dynamic remount; polarity/Java-vs-JavaScript; scope isolation; pre-network bounce and post-network crash; parent/popup confirmation; footer false-positive immunity; delayed mailbox OTP; CDP leak diagnostics.
- [x] Operations: runnable continuous worker, shutdown/restart recovery, unattended launch configuration, real saved queue migration, end-to-end acceptance.
- [x] Deliverables: architecture updated from final verified implementation, concise change list, test evidence and explicit unresolved external dependencies.

No live application may be duplicated or counted as newly submitted merely
because an existing-application response was observed. Existing user-approved
candidate facts and consents must be preserved without broadening their scope.

## Live Acceptance Status (2026-11-09)

- **Total Confirmed Live Applications**: **88** verified live submissions with employer receipts stored in `state/autoapply/portal-review/queue.sqlite`.
- **Top Verified Platforms**:
  - **Ashby**: Full end-to-end live flow verified, including GraphQL mutation matching (`ApiSubmit(?:Single)?ApplicationForm(?:Action)?`), yes/no components, custom question resolution, and DOM unmounted status confirmation (`[role="status"]`).
  - **Greenhouse**: Single-page ATS fast-path, React-Select combobox handling, confirmation URL detection (`/confirmation`), and 180s watchdog tolerance for high-field forms.
  - **Lever**: Fast-exit for closed/expired postings, resume upload parsing deadline tracking, and autonomous challenge deferral (`captcha_deferred`).
  - **Workday**: Container-scoped field resolution, sign-in header recognition (`utilityButtonSignIn`), and B-tree indexed transactional queue operations.

## Acceptance evidence, 2026-10-30

The user chose "Keep changes local" after reviewing the separate-branch CI
proposal. No commit, push, remote CI run, startup-task installation or new live
application submission is part of this local completion. The CI workflow and
startup scripts are delivered for later use. Remote CI remains explicitly unrun.

| Requirement | Authoritative local evidence |
| --- | --- |
| Browser launcher and CDP probes | `scripts/cdp-diagnostic.ts`, pinned source SHA-256, `out/cdp-diagnostic.json`, `out/cdp-completion.log` |
| Dynamic controls, shadow DOM, delayed requests and scope isolation | `src/autoapply/dynamic-form.test.ts`, `out/requirements-verified.log` |
| Polarity, skill boundaries, units and model grounding | `answers.test.ts`, `grounded-model.test.ts`, browser polarity/Java fixture, `out/autoapply-verified.log` |
| Canonical identity, source lifecycle and public intake | `intake.test.ts`, full live catalogue shape audit, `out/public-intake-acceptance.log` |
| SQLite claims, migration, killed-worker recovery and receipt upgrades | `store.test.ts`, `out/mail-upgrade-current.log`; real private read-only audit retained three applied receipts |
| Encrypted tenant credentials, competing writers, name exclusions and activation | `authentication.test.ts`, actual Windows DPAPI fixture, `out/requirements-verified.log` |
| Real SMTP OTP and browser restart | `otp.integration.test.ts`, `out/otp-completion.log`, three passed |
| Scoped authenticated mail and durable ownership | `mailbox.test.ts`, `mail-evidence.test.ts`, `out/mail-upgrade-current.log` |
| Parked reviews, bounded live tabs and restart | `worker.test.ts`, four-job shutdown/restart acceptance in `out/autoapply-verified.log` |
| Submission bounce, JS error, dispatched crash, popup and footer faults | `submission.test.ts`, `out/submission-final-proof.log`, full suite |
| Immutable proof and exact document bytes on resumed upload | `submission.test.ts` manifest check and `workflow.test.ts` document hash assertion, `out/document-proof-acceptance.log` |
| Operations and deliverables | startup scripts parse successfully; worker acceptance passes; `docs/autoapply-architecture.md` |

The full regression suite passed 97 tests before the final password-name and
browser polarity audit. The final focused requirement run checks those changes.
Project selftest and typecheck pass. Local fixtures establish supported behavior,
not universal compatibility with every employer form or CAPTCHA-solving ability.

Final audit additions also passed: deterministic vault recovery and candidate-name
exclusion in `out/vault-requirements-verified.log` (5 tests), and structured
network receipt / application-ID / proof-strength acceptance in
`out/submission-requirements-verified.log` (6 tests). Typecheck passed afterward.
