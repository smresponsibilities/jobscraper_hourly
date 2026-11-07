import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import { AutoApplyRunner } from './runner.js';
import { identifyApplicationAts } from './wizard.js';
import type { CandidateExtendedProfile } from './types.js';

// These reproduce portal DOM patterns; they are not live-platform certifications.
const profile = {
  personal: { firstName: 'Synthetic', lastName: 'Candidate', email: 'fixture@example.test', phone: '123', country: 'India' },
  education: [], experience: [], professional: {}, workAuthorization: {}, eeo: {},
} as unknown as CandidateExtendedProfile;

async function localPage(html: string, run: (url: string) => Promise<void>) {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(html);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  try { await run(`http://127.0.0.1:${address.port}/`); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}

async function extensionFill(page: Page, candidate: unknown = profile) {
  await page.addScriptTag({ content: `window.chrome={runtime:{onMessage:{addListener(listener){window.fixtureListener=listener}}}};` });
  await page.addScriptTag({ path: 'extension/content/content.js' });
  return page.evaluate(candidate => new Promise<{ count: number; errors: unknown[] }>(resolve => {
    (window as unknown as { fixtureListener: Function }).fixtureListener({ type: 'AUTOFILL_FORM', profile: candidate }, {}, resolve);
  }), candidate);
}

const countryCombo = `
  <div role="listbox" id="unrelated"><div role="option" onclick="document.body.dataset.wrong='yes'">India</div></div>
  <button role="combobox" aria-label="Country" aria-controls="country-options" aria-required="true"
    onclick="document.getElementById('country-options').hidden=false">Choose country</button>
  <div role="listbox" id="country-options" hidden>
    <div role="option" onclick="document.body.dataset.country='Not India'">Not India</div>
    <div role="option" onclick="document.body.dataset.country='India';document.querySelector('[role=combobox]').textContent='India';this.parentElement.hidden=true">India</div>
  </div>`;

test('dynamic dropdown inputs cannot shift subsequent field targets', async () => {
  await localPage(`<form><label>Country<button id="country" type="button" role="combobox" aria-label="Country" aria-controls="countries" onclick="document.querySelector('#countries').hidden=false;const dummy=document.createElement('input');dummy.id='widget-search';this.before(dummy)">Choose country</button></label><div id="countries" role="listbox" hidden><div role="option" onclick="document.querySelector('#country').textContent='India';this.parentElement.hidden=true">India</div></div><label>Email<input id="email" type="email" required></label><label>First name<input id="first_name" required></label><button>Submit application</button></form>`, async url => {
    const runner = new AutoApplyRunner();
    try {
      await runner.initBrowser(true);
      const report = await runner.run({ url, profile, headless: false });
      const page = (runner as unknown as { page: Page }).page;
      assert.equal(await page.locator('#widget-search').inputValue(), '');
      assert.equal(await page.locator('#email').inputValue(), profile.personal.email);
      assert.equal(await page.locator('#first_name').inputValue(), profile.personal.firstName);
      assert.match(report.reason!, /Ready for submission review/);
    } finally { await runner.close(); }
  });
});

test('Ashby field groups supply labels and required status for custom yes/no controls', async () => {
  const html = `<form><div data-field-path="authorization"><label class="ashby-application-form-question-title _required_fixture">Are you eligible to work in India?</label><div class="ashby-application-form-input-yesno"><button type="button" data-option="yes" onclick="this.setAttribute('aria-pressed','true');this.parentElement.querySelector('input').checked=true">Yes</button><button type="button" data-option="no">No</button><input type="checkbox" name="opaque" style="display:none"></div></div><div data-field-path="unknown"><label class="ashby-application-form-question-title _required_fixture">Employer-specific clearance</label><input></div><button>Submit application</button></form>`;
  await localPage(html, async url => {
    const runner = new AutoApplyRunner();
    try {
      await runner.initBrowser(true);
      const report = await runner.run({ url, profile: { ...profile, workAuthorization: { ...profile.workAuthorization, authorizedInCountry: true } }, headless: false, submit: true });
      const page = (runner as unknown as { page: Page }).page;
      assert.equal(await page.locator('[data-option=yes]').getAttribute('aria-pressed'), 'true');
      assert(report.actions.some(a => a.status === 'failed' && a.error === 'Required answer is missing'));
      assert.equal(report.submissionAttempted, undefined);
    } finally { await runner.close(); }
  });
});

test('Ashby full-name instructions do not override the actual field title', async () => {
  await localPage('<form><div data-field-path="name"><label class="ashby-application-form-question-title">Full name</label><div class="ashby-application-form-question-description">Enter First Name, Middle Name, then Last Name.</div><input id="_systemfield_name" required></div><button>Submit application</button></form>', async url => {
    const runner = new AutoApplyRunner();
    try {
      await runner.initBrowser(true);
      const report = await runner.run({ url, profile, headless: false });
      const page = (runner as unknown as { page: Page }).page;
      assert.equal(await page.locator('input').inputValue(), 'Synthetic Candidate');
      assert.match(report.reason!, /Ready for submission review/);
    } finally { await runner.close(); }
  });
});

test('country calling codes and complete city suggestions match explicit profile geography', async () => {
  await localPage(`<form><label>Country<input id="country" role="combobox" aria-autocomplete="list" aria-controls="countries" onclick="document.querySelector('#countries').hidden=false"></label><div id="countries" role="listbox" hidden><div role="option">British Indian Ocean Territory +246</div><div role="option" onclick="document.querySelector('#country').dataset.selected=this.textContent;this.parentElement.hidden=true">India +91</div></div><label>City<input id="city" role="combobox" aria-autocomplete="list" aria-controls="cities" onclick="document.querySelector('#cities').hidden=false"></label><div id="cities" role="listbox" hidden><div role="option" onclick="document.querySelector('#city').dataset.selected=this.textContent;this.parentElement.hidden=true">Bengaluru, Karnataka, India</div></div><button>Submit application</button></form>`, async url => {
    const runner = new AutoApplyRunner();
    try {
      await runner.initBrowser(true);
      await runner.run({ url, profile: { ...profile, personal: { ...profile.personal, city: 'Bengaluru', state: 'Karnataka' } }, headless: false });
      const page = (runner as unknown as { page: Page }).page;
      assert.equal(await page.locator('#country').getAttribute('data-selected'), 'India +91');
      assert.equal(await page.locator('#city').getAttribute('data-selected'), 'Bengaluru, Karnataka, India');
    } finally { await runner.close(); }
  });
});

for (const challenge of [false, true]) test(`invisible reCAPTCHA badge permits review while visible challenge pauses, challenge=${challenge}`, async () => {
  await localPage(`<form><label>Email<input type="email"></label><button>Submit application</button></form><iframe src="/recaptcha/enterprise/anchor?size=invisible" title="reCAPTCHA"></iframe>${challenge ? '<iframe src="/recaptcha/enterprise/bframe" title="reCAPTCHA challenge"></iframe>' : ''}`, async url => {
    const runner = new AutoApplyRunner();
    try {
      await runner.initBrowser(true);
      const page = (runner as unknown as { page: Page }).page;
      await page.route('**/recaptcha/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Local synthetic CAPTCHA structure</p>' }));
      const report = await runner.run({ url, profile, headless: false });
      assert.match(report.reason!, challenge ? /CAPTCHA needs browser review/ : /Ready for submission review/);
      assert.equal(report.submissionAttempted, undefined);
    } finally { await runner.close(); }
  });
});

