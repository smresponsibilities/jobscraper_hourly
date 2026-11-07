import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { chromium } from 'patchright';
import {
  computeFingerprintSimilarity,
  captureElementFingerprint,
  saveAdaptiveFingerprint,
  findAdaptiveLocator,
  collectAllInteractiveShadowAware,
  type ElementFingerprint,
} from './adaptive-relocator.js';
import {
  isHostReadyForRequest,
  markHostOutcome,
  interleaveJobsByProvider,
  getHostStorageStatePath,
  saveHostSessionState,
  loadHostSessionState,
} from './session-pool.js';
import { fastApiPreflightCheck } from './tiered-fetcher.js';

test('adaptive relocator calculates similarity and tolerates id and class mutations', () => {
  const saved: ElementFingerprint = {
    key: 'test_submit',
    tag: 'button',
    typeAttr: 'submit',
    roleAttr: 'button',
    text: 'Submit Application',
    ariaLabel: 'Submit your job application',
    automationId: 'old-submit-id',
    classTokens: ['btn', 'btn-primary', 'action-submit'],
    parentTag: 'form',
  };

  // Mutated DOM: id and classes changed completely by ATS UI update
  const candidateMutated: ElementFingerprint = {
    key: 'test_submit',
    tag: 'button',
    typeAttr: 'submit',
    roleAttr: 'button',
    text: 'Submit Application',
    ariaLabel: 'Submit your job application',
    automationId: 'new-random-uuid-9923',
    classTokens: ['c-button', 'c-button--secondary', 'v2-modern-style'],
    parentTag: 'form',
  };

  const similarityMutated = computeFingerprintSimilarity(saved, candidateMutated);
  assert(
    similarityMutated >= 0.68,
    `Expected similarity >= 0.68 for mutated id/class, got ${similarityMutated}`
  );

  // Completely unrelated element (e.g. an input field or cancel button)
  const candidateUnrelated: ElementFingerprint = {
    key: 'test_cancel',
    tag: 'input',
    typeAttr: 'text',
    roleAttr: undefined,
    text: '',
    ariaLabel: 'Search for jobs',
    automationId: 'search-input',
    classTokens: ['input-field'],
    parentTag: 'div',
  };

  const similarityUnrelated = computeFingerprintSimilarity(saved, candidateUnrelated);
  assert(
    similarityUnrelated < 0.68,
    `Expected similarity < 0.68 for unrelated element, got ${similarityUnrelated}`
  );
});

test('findAdaptiveLocator relocates element in live browser when primary selector misses due to UI changes', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ locale: 'en-IN', timezoneId: 'Asia/Calcutta' });
  const page = await context.newPage();

  const tempFpDir = path.resolve('out/test-temp/fingerprints');
  fs.mkdirSync(tempFpDir, { recursive: true });
  const testFpPath = path.join(tempFpDir, `test-fp-${Date.now()}.json`);

  try {
    // 1. Initial DOM with original primary selector
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <body>
          <form id="apply-form">
            <input type="text" name="name" value="Candidate" />
            <button id="submit-btn" class="legacy-btn-primary" type="submit">Submit Application</button>
          </form>
        </body>
      </html>
    `);

    // Capture initial fingerprint
    const initialLoc = page.locator('#submit-btn');
    assert.equal(await initialLoc.count(), 1);
    const fp = await captureElementFingerprint(initialLoc, 'job_submit_button');
    saveAdaptiveFingerprint(fp, testFpPath);

    // 2. ATS UI updates: button ID and classes mutate
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <body>
          <form id="apply-form">
            <input type="text" name="name" value="Candidate" />
            <button id="new-ats-submit-uuid-771" class="modern-ui-btn-action" type="submit">Submit Application</button>
          </form>
        </body>
      </html>
    `);

    // Primary selector now matches 0 elements!
    const primaryLoc = page.locator('#submit-btn');
    assert.equal(await primaryLoc.count(), 0);

    // Adaptive relocator seamlessly finds the button!
    const relocated = await findAdaptiveLocator(page, primaryLoc, 'job_submit_button', 0.68, testFpPath);
    assert.equal(await relocated.count(), 1, 'Adaptive locator should have found 1 matching element');
    const text = await relocated.textContent();
    assert.equal(text?.trim(), 'Submit Application');
  } finally {
    await browser.close();
  }
});

