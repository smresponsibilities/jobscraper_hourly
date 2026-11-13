import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { chromium } from 'patchright';
import { parseAndHealServerValidationErrors } from './validation-healer.js';
import { getWorkdayTenantQuirks } from './workday-tenant-registry.js';

test('only a locally verified numeric notice heal records a tenant quirk', async () => {
  const before = process.cwd();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'workday-heal-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    process.chdir(dir);
    const page = await browser.newPage();
    const url = 'https://fixture.wd5.myworkdayjobs.com/Careers/job/123';
    await page.route('https://fixture.wd5.myworkdayjobs.com/**', route => route.fulfill({ contentType: 'text/html', body: '<div class="field"><label>Notice period<input id="notice" value="Immediate (0 days)" oninput="this.parentElement.parentElement.querySelector(\'[data-automation-id=errorMessage]\').remove()"></label><span data-automation-id="errorMessage">Must be a number</span></div>' }));
    await page.goto(url);
    const result = await parseAndHealServerValidationErrors(page, 'workday', [{ url, status: 422, body: {} }]);
    assert.equal(result.healedCount, 1);
    assert.equal(await page.locator('#notice').inputValue(), '0');
    assert.equal(getWorkdayTenantQuirks(url).requiresNumericNoticeDays, true);
  } finally { await browser.close(); process.chdir(before); rmSync(dir, { recursive: true, force: true }); }
});
