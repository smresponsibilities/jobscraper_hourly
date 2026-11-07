import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { chromium, type Page } from 'playwright';
import { AutoApplyRunner } from './runner.js';
import { classifyAtsField } from './classifier.js';
import type { CandidateExtendedProfile } from './types.js';

// Reduced from the owner-authenticated Workday /apply/applyManually form.
// Source metadata is retained locally in out/portal-audit/workday-auth-fields.json.
const html = `<h1>My Information</h1><form>
  <label for="name--legalName--firstName">Given Name(s)*</label><input id="name--legalName--firstName" name="legalName--firstName" aria-required="true">
  <label for="name--legalName--lastName">Family Name</label><input id="name--legalName--lastName" name="legalName--lastName">
  <label for="name--legalName--firstNameLocal">Local Given Name(s)</label><input id="name--legalName--firstNameLocal" name="legalName--firstNameLocal">
  <label for="country--country">Country*</label><button type="button" name="country" id="country--country" aria-haspopup="listbox" aria-label="Country Select One Required" onclick="document.querySelector('#countries').hidden=false">Select One</button>
  <ul id="countries" role="listbox" hidden><li role="option" onclick="document.querySelector('#country--country').textContent='India';this.parentElement.hidden=true">India</li></ul>
  <label for="phoneNumber--phoneType">Phone Device Type*</label><button type="button" name="phoneType" id="phoneNumber--phoneType" aria-haspopup="listbox" aria-label="Phone Device Type Select One Required" onclick="document.querySelector('#phoneTypes').hidden=false">Select One</button>
  <ul id="phoneTypes" role="listbox" hidden><li role="option" onclick="document.querySelector('#phoneNumber--phoneType').textContent='Mobile';this.parentElement.hidden=true">Mobile</li></ul>
  <label for="phoneNumber--countryPhoneCode">Country Phone Code</label><input id="phoneNumber--countryPhoneCode">
  <label for="phoneNumber--phoneNumber">Phone Number</label><input id="phoneNumber--phoneNumber" name="phoneNumber">
  <label for="phoneNumber--extension">Phone Extension</label><input id="phoneNumber--extension" name="extension">
  <div id="radio-label1">Have you previously worked for NVIDIA?</div><div aria-labelledby="radio-label1"><label>Yes<input name="candidateIsPreviousWorker" type="radio"></label><label>No<input name="candidateIsPreviousWorker" type="radio"></label></div>
  <button>Submit application</button></form>`;
const profile = { personal: { firstName: 'Synthetic', lastName: 'Candidate', email: 'fixture@example.test', phone: '9870000000', phoneCountryCode: '+91', country: 'India' }, education: [], experience: [], professional: {}, workAuthorization: { formerEmployee: false }, eeo: {} } as unknown as CandidateExtendedProfile;

test('transient empty child frame URLs do not interrupt application review', async () => {
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const page = (runner as unknown as { page: Page }).page;
    await page.goto('data:text/html,fixture');
    await page.setContent('<form><label>Email<input type="email" required></label><button>Submit application</button></form><iframe src="data:text/html,child"></iframe>');
    await page.locator('iframe').waitFor();
    const child = await page.locator('iframe').elementHandle().then(handle => handle!.contentFrame());
    assert(child);
    const original = child.url;
    child.url = () => '';
    try {
      const report = await runner.run({ url: 'https://example.test/application', profile, resume: true, headless: false });
      assert.equal(await page.locator('input').inputValue(), profile.personal.email);
      assert.match(report.reason!, /Ready for submission review/);
      assert.equal(report.submissionAttempted, undefined);
    } finally { child.url = original; }
  } finally { await runner.close(); }
});

test('Workday local names, phone device types and extensions are not inferred from primary names or phone', () => {
  assert.equal(classifyAtsField({ id: 'country', ariaLabel: 'Phone' }).category, 'country');
  for (const descriptor of [{ id: 'name--legalName--firstNameLocal', label: 'Local Given Name(s)' }, { id: 'phoneNumber--extension', label: 'Phone Extension' }, { id: 'phoneNumber--phoneType', label: 'Phone Device Type' }]) {
    assert.equal(classifyAtsField(descriptor).category, 'unknown');
  }
  assert.equal(classifyAtsField({ id: 'phoneNumber--countryPhoneCode', label: 'Country Phone Code' }).category, 'phone_country_code');
});

for (const answered of [false, true]) test(`Workday authenticated form handles named listbox buttons and default-on radio choices, explicit device type=${answered}`, async () => {
  let submissions = 0;
  const server = createServer((request, response) => { if (request.method === 'POST') submissions++; response.setHeader('Content-Type', 'text/html'); response.end(html); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile: { ...profile, qaBank: answered ? { 'Phone Device Type': 'Mobile' } : {}, answers: [{ scope: 'EMPLOYER_SCOPED', employerKey: 'http://127.0.0.1:' + address.port, question: 'Have you previously worked for NVIDIA?', value: false }] }, headless: false });
    const page = (runner as unknown as { page: Page }).page;
    assert.equal(await page.locator('[name="legalName--firstName"]').inputValue(), 'Synthetic');
    assert.equal(await page.locator('[name="legalName--lastName"]').inputValue(), 'Candidate');
    assert.equal(await page.locator('[name="legalName--firstNameLocal"]').inputValue(), '');
    assert.equal(await page.locator('#country--country').innerText(), 'India');
    assert.equal(await page.locator('#phoneNumber--countryPhoneCode').inputValue(), '+91');
    assert.equal(await page.locator('#phoneNumber--phoneNumber').inputValue(), profile.personal.phone);
    assert.equal(await page.locator('#phoneNumber--extension').inputValue(), '');
    assert.equal(await page.locator('[name=candidateIsPreviousWorker]').nth(1).isChecked(), true);
    assert.equal(await page.locator('#phoneNumber--phoneType').innerText(), answered ? 'Mobile' : 'Select One');
    assert.match(report.reason!, answered ? /Ready for submission review/ : /field errors/);
    assert.equal(report.submissionAttempted, undefined);
    assert.equal(submissions, 0);
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('extension handles authenticated Workday button dropdowns and radio questions without guessing optional fields', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    await page.addScriptTag({ content: 'window.chrome={runtime:{onMessage:{addListener(listener){window.fixtureListener=listener}}}};' });
    await page.addScriptTag({ path: 'extension/content/content.js' });
    await page.evaluate(candidate => new Promise<void>(resolve => {
      (window as unknown as { fixtureListener: Function }).fixtureListener({ type: 'AUTOFILL_FORM', profile: candidate }, {}, () => resolve());
    }), { ...profile, qaBank: { 'Phone Device Type': 'Mobile' }, answers: [{ scope: 'EMPLOYER_SCOPED', employerKey: 'null', question: 'Have you previously worked for NVIDIA?', value: false }] });
    assert.equal(await page.locator('#country--country').innerText(), 'India');
    assert.equal(await page.locator('#phoneNumber--phoneType').innerText(), 'Mobile');
    assert.equal(await page.locator('[name="legalName--firstNameLocal"]').inputValue(), '');
    assert.equal(await page.locator('#phoneNumber--extension').inputValue(), '');
    assert.equal(await page.locator('#phoneNumber--countryPhoneCode').inputValue(), '+91');
    assert.equal(await page.locator('[name=candidateIsPreviousWorker]').nth(1).isChecked(), true);
  } finally { await browser.close(); }
});

