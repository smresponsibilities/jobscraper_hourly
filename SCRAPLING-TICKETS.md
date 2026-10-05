# Scrapling primary with current-engine fallback

Reviewed 2026-10-05 against Jobscraper-next commit `e578cce`, all eight supplied artifacts, and locally installed Scrapling 0.4.15 source. This is an implementation backlog, not a claim that the architecture already works. Tickets are local and ready to copy into an issue tracker. No production behavior changed in this review.

## Goal and ownership

Use Scrapling as the first acquisition engine for job-board requests. Keep today's Node fetch, system curl, and Node Playwright paths as operational fallbacks. TypeScript continues to own ATS endpoint construction, pagination, job normalization, classification, enrichment decisions, scheduling, catalogue state, and notifications. Python owns acquisition and only the browser operations that cannot be expressed as ordinary HTTP requests.

For JSON and server HTML, use Scrapling's static `Fetcher` first. For configured rendered sites, use Scrapling's browser fetcher first. Do not run a browser for every API request. Keep current ATS identities and `RawJob` contracts. A fallback selects a different acquisition engine for the same operation, not a second classification or catalogue pipeline.

Final coverage includes listing, detail/enrichment requests, and board validation/discovery requests that acquire careers content. Email, GitHub publication, contacts, SMTP, npm registry requests, and other unrelated network traffic are outside this migration. An adapter-by-adapter inventory must make any temporary exceptions explicit.

Suggested request path:

```text
Existing ATS adapter constructs request
  Shared acquisition policy chooses static or rendered Scrapling
    Successful response passes HTTP/body/schema checks
      Existing ATS parser returns existing RawJob shape
    Eligible acquisition failure
      Current engine attempts same operation within remaining budget
        Success feeds same parser
        Failure produces one final board failure with both causes retained
  Existing filtering, state, outage, catalogue, and notification pipeline
```

Prefer extending the existing helpers and responsible browser adapter. Do not copy 32 ATS parsers into Python, introduce a second scheduler, or replace state with Scrapling spider checkpoints.

## Findings that change the supplied plans

| Evidence | Consequence |
| --- | --- |
| `src/fetchers/scrapling.ts` spawns `python` once per request and has no `error` listener, parent deadline, cancellation, or output bound. | Missing interpreter can escape promise handling; hanging children and large responses need explicit limits and cleanup. |
| `scrapling_worker.py` POST branch calls `playwright.sync_api` directly. | Darwinbox currently does not use Scrapling's static TLS impersonation. Calling it a completed Scrapling POST migration is inaccurate. |
| GET branch ignores supplied headers and prints `page.text`. Scrapling `parser.py:text` returns element text; `body` returns raw content. | JSON and HTML acquisition need the correct body representation, header forwarding, and encoding tests. |
| Worker returns only body text, without status, headers, final URL, or engine identity. | HTTP 403/429, redirects, retry guidance, and challenge classification lose evidence. |
| Darwinbox calls only `scraplingJson`; `curlJson` remains in `util.ts`. | The requested fallback is absent. Restore curl as the retained secondary path. |
| `util.ts:curlJson` uses `execFile` with an argument array. | Claims about Bash shell interpolation/injection in this helper are unsupported. Do not delete a working fallback on that premise. |
| Workflows install unpinned `scrapling playwright`. Installed 0.4.15 declares fetcher dependencies under `scrapling[fetchers]`. | A clean runner must verify extras, browser assets, OS dependencies, and exact interpreter compatibility. Local imports are insufficient proof. |
| `src/fetchers/icims.ts` already supports legacy/portal listing and JSON-LD enrichment. HANDOFF contains both newer solved notes and an older open-gap note. | Reuse existing adapter. Audit specific failing tenants before creating coverage tickets. |
| Rendered adapter returns `[]` if Playwright import fails. | Infrastructure absence must not become evidence that a previously populated board is empty. |
| Scrapling selectors require stored examples and explicit adaptive selection/save behavior. | Assigning `StealthyFetcher.adaptive = True` does not prove selectors survive redesigns. Adaptive extraction needs separate data-correctness tests. |
| `index.ts` uses `BlockError` for bounded retention and suspected-outage protection. | Fallback errors must preserve classification and must not cause false board eviction. |
| Actual hunt workflow requests runs every 20 minutes and queues overlapping runs. | Historical runtime statements in artifacts are not release budgets. Measure current scheduling and throughput before promotion. |