test('interleaveJobsByProvider interleaves jobs Round-Robin across providers', () => {
  const sampleJobs = [
    { jobUrl: 'https://boards.greenhouse.io/corp1/jobs/1', company: 'Corp1' },
    { jobUrl: 'https://boards.greenhouse.io/corp1/jobs/2', company: 'Corp1' },
    { jobUrl: 'https://boards.greenhouse.io/corp1/jobs/3', company: 'Corp1' },
    { jobUrl: 'https://jobs.ashbyhq.com/startupA/1', company: 'StartupA' },
    { jobUrl: 'https://jobs.ashbyhq.com/startupA/2', company: 'StartupA' },
    { jobUrl: 'https://mycompany.myworkdayjobs.com/Careers/job/1', company: 'MyCompany' },
    { jobUrl: 'https://jobs.lever.co/corp2/1', company: 'Corp2' },
    { jobUrl: 'https://jobs.smartrecruiters.com/corp3/1', company: 'Corp3' },
  ];

  const interleaved = interleaveJobsByProvider(sampleJobs);
  assert.equal(interleaved.length, sampleJobs.length);

  // Round 1 order: Greenhouse -> Ashby -> Workday -> Lever -> SmartRecruiters
  assert(interleaved[0]?.jobUrl.includes('greenhouse.io'));
  assert(interleaved[1]?.jobUrl.includes('ashbyhq.com'));
  assert(interleaved[2]?.jobUrl.includes('myworkdayjobs.com'));
  assert(interleaved[3]?.jobUrl.includes('lever.co'));
  assert(interleaved[4]?.jobUrl.includes('smartrecruiters.com'));

  // Round 2 order: Remaining Greenhouse -> Remaining Ashby
  assert(interleaved[5]?.jobUrl.includes('greenhouse.io'));
  assert(interleaved[6]?.jobUrl.includes('ashbyhq.com'));

  // Round 3 order: Last Greenhouse
  assert(interleaved[7]?.jobUrl.includes('greenhouse.io'));
});

test('host health tracks 45s cooldown and rate limit/challenge backoff', () => {
  const tempHealthDir = path.resolve('out/test-temp/health');
  fs.mkdirSync(tempHealthDir, { recursive: true });
  const tempHealthFile = path.join(tempHealthDir, `health-${Date.now()}.json`);

  const urlA = 'https://boards.greenhouse.io/stripe/jobs/101';
  const urlB = 'https://jobs.lever.co/netflix/202';

  // 1. Initial state: host is ready
  assert.equal(isHostReadyForRequest(urlA, 45000, tempHealthFile), true);

  // 2. Mark request: 45s cooldown starts
  markHostOutcome(urlA, 'request', tempHealthFile);
  assert.equal(
    isHostReadyForRequest(urlA, 45000, tempHealthFile),
    false,
    'Host should be in cooldown immediately after request'
  );

  // Different host should still be ready!
  assert.equal(
    isHostReadyForRequest(urlB, 45000, tempHealthFile),
    true,
    'Independent host should not be affected by urlA cooldown'
  );

  // With minGapMs = 0, host ready check passes
  assert.equal(isHostReadyForRequest(urlA, 0, tempHealthFile), true);

  // 3. Rate limit triggers 15-minute backoff
  markHostOutcome(urlA, 'rate_limited', tempHealthFile);
  assert.equal(
    isHostReadyForRequest(urlA, 0, tempHealthFile),
    false,
    'Rate limited host should be backed off even if minGapMs = 0'
  );

  // 4. Success outcome clears backoff
  markHostOutcome(urlA, 'success', tempHealthFile);
  assert.equal(
    isHostReadyForRequest(urlA, 0, tempHealthFile),
    true,
    'Successful outcome clears backoff'
  );

  // 5. Challenge triggers backoff
  markHostOutcome(urlB, 'challenge', tempHealthFile);
  assert.equal(
    isHostReadyForRequest(urlB, 0, tempHealthFile),
    false,
    'Challenge outcome triggers backoff'
  );
});

