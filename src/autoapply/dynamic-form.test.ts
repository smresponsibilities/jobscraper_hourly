import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import type { Page } from 'patchright';
import { AutoApplyRunner } from './runner.js';
import type { CandidateExtendedProfile } from './types.js';
import { sanitizedDocument } from './evidence.js';
import { CredentialVault } from './vault.js';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('unchanged step stops after one dispatch without looping', async () => {
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const page = (runner as unknown as { page: Page }).page;
    await page.goto('data:text/html,fixture');
    await page.setContent('<h1>Application</h1><button onclick="document.body.dataset.clicks=String(Number(document.body.dataset.clicks||0)+1)">Next</button>');
    const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
    const report = await runner.run({ url: 'https://fixture.example/', profile, resume: true, advanceReviewedStep: true, maxSteps: 1, timeoutMs: 200, headless: false });
    assert.equal(report.reason, 'Next did not change the form');
    assert.equal(await page.locator('body').getAttribute('data-clicks'), '1');
  } finally { await runner.close(); }
});

test('late Workday-style apply link enters the form without submitting', async () => {
  let posts = 0;
  const server = createServer((request, response) => {
    if (request.method === 'POST') { posts++; response.end('unexpected'); return; }
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/apply') response.end('<form><label>Email<input type="email" required></label><button type="submit">Submit application</button></form>');
    else response.end('<button>Sign In</button><script>setTimeout(() => document.body.insertAdjacentHTML("beforeend", \'<a role="button" href="/apply">Apply</a>\'), 600)</script>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
  let reservations = 0;
  try {
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile, submit: false, timeoutMs: 250, reserveSubmission: () => { reservations++; return true; } });
    assert.equal(report.reason, 'Ready for submission review; use --submit to send');
    assert(report.fieldsFound > 0);
    assert.equal(reservations, 0);
    assert.equal(posts, 0);
  } finally { await runner.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('required cover letter uses supplied facts to prepare a PDF', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'cover-letter-'));
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<label>Cover Letter<input type=file accept=".pdf" required></label><button>Submit application</button>'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  try {
    const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [{ company: 'Fixture', title: 'Apprentice' }], skills: ['Python'] } as unknown as CandidateExtendedProfile;
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile, sessionDir: directory, applicationBrief: { company: 'Fixture', title: 'Engineer', text: 'Python development' }, submit: false, headless: false });
    assert.match(report.reason || '', /Ready for submission review/);
    const pdf = readdirSync(directory).find(name => /^cover-letter-.*\.pdf$/.test(name));
    assert(pdf);
    assert.equal(readFileSync(path.join(directory, pdf)).subarray(0, 4).toString(), '%PDF');
    assert.equal(await (runner as unknown as { page: Page }).page.locator('input[type=file]').evaluate(el => (el as HTMLInputElement).files?.length), 1);
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('daily limit prevents the submit click', async () => {
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const page = (runner as unknown as { page: Page }).page;
    await page.goto('data:text/html,fixture');
    await page.setContent('<label>Email<input type="email" required></label><button onclick="document.body.dataset.submitted=\'yes\'">Submit application</button>');
    const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
    const report = await runner.run({ url: 'https://fixture.example/', profile, resume: true, submit: true, headless: false, reserveSubmission: () => false });
    assert.equal(report.reason, 'Daily submission limit reached');
    assert.equal(!!report.submissionAttempted, false);
    assert.equal(await page.locator('body').getAttribute('data-submitted'), null);
  } finally { await runner.close(); }
});