test('explicit saved boolean answer fills a previously unanswered checkbox on resume', async () => {
  await localPage('<form><label>Explicit privacy choice<input type="checkbox" id="choice" required></label><button>Submit application</button></form>', async url => {
    const runner = new AutoApplyRunner();
    try {
      await runner.initBrowser(true);
      await runner.run({ url, profile, headless: false });
      const report = await runner.run({ url, profile: { ...profile, answers: [{ scope: 'EMPLOYER_SCOPED', employerKey: new URL(url).origin, question: 'Explicit privacy choice', value: true }] }, resume: true, headless: false });
      const page = (runner as unknown as { page: Page }).page;
      assert.equal(await page.locator('#choice').isChecked(), true);
      assert.match(report.reason!, /Ready for submission review/);
    } finally { await runner.close(); }
  });
});

test('a DataDome text restriction without an iframe pauses autonomous navigation', async () => {
  await localPage('<h1>Access is temporarily restricted</h1><p>We detected unusual activity from your device or network.</p><button onclick="document.body.dataset.clicked=\'yes\'">Continue</button>', async url => {
    const runner = new AutoApplyRunner();
    try {
      await runner.initBrowser(true);
      const report = await runner.run({ url, profile, mode: 'stealth', submit: true, headless: false });
      const page = (runner as unknown as { page: Page }).page;
      assert.match(report.reason!, /CAPTCHA needs browser review/);
      assert.equal(await page.locator('body').getAttribute('data-clicked'), null);
      assert.equal(report.submissionAttempted, undefined);
    } finally { await runner.close(); }
  });
});

