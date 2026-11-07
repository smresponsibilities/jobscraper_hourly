# Autoapply audit, tickets and acceptance plan

Audit date: 2026-10-31 (evidence collected 16:00-16:35Z). Scope: why autoapply
cannot be audited today, what actually stands between the current system and
the production gate, and exactly how to close each gap, test it, and call it done.

**This audit made no code, config, profile, queue or browser changes.** All queue
and checkpoint reads were read-only. Nothing was submitted. No candidate answers,
credentials or mail bodies were read or printed. The only files written are this
document and an ignored test log (`out/audit-2026-10-31-autoapply-suite.log`).

## How to read this document

Every factual claim carries an evidence tag.

| Tag | Meaning |
| --- | --- |
| **[O]** | Observed by this audit today, read-only, from `state/autoapply/portal-review/`, `out/` or source. Re-runnable with the commands in Appendix A. |
| **[D]** | Stated in an existing repo doc or `HANDOFF.md`. Not re-verified today. |
| **[W]** | From a public web page fetched today. Source and confidence in Appendix B. |
| **[I]** | Inference. Labelled so it can be checked, not trusted. |

Status vocabulary used for tickets and features (do not blur these):

1. **Implemented locally**: code exists, fixture tests pass.
2. **Verified live**: observed working against a real employer page, with a retained log or receipt.
3. **Production accepted**: counted by the acceptance audit with signed, network-anchored, zero-handoff proof.

Today: many things are *implemented locally*, a few are *verified live*, and
**nothing is production accepted. The count is 0/50 [O].**

---

## 1. Executive summary

**The system is not blocked by a lack of features. It is blocked by three things:
it cannot explain itself, its approved campaign cannot mathematically reach the
gate, and its evidence about live failures is stale.**

1. **Why you cannot audit it.** The facts needed to answer "why did this job not
   apply" exist, but are scattered across five stores (`queue.sqlite`,
   per-application `checkpoint.json` / `handoff.json`, `worker.json`, `intake-report.json`,
   and `out/*.log`) and are lost or overwritten at the boundaries between them.
   There is no `status` or `explain` command. See section 3.
   - All 6 `failed` queue rows say only `Runner returned non-completed status` or
     a raw Playwright message. The real reason is in the checkpoint file. [O]
   - `worker.json` still says `running` for PID 30372, 3 hours after it stopped. The process does not exist. [O]
   - `intake-report.json` keeps only the latest poll's decisions. Its current `decisions` array is empty. [O]
   - Every sampled runner report has an empty `logs` array. The useful log lines go to stdout only. [O]
   - `production-acceptance.json` was last audited 2026-10-30T19:07Z and explains none of its three exclusions beyond one generic code. [O]
2. **The approved campaign cannot succeed.** Of the 50 user-approved roles
   (`out/campaign-proposal.json`): 19 are now `skipped`, 6 `failed`, 9 `paused_for_review`,
   15 `queued`, 1 is not in the queue at all. 43 are Workday; only 3 Lever, 2 Greenhouse
   and 1 Ashby. The gate needs 50 verified successes with at least one on each of four
   providers. The ceiling is at most 30, and Lever, Greenhouse and Ashby together
   cannot reach more than 4. **The target is unreachable by construction, not by bug.** [O]
3. **The live-failure evidence is old.** 8 of the 9 parked-review handoffs were written
   2026-10-30 between 18:57Z and 19:10Z, before about a day of Workday fixes. Nobody
   currently knows which of those parks still fail on today's code. [O]

**What is actually blocking real applications, ranked by evidence:**

| Rank | Blocker | Evidence |
| --- | --- | --- |
| 1 | Workday multi-step forms: required answers unknown, widget interaction, auth/verification gates, step convergence | 43 of 50 approved roles; 7 of 9 parked reviews and 6 of 6 failures are Workday [O] |
| 2 | Unknown required owner facts (referral source, prior employment, state/location, notice/CTC, free-text experience) | Handoff question lists, section 2.5 [O] |
| 3 | A loaded page that is not the requested requisition (3 failures) | PayPal x2, PwC checkpoints [O] |
| 4 | Apply-entry click and page-readiness timeouts (3 failures) | Airbus x2, Caterpillar checkpoints [O] |
| 5 | Final Submit not found (2 parks), step limit with nothing filled (2 parks) | Plane (Ashby), Airbus x2 [O] |
| 6 | One unresolved same-origin POST on ABB for over 15 minutes | Worker log and checkpoint [O][D] |

Automation detection did **not** appear as a cause of any observed failure.
No checkpoint records a CAPTCHA or block as the failure reason [O]. That is
not proof of safety. See section 5.

Sections 11 and 12 answer two further questions: what the project keeps looping on (a one-role live
fix loop, constants used as control flow, circular verification) and what it takes to reach
state-of-the-art practice (capture, offline replay, progress detection, measurement). The revised
order in section 12.4 supersedes the order below wherever they differ.
Section 13 is a second-pass review: it lists corrections to this document, new security,
privacy and vendor-behaviour gaps with tickets, and what this audit did not cover.
**Section 14 records the owner's decisions (single user, semi-fit bulk applying, no AI, no test
suite, run the applier, 0-3 year hourly pool) and supersedes earlier sections where they
conflict. Section 15 is the one consolidated list of everything left.** Two findings there change
the plan most: the applier's experience gate uses the profile's 1 year while the pool is 0-3
(246 skipped roles have a catalogue minimum of 2-3 years), and the AI model is currently active
because API keys are set.

**What to do first, in order (details in sections 6 and 7):**

1. Bundle A, "truthful state" (OBS-01, OBS-02, OBS-04). Failures keep their real reason; worker liveness stops lying.
2. Bundle B, "see it" (OBS-03, OBS-05). One `status` command and one per-job event journal.
3. Bundle C, "valid campaign" (FUN-01, FUN-03). Re-validate and rebalance the approved set, with owner re-approval.
4. Re-run the 9 stale parked reviews sequentially on current code (FIX-00) to find which failures still exist.
5. Repair failure classes one at a time, each with a failing fixture first.

---

## 2. Evidence gathered today

### 2.1 Queue funnel [O]

`state/autoapply/portal-review/queue.sqlite`, 1,501 rows, read-only, ~16:30Z.

| Status | Rows | Note |
| --- | --- | --- |
| applied | 3 | AiPrise (Ashby), UiPath (Ashby, `existing: true`), Abacus (Greenhouse). All three were completed or reconciled with the owner. None counts toward acceptance. |
| paused_for_review | 9 | See 2.4 |
| failed | 6 | See 2.3 |
| queued | 410 | See 2.2 |
| skipped | 1,073 | See below |
| applying | 0 | No leaked claim |

Skip reasons (the `error` field on skipped rows):

| Reason | Rows | Share of skipped |
| --- | --- | --- |
| `ineligible_jd_experience` | 536 | 50.0% |
| `closed_in_catalogue` | 466 | 43.4% |
| `stale_catalogue_entry` | 43 | 4.0% |
| `ineligible_jd_location` | 27 | 2.5% |
| `ineligible_jd_citizenship_or_clearance` | 1 | 0.1% |

Half of all skips are experience skips. 44 of those 536 have entry-level-looking titles
(Associate, Junior, "I"). This is only a **sample to verify** (FUN-02), not a claim that
they were wrongly skipped. The real minimum years comes from the posting text, which was
not re-read.

The catalogue snapshot had 18,373 rows at last intake [D]; the queue has 1,501 [O].
Nothing records why the remaining ~16,900 never entered the queue (FUN-04).

### 2.2 Queued backlog [O]

410 queued: Workday 259, Lever 31, Greenhouse 28, Ashby 26, SmartRecruiters 26,
Eightfold 25, other 15. By posting age at 16:30Z: 381 within 7 days, 3 at 8-30 days,
13 at 31-180 days, 5 over 180 days, 8 undated. The worker re-runs preflight before each
claim [O: `worker.ts` lines 205-209], so stale items are caught late rather than never.
Eightfold, SmartRecruiters and "other" cannot count toward the four-provider gate.

### 2.3 Failures [O]

| Queue says | Checkpoint says (the real reason) | Count |
| --- | --- | --- |
| `Runner returned non-completed status` | `Loaded application belongs to a different requisition` (PayPal x2, PwC) | 3 |
| `Runner returned non-completed status` | `locator.click: Timeout 5000ms exceeded` on an Apply link (Airbus x2) | 2 |
| `Runner returned non-completed status` | `locator.waitFor: Timeout 5000ms exceeded` waiting for body (Caterpillar) | 1 |

The queue string comes from `autoaply.ts` line 425. `worker.ts` returns the full report
including `report.reason`, and `processNext` drops it. That is the single cheapest fix in
this document (OBS-01).

### 2.4 Parked reviews [O]

| Employer / ATS | Parked reason | Handoff written (UTC) |
| --- | --- | --- |
| ABB, Workday | Network wait timed out, converted to `answers` review, no Submit attempted | 2026-10-31 12:32 |
| Arrow, Workday | `client_validation_error: no application request dispatched` | 2026-10-30 18:58 |
| Citi, Workday | Validation or field errors; 3 listed questions, 4 unmapped fields | 2026-10-30 18:59 |
| GEHC, Workday | Validation; the recorded actions begin with Password and Verify New Password as "Required answer is missing", so account creation was not treated as authentication at that time (the third listed question was not individually checked) | 2026-10-30 18:59 |
| JLL, Workday | Validation; 6 questions (source, prior employment, state, phone type, phone code) | 2026-10-30 19:02 |
| eClinical, Greenhouse | Validation; 12 filled, 27 unmapped | 2026-10-30 18:57 |
| Plane, Ashby | `No supported submit control found` | 2026-10-30 18:57 |
| Airbus x2, Workday | `Step limit reached; review before continuing`; 0 fields found | 2026-10-30 19:06 and 19:10 |

Eight of nine predate the 2026-10-31 repairs recorded in `HANDOFF.md` (delayed
authentication, input integrity, Workday selectinput and active-list scoping, visibility,
row-order, scroll-before-click, network pause, stale-control reacquire). Their handoffs
therefore show **historical** failures, not current ones. [O][D]

### 2.5 Most frequent unanswered required questions [O]

Across all nine handoffs. Labels only; no answers were read.

| Count | Label |
| --- | --- |
| 2 each | Prior employment at the employer; Email Address; Password; Verify New Password |
| 1 each | How did you hear about us; State; Phone Device Type; Country Phone Code (click timeout); Location (City); current CTC; expected CTC; notice period; hybrid-in-office willingness; three free-text experience questions |

Password and Email appearing as "questions" is the delayed-authentication bug already
repaired [D]; those rows are stale evidence. Everything else is genuinely owner-dependent.

### 2.6 Worker, acceptance and tests [O]

| Item | Observed |
| --- | --- |
| `worker.json` | `status: running`, `pid: 30372`, `observedAt 2026-10-31T13:22:28Z`. At 16:34Z no such process exists (3h12m stale). It still lists one parked job (ABB). |
| `production-acceptance.json` | `auditedAt 2026-10-30T19:07:29Z`, `verifiedCount 0`, three exclusions, all `no_new_supported_application_proof`. All three applied receipts lack `evidenceDir` [O]; this is probably because they predate evidence bundles [I]. UiPath is `existing: true` [O]. |
| `intake-report.json` | `fetched: false`, `decisions: []` (304 poll overwrote the previous decisions). |
| Typecheck | Clean today (`tsc --noEmit`, no errors). |
| Autoapply suite | See section 8.1 for today's result. |
| CDP probes | `out/cdp-diagnostic.json`, 2026-10-30T16:32Z, headed branded Chrome via Patchright: `runtimeEnableLeak`, `navigatorWebdriver`, `sourceUrlLeak` all "no leak". Four probes only. |
| REA runtime | `D:\REA\dist` does not exist; `node D:\REA\scripts\rea.mjs --help` and the global `rea-agents` copy both print "REA's compiled runtime is missing". Not built today (see REA-01). |

---

## 3. Why autoapply cannot be audited today

Each row is a defect in observability, not in application logic. All are fixable
without changing what the runner does.

| ID | Defect | Effect | Ticket |
| --- | --- | --- | --- |
| G1 | Queue failure reason is generic (`autoaply.ts:425`) or a raw exception string | Cannot group failures by cause from the queue | OBS-01 |
| G2 | No machine-readable failure taxonomy; reasons are free text, some with selectors | Cannot count, trend or alert | OBS-02 |
| G3 | No `status` / `explain` command | Every question needs ad-hoc SQL and JSON spelunking, as this audit did | OBS-03 |
| G4 | `worker.json` has no heartbeat and is never marked dead | Reports `running` for a dead worker | OBS-04 |
| G5 | No per-job event history. Only the latest checkpoint survives. `report.logs` is empty. | Cannot reconstruct what happened between claim and park | OBS-05 |
| G6 | Skip decisions: only the `error` string persists. `intake-report.json` is overwritten each poll. The matched phrase and parsed minimum years are not kept. | Cannot audit the 536 experience skips | OBS-06 |
| G7 | Parks with empty `questions` (step limit, no submit control, network) carry no structured cause or screenshot pointer in the handoff | Reviewer must open the tab or PNG | OBS-07 |
| G8 | Acceptance audit does not run automatically and does not explain exclusions | `production-acceptance.json` is a day stale and opaque | OBS-08 |
| G9 | Runs are identified by exec-session numbers in prose in a 2,700-line chronological `HANDOFF.md`; later sections supersede earlier ones | No reproducible record of "which code, which flags, which result" | OBS-09 |
| G10 | Docs use "complete" checkboxes (`autoapply-completion-plan.md` is all `[x]`) while production is 0/50 | Easy to misread local completion as readiness | OBS-10 |

---

## 4. Findings on the system itself

| ID | Severity | Finding | Evidence |
| --- | --- | --- | --- |
| F1 | High | Approved 50 cannot reach the gate (infeasible by count and provider mix) | 2.1, section 1 [O] |
| F2 | High | Failure evidence for 8 of 9 parks is pre-repair | 2.4 [O] |
| F3 | High | Failure reasons are discarded at the queue boundary | 2.3 [O] |
| F4 | Medium | Experience gate removes half of all skipped rows with no kept justification | 2.1 [O] |
| F5 | Medium | Three loaded-requisition mismatches are recorded as `failed`. They might be closed or redirected postings, which would belong in `skipped`. Unknown without a diagnostic. | 2.3 [O][I] |
| F6 | Medium | Headless intent is set in two places. `worker.ts` `optionsFor` hardcodes `headless: false` while `forkApplication` receives `config.headless`. With `--headless` the browser would launch headless anyway. `applicationCountry: 'India'` is hardcoded. | `worker.ts` lines 72-77, 84 [O] |
| F7 | Medium | `stealth.ts` header still says "Reverse-engineered from FastApply's stealth human emulation". `HANDOFF.md` and `autoapply-gap-audit.md` already say such claims are unsubstantiated. | `stealth.ts` lines 1-4 [O][D] |
| F8 | Medium | Account creation by automation on tenant career sites may conflict with tenant terms. One Workday-powered candidate portal states that "each account created must represent a person, not any sort of automated bot". This is one example, not every tenant. | Appendix B [W] |
| F9 | Low | CI workflow and startup scripts were never run or installed. Owner chose "keep changes local". | `HANDOFF.md` [D] |
| F10 | Low | A single ABB POST pending over 15 minutes is still undiagnosed. The cause is a hypothesis in `HANDOFF.md`. | [D] |
| F11 | High | Most autoapply work is uncommitted. 45 of 54 files in `src/autoapply` are untracked; 19 tracked files are modified. See W6. | `git status` [O] |
| F12 | Medium | The proposal and the worker use different eligibility rules: 16 of 19 skipped approved roles are experience skips. See L7. | [O] |
| F13 | Medium | About 15 live sessions at one tenant (ABB) in about 18 hours. Besides cost, this resembles the burst pattern that fraud and lockout controls react to. See W1. | [D][I] |

