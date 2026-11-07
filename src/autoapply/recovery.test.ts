import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'patchright';
import { CredentialVault } from './vault.js';
import { AutoApplyRunner } from './runner.js';
import { verificationFromMail, type ApplicationMail } from './mailbox.js';
import type { CandidateExtendedProfile } from './types.js';

test('recovery preserves old credential until confirmation and durably limits reset requests', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'recovery-vault-'));
  const key = randomBytes(32);
  try {
    let vault = new CredentialVault(directory, key);
    const original = vault.ensure('workday:fixture', 'fixture@example.test').credential;
    const pending = vault.requestRecovery('workday:fixture', original.email)!;
    assert.notEqual(pending.password, original.password);
    assert.deepEqual(vault.get('workday:fixture'), original);
    vault = new CredentialVault(directory, key);
    assert.equal(vault.requestRecovery('workday:fixture', original.email)?.recovery?.attempts, 2);
    assert.equal(vault.requestRecovery('workday:fixture', original.email), undefined);
    vault.confirmRecovery('workday:fixture');
    assert.equal(vault.get('workday:fixture')?.password, pending.password);
    assert.equal(vault.recovery('workday:fixture')?.recovery?.confirmed, true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('reset mail cannot become application OTP and must use the same tenant', () => {
  const mail: ApplicationMail = { id: 'synthetic-reset', from: ['noreply@myworkday.com'], to: ['fixture@example.test'], authenticated: true, receivedAt: new Date().toISOString(), subject: 'Fixture password reset', text: 'Reset your Fixture password https://fixture.myworkdayjobs.com/reset-password?token=synthetic' };
  const request = { provider: 'workday', recipient: 'fixture@example.test', since: new Date(Date.now() - 1000), company: 'Fixture', applicationUrl: 'https://fixture.myworkdayjobs.com/application' };
  assert.equal(verificationFromMail(mail, request), undefined);
  assert(verificationFromMail(mail, { ...request, purpose: 'password_reset' })?.activationUrl);
  assert.equal(verificationFromMail({ ...mail, text: mail.text.replace('fixture.myworkdayjobs.com', 'other.myworkdayjobs.com') }, { ...request, purpose: 'password_reset' }), undefined);
});

test('signup activation mail arriving after parking resumes automatically', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'activation-park-'));
  const runner = new AutoApplyRunner();
  const vault = new CredentialVault(directory, randomBytes(32));
  let mailAvailable = false; let activations = 0;
  const url = 'https://fixture.myworkdayjobs.com/application';
  const mailbox = { close: async () => {}, messagesSince: async () => mailAvailable ? [{ id: 'activation-late', from: ['noreply@myworkday.com'], to: ['fixture@example.test'], authenticated: true, receivedAt: new Date().toISOString(), subject: 'Verify Fixture email', text: 'Activate Fixture account https://fixture.myworkdayjobs.com/activate?token=synthetic' }] : [] };
  try {
    await runner.initBrowser(true);
    const page = (runner as unknown as { page: Page }).page;
    await page.context().route('https://fixture.myworkdayjobs.com/**', route => {
      if (route.request().url().includes('/activate')) activations++;
      return route.fulfill({ contentType: 'text/html', body: activations ? '<form><label>Email<input type=email required></label><button>Submit application</button></form>' : '<h1>Verify your email</h1><p>Check your email for the verification link.</p>' });
    });
    const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
    const options = { url, profile, vault, mailbox, headless: false, preserveReviewedValues: true, company: 'Fixture', timeoutMs: 200, requisition: { provider: 'workday', tenant: 'fixture', jobId: '1', key: 'workday:fixture:1' } };
    const parked = await runner.run(options);
    assert.equal(parked.reviewKind, 'authentication');
    assert.equal(parked.humanInterventionRequired, true);
    assert.equal(parked.automaticVerificationPending, true);
    mailAvailable = true;
    assert.equal(await runner.reviewReady(parked, options), true);
    const resumed = await runner.run({ ...options, resume: true });
    assert.match(resumed.reason!, /Ready for submission review/); assert.equal(activations, 1);
  } finally { await runner.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('existing tenant account parks for delayed reset mail then resumes sign-in without manual intervention', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'recovery-browser-'));
  const vault = new CredentialVault(directory, randomBytes(32));
  const original = vault.ensure('workday:fixture', 'fixture@example.test').credential;
  const runner = new AutoApplyRunner();
  let resetRequests = 0;
  let resetPassword = '';
  let signedIn = false;
  let mailAvailable = false;
  const mailbox = { close: async () => {}, messagesSince: async () => mailAvailable ? [{ id: 'reset-email', from: ['noreply@myworkday.com'], to: ['fixture@example.test'], authenticated: true, receivedAt: new Date().toISOString(), subject: 'Fixture password reset', text: 'Reset your Fixture password https://fixture.myworkdayjobs.com/reset-password?token=synthetic' }] : [] };
  try {
    await runner.initBrowser(true);
    const page = (runner as unknown as { page: Page }).page;
    await page.context().route('https://fixture.myworkdayjobs.com/**', async route => {
      const request = route.request(); const url = new URL(request.url());
      let html = '';
      if (url.pathname === '/request-reset') { resetRequests++; await route.fulfill({ body: 'sent' }); return; }
      if (url.pathname === '/complete-reset') {
        const values = JSON.parse(request.postData()!); assert.equal(values[0], values[1]);
        resetPassword = values[0]; assert.equal(resetPassword.length, 16); assert(!/(.)\1/.test(resetPassword));
        await route.fulfill({ body: 'changed' }); return;
      }
      if (url.pathname === '/sign-in') { assert.equal(request.postData(), resetPassword); signedIn = true; await route.fulfill({ body: 'signed in' }); return; }
      if (url.pathname === '/forgot-password') html = `<h1>Forgot password</h1><input type=email><button onclick="fetch('/request-reset',{method:'POST'}).then(()=>location='/check-email')">Send reset link</button>`;
      else if (url.pathname === '/check-email') html = '<h1>Check your email</h1><p>We sent a password reset link.</p>';
      else if (url.pathname === '/reset-password') html = `<h1>Reset password</h1><input type=password><input type=password><button onclick="fetch('/complete-reset',{method:'POST',body:JSON.stringify(Array.from(document.querySelectorAll('input')).map(e=>e.value))}).then(()=>location='/reset-done')">Reset password</button>`;
      else if (url.pathname === '/reset-done') html = '<h1>Your password has been successfully reset.</h1>';
      else if (signedIn) html = '<h1>Application</h1><form><label>Email<input type=email required></label><button>Submit application</button></form>';
      else if (resetPassword) html = `<h1>Sign In</h1><input type=email><input type=password><button onclick="fetch('/sign-in',{method:'POST',body:document.querySelector('[type=password]').value}).then(()=>location='/application')">Sign In</button>`;
      else html = '<h1>Create Account</h1><p role=alert>Account already exists</p><input type=email><input type=password><input type=password><a href=/forgot-password>Forgot password?</a>';
      await route.fulfill({ contentType: 'text/html', body: html });
    });
    const profile = { personal: { firstName: 'Synthetic', email: original.email, country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
    const options = { url: 'https://fixture.myworkdayjobs.com/application', profile, headless: false, vault, mailbox, company: 'Fixture', requisition: { provider: 'workday', tenant: 'fixture', jobId: '1', key: 'workday:fixture:1' } };
    const parked = await runner.run(options);
    assert.equal(parked.reviewKind, 'authentication', parked.reason);
    assert.equal(resetRequests, 1);
    assert.equal(vault.get('workday:fixture')?.password, original.password);
    mailAvailable = true;
    assert.equal(await runner.reviewReady(parked, options), true);
    const resumed = await runner.run({ ...options, resume: true });
    assert.equal(signedIn, true, resumed.reason);
    assert.equal(resetRequests, 1);
    assert.equal(vault.get('workday:fixture')?.password, resetPassword);
    assert.match(resumed.reason!, /Ready for submission review/);
  } finally { await runner.close(); rmSync(directory, { recursive: true, force: true }); }
});
