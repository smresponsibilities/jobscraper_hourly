import { chromium } from 'patchright';
import assert from 'node:assert';
import { waitForReactiveQuiescence } from '../src/autoapply/widgets.js';

async function testReactiveQuiescence() {
  console.log('[TEST-GEN-535] Starting Reactive DOM & Network Quiescence Barrier test...');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 1. Static DOM test: must resolve within ~150ms
    await page.setContent(`
      <html>
        <body>
          <form id="app">
            <input type="text" name="first_name" value="Shivam" />
            <input type="text" name="last_name" value="Mahajan" />
          </form>
        </body>
      </html>
    `);

    const t0 = performance.now();
    const staticRes = await waitForReactiveQuiescence(page, { quietWindowMs: 75, maxWaitMs: 650 });
    const staticDuration = performance.now() - t0;
    console.log(`Static DOM quiescence elapsed: ${staticRes.elapsedMs}ms (wall: ${Math.round(staticDuration)}ms, mutations: ${staticRes.mutationsObserved})`);
    assert(staticDuration < 200, `Static DOM should resolve quickly (< 200ms), got ${staticDuration}ms`);
    console.log('✔ Static DOM resolved in expected timeframe');

    // 2. Dynamic conditional DOM injection: trigger mutation 50ms after attaching quiescence observer
    const [dynamicRes] = await Promise.all([
      waitForReactiveQuiescence(page, { quietWindowMs: 75, maxWaitMs: 650 }),
      (async () => {
        await new Promise((r) => setTimeout(r, 40));
        await page.evaluate(() => {
          const div = document.createElement('div');
          div.id = 'conditional-visa-field';
          div.innerHTML = '<label>Visa Status</label><input type="text" name="visa" value="Citizen" />';
          document.body.appendChild(div);
        });
      })(),
    ]);

    console.log(`Dynamic DOM quiescence elapsed: ${dynamicRes.elapsedMs}ms, mutations: ${dynamicRes.mutationsObserved}`);

    assert(dynamicRes.mutationsObserved >= 1, `Must capture mutations, got ${dynamicRes.mutationsObserved}`);
    assert(dynamicRes.elapsedMs >= 100, `Must wait for conditional injection and quiescence, got ${dynamicRes.elapsedMs}ms`);
    console.log('✔ Dynamic conditional DOM mutations captured properly');

    console.log('[TEST-GEN-535 PASS] All Reactive Quiescence tests passed successfully.');
  } finally {
    await browser.close();
  }
}

testReactiveQuiescence().catch(err => {
  console.error('[TEST-GEN-535 FAIL]', err);
  process.exit(1);
});