test('a control removed between lookup and inspection is reacquired on the next scan', async () => {
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const page = (runner as unknown as { page: Page }).page;
    await page.goto('data:text/html,fixture');
    await page.setContent('<label>Email<input id=email type=email required></label><button>Submit application</button>');
    const frame = page.mainFrame(); const locate = frame.locator.bind(frame); let replaced = false;
    frame.locator = (selector, options) => {
      const control = locate(selector, options);
      if (selector.startsWith('[data-autoapply-control=')) {
        const evaluate = control.evaluate.bind(control);
        control.evaluate = (async (fn, arg) => {
          if (!replaced) {
            replaced = true;
            await page.locator('#email').evaluate(element => { const replacement = element.cloneNode(true) as Element; replacement.removeAttribute('data-autoapply-control'); element.replaceWith(replacement); });
          }
          return evaluate(fn as never, arg);
        }) as typeof control.evaluate;
      }
      return control;
    };
    const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
    const report = await runner.run({ url: 'https://fixture.example/', profile, resume: true, submit: false, headless: false });
    assert.equal(replaced, true);
    assert.match(report.reason || '', /Ready for submission review/);
    assert.equal(await page.locator('#email').inputValue(), profile.personal.email);
    assert.equal(!!report.submissionAttempted, false);
  } finally { await runner.close(); }
});

