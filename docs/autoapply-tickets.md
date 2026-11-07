# New autoapply tickets and acceptance

Source: attachment cea95d95-f5b6-44ad-8c05-754ba9d2691b/pasted-text-1.txt.
Keep changes local. Existing applied jobs must never be resubmitted.

| Ticket | Required behavior | Status |
| --- | --- | --- |
| STEALTH-01 | Log-normal typing with bigram timing | Implemented in runner pacing and delay helper; no universal evasion claim |
| STEALTH-02 | Cubic pointer paths for submit, checkbox and dropdown interactions | Local trusted-event/trajectory fixture passed |
| STEALTH-03 | Native viewport, launch flags and host-consistent hardware metrics | Native Chrome/API fixture passed; hardware remains native |
| FORM-01 | Mutation/request-aware iterative rescanning | Local remount/shadow/async fixtures passed; delayed authentication regression added |
| FORM-02 | Retain ARIA/React-Select selected values and pills | Single/multi-value retention and unsupported-extra fixtures passed |
| FORM-03 | Network events belong only to active related pages | Related-page scoping and cross-tab fixtures passed |
| AUTH-01 | Deterministic 14–16-character passwords, all classes, no adjacent duplicates | Versioned 16-character vault policy implemented and tested |
| AUTH-02 | Scoped asynchronous mailbox OTP resolution | Scoped mail and local SMTP/restart fixtures passed |
| AUTH-03 | Existing-account recovery and email password reset | Bounded encrypted recovery and delayed-mail fixtures passed; live compatibility unproven |
| SUB-01 | Network-anchored employer submission proof | Four-provider response adapters and late API receipt fixtures passed |
| SUB-02 | Validation bounce versus dispatched ambiguity | Validation, ambiguous dispatch and killed-worker fixtures passed |
| SUB-03 | Immutable verifiable payload/document/HTML/image/network evidence | Signed encrypted bundles and independent verifier implemented; synthetic proof fixtures passed |
| ATS-01 | Shared strategies for iCIMS, SmartRecruiters, Workable, Oracle HCM, SuccessFactors, Taleo and Recruitee | Eight domain/browser contract tests pass, including exactly one local submission per platform; live certification remains open |
| FORM-04 | Workday container scoping, hierarchy, attempt caps and loading transitions | Focused hierarchy, remount-limit, overlay and sticky-footer fixtures pass |
| FORM-05 | Root-local shadow labels and detached controls | Shadow visibility, lookup/removal race and conditional-frame fixtures pass |
| RECOVERY-01 | Pending form requests pause and resume in the same tab | Held-response fixture passes; unresolved requests block progression and final submission |

Production exit criteria remain separate from ticket implementation:
- [ ] 50 real end-to-end applications across Workday, Greenhouse, Lever and Ashby,
  with no manual browser intervention. Local/synthetic runs do not count.
- [ ] Live crash/reconciliation acceptance without double submission.
- [ ] Every counted success has independently verified network-anchored evidence.

Hashes prove local evidence consistency. They are not employer digital signatures.
No claim of universal undetectability or guaranteed CAPTCHA clearance is valid.

Current evidence: `out/major-ats-regression.log` reports 86/93 passing. All seven
failures subsequently passed targeted reruns: two login identity fixtures,
unchanged-candidate CLI review, and four receipt/identity/upload/duplicate workflows.
See `out/login-identity-regression.log`, `out/cli-budget-regression.log` and
`out/cli-remaining-regression.log`. Final observed-form snapshots pass 9/9 in
`out/ats-snapshots-final.log`; strategy contracts pass 8/8 in
`out/ats-strategies-scoped.log`. Latest typecheck passes. These are separate runs,
not a claim that the original combined command passed.

The live worker is limited to the approved ABB role and remains on an unfinished
form POST, with no final submission attempt or new receipt. The wider campaign's
50 approved URLs remain the submission boundary. Local ticket implementation is
not production acceptance.
