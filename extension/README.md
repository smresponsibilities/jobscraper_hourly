# Jobscraper application autofill and submission

The CLI fills supported application forms, optionally submits them, and records
an application as applied only after observing a confirmation. The extension
provides profile editing and autofill, including document uploads. Submission
through the extension remains manual.

## Setup

Install project dependencies and Chromium with `npm install` and
`npx playwright install chromium`. Create a blank profile, then fill your own
answers. Omitted answers remain unknown. Document paths resolve relative to
the profile file. Keep profiles and browser sessions private.

```powershell
cd D:\Jobscraper-next
npm run auto-apply -- --init-profile "D:\private\candidate.json"
```

## Single application

```powershell
npm run auto-apply -- --url "https://example.com/application" --profile "D:\private\candidate.json" --mode copilot --headed
npm run auto-apply -- --url "https://example.com/application" --profile "D:\private\candidate.json" --dry-run
```

Copilot pauses before each Next step. Review in the browser and press Enter to
advance one step, or enter q to save and close. Reopen with the same URL and
profile plus `--resume --headed`. Login and CAPTCHA require browser review.
Stealth mode advances supported steps automatically. Neither mode submits
unless `--submit` is supplied. Dry run does not fill fields or advance pages.

```powershell
npm run auto-apply -- --url "https://example.com/application" --profile "D:\private\candidate.json" --mode stealth --submit
```

The default session directory is `state\autoapply\<candidate>`. A checkpoint
is saved before submission. A missing confirmation pauses the application and
prevents automatic resubmission. Check the employer's receipt before using
`--retry-reviewed single`. Confirmed submissions are retained across restarts.

## Catalogue queue

```powershell
npm run auto-apply -- --catalog "D:\Jobscraper-next\data\jobs.json" --profile "D:\private\candidate.json" --list-queue
npm run auto-apply -- --profile "D:\private\candidate.json" --run-queue --mode stealth --submit --max-jobs 10
```

Queue state persists, deduplicates tracking variants of URLs, locks concurrent
writers, and pauses interrupted applications for review. Add `--fresh-only`
to process only postings within `--max-age-hours`, default four. Undated and
future-dated postings fail that freshness check. Queue processing is headless
unless `--headed` is supplied. Headed queues keep the browser open at login,
CAPTCHA, validation or receipt handoffs. Login and challenge completion are
watched automatically, so clearing a gate resumes the application without Enter.
After a submission attempt, a late receipt is recorded automatically without
clicking Submit again. Enter also checks the current state; `q` saves and closes. Use
`--retry-reviewed <queue-id>` only after reviewing an unresolved attempt.
`--queue` and `--session` can
select explicit storage locations.

For automatic navigation through known fields, use `--mode stealth --submit`.
The legacy mode name means automatic advancement and paced typing, not proven
bot-detection evasion. Add `--headed` to handle an interactive gate and continue
receipt verification within the same run. Saved browser sessions reuse sign-in;
unknown required answers still pause. Explicit saved QA answers can be text or
booleans, so an approved Yes/No choice is reused without guessing. Unknown required
questions are displayed together. Update the candidate JSON and continue; the
CLI reloads it without restarting and rejects a changed candidate email.

## Application drafts

A job JSON containing `title`, `company`, and `text` can produce a resume PDF,
cover letter, skill overlap report, and prepared profile. Drafts use only
candidate-supplied facts. Review before using the prepared profile.

```powershell
npm run auto-apply -- --profile "D:\private\candidate.json" --prepare "D:\private\job.json" --output "D:\private\application-draft"
```

## Browser extension

Open Chromium's extension settings, enable Developer mode, choose Load
unpacked, and select `D:\Jobscraper-next\extension`. Review your profile,
including any values saved by older versions. Unknown questions need manual
answers. Documents are stored locally in extension storage.

## Verification and limits

Run `npm run test:autoapply`, `npm test`, and `npx tsc --noEmit`.
Tests use synthetic candidates and local forms, including actual local POSTs.
They do not certify universal ATS coverage or real employer acceptance.
Unsupported controls, validation failures, login, CAPTCHA, and missing receipts
pause for review. Repeated history support uses recognizable fieldsets and Add
buttons. Resume tailoring reports phrase overlap, not an ATS score.