test('a pending form response parks automatically and resumes only after its dependent field arrives', { timeout: 60000 }, async () => {
  let release: (() => void) | undefined;
  const server = createServer((request, response) => {
    if (request.url === '/slow') { release = () => response.end('ready'); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end('<label>Email<input type=email required onblur="if(!document.querySelector(\'#city\'))fetch(\'/slow\').then(()=>document.querySelector(\'#dependent\').innerHTML=\'<label>Current city<input id=city required></label>\')"></label><div id=dependent></div><button>Submit application</button>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', city: 'Bengaluru', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
    const options = { url: `http://127.0.0.1:${address.port}/`, profile, submit: false, headless: false };
    const paused = await runner.run(options);
    assert.equal(paused.status, 'paused_for_review');
    assert.equal(paused.reviewKind, 'network');
    assert.equal(await runner.reviewReady(paused, options), false);
    assert.equal(!!paused.submissionAttempted, false);
    assert(release); release();
    const deadline = Date.now() + 5000;
    while (!await runner.reviewReady(paused, options) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(await runner.reviewReady(paused, options), true);
    const resumed = await runner.run({ ...options, resume: true, preserveReviewedValues: true });
    assert.match(resumed.reason || '', /Ready for submission review/);
    assert.equal(await (runner as unknown as { page: Page }).page.locator('#city').inputValue(), 'Bengaluru');
  } finally { release?.(); await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('Workday waits for the disabled footer to finish loading after progress changes', async () => {
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(`<div data-automation-id=progressBarActiveStep>My Information</div><div id=field data-automation-id=formField-email><label>Email<input type=email required></label></div><button data-automation-id=pageFooterNextButton onclick="document.querySelector('[data-automation-id=progressBarActiveStep]').textContent='My Experience';this.disabled=true;setTimeout(()=>{document.querySelector('#field').innerHTML='<label>Current city<input id=city required></label>';this.disabled=false},400)">Save and Continue</button>`); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile, advanceReviewedStep: true, maxSteps: 1, headless: false });
    const page = (runner as unknown as { page: Page }).page;
    assert.equal(await page.locator('#city').count(), 1);
    assert.equal(await page.locator('[data-automation-id=pageFooterNextButton]').isEnabled(), true);
    assert.equal(!!report.submissionAttempted, false);
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('an owned Workday click overlay receives exactly one native click', async () => {
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const page = (runner as unknown as { page: Page }).page;
    await page.setContent('<div style="position:relative;width:180px;height:50px"><button style="width:180px;height:50px">Next</button><div data-automation-id="click_filter" style="position:absolute;inset:0" onclick="document.documentElement.dataset.clicks=String(Number(document.documentElement.dataset.clicks||0)+1)"></div></div>');
    await (runner as unknown as { pacedClick: (control: ReturnType<Page['locator']>) => Promise<void> }).pacedClick(page.getByRole('button', { name: 'Next' }));
    assert.equal(await page.locator('html').getAttribute('data-clicks'), '1');
  } finally { await runner.close(); }
});

test('hidden shadow hosts stay excluded while visible shadow-root labels resolve', async () => {
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const page = (runner as unknown as { page: Page }).page;
    await page.goto('data:text/html,fixture');
    await page.setContent('<div id=hidden style="opacity:0"></div><div id=visible></div><script>for(const id of ["hidden","visible"])document.getElementById(id).attachShadow({mode:"open"}).innerHTML=`<span id=label>Email</span><input id=${id}-email aria-labelledby=label>`</script><button>Submit application</button>');
    const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
    const report = await runner.run({ url: 'https://fixture.example/', profile, resume: true, submit: false, headless: false });
    assert.match(report.reason || '', /Ready for submission review/);
    assert.equal(await page.locator('#visible-email').inputValue(), profile.personal.email);
    assert.equal(await page.locator('#hidden-email').inputValue(), '');
  } finally { await runner.close(); }
});

for (const scoped of [true, false]) test(`Workday source hierarchy selects a company leaf, scoped=${scoped}`, async () => {
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(`<div data-automation-id="formField-source"><label for=source>How Did You Hear About Us?</label><input id=source data-uxi-widget-type=selectinput aria-required=true onclick="document.querySelector('#prompt').hidden=false" onkeydown="if(event.key==='Enter'){event.preventDefault();document.querySelector('#list').innerHTML=this.value?'':'<div role=option onclick=category()>Website</div>'}"><span id=selected></span><div id=prompt data-automation-id=responsiveMonikerPrompt hidden><div id=list data-automation-id=activeListContainer></div><input aria-label=Email id=popup-search></div></div><div data-automation-id="formField-email"><label>Email<input id=email type=email required></label><label>Email<input data-automation-id=beecatcher id=trap></label></div><button>Submit application</button><script>function category(){document.querySelector('#list').innerHTML='<div role=option onclick=choose()>Fixture Careers Website</div><div role=option>Unrelated employer</div>'}function choose(){document.querySelector('#selected').innerHTML='<span data-automation-id=selectedItem>Fixture Careers Website</span>';document.querySelector('#source').value='';document.querySelector('#prompt').hidden=true}</script>`); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [], referralSources: ['Careers Website', 'Website', 'LinkedIn'], answers: scoped ? [{ scope: 'EMPLOYER_SCOPED', employerKey: 'workday:fixture', question: 'How Did You Hear About Us?', value: 'Fixture Careers Website' }] : [] } as unknown as CandidateExtendedProfile;
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile, company: 'Fixture', submit: false, headless: false, requisition: { provider: 'workday', tenant: 'fixture', jobId: '1', key: 'workday:fixture:1' } });
    const page = (runner as unknown as { page: Page }).page;
    assert.match(report.reason || '', /Ready for submission review/, JSON.stringify(report.actions));
    assert.equal(await page.locator('#selected').innerText(), 'Fixture Careers Website');
    assert.equal(await page.locator('#email').inputValue(), profile.personal.email);
    assert.equal(await page.locator('#popup-search').inputValue(), '');
    assert.equal(await page.locator('#trap').inputValue(), '');
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('a remounting field exhausts two attempts while other known fields still fill', async () => {
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(`<label>Email<input id=email type=email required onblur="document.documentElement.dataset.attempts=String(Number(document.documentElement.dataset.attempts||0)+1);const replacement=this.cloneNode();replacement.removeAttribute('data-autoapply-control');this.replaceWith(replacement);document.querySelector('#email').value=''"></label><label>Current city<input id=city required></label><button>Submit application</button>`); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', city: 'Bengaluru', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile, submit: false, headless: false });
    const page = (runner as unknown as { page: Page }).page;
    assert.equal(await page.locator('html').getAttribute('data-attempts'), '2');
    assert.equal(await page.locator('#city').inputValue(), 'Bengaluru');
    assert(report.actions.some(action => action.error?.includes('attempt limit')));
    assert.equal(!!report.submissionAttempted, false);
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('transparent native radios with visible labels remain usable while hidden groups stay excluded', async () => {
  const runner = new AutoApplyRunner();
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<fieldset><legend>Willing to relocate?</legend><label for=yes>Yes</label><input style="opacity:0" type=radio id=yes name=relocate value=yes><label for=no>No</label><input style="opacity:0" type=radio id=no name=relocate value=no></fieldset><fieldset style="opacity:0"><legend>Willing to relocate?</legend><label for=trap>Yes</label><input type=radio id=trap name=trap value=yes></fieldset><button>Submit application</button>'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  try {
    await runner.initBrowser(true);
    const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: { willingToRelocate: true }, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile, submit: false, applicationCountry: 'India' });
    assert(report.actions.some(action => action.status === 'filled' && action.selector === 'yes'), JSON.stringify(report.actions));
    assert(!report.actions.some(action => action.selector === 'trap'));
    assert.equal(!!report.submissionAttempted, false);
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('an expired Workday apply route re-enters its approved posting without submitting', async () => {
  const runner = new AutoApplyRunner();
  const posting = 'https://fixture.wd3.myworkdayjobs.com/en-US/careers/job/India/Engineer_JR123';
  let postingVisits = 0;
  try {
    await runner.initBrowser(true);
    const page = (runner as unknown as { page: Page }).page;
    await page.route('**/*', route => {
      const shell = route.request().url().includes('/apply/');
      if (!shell) postingVisits++;
      return route.fulfill({ contentType: 'text/html', body: shell ? '<header><button data-automation-id="utilityButtonSignIn">Sign In</button></header>' : '<main><div data-automation-id="formField-email"><label>Email<input type="email" required></label></div><button>Submit application</button></main>' });
    });
    await page.goto(posting + '/apply/applyManually');
    const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
    const report = await runner.run({ url: posting, profile, resume: true, submit: false, maxSteps: 1, timeoutMs: 100 });
    assert.equal(postingVisits, 1);
    assert(report.actions.some(action => action.status === 'filled' && action.value === profile.personal.email));
    assert.equal(!!report.submissionAttempted, false);
    assert.match(report.reason || '', /Ready for submission review/);
  } finally { await runner.close(); }
});

test('a visually toggled custom radio without retained state cannot pass validation', async () => {
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<div id=q>Willing to relocate?</div><div role=radiogroup aria-labelledby=q aria-required=true><div role=radio aria-checked=false>Yes</div><div role=radio aria-checked=false onclick="this.style.backgroundColor=\'green\'">No</div></div><button>Submit application</button>'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: { willingToRelocate: false }, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile, headless: false, applicationCountry: 'India' });
    assert.equal(report.reviewKind, 'answers');
    assert(report.actions.some(action => action.error === 'Radio option did not retain selection'));
    assert.equal(report.submissionAttempted, undefined);
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('invisible traps stay empty while visible fields and custom radio state are filled', async () => {
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(`<form><label>First name<input id=visible name=firstName></label><div style="opacity:0"><label>First name<input id=transparent></label></div><label style="position:absolute;left:-9999px">First name<input id=offscreen></label><label style="display:none">First name<input id=hidden></label><label>Enter website. This input is for robots only, do not enter if you're human.<input id=robot></label><div id=q>Willing to relocate?</div><div role=radiogroup aria-labelledby=q aria-required=true><div id=yes role=radio aria-checked=false onpointerdown="document.documentElement.dataset.pointer=1" onclick="this.setAttribute('aria-checked','true');document.querySelector('#no').setAttribute('aria-checked','false')">Yes</div><div id=no role=radio aria-checked=false>No</div></div><label style="position:fixed;top:0;right:0">Current city<input id=fixed></label><label style="display:block;margin-top:2000px">Email<input id=below type=email></label><button>Submit application</button></form>`); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', city: 'Bengaluru', country: 'India', portfolioUrl: 'https://example.test' }, professional: { willingToRelocate: true }, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile, headless: false, applicationCountry: 'India' });
    assert.match(report.reason!, /Ready for submission review/, JSON.stringify(report.actions.filter(action => action.status === 'failed')));
    const page = (runner as unknown as { page: Page }).page;
    for (const id of ['transparent', 'offscreen', 'hidden', 'robot']) assert.equal(await page.locator('#' + id).inputValue(), '');
    assert.equal(await page.locator('#visible').inputValue(), 'Synthetic');
    assert.equal(await page.locator('#fixed').inputValue(), 'Bengaluru');
    assert.equal(await page.locator('#below').inputValue(), 'fixture@example.test');
    assert.equal(await page.locator('#yes').getAttribute('aria-checked'), 'true');
    assert.equal(await page.locator('html').getAttribute('data-pointer'), '1');
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('Workday selectinput searches and retains a newly chosen source without an ARIA combobox role', async () => {
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(`<div role=option data-automation-id=selectedItem>India (+91)</div><label for=source>How Did You Hear About Us?</label><div><div data-automation-id=multiSelectContainer><input id=source data-uxi-widget-type=selectinput oninput="document.querySelector('#choices').innerHTML=''" onkeydown="if(event.key==='Enter'){event.preventDefault();document.documentElement.dataset.searches=String(Number(document.documentElement.dataset.searches||0)+1);if(this.value==='Company Careers Website')setTimeout(()=>document.querySelector('#choices').innerHTML='<li role=option onclick=choose()>Company Careers Website</li>',350)}"><div id=selected></div></div></div><div data-automation-id=responsiveMonikerPrompt><div id=choices role=listbox data-automation-id=activeListContainer style="min-height:1px"></div></div><button>Submit application</button><script>document.documentElement.dataset.selections=0;function choose(){document.documentElement.dataset.selections++;document.querySelector('#selected').innerHTML='<div data-automation-id=selectedItem>Company Careers Website</div>';document.querySelector('#source').value='';document.querySelector('#choices').innerHTML='';}</script>`); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  const url = `http://127.0.0.1:${address.port}/`;
  try {
    await runner.initBrowser(true);
    const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [], answers: [{ scope: 'EMPLOYER_SCOPED', employerKey: new URL(url).origin, question: 'How Did You Hear About Us?', value: 'Company Careers Website' }] } as unknown as CandidateExtendedProfile;
    const report = await runner.run({ url, profile, headless: false, mode: 'stealth' });
    assert.match(report.reason!, /Ready for submission review/);
    const page = (runner as unknown as { page: Page }).page;
    assert.equal(await page.locator('#source').inputValue(), '');
    assert.equal(await page.locator('#selected [data-automation-id=selectedItem]').innerText(), 'Company Careers Website');
    assert.equal(await page.locator('html').getAttribute('data-selections'), '1');
    assert.equal(await page.locator('html').getAttribute('data-searches'), '1');
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('Workday selected phone-code pill survives an empty query without reopening its menu', async () => {
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<label for=phoneCode>Country Phone Code</label><div><div data-automation-id=multiSelectContainer><input id=phoneCode data-uxi-widget-type=selectinput onclick="document.documentElement.dataset.opened=1"><div><ul data-automation-id=selectedItemList><li><div role=option data-automation-id=selectedItem>India (+91)</div></li></ul></div></div></div><ul id=codes role=listbox hidden></ul><button>Submit application</button>'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India', phoneCountryCode: '+91' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile, headless: false });
    assert.match(report.reason!, /Ready for submission review/);
    assert.equal(await (runner as unknown as { page: Page }).page.locator('html').getAttribute('data-opened'), null);
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('gate inspection tolerates a removed iframe but preserves surviving login gates and real errors', async () => {
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const page = (runner as unknown as { page: Page }).page;
    await page.setContent('<input type=password><iframe srcdoc="<h1>Auxiliary frame</h1>"></iframe>');
    const frame = page.frames().find(frame => frame !== page.mainFrame()); assert(frame);
    const getByRole = frame.getByRole.bind(frame);
    frame.getByRole = ((...args: Parameters<typeof frame.getByRole>) => {
      const locator = getByRole(...args);
      const all = locator.all.bind(locator);
      locator.all = async () => { await page.locator('iframe').evaluate(element => element.remove()); return all(); };
      return locator;
    }) as typeof frame.getByRole;
    const inspect = (runner as unknown as { browserGates(): Promise<{ login: boolean; challenge: boolean }> }).browserGates.bind(runner);
    assert.deepEqual(await inspect(), { login: true, challenge: false });
    page.mainFrame().getByRole = (() => { throw new Error('Unexpected gate failure'); }) as typeof frame.getByRole;
    await assert.rejects(inspect(), /Unexpected gate failure/);
  } finally { await runner.close(); }
});

test('account fields mounted during autofill transfer to authentication before answer validation', async () => {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<label>Email<input type=email oninput="if(!document.querySelector('[type=password]'))document.querySelector('#account').innerHTML='<label>Password<input type=password required></label><label>Verify New Password<input type=password required></label><button onclick=finish()>Create Account</button>'"></label><div id=account></div><script>function finish(){const p=[...document.querySelectorAll('[type=password]')];if(p[0].value&&p[0].value===p[1].value)document.body.innerHTML='<label>First name<input name=firstName required></label><button>Submit application</button>';}</script>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  const vault = new CredentialVault(mkdtempSync(path.join(tmpdir(), 'mounted-auth-')), randomBytes(32));
  const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
  try {
    await runner.initBrowser(true);
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile, vault, headless: false, requisition: { provider: 'workday', tenant: 'fixture', jobId: '1', key: 'workday:fixture:1' } });
    assert.match(report.reason!, /Ready for submission review/);
    assert.equal(await (runner as unknown as { page: Page }).page.locator('[name=firstName]').inputValue(), 'Synthetic');
    assert(!report.actions.some(action => /password/i.test(action.question || '')));
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('conditional remounts replace stale controls and newly mounted required fields are filled before submission', async () => {
  let submissions = 0;
  const server = createServer((request, response) => {
    if (request.method === 'POST') { submissions++; response.end('ok'); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<form onsubmit="event.preventDefault();fetch('/submit',{method:'POST'}).then(()=>document.body.innerHTML='<h1>Application submitted</h1>')"><fieldset><legend>Are you authorized to work in India?</legend><label>Yes<input type="radio" name="work_authorization" value="yes" onclick="document.querySelector('#dependent').innerHTML='<label>Current city<input id=city required></label><label>Email<input id=email type=email required></label><label>Preferred office<input id=office required></label>'"></label><label>No<input type="radio" name="work_authorization" value="no"></label></fieldset><div id="dependent"><label>Email<input id="email" type="email" required></label><label>Current city<input id="city" required></label></div><button>Submit application</button></form>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/`;
  const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India', city: 'Bengaluru' }, professional: {}, workAuthorization: { authorizedInCountry: true, requiresSponsorshipNowOrFuture: false }, eeo: {}, education: [], experience: [], answers: [{ scope: 'EMPLOYER_SCOPED', employerKey: new URL(url).origin, question: 'Preferred office', value: 'Bengaluru' }] } as unknown as CandidateExtendedProfile;
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const review = await runner.run({ url, profile, applicationCountry: 'India', headless: false });
    assert.match(review.reason!, /Ready for submission review/, JSON.stringify(review.actions));
    const page = (runner as unknown as { page: Page }).page;
    assert.equal(await page.locator('#office').inputValue(), 'Bengaluru');
    assert.equal(await page.locator('#city').inputValue(), 'Bengaluru');
    assert.equal(await page.locator('#email').inputValue(), 'fixture@example.test');
    const submitted = await runner.run({ url, profile, applicationCountry: 'India', resume: true, submit: true, headless: false });
    assert.equal(submitted.status, 'submitted', submitted.reason);
    assert.equal(submissions, 1);
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('open shadow-root application fields participate in the same filling loop', async () => {
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(`<div id="host"></div><script>document.querySelector('#host').attachShadow({mode:'open'}).innerHTML='<form><label>Email<input id="email" type="email" required></label><button>Submit application</button></form>'</script>`); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile, headless: false });
    const page = (runner as unknown as { page: Page }).page;
    assert.equal(await page.locator('#email').inputValue(), profile.personal.email);
    assert.match(report.reason!, /Ready for submission review/, JSON.stringify(report.actions));
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('automatic resume cannot trust a portal-default answer; explicit owner review remains separate', async () => {
  let submissions = 0;
  const server = createServer((request, response) => {
    if (request.method === 'POST') { submissions++; response.end('accepted'); return; }
    response.setHeader('Content-Type', 'text/html'); response.end(`<form onsubmit="event.preventDefault();fetch('/applications',{method:'POST',body:'application'}).then(()=>document.body.innerHTML='<h1>Application submitted</h1>')"><label>Email<input type=email value=wrong@example.test required></label><fieldset><legend>Have you previously worked for Fixture?</legend><label>Yes<input type=radio name=prior value=yes required checked></label><label>No<input type=radio name=prior value=no></label></fieldset><button>Submit application</button></form>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
  try {
    await runner.initBrowser(true);
    const options = { url: `http://127.0.0.1:${address.port}/`, profile, headless: false, resume: true, submit: true };
    const automatic = await runner.run(options);
    assert.equal(submissions, 0); assert.equal(automatic.reviewKind, 'answers');
    const page = (runner as unknown as { page: Page }).page;
    assert.equal(await page.locator('input[type=email]').inputValue(), profile.personal.email);
    await page.locator('[name=prior][value=no]').check();
    const ownerReviewed = await runner.run({ ...options, preserveReviewedValues: true });
    assert.equal(ownerReviewed.status, 'submitted', ownerReviewed.reason);
    assert.equal(ownerReviewed.humanInterventionRequired, true); assert.equal(submissions, 1);
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('shared snapshot sanitizer removes active content, event handlers and URL credentials', async () => {
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const page = (runner as unknown as { page: Page }).page;
    await page.setContent(`<html onload="window.fixture=true" data-token="synthetic"><head><base href="https://fixture.example/"><meta http-equiv=refresh content="999;url=https://fixture.example"></head><body><h1>Application submitted</h1><script>window.fixture=true</script><iframe srcdoc="fixture"></iframe><input type=password value=synthetic-password><input type=hidden value=synthetic-token><a href="https://fixture.example/confirmation?token=synthetic-key&applicationId=123" onclick="window.fixture=true">Receipt</a></body></html>`);
    const snapshot = await page.locator('html').evaluate(sanitizedDocument);
    assert(!/<(?:script|iframe|base)\b/i.test(snapshot)); assert(!/onload=|onclick=|data-token=|synthetic-password|synthetic-key|synthetic-token/i.test(snapshot));
    assert.match(snapshot, /Content-Security-Policy/); assert.match(snapshot, /default-src 'none'/); assert.match(snapshot, /applicationId=123/);
  } finally { await runner.close(); }
});

test('dependent asynchronous response mounts required control after initial mutation quiet period', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/choices') { setTimeout(() => response.end('ready'), 800); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<form><label>Email<input type=email required onblur="if(!document.querySelector('#city'))fetch('/choices').then(()=>document.querySelector('#fields').innerHTML='<label>Current city<input id=city required></label>')"></label><div id=fields></div><button>Submit application</button></form>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India', city: 'Bengaluru' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile, headless: false });
    assert.match(report.reason!, /Ready for submission review/);
    assert.equal(await (runner as unknown as { page: Page }).page.locator('#city').inputValue(), 'Bengaluru');
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('sequential employers never share saved role answers', async () => {
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<form><label>Why do you want to work here?<textarea required></textarea></label><button>Submit application</button></form>'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [], answers: [{ scope: 'EMPLOYER_SCOPED', employerKey: 'fixture:one', question: 'Why do you want to work here?', value: 'Company One explicit answer' }] } as unknown as CandidateExtendedProfile;
  try {
    await runner.initBrowser(true);
    const first = await runner.run({ url: `http://127.0.0.1:${address.port}/one`, profile, headless: false, requisition: { provider: 'fixture', tenant: 'one', jobId: '1', key: 'fixture:one:1' } });
    assert.match(first.reason!, /Ready for submission review/);
    assert.equal(await (runner as unknown as { page: Page }).page.locator('textarea').inputValue(), 'Company One explicit answer');
    const second = await runner.run({ url: `http://127.0.0.1:${address.port}/two`, profile, headless: false, requisition: { provider: 'fixture', tenant: 'two', jobId: '2', key: 'fixture:two:2' } });
    assert.equal(await (runner as unknown as { page: Page }).page.locator('textarea').inputValue(), '');
    assert.equal(second.reviewKind, 'answers');
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('browser selects opposite authorization/sponsorship polarity and distinct Java/JavaScript years', async () => {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<form><fieldset><legend>Are you legally authorized to work in India?</legend><label>Yes<input type=radio name=authorization value=yes required></label><label>No<input type=radio name=authorization value=no></label></fieldset><fieldset><legend>Will you now or in the future require visa sponsorship to work in India?</legend><label>Yes<input type=radio name=sponsorship value=yes required></label><label>No<input type=radio name=sponsorship value=no></label></fieldset><label>Years of experience with Java?<input id=java type=number required></label><label>Years of experience with JavaScript?<input id=javascript type=number required></label><button>Submit application</button></form>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: { totalYearsExperience: 2 }, workAuthorization: { authorizedInCountry: true, requiresSponsorshipNowOrFuture: false }, skillYears: { Java: 1, JavaScript: 2 }, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
  try {
    await runner.initBrowser(true);
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile, headless: false, applicationCountry: 'India' });
    const page = (runner as unknown as { page: Page }).page;
    assert.match(report.reason!, /Ready for submission review/);
    assert.equal(await page.locator('[name=authorization][value=yes]').isChecked(), true);
    assert.equal(await page.locator('[name=sponsorship][value=no]').isChecked(), true);
    assert.equal(await page.locator('#java').inputValue(), '1');
    assert.equal(await page.locator('#javascript').inputValue(), '2');
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

for (const multi of [false, true]) test(`combobox retains selected React value with an empty search query, multi=${multi}`, async () => {
  let changes = 0;
  const server = createServer((request, response) => {
    if (request.method === 'POST') { changes++; response.end('changed'); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<form><label for=country>Country</label><div data-select-container><div class=select__control><span class="${multi ? 'select__multi-value__label' : 'select__single-value'}">India</span><input id=country role=combobox aria-controls=countries aria-autocomplete=list onclick="document.querySelector('#countries').hidden=false"></div></div><ul id=countries role=listbox hidden><li role=option onclick="fetch('/toggle',{method:'POST'});document.querySelector('span').remove()">India</li></ul><label>Email<input type=email required></label><button>Submit application</button></form>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
  try {
    await runner.initBrowser(true);
    const url = `http://127.0.0.1:${address.port}/`;
    const first = await runner.run({ url, profile, headless: false });
    assert.match(first.reason!, /Ready for submission review/);
    await runner.run({ url, profile, headless: false, resume: true });
    assert.equal(changes, 0);
    assert.equal(await (runner as unknown as { page: Page }).page.locator('span').innerText(), 'India');
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('automatic multi-select retention cannot preserve unsupported extra answers', async () => {
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<form><label for=country>Country</label><div data-select-container><div class=select__control><span class=select__multi-value__label>India</span><span class=select__multi-value__label>United States</span><input id=country role=combobox aria-controls=countries></div></div><ul id=countries role=listbox aria-multiselectable=true hidden></ul><button>Submit application</button></form>'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile, headless: false });
    assert.equal(report.reviewKind, 'answers'); assert.equal(report.humanInterventionRequired, true);
    assert(report.actions.some(action => action.error === 'Existing multi-select answers require explicit review'));
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