test('fastApiPreflightCheck evaluates Greenhouse and Lever JSON APIs', async () => {
  // Test 1: Greenhouse 404 (closed job)
  const mock404Fetch: typeof fetch = async () =>
    new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 });

  const ghClosedResult = await fastApiPreflightCheck(
    'https://boards.greenhouse.io/acme/jobs/12345',
    { fetcher: mock404Fetch }
  );
  assert.equal(ghClosedResult.status, 'skipped');
  assert.equal(ghClosedResult.reason, 'job_closed');

  // Test 2: Lever 410 (closed job)
  const mock410Fetch: typeof fetch = async () =>
    new Response(JSON.stringify({ error: 'Gone' }), { status: 410 });

  const leverClosedResult = await fastApiPreflightCheck(
    'https://jobs.lever.co/netflix/59032cf0-9f05-4c07',
    { fetcher: mock410Fetch }
  );
  assert.equal(leverClosedResult.status, 'skipped');
  assert.equal(leverClosedResult.reason, 'job_closed');

  // Test 3: Greenhouse job with 5+ years experience required
  const mockSeniorFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        title: 'Senior Software Engineer',
        content: '<p>Minimum 5+ years of experience in distributed systems.</p>',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  const seniorResult = await fastApiPreflightCheck(
    'https://boards.greenhouse.io/acme/jobs/67890',
    { fetcher: mockSeniorFetch }
  );
  assert.equal(seniorResult.status, 'skipped');
  assert.equal(seniorResult.reason, 'exceeds_max_experience');

  // Test 4: Lever job with 1-2 years experience (eligible)
  const mockJuniorFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        text: 'Software Engineer I',
        descriptionPlain: 'Requirements: 1 to 2 years of software development experience or fresh graduate.',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  const juniorResult = await fastApiPreflightCheck(
    'https://jobs.lever.co/acme/11121314',
    { fetcher: mockJuniorFetch }
  );
  assert.equal(juniorResult.status, 'eligible');
  assert.equal(juniorResult.title, 'Software Engineer I');

  // Test 5: Unsupported provider gracefully falls back to eligible
  const workdayResult = await fastApiPreflightCheck(
    'https://myco.myworkdayjobs.com/Careers/job/R-123'
  );
  assert.equal(workdayResult.status, 'eligible');
});

test('per-tenant storageState persistence and Indian locale/timezone', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    locale: 'en-IN',
    timezoneId: 'Asia/Calcutta',
  });

  const tempSessionsDir = path.resolve('out/test-temp/sessions');
  const testUrl = 'https://tenant.myworkdayjobs.com/en-US/Careers';

  try {
    const page = await context.newPage();
    await page.setContent('<html><body><h1>Workday Candidate Portal</h1></body></html>');

    // Add cookie to context
    await context.addCookies([
      {
        name: 'PLAY_SESSION',
        value: 'authtoken12345',
        domain: 'tenant.myworkdayjobs.com',
        path: '/',
      },
    ]);

    const statePath = await saveHostSessionState(context, testUrl, tempSessionsDir);
    assert(fs.existsSync(statePath), 'Session storageState file should be created');

    const expectedPath = getHostStorageStatePath(testUrl, tempSessionsDir);
    assert.equal(statePath, expectedPath);

    // Create a new fresh context and load cookies
    const newContext = await browser.newContext({
      locale: 'en-IN',
      timezoneId: 'Asia/Calcutta',
    });
    const loaded = await loadHostSessionState(newContext, testUrl, tempSessionsDir);
    assert.equal(loaded, true, 'Cookies should be loaded from saved host state');

    const cookies = await newContext.cookies([testUrl]);
    assert(cookies.some(c => c.name === 'PLAY_SESSION' && c.value === 'authtoken12345'));
    await newContext.close();
  } finally {
    await browser.close();
  }
});

