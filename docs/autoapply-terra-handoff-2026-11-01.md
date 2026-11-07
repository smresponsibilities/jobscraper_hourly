# Autoapply Terra handoff, 2026-11-01

## Owner request and work location

Continue in the existing `D:\Jobscraper-next` checkout with all uncommitted work.
Do not commit or push. The owner requested GPT-6.1 Terra with medium reasoning.
Use caveman ultra for chat replies only. Keep code, comments and durable documents
in normal English. Explain permission and data-loss risks clearly.

Read this document, `HANDOFF.md`, `docs/autoapply-continuation-2026-11-01.md`,
`docs/autoapply-master-tickets.md`, and the original master attachment at
`C:\Users\sm\.codex\attachments\b7412d72-e2fc-48dd-bc51-46d39c36a5d5\pasted-text-1.txt`.
Read the attachment privately. Do not print candidate facts from it.

The work is incomplete. Continue actual implementation and focused verification,
not only planning or a completion report. Maintain the tracker and handoff as
evidence changes. Create an active goal for the remaining work in the new chat.

## Authorization and privacy

The owner's latest direct message explicitly approved live application
submissions, Windows startup-task installation, and state-folder permissions
through the applicable review process. The owner specifically requires that
their account must not be locked out. Earlier pending-approval statements are
superseded by this direct approval, but automatic review must still succeed for
reviewed actions. Do not bypass rejection or silently weaken access controls.

Application scope is open India or genuinely India-eligible remote software,
data, ML, backend, full-stack and graduate engineering roles requiring at most
three years. Exclude service firms under HANDOFF's policy. Candidate experience
remains the owner's confirmed experience, not the eligibility ceiling. Never
invent legal, employment, salary, skill, referral, consent or demographic facts.
Runtime must remain deterministic, with no model fallback.

Never print candidate values, credentials, email bodies, OTPs, browser storage,
tokens or vault data. Print public role IDs and closed diagnostic codes only.
Saved candidate profile and prior profile are sensitive. Existing git backup
contains an old pre-secret-scrub ref; never upload it. Source and bundle backups
predate recent edits and do not prove a current candidate-state backup.

## Architecture and invariants

`intake.ts` polls the public catalogue with ETag, validates rows, calls
`preflight.ts`, and feeds candidate-bound SQLite through `autoaply.ts`/`store.ts`.
`worker.ts` owns lifecycle, durable claims, tenant browser ownership and parked
roles. `runner.ts` handles each role with deterministic `answers.ts`,
`classifier.ts` and widget interactions. `identity.ts` owns requisition and tenant
identity. Receipts flow through `evidence.ts`, `evidence-verifier.ts` and
`acceptance.ts`. Mail supports login verification and receipt reconciliation.

Preserve these invariants:

- Atomic role claims and durable submission reservations precede submit.
- Daily cap defaults to 50 in the Asia/Kolkata day; tenant submission budget is
  five attempts per rolling hour. Crash reservations conservatively consume a slot.
- Preserve warm same-company browser batches while isolating tenant storage.
- Unsubmitted form requests do not lock sibling roles. Clicked/dispatched final
  submissions remain ambiguous even without a `submissionAttempted` flag.
- Reconcile ambiguous final submissions before any repeat submit.
- A local fixture is not a live application or production acceptance proof.
- Unknown required facts park together; optional unknown fields stay blank.
- Re-run focused tests for modified logic. Do not run the broad suite unless a
  concrete new need arises. Any classify.ts/config.ts edits still require npm test.

## Completed during the immediate predecessor chat

### Stalled-step fixture

The required fixture `unchanged step stops after two attempts without looping`
passed against compiled JavaScript. It observed two Next clicks then
`Next did not change the form`. Source tsx invocation failed before tests at
`uv_os_get_passwd` under the restricted Windows account. Use compiled JS.

### Status privacy and resilience

