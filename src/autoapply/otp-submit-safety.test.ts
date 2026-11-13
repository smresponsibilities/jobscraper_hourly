import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'patchright';
import { completeInPageEmailVerificationIfPrompted } from './imap-verifier.js';

test('OTP entry never retries an application submit button', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent('<p>Enter verification code</p><input name="verification_code"><button type="submit" onclick="this.dataset.clicked=1">Submit application</button>');
    const result = await completeInPageEmailVerificationIfPrompted(page, page.mainFrame(), undefined, { imapPoller: async () => ({ found: true, otpCode: '123456' }) });
    assert.equal(result, false);
    assert.equal(await page.locator('input').inputValue(), '123456');
    assert.equal(await page.getByRole('button').getAttribute('data-clicked'), null);
  } finally { await browser.close(); }
});
