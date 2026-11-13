import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'patchright';
import { AutoApplyRunner } from './runner.js';

test('Lever prefill preserves existing values and never invents consent or identity', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const runner = new AutoApplyRunner() as any;
  try {
    await page.route('https://jobs.lever.co/**', route => route.fulfill({ contentType: 'text/html', body: '<input name="name" value="Reviewed Name"><input name="email"><input name="phone"><input name="org"><input name="urls[LinkedIn]"><input type="checkbox" name="consent[store]">' }));
    await page.goto('https://jobs.lever.co/fixture/123');
    runner.profile = { personal: { firstName: 'Fixture', email: 'fixture@example.test' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] };
    await runner.enforceLeverCoreFieldsBeforeSubmit(page);
    assert.equal(await page.locator('input[name="name"]').inputValue(), 'Reviewed Name');
    assert.equal(await page.locator('input[name="email"]').inputValue(), 'fixture@example.test');
    assert.equal(await page.locator('input[name="phone"]').inputValue(), '');
    assert.equal(await page.locator('input[name="org"]').inputValue(), '');
    assert.equal(await page.locator('input[name="urls[LinkedIn]"]').inputValue(), '');
    assert.equal(await page.locator('input[name="consent[store]"]').isChecked(), false);
  } finally { await browser.close(); }
});