test('adaptive relocator tolerates button-to-link mutation and rejects language/unrelated buttons', () => {
  const savedReview: ElementFingerprint = {
    key: 'flow_review_button',
    tag: 'button',
    roleAttr: 'button',
    text: 'Review Application',
    ariaLabel: 'Review',
    classTokens: ['btn', 'btn-primary'],
    parentTag: 'div',
  };

  // 1. ATS UI redesigned: button changed to an anchor <a role="button"> with brand classes
  const candidateLink: ElementFingerprint = {
    key: 'flow_review_button',
    tag: 'a',
    roleAttr: 'button',
    text: 'Review Application',
    ariaLabel: 'Review',
    classTokens: ['modern-action-link', 'theme-blue'],
    parentTag: 'div',
  };

  const similarityLink = computeFingerprintSimilarity(savedReview, candidateLink);
  assert(
    similarityLink >= 0.68,
    `Expected similarity >= 0.68 for button-to-link mutation, got ${similarityLink}`
  );

  // 2. Language switcher button (e.g. "English" utility button) MUST NOT match
  const candidateLanguageBtn: ElementFingerprint = {
    key: 'language_btn',
    tag: 'button',
    roleAttr: 'button',
    text: 'English',
    automationId: 'utilityMenuButton',
    classTokens: ['css-g7duu3'],
    parentTag: 'div',
  };

  const similarityLang = computeFingerprintSimilarity(savedReview, candidateLanguageBtn);
  assert(
    similarityLang < 0.68,
    `Expected similarity < 0.68 for language button, got ${similarityLang}`
  );
});

test('host health implements progressive exponential backoff (15m -> 30m -> 60m)', () => {
  const tempHealthDir = path.resolve('out/test-temp/health-prog');
  fs.mkdirSync(tempHealthDir, { recursive: true });
  const tempHealthFile = path.join(tempHealthDir, `health-${Date.now()}.json`);
  const hostUrl = 'https://boards.greenhouse.io/corp/1';

  // 1st rate limit: 15 minutes backoff
  const before1 = Date.now();
  markHostOutcome(hostUrl, 'rate_limited', tempHealthFile);
  const health1 = JSON.parse(fs.readFileSync(tempHealthFile, 'utf8'));
  const entry1 = health1['boards.greenhouse.io'];
  assert.equal(entry1.consecutiveFailures, 1);
  assert(entry1.backoffUntil >= before1 + 14 * 60 * 1000);
  assert(entry1.backoffUntil <= before1 + 16 * 60 * 1000);

  // 2nd rate limit: 30 minutes backoff
  const before2 = Date.now();
  markHostOutcome(hostUrl, 'rate_limited', tempHealthFile);
  const health2 = JSON.parse(fs.readFileSync(tempHealthFile, 'utf8'));
  const entry2 = health2['boards.greenhouse.io'];
  assert.equal(entry2.consecutiveFailures, 2);
  assert(entry2.backoffUntil >= before2 + 29 * 60 * 1000);
  assert(entry2.backoffUntil <= before2 + 31 * 60 * 1000);

  // 3rd rate limit: 60 minutes backoff (capped at 60m)
  const before3 = Date.now();
  markHostOutcome(hostUrl, 'rate_limited', tempHealthFile);
  const health3 = JSON.parse(fs.readFileSync(tempHealthFile, 'utf8'));
  const entry3 = health3['boards.greenhouse.io'];
  assert.equal(entry3.consecutiveFailures, 3);
  assert(entry3.backoffUntil >= before3 + 59 * 60 * 1000);
  assert(entry3.backoffUntil <= before3 + 61 * 60 * 1000);
});