The supplied character-level regex artifact is background only. This migration does not justify classification changes. Claims of guaranteed bot bypass, redesign immunity, or 3x–5x speed improvements remain unproven until measured on representative boards.

## Invariants and fallback rules

1. Valid successful empty data is a success. Do not retry it merely because the count is zero. Require an adapter-specific empty-state/schema check; a challenge, login shell, missing browser, or malformed payload is not valid emptiness.
2. Fall back once for unavailable Python/dependencies/browser, worker crash/protocol failure, acquisition timeout with remaining budget, connection failure, or classified challenge/WAF failure. Deterministic programming errors and invalid board configuration propagate without a blind second attempt.
3. A rate limit belongs to the host, not the engine. Honor bounded `Retry-After` and the existing host queue. Do not immediately switch engines to evade a 429. Permit a secondary attempt only after allowed backoff and within the shared operation budget.
4. Authoritative API JSON 4xx indicating a bad tenant remains a configuration failure. An HTML WAF 403 may qualify for fallback. Preserve the existing classifier's distinction.
5. Define retry ownership in one place. Scrapling internal retries, existing `getJson` retries, and routing must not multiply into an uncontrolled attempt tree. Declare maximum network attempts and total deadline per operation, including fallback.
6. Listing/search POST replay is allowed only for endpoints known to be read-only. No generic replay for state-changing POST, SMTP, publication, or writes. Cancellation stops the whole operation and does not start fallback.
7. Keep both engine causes for diagnosis. If neither succeeds and any cause indicates a bot wall, preserve that evidence for bounded hold behavior; an infrastructure failure alone must not imply a dead tenant. Feed outage detection one final result per board.
8. Pagination is complete or explicitly failed. Never publish a truncated prefix as a full successful listing. Cross-engine page continuation is allowed only with equivalent schema, stable pagination, and no session/cursor dependency. Otherwise discard accumulated rows and restart the read-only listing once with the current engine within budget.
9. Keep job IDs, links, location policy, date guards, text limits, and dedup stable. Acquisition changes must not reset seen state or resend old jobs.
10. Global worker/browser bounds supplement existing per-host limits. Both engine attempts remain in the same host accounting scope.
11. Legacy-only rollback works with no Python installation. Optional dependency setup failure must not prevent the existing engine from running; required TypeScript checks must still fail when broken.
12. No state writes, publication, alerts, or board-list mutations in dry-run/shadow comparison. Do not commit challenge bodies, cookies, credentials, or adaptive databases.

## TDD rule for every implementation ticket

Before changing production code, write behavioral tests for the ticket, run them, and retain the expected failing assertion or missing-capability failure. A missing dependency, syntax error, or unrelated failing test is not valid red evidence. Then implement the smallest passing change and refactor with tests green.

Each ticket records test names, fixture origins, red command/output, green command/output, and relevant commit IDs. Existing-code characterization tests may start green; new acceptance tests must demonstrate red before the behavior is introduced. Never write the implementation first and call later-added tests TDD.

Use `src/selftest.ts` for existing pure regressions, Node's installed test facilities/tsx for asynchronous bridge and routing tests, and Python stdlib `unittest` for worker behavior. Add only the test command wiring needed to run these suites. Fixtures use local HTTP servers and fake workers; CI correctness tests must not depend on live ATS availability. Live checks supplement deterministic tests.

## Tickets

### SC-01: Establish coverage inventory and baseline fixtures

Priority P0. No dependencies. Owns inventory and test groundwork.

Problem: artifacts describe older repository behavior, and current integration lacks behavioral proof.

Scope: inventory every job-board network call in `src/fetchers`, `detect.ts`, `probe.ts`, bulk import, and discovery. Record adapter, operation, current engine, helper, headers, body type, timeout, host key, pagination/session needs, and eligibility for migration. Separate unrelated network calls. Capture sanitized fixtures for Darwinbox v1/v2, Workday POST, iCIMS portal/legacy/details, rendered cards, XML feeds, HTTP challenge/429, malformed JSON, and genuine empty results.

Tests first: characterize current stable IDs, required Darwinbox companyId in body/query, Workday paging totals, location/date/text behavior, and existing block classification. Write red tests demonstrating the missing fallback and missing HTTP envelope without changing production code.

Acceptance: checked inventory lists all ATS entries in `FETCHERS`, direct fetch exceptions, enrichment, discovery, and long XML timeouts. Fixtures identify source and collection date without sensitive data. Baseline test commands and measured sample counts are recorded. No unsupported tenant is labeled solved.

Proof: focused characterization suite and existing `npm test`. Deliver inventory alongside this backlog. Next tickets cannot assume uniform JSON-only transport.

