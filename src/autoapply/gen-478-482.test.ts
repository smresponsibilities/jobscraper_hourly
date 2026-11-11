// src/autoapply/gen-478-482.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { chromium } from 'patchright';
import {
  authenticateApplication,
  isWorkdayHostVerified,
  markWorkdayHostVerified,
  ensureWorkdayCompliantPassword,
} from './authentication.js';
import {
  consumedOtpCodes,
  recordConsumedOtpCode,
  hasConsumedVerificationToken,
  extractOtpOrLinkFromMime,
  USED_OTP_CODES_FILE,
} from './imap-verifier.js';
import { isHoneypot, isBotTrapOrHoneypot, collectControls } from './distiller.js';
import { CredentialVault } from './vault.js';
import { randomBytes } from 'node:crypto';
import os from 'node:os';

test('GEN-478: Workday failed signin automatically transitions to Create Account instead of returning review', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-wd-transition-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const submittedCredentials = new Set<'signup' | 'signin'>(['signin']); // Sign In was already attempted
  const since = new Date();
  const options = {
    vault: new CredentialVault(directory, randomBytes(32)),
    tenant: 'fidelity.wd1.myworkdayjobs.com',
    email: 'shivam2314.be22@chitkara.edu.in',
    since,
    submittedCredentials,
    verification: {
      provider: 'workday',
      recipient: 'shivam2314.be22@chitkara.edu.in',
      since,
      applicationUrl: 'https://fidelity.wd1.myworkdayjobs.com/FidelityCareers',
    },
  };

  try {
    // Workday sign-in form with createAccountLink visible
    await page.setContent(`
      <h1>Sign In</h1>
      <div data-automation-id="formField-email">
        <input id="input-4" type="email" value="">
      </div>
      <input data-automation-id="password" type="password" value="">
      <button data-automation-id="signInSubmitButton">Sign In</button>
      <button data-automation-id="createAccountLink">Create Account</button>
    `);

    // When createAccountLink is clicked, mount Create Account form
    await page.locator('[data-automation-id="createAccountLink"]').evaluate((el) => {
      el.addEventListener('click', () => {
        document.body.innerHTML = `
          <h1>Create Account</h1>
          <div data-automation-id="formField-email">
            <input id="input-4" type="email" value="">
          </div>
          <input data-automation-id="password" type="password" value="">
          <input data-automation-id="verifyPassword" type="password" value="">
          <input type="checkbox" data-automation-id="createAccountCheckbox">
          <button data-automation-id="createAccountSubmitButton" onclick="document.body.dataset.created = 'true'">Create Account</button>
        `;
      });
    });

    // Even though submittedCredentials already has 'signin', authenticateApplication MUST NOT return 'review'
    // It must click createAccountLink, mount the Create Account form, and execute signup!
    const result = await authenticateApplication(page, options);
    assert.equal(result, 'progress', 'Must return progress and not review on failed signin');
    assert.ok(submittedCredentials.has('signup'), 'Must have executed signup flow and added signup to submittedCredentials');
    assert.equal(await page.locator('body').getAttribute('data-created'), 'true', 'Must have submitted Create Account');
  } finally {
    await browser.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('GEN-480: consumedOtpCodes skips already-consumed OTP codes across jobs', () => {
  const testCode = `OTP_${Date.now()}`;
  assert.equal(consumedOtpCodes.has(testCode), false);

  recordConsumedOtpCode(testCode);
  assert.equal(consumedOtpCodes.has(testCode), true);
  assert.equal(hasConsumedVerificationToken(testCode), true);

  // File persistence check
  assert.ok(fs.existsSync(USED_OTP_CODES_FILE));
  const saved = JSON.parse(fs.readFileSync(USED_OTP_CODES_FILE, 'utf8'));
  assert.ok(Array.isArray(saved));
  assert.ok(saved.includes(testCode));
});

test('GEN-481.2: Ashby _systemfield_ honeypot filtering excludes bot traps while preserving name, email & resume', () => {
  // Helper to create mock elements
  const createMockElement = (attrs: Record<string, string>): Element => {
    return {
      id: attrs.id || '',
      getAttribute: (k: string) => attrs[k] || null,
      closest: () => null,
      classList: { contains: () => false },
      tabIndex: 0,
      tagName: 'INPUT',
      type: attrs.type || 'text',
    } as unknown as Element;
  };

  // Traps starting with _systemfield_ that are NOT name, email, resume
  const companyTrap = createMockElement({ name: '_systemfield_company' });
  const titleTrap = createMockElement({ name: '_systemfield_job_title' });
  const randomTrap = createMockElement({ name: '_systemfield_random_trap' });

  assert.equal(isHoneypot(companyTrap), true, '_systemfield_company must be identified as a honeypot');
  assert.equal(isHoneypot(titleTrap), true, '_systemfield_job_title must be identified as a honeypot');
  assert.equal(isHoneypot(randomTrap), true, '_systemfield_random_trap must be identified as a honeypot');

  // Legitimate whitelisted fields starting with _systemfield_
  const nameField = createMockElement({ name: '_systemfield_name' });
  const emailField = createMockElement({ name: '_systemfield_email', type: 'email' });
  const resumeField = createMockElement({ name: '_systemfield_resume', type: 'file' });

  assert.equal(isHoneypot(nameField), false, '_systemfield_name must NOT be a honeypot');
  assert.equal(isHoneypot(emailField), false, '_systemfield_email must NOT be a honeypot');
  assert.equal(isHoneypot(resumeField), false, '_systemfield_resume must NOT be a honeypot');

  // Verify backward compatible isBotTrapOrHoneypot alias
  assert.equal(isBotTrapOrHoneypot(companyTrap), true);
  assert.equal(isBotTrapOrHoneypot(nameField), false);
});

test('GEN-479.1: Drain scripts default submit to true unless --dry-run or --no-submit is present', () => {
  const originalArgv = [...process.argv];
  try {
    // Default mode: no flags
    process.argv = ['node', 'scripts/drain-backfill-and-hourly.ts'];
    const defaultSubmit = !process.argv.includes('--dry-run') && !process.argv.includes('--no-submit');
    assert.equal(defaultSubmit, true, 'Default submit must be true');

    // Dry-run mode
    process.argv = ['node', 'scripts/drain-backfill-and-hourly.ts', '--dry-run'];
    const dryRunSubmit = !process.argv.includes('--dry-run') && !process.argv.includes('--no-submit');
    assert.equal(dryRunSubmit, false, 'Dry-run must disable submit');

    // No-submit mode
    process.argv = ['node', 'scripts/drain-backfill-and-hourly.ts', '--no-submit'];
    const noSubmit = !process.argv.includes('--dry-run') && !process.argv.includes('--no-submit');
    assert.equal(noSubmit, false, 'No-submit must disable submit');
  } finally {
    process.argv = originalArgv;
  }
});

test('GEN-478.2: makeGmailTenantAlias generates correct tenant slug from both URLs and plain hostnames', async () => {
  const { makeGmailTenantAlias } = await import('./imap-verifier.js');
  const base = 'shivam2314.be22@chitkara.edu.in';

  // With full URL
  const aliasUrl = makeGmailTenantAlias(base, 'https://fidelity.wd1.myworkdayjobs.com/FidelityCareers');
  assert.equal(aliasUrl, 'shivam2314.be22+wd_fidelity@chitkara.edu.in');

  // With plain hostname (without https://)
  const aliasHost = makeGmailTenantAlias(base, 'fidelity.wd1.myworkdayjobs.com');
  assert.equal(aliasHost, 'shivam2314.be22+wd_fidelity@chitkara.edu.in');

  // Dyson tenant
  const aliasDyson = makeGmailTenantAlias(base, 'https://dyson.wd3.myworkdayjobs.com/DysonCareers');
  assert.equal(aliasDyson, 'shivam2314.be22+wd_dyson@chitkara.edu.in');
});

test('GEN-481.2: isHoneypot detects _systemfield_ honeypots on id and data-field-path as well as name', () => {
  const createMockElement = (attrs: Record<string, string>): Element => {
    return {
      id: attrs.id || '',
      getAttribute: (k: string) => attrs[k] || null,
      closest: () => null,
      classList: { contains: () => false },
      tabIndex: 0,
      tagName: 'INPUT',
      type: attrs.type || 'text',
    } as unknown as Element;
  };

  const idTrap = createMockElement({ id: '_systemfield_company_id' });
  const pathTrap = createMockElement({ 'data-field-path': '_systemfield_phone_trap' });

  assert.equal(isHoneypot(idTrap), true, 'id starting with _systemfield_ trap must be honeypot');
  assert.equal(isHoneypot(pathTrap), true, 'data-field-path starting with _systemfield_ trap must be honeypot');
});

