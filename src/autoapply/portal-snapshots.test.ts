import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright';
import { AutoApplyRunner } from './runner.js';
import type { CandidateExtendedProfile } from './types.js';

// Structural reductions of observed live forms. Vendor code, assets and URLs
// are removed; local checks prove these field contracts, not live acceptance.
const snapshots = {
  greenhouse: {
    source: 'https://job-boards.greenhouse.io/fictiv/jobs/8764362002',
    evidence: 'ev_40a5ec4b5b2f4556252cb9276606c148fde81f66365ec89430559a90bcd2c93d',
    html: `<h1>Apply for this job</h1><form id="application-form">
      <label id="first_name-label" for="first_name">First Name<span aria-hidden="true">*</span></label>
      <input id="first_name" aria-label="First Name" aria-required="true" type="text">
      <label id="last_name-label" for="last_name">Last Name<span aria-hidden="true">*</span></label>
      <input id="last_name" aria-label="Last Name" aria-required="true" type="text">
      <label id="email-label" for="email">Email<span aria-hidden="true">*</span></label>
      <input id="email" aria-label="Email" aria-required="true" type="text">
      <label id="phone-label" for="phone">Phone<span aria-hidden="true">*</span></label>
      <input id="phone" aria-label="Phone" aria-required="true" type="tel">
      <div role="group" aria-labelledby="upload-label-resume" aria-required="true" class="file-upload">
        <div id="upload-label-resume">Resume/CV<span class="required">*</span></div>
        <label class="visually-hidden" for="resume">Attach</label>
        <input id="resume" class="visually-hidden" type="file" accept=".pdf,.doc,.docx,.txt,.rtf">
      </div>
      <label id="question_38075017002-label" for="question_38075017002">Are you comfortable working a night shift?<span aria-hidden="true">*</span></label>
      <textarea id="question_38075017002" aria-label="Are you comfortable working a night shift?" aria-required="true" rows="4"></textarea>
    </form>`,
    name: '#first_name', lastName: '#last_name', email: '#email', phone: '#phone', resume: '#resume', unknown: '#question_38075017002',
  },
  recruitee: {
    source: 'https://castolin.recruitee.com/o/graduate-trainee-engineer',
    evidence: 'ev_af205977c2b39279e3613f1d7e2fd17f0c7fc6183548958a634f9e20e535bf63',
    html: `<h1>Graduate Trainee Engineer</h1><form>
      <fieldset><legend>My information</legend>
        <label for="input-candidate.name-radix-:R197l9r6l:">Full name<span aria-hidden="true">*</span></label>
        <input type="text" id="input-candidate.name-radix-:R197l9r6l:" required maxlength="255" placeholder="Full name" autocomplete="name" name="candidate.name">
        <label for="input-candidate.email-radix-:R1h7l9r6l:">Email address<span aria-hidden="true">*</span></label>
        <input type="email" id="input-candidate.email-radix-:R1h7l9r6l:" required maxlength="255" placeholder="Your email address" autocomplete="email" name="candidate.email">
        <label for="input-candidate.phone-radix-:R1p7l9r6l:">Phone number<span aria-hidden="true">*</span></label>
        <input type="tel" id="input-candidate.phone-radix-:R1p7l9r6l:" required autocomplete="tel" name="candidate.phone" placeholder="Your phone number" value="+91">
      </fieldset>
      <label for="input-candidate.cv-radix-:R1nl9r6l:">CV or resume<span aria-hidden="true">*</span></label>
      <input type="file" required name="candidate.cv" id="input-candidate.cv-radix-:R1nl9r6l:" aria-labelledby="input-candidate.cv-radix-:R1pnl9r6lH2:" data-cy="fileInputField" style="opacity:0;height:1px">
      <fieldset><legend>Legal Agreements</legend>
        <input required type="checkbox" aria-labelledby="input-candidate.agreements.0.consent-radix-:R5jnl9r6l:-0" name="candidate.agreements.0.consent" value="false">
        <div id="input-candidate.agreements.0.consent-radix-:R5jnl9r6l:-0">By submitting the application documents, our privacy policy applies. We assure you that we will treat your data confidentially and will only use it for purposes listed under the privacy notice.</div>
      </fieldset>
    </form>`,
    name: '[name="candidate.name"]', lastName: null, email: '[name="candidate.email"]', phone: '[name="candidate.phone"]', resume: '[name="candidate.cv"]', unknown: '[name="candidate.agreements.0.consent"]',
  },
  lever: {
    source: 'https://jobs.lever.co/alltrails/e1c6dca7-2b22-461d-aded-4f142ea94c9b/apply',
    evidence: 'ev_1784175217298b5d3ad786279bef1b23834117ccd78acb73117867f791f16ecb',
    html: `<h1>Submit your application</h1><form>
      <label><div class="application-label">Resume/CV<span class="required">✱</span></div>
        <input class="application-file-input invisible-resume-upload" data-qa="input-resume" id="resume-upload-input" name="resume" tabindex="-1" type="file">
      </label>
      <label><div class="application-label">Full name<span class="required">✱</span></div><div class="application-field"><input type="text" data-qa="name-input" name="name" required></div></label>
      <label><div class="application-label">Email<span class="required">✱</span></div><div class="application-field"><input name="email" data-qa="email-input" type="email" required></div></label>
      <label><div class="application-label">Phone</div><div class="application-field"><input type="text" data-qa="phone-input" name="phone"></div></label>
      <div class="application-question custom-question"><div>
        <div class="application-label full-width textarea"><div class="text">This role requires concepting and executing creative across digital, social, OOH, lifecycle, and in-product channels. Which of these are you most experienced in, and where do you have gaps?<span class="required">✱</span></div></div>
        <div class="application-field full-width required-field"><textarea class="card-field-input" name="cards[d9b94d5d-3cc9-47f8-8f14-ba2d9de63012][field1]" required></textarea></div>
      </div></div>
    </form>`,
    name: '[name="name"]', lastName: null, email: '[name="email"]', phone: '[name="phone"]', resume: '#resume-upload-input', unknown: 'textarea',
  },
  workable: {
    source: 'https://apply.workable.com/weekday-1/j/6C3B276F09/apply/',
    evidence: 'ev_4717ca7da059ef4d1a5d7278f14e82e7c69f80fc97164b51de635c058986e91f',
    html: `<h1>Business Analyst - Process &amp; Automation</h1><form>
      <label><span id="firstname_label">First name</span><input aria-required="true" id="firstname" maxlength="127" data-ui="firstname" name="firstname" aria-labelledby="firstname_label" required type="text"></label>
      <label><span id="lastname_label">Last name</span><input aria-required="true" id="lastname" maxlength="127" data-ui="lastname" name="lastname" aria-labelledby="lastname_label" required type="text"></label>
      <label><span id="email_label">Email</span><input aria-required="true" id="email" maxlength="255" data-ui="email" name="email" aria-labelledby="email_label" required type="email"></label>
      <span id="phone_label">Phone</span><input aria-required="true" aria-labelledby="phone_label" maxlength="255" required aria-describedby="phone_helper" id="input_phone" name="phone" type="tel" autocomplete="tel" inputmode="tel">
      <span id="BxrAM9mMtkOyAxY6_label">Resume</span>
      <label tabindex="0" role="button" for="input_files_input_BxrAM9mMtkOyAxY6" id="description_input_BxrAM9mMtkOyAxY6" aria-describedby="BxrAM9mMtkOyAxY6_label">Choose file</label>
      <input data-ui="resume" tabindex="-1" id="input_files_input_BxrAM9mMtkOyAxY6" type="file" aria-labelledby="BxrAM9mMtkOyAxY6_label description_input_BxrAM9mMtkOyAxY6" accept=".pdf,.doc,.docx,.odt,.rtf,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text,application/rtf" required>
      <label><span id="QA_12403305_label"><strong>What’s your current salary? (in lakhs per annum)</strong></span><div><input aria-required="true" data-ui="QA_12403305" required name="QA_12403305" type="text"></div></label>
      <label><span id="QA_12403306_label"><strong>How many days is your notice period?</strong></span><div><input aria-required="true" data-ui="QA_12403306" required name="QA_12403306" type="text"></div></label>
    </form>`,
    name: '#firstname', lastName: '#lastname', email: '#email', phone: '#input_phone', resume: '#input_files_input_BxrAM9mMtkOyAxY6', unknown: '[name="QA_12403305"]',
  },
  ashby: {
    source: 'https://jobs.ashbyhq.com/camunda/89fb70ec-afbe-475b-a5d8-c2268ee4d7fd/application',
    evidence: 'ev_379270293e231944de6f6269518a19667402b30980d435184a9a4d683765874f',
    html: `<h1>Application</h1><form>
      <div class="ashby-application-form-field-entry" data-field-path="_systemfield_name">
        <label class="ashby-application-form-question-title" for="_systemfield_name">Name</label>
        <div><input placeholder="Type here..." name="_systemfield_name" required id="_systemfield_name" type="text" class="ashby-application-form-input-text"></div>
      </div>
      <div class="ashby-application-form-field-entry" data-field-path="_systemfield_email">
        <label class="ashby-application-form-question-title" for="_systemfield_email">Email</label>
        <div><input placeholder="hello@example.com..." name="_systemfield_email" required id="_systemfield_email" type="email" class="ashby-application-form-input-text"></div>
      </div>
      <label class="ashby-application-form-question-title" for="_systemfield_resume">Resume</label>
      <input accept="application/pdf,.pdf,text/plain,.txt" type="file" tabindex="-1" id="_systemfield_resume" required style="position:absolute;width:1px;height:1px;clip-path:inset(50%)">
      <div class="ashby-application-form-field-entry" data-field-path="6b1966bc-eebf-437c-812e-c072c162b518">
        <label class="ashby-application-form-question-title" for="6b1966bc-eebf-437c-812e-c072c162b518">What are your salary expectations?</label>
        <div><input placeholder="Type here..." name="6b1966bc-eebf-437c-812e-c072c162b518" required id="6b1966bc-eebf-437c-812e-c072c162b518" type="text"></div>
      </div>
    </form>`,
    name: '#_systemfield_name', lastName: null, email: '#_systemfield_email', phone: null, resume: '#_systemfield_resume', unknown: '[name="6b1966bc-eebf-437c-812e-c072c162b518"]',
  },
} as const;