test('fastApiPreflightCheck handles embedded Greenhouse URLs and closed status flags', async () => {
  // 1. Embedded Greenhouse URL: ?for=acme&token=998877
  let capturedEndpoint = '';
  const mockFetch: typeof fetch = async (url: any) => {
    capturedEndpoint = String(url);
    return new Response(
      JSON.stringify({
        title: 'Junior Engineer',
        content: '<p>Freshers welcome, 0-1 years.</p>',
        active: true,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const embeddedResult = await fastApiPreflightCheck(
    'https://boards.greenhouse.io/embed/job_app?for=shopify&token=404040',
    { fetcher: mockFetch }
  );
  assert.equal(embeddedResult.status, 'eligible');
  assert(capturedEndpoint.includes('/boards/shopify/jobs/404040'));

  // 2. Greenhouse active: false flag
  const mockInactiveGh: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        title: 'Software Engineer',
        content: '<p>0-2 years</p>',
        active: false,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  const inactiveGhResult = await fastApiPreflightCheck(
    'https://boards.greenhouse.io/acme/jobs/112233',
    { fetcher: mockInactiveGh }
  );
  assert.equal(inactiveGhResult.status, 'skipped');
  assert.equal(inactiveGhResult.reason, 'job_closed');

  // 3. Lever closed state flag
  const mockClosedLever: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        text: 'Software Engineer',
        descriptionPlain: '1-2 years',
        state: 'closed',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  const closedLeverResult = await fastApiPreflightCheck(
    'https://jobs.lever.co/netflix/aabbccdd',
    { fetcher: mockClosedLever }
  );
  assert.equal(closedLeverResult.status, 'skipped');
  assert.equal(closedLeverResult.reason, 'job_closed');
});

test('loadHostSessionState restores localStorage origins', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const tempSessionsDir = path.resolve('out/test-temp/sessions-origins');
  fs.mkdirSync(tempSessionsDir, { recursive: true });
  const testUrl = 'https://app.workday.com/tenant';

  try {
    const filePath = getHostStorageStatePath(testUrl, tempSessionsDir);
    const mockStorageState = {
      cookies: [
        {
          name: 'session_id',
          value: 'sid_xyz_123',
          domain: 'app.workday.com',
          path: '/',
          expires: -1,
        },
      ],
      origins: [
        {
          origin: 'https://app.workday.com',
          localStorage: [
            { name: 'auth_token', value: 'jwt_secret_token_abc' },
          ],
        },
      ],
    };
    fs.writeFileSync(filePath, JSON.stringify(mockStorageState, null, 2), 'utf8');

    const context = await browser.newContext({ locale: 'en-IN', timezoneId: 'Asia/Calcutta' });
    const loaded = await loadHostSessionState(context, testUrl, tempSessionsDir);
    assert.equal(loaded, true);

    const cookies = await context.cookies([testUrl]);
    assert(cookies.some(c => c.name === 'session_id' && c.value === 'sid_xyz_123'));

    await context.close();
  } finally {
    await browser.close();
  }
});

test('collectAllInteractiveShadowAware traverses nested shadow roots for SmartRecruiters buttons', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div id="host1"></div>
      <script>
        const host1 = document.getElementById('host1');
        const root1 = host1.attachShadow({ mode: 'open' });
        root1.innerHTML = '<oc-button id="nested-oc"><button data-test="footer-submit">Submit Application</button></oc-button>';
      </script>
    `);

    const count = await page.evaluate(() => {
      (globalThis as any).__name = (globalThis as any).__name || ((fn: any) => fn);
      const collect = (root: Document | ShadowRoot, sel: string, acc: Element[] = []): Element[] => {
        for (const el of Array.from(root.querySelectorAll(sel))) acc.push(el);
        for (const node of Array.from(root.querySelectorAll('*'))) {
          if ((node as any).shadowRoot) collect((node as any).shadowRoot, sel, acc);
        }
        return acc;
      };
      return collect(document, 'button').length;
    });

    assert.equal(count, 1);
    await page.close();
  } finally {
    await browser.close();
  }
});

