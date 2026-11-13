import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'patchright';
import { auditEmptyRequiredFieldsInDom } from './validation-healer.js';
import { healInvalidFieldsAndRetrySubmit } from './runner.js';

test('audit detects required gaps without changing values, consent, or populated widgets', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <label for="empty">Required question</label><input id="empty" required>
      <input id="filled" value="present" required>
      <input id="consent" type="checkbox" required>
      <input id="otp" maxlength="1" required>
      <div class="select__control"><span class="select__single-value">Selected</span><input id="search" required></div>
      <div id="host"></div>
    `);
    await page.evaluate(() => {
      const root = document.querySelector('#host')!.attachShadow({ mode: 'open' });
      root.innerHTML = '<input id="shadow" aria-label="Shadow question" aria-required="true">';
    });
    const missing = await auditEmptyRequiredFieldsInDom(page);
    assert.deepEqual(missing.map(field => field.selector).sort(), ['#consent', '#empty', '#shadow']);
    assert.equal(missing.find(field => field.selector === '#empty')?.label, 'Required question');
    assert.equal(missing.find(field => field.selector === '#shadow')?.label, 'Shadow question');
    assert.equal(await page.locator('#consent').isChecked(), false);
    assert.equal(await page.locator('#empty').inputValue(), '');
    await page.locator('#empty').evaluate(el => el.setAttribute('data-autoapply-ref', 'empty-ref'));
    const attempted = new Set(['empty-ref']);
    assert.equal(await healInvalidFieldsAndRetrySubmit(page.mainFrame(), '', '', attempted), 0);
    assert.equal(attempted.has('empty-ref'), false);
    assert.equal(await page.locator('#consent').isChecked(), false);
    assert.equal(await page.locator('#empty').inputValue(), '');
  } finally {
    await browser.close();
  }
});

test('audit tolerates detached frames', async () => {
  const broken = { evaluate: async () => { throw new Error('detached'); } };
  assert.deepEqual(await auditEmptyRequiredFieldsInDom(broken as never), []);
  await assert.rejects(auditEmptyRequiredFieldsInDom(broken as never, true), /detached/);
});
