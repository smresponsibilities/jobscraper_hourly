import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'patchright';
import { CredentialVault } from './vault.js';
import { authenticateApplication } from './authentication.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { AutoApplyRunner } from './runner.js';
import type { CandidateExtendedProfile } from './types.js';

test('unchanged account creation form receives only one credential submission per run', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'auth-once-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const submittedCredentials = new Set<'signup' | 'signin'>();
  const since = new Date();
  const options = { vault: new CredentialVault(directory, randomBytes(32)), tenant: 'workday:fixture', email: 'fixture@example.test', since, submittedCredentials, beforeCredentialSubmit: async () => {}, verification: { provider: 'workday', recipient: 'fixture@example.test', since, applicationUrl: 'https://fixture.myworkdayjobs.com' } };
  try {
    await page.setContent('<h1>Create Account</h1><input type=email><input type=password><input type=password><button onclick="this.dataset.clicks=String(Number(this.dataset.clicks||0)+1)">Create Account</button>');
    assert.equal(await authenticateApplication(page, options), 'progress');
    assert.equal(await authenticateApplication(page, options), 'review');
    assert.equal(await page.getByRole('button').getAttribute('data-clicks'), '1');
  } finally { await browser.close(); }
});

test('account creation does not click if its durable attempt record fails', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'auth-record-failure-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const since = new Date();
  const options = { vault: new CredentialVault(directory, randomBytes(32)), tenant: 'workday:fixture', email: 'fixture@example.test', since, submittedCredentials: new Set<'signup' | 'signin'>(), beforeCredentialSubmit: async () => { throw new Error('Fixture checkpoint failure'); }, verification: { provider: 'workday', recipient: 'fixture@example.test', since, applicationUrl: 'https://fixture.myworkdayjobs.com' } };
  try {
    await page.setContent('<h1>Create Account</h1><input type=email><input type=password><input type=password><button onclick="this.dataset.clicked=1">Create Account</button>');
    await assert.rejects(authenticateApplication(page, options), /Fixture checkpoint failure/);
    assert.equal(await page.getByRole('button').getAttribute('data-clicked'), null);
  } finally { await browser.close(); }
});