### SC-02: Specify and test the Python/TypeScript acquisition contract

Priority P0. Depends on SC-01. Owns `scrapling.ts` and worker boundary.

Scope: one versioned request on stdin and one JSON response envelope on stdout. Request carries URL, method, headers, body representation, engine, and bounded timeout. Response carries success/error discriminator, status when available, selected response headers, final URL, encoding/body representation, engine, and structured failure category. Keep logs on stderr. Validate both directions at runtime; TypeScript generic casts are not validation.

Tests first: malformed/truncated input/output, wrong protocol version, duplicate output, null/array envelope, missing fields, unsupported methods/engines, bad URL scheme, Unicode, multiline body, empty body, quotes/backticks, large payload, non-UTF8 declared encoding, and valid HTML/JSON/XML round trips.

Acceptance: payload leaves argv, stdout contains only the contract, errors are bounded/redacted, and raw body survives unchanged according to declared encoding. Reject invalid request input without network activity. Do not expose arbitrary Python evaluation, script paths, or browser action code over this protocol.

Proof: Python unit tests and TypeScript protocol tests with fake worker processes.

### SC-03: Bound subprocess lifetime and resource use

Priority P0. Depends on SC-02.

Scope: handle spawn errors, exit signals, early stdin close, decoding across buffer chunks, timeout, cancellation, stdout/stderr bounds, and cleanup. Select an explicit Python executable with documented local/CI setup; resolve the worker independently of cwd. Ensure supported emitted/packaged execution includes the Python asset. Start with existing subprocess design; introduce reuse only if SC-10 measurements require it.

Tests first: missing interpreter, import failure, hanging worker, crash before output, overflow, cancellation before/during spawn, late output after timeout, child success racing deadline, cwd change, and concurrent calls. Assert exactly one settlement and no fallback after cancellation. Verify cleanup on Windows and Linux, including browser descendants.

Acceptance: parent deadline bounds a stuck worker regardless of library waits. Timers/listeners are removed. Child count returns to baseline after success/failure. Limits have documented units and representative-response evidence; valid large board/feed responses remain supported.

Proof: asynchronous process tests using fixture workers plus platform CI checks. No live ATS needed.

### SC-04: Implement correct Scrapling static GET/POST acquisition

Priority P0. Depends on SC-02 and SC-03.

Scope: use verified `scrapling.fetchers.Fetcher` APIs for ordinary HTTP acquisition. Preserve headers, raw string/form/JSON body semantics, redirects, status, response headers, timeout units, and correct raw `body`. Remove the direct Playwright API POST branch. Leave adaptive persistence disabled for ordinary transport.

Tests first: local echo server verifies GET headers, read-only POST bytes, JSON content type, form body, Unicode, 200 JSON/HTML/XML, empty body, 302 redirect, 403 HTML versus JSON, 429/503, and malformed content. Spy/fake tests prove POST reaches Scrapling static API and no browser is launched.

Acceptance: Darwinbox request is byte/semantically equivalent to the existing request; response includes actual status. TLS/browser impersonation selection is documented against the pinned release. Do not claim that success against local HTTP proves bot bypass.

Proof: Python unit/local-server integration suite; optional representative live acquisition report.

### SC-05: Add shared Scrapling-first/current-engine fallback policy

Priority P0. Depends on SC-01 through SC-04.

Scope: extend responsible acquisition helpers with one routing policy and retained current-engine primitives. Prevent fallback recursion. Add `scrapling-first` and `legacy-only` modes; staged adapter opt-in is temporary rollout scope, not the final architecture. Use adapter schema validation where transport validity alone is insufficient.

Tests first: primary succeeds and secondary call count is zero; primary fails eligibly and secondary succeeds exactly once; both fail; valid empty does not fall back; invalid tenant does not fall back; body validation rejects challenge/invalid schema; cancellation does not fall back; rate limit honors backoff; exhausted budget does not start secondary; read-only POST replay retains request; write POST replay is rejected.

Acceptance: finite attempt/deadline table documents retry ownership. Current Node/curl behavior remains independently callable. Both causes survive final failure. Legacy-only never imports or spawns Python. Engine-unavailable detection is reused within a run rather than spawning a broken interpreter for every board, with recovery on next run.

Proof: table-driven routing tests with fake clock/transports. Tests assert behavior and attempt counts rather than implementation structure.

### SC-06: Prove Darwinbox listing and fallback end to end

Priority P0. Depends on SC-05.