`status.ts` now filters numeric counters and provider keys, normalizes timestamps,
uses safe object parsing, tolerates malformed worker JSON, and reads the latest
complete intake record when a crash leaves a partial final JSONL append.
`status.test.ts` has an injected-private-data and partial-history regression.
Three status tests passed. Complete observability and error redaction remain open.

### Read-only mailbox scans

`mailbox.ts` now discovers available special-use All/Junk folders, including Gmail
All Mail and Spam, and scans those plus INBOX read-only. It deduplicates Message-ID;
fallback UID identity includes the folder. Existing authenticated sender,
recipient and time checks remain. Authentication rejection throws a safe
`MailboxAuthenticationError` and prevents repeated connect attempts on that
mailbox instance. Raw server diagnostics are discarded rather than attached as
error causes. Six mailbox tests passed, including a fake IMAP client exercising
folder coverage, deduplication and one-time authentication failure.

Live IMAP behavior is unproven. Network reconnect handling, worker-level terminal
auth handoff and OUT-01 employer outcome tracking remain open. Do not label
MAIL-01 fully complete yet.

### Owner-preserving state ACL

`scripts/protect-autoapply-state.ps1` was created and successfully executed after
automatic review. The first execution review timed out; its allowed retry
succeeded. Root `state\autoapply` retains its original owner. Before inherited
root access was removed, the script explicitly granted FullControl to that owner,
SYSTEM and Administrators. It saved original SDDL to an ignored timestamped
`out\autoapply-root-acl-*.txt`, verified owner identity and grants, then performed
actual owner read/write. It restores the prior ACL on failure.

Restricted agent-account state access now fails as expected. Use reviewed owner
access for protected profile, database, vault and browser operations. Do not
weaken ACLs to make restricted agent access work. Source edits remain available.

Child audit found 1,832 items, zero protected child ACLs, and 45 explicit rules,
comprising browser capability rules and Everyone Traverse denies. These were
preserved. Root restriction does not prove every child has POSIX 0600 semantics.
Finish effective child-permission and retention verification without deleting
browser rules blindly. Owner read access was additionally exercised by the
subsequent canary planner.

### Deterministic ranking and provider rotation

Latest source edits added `fit.ts` and `fit.test.ts`, extracted
`matchingProfileSkills` in `prepare.ts`, and extended queue items with optional
public job descriptions. Intake passes preflight descriptions into new rows.
`autoaply.ts` ranks within each provider by deterministic 0-100 fit and rotates
providers between tenant batches. Warm company sorting still takes precedence;
eligibility callbacks and atomic claims remain unchanged.

Score is 60 points for exact whole-skill overlap divided by distinct listed
skills, 30 for target title match, and up to 10 for linearly decaying freshness
over 30 days. Invalid/future timestamps receive no freshness points. This is
ranking, not hiring probability or eligibility. Existing historical queue rows
lack saved descriptions, so they currently use title/freshness only. Provider
rotation cursor is process-local; restart fairness is not yet proven.

Two new fit tests passed: boundary matching including Java/JavaScript and C++,
bounded timestamps, immutable skills, fit order, provider rotation and tenant
batch preservation. TypeScript compilation passed after these edits. The existing
focused `dispatch completes an available company batch with distinct receipts
and retains approval boundaries` test also passed after the scheduling change.

## Canary plan and live execution status

`scripts/plan-autoapply-canaries.mjs` performed read-only live preflight using the
protected profile locally. No candidate fields were printed. Its sanitized
report is `out/autoapply-canary-plan.json`. Four checks completed:

- ABB requisition `workday:abb:JR00051581` was skipped as `ineligible_role`.
  Its Industrial Automation title does not pass the current software/data gate.
  Do not force it through or broaden scope to satisfy a canary checkbox.
- Greenhouse `greenhouse:asg:8919112002` passed `live_and_eligible`.
- Lever `lever:jobgether:c2bf8481-d15b-4515-b5fb-bfba4d006a24` passed.
- Ashby `ashby:g2i:72288763-ecb2-430b-8ec2-57a1ad35446b` passed.

