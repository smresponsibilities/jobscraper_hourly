# Autoapply execution handoff

## Owner instruction and current state

The owner stopped application work and asked for an honest handoff. The goal is
paused. Do not restart workers, retry applications, change the profile, install
startup, commit, push, or create a worktree unless the owner asks to resume.

The owner is frustrated by repeated questions and repeated investigations that
do not produce verified applications. Before asking anything, inspect the
existing profile, scoped answers, prior conversation responses, and protected
application checkpoints. Do not ask again for a fact already confirmed. A SPAN
office-preference response arrived after the stop instruction; it is in the
conversation and was not saved to the protected profile. If work resumes, use
that response rather than asking again. It is distinct from whether the
posting's junior or senior role is the intended requisition.

Do not expose profile values, credentials, OTPs, mailbox contents, tokens,
browser storage, or raw trace content. Raw traces are in owner-protected
application state. The owner explicitly authorized eligible live applications,
subject to applicable execution review; that earlier authorization is not an
instruction to override the later stop.

## Verified outcome

The latest acceptance audit, 2026-11-02 15:23 UTC, found **0 of 50 independently
verified applications**. Three raw queue records marked applied were excluded
by the verifier. They are not new verified receipts. The queue contained 367
queued, 29 parked, 1,095 skipped and nine failed; the worker was stopped.

Stripe, Avoca and SS&C have ambiguous earlier submission clicks or dispatches
without verified receipts. Keep their tenants locked and never resubmit while
the outcomes remain uncertain. Do not let those locks stop unrelated tenants.

## What this execution did

Fifteen distinct tenants were scanned with final submission disabled. Thirteen
parked and two failed before reaching a form. No scanned role was established
as ready to submit, so the requested five-tenant live-submit canary was not run.
The redaction-checked `out/autoapply-scan-manifest.json` records reachable
questions and outcomes. Missing option lists are marked null; the manifest does
not establish what appeared on later, unreached steps.

Confirmed answers were saved in the protected profile for specific CEA,
Headout, Diagrid and GitLab questions, with protected backups. The SPAN response
arrived later and was not saved. A truthful GitLab release-tool example and
Diagrid personal examples remain unavailable; do not manufacture them or ask
the owner to repeat facts already supplied.

Focused changes and proof:

- `src/autoapply/preflight.ts` rejects missing descriptions, recognizes the
  observed “4 or more years” wording, and parks the observed conflicting
  junior-title/senior-description case. Focused preflight tests passed.
- `src/autoapply/classifier.ts` and `answers.ts` recognize the observed prior
  employment wording using complete confirmed history and employer context.
  The classifier no longer mistakes the observed employment-restriction question
  for a current-employer name. Focused answer tests passed.
- `src/autoapply/runner.ts` waits a bounded time for a late Apply control and
  no longer calls a zero-field page ready. Protected PayPal trace timing showed
  the initial visibility check happened before the Apply link appeared. A local
  replay passed; a single post-fix scan reached one filled field before parking.
  Zero-field tests proved no submit or quota reservation in both submit modes.
- The post-fix PayPal scan clicked account creation **11 times** on an unchanged
  form. This was a serious execution failure. `authentication.ts` and
  `runner.ts` now record each credential action before the click and honor the
  job checkpoint after restart. Local tests cover restart and checkpoint-write
  failure. Protection is job-scoped, not tenant-wide; PayPal account outcome and
  sibling-role safety remain unresolved. Do not automatically retry PayPal.
- A synthetic mixed-tenant worker test kept two ambiguous tenants locked while
  two unrelated tenants progressed. This is not evidence of a live application.

Compilation and the focused tests above passed. There was no broad suite, no
independent new receipt, and no startup installation. Original uncommitted work
remains in the checkout.

## Why progress stopped

This system has a pipeline, but its live stages have not been demonstrated
end-to-end. Several employers stopped at login, zero-field shells, selectors,
or required questions. Infineon timed out; a different NielsenIQ posting stopped
on a requisition mismatch. PayPal entered its application flow only after a
delayed-entry fix, then repeated account creation and parked. The owner supplied
some missing facts, but remaining personal narratives and job-specific options
cannot be guessed. Some postings have unconfirmed location, minimum experience,
or level; public preflight alone did not establish eligibility.

Past work repeatedly optimized individual widgets and synthetic fixtures without
producing a verified end-to-end receipt. The scan workflow initially lacked raw
trace capture, so several early widget failures cannot be faithfully replayed.
Later traces are protected, but require careful sanitization before exporting
fixtures. Status labels and generic HTTP success do not prove submission.

The architecture document `docs/autoapply-architecture.md` describes the broad
pipeline but contains stale claims: runtime model fallback is disabled by
default, and the Windows startup task is not installed. Prefer this handoff and
the latest evidence over old statements. All incomplete acceptance, security,
recovery and startup items remain in `docs/autoapply-master-tickets.md`.

If the owner later requests continuation, first account for their existing
answers and inspect process identity and the worker lock. Work from captured
evidence, fix the specific failure offline, verify it, and use fresh eligible
tenants. Do not repeat an unchanged live failure, weaken identity or receipt
proof, invent answers, or claim success without an independently verified disk
receipt. Treat an ambiguous or blocked tenant as isolated, not as a prerequisite
for all other work.