Scope: wire Darwinbox static Scrapling primary and existing curl secondary. Keep normalization and public job URLs in TypeScript. Validate `data` shape and empty success evidence before iterating. Update comments that currently describe curl as the active sole engine.

Tests first: v1 empty companyId; v2 companyId body/query; multi-page total; empty terminal page; malformed `data`; invalid epoch/string dates; fallback on first page; failure on later page; both engines fail; legitimate zero jobs. Verify no partial listing or duplicate IDs on restart/fallback.

Acceptance: fixtures produce identical `RawJob` results through both engines. Page cap reached with evidence of additional jobs is explicit incompleteness, not silent success. Live check includes a known populated board and a confirmed empty board, with final IDs/counts and engine choice reported.

Proof: fixture integration tests, `npm test`, `npx tsc --noEmit`, bounded read-only live debug if network allows. Live blockage is reported honestly.

### SC-07: Preserve block, outage, retention, and catalogue semantics

Priority P0. Depends on SC-05 and SC-06.

Scope: map acquisition evidence through existing `block.ts` and polling result shape. Integrate one final board outcome into `index.ts`, `outage.ts`, and existing state rules. Distinguish engine infrastructure unavailability from board death without masking genuine authoritative configuration failures.

Tests first: primary challenge then fallback success resets failure state once; both fail with challenge retains bounded block hold; Python missing across many boards does not falsely label an ATS outage when legacy succeeds; fallback 404 plus primary wall retains both causes; genuine invalid tenant follows existing eviction policy; failed/incomplete poll cannot close catalogue rows as absent. Test hold expiry, suspected-outage transitions, and dry-run writes.

Acceptance: existing retention limits remain bounded and documented. Counts use one result per board. No new state namespace replaces `seen.json` or board state. Existing jobs are not re-alerted because engine changed.

Proof: integration tests around poll outcomes/state with fixed time plus existing state/outage regressions. If a small extraction is needed for testing, preserve behavior with characterization tests first.

### SC-08: Roll out static transport across existing adapters and enrichment

Priority P1. Depends on SC-06 and SC-07.

Scope: migrate SC-01 inventory in reviewable groups. Shared JSON helpers first, then custom HTML/XML acquisition and direct fetch callers. Preserve adapter-specific headers, session semantics, 180-second feed timeouts where required, pagination, India searches, and lazy enrichment. Retain each operation's existing engine as secondary.

Tests first: representative fixtures per transport family, all changed endpoint/body variants, Workday pagination and placeholder locations, iCIMS portal/legacy/JSON-LD enrichment, XML encoding, details missing descriptions, and fallback during enrichment. Existing iCIMS legacy-to-portal selection is an ATS variant decision and must remain separate from engine fallback.

Acceptance: every migrated operation has equivalence proof for stable IDs, required fields, and completeness. Generic casts never turn arbitrary JSON into valid listings. Production coding bugs are not swallowed by broad fallback catches. Inventory marks temporary unsupported paths with reason and follow-up.

Proof: grouped adapter fixtures, full regression suite, typecheck. All final job-board acquisition paths covered before declaring dual architecture complete.

### SC-09: Add Scrapling rendered primary with current Playwright fallback

Priority P1. Depends on SC-05 and SC-07; can proceed alongside SC-08.

Scope: retain current site configuration and URL-based extraction semantics. Use Scrapling browser acquisition/automation for configured rendered sites and existing Node Playwright as secondary. Forward required headers/referer intentionally, verify pinned `solve_cloudflare` behavior, and use bounded site readiness rather than unconditional network-idle waits. Return explicit failure when neither browser is available, never synthetic empty success.

Tests first: delayed SPA cards, continuous background requests, pagination, repeated-page termination, no-results marker, challenge/login shell, missing browser, navigation timeout, primary failure then current browser success, DOM containing unrelated links, and cancellation. Assert stable IDs/location rules and complete results.

Acceptance: browser choice is explicit, missing dependency cannot close existing catalogue jobs, and every browser/context closes. Resource blocking is tested against pages needing CSS or scripts; do not blanket-disable resources based on unmeasured speed claims. No arbitrary browser code arrives from board content or stdin.

Proof: deterministic local rendered fixture site on both engines and a bounded representative real-site comparison. Existing unsupported sites stay unsupported until SC-14 proves otherwise.

### SC-10: Enforce worker/browser bounds and measure throughput

Priority P1. Depends on SC-06; final gate also depends on SC-08 and SC-09.