test('account creation attempt remains blocked after checkpoint restart', { timeout: 90000 }, async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'auth-restart-'));
  let posts = 0;
  const server = createServer((request, response) => {
    if (request.method === 'POST') { posts++; response.end('ok'); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end('<h1>Create Account</h1><input type=email><input type=password><input type=password><button onclick="fetch(\'/account\',{method:\'POST\'})">Create Account</button>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/login`;
  const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
  const vault = new CredentialVault(path.join(directory, 'vault'), randomBytes(32));
  const options = { url, profile, vault, sessionDir: directory, requisition: { provider: 'workday', tenant: 'fixture', jobId: '1', key: 'workday:fixture:1' }, submit: false, headless: true, timeoutMs: 500 };
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const runner = new AutoApplyRunner();
      try { await runner.run({ ...options, resume: attempt > 0 }); } finally { await runner.close(); }
    }
    assert.equal(posts, 1);
    const checkpoint = JSON.parse(readFileSync(path.join(directory, 'checkpoint.json'), 'utf8'));
    assert.deepEqual(checkpoint.report.credentialAttempts, ['signup']);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('unverified-account sign-in resends once and activates delayed mail without repeated sign-in', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'unverified-account-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  let activated = false;
  let mailReady = false;
  await context.route('https://fixture.myworkdayjobs.com/**', route => {
    if (route.request().url().includes('/activate')) activated = true;
    return route.fulfill({ contentType: 'text/html', body: activated ? '<h1>Application form</h1><input type=email>' : '<h1>Sign In</h1><p>Verify your account before you sign in or request a verification email.</p><input type=email><input type=password><button onclick="document.documentElement.dataset.resends=String(Number(document.documentElement.dataset.resends||0)+1);document.querySelector(\'p\').textContent=\'An email has been sent to you.\'">Resend Account Verification</button><button onclick="throw Error(\'Sign in must not be clicked\')">Sign In</button>' });
  });
  const page = await context.newPage();
  const since = new Date(Date.now() - 1000);
  const mailbox = { close: async () => {}, messagesSince: async () => mailReady ? [{ id: '<verify@myworkday.com>', from: ['noreply@myworkday.com'], to: ['fixture@example.test'], authenticated: true, receivedAt: new Date().toISOString(), subject: 'Verify your Fixture email', text: 'Activate your Fixture account https://fixture.myworkdayjobs.com/activate?token=synthetic' }] : [] };
  const options = { vault: new CredentialVault(directory, randomBytes(32)), tenant: 'workday:fixture', email: 'fixture@example.test', mailbox, since, verification: { provider: 'workday', recipient: 'fixture@example.test', applicationUrl: 'https://fixture.myworkdayjobs.com/application', since } };
  try {
    await page.goto(options.verification.applicationUrl);
    assert.equal(await authenticateApplication(page, options), 'review');
    assert.equal(await authenticateApplication(page, options), 'review');
    assert.equal(await page.locator('html').getAttribute('data-resends'), '1');
    mailReady = true;
    assert.equal(await authenticateApplication(page, options), 'progress');
    assert.equal(activated, true);
    assert.equal(await page.getByRole('heading').innerText(), 'Application form');
  } finally { await browser.close(); }
});

test('authentication waits for a delayed tenant sign-in form instead of parking its loading shell', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'auth-shell-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const vault = new CredentialVault(directory, randomBytes(32));
  vault.ensure('workday:fixture', 'fixture@example.test');
  try {
    await page.setContent('<h1>Career Page</h1><div id=root></div><script>setTimeout(()=>{document.querySelector("#root").innerHTML=`<input type=email><input type=password><button onclick="this.dataset.clicked=1">Sign In</button>`},500)</script>');
    const since = new Date();
    assert.equal(await authenticateApplication(page, { vault, tenant: 'workday:fixture', email: 'fixture@example.test', since, verification: { provider: 'workday', recipient: 'fixture@example.test', since, applicationUrl: 'https://fixture.myworkdayjobs.com' } }), 'progress');
    assert.equal(await page.getByRole('button').getAttribute('data-clicked'), '1');
  } finally { await browser.close(); }
});

test('owner-authorized account consent checks agreement and marketing acknowledgements', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'privacy-auth-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const options = { vault: new CredentialVault(directory, randomBytes(32)), tenant: 'workday:privacy-fixture', email: 'fixture@example.test', since: new Date(), submittedCredentials: new Set<'signup' | 'signin'>(), beforeCredentialSubmit: async () => {}, verification: { provider: 'workday', recipient: 'fixture@example.test', since: new Date(), applicationUrl: 'https://fixture.myworkdayjobs.com' } };
  try {
    await page.setContent('<h1>Create Account</h1><input type=email><input type=password><input type=password><label><input id=privacy type=checkbox required>I agree to the Privacy Information Notice.</label><label><input id=marketing type=checkbox>I consent to receive marketing.</label><label><input id=decline type=checkbox>I do not agree.</label><button onclick="this.dataset.clicked=1">Create Account</button>');
    assert.equal(await authenticateApplication(page, options), 'progress');
    assert.equal(await page.locator('#privacy').isChecked(), true);
    assert.equal(await page.locator('#marketing').isChecked(), true);
    assert.equal(await page.locator('#decline').isChecked(), false);
    assert.equal(await page.getByRole('button').getAttribute('data-clicked'), '1');
  } finally { await browser.close(); }
});