---

## 5. Automation-detection posture

### 5.1 Position, stated plainly

"Never detected as automation" **cannot be promised and must not be claimed.** The
platforms disclose that they score applications on signals the automation does not fully
control, and some of these vendors' tooling changes without notice. The achievable and
testable goal is narrower and more useful:

> The automation behaves like one careful applicant on the owner's own machine, own network
> and own email, applying once per requisition at a human volume. Any challenge or block is
> detected, parked for the owner, and counted. It is never defeated.

This matches the existing rule in `HANDOFF.md` that CAPTCHA handling is detection and
handoff, not bypass, and that the old fingerprint and mouse helpers do not establish
evasion. Timing and pointer realism improve consistency and trusted-event behaviour. They
are not evidence of undetectability.

### 5.2 What the vendors say they look at [W]

| Platform | Publicly stated controls | Confidence |
| --- | --- | --- |
| Greenhouse | Invisible reCAPTCHA scores mouse movement and typing patterns. A low score can trigger an emailed verification code instead of a hard block. Spam sensitivity is configurable per board. Separate fraud detection uses IP, user agent, email and phone traits. Examples given: data-centre IP is a strong signal; device-timezone vs reported-location mismatch is a weak signal. Employer spam blocklists reject by IP, email or email domain silently. | High (Greenhouse support, Mar 2026 and Jan 2026) |
| Ashby | Application spam protection verifies submissions and attempts to tell a real candidate from a bot. Four employer-set levels from Strict to No Protection. Fraud detection uses device, IP, email and phone. | High (Ashby docs, updated Jul 2026) |
| Lever | Public Postings API apply requires a per-posting-form API key and is rate limited (2 POST/s per site per a third-party OpenAPI mirror). It is for the employer's own site, not a route for us. A third-party GitHub project describes an invisible hCaptcha on the web form; Lever itself was not found documenting it. | Medium for the key requirement; low for hCaptcha |
| Workable | WAF, IP reputation and browser-integrity checks. Applications that match "AI application tool" patterns are tagged AI-assisted and can be filtered. Generated mailbox addresses are replaced by the resume email when available. | High (Workable help) |
| Workday | No candidate-facing published rule found for automated applying. `workday.com` terms restrict apps interacting with those sites, and do not govern an employer's `myworkdayjobs.com` tenant. Tenants add their own terms and may add third-party integrity tools. | Medium (Workday terms; tenant example) |
| SmartRecruiters | DataDome observed live (this repo, 2026-10-30) | [D] |
| iCIMS | hCaptcha observed after email step; one 403 page observed | [D] |

Third-party "auto apply" blogs cite precise Workday detection percentages with no source.
This audit does not use them.

### 5.3 What this system already does, and what is unmeasured

| Signal vendors cite | Current state | Status |
| --- | --- | --- |
| Datacenter or proxy IP | Runs on the owner's machine and network | Good by design; must stay true (DET-01) |
| Device timezone vs location | No timezone/locale override; browser inherits the OS | Good if the owner is in the target region. Not asserted anywhere (DET-01) |
| Generated or throwaway email | Uses the candidate's real address | Good; keep as an invariant (DET-01) |
| Duplicate applications | Canonical requisition keys; durable dedupe | Good [D] |
| `navigator.webdriver`, CDP runtime leak, source-URL leak | Patchright, branded Chrome, headed. Four probes clean on 2026-10-30. | Local probes only (DET-02) |
| Typing and pointer behaviour | Log-normal key timing, cubic pointer paths, 4-8 s step dwell, 15-30 s review dwell | Implemented; effect on scores unknown (DET-02) |
| Volume and burst | Sequential by design; one tenant owner per browser; no per-hour or per-day cap | Gap (DET-03) |
| Challenge encountered | Detected for reCAPTCHA, hCaptcha, DataDome, Cloudflare; parked for the owner | Implemented; not counted or trended (DET-04) |
| Headless | Worker option exists; intent split in two places | Inconsistent (F6, DET-01) |
| Tenant ToS | Not checked or recorded | Gap (DET-06) |

### 5.4 Things this plan deliberately does not do

- No CAPTCHA-solving services or token farms.
- No generated or rotating mailboxes. Workable and Greenhouse both flag these.
- No proxy, VPN or residential-IP rotation, and no fingerprint spoofing beyond a real browser. Mismatch between device and claimed location is itself a signal.
- No fabricated identity or answers to look more human or to get past a gate.
- No retry of a dispatched submit to "get past" a score.

---

## 6. Tickets

Prefixes: **OBS** observability, **FUN** funnel and eligibility, **FIX** failure-class repair,
**ACC** acceptance and live protocol, **DET** detection posture, **REA** research tooling,
**TST** test infrastructure. These do not collide with existing `STEALTH-`, `FORM-`, `AUTH-`,
`SUB-`, `ATS-`, `RECOVERY-` tickets in `autoapply-tickets.md`.

Size: S = under half a day, M = 1-2 days, L = 3-5 days. Rough; use for ordering, not commitments.

Every ticket is a **plan**, since this audit makes no code changes. Each follows the same
shape: problem, approach, bundle and dependencies, test, definition of done.

### Epic OBS: make it auditable (do first, changes no application behaviour)

#### OBS-01 Persist the real failure reason (S)
- **Problem:** `processNext` writes `Runner returned non-completed status` and discards `result.reason` (G1, 2.3).
- **Approach:** in `autoaply.ts` use `result.reason` when present. For thrown errors keep the message but pass it through a sanitizer that strips selectors, URLs with query strings and anything resembling values. Add `lastOutcome {status, reasonCode, reasonText, atStep, host, at, checkpointPath}` to the job payload. No schema-breaking change; payload is JSON.
- **Bundle:** A, with OBS-02 and OBS-04. Depends on nothing.
- **Test:** unit test in `store.test.ts` / `autoapply.test.ts`: a runner returning `{status:'failed', reason:'X'}` yields stored reason `X`; a throwing runner yields a sanitized message; reading an old row without `lastOutcome` still works.
- **DoD:** the six existing failed rows can be re-derived into their real reason by a read-only script using checkpoints; new failures show their real reason in the queue; no value or credential appears in any stored reason (test with a canary secret in the thrown message).

#### OBS-02 Failure and park taxonomy (S)
- **Problem:** reasons are free text (G2).
- **Approach:** a closed enum `reasonCode` with a table mapping every string seen so far: `IDENTITY_MISMATCH`, `APPLY_ENTRY_TIMEOUT`, `PAGE_NOT_READY`, `REQUIRED_ANSWER_MISSING`, `FIELD_ACTION_FAILED`, `CLIENT_VALIDATION`, `NO_SUBMIT_CONTROL`, `STEP_LIMIT`, `AUTH_REQUIRED`, `EMAIL_VERIFICATION_PENDING`, `NETWORK_PENDING`, `NETWORK_WAIT_TIMEOUT`, `CHALLENGE`, `SUBMIT_AMBIGUOUS`, `CLOSED_AT_SOURCE`, `UNKNOWN`. Unknown strings map to `UNKNOWN` and must be logged so the table grows deliberately.
- **Bundle:** A. Depends on OBS-01 only for storage.
- **Test:** table-driven test over the real strings in section 2.3 and 2.4; test that an unmapped string yields `UNKNOWN` and is not dropped.
- **DoD:** every distinct reason string present in the current queue and checkpoints (count them first; this audit saw roughly 15) maps to a non-`UNKNOWN` code.

#### OBS-03 Read-only `auto-apply:status` and `explain` commands (M)
- **Problem:** no single place answers "where are we and why" (G3).
- **Approach:** new CLI command, opens `queue.sqlite` read-only. `status`: counts by status, reasonCode, provider and tenant; parked reviews with age and reviewKind; worker liveness (OBS-04); last acceptance audit and its age; approved-set feasibility (FUN-01); intake last-poll age. `explain <jobId>`: the job's timeline from the journal (OBS-05), last checkpoint summary, and the exact next human action. `--json` for tooling. Never prints candidate values, tokens or mail.
- **Bundle:** B, with OBS-05. Depends on OBS-01, 02, 04.
- **Test:** fixture queue with every status; snapshot test of JSON output; a test that seeds a canary secret into the profile and asserts it never appears in output.
- **DoD:** reproduces every number in section 2 from one command, and that output is attached to the PR. `explain` on the six failed and nine parked rows gives the same reason this audit derived by hand.

#### OBS-04 Worker heartbeat and honest liveness (S)
- **Problem:** `worker.json` says `running` for a dead PID (G4).
- **Approach:** add `heartbeatAt` (every ~15 s) and `startedAt`. Readers treat the worker as `running` only if the PID exists, its start time matches, and the heartbeat is under 60 s old; otherwise `crashed` or `stopped`. On startup, a stale predecessor is recorded as `crashed` with the last known state.
- **Bundle:** A. Depends on nothing.
- **Test:** unit test with a fake clock and a dead PID; integration test that kills a worker process mid-run and asserts the reader reports `crashed` within one interval. `worker.test.ts` already has kill/restart scaffolding to extend.
- **DoD:** with today's `worker.json` and no live process, the reader reports `crashed`/`stopped`, never `running`.

#### OBS-05 Append-only per-job event journal (M)
- **Problem:** only the latest checkpoint survives; `report.logs` is empty (G5).
- **Approach:** JSONL per application session: claimed, preflight result, each wizard step with counts (found/filled/failed, never values), gate detected and kind, park/resume, submit prepared/clicked/dispatched/confirmed (reuse the submission states), outcome. Hash anything sensitive. Rotate by size. Stop writing the same lines only to stdout; route runner log lines here and fill `report.logs`.
- **Bundle:** B. Depends on OBS-02 for codes.
- **Test:** fixture runs from `dynamic-form.test.ts` and `submission.test.ts` assert expected event sequence; a canary-secret test; kill mid-step test asserts the journal is readable and ends at the last durable event.
- **DoD:** for any job, `explain` can reconstruct claim-to-outcome without reading stdout logs.

#### OBS-06 Durable, explainable skip decisions (M)
- **Problem:** skip reason is one string; the experience decision keeps no evidence (G6).
- **Approach:** append each preflight decision (job key, catalogue hash, reasonCode, parsed `minYears`, the matched phrase or sentence, source of the number) to `intake-decisions.jsonl`. Keep `intake-report.json` as "latest poll" and stop treating it as history. A 304 poll writes nothing.
- **Bundle:** C-prep, with FUN-02. Depends on nothing.
- **Test:** `intake.test.ts` and `preflight` fixtures: each skip class writes one record with evidence; a 304 poll leaves history untouched; idempotent across repeated polls.
- **DoD:** every `ineligible_jd_experience` row can be shown with the sentence that caused it.

#### OBS-07 Complete handoffs for non-question parks (S)
- **Problem:** four parks have empty `questions` and no structured cause (G7).
- **Approach:** every handoff includes `reasonCode`, `reviewKind`, step index, ATS strategy used, `review.png` and sanitized DOM pointers, and a one-line next action ("complete sign-in", "supply answer X", "inspect missing Submit").
- **Bundle:** B. Depends on OBS-02.
- **Test:** `recovery.test.ts` style fixtures for step limit, missing submit and network wait assert the fields.
- **DoD:** no parked handoff lacks a code and a next action.