for (const [portal, snapshot] of Object.entries(snapshots)) {
  test(`${portal} observed form fills identity and resume but leaves unknown required answers for review`, async () => {
    const folder = mkdtempSync(path.join(tmpdir(), `portal-${portal}-`));
    const resume = path.join(folder, 'resume.pdf');
    const resumeBytes = `Synthetic ${portal} resume bytes`;
    writeFileSync(resume, resumeBytes);
    const candidate = {
      personal: { firstName: 'Synthetic', lastName: 'Candidate', email: 'fixture@example.test', phone: '+919876543210', country: 'India' },
      education: [], experience: [], professional: {}, workAuthorization: {}, eeo: {}, documents: { resume },
    } as unknown as CandidateExtendedProfile;
    let submitRequests = 0;
    const server = createServer((request, response) => {
      if (request.method !== 'GET') { submitRequests++; response.end('Unexpected submission'); return; }
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>${portal} structural fixture</title><style>.visually-hidden{position:absolute;width:1px;height:1px;clip-path:inset(50%)}</style><body>${snapshot.html}<button type="submit" form="local-fixture-submit">Submit application</button><form id="local-fixture-submit" method="post"></form></body></html>`);
    });
    const runner = new AutoApplyRunner();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert(address && typeof address !== 'string');
    try {
      assert.match(snapshot.source, /^https:\/\//);
      assert.match(snapshot.evidence, /^ev_[a-f0-9]{64}$/);
      await runner.initBrowser(true);
      const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile: candidate, submit: true, headless: false });
      const page = (runner as unknown as { page: Page }).page;
      assert.equal(await page.locator(snapshot.name).inputValue(), snapshot.lastName ? 'Synthetic' : 'Synthetic Candidate');
      if (snapshot.lastName) assert.equal(await page.locator(snapshot.lastName).inputValue(), 'Candidate');
      assert.equal(await page.locator(snapshot.email).inputValue(), candidate.personal.email);
      if (snapshot.phone) assert.equal(await page.locator(snapshot.phone).inputValue(), candidate.personal.phone);
      assert.equal(await page.locator(snapshot.resume).evaluate(async el => (el as HTMLInputElement).files?.[0]?.text()), resumeBytes);
      const unknown = page.locator(snapshot.unknown);
      if (await unknown.getAttribute('type') === 'checkbox') assert.equal(await unknown.isChecked(), false);
      else assert.equal(await unknown.inputValue(), '');
      assert.equal(report.status, 'paused_for_review');
      assert.equal(report.submissionAttempted, undefined);
      assert.equal(report.receipt, undefined);
      assert.equal(submitRequests, 0);
      assert(report.actions.some(action => action.status === 'failed' && action.error === 'Required answer is missing'));
    } finally {
      await runner.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
      rmSync(folder, { recursive: true, force: true });
    }
  });
}


// The observed Taleo page is registration, not an authenticated application.
test('Taleo observed registration gate fills known identity but pauses without inventing credentials', async () => {
  const source = 'https://phf.tbe.taleo.net/phf04/ats/careers/v2/applyRequisition?org=IFPRI&cws=43&rid=3836';
  const evidence = 'ev_3d215b3c5884e92aa637a79978cc8891de1f7d746e3a6e50ce0d04ced8efdcad';
  let submitRequests = 0;
  const server = createServer((request, response) => {
    if (request.method !== 'GET') { submitRequests++; response.end('Unexpected submission'); return; }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html lang="en"><title>Register</title><body><h1>New Applicant E-mail Registration</h1><form method="post">
      <label for="email">Email</label><input type="email" required id="email" name="email" maxlength="75">
      <label for="cwsPassword">Password</label><input required type="password" autocomplete="off" name="cwsPassword" id="cwsPassword" maxlength="30">
      <label for="cwsPassword_2">Re-type new password:</label><input required type="password" autocomplete="off" name="cwsPassword_2" id="cwsPassword_2" maxlength="30">
      <input aria-label="First Name" type="text" name="firstName" id="firstName" maxlength="30" required>
      <input aria-label="Last Name" type="text" name="lastName" id="lastName" maxlength="30" required>
      <button>Submit application</button></form></body></html>`);
  });
  const runner = new AutoApplyRunner();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  try {
    assert.match(source, /^https:\/\//); assert.match(evidence, /^ev_[a-f0-9]{64}$/);
    await runner.initBrowser(true);
    const candidate = {
      personal: { firstName: 'Synthetic', lastName: 'Candidate', email: 'fixture@example.test', country: 'India' },
      education: [], experience: [], professional: {}, workAuthorization: {}, eeo: {},
    } as unknown as CandidateExtendedProfile;
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile: candidate, submit: true, headless: false });
    const page = (runner as unknown as { page: Page }).page;
    assert.equal(report.status, 'paused_for_review');
    assert.match(report.reason!, /Login or CAPTCHA/);
    assert.equal(report.submissionAttempted, undefined);
    assert.equal(await page.locator('#email').inputValue(), candidate.personal.email);
    assert.equal(await page.locator('#firstName').inputValue(), candidate.personal.firstName);
    assert.equal(await page.locator('#lastName').inputValue(), candidate.personal.lastName);
    for (const selector of ['#cwsPassword', '#cwsPassword_2']) {
      assert.equal(await page.locator(selector).inputValue(), '');
    }
    assert.equal(submitRequests, 0);
  } finally {
    await runner.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});


