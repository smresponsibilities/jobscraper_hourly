import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as http from 'node:http';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { chromium, type Browser } from 'patchright';
import {
  createResilientBrowserContext,
  getResilientContextTier,
  createTier1Context,
  createTier2Context,
  createTier3Context,
} from './resilient-context.js';
import {
  resilientFetch,
  fastApiPreflightCheck,
} from './tiered-fetcher.js';
import {
  findAdaptiveLocator,
  locateBySpatialGeometryTier3,
  type SpatialIntent,
} from './adaptive-relocator.js';
import {
  getResilientSession,
  getSessionTier1,
  getSessionTier2,
  mintLiveSessionTier3,
  markResilientSessionGood,
  markResilientSessionBad,
  loadHostHealth,
} from './session-pool.js';

test('Subsystem A: createResilientBrowserContext succeeds across forceTier: 1, 2, and 3', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  try {
    // 1. Tier 1: Injected context via fingerprint-injector
    const ctx1 = await createResilientBrowserContext(browser, undefined, 1);
    assert.equal(getResilientContextTier(ctx1), 1, 'Expected Tier 1 context tag');
    const page1 = await ctx1.newPage();
    await page1.setContent('<h1>Tier 1 Injected Context</h1>');
    const h1_1 = await page1.textContent('h1');
    assert.equal(h1_1, 'Tier 1 Injected Context');
    await ctx1.close();

    // 2. Tier 2: Deterministic local context with addInitScript client hints & navigator properties
    const ctx2 = await createResilientBrowserContext(browser, undefined, 2);
    assert.equal(getResilientContextTier(ctx2), 2, 'Expected Tier 2 context tag');
    const page2 = await ctx2.newPage();
    await page2.setContent('<h1>Tier 2 Local Context</h1>');
    const navLanguage = await page2.evaluate(() => navigator.language);
    const navLanguages = await page2.evaluate(() => navigator.languages);
    assert.equal(navLanguage, 'en-IN', 'Expected en-IN language in Tier 2');
    assert(navLanguages.includes('en-IN'), 'Expected languages to include en-IN');
    await ctx2.close();

    // 3. Tier 3: Zero-hook clean native context without prototype tampering
    const ctx3 = await createResilientBrowserContext(browser, undefined, 3);
    assert.equal(getResilientContextTier(ctx3), 3, 'Expected Tier 3 context tag');
    const page3 = await ctx3.newPage();
    await page3.setContent('<h1>Tier 3 Native Context</h1>');
    const h1_3 = await page3.textContent('h1');
    assert.equal(h1_3, 'Tier 3 Native Context');
    await ctx3.close();

    // 4. Automatic cascade (default undefined forceTier) succeeds with Tier 1
    const ctxDefault = await createResilientBrowserContext(browser);
    assert.equal(getResilientContextTier(ctxDefault), 1, 'Expected default to choose Tier 1');
    await ctxDefault.close();
  } finally {
    await browser.close();
  }
});

test('Subsystem B: resilientFetch executes Tier 1, 2, 3 and cascades automatically on failure', async () => {
  // Start a lightweight local HTTP test server
  let requestCount = 0;
  let antiBotHit = 0;
  const server = http.createServer((req, res) => {
    requestCount++;
    if (req.url === '/json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'resilient_ok', count: requestCount }));
    } else if (req.url === '/block') {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
    } else if (req.url === '/anti-bot') {
      antiBotHit++;
      if (antiBotHit === 1) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Cloudflare 403 WAF Block');
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ allowed: true, hit: antiBotHit }));
      }
    } else {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Hello Resilient World');
    }
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Tier 1: got-scraping
    const res1 = await resilientFetch(`${baseUrl}/json`, { forceTier: 1 });
    assert.equal(res1.status, 200);
    assert.equal(res1.tier, 1);
    const data1 = await res1.json();
    assert.equal(data1.message, 'resilient_ok');

    // 2. Tier 2: Fetch with synchronized Client-Hints headers
    const res2 = await resilientFetch(`${baseUrl}/json`, { forceTier: 2 });
    assert.equal(res2.status, 200);
    assert.equal(res2.tier, 2);
    const data2 = await res2.json();
    assert.equal(data2.message, 'resilient_ok');

    // 3. Tier 3: curl.exe OS subprocess fallback
    const res3 = await resilientFetch(`${baseUrl}/json`, { forceTier: 3 });
    assert.equal(res3.status, 200);
    assert.equal(res3.tier, 3);
    const data3 = await res3.json();
    assert.equal(data3.message, 'resilient_ok');

    // 4. Tier 3 with Chromium context.request BoringSSL stack
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const context = await browser.newContext();
      const res3Browser = await resilientFetch(`${baseUrl}/json`, { forceTier: 3, context });
      assert.equal(res3Browser.status, 200);
      assert.equal(res3Browser.tier, 3);
      const data3Browser = await res3Browser.json();
      assert.equal(data3Browser.message, 'resilient_ok');
      await context.close();
    } finally {
      await browser.close();
    }

    // 5. Automatic Fallback when earlier tiers fail:
    // If Tier 1 gets a 403 anti-bot block, resilientFetch cascades to Tier 2 (Client-Hints)
    antiBotHit = 0;
    const forced403 = await resilientFetch(`${baseUrl}/anti-bot`, { forceTier: 1 });
    assert.equal(forced403.status, 403);
    assert.equal(forced403.tier, 1);

    // In cascade mode (no forceTier), Tier 1 403 automatically triggers fallback to Tier 2 and succeeds!
    antiBotHit = 0;
    const cascadedFromBlock = await resilientFetch(`${baseUrl}/anti-bot`);
    assert.equal(cascadedFromBlock.status, 200);
    assert.equal(cascadedFromBlock.tier, 2);
    const cascadedJson = await cascadedFromBlock.json();
    assert.equal(cascadedJson.allowed, true);
  } finally {
    server.close();
  }
});

