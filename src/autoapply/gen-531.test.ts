import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMinimumJerkTrajectory, batchFillStandardTextInputs } from './widgets.js';
import { prefetchAtsQuestionSchema } from './runner.js';
import { chromium } from 'patchright';

test('GEN-531: generateMinimumJerkTrajectory computes smooth polynomial kinematics', () => {
  const trajectory = generateMinimumJerkTrajectory(10, 20, 110, 220, 10);
  assert.equal(trajectory.length, 11);
  assert.deepEqual(trajectory[0], { x: 10, y: 20 });
  assert.deepEqual(trajectory[trajectory.length - 1], { x: 110, y: 220 });

  // Verify intermediate points are between start and finish
  for (const pt of trajectory) {
    assert.ok(pt.x >= 10 && pt.x <= 110);
    assert.ok(pt.y >= 20 && pt.y <= 220);
  }
});

test('GEN-531: prefetchAtsQuestionSchema handles URLs safely without throwing', async () => {
  const ghResult = await prefetchAtsQuestionSchema('https://boards.greenhouse.io/embed/job_app?for=test&token=12345');
  assert.equal(ghResult, null); // Non-existent test slug gracefully returns null
  const nullResult = await prefetchAtsQuestionSchema('');
  assert.equal(nullResult, null);
});

test('GEN-531: batchFillStandardTextInputs fills DOM inputs in < 25ms and excludes protected widgets', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();

  await page.setContent(`
    <html>
      <body>
        <input id="first_name" type="text" value="" />
        <input id="email" type="email" value="" />
        <input id="phone" type="tel" value="" />
        <textarea id="cover_letter"></textarea>
        <!-- Protected elements that MUST be excluded -->
        <input id="protected_combo" role="combobox" value="" />
        <input id="protected_select" class="select__input" value="" />
        <input id="protected_otp" id="security-input-1" maxlength="1" value="" />
      </body>
    </html>
  `);

  const patches = [
    { selector: '#first_name', value: 'Shivam', fieldId: 'first_name' },
    { selector: '#email', value: 'shivam@example.com', fieldId: 'email' },
    { selector: '#phone', value: '+91 9999999999', fieldId: 'phone' },
    { selector: '#cover_letter', value: 'Passionate software engineer', fieldId: 'cover_letter' },
    { selector: '#protected_combo', value: 'should_fail', fieldId: 'combo' },
    { selector: '#protected_select', value: 'should_fail', fieldId: 'select' },
  ];

  const t0 = performance.now();
  const res = await batchFillStandardTextInputs(page, patches);
  const dur = performance.now() - t0;

  assert.ok(dur < 100, `Execution took ${dur.toFixed(1)}ms`);
  assert.ok(res.filledIds.includes('first_name'));
  assert.ok(res.filledIds.includes('email'));
  assert.ok(res.filledIds.includes('phone'));
  assert.ok(res.filledIds.includes('cover_letter'));
  assert.ok(res.failedIds.includes('combo'), 'Role combobox must be excluded');
  assert.ok(res.failedIds.includes('select'), 'Class select__input must be excluded');

  // Verify values persisted on DOM
  const vals = await page.evaluate(() => ({
    fn: (document.querySelector('#first_name') as HTMLInputElement).value,
    em: (document.querySelector('#email') as HTMLInputElement).value,
    ph: (document.querySelector('#phone') as HTMLInputElement).value,
    cl: (document.querySelector('#cover_letter') as HTMLTextAreaElement).value,
    combo: (document.querySelector('#protected_combo') as HTMLInputElement).value,
  }));

  assert.equal(vals.fn, 'Shivam');
  assert.equal(vals.em, 'shivam@example.com');
  assert.equal(vals.ph, '+91 9999999999');
  assert.equal(vals.cl, 'Passionate software engineer');
  assert.equal(vals.combo, '', 'Protected combobox was not overwritten');

  await browser.close();
});
