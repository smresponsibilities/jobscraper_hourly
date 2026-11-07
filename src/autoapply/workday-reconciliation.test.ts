import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'patchright';
import { expandWorkdayApplications, findWorkdayApplication, workdayApplicationsEmpty, workdayCandidateHomeUrl } from './workday-reconciliation.js';
import { AutoApplyRunner } from './runner.js';
import { CredentialVault } from './vault.js';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { CandidateExtendedProfile } from './types.js';

test('Candidate Home URL stays on the original Workday tenant and site', () => {
  assert.equal(workdayCandidateHomeUrl('https://example.wd1.myworkdayjobs.com/en-US/Careers/job/India/Engineer_R-123'), 'https://example.wd1.myworkdayjobs.com/en-US/Careers/userHome');
  assert.equal(workdayCandidateHomeUrl('https://example.wd1.myworkdayjobs.com/Careers/job/India/Engineer_R-123'), 'https://example.wd1.myworkdayjobs.com/Careers/userHome');
  assert.equal(workdayCandidateHomeUrl('https://myworkdayjobs.com.attacker.test/en-US/Careers/job/India/R-123'), undefined);
  assert.equal(workdayCandidateHomeUrl('http://example.wd1.myworkdayjobs.com/en-US/Careers/job/India/R-123'), undefined);
});

test('expands a collapsed Workday application section only once', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const home = 'https://example.wd1.myworkdayjobs.com/en-US/Careers/userHome';
  await page.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: `<div id="group"><section id="section" data-automation-id="applicationsSectionHeading"><div role="button" onclick="document.querySelector('#section').insertAdjacentHTML('beforeend','<article>R-123 — Submitted</article>')"><h3>My Applications</h3></div></section></div>` }));
  try {
    await page.goto(home);
    await expandWorkdayApplications(page);
    assert.equal(await findWorkdayApplication(page, home, 'R-123'), true);
    await expandWorkdayApplications(page);
    assert.equal(await page.locator('article').count(), 1);
  } finally { await browser.close(); }
});

test('empty application list requires a visible stable Workday empty state', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const home = 'https://example.wd1.myworkdayjobs.com/en-US/Careers/userHome';
  let html = '';
  await page.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  try {
    html = '<section data-automation-id="applicationsSectionHeading"><div data-automation-id="noApplications">No Applications</div></section>';
    await page.goto(home);
    assert.equal(await workdayApplicationsEmpty(page, home), true);
    html = '<section data-automation-id="applicationsSectionHeading"><div data-automation-id="noApplications" hidden>No Applications</div></section>';
    await page.goto(home);
    assert.equal(await workdayApplicationsEmpty(page, home), false);
    html = '<section data-automation-id="applicationsSectionHeading"><div data-automation-id="noApplications">No Applications</div><div aria-busy="true">Loading</div></section>';
    await page.goto(home);
    assert.equal(await workdayApplicationsEmpty(page, home), false);
  } finally { await browser.close(); }
});

test('Candidate Home requires the exact requisition and a submitted status in one visible row', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const home = 'https://example.wd1.myworkdayjobs.com/en-US/Careers/userHome';
  let html = '';
  await page.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  try {
    for (const [body, expected] of [
      ['<h1>My Applications</h1><article>R-123 — Submitted</article>', true],
      ['<h1>My Applications</h1><article>R-1234 — Submitted</article>', false],
      ['<h1>My Applications</h1><article>R-123 — Not submitted</article>', false],
      ['<h1>My Applications</h1><article>R-123 — Not under review</article>', false],
      ['<h1>My Applications</h1><article hidden>R-123 — Submitted</article>', false],
      ['<h1>My Applications</h1><article>R-123 — Draft</article><article>R-456 — Submitted</article>', false],
      ['<h1>My Applications</h1><div data-automation-id="applicationCard"><article>R-123 — Draft</article><article>R-456 — Submitted</article></div>', false],
      ['<h1>My Applications</h1><article>R-123 <span hidden>Submitted</span></article>', false],
      ['<h1>Job listing</h1><article>R-123 — Submitted</article>', false],
    ] as const) {
      html = body;
      await page.goto(home);
      assert.equal(await findWorkdayApplication(page, home, 'R-123'), expected);
    }
  } finally { await browser.close(); }
});