These are preflight results, not submissions. The selected Lever intermediary
and Ashby talent-pool routes still need portal-specific scrutiny for actual
employer/role fit. Do not treat endpoint eligibility as conformance proof.
No live application, new receipt or startup task was created in this chat.
Last owner-account process inventory found no autoapply worker; check again.

## Next actions in order

1. Inspect current diffs and the completed focused check evidence above. Confirm
   compiled output matches source before live use. Update tracker for ranking
   with its limits; do not mark untouched requirements complete.
2. Verify owner account can read candidate, queue and vault after ACL change,
   without printing values. Inspect effective child permissions on sensitive
   files and preserve rollback. Keep source/state backup caveats explicit.
3. Inspect canary plan's public URLs, descriptions and current status. Revalidate
   each immediately before live dispatch. Resolve ambiguous final submits and
   check worker PID/start/heartbeat before starting any new worker.
4. Run approved canaries sequentially, using one approved URL at a time. Existing
   worker CLI supports --approved-jobs with a JSON object containing jobs[].url,
   --once, --submit, --profile, --state and configurable submission cap. Use
   compiled worker JS. Existing `out/sequential-abb.json` is not eligible now.
   Do not start the unrestricted rolling worker merely to test a canary.
5. Observe actual portal blockers, preserve sanitized structural captures, fix
   root causes at shared layers, and verify with focused replay fixtures. Never
   guess candidate answers to make a canary pass. Park when required.
6. Verify any actual receipt using `scripts/verify-autoapply-evidence.ts` or its
   compiled equivalent and existing evidence verifier. Reconcile email/Candidate
   Home where appropriate. A clicked button alone is not success. Update the
   acceptance audit with real evidence and explicit exclusions.
7. Continue all unchecked master tickets, including deterministic semantics,
   widget read-back/remounts, snapshots/replay, Workday auth/reuse/reconciliation,
   captures/benchmarks, historical park revalidation, fit/history completion,
   liveness/crash journal, stable codes/redaction, handoffs, outcomes, tenant
   challenge cooldown, sleep/network recovery, backup and retention. The master
   attachment contains exact ticket acceptance details. Reuse existing code.
8. Review and complete `scripts/run-autoapply.ps1` and
   `scripts/install-autoapply-startup.ps1`. Launcher already compiles JS and avoids
   tsx. Sleep/network watchdog remains incomplete. Installer currently sets an
   interactive limited-rights logon task, hidden PowerShell, IgnoreNew and retries.
   Install with -Submit only through applicable review after live readiness.
   Verify task principal is owner sm, exact action, logon trigger, 15-minute poll,
   duplicate-worker protection, and safe startup recovery. Do not change owner.
9. Refresh HANDOFF, tracker and continuation with actual proof and remaining gaps.
   No commits or pushes. No broad suite or unsupported reliability claims.

## Useful commands and environment details

Run in PowerShell at `D:\Jobscraper-next`. Use Windows paths. Repo ownership
differs from restricted agent account; use per-command
`git -c safe.directory=D:/Jobscraper-next ...` rather than changing global config.

Compile with `node node_modules/typescript/bin/tsc --noEmit false --outDir out/dist`.
Tests are emitted under `out/dist/src/autoapply`. Use
`node --import ./scripts/test-temp.mjs --test --test-name-pattern="..." <compiled-test>`.
The preload keeps browser scratch in ignored `out/test-temp`. Long commands
should run in the background, logging to ignored files; read only bounded final
summaries. Do not repeatedly poll verbose logs. No purpose-built
run_in_background tool was exposed in the predecessor, so ordinary exec sessions
were used for bounded focused commands.

Existing initial goal in predecessor chat remains incomplete; this document is
a transfer of ongoing work, not a claim that all tickets were finished.
