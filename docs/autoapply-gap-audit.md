# Autoapply repair and reference audit

Checked 2026-10-29. Map work is outside this change.

## Reference evidence

REA 6.7.0 at `D:\REA` captured the public sites in an owned Chromium browser.
Scenarios requested DOM and URL artifacts, without login or application submission.
Captures and readable extracts remain under ignored `out/autoapply-research/`.

- [JobWizard](https://www.jobwizard.ai/), evidence
  `ev_b89dc5f4efa25733b838b35bb6279152f4b9665a2108cd06c4acfb3d0943fd35`.
  Public copy describes resume upload, supported ATS autofill, tailored cover
  letters, then “Review, submit, done.” It advertises LinkedIn, Greenhouse,
  Lever, Workday, Workable, Ashby and SmartRecruiters support.
- [Autoaply](https://autoaply.co/), evidence
  `ev_6214ed4f3a57da2c6b2c54e9db4161fcd269319c9d8f268866ffca3888df28f5`.
  Public copy describes uploading a resume, updating a profile, choosing a role,
  automatic applications within four hours of posting, and application analytics.

These captures establish advertised features, not implementation, accuracy,
private APIs or successful submissions. Existing source comments claiming
“reverse-engineered” proprietary internals are not substantiated by this audit.

## Repaired

- CLI requires a candidate profile and fails when it cannot load one. It no
  longer falls back to an invented identity, university, experience or salary.
- Unknown answers and consent questions remain unanswered. Explicit profile
  values preserve zero experience, false authorization and actual conviction
  answers. Arbitrary date components and signatures are no longer fabricated.
- Unmatched native select options remain unchanged instead of selecting the
  first available answer. Boolean radio choices use option values or labels;
  false checkboxes can be cleared.
- Dry runs do not fill fields, count hypothetical fills as completed fills, or
  advance wizard pages. Validation errors stop automatic advancement.
- Missing forms and missing Next buttons no longer imply completion. Queue
  records an application as applied only for an explicit `submitted` result;
  verified submission is now implemented as described below.
- Typing uses the original locator, including inputs inside frames and inputs
  with unusual IDs. Browser cleanup resets reusable runner state.
- Extension no longer supplies invented salary, demographic, history or consent
  answers. New installs start with empty education, authorization and EEO data.
  Existing saved profiles are preserved and must be reviewed by their owner.

## Implemented workflow, 2026-10-30

1. Submission is opt-in through `--submit`. Visible confirmation is required
   before recording an applied job. The checkpoint is written before the click;
   ambiguous outcomes cannot be automatically retried.
2. CLI uploads resume and cover-letter files from validated profile paths.
   Repeated histories use recognizable fieldsets and Add buttons. Custom
   comboboxes, frames, negative answers and required-option failures have local
   browser coverage. Unsupported structures still require manual review.
3. Candidate browser sessions and checkpoints persist. Headed review supports
   continuing one copilot step at a time, login/CAPTCHA handoff and reopening.
4. Durable candidate-specific queue supports catalogue import, URL deduplication,
   concurrent-writer locking, interrupted-run review, receipts and optional
   posting-age limits. Dry-run processing does not update application statuses.
5. Profile import validates nested answer types and document paths. Extension
   editing preserves unknown answers and zero values, and uploads actual file
   bytes. Existing profiles remain intact and require owner review.
6. Application preparation creates a resume PDF, cover letter, prepared profile
   and exact candidate-skill overlap report without inventing experience.

The executable workflow is covered by synthetic local browser fixtures and a
CLI batch run. This does not establish universal ATS support, prove proprietary
internals, or certify live employer acceptance. Employer-specific unusual
widgets and success messages may need additional adapters. No real employer
application has been submitted during verification.

## Validation

Run `npm run test:autoapply`, `npm test` and `npx tsc --noEmit`.
Browser regressions use a local fixture and synthetic candidate, never a real
employer submission. They cover dry-run non-mutation, negative boolean choices,
unknown consent, unusual IDs, empty pages and truthful queue status.
