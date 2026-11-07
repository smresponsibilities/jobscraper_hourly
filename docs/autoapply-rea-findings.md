# Autofiller artifact inspection with D:\rea

Inspected on 2026-10-31. This is a static inspection of the installed Simplify
Copilot extension, separate from the open-source web research. It does not
establish that the installed package is the newest marketplace release.

## Target and reproducibility

- Package: **Simplify Copilot 3.1.10**, Manifest V3.
- Extension ID: `pbanhockgagggenencehbnadejlgchfc`.
- Original application package: `C:\Users\sm\AppData\Local\Google\Chrome\User Data\Default\Extensions\pbanhockgagggenencehbnadejlgchfc\3.1.10_0`.
- Workspace snapshot: `out/research/simplify-3.1.10`, 50 application files,
  38,579,897 bytes. Browser profile databases and extension user storage were
  neither copied nor inspected.
- REA directory-artifact digest:
  `486a18f4f2db8d81739731e6d6e0b20976c800b527e004211685a01fb17940cf`.
- REA retained partial Evidence:
  `ev_0f80306cb9583825c76e54101da4e32ebfa1dc68b1cb65d63e0833ccef57ece7`.
- Complete returned record: `out/research/simplify-rea-analysis.json`.
- Compact observations and individual file hashes:
  `out/research/simplify-static-findings.json`.

`D:\rea` reports package version 6.7.0. Its compiled `dist` CLI/worker was
missing, and no REA MCP tools were connected. An initial source-service request
retained inventory Evidence
`ev_d31428f842f0cfb7e8fb88bd26e5b3ab8a60eaf40c26f419396fcfadae3b0857`
but failed to start `dist/composition/javascriptAnalysisWorkerProcess.js`.

The existing worker source was then bundled with the already-installed esbuild
into workspace scratch. A process-local Node resolve hook selected that worker.
This changed neither `D:\rea` nor client configuration and installed nothing.
The scripts are `out/research/build-rea-worker.mjs`, `rea-worker-hook.mjs`, and
`run-rea-simplify.mts`. They execute the analysis tool, never the target extension.

## Observed architecture

| Observation | Evidence and implication |
| --- | --- |
| One extension background worker, content scripts in browser frames | `manifest.json` declares `background.js`, an `all_frames: true` content script at `document_end`, and a top-frame restoration script at `document_start`. This supports reusing an existing browser session; it does not prove an account-login algorithm. |
| Configured ATS adapters, rather than one generic selector | Packaged `remoteConfig.json` has `ATS`, `fieldNameAliases`, `fieldCategories`, `fieldDependencies`, and platform-specific `inputSelectors` and `trackedInputSelectors`. Workday maps 49 profile keys, including identity, contact, education, experience, languages, skills and source. |
| Workday question containers and widget-specific interpretation | `ATS.Workday.trackedInputSelectors` uses `formField` containers, excludes `signInContent`, and separates selects/radios, ordinary inputs/textareas, and listbox buttons. The ordinary text rule excludes password fields and UXI `selectinput`/multiselect internals. |
| Explicit retained-selection checks | The Workday button-listbox rule reads selected display text only when the button is not expanded and is not still `Select One`; option recipes are scoped to active/open popup containers and selected ARIA state. |
| Bounded progression and separate final submission | `ATS.Workday.maxContinueRetries` is 1. Continue predicates exclude Submit/Send and review pages. Submit predicates recognize Submit/Send or the review page. `proxySubmitButtons` is enabled. These are distinct operations, not a single generic Next loop. |
| Job identity remains distinct from company identity | `ATS.Lever.trackedObjExtractors` constructs `lever:{{companyName}}/{{jobId}}`; Workday extractors also retain company and job components. The package does not flatten all company roles into one application. |
| Saved-answer events retain role context | `contentScriptMain.js`, around UTF-8 byte 648754, initializes a saved-answer context with `atsKey`, `trackedObj`, `applicationUrl`, `jobTitle`, `companyName`, and extension/config versions. Enablement is gated by config, settings and authentication. A visibility-change listener flushes an answer event queue. |
| Success detection is a separate recipe | ATS config has separate `submitButtonPaths` and `submittedSuccessPaths`; `contentScriptMain.js`, around byte 786598, searches the configured success paths. Static DOM-success detection does not itself establish employer network acceptance. |
| Page changes trigger reevaluation | `content-scripts/content.js` contains URL/config gating and a MutationObserver whose retry delay starts at 300 ms and grows to 5 seconds, resetting when the URL changes. This is evidence of mutation-aware discovery, not proof that every mutation is handled. |

The configuration observations are ordinary JSON parsing of pinned package bytes.
The byte-offset findings are ordinary static inspection of the same minified
bundle. They are identified separately from REA-derived graph facts. No package
bootstrap, content script, browser event or submission was executed.

## How this informs same-company grouping

Use a company or ATS-tenant group to schedule roles together and reuse the
authenticated browser context. Preserve a distinct requisition key, form state,
screening answers, submit transaction and receipt for every role.

Candidate profile facts can be reused broadly. Confirmed employer-scoped facts
can be offered across that employer's roles when the question has the same
meaning. Role-specific motivation, compensation exceptions, location preferences,
skills or declarations must keep their original scope. The observed saved-answer
context supports retaining those boundaries; it does not prove that Simplify's
server implements the same answer-sharing policy as this project.

Prefer explicit field recipes, dependency relationships, mutation-aware rescans,
retained-value checks and bounded retries. A shared company heading should not
become a batch Submit control or a reason to infer unknown candidate facts.

## Coverage and remaining unknowns

REA inventoried 15 relevant application files and selected `manifest.json`,
`content-scripts/content.js`, `pageScript.js`, and `contentScriptMain.js` for
analysis. It parsed three JavaScript files, visited 661,432 AST nodes, and retained
91 application graph nodes and 13,078 semantic nodes. The main minified bundle's
semantic analysis reached its declared 60-second limit. Eleven relevant sources
were outside the selected analysis scope. Semantic coverage is explicitly partial
and truncated; the retained evidence must not be described as a complete call graph.

No runtime autofill, login, bulk company campaign, server-side answer matching or
real application was observed. The package's `cookies` permission does not prove
cookie sharing across employers. Marketplace freshness, publisher authenticity
beyond the installed package descriptor, private service behavior and end-to-end
submission reliability remain unverified. Network-anchored proof per requisition
continues to be this project's own requirement.
