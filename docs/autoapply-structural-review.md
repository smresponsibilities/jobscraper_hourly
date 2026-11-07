# Autoapply structural review

Source: user review and attachment d632249d-da8c-4875-879c-50016f3796b1.

The supplied Workday integrity-score and timing thresholds are unverified claims.
Pacing does not establish recruiter visibility, CAPTCHA clearance or undetectability.

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| Step and final-review dwell | Stealth mode enforces a randomized 4–8 second minimum step dwell and 15–30 second review pause. It rescans and validates after review before preparing Submit. Field pauses reuse the bounded log-normal delay helper. | Native-event timestamp fixture, `out/structural-dwell.log` |
| Fresh controls after mutation | Existing iterative scans reacquire keyed locators. Visibility checks require a connected element. Removed frames are skipped only when actually detached. | Dynamic remount and detached-frame fixtures in `dynamic-form.test.ts` |
| Invisible and robot-only fields | Computed ancestor opacity, visibility, display and far-off-screen positioning are checked. Explicit robot-only fields are skipped. Visible fixed-position and below-fold fields remain fillable; known file uploads retain their separate path. | `out/structural-visibility.log` |
| Custom Yes/No state | Native pointer clicks target the option node. ARIA radios and existing Ashby hidden-checkbox/button controls require retained selection rather than visual styling alone. | Positive and visual-only negative fixtures in `dynamic-form.test.ts`; existing Ashby fixtures |
| Tenant storage isolation | Worker owns a persistent browser context and profile per canonical ATS tenant. Idle owners close; active reviews retain their tenant context. Existing shared profiles are not copied into new tenant profiles. | Worker same-host cookie test and same-origin profile storage test |
| Workday prompt scope and Enter | Actual ABB markup confirmed `activeListContainer` inside `responsiveMonikerPrompt`. Workday options are scoped to that active container. Enter triggers search; selected pills are checked before and after selection. | `out/structural-workday-prompt.log`; source fixture requires Enter and includes an unrelated phone pill |

User-confirmed prefix, mobile phone, unemployment, standard recruitment privacy
authorization and employer-scoped answers remain saved in the private profile.
Suggested blanket declarations in the pasted review are not evidence of personal
employment, relatives, conflicts, export-control status or skill experience.

Workday experience and education fixtures now cover repeated rows, split month/year
controls, and exact resume bytes through a hidden upload input. Year-only education
does not invent a month. Both fixtures pass in `out/workday-experience.log`.

The existing token-protected loopback dashboard supports filling one wizard step
without submitting. `--review-steps` parks after each step; `scripts/reconcile-current-step.ts`
requests one continuation and reports its checkpoint without exposing values or tokens.
The browser fixture proves same-tab reuse, rejected unauthenticated requests and zero
submission despite global submission permission. Evidence: `out/warm-step-regression.log`.

Production acceptance remains incomplete. No application has been submitted during
this structural audit. Sequential ABB verification resumes with the persistent worker.

Live ABB verification reached Voluntary Disclosures with preceding wizard pages
marked complete. Named Workday groups and noncontiguous record IDs required
additional selector and row-order fixes, covered by `out/workday-row-order.log`.
ABB's explicit gender nondisclosure option was selected. The current live blocker
is form convergence despite no failed field actions. Outstanding request tracking
needs diagnosis before changing its wait policy. No final submission occurred.