#### OBS-08 Self-running, self-explaining acceptance audit (S)
- **Problem:** audit is manual and opaque (G8).
- **Approach:** run `auditAcceptance` at worker start, after every terminal outcome and in `status`. Each exclusion carries a specific reason (`predates_evidence_bundles`, `existing_application`, `provider_not_in_gate`, `manual_assist`, `duplicate_requisition`, `evidence_verification_failed` with the verifier's message) instead of one catch-all. Record `completionMode: autonomous | assisted | existing`.
- **Bundle:** C-prep. Depends on OBS-01.
- **Test:** `acceptance.test.ts` fixtures per exclusion reason; real-queue read-only run must classify the three applied rows as `predates_evidence_bundles` / `existing_application`.
- **DoD:** `production-acceptance.json` is never older than the last terminal outcome and no exclusion uses the generic code.

#### OBS-09 Run ledger replaces prose session numbers (M)
- **Problem:** runs are identified by transient session numbers in `HANDOFF.md` (G9).
- **Approach:** every worker or CLI launch writes `runs/<runId>/run.json`: sanitized argv, git SHA plus dirty flag, node and Chrome versions, approved-set hash, start/end, exit code, log path. `status` lists the last N runs. `HANDOFF.md` references run IDs.
- **Bundle:** B (low risk, can ship later). Depends on nothing.
- **Test:** launch/stop fixture asserts the ledger entry, exit code and that secrets in env/argv are redacted.
- **DoD:** any failure can be tied to the exact code revision and flags that produced it.

#### OBS-10 One current-state page, with status vocabulary (S)
- **Problem:** `HANDOFF.md` autoapply sections are chronological and partly superseded (G9, G10).
- **Approach:** add a short "Autoapply current state" block at the top of the autoapply part of `HANDOFF.md`, generated or hand-written from `status` output, using the three-level vocabulary from this document. Mark `autoapply-completion-plan.md` checkboxes as "implemented locally", not "complete".
- **Bundle:** docs only, after Bundle B so the numbers come from the tool.
- **Test:** none beyond review; the numbers must match `status`.
- **DoD:** a new session can state the correct state of autoapply from one page without reading 700 lines.

### Epic FUN: make the funnel true

#### FUN-01 Approved-set lifecycle and feasibility check (M)
- **Problem:** the approved 50 are partly dead and mis-balanced (F1).
- **Approach:** an approval is a file with `createdAt`, an exact URL list, a content hash and an expiry. Before a campaign starts, `status` computes feasibility: each role's current state, remaining reachable count, and per-provider counts against the gate. If the gate is unreachable it **refuses to start** and says why. Proposal generation takes a per-provider quota and re-runs preflight so every proposed role is live and eligible at proposal time.
- **Bundle:** C. Depends on OBS-03.
- **Test:** unit tests with the real mix (43/3/2/1) asserting "unreachable"; with a balanced fixture asserting "reachable"; an expired approval is rejected.
- **DoD:** today's `campaign-proposal.json` is reported unreachable with numbers; a regenerated proposal has live eligible roles for each gate provider. **Owner re-approval is required before any run** (D1 below).

#### FUN-02 Experience-gate precision audit (M)
- **Problem:** 536 experience skips with no justification (F4).
- **Approach:** after OBS-06, sample at least 100 skipped rows stratified by provider and title seniority. Read the posting text, label "requirement truly exceeds profile" or not, and compute false-skip rate. Do not change the profile's stated experience. If the rate exceeds the threshold, fix the extractor (for example "or equivalent", ranges like "0-2 years", "preferred" vs "required").
- **Bundle:** C. Depends on OBS-06.
- **Test:** every labelled disagreement becomes a regression case in the `classify.ts` / preflight tests (also run `npm test`, because `classify.ts` changes need `src/selftest.ts`).
- **DoD:** false-skip rate at or under 5% on the labelled sample, with the sample and labels committed under `test/` or an ignored evidence path, plus `npm test` green.

#### FUN-03 Freshness and provider-diverse scheduling (S)
- **Problem:** a 410-row backlog includes year-old postings and cannot reach non-Workday gate providers fast (2.2).
- **Approach:** order the claim queue by posting age and provider quota. Revalidate liveness immediately before claiming (already done). Deprioritise providers outside the gate during acceptance runs (already partly in `supported()`).
- **Bundle:** C. Depends on FUN-01.
- **Test:** `company-batches.test.ts` / queue ordering tests with a mixed fixture.
- **DoD:** in a fixture of the current mix, the first 20 claims include every gate provider that has an eligible role.

#### FUN-04 Explain the catalogue-to-queue gap (S)
- **Problem:** 18,373 catalogue rows, 1,501 in the queue, no record of why (2.1).
- **Approach:** run an intake-only pass (`--intake-only`) against the cached snapshot with decisions persisted (OBS-06), and publish counts per decision. Read-only to employers except the existing public liveness GETs.
- **Bundle:** C. Depends on OBS-06.
- **Test:** `intake.test.ts` fixture for count conservation: every row is queued, skipped with a code, or retried; no row vanishes.
- **DoD:** the sum of decisions equals the catalogue size, and the gap is accounted for.

### Epic FIX: repair failure classes

**Rule for every FIX ticket: write the failing fixture first, from a sanitized structural
capture, before changing the runner. One failure class per change.** Do not bypass identity
checks or retry a possibly dispatched submit.

#### FIX-00 Re-run the nine stale parks sequentially on current code (M)
- **Problem:** F2. We do not know which parks still fail.
- **Approach:** after Bundle A, with explicit owner approval per role (approved boundary only), run each parked role one at a time with `--review-steps` and no Submit, until its park reason is recorded in the journal. Output is a table: role, old reason, new reason, fixed or still failing.
- **Bundle:** gate for all other FIX tickets. Depends on OBS-01, 02, 04, 05.
- **Test:** this is the test. Zero submits permitted; assert `submissionAttempted=false` for every run.
- **DoD:** the nine rows each have a current reason and are assigned to a FIX ticket or closed as fixed.

#### FIX-01 Identity mismatch: classify, do not bypass (S)
- **Evidence:** PayPal x2, PwC (F5).
- **Approach:** record expected vs loaded identity keys (non-secret). If the loaded page is a closed-posting or listing redirect, reclassify as `CLOSED_AT_SOURCE` (skipped). If it is a genuine different requisition, keep `failed` with the cause visible.
- **Test:** fixtures for a redirect-to-listing and for a real wrong requisition.
- **DoD:** no mismatch lands as an anonymous `failed`; the existing safety check is unchanged (test that it still blocks).

#### FIX-02 Apply entry and readiness timeouts (M)
- **Evidence:** Airbus x2 (click on Apply link, 5 s), Caterpillar (`body` wait, 5 s).
- **Approach:** capture the actual pages (REA or Playwright, read-only), identify the real Apply control and readiness marker. Replace fixed 5 s waits with state-based readiness. Keep timeouts bounded.
- **Test:** structural snapshot fixture per employer in `portal-snapshots.test.ts`; a delayed-mount fixture.
- **DoD:** both pages reach the first form step, or park with a specific code.

#### FIX-03 Step limit with zero fields (M)
- **Evidence:** Airbus x2, 0 fields found, 12-step limit.
- **Approach:** read the journal after FIX-00. The likely class is a sign-in or create-account loop [I]; confirm before changing anything.
- **Test:** fixture reproducing the observed sequence; assert the runner parks at the gate with `AUTH_REQUIRED` or progresses.
- **DoD:** no run burns the step limit without filling anything.

#### FIX-04 No Submit control found (M)
- **Evidence:** Plane (Ashby) and one Oracle checkpoint.
- **Approach:** capture the final page. Possible causes to rule in or out: spam-protection interstitial, consent step, a custom button label. Do not assume.
- **Test:** snapshot fixture of the real final page.
- **DoD:** the control is found, or the park names the actual blocker.

#### FIX-05 Workday required-answer families (L)
- **Evidence:** JLL, Citi, ABB list in 2.5.
- **Approach:** for each question family (source, prior employment, state/location, phone type/code) confirm after FIX-00 whether current code handles it. Missing facts go to the owner list (D2). Do not infer facts.
- **Test:** existing Workday fixtures plus one per remaining family from live markup.
- **DoD:** each family either fills correctly with a retained value, or parks as `REQUIRED_ANSWER_MISSING` with the exact label.

#### FIX-06 ABB pending POST and Voluntary Disclosures convergence (M)
- **Evidence:** worker log, checkpoint, `HANDOFF.md`.
- **Approach:** diagnose the pending request's class using method, host and hashed route only, which the runner already records. Determine whether it is a long-poll, a blocked request or a wait on authentication. Do not change the wait policy before this is known.
- **Test:** held-response fixture already exists; add the observed pattern once the class is known.
- **DoD:** the cause is named, and the run either converges or parks with `NETWORK_WAIT_TIMEOUT` and the class.

#### FIX-07 Greenhouse dynamic dropdown and required answers (M)
- **Evidence:** eClinical (12 filled, 27 unmapped); known open item in `HANDOFF.md`.
- **Approach:** stabilise the dropdown locator, then separate genuinely unknown answers from mapping failures.
- **Test:** snapshot fixture from the real board.
- **DoD:** reaches review with every non-owner question answered or parked by label.

#### FIX-08 Single-source headless / locale configuration (S)
- **Evidence:** F6.
- **Approach:** one place decides headless, and the worker records it in the run ledger. Move `applicationCountry` to the profile or a flag.
- **Test:** unit test that `--headless` and the browser launch agree.
- **DoD:** configuration is observable in `status` and cannot disagree with launch.

### Epic ACC: acceptance and live protocol

#### ACC-01 Reach-the-review-page metric, before any more submits (M)
- **Problem:** the only success metric is a submitted, receipted application. That is slow, risky and uninformative per failure.
- **Approach:** add a leading metric through the existing review path. For each role record how far it got: loaded, authenticated, form found, filled, validated, final review page reached, Submit prepared. Run with `--review-steps` or a final-review stop and **no Submit**. Per provider, the rate is reported in `status`.
- **Bundle:** after Bundle B. Depends on OBS-05.
- **Test:** fixtures assert each stage is recorded once and out of order stages are rejected.
- **DoD:** `status` shows a per-provider stage funnel from real runs.

#### ACC-02 Sequential canary protocol (M)
- **Approach:** see section 8.3. One role at a time, per provider, from a freshly validated approved set, with explicit stop conditions and an owner-supervised first run.
- **DoD:** protocol is followed and logged for each canary; stop conditions are tested on fixtures.

#### ACC-03 Live crash and reconciliation acceptance (M)
- **Gap:** killed-worker-after-dispatch is proven on fixtures only [D].
- **Approach:** on one approved live canary, kill the worker after the submit is dispatched, restart, and confirm receipt-only reconciliation with exactly one employer application. Needs explicit owner approval because it touches a real application.
- **DoD:** one live role reconciled with no second Submit click, verified in the journal and the employer's confirmation.

#### ACC-04 Evidence and email reconciliation on a live success (S)
- **Gap:** live email reconciliation is not accepted [D].
- **DoD:** one live autonomous success whose bundle verifies with `evidence-verifier` as `NETWORK_VERIFIED` and an `EMAIL_RECONCILED` upgrade.

#### ACC-05 Per-provider gate definition (S)
- **Problem:** 50 total with at least one per provider lets Workday dominate. Proposal for owner ratification: 50 total with at least 8 each on Workday, Greenhouse, Lever and Ashby.
- **DoD:** the threshold is written in the acceptance code and doc after owner approval.

### Epic DET: detection posture (section 5)

#### DET-01 Consistency self-check at launch (S)
- **Approach:** a pre-run check records, without changing anything: real Chrome channel and version, headed or headless, OS timezone and locale, public IP country (a single lookup, recorded as country only), candidate email domain not on a disposable list. It refuses live submission if headless or if timezone/country disagree with the target region, unless the owner overrides explicitly.
- **Bundle:** D. Depends on FIX-08.
- **Test:** unit tests with injected values; one run proving the check is recorded in the ledger.
- **DoD:** every live run's ledger entry shows the consistency result.

#### DET-02 Detection probe suite, re-run each release (S)
- **Approach:** keep the pinned CDP diagnostic and add recorded results for webdriver, runtime leak, source URL and timezone/locale agreement. Record versions of Patchright and Chrome with the result. Report as "no leak on probe set X", never as undetectable.
- **Test:** `scripts/cdp-diagnostic.ts` rerun; result file dated and attached.
- **DoD:** probe results are less than 30 days old at any live campaign start.

#### DET-03 Volume and burst governor (M)
- **Approach:** per-tenant and global caps (suggested defaults for owner approval: at most 1 active application per tenant, at most 10 per day overall until acceptance, at most 3 per hour), jittered gaps between applications, and a hard stop on repeated 403, 429 or challenge responses.
- **Test:** fake-clock unit tests; fixture that serves 429 and asserts pause.
- **DoD:** caps are enforced in the worker and visible in `status`; a unit test proves the cap cannot be bypassed by restarting.

#### DET-04 Challenge and block ledger with circuit breaker (S)
- **Approach:** every detected CAPTCHA, email-code step, 403 or WAF page is recorded per provider and tenant with the journal event. Two challenges at one tenant in 24 h pauses that tenant for 24 h and notifies the owner. Challenges are always handed to the owner. No solver.
- **Test:** the four vendor handoff fixtures already exist; extend with the breaker.
- **DoD:** `status` reports challenge rate per provider; breaker behaviour is tested.

#### DET-05 Remove unsubstantiated claims (S)
- **Approach:** correct the `stealth.ts` header and any doc that implies recovered proprietary internals or evasion. Rename user-facing "stealth" wording to "paced" where it implies evasion. Comments and docs only.
- **DoD:** no source or doc claims undetectability or reverse-engineered internals without a cited artifact.

#### DET-06 Tenant terms review and owner decision (S)
- **Approach:** list the ATS families and tenants in the approved set, record each tenant's candidate-portal terms URL and any automation or "account must represent a person" clause, and get an explicit owner decision per ATS family. Persist the decision with the approval file (FUN-01).
- **DoD:** no live run for a tenant without a recorded decision.

### Epic REA: research tooling

#### REA-01 Build the REA runtime (S, owner approval needed)
- **Problem:** `D:\REA\dist` is missing, so `rea.mjs` cannot run (2.6). Earlier work used it on 2026-10-30 [D], so it was probably removed or cleaned since [I].
- **Approach:** in `D:\REA` run `npm ci && npm run build:cached` as the error message says. This writes only to `D:\REA`. This audit did not run it because the request said no changes, and REA's own guidelines prohibit installers from touching unrelated software. Alternative already used: the esbuild-bundled worker under `out/research/`.
- **DoD:** `node D:\REA\scripts\rea.mjs --help` lists commands; one public capture produces a retained Evidence ID.

#### REA-02 Per-ATS capture and form-contract drift check (M)
- **Approach:** for each of the 11 ATS families, REA-capture one public job and its apply form read-only: DOM, third-party script hosts, request inventory without bodies. Store the evidence IDs in `autoapply-portals.md` (the existing ones are listed there) and hash each form's field-contract shape. Re-capture monthly. A changed hash raises a drift ticket.
- **Test:** compare hash against the fixture in `portal-snapshots.test.ts`.
- **DoD:** each ATS has a capture newer than 30 days and a recorded vendor-script list. This is also the evidence base for section 5.2.

#### REA-03 Third-party extension recipes, bounded reuse (S)
- **Approach:** the Simplify 3.1.10 static analysis in `autoapply-rea-findings.md` is partial. Treat its field-recipe design as a reference only, and never execute or copy the package.
- **DoD:** no change unless a concrete gap in 2.5 maps to a documented recipe.

### Epic TST: test infrastructure

#### TST-01 Tiered scripts and durable results (M)
- **Problem:** one command runs 22 files sequentially, including CLI tests that take about a minute each [D]. Output to a log is empty until a file finishes, so a long run looks hung.
- **Approach:** split into `fast` (no browser), `browser`, `cli`, `otp` tiers with the same files, plus a summary JSON per run in the run ledger.
- **DoD:** `fast` finishes in under two minutes and gates every PR; full suite results land in `out/` with counts.

#### TST-02 Regression corpus from real failures (M)
- **Approach:** for every FIX ticket add a sanitized structural capture to `portal-snapshots.test.ts` with source URL, date and REA Evidence ID.
- **DoD:** each closed FIX ticket cites its fixture.

#### TST-03 Live read-only conformance sweep (M)
- **Approach:** a script that opens public apply forms for a few roles per ATS, enters nothing, and records: form found, fields discovered, required-unknown count, gate type, vendor challenge scripts present. No submit, no account creation, no candidate data. Output feeds `status` and REA-02.
- **Test:** local fixture pages; a live run attached once.
- **DoD:** per-ATS coverage table with date, produced by one command.

#### TST-04 Remote CI run (S, owner decision)
- **Gap:** workflow `autoapply-check.yml` is unrun; the owner chose local-only [D].
- **DoD:** either the owner approves a branch and push and CI result is recorded, or the item is closed as "waived by owner" in writing.

---

## 7. How to chunk the work

Bundle by **risk and review size**, not by topic. Never mix a behaviour change with an
observability change in one change set. Every bundle is independently shippable and leaves
`npm run test:autoapply`, `npm test` and `npx tsc --noEmit` green.

| Order | Bundle | Tickets | Why together | Behaviour change |
| --- | --- | --- | --- | --- |
| 1 | **A. Truthful state** | OBS-01, OBS-02, OBS-04 | Same two files; makes data correct before anyone looks at it | None to application logic |
| 2 | **B. See it** | OBS-03, OBS-05, OBS-07, OBS-09 | All read the data Bundle A made correct | None |
| 3 | **C-prep. Durable decisions** | OBS-06, OBS-08 | Both touch intake and acceptance records | None |
| 4 | **C. Valid campaign** | FUN-01, FUN-03, FUN-04, FUN-02 | Funnel truth; needs owner re-approval | Scheduling only |
| 5 | **FIX-00** | one run, no code | Separates stale from current failures | None |
| 6 | **FIX-01..08, one per change set** | one failure class each | Fixture first; each is small and reversible | Yes, narrow |
| 7 | **D. Detection posture** | DET-01, DET-03, DET-04, then DET-02, DET-05 | Guardrails before volume rises | Adds limits |
| 8 | **E. Live protocol** | ACC-01, ACC-02, ACC-03, ACC-04, ACC-05, DET-06 | Needs owner approval per role | Live |
| 9 | **Tooling, in parallel** | REA-01..03, TST-01..04 | Independent of the above | None |

Dependencies that must not be inverted: A before B; B before FIX-00; FIX-00 before FIX-01..07;
D (DET-01, DET-03, DET-04) before any acceptance run beyond a single canary; FUN-01 and owner
re-approval before ACC-02. Do not start ACC tickets while Bundle A is missing: live failures
would again lose their reasons.

Commit and push rules from the project still apply (`AGENTS.md`): after any change to
`classify.ts` or `config.ts` run `npm test`; before any push `git fetch origin && git merge origin/main`.
The owner has said to keep autoapply changes local, so no push without an override.

---

## 8. How to test everything that is left

### 8.1 Test levels

| Level | What | Command / method | Evidence to keep |
| --- | --- | --- | --- |
| T0 Static | Typecheck, project selftest | `node --import tsx node_modules/typescript/bin/tsc --noEmit`; `npm test` | Exit code, log in `out/` |
| T1 Unit | Answers, classifier, identity, preflight, store, acceptance | `node --import tsx --test src/autoapply/answers.test.ts ...` | Pass counts |
| T2 Browser fixtures | Local pages, dynamic forms, shadow DOM, uploads, gates | `dynamic-form.test.ts`, `interactions.test.ts`, `workday-experience.test.ts`, `ats-strategies.test.ts` | Log per file |
| T3 Recorded structure | Sanitized real-form snapshots | `portal-snapshots.test.ts`, `portals.test.ts` | Snapshot provenance (URL, date, Evidence ID) |
| T4 Integration | CLI, worker, real local POST, SMTP/Mailpit OTP, kill and restart | `workflow.test.ts`, `worker.test.ts`, `submission.test.ts`, `otp.integration.test.ts`, `recovery.test.ts` | Log; for OTP, the Mailpit log |
| T5 Live read-only | Public form load, field discovery, gate detection. No entry, no submit | TST-03 | Per-ATS coverage table |
| T6 Live to review | Real candidate entry, stop before Submit. Owner approves each role | `--review-steps`, no `--submit` | Journal with `submissionAttempted=false` |
| T7 Live canary | One real submit, sequential, supervised first | ACC-02 | Receipt bundle verified by `evidence-verifier` |
| T8 Fault | Kill after dispatch, validation bounce, popup receipt | Fixtures (T4) and one live (ACC-03) | Journal plus employer confirmation |

The full suite is the `test:autoapply` script in `package.json` (22 files, run with
`--test-concurrency=1`). Today's rerun result: see Appendix C. If it did not finish, do not
quote a pass count.

Do not run T6 or T7 without explicit owner approval for the specific role. Do not
run anything that submits against a role already `applied` (AiPrise, UiPath, Abacus).

### 8.2 Test map for what remains

| Remaining item | Level | Passes when |
| --- | --- | --- |
| Failure reasons persisted | T1 | OBS-01 test; six old rows re-derivable |
| Worker liveness | T1, T4 | Dead PID reported `crashed` |
| `status` / `explain` | T1 | Reproduces section 2 numbers |
| Approved-set feasibility | T1 | Today's set reported unreachable with counts |
| Experience gate precision | T1, manual labelling | False-skip rate at or under 5% on 100+ sample |
| Nine stale parks | T6 | Each has a current reason; zero submits |
| Identity mismatch classification | T3 | Redirect becomes `CLOSED_AT_SOURCE`; real mismatch still blocks |
| Apply-entry and readiness | T3, T2 | Both Airbus and Caterpillar pages reach form or park with a code |
| Step limit with zero fields | T3 | Gate named, no step burn |
| Missing Submit | T3 | Control found or blocker named |
| Workday required answers | T2, T3, T6 | Retained values or labelled parks |
| ABB pending POST | T4, T6 | Cause named; converge or classified park |
| Greenhouse dropdown | T3, T6 | Reaches review |
| Live ATS certification (iCIMS, SmartRecruiters, Workable, Oracle, SuccessFactors, Taleo, Recruitee) | T5, T6 | Per-ATS live review reached, or a documented gate. Synthetic contracts alone do not count. |
| Challenge/breaker | T4 | Two challenges pause the tenant |
| Volume caps | T1 | Cap holds across restart |
| Detection probes | T5 | Dated probe result under 30 days old |
| Live crash reconciliation | T8 | One employer application, one Submit click |
| Live email reconciliation | T7 | `EMAIL_RECONCILED` bundle verifies |
| Production 50 | T7 | Acceptance audit `complete: true` |
| Remote CI | n/a | Owner approves and result recorded, or waived in writing |
| Unattended startup | T4 | Owner approves installation; restart recovery proven, then installed |

Known unsupported or unverified structures to keep honest in coverage tables: closed shadow
roots, Taleo Enterprise (only Business Edition seen), iCIMS pages that returned 403,
SmartRecruiters behind DataDome, Oracle email-first sign-in, SuccessFactors sign-in. [D]

### 8.3 Live canary protocol (ACC-02)

1. Prerequisites: Bundles A, B, C and D done; approved set regenerated and re-approved with a fresh hash; probe results under 30 days old; tenant terms decision recorded (DET-06); `status` shows no crashed worker and no `applying` rows.
2. One role at a time. Do not start the next role until the previous role's outcome is understood and recorded.
3. First role per provider is **owner-supervised**, headed, with `--review-steps` first (T6), then a normal `--submit` run (T7).
4. Stop immediately, and do not retry blindly, if any of the following happens:
   - a submit was dispatched without a receipt (ambiguous state: reconcile only)
   - a challenge appears twice at one tenant
   - a 403 or 429 appears
   - an identity mismatch
   - an unexpected sign-in or account prompt appears
   - an unknown required answer
5. Record in the journal and ledger; update `status`; only then continue.
6. Daily and hourly caps from DET-03 apply even if the roles are ready.

---

## 9. Definition of done

### 9.1 Per ticket

A ticket is done only when **all** are true:

1. Failing test written first, shown failing, then passing. For a bug, the fixture comes from a sanitized real capture.
2. Narrowest layer changed; no unrelated behaviour altered.
3. `npm run test:autoapply` (or the relevant tier), `npm test` and `npx tsc --noEmit` pass, with logs under `out/` named for the ticket.
4. No secret, credential, mail body or candidate value in any log, report, journal, handoff or error string (canary test).
5. Reasons for any new park or failure use the taxonomy (OBS-02).
6. Docs updated: the ticket row in `autoapply-tickets.md` and, if state changed, the current-state page (OBS-10).
7. The claim in the doc uses the vocabulary from "How to read this document", and never says "complete" for implemented-locally work.

### 9.2 Per epic

| Epic | Done when |
| --- | --- |
| OBS | `status` reproduces every number in section 2 from one read-only command. All parks and failures carry a code, a reason and a next action. A killed worker is reported as crashed. |
| FUN | Today's approved set is reported infeasible with numbers. A regenerated, balanced, live and eligible set exists with a recorded owner approval. The experience gate false-skip rate is measured and at or under 5%. Catalogue-to-queue counts conserve. |
| FIX | Each of the nine stale parks and six failures is fixed, or has a named external blocker (owner fact, vendor gate). |
| ACC | Live protocol followed with a logged outcome per role; reach-the-review funnel exists per provider. |
| DET | Consistency check, probe results, caps and challenge breaker are in place and visible in `status`. No doc or source claims undetectability. Tenant decisions recorded. |
| REA | REA runs; each ATS has a capture under 30 days old. |
| TST | `fast` tier gates every change; coverage table exists from one command. |

### 9.3 Program-level: autoapply is "production accepted"

All of the existing exit criteria in `autoapply-tickets.md` remain required, plus the added ones:

- [ ] 50 real end-to-end applications across Workday, Greenhouse, Lever and Ashby with no manual browser intervention, counted by the acceptance audit as `complete: true`. Proposed minimum 8 per provider (ACC-05, owner to ratify).
- [ ] Every counted success has independently verified, network-anchored evidence (`NETWORK_VERIFIED`), and none is an `existing` or `assisted` completion.
- [ ] Live crash and reconciliation acceptance without double submission (ACC-03).
- [ ] Zero duplicate employer applications in the whole run.
- [ ] `status` reports queue, failures, parks, worker liveness and acceptance, all current.
- [ ] Across the live run: zero hard blocks, zero account bans or lockouts, and challenge rate per provider reported. A proposed ceiling of 10% per provider is for the owner to ratify. Any challenge must have been handed to the owner, not defeated.
- [ ] All tickets above closed or explicitly waived by the owner in writing.

### 9.4 Claims you may and may not make

| May say | May not say |
| --- | --- |
| "Implemented locally and fixture-tested" | "Complete" or "works on X" without live evidence |
| "Reached the review page on N live roles at provider P" | "Autonomous apply works" |
| "Submitted, with a verified receipt and network evidence" (per role) | "Universal ATS coverage" |
| "No leak on probe set X on date D" | "Undetectable" or "bypasses bot detection" |
| "Challenge handed to the owner" | "Solves CAPTCHA" |

---

## 10. Decisions needed from the owner

| # | Decision | Needed for |
|---|---|---|
| 1 | Re-approve a regenerated, balanced role list (the current 50 are infeasible) | FUN-01, ACC-02 |
| 2 | Per-ATS decision on tenant terms, especially Workday tenants that bar automated accounts | DET-06, F8 |
| 3 | Supply or confirm facts for the recurring unknown questions: referral source, prior employment, state or city, notice period, hybrid willingness. Free-text experience answers stay owner-reviewed. Current salary and expected salary: confirm what is true and stated. | FIX-05, FIX-07 |
| 4 | Ratify the per-provider minimum and challenge-rate thresholds | ACC-05, section 9.3 |
| 5 | Approve building `D:\REA` (`npm ci && npm run build:cached`) | REA-01 |
| 6 | Remote CI: approve a branch and push, or waive in writing | TST-04 |
| 7 | Unattended startup: approve installing the startup task, or keep manual | Operations |
| 8 | Approve daily and hourly caps | DET-03 |
| 9 | Choose a local backup method for the uncommitted autoapply work (local branch commit with no push, or a dated copy) | SOTA-11, F11 |
| 10 | Pause live ABB attempts until offline replay exists, or set a per-tenant daily session budget | SOTA-10, F13 |
| 11-13 | See section 13.5. Answered 2026-10-31 in section 14: single user; semi-fit bulk; no AI. Lock-down still open | S4, OUT-01, SEC-01, SEC-02 |

---

## 11. What we are looping on and doing wrong

This section is a root-cause read of the evidence in sections 2-4 plus `HANDOFF.md`. It is
about the **process and design**, not about effort. Every loop below was a reasonable local
decision. Together they explain why many sessions of careful work produced 0 autonomous
receipts. Tags as before; [I] marks inference.

### 11.1 Loops

| ID | Loop | Evidence | Why it does not converge | Breaker |
| --- | --- | --- | --- | --- |
| L1 | **One-role fix loop.** Run ABB live, hit the next defect, patch, add fixture, run ABB live again. | 28 ABB artifacts in `out/` in two bursts of activity (00:50-02:xx and 16:xx-18:47 local, so about 18 hours of wall-clock with a gap) [O]; at least 15 separate ABB worker or exec sessions named in `HANDOFF.md` [D]. Each run advanced one layer: login, email verification, activation, My Information, My Experience, Voluntary Disclosures, network wait. No receipt. | Workday is an "onion". Each step is reachable only after the previous one passes, so one live run reveals one new defect. The learning rate is one sample per run. | SOTA-04 (auto-capture every live step as a fixture) and SOTA-05 (stateful offline wizard replay) so one live pass yields many offline iterations |
| L2 | **Fixed constants as control flow.** 5 s click and wait timeouts, a 300-iteration convergence cap in `fillFrame`, a 12-step cap in `run`, a 15-minute network wait. | `runner.ts` lines 392, 661, 675, 741 [O]; Airbus and Caterpillar failures are the 5 s caps [O]; the 300-iteration failure on ABB turned out to be an outstanding POST, not repeated filling [D]. | A cap reports that it was hit, not why. Nothing compares successive page state, so "no progress" cannot be told from "slow". The failure string carries the constant, not the cause. | SOTA-03 (state-fingerprint progress detector) |
| L3 | **Gate whack-a-mole.** Each tenant's sign-in, verify-email or account-create variant is recognized by text or markup, one at a time. | ABB repeated sign-in to the step limit before the inline "Verify your account" message was recognized [D]. Two Airbus parks hit 12 steps with 0 fields found [O]; likely the same class [I]. GEHC listed Password and Email as unanswered questions [O]. | Free-text and markup recognizers grow forever. Each unrecognized variant becomes a silent loop, not a stop. | SOTA-06 (explicit Workday auth state machine where an unknown state parks immediately) |
| L4 | **Circular verification.** Fixtures are written from the same belief as the code, then pass. | 23 test files, 111/112 and 97 passes reported at various points [D]. Live autonomous receipts: 0 [O]. | Passing local tests prove the code matches its author's picture of the form. A public Workday-fill study reached the same conclusion: "reading code is not evidence; running it against real pages is". [W] | SOTA-04, SOTA-07 (replay corpus and eval harness measured on real captures) |
| L5 | **Wrong metric.** Progress is tracked as tests passing and checkboxes ticked. | `autoapply-completion-plan.md` all `[x]` while production is 0/50 [O][D]. The only live metric is a final receipt, which is too rare to guide work. | Nothing measures how far real runs get, so effort goes wherever the last failure was. | ACC-01 (stage-reach funnel) |
| L6 | **Document-append loop.** Each session reads `HANDOFF.md`, acts, appends. | 2,724 lines; about 700 are autoapply; `ABB` appears on 36 lines; later sections supersede earlier ones [O]. | Context cost rises each session and superseded statements stay in view. | OBS-10 |
| L7 | **Selection loop with two rule sets.** The proposer and the worker disagree on eligibility. | The proposal file says `proposed_requires_live_preflight` and was created 2026-10-30T18:53Z. Of the 19 approved roles now skipped, **16 are `ineligible_jd_experience`**, 2 stale, 1 closed [O]. | The approved list was built without the gate the worker enforces, so about a third of it was dead on arrival. | FUN-01 (one shared eligibility gate) |
| L8 | **Breadth before depth.** | ATS-01 built strategies for seven alternative ATS (iCIMS, SmartRecruiters, Workable, Oracle, SuccessFactors, Taleo, Recruitee) [D]. The acceptance gate counts only Workday, Greenhouse, Lever and Ashby, and 259 of 410 queued are Workday [O]. | Seven synthetic contracts cannot move the gate. Live certification for them is still open. | Re-prioritise: gate providers first, with the rest behind an explicit later phase |

### 11.2 What we are doing wrong

| ID | Mistake | Evidence and effect | Fix |
| --- | --- | --- | --- |
| W1 | **A real employer is the test oracle.** Live ABB account creation, sign-in, mailbox and application state are used to debug. | 15+ sessions at one tenant in about 18 hours [D]. Every iteration consumes real account state and mail, and repeats sign-in and verification traffic from one IP to one tenant. That is itself the burst pattern Greenhouse-style fraud tools and tenant lockouts react to [W][I]. | Debug offline from captured steps (SOTA-04, SOTA-05). Go live only to confirm. Cap sessions per tenant per day (DET-03). |
| W2 | **No automatic capture of live structure.** Real markup is copied into fixtures by hand after the fact. | HANDOFF records each such conversion (`activeListContainer`, `workExperience-7`, named groups). A published Workday study replayed 420 captured pages and went from 0 of 230 résumé uploads recognized to 230 of 230 in one pass [W]. | SOTA-04 |
| W3 | **Success is defined only at the end.** | See L5. A role that fails at step 2 and one that fails at step 8 look identical in the queue (`failed`/`paused`). | ACC-01 |
| W4 | **Failure causes are discarded** (queue string) and logs go to stdout. | Section 3. This is why this audit had to reverse-engineer causes from checkpoints. | OBS-01, OBS-05 |
| W5 | **Approvals are not tied to state.** An approval of exact URLs is treated as permanent. | 19 of 50 approved roles are already skipped [O]; ABB sits at "waiting" without a decision [O]. | FUN-01 |
| W6 | **The work is not under version control.** | The last commit touching `src/autoapply` is `01fea8c`; 45 of the 54 files in `src/autoapply` are untracked and 19 tracked files are modified (+1,227/-583 lines in 8 autoapply files) [O]. `state/` and `out/` are git-ignored. One bad checkout, clean or disk fault loses the vault code, worker, evidence verifier and 23 test files. | Owner decision 9: a local-only backup or a local branch commit (no push). |
| W7 | **Feedback loop is slow and hard to run safely.** | The full suite is 22 files run one at a time, and CLI tests take about a minute each [D]. This audit's first background launch died silently when its terminal call returned, and the second was stopped by the user, so no fresh pass count exists [O]. When confirming a fix costs tens of minutes, people test less. | TST-01 |
| W8 | **Hidden constants.** | `applicationCountry: 'India'` in `worker.ts`; India-only location regex and `'tech'` classification in `preflight.ts` [O]. Correct for the current owner, but invisible and untested as policy. | Move to profile, show in `status` |
| W9 | **LLM used only for answers, not for the stuck cases.** | `grounded-model.ts` grounds free-text answers [D]. Unknown widgets and gates have no assisted fallback, so each becomes a new hand-written branch. | SOTA-02 |

### 11.3 What is working and should be kept

Honesty is a strength. The system refuses to fabricate answers, labels evidence strength,
retains an exactly-once submit state machine with network-anchored receipts, separates
assisted from autonomous completions, isolates browser storage per tenant, and encrypts
credentials. These are ahead of the open-source auto-apply projects reviewed in
`autoapply-open-source-review.md`, most of which stop before Submit by design. The problem
is the discovery loop around them, not the safety core.

---

## 12. Making it state of the art

### 12.1 What the field looks like (web research, 2026-10-31)

| Finding | Source | Confidence |
| --- | --- | --- |
| General multimodal LLMs score poorly on realistic form filling. FormFactory (NUS and others) reports no evaluated model above 5% accuracy on its form-filling benchmark, citing layout reasoning and field-value alignment. | arXiv 2506.01520 | Medium-high (peer-style paper; benchmark is synthetic and may predate newer models) |
| The dominant 2026 browser-agent design reads the **accessibility tree** rather than screenshots or raw DOM: about 2-5 KB per page, deterministic element references, no vision model needed. Skyvern leans vision-first and is described as strongest on write and RPA tasks; Stagehand mixes deterministic code with AI "where the DOM is stable / where it isn't". | Multiple 2026 comparisons (menuagentic, ChatForest, dreaming.press, AgentList) | Medium (secondary summaries that agree with each other) |
| For form filling, error cost is high and success must be near-perfect, so **verify every write**. | AgentList guide | Medium |
| Workday account creation precedes every application field in 20 of 20 signed-out runs that reached a form; search prompts run only on Enter; loose option matching picked a wrong skill 3 of 33 times; the résumé input was missed 230 of 230 times until fixed. | Jobsistant field notes (first-party, small sample, commercial interest, disclosed) | Medium. Matches our own ABB findings (Enter, `selectinput`, account first), which raises confidence. |
| Greenhouse and Ashby official submit endpoints (`POST /v1/boards/{token}/jobs/{id}`, `applicationForm.submit`) need an **employer-held API key**. They are not a candidate route. Workday has no public apply API; its public `cxs` JSON serves postings only. | Greenhouse Job Board API docs; Ashby API docs; ctriolab Workday note | High for the key requirement; medium for "no Workday apply API" |
| Record-and-replay with self-healing: store a successful flow keyed by a form-signature embedding, replay with zero model calls, repair one field on drift, re-discover on larger drift. | `Shubhambawner/form-filler-agent` README | Low (small hobby project; a design idea, not evidence of performance) |
| Agent loop detectors fingerprint **(action, page state)** over a short window and stop or escalate after about 3 identical entries. | oxideclaw `loop_detector.rs`, PraisonAI docs | Medium (open-source pattern, not a benchmark) |
| A vendor model claiming 63-78% on its own browser-task benchmark is a vendor claim for general tasks, not evidence about Workday forms. | `job-agent` README | Low; not used |

A search result with a detailed Workday wizard writeup was excluded because the page looked
synthetic and carried an impossible date. Nothing in this audit depends on it.

**Reading:** state of the art for this task is not "an LLM drives the browser". It is
**deterministic adapters for the platforms that matter, an accessibility-tree-grounded model
only as a bounded fallback, verified writes, per-tenant recipe reuse, loop detection on page
state, and an evaluation harness built from real captures.** The FormFactory result is a
reason not to hand navigation to a model unsupervised.

### 12.2 Maturity ladder and where we are

| Level | Name | Characteristics | Status |
| --- | --- | --- | --- |
| L0 | Scripted | Hard-coded selectors, final-state success only | Passed |
| L1 | Scripted with safety | Idempotent submit, evidence, no fabrication, tenant isolation | **Here** (strong) |
| L2 | Observable | Typed failures, journal, `status`, heartbeats, run ledger | Not yet (Bundles A, B) |
| L3 | Measured and replayable | Auto-captured fixtures, stateful offline replay, stage-reach funnel, eval harness | Not yet |
| L4 | Self-limiting and adaptive | State-fingerprint progress detection, per-tenant recipe cache, bounded model fallback with verification | Not yet |
| L5 | Operated to SLOs | Per-provider success, challenge and block rates tracked against targets, drift alarms | Not yet |

The gap that matters most is L1 to L3. L4 and L5 are only worth building after L3, because
they cannot be tuned without measurement.

### 12.3 Tickets

These extend section 6. Same format. IDs use `SOTA-`.

#### SOTA-01 Verified-action primitive (M)
- **Problem:** retained-value checks exist but are applied unevenly across widgets and ATS code paths [D].
- **Approach:** one function owns locate, act, read back, compare, record, with typed outcomes (`retained`, `not_retained`, `ambiguous_option`, `blocked_by_overlay`, `detached`). Every field action in `runner.ts` goes through it. The result feeds the journal (OBS-05).
- **Test:** table-driven browser fixtures for text, select, combobox, selectinput, radio, checkbox, file, date, each with a deliberate non-retention case.
- **DoD:** no code path reports `filled` without a read-back; outcome counts per widget type appear in `status`.

#### SOTA-02 Bounded accessibility-tree fallback (L)
- **Problem:** unknown widgets and unrecognized gates become new hand-written branches (W9).
- **Approach:** only when a deterministic path fails, take an accessibility snapshot of the active container (not the page), ask the existing grounded model for a **single proposed action** from a fixed menu (click ref, type ref, choose option ref, park), then execute it through SOTA-01 and require a read-back. Never used for Submit, consent, authentication secrets or answers that need owner facts. Cap model calls per step and per job. Log prompt hashes, not content.
- **Bundle:** after SOTA-01, SOTA-04, SOTA-07. Do not start before the eval harness exists, otherwise there is no way to tell whether it helps.
- **Test:** replay corpus cases where the deterministic path fails; measure recovery rate and wrong-action rate; fixtures proving it refuses Submit, consent and secrets.
- **DoD:** on the replay corpus, wrong-action rate is 0 and recovery rate is reported. If recovery is not clearly positive, the ticket closes as "not adopted".

#### SOTA-03 State-fingerprint progress detector (M)
- **Problem:** L2. Caps hide causes.
- **Approach:** after each action compute a fingerprint of URL path, active step title, the visible required-field set, the visible validation-message set, the pending-request set (method and host only) and loading markers. If the same fingerprint follows the same action class three times, stop and park with `NO_PROGRESS` and the fingerprint parts. Replace 300-iteration and 12-step behaviour as the primary stop. Keep the caps as backstops only.
- **Bundle:** with FIX-00, before FIX-03.
- **Test:** fixtures for sign-in loop, held request, validation bounce, overlay intercept; each must stop within 3 repeats with the right cause. Assert it does not fire on a legitimately slow load.
- **DoD:** the Airbus zero-field case and the ABB sign-in loop reproduce as a `NO_PROGRESS` park with a named cause, not as a step-limit.

#### SOTA-04 Automatic sanitized capture of every live step (M)
- **Problem:** W2, L1.
- **Approach:** at each wizard step the runner saves a sanitized structural snapshot (role, name, type, required, option lists, `data-automation-id` or equivalent, visible validation text) plus the sequence of actions taken and the outcome, to `captures/<provider>/<tenant>/<step>.json`. No values, no email, no names, no tokens. Provenance: date, URL host and path, git SHA. A script turns a capture into a failing test.
- **Bundle:** B2, right after Bundle B. Depends on OBS-05.
- **Test:** canary-secret test proving no value is stored; round-trip test that a capture reloaded into the fixture server reproduces the same field inventory.
- **DoD:** every live run produces replayable captures, and at least one past ABB step is regenerated as a test.

#### SOTA-05 Stateful offline wizard replay (L)
- **Problem:** L1, W1. A static page cannot reproduce multi-step state.
- **Approach:** a local server that replays a captured step sequence as a wizard: steps unlock after required fields are valid, validation messages come from the capture, Save and Continue transitions, optional delayed responses. Seeded from SOTA-04 captures of one tenant.
- **Test:** run the full runner against the replay for ABB's captured steps; assert it reaches the review page without any network access to the employer.
- **DoD:** the whole ABB flow up to Review runs offline in under two minutes, and new defects found live can be reproduced offline before fixing.

#### SOTA-06 Explicit Workday authentication state machine (M)
- **Problem:** L3.
- **Approach:** states: `signed_out`, `sign_in_form`, `create_account_form`, `verify_email_pending`, `activated`, `signed_in`, `locked`, `challenge`, `unknown`. Each observed `data-automation-id` or URL pattern maps to one state. Each state has one allowed action. `unknown` parks immediately with a snapshot. Transitions are journaled.
- **Test:** one fixture per state from real captures (SOTA-04); a fixture with an unseen state asserts an immediate park.
- **DoD:** no auth-related step-limit park is possible; unknown states are visible in `status`.

#### SOTA-07 Evaluation harness on real captures (M)
- **Problem:** L4, L5. No quantitative view of recognition and convergence.
- **Approach:** a fixed set of captured forms. For each run, report field recognition rate, retained-value rate, steps to convergence, unknown-required count and time, per provider. Baseline today from the nine parks: **31 fields filled against 69 unmapped across 11 parked reports** [O]. That figure mixes owner-unknown fields with recognition failures and must be split by `reasonCode` first. Publish the table in the doc after each release, as the Workday study did [W].
- **Test:** deterministic output on the same corpus; a regression gate that fails a change if recognition or retention drops.
- **DoD:** a committed baseline and a gate that blocks regressions.

#### SOTA-08 Per-tenant recipe cache (M)
- **Problem:** the same tenant is re-discovered for every role, though the worker already groups by tenant.
- **Approach:** the runner already prefers Workday's own "Use My Last Application" entry for a second role at a tenant (`runner.ts` lines 721-724, `company-batches.test.ts`) [O]. That reuses the vendor's saved history but not our verified answers. Extend it: after a verified review, store a value-free recipe keyed by (tenant, step, form-signature hash): control references and answer scopes, never values. On the next role at that tenant, replay it; on signature drift, fall back to normal discovery and flag the drift. First measure how many steps "Use My Last Application" already saves; it may cover much of My Experience.
- **Bundle:** after SOTA-01, SOTA-07. Needs scoped answers to stay authoritative.
- **Test:** two roles at one fixture tenant; second uses the recipe; a changed field forces rediscovery.
- **DoD:** measured reduction in steps-to-review for the second role at a tenant, with no change in correctness.

#### SOTA-09 Question harvest and one-time owner ask (M)
- **Problem:** the owner is asked the same unknown questions role by role (section 2.5).
- **Approach:** public Greenhouse, Lever and Ashby forms can be read without an account, so a read-only sweep (TST-03) over the 85 queued roles on those three providers can list required question labels and their frequency. Group them and ask the owner **once**, as scoped answers, with each marked global, employer or role. Workday forms need an account first [W][O], so for Workday ask per tenant after sign-in, using the same grouping.
- **Test:** `answers.test.ts` scope-precedence cases; a fixture proving no unknown fact is invented.
- **DoD:** one consolidated question sheet exists, owner answers are saved with explicit scope, and the repeated-question rate drops in the next campaign.

#### SOTA-10 Session and tenant budget (S)
- **Problem:** W1.
- **Approach:** a per-tenant daily budget for live sessions and sign-in attempts, with a hard stop when the budget is exhausted and no override from automation. Offline replay (SOTA-05) is the default debug path.
- **Test:** fake-clock unit test.
- **DoD:** no tenant can receive more than N live debug sessions per day.

#### SOTA-11 Local backup of the work (S, owner decision)
- **Problem:** W6.
- **Approach:** the owner chooses between a local branch commit with no push, or a dated copy of `src/autoapply`, `scripts`, `docs`, `.github`, `extension` and `package.json`. Secrets and `state/` stay out of any commit.
- **DoD:** the autoapply source exists in at least two local places, and the owner has accepted the method in writing.

### 12.4 Revised order of work

The loop breakers go **before** more live attempts, because they change how many defects one live run can reveal.

1. Bundle A (truthful state), then Bundle B (see it).
2. **Bundle B2, "stop looping":** SOTA-03, SOTA-04, SOTA-06, SOTA-10. SOTA-11 immediately, in parallel.
3. Bundle C-prep and C (valid campaign, one shared eligibility gate).
4. FIX-00, now using the journal, progress detector and captures.
5. **Bundle B3, "measure":** SOTA-05, SOTA-07, TST-01, TST-03, REA-02.
6. FIX-01 to FIX-08, each reproduced offline first.
7. SOTA-01, SOTA-09, SOTA-08.
8. Bundle D (detection posture), then Bundle E (live protocol).
9. SOTA-02 last, and only if SOTA-07 shows a gap that deterministic code cannot close.

### 12.5 Added definition of done for the state-of-the-art claim

On top of sections 9.1 to 9.3, "state of the art" may be claimed only when all hold:

- [ ] Maturity level L3 is reached: auto-captured fixtures, offline wizard replay, a stage-reach funnel and an evaluation baseline with a regression gate all exist and run.
- [ ] No stop condition is a bare constant: every park carries a state-fingerprint cause.
- [ ] On the replay corpus, recognition, retention and convergence are reported per provider and do not regress between releases.
- [ ] A new live defect can be reproduced offline from its capture before it is fixed.
- [ ] If SOTA-02 is adopted, its wrong-action rate on the corpus is 0 and it provably never touches Submit, consent or secrets.
- [ ] The autoapply source is backed up in at least two local places.

What may still not be claimed: that the system beats named commercial products. No head-to-head
benchmark exists, and vendor numbers are not comparable.

---

## 13. Second-pass review: corrections, new gaps and what is still left

This pass re-read the document against the evidence, then searched for things the first two
passes did not cover. Tags as before.

### 13.1 Corrections made in this pass

| Where | Was | Now |
| --- | --- | --- |
| 2.4 Citi | "3 unmapped" | 3 listed questions, 4 unmapped fields |
| 2.4 GEHC | Named three specific questions | Only Password and Verify New Password were verified |
| 2.6 receipts | "They predate evidence bundles" stated as fact | Marked [I]; only the missing `evidenceDir` is observed |
| 5.2 Lever | hCaptcha attributed to a vendor blog | It came from a third-party GitHub project; marked low confidence |
| OBS-02 DoD | "15 distinct reasons" | Count them first; roughly 15 |
| L1 | "about 18 hours" | Two bursts across about 18 hours of wall-clock |
| W7 | Blamed reporter buffering for an empty log | Wrong: the first process had died. Rewritten to what was actually observed |
| SOTA-08 | Proposed recipe reuse as new | The runner already prefers "Use My Last Application"; ticket now builds on that and asks to measure it first |

The correction to W7 matters. An earlier summary of this audit said the suite log stayed empty
because of how the test reporter flushes. That explanation was a guess and was wrong.

### 13.2 Checked and found fine

- `ATS_MAIL_DOMAINS.greenhouse` already contains `greenhouse-mail.io`, the sender third parties report for Greenhouse security codes [O][W]. The ABB `otp.workday.com` omission does not repeat here.
- The grounded-model fact builder masks `personal.*` (except country), `answers.*` and `eeo.*` values before sending, with a comment that identity, contact and consent stay local [O: `grounded-model.ts` lines 42-44].
- The Workday "Use My Last Application" entry is implemented and has a fixture [O].
- The Greenhouse security-code flow (eight characters, or six single-character boxes) has a local SMTP and browser acceptance test [D][O: `otp.integration.test.ts`].

### 13.3 New gaps

#### Security and privacy

| ID | Gap | Evidence | Ticket |
| --- | --- | --- | --- |
| S1 | **Personal data is protected by `.gitignore`, not by access control or encryption.** `candidate.json` has inherited Windows permissions that include modify rights for other principals, including a `CodexSandboxUsers` group. `mode: 0o600` has no effect on Windows. `storage-state.json` holds live session cookies in plaintext. `review.html` and `review.png` capture the page, which can show personal data. `state/autoapply` is 351 MB and `out/` is about 613 MB. | `icacls`, file listing, size check [O] | SEC-01 |
| S2 | **Non-private facts can reach third-party free-tier model providers.** The mask covers `personal.*`, `answers.*` and `eeo.*` only. The fact catalogue also includes current and expected salary, school, degree, GPA, current company and title, notice period, relocation, criminal-conviction, security-clearance and non-compete facts, and none of these is masked. Whether a given call includes them depends on the prompt builder, which was not read. OpenRouter documents that training and retention depend on the provider and on an account setting, with separate settings for free and paid models. Z.ai's policy was not reviewed. | `answers.ts` lines 33-39, `grounded-model.ts`, OpenRouter docs [O][W] | SEC-02 |
| S3 | **Verification mail works only for five providers and only for a Gmail-authenticated mailbox.** The allowlist covers Greenhouse, Ashby, Lever, Workday and iCIMS. Any other provider gets no verification at all. The IMAP path marks mail authenticated only when `Authentication-Results` starts with `mx.google.com`. | `mailbox.ts` lines 20-26, 70 [O] | MAIL-01 |
| S4 | **Scope question.** The repo holds playbooks for other named people and a candidate-ID model. If the tool ever processes someone else's data, the owner becomes a data handler. India's DPDP Rules were notified 13 Nov 2025; most obligations (rules 3 and 5-16) start 18 months later, about 13 May 2027. A personal-use exemption probably covers single-user use [I]. This is not legal advice. | PIB and MeitY notice, Rules text [W] | Owner decision 11 |

#### Vendor behaviour found by the second search

| ID | Finding | Source and confidence | Ticket |
| --- | --- | --- | --- |
| V1 | **Greenhouse can accept a submit and then require a code.** Reports describe an "accepted-then-gated" third state: submit appears to succeed, an eight-character security code (six boxes on at least one employer) arrives by email, and nothing is submitted until it is entered. The gate is per employer and per address history, and Greenhouse has had an incident where codes were disabled for candidates who failed CAPTCHA, so it is tuned dynamically. | Third-party blogs and a build log (low to medium); Greenhouse status incident (medium) | FIX-09 |
| V2 | **Greenhouse form traps.** An "Autofill my application" button leads to a sign-in page. "Enter manually" on the résumé opens a text box where typed text becomes the résumé. "How did you hear" registers only on click, not Enter. School is a slow searchable catalogue with an "Other" entry. Degree is a fixed list. This is the opposite of Workday, where search prompts need Enter. | One third-party write-up of Stripe's form (low to medium) | FIX-09 |
| V3 | **Workday drafts can become unsubmittable.** If an employer un-posts and reposts a job while your application is a draft, you cannot submit it and must start again. There is also no editing after submit. Our parked reviews have no expiry. ABB has been parked since 2026-10-31 12:32Z. | State of Oregon Workday job aid; other university guides (medium) | OBS-11 |
| V4 | **Workday Candidate Home lists submitted applications.** That is an independent, first-party second signal of receipt, besides email and the network response. It is not used for reconciliation today [I]. | Several university and agency Workday guides (medium) | ACC-06 |
| V5 | **Workday offers three entry paths**: Autofill with Resume, Apply Manually, Use My Last Application. We use the second, and the third for repeat tenants. Resume autofill might cut My Experience work, but a parsed résumé can be wrong, so it must be verified against the profile before use. | Same guides (medium) | SOTA-07 |

#### Product and operations

| ID | Gap | Evidence | Ticket |
| --- | --- | --- | --- |
| P1 | **The objective is interviews, not receipts.** `interviewsRequested` is 0 and nothing tracks replies. Greenhouse's own launch material frames bulk automated applying "without high interest in any specific role" as the spam it is filtering. Volume without fit works against the goal. | `worker.json` metrics [O]; Greenhouse press release [W] | OUT-01 |
| P2 | **Windows operations are unmanaged.** `channel: 'chrome'` uses the system Chrome, which auto-updates and can change behaviour under a patched driver. Sleep, hibernate and network drops during a live session are not tested. Whether a park notification actually reaches the owner (local page or webhook) was not verified. | `runner.ts` line 169 [O]; notifications [D] | OPS-01 |
| P3 | **ATS_MAIL provider list silently limits coverage.** See S3. | [O] | MAIL-01 |

### 13.4 New tickets

#### SEC-01 At-rest protection of candidate data (M, owner action for permissions)
- **Approach:** the owner restricts `state\autoapply` to their own account with `icacls <dir> /inheritance:r` plus a grant to themselves, or moves it to an encrypted location. Encrypt `storage-state.json` with the existing DPAPI-protected master key, or keep cookies only in the persistent browser profile and delete the JSON. Give review screenshots and DOM a retention window (for example delete after the job is applied, skipped or 14 days). Add a startup check that warns if the state directory is readable by other principals.
- **Test:** unit test of the permission check on a temp directory; test that a storage file is not written in plaintext; test that the purge removes only expired review artifacts and never evidence bundles.
- **DoD:** the permission check reports clean, no plaintext session cookie file exists, and the retention policy is documented and tested. This audit changed no permissions.

#### SEC-02 Model data exposure (S)
- **Approach:** list exactly which fact keys any prompt can contain. Mask or exclude compensation, criminal-conviction, clearance and employer facts unless the question needs them, and then send only that fact. Record the serving provider per call. In the OpenRouter account, set the free-model training preference to exclude providers that train (the owner's setting), or use zero-retention routing. Review Z.ai's terms.
- **Test:** a prompt-capture test asserts private keys are never present and sensitive non-private keys appear only for the matching category; canary values.
- **DoD:** written list of fields that can leave the machine, provider data policy recorded, tests pass.

#### MAIL-01 Verification coverage and fail-closed messaging (S)
- **Approach:** state the Gmail requirement in the setup doc. For providers outside the allowlist, park immediately with a new code `EMAIL_VERIFICATION_UNSUPPORTED_PROVIDER` rather than waiting. Add providers only after capturing a real sender and message shape.
- **Test:** table test over provider names; unsupported provider parks in under one second.
- **DoD:** no wait-until-timeout on a provider that can never match.

#### OBS-11 Park expiry and revalidation (S)
- **Approach:** every parked review gets `parkedAt` and a time-to-live (proposed 24 hours for Workday, 72 for others). Before resume, re-run preflight and re-check the loaded identity. A posting that was reposted or closed becomes `CLOSED_AT_SOURCE` or `DRAFT_INVALIDATED`, not a silent failure.
- **Test:** fake clock; a fixture that serves a reposted job.
- **DoD:** `status` lists age and TTL for each park; expired parks are not resumed blindly.

#### FIX-09 Greenhouse code gate and widget traps (M)
- **Approach:** treat a visible security-code gate after Submit as its own state: not a receipt, not an ambiguous dispatch to retry. Handle eight single characters and six boxes. Park if mail does not arrive within a bound. Avoid the "Autofill my application" and "Enter manually" controls. Select "How did you hear" by click and confirm retention. Add per-widget interaction contracts so that Enter is used for Workday prompts and never assumed elsewhere.
- **Test:** fixtures for each trap (extend `otp.integration.test.ts` and `dynamic-form.test.ts`); a fixture where Enter must not select; a fixture with a code gate after a 200 response.
- **DoD:** no Greenhouse run reports `submitted` without a receipt, and a code gate resolves or parks with `EMAIL_VERIFICATION_PENDING`.

#### ACC-06 Candidate Home reconciliation for Workday (M)
- **Approach:** after a Workday submit, and when recovering a possibly dispatched one, open Candidate Home while signed in and look for the requisition in the applications list. Treat it as an extra proof source, labelled separately from `NETWORK_VERIFIED` and `EMAIL_RECONCILED`. Never click Submit during this.
- **Test:** fixture Candidate Home pages (listed, absent, withdrawn); crash fixture.
- **DoD:** a recovered ambiguous Workday submit resolves to one of applied, not applied or still unknown, from first-party evidence.

#### OUT-01 Outcome tracking and fit gate (M, owner decision)
- **Approach:** read-only mail classification for replies (acknowledgement, assessment, interview, rejection) tied to the receipt. Report per provider and per tenant. Add a fit gate beyond eligibility (title and skill overlap with a threshold the owner sets) so volume does not replace relevance.
- **Test:** classifier fixtures; threshold tests.
- **DoD:** `status` shows replies per 10 applications, and the fit threshold is documented.

#### OPS-01 Operating the worker on a Windows laptop (S)
- **Approach:** pin and record the Chrome version in the run ledger and fail loudly on a major-version change since the last passing probe. Test sleep and resume and a network drop during a fixture run. Verify that a park produces a visible notification, with a test that fires one. Rotate logs and artifacts.
- **Test:** fixture-based network-drop test; notification test.
- **DoD:** a Chrome update, sleep or network loss yields a recorded, recoverable state and a notification.

### 13.5 Added decisions and ordering

Add to section 10:

| # | Decision | Needed for |
|---|---|---|
| 11 | Is this tool for one person (you) or could it process other people's data? | S4 |
| 12 | Volume versus fit: set a fit threshold, or accept bulk applying | OUT-01 |
| 13 | Apply the permission lock-down on `state\autoapply` and set the OpenRouter free-model training preference | SEC-01, SEC-02 |

Ordering: SEC-01 and SEC-02 are small and independent. Put them with Bundle A. MAIL-01 and OBS-11
belong in Bundle B. FIX-09 joins the FIX queue after FIX-00. ACC-06 joins Bundle E before ACC-03.
OUT-01 and OPS-01 can follow Bundle D.

### 13.6 What this audit did not cover (coverage limits)

| Not done | Consequence |
| --- | --- |
| Full autoapply suite run | No fresh pass count; earlier counts are [D] |
| REA runtime build and REA captures | Vendor-script lists and form-contract hashes are missing (REA-01, REA-02) |
| Live read-only conformance sweep | Per-ATS current coverage is unmeasured (TST-03) |
| Labelled sample of the 536 experience skips | Experience-gate precision is unknown (FUN-02) |
| Full read of `runner.ts` (879 lines, 54 over 200 characters) | Only targeted slices were read; there may be loops or constants not listed in section 11 |
| `dashboard.ts` authentication, `vault.ts`, `evidence-verifier.ts` security review | Only behaviour recorded in docs and tests is relied on |
| `extension/` browser-extension path | Out of scope here; it also has uncommitted changes |
| `.github/workflows/autoapply-check.yml` | Unread; unrun |
| Any live or authenticated employer page | No new live evidence; all live facts are from earlier docs [D] |
| Legal review | S4 is an inference, not advice |

The next most useful step is the ticket order in 12.4, starting with Bundle A and SEC-01/SEC-02.

---

## 14. Owner decisions received 2026-10-31 and the re-plan

The owner answered the open questions in section 13.5 and stated the goal. Their words, then the
consequences. This section **supersedes** earlier sections wherever they conflict.

> Tool for me to get a job. A semi fit threshold with bulk applying. Ideally no AI: a code
> submitter that knows all similar semantics and can handle random cases. No to the test suite,
> it does nothing for me; run the applier. Jobs are fetched each hour, relevant for me at 0-3 years.

### 14.1 Decisions and what changes

| # | Decision | Status | Consequence |
| --- | --- | --- | --- |
| 11 | Single user, for the owner's own job search | **Closed** | S4 (data-handler scope) no longer applies. Multi-candidate code stays dormant. Personal-use framing holds [I, not legal advice]. |
| 12 | Semi fit threshold with bulk applying | **Closed, needs numbers** | New ticket FIT-01 defines a lenient, explainable score and a daily cap. |
| 13 | Lock down `state\autoapply`; model training preference | Open, but the second half is superseded by "no AI" | If no model calls are made, the OpenRouter setting stops mattering. The permission lock-down (SEC-01) still stands. |
| new | **No AI**: deterministic code that knows similar semantics | **Closed** | SOTA-02 (model fallback) is **withdrawn**. SEC-02 becomes "prove no model call can happen". SEM-01 to SEM-07 replace the model with deterministic semantics. See 14.3. |
| new | **No test suite** | **Closed (waiver)** | The suite is not run and is not a gate. See 14.5 for what replaces it, and the risk that remains. |
| new | **Run the applier**; hourly 0-3 year jobs are the pool | **Closed as intent; start is gated** | See 14.2 and 14.7. A rolling rule-based approval replaces the exact-URL list (FUN-01 revised). |

### 14.2 The biggest finding from the new decisions: the experience gate contradicts "0-3"

The scraper keeps roles at or below **3 years** (`config.ts`: `MAX_YEARS = 3`, "postings with no stated years are kept") [O]. The applier's preflight, however, skips a role when its
minimum years exceed the **profile's literal total experience, which is 1** [O: `candidate.json`,
`professional.totalYearsExperience`; `preflight.ts` lines 107-109]. So the two halves disagree about what "0-3" means.

| Measure [O] | Value |
| --- | --- |
| Rows skipped as `ineligible_jd_experience` | 536 |
| Of those, catalogue `minYears` = 2 | 104 |
| Of those, catalogue `minYears` = 3 | 142 |
| Of those, catalogue `minYears` = 1 | 1 |
| Of those, catalogue `minYears` null (the posting text decided it) | 289 |
| Queued roles today by catalogue `minYears` | 0 years: 23; 1 year: 48; null: 339; none above 1 |
| Catalogue rows by `minYears` (all 18,208) | 0: 370; 1: 824; 2: 1,615; 3: 1,871; null: 13,522; 4-5: 3; 6+: 3 |

**246 skipped roles have a catalogue `minYears` of 2 or 3, which is inside the owner's stated 0-3 band, and 289 more are undecided.** Preflight actually compares the minimum it parses from the posting text (falling back to the catalogue value), so a few of the 246 may parse higher, but the pattern is clear: the gate is the profile's 1 year, not the band. 16 of the 19 skipped "approved" roles were experience skips, and many of those likely sit in this group (L7).

The fix is a **separate target band**, not a change to the truth the applier tells employers:

- `targetMaxMinYears = 3` (from `MAX_YEARS`) decides whether to apply.
- `professional.totalYearsExperience = 1` stays the answer to "how many years do you have", and a required knockout whose lowest option excludes the owner parks, not guesses. The system never inflates experience.

This is ticket **FUN-05** (S), and it is likely the single largest increase in usable roles, larger than any form-filling fix. It is a decision the owner has made by saying "0-3"; the doc records it so it is deliberate and visible, not a hidden constant.

### 14.3 No AI: what is true today, and the plan

**Today the model is on.** The environment defines `ZAI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY` and `GEMINI_API_KEY` (names only checked; values never read) [O]. `worker.ts` line 67 always constructs `GroundedModel`, which builds Z.ai and OpenRouter providers from those keys. Groq and Gemini are inert unless `AUTOAPPLY_ALLOW_ACCOUNT_FREE_TIERS=1`, which is not set [O].

What the model actually does [O: `grounded-model.ts`]: it is an **intent classifier only**. It receives the question text, options, application URL and a facts object, and returns a canonical intent from a fixed list. The value is then resolved locally from the profile and must match the model's cited facts. It never writes free text. The facts object masks `personal.*` (except country), `answers.*` and `eeo.*`, but **does send** compensation, school, GPA, current employer and title, notice period, relocation, clearance and conviction values (S2, now confirmed live for the Z.ai and OpenRouter routes).

**Switching it off without any code change:** remove or blank the two active keys (and the two inert ones) in the git-ignored `.env`, then restart the worker. The worker loads `.env` with `process.loadEnvFile()`, which does **not** override variables that already exist in the environment [O: `worker.ts` line 238]. If the same keys are also set as Windows user or system environment variables, they must be removed there too. Check with `[Environment]::GetEnvironmentVariable('ZAI_API_KEY','User')` (and `OPENROUTER_API_KEY`) in PowerShell. This audit could not tell which source the keys come from. With no providers, `resolve` returns `undefined` and the field parks instead of being classified [O: `grounded-model.ts` lines 74-114]. This is an owner action; this audit did not touch `.env`.

**Ticket AI-OFF (S):** make the off state explicit and provable. `AUTOAPPLY_NO_MODEL=1` (default on, per this decision) prevents construction of `GroundedModel` and any outbound call to the four endpoints. `status` prints `model: disabled`. A one-line check at start refuses to run if a model key is present and the switch is not set.

Because the model only classified intent, a deterministic engine can replace it. The recognition gap it was papering over is real; see 14.4.

### 14.4 Deterministic semantics: replacing the model without losing coverage

What the code does now [O]: `classifyAtsField` matches **regular expressions** over the concatenated name, id, label, aria-label and placeholder text. There is **no use of the HTML `autocomplete` attribute**, **no typo tolerance and no fuzzy or similarity matching** (no hits for autocomplete, Levenshtein, similarity, Jaccard, synonym or stem in `classifier.ts`, `answers.ts` or `runner.ts`). New wording is handled by adding another regex; the "excepected CTC" typo was fixed exactly that way [D].

**Measured recognition baseline** [O]: across 20 checkpoint reports, 110 recorded field actions: 65 had a known category and **45 were `unknown`**. Of all actions, 31 were filled, 43 failed, 23 needed review and 13 were skipped. The unknown-category labels are mostly **recognition failures, not missing owner facts**:

| Unrecognized label (examples seen) | What it should be | Class of miss |
| --- | --- | --- |
| "What is your expected **gross** salary?" | expected salary | One extra word broke the pattern |
| "Have you been or are you at the moment working for ABB as a ..." | former employee | Phrasing variant of an existing category |
| "Are you willing to be contacted for future job opportunities" | talent-pool consent (owner decision needed) | Intent not defined |
| "I confirm that I'm 18 years old or elder, or, according to l..." | age-of-majority confirmation | Intent not defined |
| "Local Family Name", "Local Given Name(s)" | local-script name fields (Workday) | Platform wording |
| "Phone Device Type", "Phone Extension" | phone type; never-fill extension | Platform wording |
| "Drop files here or Select files", "Attach", "resume" | resume upload | Widget wording |
| `question_30082174003` ... (Greenhouse ids), `gdpr_demographic_data_consent_given_1` | label not read; id only | Label resolution failed |
| "input" (10 times) | unlabeled control | No label found at all |
| "Type to Add Skills" | skills prompt | Widget wording |
| "Password", "Verify New Password" | authentication, not an answer | Stale (repaired since) |

**The aim "knows all similar semantics and can do random cases" is achievable as a closed loop, not as omniscience.** No deterministic system can guarantee every random question is answered correctly on first sight. What it can guarantee is that **an unseen question is never guessed, is parked once, and is answered permanently after one owner reply**, and that near-duplicates of anything already seen are matched automatically. That is how the unknown rate trends to zero without a model.

#### SEM tickets (deterministic semantic engine)

##### SEM-01 Use the browser's own semantic standard first (S)
- **Problem:** the HTML `autocomplete` attribute is a standard, unambiguous field-meaning signal (`given-name`, `family-name`, `email`, `tel`, `tel-country-code`, `tel-national`, `street-address`, `address-level1/2`, `postal-code`, `country`, `organization-title`, `url`, `sex`, and so on) [W: MDN, WHATWG]. The code ignores it.
- **Approach:** read `autocomplete` (last token, ignoring `section-*`, `shipping`, `billing`, `home`, `work`, `mobile`) as the highest-confidence signal. Map tokens to intents in a small table. Combine with input `type` (`email`, `tel`, `file`, `date`, `number`) and stable platform ids (Workday `data-automation-id`, Ashby `_systemfield_*`, Greenhouse `first_name`/`email`). Label text only decides what these signals do not.
- **DoD:** every recorded signal source is journaled (OBS-05). The share of fields resolved by a standard signal is reported.

##### SEM-02 Normalizer and deterministic fuzzy matcher (M)
- **Approach:** normalize Unicode (NFKC), lowercase, strip required markers and punctuation, split camelCase and snake_case, expand a maintained abbreviation table (CTC, ECTC, LPA, YOE, DOB, NP, WFH, and similar), drop stopwords, apply light suffix stemming. Match against a per-intent phrase bank by weighted token overlap (Dice or BM25-style). Tolerate typos with Damerau-Levenshtein distance 1 for tokens of 5-8 letters and 2 for 9 or more. **Accept only when the best score clears a threshold AND beats the runner-up by a margin; otherwise the field is `unknown` and parks.** Journal the matched phrase, score, margin and signals so every decision is explainable.
- **Seed from the real misses above.** "Expected gross salary" and "excepected CTC" must resolve to expected salary with no extra regex.
- **DoD:** the baseline unknown rate (45 of 110) measurably falls on the same captured reports, and no field that was correct becomes wrong. Scored by re-running the matcher over saved checkpoints, not by a test suite.

##### SEM-03 Option and value semantics (M)
- **Approach:** generalize the strict-shape option rules (same name; name before a bracket; abbreviation in a bracket; trailing `.js`; ambiguity is empty). Add numeric-range option buckets ("0-1 years", "1 to 2", "Less than 1", "1+") matched against numeric facts with inclusive bounds. Yes/No polarity with negation ("I do not require sponsorship"). Equivalence classes already used for titles and cities. Date, phone and currency formats (LPA to INR exists). Indian states, cities and dial codes dictionaries.
- **DoD:** a required option set that cannot express the true answer (for example, lowest bucket "1-2 years" when the truth is 1) parks with `REQUIRED_ANSWER_MISSING` and is never matched to a false bucket.

##### SEM-04 Ask-once answer memory (M)
- **Approach:** store each owner-confirmed answer under a key of (normalized question signature, option-set signature, scope: global, employer or role). Look up exact first, then near-duplicate (high similarity, same polarity tokens, same option signature). Employer-scoped answers override global ones (existing precedence). For essay questions, the owner writes templates with deterministic placeholders (`{company}`, `{role}`); the engine fills placeholders and never composes text. Templates are flagged in the journal as templated.
- **DoD:** a second employer asking the same question in different words is answered from memory with no owner prompt, and the journal shows the matched stored signature.

##### SEM-05 Unknown-field protocol and ask-once sheet (S)
- **Approach:** required and unknown parks with the exact label and options. Optional and unknown stays blank. Parks are grouped across the queue into one ranked question sheet (also SOTA-09). Every answer promotes into memory (SEM-04). Report the unknown rate per 100 fields in `status` so the trend is visible.
- **DoD:** unknown rate per 100 fields is reported per provider and is non-increasing across campaigns.

##### SEM-06 Recognition report from real captures (S)
- **Approach:** a read-only command that replays the matcher over saved checkpoints and captures (SOTA-04) and prints which signal won, how many fields stayed unknown, and the top unknown labels. This replaces a test suite as the way to see semantic progress.
- **DoD:** reproduces the 45-of-110 baseline, then shows improvement after SEM-01 and SEM-02.

##### SEM-07 Widget contracts (M)
- **Approach:** one table of widget classes with their exact interaction and read-back rule: text, native select, radio group, checkbox group, searchable combobox (Greenhouse: click, not Enter), Workday prompt and selectinput (Enter required), split date, file dropzone, repeater (Add rows first), signature. Each contract ends in a read-back (SOTA-01). Unknown widget class parks with a snapshot reference.
- **DoD:** no widget path reports `filled` without a read-back.

**Unchanged limits:** SEM never invents consent, dates, employers, credentials or personal facts; everything resolved still traces to a stored owner fact. Sensitive and legal answers (disability, veteran, criminal record, relatives, export control) follow the existing explicit-scope rules, not similarity.

### 14.5 No test suite: what replaces it, and the risk that remains

The owner waives the suite. This audit will not run it, and it is **not a gate for any ticket**. TST-01 (tiering), TST-02 (regression corpus as tests) and TST-04 (remote CI) are **waived**. TST-03 (the live read-only sweep) is kept, because it is a run of the applier, not a test.

The per-ticket definition of done in 9.1 changes from "failing test, then passing" to:

1. `npx tsc --noEmit` is clean. This takes seconds and catches a whole class of breakage.
2. **Run-first verification:** the change is shown working on a real or captured step, with the evidence in the journal (OBS-05) and `status`, or on a replay of saved checkpoints (SEM-06).
3. **Canary after any runner change:** the next live run is one role per provider, supervised, before bulk resumes.
4. **A circuit breaker** stops the worker after N consecutive failures or any ambiguous submit (DET-04).
5. No secret or personal value appears in any journal, handoff or error (checked by reading a sample, not by a test).

**Risk the owner accepts, stated plainly:** with no automated regression check, a fix for one ATS can silently break another. The submit-state logic and identity guard are the dangerous parts, and they are what protect against duplicate or wrong applications. They already have tests in the repository; leaving those files untouched keeps that protection. Changes to `submission.ts`, `identity.ts` or the checkpoint-before-submit code should get the extra scrutiny of a supervised canary even though no suite runs. The doc's 9.4 claims table still applies: without live evidence nothing may be called "works".

### 14.6 Fit threshold, daily cap and the hourly pipeline

**Pool size, measured from the 2026-10-31T12:17Z catalogue [O]:**

| Measure | Value |
| --- | --- |
| Open rows posted in the last 7 days | 1,605 (all with `minYears` null or 3 or less) |
| Of those, India locations | 1,492 |
| New open India 0-3 roles in the last 24 hours | 181 (about 7.5 per hour) |
| Last 7 days, India 0-3, by provider | Workday 747; Lever 84; Greenhouse 24; Ashby 16; other 621 |

So the hourly fetch supplies far more roles than any safe daily cap. **Selection quality and freshness, not supply, are the constraint**, and 85% of the pool the gate counts is Workday, the hardest ATS (section 1).

##### FIT-01 Semi fit score, lenient and explainable (M, owner supplies the lists)
- **Hard gates (apply nothing outside them):** India or India-remote location; minimum years at or below `targetMaxMinYears` (3), unstated kept; not a hard-excluded or clearly senior title; no citizenship or clearance requirement; posting live at the source.
- **Soft score, 0-100, deterministic:** title-family match to the owner's target families (up to 40); overlap between posting keywords and the owner's skills list from the resume text (up to 40); freshness (up to 10); employer diversity (up to 10). The owner supplies target role families and a skills list once.
- **"Semi" threshold:** proposed default **35**, so only clear mismatches drop. Raising it later tightens quality without code changes. Every queued role stores its score and the reasons, shown by `status`.
- **Ordering:** score first, then freshness. Within a day, higher fit goes first.
- **Employer rule:** at most 2 active applications per employer at once, and not more than 3 in 14 days. Career-advice sources agree that 2-3 related roles at one company is normal, and that large numbers across unrelated teams look unfocused [W, medium; the exact limit is a policy proposal [I]].
- **DoD:** the queue shows score and reasons; thresholds are in one config file; a role below threshold is skipped with `LOW_FIT` and a reason.

##### CAP-01 Daily cap and pacing for bulk (S, owner picks the number)
- 181 per day is available, so a cap is a choice. **Proposed:** start at **15 per day** for the first week of live runs, **30 per day** once the challenge rate is known, never above a ceiling the owner sets. One active application per tenant. Jittered gaps. Hours of operation inside the owner's local daytime.
- This replaces the earlier "10 per day until acceptance" proposal in DET-03 with an owner-adjustable value.
- **DoD:** the cap is enforced across restarts and shown in `status`.

##### PIPE-01 Hourly intake with low latency (S)
- The worker polls every 3,600 seconds by default [O: `worker.ts`], so polling can add up to an hour on top of the catalogue's own latency (cold-board rotation about 2.5 hours; hourly cron; GitHub raw cache) [D: HANDOFF "Detection latency"].
- Poll every 10 minutes using the existing ETag conditional request, where an unchanged file returns HTTP 304 and costs almost nothing [O: `intake.ts`].
- Report in `status`: catalogue age, rows new this hour, rows passing each gate, rows queued, time from `postedAt` to first seen and to applied. Target: **p90 time from first seen to applied of 12 hours or less** for roles above threshold.
- **DoD:** the per-hour funnel appears in `status` from real polls.

### 14.7 "Run the applier": where things stand and the shortest honest path

**This audit did not start the applier.** No worker is running (PID 30372 is gone) [O]. The owner's statement defines a new standing approval class, but the previous approval was an exact-URL list, a system reviewer earlier rejected a broader rolling campaign, and the evidence says Workday dominates the queue and has not produced a receipt in about 18 hours of effort. Starting a bulk run today would mostly produce more parks.

The shortest path that still ends in applications:

1. **Turn AI off** (14.3): blank the model keys in `.env`.
2. **Lock down the state folder** (SEC-01) and **back up the source** (SOTA-11).
3. **FUN-05**: apply the 0-3 band so the real pool is visible.
4. **OBS-01, OBS-02, OBS-04**: so a run's outcome is explainable, as the owner could not audit it before.
5. **FUN-01 revised: a rule-based approval** (below). Without `--approved-jobs`, the worker takes the whole queue, which is the intended bulk mode once the rules exist.
6. **Start with Greenhouse, Lever and Ashby**, 85 roles queued today. They have public forms, no mandatory account, and the highest chance of real receipts. The worker's `--target-successes` option already prefers a missing gate provider. Run **headed and sequential**, one role at a time, until the first receipts and the first parks are understood.
7. Run Workday afterwards, per tenant, using the offline captures (SOTA-04) so each live attempt teaches more.

**FUN-01 revised: approval as rules, not URLs.** One signed file the owner creates once: provider allowlist; band (3); locations; fit threshold; daily cap; per-employer limit; excluded companies; expiry (for example 14 days); and a hash. The worker applies any queued role that satisfies the rules and refuses anything else. This matches "fetch hourly and apply to the relevant ones" without re-approving URLs, and it keeps the audit trail the earlier URL list provided. The system that gates tool use may still ask for explicit confirmation of the first live run; that gate is outside this document.

If and when the owner wants to run it by hand, Windows commands in the project's usual form are:

```powershell
cd D:\Jobscraper-next
node --import tsx src\autoapply\worker.ts --profile D:\Jobscraper-next\state\autoapply\portal-review\candidate.json --state D:\Jobscraper-next\state\autoapply\portal-review --submit --dashboard-port 8787 --poll-seconds 600
```

That starts the unrestricted queue in submit mode. Do not run it until steps 1 to 4 above are done, because today it would also take the 259 queued Workday roles and the loop in section 11 would continue. Use `--approved-jobs <file>` with a short list to start smaller.

### 14.8 Other items from the owner's decisions

- **Resume and cover letter without AI:** the existing deterministic preparation (resume PDF and templated cover letter from supplied facts) is the right shape [D]. Keep it; add role-family résumé variants chosen by FIT-01's title family, not generated text.
- **India job boards are outside the pipeline.** The catalogue covers ATS career pages. Naukri, LinkedIn and Instahyre are not covered, and LinkedIn and Indeed prohibit automation in their terms [W]. Treat them as manual channels; this is a coverage note, not a ticket.
- **Email-only postings** and referrals are not handled and usually convert better than cold applications [I]. Not in scope; noted so it is not forgotten.

---

## 15. Everything left, consolidated

This is the single list. It replaces scattered "remaining" items. **Sizes** S/M/L as in section 6.

### 15.1 Do now (small, high leverage, mostly no new behaviour)

| Order | Item | Size | Who |
| --- | --- | --- | --- |
| 1 | Blank the four model keys in `.env`; restart nothing (no worker is running) | S | Owner |
| 2 | Restrict `state\autoapply` permissions (`icacls ... /inheritance:r`) and decide the backup method | S | Owner |
| 3 | AI-OFF switch and `status` line | S | Code |
| 4 | FUN-05 target band 0-3 independent of profile years | S | Code |
| 5 | OBS-01 real failure reasons, OBS-02 reason codes, OBS-04 worker heartbeat | S each | Code |
| 6 | SEC-01 retention and plaintext cookie file | M | Code |
| 7 | FUN-01 revised: rule-based approval file | M | Code and owner |
| 8 | Owner supplies target role families, skills list, daily cap, employer limit | S | Owner |

### 15.2 Next (the semantic engine and the funnel)

SEM-01, SEM-02, SEM-03, SEM-04, SEM-05, SEM-06, SEM-07. FIT-01, CAP-01, PIPE-01. OBS-03 (`status` and `explain`), OBS-05 (journal), OBS-06 (decision log), OBS-07, OBS-08, OBS-11, MAIL-01. FUN-02 (labelled sample of experience skips: now partly moot because FUN-05 changes the gate; re-measure after it), FUN-03, FUN-04.

### 15.3 Then (failure classes, from live evidence)

FIX-00 (re-run the nine stale parks, sequentially, no submit), then FIX-01 to FIX-09. SOTA-03 (progress fingerprint), SOTA-04 (auto-capture), SOTA-06 (Workday auth state machine), SOTA-10 (tenant session budget), SOTA-01 (verified action), SOTA-08 (recipe cache, after measuring "Use My Last Application"), SOTA-09 (ask-once sheet), SOTA-11 (backup). ACC-01 (stage-reach funnel), ACC-02 (canary protocol), ACC-03 (live crash reconciliation), ACC-04, ACC-05, ACC-06. DET-01 to DET-06. OUT-01 (reply tracking, now optional given the owner's goal), OPS-01.

### 15.4 Withdrawn or waived by the owner's decisions

| Ticket | Reason |
| --- | --- |
| SOTA-02 bounded model fallback | No AI |
| SEC-02 as written (model data policy) | Replaced by AI-OFF; the OpenRouter training setting no longer matters if no calls are made |
| TST-01, TST-02, TST-04 | Test suite waived |
| S4 and decision 11 | Single user |
| Section 9.1 item 1 (failing test first) | Replaced by run-first verification, 14.5 |
| Fit-threshold open question (decision 12) | Answered; numbers in FIT-01 |
| SOTA-05 stateful offline replay | Kept but **optional**: it is a replay harness, not a test suite. If the owner considers it test infrastructure, drop it and rely on SOTA-04 captures plus supervised canaries |

### 15.5 Still needs the owner

1. Confirm `targetMaxMinYears = 3` as the apply band (FUN-05).
2. Provide target role families and a skills list (FIT-01).
3. Choose the daily cap and per-employer limit (CAP-01).
4. Confirm the first live run: scope (Greenhouse, Lever, Ashby first), headed and supervised.
5. Per-ATS tenant terms stance, especially Workday tenants that bar automated accounts (DET-06). The owner has chosen to automate; this records that the choice was made knowingly, and that account-creation by automation is the sharpest policy risk.
6. Approve `D:\REA` build (REA-01) only if REA captures are still wanted.
7. Unattended startup task: install or keep manual.
8. The talent-pool consent question ("willing to be contacted for future opportunities") and the age-of-majority confirmation seen in live forms: decide the standing answer, since each is a fact or consent the system must not guess.

### 15.6 Honest expectations

- **Likely quick win:** FUN-05 plus Greenhouse, Lever and Ashby, because the gate is the biggest blocker and these forms are public and simple. Expect the first real receipts there.
- **Likely slow:** Workday. One tenant at a time, each with account creation and email verification, and a long tail of widget variants. Capture-first debugging (SOTA-04) is the lever; the semantic engine (SEM-02, SEM-04) cuts the question-by-question parks.
- **Not promised:** that every unseen form is handled on first sight, that bot detection is never triggered, that a given employer replies. Each application is one honest, evidence-backed submission; the unknown rate and the challenge rate are measured and reported rather than assumed.

---

## Appendix A. How this audit was gathered (re-runnable, read-only)

Run from `D:\Jobscraper-next`. These only read. Do not run them against a live
worker's SQLite file with a writer attached other than in read-only mode.

- Queue funnel: open `state/autoapply/portal-review/queue.sqlite` with `node:sqlite` in `{ readOnly: true }`; parse the `payload` column; group by `status` and, for skipped rows, by `error`.
- Failures and parks: for each `state/autoapply/portal-review/applications/*/`, read `checkpoint.json` (`report.status`, `report.reason`, `report.reviewKind`, `report.fieldsFilled`, `report.unmappedFields`) and `handoff.json` (`observedAt`, `questions[].question` and `.reason`). Do not print `storage-state.json`.
- Approved-set feasibility: join `out/campaign-proposal.json` `jobs[].url` to the queue by `jobUrl`.
- Worker liveness: compare `worker.json` `pid` and `observedAt` with the process list.
- Typecheck: `node --import tsx node_modules/typescript/bin/tsc --noEmit` (the npm and npx shims can be broken on this machine, per `HANDOFF.md`).
- REA availability: `node D:\REA\scripts\rea.mjs --help`.
- Autoapply suite: the `test:autoapply` command in `package.json`, written to `out/audit-2026-10-31-autoapply-suite.log`.

## Appendix B. Web sources (fetched 2026-10-31)

| Source | Used for | Confidence |
| --- | --- | --- |
| Greenhouse Support, "Invisible reCAPTCHA" (updated 2026-03-02): `https://support.greenhouse.io/hc/en-us/articles/115005448066-Invisible-reCAPTCHA` | reCAPTCHA signals, email-code fallback, per-board spam sensitivity | High, vendor documentation |
| Greenhouse Support, "Fraud Detection and Spam Blocklist, Security & Privacy FAQ" (updated 2026-01-13): `https://support.greenhouse.io/hc/en-us/articles/45397232315035-Fraud-Detection-and-Spam-Blocklist-Security-Privacy-FAQ` | Fraud signal categories, data-centre IP, timezone mismatch, blocklists | High |
| Greenhouse press release, Real Talent launch (2025-06-03): `https://www.greenhouse.com/newsroom/greenhouse-real-talent-tm-launches-to-fix-overwhelming-candidate-pipelines-while-combatting-fraud-and-spam-in-hiring` | Vendor intent to filter bulk automated applying | Medium, marketing |
| Ashby docs, "Job Board: Application Spam Protection" (updated 2026-07-13): `https://docs.ashbyhq.com/job-board-application-spam-protection` | Spam protection levels | High |
| Ashby docs, "Candidate Fraud Detection Overview & Admin Settings": `https://docs.ashbyhq.com/candidate-fraud-detection-overview-and-admin-settings` | Device, IP, email, phone signals | High |
| Workable Help, "Managing AI-assisted and automated job applications": `https://help.workable.com/hc/en-us/articles/35293126257815-Managing-AI-assisted-and-automated-job-applications` | AI-assisted tag, email replacement, WAF and IP reputation | High |
| Lever `postings-api` README: `https://github.com/lever/postings-api` | Apply requires a posting-form key; not a candidate route | Medium (apply details taken from a third-party OpenAPI mirror) |
| Workday Online Terms of Service (last updated 2026-08-13): `https://www.workday.com/en-us/legal/site-terms.html` | Governs `workday.com` sites, not employer tenants | High for scope stated |
| Sprinklr Candidate Portal terms (Workday-powered, 2022): `https://get.sprinklr.com/hubfs/SprinklrCandidatePortal-Terms&Conditions.pdf` | One example of a tenant clause that accounts must not be automated bots | High for that tenant; not general |
| ApplyLoop, "Does Auto Apply Get You Banned?": `https://applyloop.pro/does-auto-apply-get-you-banned` | Summary of Indeed and LinkedIn terms | Low-medium, third-party summary. Indeed and LinkedIn are out of scope for this project. |
| Nox and ArgoApply blogs on ATS bot defences | Background on reCAPTCHA/hCaptcha deployment only | Low, vendor blogs. Not relied on for any rule or number. |
| FormFactory benchmark, arXiv 2506.01520: `https://arxiv.org/html/2506.01520` | LLM form-filling accuracy limits | Medium-high |
| Jobsistant, "Job Application Field Notes" (reviewed 2026-10-22): `https://jobsistant.com/research/job-application-field-notes` | Workday behaviours: account first, Enter-driven prompts, option matching, résumé input | Medium; first-party, small sample, commercial interest disclosed |
| Browser-agent comparisons: `https://menuagentic.com/blogs/browser-use-vs-stagehand-vs-skyvern-vs-playwright-mcp/`, `https://chatforest.com/guides/mcp-browser-automation/`, `https://www.agentlist.top/en/articles/browser-agent-data-extraction-form-filling/` | Accessibility-tree-first design; verification for writes | Medium; secondary summaries |
| Greenhouse Job Board API: `https://docs.greenhouse.io/job-board`; Ashby `applicationForm.submit`: `https://developers.ashbyhq.com/reference/applicationformsubmit` | Employer-key requirement for official submit endpoints | High |
| ctriolab, "Workday jobs API": `https://ctriolab.com/jobs/workday-jobs-api/` | Public `cxs` JSON serves postings | Medium |
| `Shubhambawner/form-filler-agent`, `oxideclaw` loop detector, PraisonAI doom-loop docs | Record-and-replay and loop-detection design patterns only | Low; ideas, not evidence |
| MDN `autocomplete` attribute: `https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/autocomplete`; WHATWG HTML forms standard: `https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill`; token list summary: `https://notes.zander.wtf/notes/autofill/` | Standard autofill field-name tokens as a deterministic semantic signal (SEM-01) | High (standards and MDN); the token list summary is secondary |
| Workday `data-automation-id` values seen in public automation projects (`email`, `password`, `verifyPassword`, `createAccountCheckbox`, `click_filter`, `beecatcher`, `promptOption`) | Stable platform ids as a semantic signal | Low to medium; public hobby projects, consistent with our own captures |
| Multiple applications at one employer: Monster (Ask Vicki), Business Insider (2024-10-21), CNBC (2025-10-17); Ashby application limits `https://docs.ashbyhq.com/application-limits` | Basis for the per-employer limit in FIT-01 | Medium for the pattern (career-advice sources agree that 2-3 related roles is normal and many unrelated roles looks unfocused); the exact limit is our proposal; Ashby documents employer-side throttling rules |
| OpenRouter privacy docs: `https://openrouter.ai/docs/guides/privacy/provider-logging`, `https://openrouter.ai/docs/guides/privacy/data-collection` | Provider-dependent retention and training, separate free and paid settings | High |
| MeitY and PIB on DPDP Rules 2025: `https://www.pib.gov.in/PressReleasePage.aspx?PRID=2190014&lang=2&reg=3`, `https://www.dpdpa.in/dpdpa_rules_2025/dpdpa_rules_english_2.pdf` | Notified 13 Nov 2025; phased 18-month start | High for dates; no legal conclusion drawn |
| Greenhouse security-code write-ups: `https://jobbie.bot/blog/greenhouse-security-code`, `https://find-best-job.com/en/blog/greenhouse-application-form`, a landed.jobs LinkedIn post, a moltbook build log; Greenhouse status incident via OnlineOrNot | Code gate after submit, per-org behaviour, form traps | Low to medium; third-party observations, one status incident |
| Workday applicant guides: State of Oregon DAS job aid (`https://www.oregon.gov/das/HR/Documents/Recruiting%5FExternalCandidateApplication.pdf`), W&L, UW, UBC, Denver Health | Three entry options, draft invalidation on repost, Candidate Home, no edit after submit | Medium; several consistent institutional sources |

## Appendix C. Today's test run

Typecheck: clean (`tsc --noEmit`, no output).

**The full `test:autoapply` suite was NOT completed by this audit, and no pass count is claimed.**
A first background launch died when its terminal call returned, leaving an empty log. A
second foreground launch was stopped by the user. `out/audit-2026-10-31-autoapply-suite.log`
is therefore empty or partial and must not be quoted. The most recent recorded results remain those
in `HANDOFF.md` and `autoapply-tickets.md` (for example 86/93 combined, with the seven failures
re-run individually and passing), which are [D], not re-verified today. TST-01 exists in part
because a silent, slow suite makes this kind of check costly.
