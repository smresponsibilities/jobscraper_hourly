# Auto-apply portal verification

Checked 30 October 2026 using the local REA CLI at `D:\REA\scripts\rea.mjs`.
Initial public inspection used fresh owned browser profiles. Subsequent owner-authorized
review used a saved candidate session. AiPrise Software Engineer I, Bengaluru,
was submitted on 30 October 2026 with the corrected resume. The employer displayed
"Your application was successfully submitted. We'll contact you if there are next steps."
The private queue and checkpoint retain that receipt. Local browser regressions
use synthetic candidates and temporary documents.

## Follow-up live checks and confirmed outcomes

Public read-only checks revisited all eleven portal families on 30 October.
Raw observations are in ignored `out/portal-audit/major-readonly-current.json`.
Candidate entry was explicitly approved for UiPath, Abacus Insights and Emerson.
The owner subsequently completed forms manually. The saved queue now records:

- AiPrise: successful submission receipt, retained from the earlier run.
- Abacus Insights Associate SRE: confirmation page states, "We've received your
  application and wanted to confirm it's now in front of our team."
- UiPath Software Engineer I: employer states, "You have already applied to this
  position." Recorded as an existing application, not a new successful submission.
- Emerson Backend Developer: page states the job is no longer available. No submission.

Both newly confirmed outcomes were reconciled with `submit:false`, without
another submission click. Their private receipts and checkpoints are retained.

| Portal | Follow-up result beyond the confirmed applications |
| --- | --- |
| Workday | Amgen's current sample required at least two years of experience and was not submitted. Earlier owner-authenticated Nvidia structural checks remain valid; that senior UK sample was never submitted. |
| Lever | The catalogue's India Beghou posting returned API 404. A public AllTrails form remained reachable for structural review, without candidate entry. |
| Workable | A public Weekday form remained reachable and required current salary, which is absent from the saved profile. No candidate entry in this follow-up. |
| Recruitee | Lenskart's reviewed frontend role required 3–6 years; its Android role also required more experience than the candidate. Neither was submitted. |
| SmartRecruiters | BlueOptima remained behind a DataDome restriction. |
| Taleo Business Edition | The reviewed IFPRI registration page was for Papua New Guinea, outside candidate preferences. |
| SuccessFactors | Allianz remained at sign-in. |
| iCIMS | The earlier Applied Systems link redirected to an iCIMS page returning 403. |

See [open-source review](autoapply-open-source-review.md) for inspected source
implementations. Public form visits, synthetic tests and employer receipts are
different evidence; this does not establish universal autonomous ATS coverage.

## Initial structural results and evidence

| Portal | Observed public behavior | Regression evidence |
| --- | --- | --- |
| Greenhouse, Fictiv | Real application form; hidden ID-only resume control, required upload group, searchable comboboxes, CAPTCHA | Captured form identity/upload test plus required-group, typeahead and CAPTCHA regressions |
| Lever, AllTrails | Current application discovered through public posting API; real full-name, email, phone and resume controls | Captured form identity/upload test; unknown required answer remains blank |
| Ashby, Camunda | Current application discovered through public posting API after a stale catalogue sample | Captured form full-name/email/upload test; unknown required salary remains blank |
| Workable, Weekday AI | Application link opens a real form; resume input has opaque ID and referenced label | Captured identity/upload test with actual required salary/notice questions |
| Recruitee, Castolin | Real form with dotted field names and required legal agreement | Captured identity/upload test; no guessed legal consent |
| Taleo Business Edition, IFPRI | Registration form requires email and passwords | Known identity fills; passwords stay blank; authentication is not submitted |
| SuccessFactors, Allianz | Sign-in form requires email and password | Known email fills; password stays blank; sign-in is not submitted |
| iCIMS, Applied Systems | Login is inside an iframe and begins with email, followed by hCaptcha | Supplemental live iframe DOM and local iframe regression; email fills but Continue is not clicked |
| Oracle, Akamai | Active job opens `/apply/email`; email, honeypot and required terms | Supplemental live DOM and local authentication regression; honeypot/terms stay empty and Next is not clicked |
| SmartRecruiters, BlueOptima | Application endpoint presents DataDome CAPTCHA | Explicit DataDome detection and fill-then-review regression; application form behind CAPTCHA remains unverified |
| Workday, Nvidia | Owner signed in; authenticated My Information form inspected. The sampled senior UK role was never submitted | Structural regressions cover named listbox buttons, radio question labels, country calling codes and unknown optional fields; end-to-end submission remains unverified |

Green tests establish the assertions in those tests. Login/CAPTCHA handoff is
not evidence that the employer accepted an application. AiPrise is one verified
Ashby submission, not universal portal coverage. Other vendor submission endpoints
remain unverified. Taleo Business Edition is not evidence
for Enterprise Taleo coverage.

## Evidence identities

Raw captures and requests remain under ignored `out/portal-audit/`. Structural
fixtures record their source URLs and evidence identities in
`src/autoapply/portal-snapshots.test.ts`.

- Greenhouse: `ev_40a5ec4b5b2f4556252cb9276606c148fde81f66365ec89430559a90bcd2c93d`
- Lever: `ev_1784175217298b5d3ad786279bef1b23834117ccd78acb73117867f791f16ecb`
- Ashby: `ev_379270293e231944de6f6269518a19667402b30980d435184a9a4d683765874f`
- Workable: `ev_4717ca7da059ef4d1a5d7278f14e82e7c69f80fc97164b51de635c058986e91f`
- Recruitee: `ev_af205977c2b39279e3613f1d7e2fd17f0c7fc6183548958a634f9e20e535bf63`
- Taleo: `ev_3d215b3c5884e92aa637a79978cc8891de1f7d746e3a6e50ce0d04ced8efdcad`
- SuccessFactors: `ev_1ba29637de2b8f374623f3101eb91639ec0f5dcc3c3b14e18c510f8f0f3ece18`
- iCIMS outer shell: `ev_f41f322fe6b7edf2daf9cddefd0073628e3f6098f50a289bd1aafb2f6ef4945d`
- Oracle current job: `ev_356c11e2b75f82107b1db1f52f6f5102f819373b488fa69e16ffcaf4f5641c42`
- SmartRecruiters CAPTCHA: `ev_e76aa45c5dff7d5bd57d6bd4690f2b3c5200b82923416a2f7d82bac1dc39287b`
- Workday failed Apply capture: `ev_797516a4f9aef3ffffbc0540fee1f4411e86e1b12e284f792a7a181f033f2a4b`

REA scenario DOM captures exclude iframe documents. iCIMS inner fields and
Oracle's authentication screen were inspected separately with Playwright;
their hashes and provenance are recorded in tests and runtime-supplement.json.
Failed or expired samples are not compatibility passes.

## Running checks

```powershell
cd D:\Jobscraper-next
npm run test:autoapply
npm test
npx tsc --noEmit
```

For headed authentication handoff, complete sign-in or verification in the
browser, then press Enter in the CLI. Unknown consent can be answered in the
browser; resumed review preserves checkbox/radio answers and uploaded files.