for (const [vendor, source] of [
  ['reCAPTCHA', 'https://www.google.com/recaptcha/api2/anchor?size=normal'],
  ['hCaptcha', 'https://newassets.hcaptcha.com/gate'],
  ['DataDome', 'https://geo.captcha-delivery.com/gate'],
  ['Cloudflare', 'https://challenges.cloudflare.com/gate'],
] as const) test(`${vendor} handoff detects completion and resumes exactly one submission`, async () => {
  await localPage(`<form onsubmit="event.preventDefault();document.body.dataset.submissions=String(Number(document.body.dataset.submissions||0)+1);document.querySelector('h1').textContent='Application submitted'"><h1>Application</h1><label>Email<input type="email" required></label><button>Submit application</button></form><iframe src="${source}"></iframe><button type="button" id="complete" onclick="document.querySelector('iframe').remove();this.remove()">Complete synthetic verification</button>`, async url => {
    const runner = new AutoApplyRunner();
    const controller = new AbortController();
    try {
      await runner.initBrowser(true);
      const page = (runner as unknown as { page: Page }).page;
      await page.route(/^https:\/\//, route => route.fulfill({ contentType: 'text/html', body: '<p>Synthetic verification gate</p>' }));
      const paused = await runner.run({ url, profile, mode: 'stealth', submit: true, headless: false });
      assert.equal(paused.reviewKind, 'challenge');
      assert.equal(paused.submissionAttempted, undefined);
      const change = runner.waitForReviewChange(paused, controller.signal);
      await page.locator('#complete').click();
      assert.equal(await change, true);
      const submitted = await runner.run({ url, profile, mode: 'stealth', submit: true, resume: true, headless: false });
      assert.equal(submitted.status, 'submitted');
      assert.equal(await page.locator('body').getAttribute('data-submissions'), '1');
    } finally { controller.abort(); await runner.close(); }
  });
});

test('login handoff resumes when the owner signs in and the authentication path changes', async () => {
  await localPage('<form><label>Email<input type="email"></label><label>Password<input type="password"></label><button type="button" id="sign-in" onclick="document.querySelector(\'input[type=password]\').remove();history.replaceState(null,\'\',\'/application\');this.remove()">Complete synthetic sign-in</button><button>Submit application</button></form>', async url => {
    const runner = new AutoApplyRunner();
    const controller = new AbortController();
    try {
      await runner.initBrowser(true);
      const paused = await runner.run({ url: url + 'login', profile, mode: 'stealth', headless: false });
      assert.equal(paused.reviewKind, 'authentication');
      const change = runner.waitForReviewChange(paused, controller.signal);
      const page = (runner as unknown as { page: Page }).page;
      await page.locator('#sign-in').click();
      assert.equal(await change, true);
      const resumed = await runner.run({ url, profile, mode: 'stealth', resume: true, headless: false });
      assert.match(resumed.reason!, /Ready for submission review/);
    } finally { controller.abort(); await runner.close(); }
  });
});

test('runner uploads a hidden resume control identified only by its id', async () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'portal-resume-'));
  const resume = path.join(folder, 'resume.txt');
  writeFileSync(resume, 'Synthetic portal resume');
  await localPage('<h1>Application</h1><input id="resume" type="file" style="display:none">', async url => {
    const runner = new AutoApplyRunner();
    try {
      await runner.initBrowser(true);
      const report = await runner.run({ url, profile: { ...profile, documents: { resume } }, headless: false });
      const page = (runner as unknown as { page: Page }).page;
      assert.notEqual(report.status, 'failed');
      assert.equal(await page.locator('#resume').evaluate(async el => (el as HTMLInputElement).files?.[0]?.text()), 'Synthetic portal resume');
    } finally { await runner.close(); }
  });
});