Scope: combine global subprocess/browser limits with current per-host queues. Account for primary, backoff, fallback, and queue wait. Measure spawn overhead before choosing a small worker reuse mechanism; avoid building a pool speculatively. Scope cookie/session reuse to the same tenant where needed.

Tests first: concurrency peaks never exceed declared bounds; same-host requests remain serialized according to current cap; fallback does not acquire a duplicate slot/deadlock; cancellation while queued releases capacity; one browser crash does not affect unrelated boards; session data never crosses tenant boundaries.

Acceptance: record p50/p95 operation latency, process/browser peaks, memory, request/attempt counts, fallback rate, and run duration for comparable samples. Set explicit release budgets from current baseline and scheduler freshness requirements before promotion. No unbounded process-per-page fan-out. Session/cursor handling is verified before cross-engine continuation.

Proof: fixture load test and measured shadow/dry run. Run long sweeps in the available background mechanism, read summarized output once at completion, and avoid polling loops.

### SC-11: Make CI and local setup reproducible and fallback-safe

Priority P0. Depends on SC-03 and SC-04; required before canary.

Scope: pin supported Python and Scrapling release with fetcher extras and resolved dependency constraints. Verify browser and Linux OS dependency setup required by that release. Cover hunt and every affected discover/news/bulk-import job, plus local Windows instructions. Existing Node Playwright fallback assets remain installed independently.

Tests first: clean environment imports static/browser APIs; local static and rendered fixture acquisition works; missing Python/package/browser routes to current engine; optional setup failure still allows a legacy-only hunt; required test failure prevents promotion. Exercise compatibility on selected Python version rather than assuming local Python 3.12 proves workflow Python 3.11.

Acceptance: setup/cache keys include relevant runtime/dependency versions. A broken Scrapling installation degrades to legacy while emitting one actionable diagnostic. This does not turn every workflow step into continue-on-error. Test suites run before promotion, and dry-run remains non-mutating.

Proof: fresh Windows/Linux setup checks and CI logs. Document commands in PowerShell for local users. Avoid unnecessary shell/MCP/AI extras.

### SC-12: Add diagnostics and a shadow comparison report

Priority P1. Depends on SC-07 and SC-10.

Scope: extend existing summaries/host statistics with primary engine, fallback reason, final engine, duration, and final failure class. Keep bounded per-run diagnostics. Add explicit read-only comparison for sampled boards; shadow mode never selects a merged union as production truth.

Tests first: secrets/headers/body text are redacted; a fallback success records one board success plus one engine degradation; both failures retain categorized causes; report compares IDs/required fields/completeness, not counts alone; shadow mode makes no persistent writes or notifications.

Acceptance: distinguish working primary from primary failing on every request and legacy rescuing it. Report unexplained missing jobs, unexpected additions, field differences, challenge/empty confusion, latency, and fallback frequency. Respect host limits when comparing two engines.

Proof: deterministic report fixture and sampled live read-only comparison. Store sanitized reports; do not upload full response bodies as routine artifacts.

### SC-13: Promote in stages and prove rollback

Priority P1. Depends on SC-08 through SC-12.

Scope: Darwinbox canary, representative static adapters, rendered sites, then full inventoried job-board coverage. Keep Scrapling first for each enabled cohort. Staging does not reverse requested priority. Provide one operational legacy-only switch covering listing, enrichment, and discovery.

Tests first: cohort selection, default primary order, rollback without Python/browser Scrapling packages, rollback with unchanged IDs/seen state, previous engine handles subsequent poll, and workflow setup failure degradation. Verify partial failures do not publish partial-success snapshots.

Acceptance: promotion report has explicit measured budgets, unexplained job differences resolved, zero confirmed false-empty closures/duplicate alerts in the compared sample, finite resource use, and a successful forced-primary-failure drill. When thresholds fail, keep the previous cohort and record cause. Do not delete current fallbacks after promotion.

Proof: deterministic rollout tests, `npm test`, `npx tsc --noEmit`, clean CI check, sample comparisons, rollback drill, and review of resulting catalogue/state diffs. Any full sweep uses dry-run/shadow first.

### SC-14: Evaluate adaptive extraction and new coverage separately

Priority P2. Depends on stable SC-09 and SC-12. These are separate follow-ups, not prerequisites for transport migration.

Scope A: choose one rendered site's verified selector, save a known-good adaptive example, and test controlled DOM drift. Define tenant/site/selector-version keys, storage location, cache loss, cleanup, concurrency, confidence limits, and semantic validation. Keep current extraction as fallback. Never let fuzzy relocation silently choose a navigation heading as a job title.