test('ambiguous Workday click reconciles Candidate Home without another submission', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'workday-reconcile-'));
  const session = path.join(directory, 'session');
  mkdirSync(session);
  const url = 'https://example.wd1.myworkdayjobs.com/en-US/Careers/job/India/Engineer_R-123';
  const requisition = { provider: 'workday', tenant: 'example', jobId: 'R-123', key: 'workday:example:R-123' };
  const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
  writeFileSync(path.join(session, 'checkpoint.json'), JSON.stringify({ applicationUrl: url, currentUrl: url, report: { submissionAttempted: true, submission: { phase: 'clicked', requests: [] }, actions: [], startTime: new Date().toISOString() } }));
  const vault = new CredentialVault(path.join(directory, 'vault'), randomBytes(32));
  vault.ensure('workday:example', profile.personal.email);
  const runner = new AutoApplyRunner();
  let posts = 0;
  try {
    await runner.initBrowser(true);
    const page = (runner as unknown as { page: import('patchright').Page }).page;
    await page.route('**/*', route => {
      if (route.request().method() !== 'GET') posts++;
      const home = route.request().url().endsWith('/userHome');
      return route.fulfill({ status: 200, contentType: 'text/html', body: home ? `<div id="app"></div><script>setTimeout(()=>document.querySelector('#app').innerHTML='<h1>My Applications</h1><article>R-123 — Submitted</article>',500)</script>` : '<h1>Job</h1>' });
    });
    const report = await runner.run({ url, profile, requisition, vault, sessionDir: session, resume: true, submit: true, keepOpen: true, timeoutMs: 1000 });
    assert.equal(report.receipt?.existing, true);
    assert.equal(report.status, 'submitted');
    assert.equal(posts, 0);
  } finally { await runner.close(); }
});

test('Candidate Home reconciliation signs in with the tenant vault before checking', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'workday-reconcile-login-'));
  const session = path.join(directory, 'session'); mkdirSync(session);
  const url = 'https://example.wd1.myworkdayjobs.com/en-US/Careers/job/India/Engineer_R-123';
  const requisition = { provider: 'workday', tenant: 'example', jobId: 'R-123', key: 'workday:example:R-123' };
  const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
  writeFileSync(path.join(session, 'checkpoint.json'), JSON.stringify({ applicationUrl: url, currentUrl: url, report: { submissionAttempted: true, submission: { phase: 'clicked', requests: [] }, actions: [], startTime: new Date().toISOString() } }));
  const vault = new CredentialVault(path.join(directory, 'vault'), randomBytes(32)); vault.ensure('workday:example', profile.personal.email);
  const runner = new AutoApplyRunner();
  let posts = 0;
  try {
    await runner.initBrowser(true);
    const page = (runner as unknown as { page: import('patchright').Page }).page;
    await page.route('**/*', route => {
      if (route.request().method() !== 'GET') posts++;
      const home = route.request().url().endsWith('/userHome');
      const login = `<button data-automation-id="utilityButtonSignIn" onclick="setTimeout(()=>document.querySelector('#login').hidden=false,700)">Sign In</button><div id="login" hidden><input type="email"><input type="password"><button data-automation-id="signInSubmitButton" onclick="sessionStorage.signins=Number(sessionStorage.signins||0)+1;setTimeout(()=>document.body.innerHTML='<h1>My Applications</h1><article>R-123 — Submitted</article>',1500)">Sign In</button></div>`;
      return route.fulfill({ status: 200, contentType: 'text/html', body: home ? login : '<h1>Job</h1>' });
    });
    const report = await runner.run({ url, profile, requisition, vault, sessionDir: session, resume: true, submit: false, keepOpen: true, timeoutMs: 1000 });
    assert.equal(report.receipt?.existing, true);
    assert.equal(await page.evaluate(() => Number(sessionStorage.signins)), 1);
    assert.equal(posts, 0);
  } finally { await runner.close(); }
});