test('Subsystem C: findAdaptiveLocator relocates via Tier 1, Tier 2 (Scrapling similarity), and Tier 3 (2D Spatial Geometry)', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const tempFpDir = path.resolve('out/test-temp/fingerprints');
  fs.mkdirSync(tempFpDir, { recursive: true });
  const testFpPath = path.join(tempFpDir, `triple-fp-${Date.now()}.json`);

  try {
    // === TIER 1: Primary Selector Hit & Auto-Save Fingerprint ===
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <body>
          <form id="apply-form">
            <input type="text" name="name" value="Candidate" />
            <button id="primary-submit-btn" class="legacy-btn-primary" type="submit">Submit Application</button>
          </form>
        </body>
      </html>
    `);

    const primaryLoc = page.locator('#primary-submit-btn');
    const tier1Loc = await findAdaptiveLocator(
      page,
      primaryLoc,
      'triple_test_submit',
      { storagePath: testFpPath, minThreshold: 0.68 }
    );
    assert.equal(await tier1Loc.count(), 1);
    assert.equal(await tier1Loc.textContent(), 'Submit Application');

    // Wait for async fingerprint auto-save to complete
    await new Promise(r => setTimeout(r, 100));
    assert(fs.existsSync(testFpPath), 'Adaptive fingerprint should be auto-saved on hit');

    // === TIER 2: Primary Selector Breaks -> Scrapling DOM Fingerprint Similarity Relocation ===
    // Mutate the DOM: change the id and class completely so #primary-submit-btn misses
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <body>
          <form id="apply-form">
            <input type="text" name="name" value="Candidate" />
            <button id="mutated-dynamic-uuid-9481" class="btn modern-ui-revamp" type="submit">Submit Application</button>
          </form>
        </body>
      </html>
    `);

    // The primary locator now misses (0 elements)
    assert.equal(await page.locator('#primary-submit-btn').count(), 0);

    // findAdaptiveLocator falls back to Tier 2 and finds the button via DOM similarity!
    const tier2Loc = await findAdaptiveLocator(
      page,
      '#primary-submit-btn',
      'triple_test_submit',
      { storagePath: testFpPath, minThreshold: 0.68 }
    );
    assert.equal(await tier2Loc.count(), 1, 'Tier 2 should relocate mutated button');
    assert.equal((await tier2Loc.textContent())?.trim(), 'Submit Application');

    // === TIER 3: No Fingerprint Exists & Primary Selector Breaks -> 2D Euclidean Spatial Geometry Relocation ===
    // Brand new element with NO saved fingerprint at all in storage!
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            form { display: flex; flex-direction: column; width: 400px; }
            .field-row { margin-bottom: 20px; }
            .btn-bottom { margin-top: 50px; padding: 12px; }
          </style>
        </head>
        <body>
          <form id="job-form">
            <div class="field-row">
              <label id="phone-label">Phone Number</label>
              <input id="obfuscated-input-field" type="tel" name="q_991823" />
            </div>
            <div class="field-row">
              <button id="obfuscated-btn-id" class="btn-bottom" type="button">Next Step</button>
            </div>
          </form>
        </body>
      </html>
    `);

    // 3A. Finding button by 2D Spatial Geometry (text + bottom-of-form Y-coordinate)
    const brokenButtonSelector = '#non-existent-button-selector';
    const tier3BtnLoc = await findAdaptiveLocator(
      page,
      brokenButtonSelector,
      'unseen_flow_next',
      { kind: 'button', textPattern: /next/i, storagePath: testFpPath }
    );
    assert.equal(await tier3BtnLoc.count(), 1, 'Tier 3 should relocate Next button via Spatial Geometry');
    assert.equal((await tier3BtnLoc.textContent())?.trim(), 'Next Step');

    // 3B. Finding form input by 2D Euclidean Distance Math.hypot(dx, dy) below question label
    const brokenInputSelector = '#non-existent-input-selector';
    const tier3InputLoc = await findAdaptiveLocator(
      page,
      brokenInputSelector,
      'unseen_phone_input',
      { kind: 'input', labelText: 'Phone Number', storagePath: testFpPath }
    );
    assert.equal(await tier3InputLoc.count(), 1, 'Tier 3 should relocate Phone input via Euclidean distance');
    const inputId = await tier3InputLoc.getAttribute('id');
    assert.equal(inputId, 'obfuscated-input-field');

    // 3C. Direct test of locateBySpatialGeometryTier3
    const directSpatial = await locateBySpatialGeometryTier3(page, {
      kind: 'input',
      labelText: 'Phone Number',
    });
    assert(directSpatial !== null, 'locateBySpatialGeometryTier3 should locate target');
    assert.equal(await directSpatial.getAttribute('id'), 'obfuscated-input-field');

    // 3D. Edge Case: Non-matching buttons MUST NOT be picked by locateBySpatialGeometryTier3
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <body>
          <div style="height: 1000px;">
            <button id="unrelated-cancel-btn" style="margin-top: 800px;">Cancel Application</button>
            <button id="unrelated-terms-btn" style="margin-top: 900px;">Terms of Service</button>
          </div>
        </body>
      </html>
    `);
    const rejectedBtn = await locateBySpatialGeometryTier3(page, {
      kind: 'button',
      textPattern: /submit/i,
    });
    assert.equal(rejectedBtn, null, 'Non-matching buttons must NOT be picked just because they are at bottom of page');

    // 3E. Edge Case: Nested form-group input relocated via 2D Euclidean geometry and inferred intent
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <body>
          <div class="form-group" style="padding: 20px;">
            <label for="applicant-email">Email Address</label>
            <input id="applicant-email" type="email" name="user_email" />
          </div>
        </body>
      </html>
    `);
    const tier3NestedInput = await findAdaptiveLocator(
      page,
      '#broken-input',
      'candidate_email_input',
      { storagePath: testFpPath }
    );
    assert.equal(await tier3NestedInput.count(), 1, 'Inferred input intent must relocate nested email input');
    assert.equal(await tier3NestedInput.getAttribute('id'), 'applicant-email');
  } finally {
    await context.close();
    await browser.close();
  }
});

test('Subsystem D: 3-tier Session & Auth Pool (Crawlee, local state + cooldowns, .env live minting)', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();

  const tempSessionDir = path.resolve('out/test-temp/sessions');
  const tempHealthPath = path.resolve('out/test-temp/portal-review/test-health.json');
  fs.mkdirSync(tempSessionDir, { recursive: true });
  fs.mkdirSync(path.dirname(tempHealthPath), { recursive: true });

  const testUrl = 'https://portal.workday.com/en-us/test/apply';

  try {
    // 1. Tier 1: Crawlee SessionPool
    const t1 = await getSessionTier1(context, testUrl);
    assert(t1 !== null, 'Tier 1 Crawlee session should be returned');
    assert.equal(t1.tier, 1);
    assert(t1.crawleeSession !== undefined);

    // Mark good and bad on Crawlee session
    await markResilientSessionGood(testUrl, t1.crawleeSession, tempHealthPath);
    const health1 = loadHostHealth(tempHealthPath);
    assert.equal(health1['portal.workday.com']?.lastOutcome, 'success');

    // 2. Tier 2: Local storageState and progressive backoff cooldowns
    // Mark rate-limited to trigger backoff
    await markResilientSessionBad(testUrl, t1.crawleeSession, 'rate_limited', tempHealthPath);
    const health2 = loadHostHealth(tempHealthPath);
    assert.equal(health2['portal.workday.com']?.lastOutcome, 'rate_limited');
    assert(health2['portal.workday.com']?.backoffUntil !== undefined);

    // getSessionTier2 should respect backoff cooldown and return null when cooling down
    const t2Cooldown = await getSessionTier2(context, testUrl, tempSessionDir, tempHealthPath);
    assert.equal(t2Cooldown, null, 'Tier 2 should block requests during backoff cooldown');

    // Reset health to allow request
    await markResilientSessionGood(testUrl, t1.crawleeSession, tempHealthPath);

    // 3. Tier 3: Live .env credential session minting
    const t3 = await mintLiveSessionTier3(context, testUrl, {
      baseDir: tempSessionDir,
      credentials: {
        email: 'applicant@example.com',
        password: 'SecurePassword123!',
        sourceKeyEmail: 'TEST_EMAIL',
        sourceKeyPassword: 'TEST_PASS',
      },
    });

    assert.equal(t3.tier, 3);
    assert.equal(t3.loaded, true);
    assert.equal(t3.minted, true);
    assert(fs.existsSync(t3.storageStatePath!), 'Tier 3 should write fresh storageState to disk');

    // Verify Crawlee session pool now recognizes minted cookies even without context
    const t1WithCookies = await getSessionTier1(undefined, testUrl);
    assert(t1WithCookies !== null);
    assert.equal(t1WithCookies.loaded, true, 'Crawlee session pool should report loaded: true when cookies exist');

    // 4. Master Coordinator getResilientSession across all tiers
    const masterRes = await getResilientSession(context, testUrl, {
      baseDir: tempSessionDir,
      stateFilePath: tempHealthPath,
      forceTier: 3,
    });
    assert.equal(masterRes.tier, 3);
    assert(masterRes.loaded);
  } finally {
    await context.close();
    await browser.close();
  }
});