Tests first for A: original fixture saves examples; changed classes/wrapper recover correct card; unrelated similar node rejected; absent/corrupt cache yields explicit degradation; concurrent updates do not corrupt storage; one site's examples cannot contaminate another.

Scope B: investigate specific currently failing Walmart/enterprise/iCIMS tenants with source URLs and dated evidence. Existing iCIMS support is reused. Distinguish network challenge from missing endpoint, unsupported pagination, authentication, or changed careers provider.

Tests first for B: captured real listing/detail fixtures, empty state, all pagination, IDs, location/date mapping, both-engine failure, and failure-to-empty prevention before adding coverage code.

Acceptance: ship adaptive storage only if it demonstrably improves extraction without wrong-job matches. Ship each new tenant only after complete listing and public URL identity are verified. Bot solver availability alone is not proof of coverage. No paid proxy pool, new account, or persistent credential dependency enters this ticket implicitly.

Proof: fixture tests, measured comparison, and bounded live verification for each accepted tenant. Split A/B into individual tracker issues when scheduled.

### SC-15: Close documentation gaps and confirm final coverage

Priority P1. Depends on SC-13; document optional SC-14 outcomes separately.

Scope: update README/architecture/setup and HANDOFF with engine order, fallback table, retry/deadline ownership, troubleshooting, test commands, measured release evidence, and rollback. Correct contradictory iCIMS status and misleading Darwinbox comments. Reference the eight supplied artifacts as historical research, with this review's corrections.

Tests/checks first: coverage checklist compares inventory to migrated callers; documented test/setup commands execute in clean environment; legacy-only check runs without Python. Documentation-only changes do not require artificial red tests, but all referenced behavior must have prior test evidence.

Acceptance: no inventoried job-board request silently bypasses requested primary order, except explicit still-open scope blockers. Marking all tickets done requires test-first evidence and completed listing/enrichment/discovery coverage. Preserve current fallback implementations and state formats.

Proof: final inventory review, linked red/green evidence per implementation ticket, clean setup check, regression/typecheck summary, measured release report, and rollback record.

## Build order and completion gate

SC-01, then SC-02, SC-03, SC-04, SC-05, SC-06, SC-07. SC-11 can start once the bridge/static contract exists and must finish before live rollout. SC-08 and SC-09 follow the routing/state proof. SC-10, SC-12, SC-13, and SC-15 close the migration. SC-14 remains independent product research unless a specific site's acceptance requires it.

Do not close the epic because Darwinbox works once. Complete means Scrapling is first across the agreed job-board inventory; current engines are functioning fallbacks; listing and enrichment preserve data semantics; deterministic tests prove failures/cancellation/empty states; CI can degrade safely; throughput fits measured budgets; rollback succeeds; and each production behavior has red-before-green evidence.

## Deliberately excluded from this goal

Scrapling spiders, checkpoint replacement, Scrapy integration, MCP/LLM extraction, proxy rotation, DNS-over-HTTPS, generic sitemap crawling, and interactive shell adoption are not required for dual-engine acquisition. Existing TypeScript scheduling/state already owns those responsibilities. Add them only through separate evidence-backed tickets. SuccessFactors XML acquisition can use Scrapling transport without becoming a spider migration. Prior failed sitemap experiments are not reopened by package availability.

## Reviewed inputs

The supplied directory was `C:/Users/sm/.gemini/antigravity/brain/a271bd2a-92a6-4faa-aab8-89c766420f6a/`. Reviewed artifacts were `Scrapling_Integration_Plan.md`, `walkthrough.md`, `Scrapling_Deep_Dive.md`, `Line_By_Line_Analysis.md`, `Char_By_Char_Analysis.md`, `Scrapling_Improvements_Mapping.md`, `Scrapling_Isolation_And_Mapping.md`, and `Scrapling_Complete_System_Breakdown.md`.

Repository evidence includes `scrapling.ts`, `scrapling_worker.py`, `util.ts`, `darwinbox.ts`, fetcher registry, `icims.ts`, `rendered.ts`, `index.ts`, existing self-tests, host statistics, workflows, package scripts, and relevant HANDOFF notes. Scrapling evidence came from installed 0.4.15 `fetchers/requests.py`, `fetchers/stealth_chrome.py`, `engines/static.py`, `parser.py`, package dependency metadata, and installer implementation. This review did not prove live bot bypass, current remote upstream behavior, clean CI installation, or full-sweep performance; the corresponding tickets require that evidence.