// REA captured the shell; supplemental Playwright frame capture SHA-256:
// d716db42d698f0ace2a57b274f4dc44b61835d4d942f7798f597ed07ebec0803.
test('iCIMS observed embedded email gate fills email and pauses before authentication', async () => {
  const source = 'https://careers-appliedsystems.icims.com/jobs/6419/login?in_iframe=1';
  const evidence = 'ev_f41f322fe6b7edf2daf9cddefd0073628e3f6098f50a289bd1aafb2f6ef4945d';
  let submitRequests = 0;
  const server = createServer((request, response) => {
    if (request.method !== 'GET') { submitRequests++; response.end('Unexpected submission'); return; }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (request.url === '/local-login-frame') { response.end('<!doctype html><html lang="en"><title>Login</title><body><h1>Enter Your Information</h1><form method="post"><label for="email">Email</label><input type="email" id="email" name="css_loginName"><input type="submit" id="enterEmailSubmitButton" value="Continue"></form></body></html>'); return; }
    response.end(`<!doctype html><html lang="en"><title>Login</title><body>
      <a id="icims_skipLink1" href="#icims_content_iframe">Skip Branding</a>
      <span id="icims_iframe_span" role="main" aria-label="Career Portal"><iframe id="icims_content_iframe" name="icims_content_iframe" src="/local-login-frame" style="width:100%;border:none" height="603" title="iCIMS Content iFrame"></iframe></span>
    </body></html>`);
  });
  const runner = new AutoApplyRunner();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  try {
    assert.match(source, /^https:\/\//); assert.match(evidence, /^ev_[a-f0-9]{64}$/);
    await runner.initBrowser(true);
    const candidate = {
      personal: { firstName: 'Synthetic', lastName: 'Candidate', email: 'fixture@example.test', country: 'India' },
      education: [], experience: [], professional: {}, workAuthorization: {}, eeo: {},
    } as unknown as CandidateExtendedProfile;
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile: candidate, submit: true, mode: 'stealth', headless: false });
    const page = (runner as unknown as { page: Page }).page;
    assert.equal(await page.locator('#icims_content_iframe').getAttribute('title'), 'iCIMS Content iFrame');
    assert.equal(report.status, 'paused_for_review');
    assert.equal(await page.frameLocator('#icims_content_iframe').locator('#email').inputValue(), candidate.personal.email);
    assert.match(report.reason!, /Login or CAPTCHA/);
    assert.equal(report.submissionAttempted, undefined);
    assert.equal(report.receipt, undefined);
    assert.equal(submitRequests, 0);
  } finally {
    await runner.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('SuccessFactors observed sign-in fills email but leaves password and sign-in submission for review', async () => {
  const source = 'https://career5.successfactors.eu/careers?company=AZGROUPPROD&career_job_req_id=102592&career_ns=job_application';
  const evidence = 'ev_1ba29637de2b8f374623f3101eb91639ec0f5dcc3c3b14e18c510f8f0f3ece18';
  let signInRequests = 0;
  const server = createServer((request, response) => {
    if (request.method !== 'GET') { signInRequests++; response.end('Unexpected sign-in'); return; }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html lang="en"><title>Allianz Careers</title><body>
      <h1>Career Opportunities: Sign In</h1><form method="post"><table><tbody>
      <tr><td><label for="username" title="Required">Email Address:<span class="required requiredAccessible" aria-hidden="true">*</span></label></td>
      <td><input type="text" name="username" id="username" size="30" aria-label="Email Address:" aria-invalid="false" aria-describedby="signIn_EmailError" aria-required="true" maxlength="99" autocomplete="username"><span id="signIn_EmailError" style="display:none" aria-live="assertive"></span></td></tr>
      <tr><td><label for="password" title="Required">Password:<span class="required requiredAccessible" aria-hidden="true">*</span></label></td>
      <td><input type="password" name="password" id="password" aria-label="Password:" aria-describedby="signIn_PasswordError" aria-invalid="false" size="30" aria-required="true" maxlength="99" autocomplete="current-password"></td></tr>
      </tbody></table><button>Sign In</button></form>
    </body></html>`);
  });
  const runner = new AutoApplyRunner();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  try {
    assert.match(source, /^https:\/\//); assert.match(evidence, /^ev_[a-f0-9]{64}$/);
    await runner.initBrowser(true);
    const candidate = {
      personal: { firstName: 'Synthetic', lastName: 'Candidate', email: 'fixture@example.test', country: 'India' },
      education: [], experience: [], professional: {}, workAuthorization: {}, eeo: {},
    } as unknown as CandidateExtendedProfile;
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile: candidate, submit: true, headless: false });
    const page = (runner as unknown as { page: Page }).page;
    assert.equal(await page.locator('#username').inputValue(), candidate.personal.email);
    assert.equal(await page.locator('#password').inputValue(), '');
    assert.equal(report.status, 'paused_for_review');
    assert.match(report.reason!, /Login or CAPTCHA/);
    assert.equal(report.submissionAttempted, undefined);
    assert.equal(report.receipt, undefined);
    assert.equal(signInRequests, 0);
  } finally {
    await runner.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

// Oracle's live /apply/email screen, supplemental Playwright DOM SHA-256:
// d13bb9db1aa45a3e35e538fbd31a94913ac6ce2a62d3bcd05d0b617943b1f881.
test('Oracle observed email authentication gate leaves terms unknown and never advances', async () => {
  let posts = 0;
  const server = createServer((request, response) => {
    if (request.method === 'POST') { posts++; response.end('Unexpected authentication'); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<h1>Authentication screen. You don't need to have an account</h1><form method="post">
      <label for="primary-email-0">Email Address</label><input type="email" id="primary-email-0" name="primary-email" required>
      <label for="honey-pot-1">honeypot</label><input id="honey-pot-1" name="honey-pot">
      <label for="legal-disclaimer-checkbox">I agree with the terms and conditions</label><input type="checkbox" id="legal-disclaimer-checkbox" required>
      <button>Next</button></form>`);
  });
  const runner = new AutoApplyRunner();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const candidate = { personal: { firstName: 'Synthetic', lastName: 'Candidate', email: 'fixture@example.test', country: 'India' }, education: [], experience: [], professional: {}, workAuthorization: {}, eeo: {} } as unknown as CandidateExtendedProfile;
  try {
    await runner.initBrowser(true);
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/apply/email`, profile: candidate, mode: 'stealth', submit: true, headless: false });
    const page = (runner as unknown as { page: Page }).page;
    assert.equal(await page.locator('#primary-email-0').inputValue(), candidate.personal.email);
    assert.equal(await page.locator('#honey-pot-1').inputValue(), '');
    assert.equal(await page.locator('#legal-disclaimer-checkbox').isChecked(), false);
    assert.match(report.reason!, /Login or CAPTCHA/);
    assert.equal(report.submissionAttempted, undefined);
    assert.equal(posts, 0);
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
