import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AutoApplyRunner } from './runner.js';
import { chromium } from 'playwright';
import { AutoaplyQueueManager, isFreshPosting } from './autoaply.js';
import { loadProfile, validateProfile } from './profile.js';
import { prepareApplication, prepareText } from './prepare.js';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { CandidateExtendedProfile } from './types.js';
import { sha256 } from './submission.js';

const profile = {
  personal: { firstName: 'Synthetic', lastName: 'Candidate', email: 'fixture@example.test', country: 'India' },
  education: [], experience: [], professional: {}, workAuthorization: {}, eeo: {},
} as unknown as CandidateExtendedProfile;

// Includes browser startup, mandatory review dwell and receipt observation.
// These workflows verify state and duplicate prevention, not a latency target.
const CLI_TIMEOUT_MS = 120000;

test('profile import rejects coerced answers and resolves real document paths', () => {
  assert.doesNotThrow(() => validateProfile({ ...profile, qaBank: { 'Explicit consent': true, 'Previous employer': false } }));
  assert.throws(() => validateProfile({ ...profile, qaBank: { 'Invalid answer': {} } }), /text or boolean/);
  assert.throws(() => validateProfile({ ...profile, documents: { resume: true } }), /text values/);
  assert.throws(() => validateProfile({ ...profile, workAuthorization: { authorizedInCountry: 'false' } }), /boolean/);
  assert.throws(() => validateProfile({ ...profile, professional: { expectedSalary: -1 } }), /nonnegative/);
  assert.throws(() => validateProfile({ ...profile, education: [null] }), /objects/);
  const folder = mkdtempSync(path.join(tmpdir(), 'apply-profile-'));
  writeFileSync(path.join(folder, 'resume.txt'), 'Synthetic fixture resume');
  writeFileSync(path.join(folder, 'profile.json'), JSON.stringify({ ...profile, documents: { resume: 'resume.txt' } }));
  assert.equal(loadProfile(path.join(folder, 'profile.json')).documents?.resume, path.join(folder, 'resume.txt'));
});