test('extension uploads actual bytes through a hidden resume control', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<label>Resume<input type="file" name="resume" style="display:none"></label>');
    const result = await extensionFill(page, { ...profile, documentUploads: { resume: { name: 'resume.txt', type: 'text/plain', base64: Buffer.from('Synthetic extension resume').toString('base64') } } });
    assert.deepEqual(result.errors, []);
    assert.equal(await page.locator('[type=file]').evaluate(async el => (el as HTMLInputElement).files?.[0]?.text()), 'Synthetic extension resume');
  } finally { await browser.close(); }
});

test('extension resolves an ordinary Name label to the candidate full name', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<label>Name<input name="name"></label>');
    await extensionFill(page);
    assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'Synthetic Candidate');
  } finally { await browser.close(); }
});

test('extension scopes country choices to aria-controls and rejects a negated match', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(countryCombo);
    await extensionFill(page);
    assert.equal(await page.locator('body').getAttribute('data-country'), 'India');
    assert.equal(await page.locator('body').getAttribute('data-wrong'), null);
  } finally { await browser.close(); }
});

test('runner scopes country choices to aria-controls and rejects a negated match', async () => {
  await localPage(countryCombo, async url => {
    const runner = new AutoApplyRunner();
    try {
      await runner.initBrowser(true);
      await runner.run({ url, profile, headless: false });
      const page = (runner as unknown as { page: Page }).page;
      assert.equal(await page.locator('body').getAttribute('data-country'), 'India');
      assert.equal(await page.locator('body').getAttribute('data-wrong'), null);
    } finally { await runner.close(); }
  });
});

test('runner waits for an application form mounted after DOM readiness', async () => {
  const html = `<h1>Loading application</h1><script>setTimeout(()=>{document.body.innerHTML='<label>Email<input type="email" name="email" required></label>'},300)</script>`;
  await localPage(html, async url => {
    const runner = new AutoApplyRunner();
    try {
      await runner.initBrowser(true);
      const report = await runner.run({ url, profile, headless: false });
      const page = (runner as unknown as { page: Page }).page;
      assert.notEqual(report.status, 'failed');
      assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), profile.personal.email);
    } finally { await runner.close(); }
  });
});

test('runner opens Apply then Apply Manually despite a hidden email control', async () => {
  const html = `<h1 data-automation-id="pageHeader">Job description</h1><input type="email" hidden>
    <button id="apply">Apply</button><script>
    document.getElementById('apply').onclick=()=>{
      document.body.innerHTML='<button id="manual">Apply Manually</button><button>Autofill with Resume</button>';
      document.getElementById('manual').onclick=()=>{document.body.innerHTML='<label>Email<input type="email" name="email" required></label>'};
    };</script>`;
  await localPage(html, async url => {
    const runner = new AutoApplyRunner();
    try {
      await runner.initBrowser(true);
      const report = await runner.run({ url, profile, headless: false });
      const page = (runner as unknown as { page: Page }).page;
      assert.notEqual(report.status, 'failed');
      assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), profile.personal.email);
    } finally { await runner.close(); }
  });
});

