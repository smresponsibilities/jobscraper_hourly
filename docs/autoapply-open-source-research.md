# Open-source autofiller research

Research checked on 31 October 2026. Upstream timestamps below are UTC. Actual
web searches found candidates; GitHub metadata, release endpoints and pinned
source files establish the observations. No downloaded project was executed and
no live application was sent during this research. This is a focused comparison,
not an exhaustive ranking of every autofiller.

## Versions checked

| Project | Verified default-branch commit | Latest release observed | Scope |
| --- | --- | --- | --- |
| [HarshadLambate/workday-autofill](https://github.com/HarshadLambate/workday-autofill) | [`0b288e522b075d4174f63eec86e8cc273b683963`](https://github.com/HarshadLambate/workday-autofill/commit/0b288e522b075d4174f63eec86e8cc273b683963), 30 October 2026 | [v0.5.0](https://github.com/HarshadLambate/workday-autofill/releases/tag/v0.5.0), published 30 October 2026 | Very recent job-specific Python autofiller; repository created 29 October 2026, so recent activity is not evidence of long production history |
| [geckguy/AutoApply](https://github.com/geckguy/AutoApply) | [`7b5e0a298c2181c26ba081f39d5c7086b8b8dd02`](https://github.com/geckguy/AutoApply/commit/7b5e0a298c2181c26ba081f39d5c7086b8b8dd02), 27 October 2026 | No GitHub release returned | Local backend and browser extension; useful field-learning and application-data separation |
| [ChamPro/ats-autofill](https://github.com/ChamPro/ats-autofill) | [`b2b23e3f7b96609139b95c380e7a804d475a205e`](https://github.com/ChamPro/ats-autofill/commit/b2b23e3f7b96609139b95c380e7a804d475a205e), 2 July 2026 | No GitHub release returned | Deterministic in-page filling toolkit and orchestration instructions; less recent than the October projects |
| [Skyvern-AI/skyvern](https://github.com/Skyvern-AI/skyvern) | [`5260ddd3c570a1cafb8a05b2d9b6dd9bde0e80f4`](https://github.com/Skyvern-AI/skyvern/commit/5260ddd3c570a1cafb8a05b2d9b6dd9bde0e80f4), 31 October 2026 | [v1.0.56](https://github.com/Skyvern-AI/skyvern/releases/tag/v1.0.56), published 14 October 2026 | General browser-workflow infrastructure, useful for session ownership rather than job-specific answers |

The first three repositories report MIT licenses; Skyvern reports AGPL-3.0.
These observations inform design; no upstream implementation is copied here.
Default-branch activity and published releases are separate facts.

## What the implementations actually do

### Recent Workday autofiller

`WorkdayFiller._start_application` prefers Workday's native previous-application
entry when its history says the same tenant was used, then resume import, then
manual entry. `run_jobs` launches one persistent browser context, creates a page
for each job and limits active filling with an asynchronous semaphore. That
reuses login state, but it is not a tenant-isolated scheduling design.

Two important limits appear in the source. `_applied_here_before` treats a
same-tenant `ready_for_review` log record as previous application history. The
tool stops before final submission, so that record is not employer proof.
Its JSONL report records filling status and skipped fields. We should require a
verified employer receipt before offering reuse of an actual prior application.
[Pinned workday.py, lines 254–323 and 952–1073](https://github.com/HarshadLambate/workday-autofill/blob/0b288e522b075d4174f63eec86e8cc273b683963/src/wdautofill/workday.py#L254).

The answer resolver tries profile facts, user rules and saved answers before
model assistance. Sensitive answers require an exact normalized bank match;
near matches become suggestions. Saved-answer scope is global or country-specific,
not employer/requisition-specific. That design is useful for repeated general
questions but is insufficient for cross-role employer answers.
[answer_bank.py](https://github.com/HarshadLambate/workday-autofill/blob/0b288e522b075d4174f63eec86e8cc273b683963/src/wdautofill/answer_bank.py#L58),
[resolver.py](https://github.com/HarshadLambate/workday-autofill/blob/0b288e522b075d4174f63eec86e8cc273b683963/src/wdautofill/resolver.py#L145).

### AutoApply

The local mapper resolves profile values, policies, corrections, uploads and
approved saved answers before sending unresolved questions to the model. Learned
corrections are filtered by hostname and platform. Sensitive categories default
to review when no policy exists. However, `best_answer` compares approved answer
text without checking its stored company or role, and the policy selector also
does not enforce its stored scope. These are reasons to retain stronger employer
and requisition boundaries in this project.
[local_mapper.py, lines 115–137 and 280–447](https://github.com/geckguy/AutoApply/blob/7b5e0a298c2181c26ba081f39d5c7086b8b8dd02/backend/services/local_mapper.py#L115),
[autofill.py, lines 105–119](https://github.com/geckguy/AutoApply/blob/7b5e0a298c2181c26ba081f39d5c7086b8b8dd02/backend/routers/autofill.py#L105).

Its database separates opportunities, answer-vault entries, per-application
answers and submission receipts. `add_receipt` stores a confirmation code/URL,
screenshot path and user-confirmed flag, then changes application status. This
storage operation does not itself establish that the employer accepted a request.
[database.py, schema and receipt insertion](https://github.com/geckguy/AutoApply/blob/7b5e0a298c2181c26ba081f39d5c7086b8b8dd02/backend/services/database.py#L125).

The extension explicitly distinguishes safe Next controls from submit-like
controls and checks retained values after framework events. Its final boundary
therefore cannot be cited as evidence of autonomous submission across employers.
[filler.js](https://github.com/geckguy/AutoApply/blob/7b5e0a298c2181c26ba081f39d5c7086b8b8dd02/extension/content/filler.js#L7).

### ATS Autofill toolkit

The toolkit rediscovers fields after mutations, addresses controls by labels,
checks form-reported gaps and bounded repair loops, and distinguishes native,
Workday and form-library behavior. Its architecture explicitly permits caching
structure while keeping free-text application answers specific to the current
job. It leaves final Submit to the user.
[dom-toolkit.js](https://github.com/ChamPro/ats-autofill/blob/b2b23e3f7b96609139b95c380e7a804d475a205e/skills/fill-app/dom-toolkit.js#L1),
[ARCHITECTURE.md](https://github.com/ChamPro/ats-autofill/blob/b2b23e3f7b96609139b95c380e7a804d475a205e/ARCHITECTURE.md#L102).

### Skyvern session ownership

Skyvern distinguishes an already-open browser session from a saved browser
profile. Its session guidance reuses a live session across follow-up runs,
already shares state within one workflow, and validates login through concrete
page conditions. A saved profile is a different mechanism from keeping an open
wizard tab.
[sessions.md](https://github.com/Skyvern-AI/skyvern/blob/5260ddd3c570a1cafb8a05b2d9b6dd9bde0e80f4/skills/skyvern/references/sessions.md).

Its browser-profile key implementation hashes a rendered profile key beneath
the workflow identity, providing explicit storage segmentation. The code does
not infer an employer identity by fuzzy company display-name matching.
[browser_profile_key.py](https://github.com/Skyvern-AI/skyvern/blob/5260ddd3c570a1cafb8a05b2d9b6dd9bde0e80f4/skyvern/forge/sdk/workflow/browser_profile_key.py#L36).

## Application to same-company grouping

1. Group jobs by canonical ATS tenant, with an origin fallback when no stable
   tenant identity exists. A display name is presentation data, not a credential
   or answer-sharing boundary.
2. Process one role at a time within that group and retain its authenticated
   browser owner. Reuse confirmed profile facts and expressly employer-scoped
   answers. Keep each role's drafts, screening answers, files and receipts distinct.
3. Prefer a native previous-application entry only when this candidate has an
   employer-confirmed prior application at that tenant; rescan every resulting
   field against the current profile and role.
4. Preserve the exact approved-role list. Grouping must not authorize additional
   jobs, copy role-specific essays, merge success counters, or retry an ambiguous
   submission. A company group is an execution/UI arrangement, not one combined
   application.

These are design recommendations derived from source observations. None of the
reviewed repositories establishes reliable bot evasion or guarantees complete,
receipt-proven autonomous application submission across all ATS platforms.