test('concurrent workers publish one tenant credential without overwriting winner', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'vault-race-'));
  const key = randomBytes(32).toString('base64');
  const source = `import {CredentialVault} from './src/autoapply/vault.ts';import {createHash} from 'node:crypto';const v=new CredentialVault(process.argv[1]);const r=v.ensure('workday:fixture','fixture@example.test');console.log(JSON.stringify({created:r.created,hash:createHash('sha256').update(r.credential.password).digest('hex')}));`;
  try {
    const results = await Promise.all(Array.from({ length: 3 }, () => promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source, directory], { env: { ...process.env, AUTOAPPLY_VAULT_KEY: key }, windowsHide: true, timeout: 20000 })));
    const values = results.map(result => JSON.parse(result.stdout.trim()));
    assert.equal(new Set(values.map(value => value.hash)).size, 1);
    assert.equal(values.filter(value => value.created).length, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('Windows DPAPI master key survives reopening without plaintext key material', { skip: process.platform !== 'win32' || !!process.env.AUTOAPPLY_VAULT_KEY }, () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'dpapi-test-'));
  try {
    const first = new CredentialVault(directory).ensure('workday:fixture', 'fixture@example.test');
    assert.deepEqual(new CredentialVault(directory).get('workday:fixture'), first.credential);
    assert(readFileSync(path.join(directory, 'master.dpapi')).length > 32);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('vault encrypts tenant credentials, rejects tampering, wrong key and candidate mismatch', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
  const key = randomBytes(32);
  try {
    const vault = new CredentialVault(directory, key);
    const first = vault.ensure('workday:one', 'fixture@example.test');
    assert(first.created);
    assert.match(first.credential.password, /[A-Z]/);
    assert.match(first.credential.password, /[a-z]/);
    assert.match(first.credential.password, /[0-9]/);
    assert.match(first.credential.password, /[!@#$%]/);
    assert.equal(first.credential.password.length, 16);
    assert(!/(.)\1/.test(first.credential.password));
    for (let index = 0; index < 20; index++) {
      const generated = vault.ensure(`workday:name-${index}`, 'fixture@example.test', ['Aa', 'Shivam', 'Mahajan']).credential.password.toLowerCase();
      assert.equal(generated.length, 16); assert(!/(.)\1/.test(vault.get(`workday:name-${index}`)!.password));
      for (const name of ['aa', 'shivam', 'mahajan', 'fixture']) assert(!generated.includes(name));
    }
    assert.deepEqual(new CredentialVault(directory, key).get('workday:one'), first.credential);
    unlinkSync(path.join(directory, createHash('sha256').update('workday:one').digest('hex') + '.vault'));
    assert.deepEqual(vault.ensure('workday:one', 'fixture@example.test').credential, first.credential);
    assert.notEqual(vault.ensure('workday:two', 'fixture@example.test').credential.password, first.credential.password);
    assert.throws(() => vault.ensure('workday:one', 'other@example.test'), /candidate mismatch/);
    assert.throws(() => new CredentialVault(directory, randomBytes(32)).get('workday:one'));
    const files = readdirSync(directory);
    for (const file of files) assert(!readFileSync(path.join(directory, file), 'utf8').includes(first.credential.password));
    const fileFor = (tenant: string) => path.join(directory, createHash('sha256').update(tenant).digest('hex') + '.vault');
    writeFileSync(fileFor('workday:two'), readFileSync(fileFor('workday:one')));
    assert.throws(() => { vault.get('workday:one'); vault.get('workday:two'); });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('unknown tenant opens signup, saves generated credential and signs in on later visit', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'auth-test-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const vault = new CredentialVault(directory, randomBytes(32));
  const options = { vault, tenant: 'workday:fixture', email: 'fixture@example.test', since: new Date(), verification: { provider: 'workday', recipient: 'fixture@example.test', since: new Date(), applicationUrl: 'https://fixture.myworkdayjobs.com' } };
  try {
    await page.setContent('<h1>Sign In</h1><input type=email><input type=password><button>Sign In</button><button id=create>Create Account</button>');
    await page.addScriptTag({ content: `document.querySelector('#create').onclick=function(){document.body.innerHTML='<h1>Create Account</h1><input type=email><input type=password><input type=password><button id=register>Create Account</button>';document.querySelector('#register').onclick=function(){document.body.dataset.created='true'}}` });
    assert.equal(await authenticateApplication(page, options), 'progress');
    assert.equal(await page.getByRole('heading').innerText(), 'Create Account');
    assert.equal(await authenticateApplication(page, options), 'progress');
    assert.equal(await page.locator('body').getAttribute('data-created'), 'true');
    assert.equal(await page.locator('input[type=password]').first().inputValue(), vault.get(options.tenant)!.password);
    await page.setContent('<h1>Sign In</h1><input type=email><input type=password><button onclick="document.body.dataset.signed=true">Sign In</button>');
    assert.equal(await authenticateApplication(page, options), 'progress');
    assert.equal(await page.locator('body').getAttribute('data-signed'), 'true');
  } finally { await browser.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('authenticated tenant activation link opens in same context then returns to application', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'activation-test-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  let activated = false;
  await context.route('https://fixture.myworkdayjobs.com/**', route => {
    if (route.request().url().includes('/finish-activation')) { activated = true; return route.fulfill({ body: 'verified' }); }
    if (route.request().url().includes('/activate')) return route.fulfill({ contentType: 'text/html', body: '<h1>Verifying your email</h1><script>setTimeout(()=>fetch("/finish-activation").then(()=>document.querySelector("h1").textContent="Account verified"),250)</script>' });
    return route.fulfill({ contentType: 'text/html', body: activated ? '<h1>Application form</h1><input type=email>' : '<h1>Check your email</h1><p>Verify your email using the activation link</p>' });
  });
  const page = await context.newPage();
  const since = new Date(Date.now() - 1000);
  const mailbox = { close: async () => {}, messagesSince: async () => [{ id: '<activation@myworkday.com>', from: ['noreply@myworkday.com'], to: ['fixture@example.test'], authenticated: true, receivedAt: new Date().toISOString(), subject: 'Verify your Fixture email', text: 'Activate your Fixture account https://fixture.myworkdayjobs.com/activate?token=synthetic' }] };
  try {
    await page.goto('https://fixture.myworkdayjobs.com/application');
    const result = await authenticateApplication(page, { vault: new CredentialVault(directory, randomBytes(32)), tenant: 'workday:fixture', email: 'fixture@example.test', mailbox, since, verification: { provider: 'workday', recipient: 'fixture@example.test', applicationUrl: page.url(), since, company: 'Fixture' } });
    assert.equal(result, 'progress');
    assert.equal(activated, true);
    assert.equal(await page.getByRole('heading').innerText(), 'Application form');
    assert.equal(context.pages().length, 1);
  } finally { await browser.close(); rmSync(directory, { recursive: true, force: true }); }
});




test('signup preserves supplied vault password and leaves factual checkboxes unchecked', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'auth-consent-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const vault = new CredentialVault(directory, randomBytes(32));
  const credential = vault.ensure('workday:consent-fixture', 'fixture@example.test').credential;
  const since = new Date();
  const options = { vault, tenant: 'workday:consent-fixture', email: 'fixture@example.test', since, submittedCredentials: new Set<'signup' | 'signin'>(), beforeCredentialSubmit: async () => {}, verification: { provider: 'workday', recipient: 'fixture@example.test', since, applicationUrl: 'https://fixture.myworkdayjobs.com' } };
  try {
    await page.setContent('<h1>Create Account</h1><input type=email><input type=password><input type=password><label><input type=checkbox required>I am a citizen of another country</label><button onclick="this.dataset.clicked=1">Create Account</button>');
    assert.equal(await authenticateApplication(page, options), 'review');
    assert.equal(await page.locator('input[type=password]').first().inputValue(), credential.password);
    assert.equal(await page.locator('input[type=checkbox]').isChecked(), false);
    assert.equal(await page.getByRole('button').getAttribute('data-clicked'), null);
    assert(!readFileSync(path.join(directory, readdirSync(directory).find(name => name.endsWith('.vault'))!), 'utf8').includes(credential.password));
  } finally { await browser.close(); }
});
