# ATS automation coverage

`src/autoapply/wizard.ts` owns `ATS_STRATEGIES`, the shared map of hostnames,
form markers and navigation hints. Native role and label locators remain the
primary interaction mechanism. The map supplements them for legacy controls.

| Platform | Form contract | Navigation and evidence |
| --- | --- | --- |
| Workday | Container-scoped `formField-*` controls; UXI prompts, split dates, named history groups and hidden uploads | Footer controls, active-step transitions, visible loading indicators, scoped leaf selection and retained values |
| Greenhouse | Existing application form and custom controls | Existing local browser and observed-form snapshot coverage |
| Lever | Existing application form | Existing local browser and transport coverage |
| Ashby | Existing custom yes/no and list controls | Retained React/ARIA state checks and existing browser coverage |
| iCIMS | Main wrapper or content iframe | All browser frames, including nested cross-origin frames; native Next/Continue inputs |
| SmartRecruiters | `.smartrec-apply` | Send Application through the shared submission observer |
| Workable | `section[data-ui="application-form"]` | Native inputs and existing combobox selection; shared Next/Submit handling |
| Oracle HCM | `spl-form-field` or form component | Native locators pierce open shadow roots; labels resolve inside their own root |
| SAP SuccessFactors | `#applyForm` or `.sf-form` | AJAX-dependent rescans and native Next/Continue inputs |
| Taleo | Legacy main form and frame patterns | Save and Continue inputs/links and legacy Submit hints |
| Recruitee | `.offer-apply-form` | Required recruitment privacy acknowledgement uses saved authorization; shared Submit handling |

Seven synthetic contracts exercise one local submission each for iCIMS,
SmartRecruiters, Workable, Oracle, SuccessFactors, Taleo and Recruitee. They cover
cross-origin frames, open-shadow labels, asynchronous wizard transitions and
required privacy controls. They do not establish live employer acceptance.
See `src/autoapply/ats-strategies.test.ts` and `out/ats-strategies.log`.

## Shared control rules

The runner visits every browser frame and uses native locators to pierce open
shadow roots. A second recursive DOM scanner is unnecessary. Field labels and
combobox popup IDs resolve in the control's own document or shadow root. Hidden
shadow hosts remain excluded. Closed shadow roots still require platform support.

Workday scans application field containers and excludes floating prompt internals
and `beecatcher`. Source categories may be traversed only to find the requested
leaf. The runner never selects an arbitrary university, referral source or degree.
An identified sibling `click_filter` may receive one native click when it covers
the intended control. Final Submit is never retried merely because it timed out.

Each field has at most two mutation attempts per fill pass, keyed by stable
identity. An exhausted required field blocks navigation; other fields continue
filling. Workday navigation waits for loading indicators to disappear and the
active step to change or a visible validation error to appear. Global
`networkidle` is not a readiness condition because background requests can persist.

Equivalent option names preserve confirmed facts. Examples include Mr/Mr.,
Mobile/Cellular, Bangalore/Bengaluru and BE/Bachelor of Engineering. Distinct
degrees and unconfirmed legal, demographic or skill declarations are not aliases.

## Job discovery and preflight

The hourly scraper publishes the catalogue consumed by `CatalogueIntake`.
Conditional requests, cached snapshots, canonical requisition identities and the
durable queue prevent duplicate intake. Existing public job APIs provide live
details for Greenhouse, Lever, Ashby, Workday, SmartRecruiters and Recruitee.
Other sources receive a bounded GET. Preflight rejects closed postings, stale
catalogue entries, incompatible locations and experience requirements before
opening a browser. Transient HTTP failures remain retryable.

Application data is sent through the employer's browser form. A public discovery
API does not grant application-submission access. CAPTCHA and login gates retain
their existing handling. The strategy map makes no claim of bypassing challenges.

Submission success requires employer evidence. Prepared/dispatched transactions,
receipt reconciliation and captured evidence remain shared across platforms.
The separate 50-application live acceptance target remains incomplete.

An outstanding form request now produces a network pause instead of a generic
failure. The worker retains the tab, blocks another application at that tenant,
and resumes after pending requests finish and no login/challenge gate remains.
After fifteen minutes it retains a review checkpoint. It never treats a pending
POST as proof of application submission. A held-response fixture verifies that
the dependent required field mounts and fills after automatic recovery.