test('runner treats an aria-required upload group as required without native required', async () => {
  const html = `<h1>Application</h1>
    <div role="group" aria-labelledby="upload-label-resume" aria-required="true">
      <div id="upload-label-resume">Resume/CV</div>
      <label for="resume">Attach</label><input id="resume" type="file" style="display:none">
    </div>
    <button onclick="document.body.dataset.submitted='yes';document.body.innerHTML='<h1>Application submitted</h1>'">Submit application</button>`;
  await localPage(html, async url => {
    const runner = new AutoApplyRunner();
    try {
      await runner.initBrowser(true);
      const report = await runner.run({ url, profile, submit: true, headless: false, timeoutMs: 300 });
      const page = (runner as unknown as { page: Page }).page;
      assert.equal(report.status, 'paused_for_review');
      assert.equal(report.submissionAttempted, undefined);
      assert.equal(await page.locator('body').getAttribute('data-submitted'), null);
      assert.equal(await page.locator('#resume').count(), 1);
    } finally { await runner.close(); }
  });
});

test('runner types into an editable combobox before resolving its newly mounted scoped options', async () => {
  const html = `<h1>Application</h1>
    <div role="listbox" id="unrelated"><div role="option" onclick="document.body.dataset.wrong='yes'">India</div></div>
    <label id="country-label" for="country">Country</label>
    <input id="country" role="combobox" aria-autocomplete="list" aria-labelledby="country-label" aria-required="true">
    <script>
    document.getElementById('country').addEventListener('input',function(){
      this.setAttribute('aria-controls','country-options');
      if(document.getElementById('country-options'))return;
      const options=document.createElement('div');options.id='country-options';options.setAttribute('role','listbox');
      options.innerHTML='<div role="option" data-country="Not India">Not India</div><div role="option" data-country="India">India</div>';
      options.addEventListener('click',event=>{const option=event.target.closest('[role=option]');if(!option)return;document.body.dataset.country=option.dataset.country;document.getElementById('country').value=option.dataset.country;options.hidden=true});
      document.body.append(options);
    });
    </script>`;
  await localPage(html, async url => {
    const runner = new AutoApplyRunner();
    try {
      await runner.initBrowser(true);
      const report = await runner.run({ url, profile, headless: false });
      const page = (runner as unknown as { page: Page }).page;
      assert.notEqual(report.status, 'failed');
      assert.equal(await page.locator('#country').inputValue(), 'India');
      assert.equal(await page.locator('body').getAttribute('data-country'), 'India');
      assert.equal(await page.locator('body').getAttribute('data-wrong'), null);
    } finally { await runner.close(); }
  });
});

test('runner fills known answers before pausing at a visible CAPTCHA iframe', { timeout: 30000 }, async () => {
  const html = `<h1>Application</h1><label>Email<input type="email" name="email" required></label>
    <iframe title="reCAPTCHA" src="data:text/html,Verification%20challenge#recaptcha"></iframe>
    <button onclick="document.body.dataset.submitted='yes';document.body.innerHTML='<h1>Application submitted</h1>'">Submit application</button>`;
  await localPage(html, async url => {
    const runner = new AutoApplyRunner();
    try {
      await runner.initBrowser(true);
      const report = await runner.run({ url, profile, submit: true, headless: false });
      const page = (runner as unknown as { page: Page }).page;
      assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), profile.personal.email);
      assert.equal(report.status, 'paused_for_review');
      assert.match(report.reason || '', /CAPTCHA/i);
      assert.equal(report.submissionAttempted, undefined);
      assert.equal(await page.locator('body').getAttribute('data-submitted'), null);
    } finally { await runner.close(); }
  });
});