for (const queued of [false, true]) test(`headed CLI automatically reconciles a pending submission without Enter or resubmitting, queue=${queued}`, async () => {
  let submissions = 0;
  let confirmed = false;
  const server = createServer((request, response) => {
    if (request.url === '/status') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ confirmed })); return; }
    if (request.url === '/send') { submissions++; response.end('pending'); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<form onsubmit="event.preventDefault();fetch('/send',{method:'POST'}).then(()=>document.querySelector('h1').textContent='Waiting for browser review')"><h1>Application</h1><label>Email<input type="email" required></label><button>Submit application</button></form><script>setInterval(async()=>{if((await(await fetch('/status')).json()).confirmed)document.body.innerHTML='<h1>Application submitted</h1>'},100)</script>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/`;
  const folder = mkdtempSync(path.join(tmpdir(), 'apply-cli-review-'));
  const profilePath = path.join(folder, 'profile.json');
  const catalogue = path.join(folder, 'jobs.json');
  writeFileSync(profilePath, JSON.stringify(profile));
  writeFileSync(catalogue, JSON.stringify([{ id: 'review', company: 'Synthetic', title: 'Engineer', url }]));
  const args = ['--import', 'tsx', 'src/autoapply/cli.ts', '--profile', profilePath, '--session', path.join(folder, 'session'), '--mode', 'stealth', '--headed', '--submit', ...(queued ? ['--catalog', catalogue, '--run-queue', '--max-jobs', '1'] : ['--url', url])];
  const child = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let prompted = false;
  const timer = setTimeout(() => child.kill(), CLI_TIMEOUT_MS);
  child.stdout.on('data', chunk => {
    output += chunk.toString();
    if (!prompted && output.includes('Enter to check receipt without resubmitting')) {
      prompted = true;
      confirmed = true;
    }
  });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  try {
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    assert.equal(code, 0, output.slice(-3000));
    assert.equal(prompted, true, output.slice(-3000));
    assert.equal(submissions, 1);
    assert.match(output, /"status":\s*"(?:submitted|applied)"/);
  } finally {
    clearTimeout(timer);
    child.kill();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

for (const changeIdentity of [false, true]) test(`CLI bundles missing answers and reloads the same candidate profile, identity change=${changeIdentity}`, async () => {
  let submissions = 0;
  const server = createServer((request, response) => {
    if (request.method === 'POST') { submissions++; response.end('ok'); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<form onsubmit="event.preventDefault();fetch('/send',{method:'POST'}).then(()=>document.body.innerHTML='<h1>Application submitted</h1>')"><label>Employer question alpha<input required></label><label>Employer question beta<input required></label><button>Submit application</button></form>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const folder = mkdtempSync(path.join(tmpdir(), 'apply-profile-review-'));
  const profilePath = path.join(folder, 'profile.json');
  writeFileSync(profilePath, JSON.stringify(profile));
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/autoapply/cli.ts', '--url', `http://127.0.0.1:${address.port}/`, '--profile', profilePath, '--session', path.join(folder, 'session'), '--mode', 'stealth', '--headed', '--submit'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let updated = false;
  const timer = setTimeout(() => child.kill(), CLI_TIMEOUT_MS);
  child.stdout.on('data', chunk => {
    output += chunk.toString();
    if (!updated && output.includes('Enter to continue, q to save and close')) {
      updated = true;
      writeFileSync(profilePath, JSON.stringify({ ...profile, personal: { ...profile.personal, email: changeIdentity ? 'other@example.test' : profile.personal.email }, answers: [{ scope: 'EMPLOYER_SCOPED', employerKey: 'http://127.0.0.1:' + address.port, question: 'Employer question alpha', value: 'Confirmed alpha' }, { scope: 'EMPLOYER_SCOPED', employerKey: 'http://127.0.0.1:' + address.port, question: 'Employer question beta', value: 'Confirmed beta' }] }));
      child.stdin.write('\n');
    }
  });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  try {
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    assert.equal(updated, true, output.slice(-3000));
    assert.match(output, /Required answers:\n- Employer question alpha\n- Employer question beta/);
    assert.equal(code, changeIdentity ? 1 : 0, output.slice(-3000));
    assert.equal(submissions, changeIdentity ? 0 : 1);
    if (changeIdentity) assert.match(output, /Candidate email changed during review/);
  } finally { clearTimeout(timer); child.kill(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('application drafts preserve candidate facts and generate a real PDF without invented skills', async () => {
  const candidate = { ...profile, skills: ['TypeScript', 'Go', 'C++'], experience: [{ title: 'Intern', company: 'Known Employer', description: 'Built TypeScript tools' }] };
  const brief = { title: 'Engineer', company: 'Target Employer', text: 'TypeScript and C++ for ongoing work' };
  const drafted = prepareText(candidate, brief);
  assert.deepEqual(drafted.matchingSkills, ['TypeScript', 'C++']);
  assert(drafted.resume.includes('Known Employer'));
  assert(!drafted.coverLetter.includes('IIT'));
  const output = path.join(mkdtempSync(path.join(tmpdir(), 'apply-drafts-')), 'drafts');
  await prepareApplication(candidate, brief, output);
  assert.equal(readFileSync(path.join(output, 'resume.pdf')).subarray(0, 4).toString(), '%PDF');
  assert.equal(loadProfile(path.join(output, 'profile.json')).coverLetterText, drafted.coverLetter);
  await assert.rejects(prepareApplication(candidate, brief, output), /exist/i);
});

test('durable SQLite queue deduplicates, permits concurrent intake, recovers and retains receipts', async () => {
  const statePath = path.join(mkdtempSync(path.join(tmpdir(), 'apply-queue-')), 'queue.json');
  let queue = new AutoaplyQueueManager({ statePath, candidateId: 'fixture' });
  const item = { externalJobId: '1', title: 'Engineer', company: 'Synthetic', jobUrl: 'https://example.test/job?utm_source=one', postedAt: new Date().toISOString() };
  const job = queue.enqueue(item);
  assert.equal(queue.enqueue({ ...item, jobUrl: 'https://example.test/job?utm_source=two' }).id, job.id);
  const observer = new AutoaplyQueueManager({ statePath, candidateId: 'fixture' });
  assert.equal(observer.list().length, 1);
  observer.close();
  queue.markApplying(job.id);
  queue.close();
  queue = new AutoaplyQueueManager({ statePath, candidateId: 'fixture' });
  assert.equal(queue.list()[0]?.status, 'paused_for_review');
  queue.retryReviewed(job.id);
  const receipt = { url: 'https://example.test/confirmation', text: 'Application submitted', verifiedAt: new Date().toISOString() };
  await queue.processNext({ run: async () => ({ status: 'submitted', fieldsFilled: 1, unmappedFields: 0, receipt }) }, profile, 'stealth', false, true);
  queue.close();
  queue = new AutoaplyQueueManager({ statePath, candidateId: 'fixture' });
  assert.equal(queue.getMetrics().totalApplied, 1);
  assert.deepEqual(queue.list()[0]?.receipt, receipt);
  const bytes = JSON.stringify(queue.list());
  queue.enqueue({ ...item, jobUrl: 'https://example.test/other' });
  const beforeDry = JSON.stringify(queue.list());
  await queue.runContinuousLoop({ run: async () => ({ status: 'paused_for_review', fieldsFilled: 0, unmappedFields: 0 }) }, profile, { dryRun: true, interJobDelayMs: 0 });
  assert.equal(JSON.stringify(queue.list()), beforeDry);
  queue.close();
  assert.throws(() => new AutoaplyQueueManager({ statePath, candidateId: 'different' }), /different candidate/);
  const corrupt = path.join(path.dirname(statePath), 'corrupt.json');
  writeFileSync(corrupt, '{broken');
  assert.throws(() => new AutoaplyQueueManager({ statePath: corrupt, candidateId: 'fixture' }));
  assert.equal(readFileSync(corrupt, 'utf8'), '{broken');
  assert(bytes.includes('Application submitted'));
  assert.equal(isFreshPosting('not-a-date'), false);
  assert.equal(isFreshPosting(new Date(Date.now() + 60000)), false);
});

test('browser submits only after valid upload, verifies receipt, preserves session and stops ambiguous retries', async () => {
  let submissions = 0;
  let uploadBody = '';
  const server = createServer((req, res) => {
    if (req.url === '/send') {
      req.on('data', chunk => { uploadBody += chunk.toString(); });
      req.on('end', () => { submissions++; res.end('ok'); });
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/required-widget') { res.end(`<button role="combobox" aria-label="Country" aria-required="true" onclick="document.querySelector('[role=option]').hidden=false">Choose</button><div role="option" hidden>United States</div><button onclick="document.body.innerHTML='<h1>Application submitted</h1>'">Submit application</button>`); return; }
    if (req.url === '/wizard') { res.end(`<h1>First step</h1><button onclick="document.querySelector('h1').textContent='Second step';this.onclick=()=>{document.querySelector('h1').textContent='Third step'}">Next</button>`); return; }
    if (req.url === '/login') { res.end('<label>Password<input type="password"></label>'); return; }
    if (req.url === '/stuck') { res.end('<button>Next</button>'); return; }
    if (req.url === '/unknown') { res.end('<label>Required secret question<input required></label><button onclick="document.body.innerHTML=\'<h1>Application submitted</h1>\'">Submit application</button>'); return; }
    if (req.url === '/unconfirmed') { res.end('<button onclick="this.disabled=true">Submit application</button>'); return; }
    res.end(`<form onsubmit="event.preventDefault();fetch('/send',{method:'POST',body:new FormData(this)}).then(()=>document.body.innerHTML='<h1>Application submitted</h1>')">
      <label>Email<input name="email" required type="email"></label>
      <label>Resume<input name="resume" type="file" required></label>
      <button>Submit application</button></form>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const folder = mkdtempSync(path.join(tmpdir(), 'apply-browser-'));
  const resume = path.join(folder, 'resume.txt'); writeFileSync(resume, 'Synthetic fixture resume');
  const candidate = { ...profile, documents: { resume } };
  const runner = new AutoApplyRunner();
  const page = () => (runner as unknown as { page: import('playwright').Page }).page;
  try {
    const inspected = await runner.run({ url: base, profile: candidate, dryRun: true, submit: true });
    assert.equal(inspected.fieldsFilled, 0); assert.equal(submissions, 0);
    const sessionDir = path.join(folder, 'session');
    await runner.initBrowser(true, sessionDir);
    const review = await runner.run({ url: base, profile: candidate, headless: false, sessionDir });
    assert.equal(review.status, 'paused_for_review');
    assert.equal(await page().locator('[type=file]').evaluate(el => (el as HTMLInputElement).files?.[0]?.name), 'resume.txt');
    await page().evaluate('localStorage.setItem("fixture-login", "present")');
    await runner.close();
    await runner.initBrowser(true, sessionDir);
    const submitted = await runner.run({ url: base, profile: candidate, submit: true, resume: true, sessionDir, headless: false });
    assert.equal(submitted.status, 'submitted'); assert(submitted.receipt?.text.includes('Application submitted'));
    assert.equal(await page().evaluate('localStorage.getItem("fixture-login")'), 'present');
    assert.equal(submissions, 1); assert(uploadBody.includes('Synthetic fixture resume'));
    assert(submitted.evidenceDir);
    const payload = JSON.parse(readFileSync(path.join(submitted.evidenceDir, 'submitted_payload.json'), 'utf8'));
    assert(payload.documents.some((document: { sha256: string }) => document.sha256 === sha256('Synthetic fixture resume')));
    const duplicate = await runner.run({ url: base, profile: candidate, submit: true, sessionDir, headless: false });
    assert.equal(duplicate.status, 'submitted'); assert.equal(submissions, 1);
    const profilePath = path.join(folder, 'candidate.json');
    const cataloguePath = path.join(folder, 'jobs.json');
    const queuePath = path.join(folder, 'batch.json');
    writeFileSync(profilePath, JSON.stringify(candidate));
    writeFileSync(cataloguePath, JSON.stringify([{ id: 'fixture-job', title: 'Engineer', company: 'Synthetic', url: base, postedAt: new Date().toISOString() }]));
    const args = ['--import', 'tsx', 'src/autoapply/cli.ts', '--catalog', cataloguePath, '--profile', profilePath, '--queue', queuePath, '--session', path.join(folder, 'batch-session'), '--run-queue', '--mode', 'stealth', '--submit', '--max-jobs', '1'];
    await promisify(execFile)(process.execPath, args, { timeout: CLI_TIMEOUT_MS });
    const verifiedQueue = new AutoaplyQueueManager({ statePath: queuePath, candidateId: (await import('node:crypto')).createHash('sha256').update(candidate.personal.email).digest('hex').slice(0, 20) });
    assert.equal(verifiedQueue.list()[0]?.status, 'applied');
    verifiedQueue.close();
    assert.equal(submissions, 2);
    await promisify(execFile)(process.execPath, args, { timeout: CLI_TIMEOUT_MS });
    assert.equal(submissions, 2);
    const unknown = await runner.run({ url: base + '/unknown', profile: candidate, submit: true, headless: false });
    assert.equal(unknown.status, 'paused_for_review'); assert.equal(unknown.submissionAttempted, undefined);
    const unconfirmed = await runner.run({ url: base + '/unconfirmed', profile: candidate, submit: true, headless: false, timeoutMs: 200, sessionDir: path.join(folder, 'ambiguous') });
    assert.equal(unconfirmed.status, 'paused_for_review'); assert.equal(unconfirmed.submissionAttempted, true);
    const repeated = await runner.run({ url: base + '/unconfirmed', profile: candidate, submit: true, headless: false, sessionDir: path.join(folder, 'ambiguous') });
    assert.equal(repeated.submissionAttempted, true); assert.match(repeated.reason!, /previous submit/);
    await page().goto(base + '/unconfirmed/confirmation');
    await page().setContent("<h1>Thank you for your interest</h1><p>We've received your application.</p>");
    const reconciled = await runner.run({ url: base + '/unconfirmed', profile: candidate, submit: true, resume: true, headless: false, sessionDir: path.join(folder, 'ambiguous') });
    assert.equal(reconciled.status, 'submitted');
    assert.equal(reconciled.receipt?.text, "We've received your application.");
    await page().setContent('<h1>Application</h1><p>You have already applied to this position.</p><button>Submit application</button>');
    const beforeExisting = submissions;
    const existing = await runner.run({ url: base + '/unconfirmed/confirmation', profile: candidate, submit: true, resume: true, headless: false });
    assert.equal(existing.status, 'submitted');
    assert.equal(existing.receipt?.existing, true);
    assert.equal(existing.submissionAttempted, undefined);
    assert.equal(submissions, beforeExisting);
    const login = await runner.run({ url: base + '/login', profile: candidate, headless: false });
    assert.match(login.reason!, /Login or CAPTCHA/);
    const stuck = await runner.run({ url: base + '/stuck', profile: candidate, mode: 'stealth', headless: false, timeoutMs: 200 });
    assert.match(stuck.reason!, /did not change/);
    const unmatched = await runner.run({ url: base + '/required-widget', profile: candidate, submit: true, headless: false });
    assert.equal(unmatched.submissionAttempted, undefined);
    assert.match(unmatched.reason!, /field errors/);
    const wizardUrl = base + '/wizard';
    await runner.run({ url: wizardUrl, profile: candidate, headless: false });
    assert.equal(await page().locator('h1').innerText(), 'First step');
    const advanced = await runner.run({ url: wizardUrl, profile: candidate, headless: false, resume: true, advanceReviewedStep: true });
    assert.equal(await page().locator('h1').innerText(), 'Second step');
    assert.match(advanced.reason!, /Review before advancing/);
  } finally {
    await runner.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('repeated histories, custom widgets and cross-origin iframe fields retain their own values', async () => {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/frame') {
      res.end('<label>Email<input name="email"></label>'); return;
    }
    res.end(`<iframe src="http://localhost:${(server.address() as import('node:net').AddressInfo).port}/frame"></iframe>
      <fieldset><legend>Education</legend><label>School<input name="school-0"></label></fieldset>
      <button onclick="const f=document.querySelector('fieldset').cloneNode(true);f.querySelector('input').name='school-1';document.querySelector('fieldset').after(f)">Add education</button>
      <fieldset><legend>Work experience</legend><label>Job title<input name="title"></label><label>Company<input name="company"></label></fieldset>
      <button role="combobox" aria-label="Country" onclick="document.querySelector('#choices').hidden=false">Choose country</button>
      <div id="choices" hidden><div role="option">Not India</div><div role="option" onclick="document.querySelector('[role=combobox]').textContent=this.textContent;this.parentElement.hidden=true">India</div></div>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  const candidate = { ...profile, education: [{ school: 'First School', degree: 'BE', fieldOfStudy: 'CSE' }, { school: 'Second School', degree: 'MS', fieldOfStudy: 'CSE' }], experience: [{ title: 'Intern', company: 'Synthetic Employer' }] };
  try {
    await runner.initBrowser(true);
    const result = await runner.run({ url: `http://127.0.0.1:${address.port}`, profile: candidate, headless: false });
    assert.equal(result.status, 'paused_for_review');
    const page = (runner as unknown as { page: import('playwright').Page }).page;
    assert.equal(await page.locator('[name=school-0]').inputValue(), 'First School');
    assert.equal(await page.locator('[name=school-1]').inputValue(), 'Second School');
    assert.equal(await page.locator('[name=title]').inputValue(), 'Intern');
    assert.equal(await page.locator('[name=company]').inputValue(), 'Synthetic Employer');
    assert.equal(await page.frameLocator('iframe').locator('[name=email]').inputValue(), profile.personal.email);
    assert.equal(await page.locator('[role=combobox]').textContent(), 'India');
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('extension editor saves zero and unknown answers and uploads actual document bytes', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    const html = readFileSync('extension/sidepanel/sidepanel.html', 'utf8').replace(/<script[^>]*src=[^>]*><\/script>/g, '');
    await page.setContent(html);
    await page.addScriptTag({ content: `window.alert=function(){};window.chrome={runtime:{},tabs:{query:function(options, callback){callback([])}},storage:{local:{get:function(key,callback){setTimeout(function(){callback({profile:${JSON.stringify(profile)}})},0)},set:function(value,callback){window.savedProfile=value.profile;callback()}}}};` });
    await page.addScriptTag({ path: 'extension/sidepanel/sidepanel.js' });
    await page.evaluate('document.dispatchEvent(new Event("DOMContentLoaded"))');
    await page.waitForFunction('document.querySelector("#prof-email").value === "fixture@example.test"');
    await page.locator('#prof-yoe').fill('0');
    await page.locator('#prof-relocate').selectOption('false');
    await page.locator('input[data-key="resume"]').setInputFiles({ name: 'resume.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic uploaded resume') });
    await page.getByText('resume.txt', { exact: true }).waitFor();
    await page.locator('#save-profile-btn').click();
    const saved = await page.evaluate('window.savedProfile') as CandidateExtendedProfile & { documentUploads: Record<string, { base64: string }> };
    assert.equal(saved.professional.totalYearsExperience, 0);
    assert.equal(saved.professional.willingToRelocate, false);
    assert.equal(saved.workAuthorization.authorizedInCountry, undefined);
    assert.equal(saved.eeo.raceOrEthnicity, '');
    assert.deepEqual(saved.qaBank, {});
    assert.deepEqual(saved.education, []);
    assert.equal(Buffer.from(saved.documentUploads.resume!.base64, 'base64').toString(), 'Synthetic uploaded resume');
    await page.setContent('<label>Resume<input type="file" name="resume"></label>');
    await page.addScriptTag({ content: 'window.chrome.runtime.onMessage={addListener:function(listener){window.listener=listener}};' });
    await page.addScriptTag({ path: 'extension/content/content.js' });
    await page.evaluate(candidate => new Promise<void>(resolve => {
      (window as unknown as { listener: Function }).listener({ type: 'AUTOFILL_FORM', profile: candidate }, {}, () => resolve());
    }), saved);
    assert.equal(await page.locator('[type=file]').evaluate(el => (el as HTMLInputElement).files?.[0]?.name), 'resume.txt');
  } finally { await browser.close(); }
});

test('candidate browser sign-in persists across independent application checkpoints', async () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'apply-shared-session-'));
  const browserProfileDir = path.join(folder, 'browser');
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/session') { response.setHeader('Set-Cookie', 'fixture-auth=1; Max-Age=3600; HttpOnly; SameSite=Lax'); response.end('Signed in'); return; }
    response.end(request.headers.cookie?.includes('fixture-auth=1') ? '<label>Email<input type="email" name="email" required></label><button>Submit application</button>' : '<label>Password<input type="password" required></label>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true, undefined, browserProfileDir);
    await (runner as unknown as { page: import('playwright').Page }).page.goto(base + '/session');
    await runner.close();
    for (const name of ['first', 'second']) {
      const sessionDir = path.join(folder, name);
      const report = await runner.run({ url: base + '/' + name, profile, browserProfileDir, sessionDir });
      assert.equal(report.fieldsFilled, 1);
      assert.match(report.reason!, /Ready for submission review/);
      assert.equal(JSON.parse(readFileSync(path.join(sessionDir, 'checkpoint.json'), 'utf8')).applicationUrl, base + '/' + name);
    }
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('queue deduplicates known ATS detail and application URL variants', () => {
  for (const [detail, application] of [
    ['https://jobs.ashbyhq.com/fixture/123', 'https://jobs.ashbyhq.com/fixture/123/application'],
    ['https://jobs.lever.co/fixture/123', 'https://jobs.lever.co/fixture/123/apply'],
    ['https://job-boards.greenhouse.io/fixture/jobs/123', 'https://job-boards.greenhouse.io/fixture/jobs/123?gh_jid=123'],
    ['https://apply.workable.com/j/ABC123', 'https://apply.workable.com/fixture/j/ABC123/apply/'],
    ['https://fixture.wd1.myworkdayjobs.com/en-US/Careers/job/India/Engineer_123', 'https://fixture.wd1.myworkdayjobs.com/en-US/Careers/job/India/Engineer_123/apply/applyManually'],
  ] as const) {
    const queue = new AutoaplyQueueManager();
    const item = { externalJobId: 'fixture', title: 'Engineer', company: 'Fixture', postedAt: '' };
    assert.equal(queue.enqueue({ ...item, jobUrl: detail }).id, queue.enqueue({ ...item, jobUrl: application }).id);
    assert.equal(queue.list().length, 1);
  }
});