test('application ATS identification uses actual major portal hostnames', () => {
  const portals = [
    ['greenhouse', 'https://job-boards.greenhouse.io/example/jobs/123'],
    ['lever', 'https://jobs.lever.co/example/123'],
    ['ashby', 'https://jobs.ashbyhq.com/example/123'],
    ['workday', 'https://example.wd1.myworkdayjobs.com/en-US/Careers/job/123'],
    ['workable', 'https://apply.workable.com/j/123'],
    ['smartrecruiters', 'https://jobs.smartrecruiters.com/example/123'],
    ['icims', 'https://careers-example.icims.com/jobs/123/job'],
    ['oracle', 'https://example.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/123'],
    ['successfactors', 'https://career2.successfactors.eu/career?company=example&job_req_id=123'],
    ['recruitee', 'https://example.recruitee.com/o/engineer'],
    ['taleo', 'https://example.tbe.taleo.net/ats/careers/requisition.jsp?rid=123'],
  ];
  for (const [portal, url] of portals) assert.equal(identifyApplicationAts(url!), portal, url);
  for (const url of [
    'https://fakegreenhouse.io/jobs/123',
    'https://greenhouse.io.example.test/jobs/123',
    'https://example.test/?redirect=https://jobs.lever.co/example/123',
    'https://example.test/?workday=myworkdayjobs.com',
    'https://example.test/https://example.taleo.net/career',
  ]) assert.equal(identifyApplicationAts(url), 'generic', url);
});

test('runner fills known answers before pausing at a DataDome CAPTCHA iframe', { timeout: 30000 }, async () => {
  const html = `<h1>Application</h1><label>Email<input type="email" name="email" required></label>
    <iframe title="DataDome CAPTCHA" src="data:text/html,Verification%20challenge#captcha-delivery.com"></iframe>
    <button onclick="document.body.dataset.submitted='yes';document.body.innerHTML='<h1>Application submitted</h1>'">Submit application</button>`;
  await localPage(html, async url => {
    const runner = new AutoApplyRunner();
    try {
      await runner.initBrowser(true);
      const report = await runner.run({ url, profile, submit: true, headless: false });
      const page = (runner as unknown as { page: Page }).page;
      assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), profile.personal.email);
      assert.equal(report.status, 'paused_for_review');
      assert.match(report.reason || '', /CAPTCHA/i);
      assert.equal(report.submissionAttempted, undefined);
      assert.equal(await page.locator('body').getAttribute('data-submitted'), null);
    } finally { await runner.close(); }
  });
});

test('resumed review preserves manually answered consent, radio groups and uploaded documents', async () => {
  await localPage(`<label>Consent to employer terms<input id="consent" type="checkbox" required></label>
    <fieldset><legend>Available for rotating shifts?</legend><label>Yes<input name="shifts" type="radio" value="yes" required></label><label>No<input name="shifts" type="radio" value="no" required></label></fieldset>
    <label>Supporting document<input id="support" type="file"></label><button>Submit application</button>`, async url => {
    const runner = new AutoApplyRunner();
    try {
      await runner.initBrowser(true);
      await runner.run({ url, profile, headless: false });
      const page = (runner as unknown as { page: Page }).page;
      await page.locator('#consent').check();
      await page.locator('[value=no]').check();
      await page.locator('#support').setInputFiles({ name: 'reviewed.txt', mimeType: 'text/plain', buffer: Buffer.from('Owner reviewed document') });
      const report = await runner.run({ url, profile, headless: false, resume: true, preserveReviewedValues: true });
      assert.equal(await page.locator('#consent').isChecked(), true);
      assert.equal(await page.locator('[value=no]').isChecked(), true);
      assert.equal(await page.locator('#support').evaluate(el => (el as HTMLInputElement).files?.[0]?.name), 'reviewed.txt');
      assert.equal(report.actions.some(action => action.status === 'failed'), false);
      assert.match(report.reason!, /Ready for submission review/);
    } finally { await runner.close(); }
  });
});

