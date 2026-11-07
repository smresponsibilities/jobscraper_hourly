import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runApplicationWorker } from './worker.js';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { AutoaplyQueueManager } from './autoaply.js';
import { AutoApplyRunner } from './runner.js';
import type { Page } from 'patchright';
import { setTimeout as delay } from 'node:timers/promises';

test('same-company completed applications reuse one browser owner and retain separate receipts', { timeout: 240000 }, async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'worker-company-'));
  const profileFile = path.join(directory, 'candidate.json');
  writeFileSync(profileFile, JSON.stringify({ personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] }));
  let origin = ''; const visits: string[] = []; const submissions: string[] = []; const incoming = new Map<string, string>();
  const jobs = ['a1', 'b1', 'a2'];
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/catalogue') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(jobs.map((id, index) => ({ id: `fixture:${id.startsWith('a') ? 'one' : 'two'}:${id}`, url: origin + '/' + id, title: 'Software Engineer', company: 'Same display name', location: 'Bengaluru, India', postedAt: new Date(Date.now() - index * 1000).toISOString() })))); return; }
    if (request.method === 'POST') { submissions.push(request.url!); response.end('accepted'); return; }
    const id = request.url?.slice(1) || '';
    if (jobs.includes(id) && /Chrome/.test(request.headers['user-agent'] || '')) { visits.push(id); incoming.set(id, request.headers.cookie || ''); }
    response.end(`<script type="application/ld+json">{"@type":"JobPosting","title":"Software Engineer","description":"Software development in Bengaluru, India."}</script><h1>Software Engineer</h1><script>document.cookie='tenant=${id.startsWith('a') ? 'one' : 'two'};Path=/'</script><form onsubmit="event.preventDefault();fetch('/submit/${id}',{method:'POST'}).then(()=>document.body.innerHTML='<h1>Application submitted</h1>')"><label>Email<input type=email required></label><button>Submit application</button></form>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string'); origin = `http://127.0.0.1:${address.port}`;
  const initialize = AutoApplyRunner.prototype.initBrowser;
  const launches: Array<string | undefined> = [];
  AutoApplyRunner.prototype.initBrowser = async function(...args) { launches.push(args[2]); return initialize.apply(this, args); };
  try {
    await runApplicationWorker({ profileFile, stateDir: directory, catalogueUrl: origin + '/catalogue', once: true, submit: true, headless: true, signal: AbortSignal.timeout(220000) });
    assert.deepEqual(visits, ['a1', 'a2', 'b1']);
    assert.deepEqual(submissions, ['/submit/a1', '/submit/a2', '/submit/b1']);
    assert.equal(launches.length, 2);
    assert.equal(incoming.get('a2'), 'tenant=one');
    assert.equal(incoming.get('b1'), '');
    const database = new DatabaseSync(path.join(directory, 'queue.sqlite'), { readOnly: true });
    try {
      const rows = database.prepare('SELECT payload FROM applications').all().map(row => JSON.parse(row.payload as string));
      assert.equal(rows.filter(row => row.status === 'applied').length, 3);
      assert.equal(new Set(rows.map(row => row.receipt.evidenceDir)).size, 3);
    } finally { database.close(); }
  } finally { AutoApplyRunner.prototype.initBrowser = initialize; await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('warm review steps reuse the tab and never submit despite global submission permission', { timeout: 150000 }, async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'worker-step-'));
  const file = path.join(directory, 'candidate.json');
  writeFileSync(file, JSON.stringify({ personal: { firstName: 'Synthetic', email: 'fixture@example.test', city: 'Bengaluru', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] }));
  let origin = ''; let visits = 0; let submissions = 0;
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/catalogue') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify([{ id: 'fixture:step', url: origin + '/job', title: 'Software Engineer', company: 'Fixture', location: 'Bengaluru, India' }])); return; }
    if (request.method === 'POST') { submissions++; response.end('Application received'); return; }
    if (request.url === '/job' && /Chrome/.test(request.headers['user-agent'] || '')) visits++;
    response.end(`<script type="application/ld+json">{"@type":"JobPosting","title":"Software Engineer","description":"Software development in Bengaluru, India."}</script><h1>Software Engineer</h1><p>Software development in Bengaluru, India.</p><form method="post"><div id="step"><label>Email<input type="email" required></label><button type="button" id="next">Next</button></div></form><script>let step=0;document.addEventListener('click',event=>{if(event.target.id!=='next')return;step++;document.querySelector('#step').innerHTML=step===1?'<label>City<input required></label><button type="button" id="next">Next</button>':'<p>Review application</p><button type="submit">Submit application</button>';});</script>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string'); origin = `http://127.0.0.1:${address.port}`;
  const controller = new AbortController();
  const running = runApplicationWorker({ profileFile: file, stateDir: directory, catalogueUrl: origin + '/catalogue', reviewSteps: true, submit: true, headless: true, signal: controller.signal });
  const waitFor = async (predicate: () => boolean | Promise<boolean>) => { const deadline = Date.now() + 45000; while (Date.now() < deadline) { if (await predicate()) return; await delay(200); } throw new Error('Review step did not finish'); };
  try {
    let dashboard = '';
    await waitFor(() => { try { const state = JSON.parse(readFileSync(path.join(directory, 'worker.json'), 'utf8')); dashboard = state.dashboardUrl; return state.parked.length === 1; } catch { return false; } });
    const html = await (await fetch(dashboard)).text();
    const token = JSON.parse(/const token=("[a-f0-9]{48}")/.exec(html)![1]!);
    const cards = (await (await fetch(dashboard + '/api/state')).json()).cards;
    const body = JSON.stringify({ id: cards[0].id });
    assert.equal((await fetch(dashboard + '/api/step', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 403);
    const session = path.join(directory, 'applications', readdirSync(path.join(directory, 'applications'))[0]!, 'checkpoint.json');
    const checkpoint = () => JSON.parse(readFileSync(session, 'utf8'));
    for (let index = 0; index < 2; index++) {
      const previous = checkpoint().report.endTime;
      assert.equal((await fetch(dashboard + '/api/step', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-Token': token, Origin: dashboard }, body })).status, 200);
      await waitFor(() => { const saved = checkpoint(); return saved.report.endTime && saved.report.endTime !== previous; });
      assert.equal(!!checkpoint().report.submissionAttempted, false);
    }
    assert.equal(visits, 1);
    assert.equal(submissions, 0);
    assert.match(checkpoint().report.reason, /ready|review|submit/i);
  } finally { controller.abort(); await running; await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('tenant profiles isolate local storage and cookies at the same origin and retain their own state', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'tenant-storage-'));
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<h1>Fixture</h1>'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/`;
  const first = new AutoApplyRunner(); const second = new AutoApplyRunner(); const reopened = new AutoApplyRunner();
  const pageFor = (runner: AutoApplyRunner) => (runner as unknown as { page: Page }).page;
  try {
    await first.initBrowser(true, undefined, path.join(directory, 'one'));
    await pageFor(first).goto(url);
    await pageFor(first).evaluate(() => { localStorage.setItem('tenant', 'one'); document.cookie = 'tenant=one; Max-Age=3600; Path=/'; });
    await second.initBrowser(true, undefined, path.join(directory, 'two'));
    await pageFor(second).goto(url);
    assert.deepEqual(await pageFor(second).evaluate(() => ({ stored: localStorage.getItem('tenant'), cookies: document.cookie })), { stored: null, cookies: '' });
    await first.close();
    await reopened.initBrowser(true, undefined, path.join(directory, 'one'));
    await pageFor(reopened).goto(url);
    assert.deepEqual(await pageFor(reopened).evaluate(() => ({ stored: localStorage.getItem('tenant'), cookies: document.cookie })), { stored: 'one', cookies: 'tenant=one' });
  } finally { await first.close(); await second.close(); await reopened.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('tenant browser contexts never send another tenant cookie on the same host', { timeout: 150000 }, async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'tenant-contexts-'));
  const file = path.join(directory, 'candidate.json');
  writeFileSync(file, JSON.stringify({ personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] }));
  const leaks: string[] = []; const visited = new Set<string>();
  let catalogue: unknown[] = [];
  const servers = ['one', 'two'].map(tenant => createServer((request, response) => {
    if (request.url === '/catalogue') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(catalogue)); return; }
    if (request.headers.cookie && !request.headers.cookie.includes(`tenant=${tenant}`)) leaks.push(tenant);
    if (/Chrome/.test(request.headers['user-agent'] || '')) visited.add(tenant);
    response.setHeader('Set-Cookie', `tenant=${tenant}; Path=/; HttpOnly`);
    response.setHeader('Content-Type', 'text/html');
    response.end('<script type="application/ld+json">{"@type":"JobPosting","title":"Software Engineer","description":"Software development in Bengaluru, India."}</script><h1>Software Engineer</h1><p>Software development in Bengaluru, India.</p><label>Employer-specific required question<input required></label><button>Submit application</button>');
  }));
  try {
    for (const server of servers) await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const origins = servers.map(server => { const address = server.address(); assert(address && typeof address !== 'string'); return `http://127.0.0.1:${address.port}`; });
    catalogue = origins.map((origin, index) => ({ id: `fixture:${index}`, url: origin + '/job', title: 'Software Engineer', company: `Tenant ${index}`, location: 'India' }));
    await runApplicationWorker({ profileFile: file, stateDir: directory, catalogueUrl: origins[0] + '/catalogue', once: true, headless: true, signal: AbortSignal.timeout(120000) });
    assert.deepEqual([...visited].sort(), ['one', 'two']);
    assert.deepEqual(leaks, []);
    assert.equal(readdirSync(path.join(directory, 'browsers')).length, 2);
  } finally { for (const server of servers) await new Promise<void>(resolve => server.close(() => resolve())); }
});

for (const checkpointMissing of [false, true]) test(`restart protects a journaled click when checkpoint is ${checkpointMissing ? 'missing' : 'prepared'}`, async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'worker-pending-'));
  const file = path.join(directory, 'candidate.json');
  const email = 'fixture@example.test';
  writeFileSync(file, JSON.stringify({ personal: { firstName: 'Synthetic', email, country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] }));
  const queue = new AutoaplyQueueManager({ statePath: path.join(directory, 'queue.sqlite'), candidateId: createHash('sha256').update(email).digest('hex').slice(0, 20) });
  const first = queue.enqueue({ externalJobId: 'first', jobUrl: 'https://jobs.ashbyhq.com/fixture/first', company: 'Fixture', title: 'Engineer', postedAt: '' });
  queue.enqueue({ externalJobId: 'second', jobUrl: 'https://jobs.ashbyhq.com/fixture/second', company: 'Fixture', title: 'Engineer', postedAt: '' });
  queue.pauseForReview(first.id, 'Automatic request wait timed out; saved for review without retrying Submit');
  queue.recordEvent(first.id, 'submit_clicked');
  queue.close();
  const session = path.join(directory, 'applications', createHash('sha256').update(first.canonicalKey || first.jobUrl).digest('hex').slice(0, 20));
  mkdirSync(session, { recursive: true });
  if (!checkpointMissing) writeFileSync(path.join(session, 'checkpoint.json'), JSON.stringify({ report: { status: 'paused_for_review', reviewKind: 'answers', reason: 'Submit outcome unknown', submissionAttempted: false, submission: { phase: 'prepared', requests: [] }, startTime: new Date(0).toISOString(), actions: [] } }));
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'application/json'); response.end('[]'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  try {
    await runApplicationWorker({ profileFile: file, stateDir: directory, catalogueUrl: `http://127.0.0.1:${address.port}`, once: true, signal: AbortSignal.timeout(60000) });
    const database = new DatabaseSync(path.join(directory, 'queue.sqlite'), { readOnly: true });
    try { assert.deepEqual(database.prepare('SELECT status FROM applications ORDER BY status').all().map(row => row.status), ['paused_for_review', 'queued']); } finally { database.close(); }
    const recovered = JSON.parse(readFileSync(path.join(session, 'checkpoint.json'), 'utf8'));
    assert.equal(recovered.report.submissionAttempted, true);
    assert.equal(recovered.report.submission.phase, 'clicked');
    assert.equal(readdirSync(path.join(directory, 'applications')).length, 1);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('worker spaces Workday reconciliation across restarts without retrying submission', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'worker-workday-reconcile-'));
  const file = path.join(directory, 'candidate.json');
  const email = 'fixture@example.test';
  writeFileSync(file, JSON.stringify({ personal: { firstName: 'Synthetic', email, country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] }));
  const queue = new AutoaplyQueueManager({ statePath: path.join(directory, 'queue.sqlite'), candidateId: createHash('sha256').update(email).digest('hex').slice(0, 20) });
  const url = 'https://example.wd1.myworkdayjobs.com/en-US/Careers/job/India/Engineer_R-123';
  const job = queue.enqueue({ externalJobId: 'workday:example:R-123', jobUrl: url, company: 'Fixture', title: 'Engineer', postedAt: '' });
  queue.pauseForReview(job.id, 'Submit outcome unknown');
  queue.recordEvent(job.id, 'submit_clicked');
  queue.close();
  const session = path.join(directory, 'applications', createHash('sha256').update(job.canonicalKey || job.jobUrl).digest('hex').slice(0, 20));
  mkdirSync(session, { recursive: true });
  const report = { mode: 'stealth' as const, url, ats: 'workday', startTime: new Date().toISOString(), fieldsFound: 0, fieldsFilled: 0, unmappedFields: 0, stepsTraversed: 0, status: 'paused_for_review' as const, reason: 'Submit outcome unknown', reviewKind: 'receipt' as const, submissionAttempted: true, humanInterventionRequired: true, submission: { phase: 'clicked' as const, requests: [] }, actions: [], logs: [] };
  writeFileSync(path.join(session, 'checkpoint.json'), JSON.stringify({ applicationUrl: url, currentUrl: url, report }));
  let attempts = 0;
  const original = AutoApplyRunner.prototype.forkApplication;
  AutoApplyRunner.prototype.forkApplication = async function () {
    return { run: async () => { attempts++; return report; }, parkReview: async () => {}, close: async () => {}, reviewReady: async () => true } as unknown as AutoApplyRunner;
  };
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'application/json'); response.end('[]'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  try {
    await runApplicationWorker({ profileFile: file, stateDir: directory, catalogueUrl: `http://127.0.0.1:${address.port}`, once: true, signal: AbortSignal.timeout(60000) });
    assert.equal(attempts, 1);
    await runApplicationWorker({ profileFile: file, stateDir: directory, catalogueUrl: `http://127.0.0.1:${address.port}`, once: true, signal: AbortSignal.timeout(60000) });
    assert.equal(attempts, 1);
    const checkpointFile = path.join(session, 'checkpoint.json');
    const checkpoint = JSON.parse(readFileSync(checkpointFile, 'utf8'));
    checkpoint.report.reconcileAfter = new Date(Date.now() - 1000).toISOString();
    writeFileSync(checkpointFile, JSON.stringify(checkpoint));
    await runApplicationWorker({ profileFile: file, stateDir: directory, catalogueUrl: `http://127.0.0.1:${address.port}`, once: true, signal: AbortSignal.timeout(60000) });
    assert.equal(attempts, 2);
  } finally { AutoApplyRunner.prototype.forkApplication = original; await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('challenge cooldown prevents parked and queued tenant jobs from reopening', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'worker-challenge-cooldown-'));
  const file = path.join(directory, 'candidate.json');
  const email = 'fixture@example.test';
  writeFileSync(file, JSON.stringify({ personal: { firstName: 'Synthetic', email, country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] }));
  const queue = new AutoaplyQueueManager({ statePath: path.join(directory, 'queue.sqlite'), candidateId: createHash('sha256').update(email).digest('hex').slice(0, 20) });
  const first = queue.enqueue({ externalJobId: 'greenhouse:fixture:1', jobUrl: 'https://boards.greenhouse.io/fixture/jobs/1', company: 'Fixture', title: 'Software Engineer', location: 'India', postedAt: '' });
  queue.enqueue({ externalJobId: 'greenhouse:fixture:2', jobUrl: 'https://boards.greenhouse.io/fixture/jobs/2', company: 'Fixture', title: 'Software Engineer', location: 'India', postedAt: '' });
  queue.pauseForReview(first.id, 'CAPTCHA needs browser review');
  queue.coolTenant(createHash('sha256').update('greenhouse:fixture').digest('hex'), Date.now() + 3600000);
  queue.close();
  const session = path.join(directory, 'applications', createHash('sha256').update(first.canonicalKey || first.jobUrl).digest('hex').slice(0, 20));
  mkdirSync(session, { recursive: true });
  writeFileSync(path.join(session, 'checkpoint.json'), JSON.stringify({ applicationUrl: first.jobUrl, currentUrl: first.jobUrl, report: { status: 'paused_for_review', reviewKind: 'challenge', reason: 'CAPTCHA needs browser review', startTime: new Date().toISOString(), actions: [], logs: [] } }));
  let browsers = 0;
  const original = AutoApplyRunner.prototype.forkApplication;
  AutoApplyRunner.prototype.forkApplication = async function () { browsers++; throw new Error('Cooled tenant must not open'); };
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'application/json'); response.end('[]'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  try {
    await runApplicationWorker({ profileFile: file, stateDir: directory, catalogueUrl: `http://127.0.0.1:${address.port}`, once: true, signal: AbortSignal.timeout(60000) });
    assert.equal(browsers, 0);
    const db = new DatabaseSync(path.join(directory, 'queue.sqlite'), { readOnly: true });
    try { assert.deepEqual(db.prepare('SELECT status FROM applications ORDER BY status').all().map(row => row.status), ['paused_for_review', 'queued']); } finally { db.close(); }
  } finally { AutoApplyRunner.prototype.forkApplication = original; await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('new employer challenge cools its tenant before the next queued role', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'worker-new-challenge-'));
  const file = path.join(directory, 'candidate.json');
  const email = 'fixture@example.test';
  writeFileSync(file, JSON.stringify({ personal: { firstName: 'Synthetic', email, country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] }));
  let probes = 0;
  const server = createServer((request, response) => {
    if (request.url === '/catalogue') { response.setHeader('Content-Type', 'application/json'); response.end('[]'); return; }
    probes++; response.setHeader('Content-Type', 'text/html'); response.end('<script type="application/ld+json">{"@type":"JobPosting","description":"Software development"}</script>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const queue = new AutoaplyQueueManager({ statePath: path.join(directory, 'queue.sqlite'), candidateId: createHash('sha256').update(email).digest('hex').slice(0, 20) });
  for (const id of ['one', 'two']) queue.enqueue({ externalJobId: id, jobUrl: `${origin}/${id}`, company: 'Fixture', title: 'Software Engineer', location: 'India', postedAt: '' });
  queue.close();
  let attempts = 0;
  const original = AutoApplyRunner.prototype.forkApplication;
  AutoApplyRunner.prototype.forkApplication = async function () {
    return { run: async (options: { url: string }) => { attempts++; return { mode: 'stealth', url: options.url, ats: 'generic', startTime: new Date().toISOString(), fieldsFound: 0, fieldsFilled: 0, unmappedFields: 0, stepsTraversed: 1, status: 'paused_for_review', reviewKind: 'challenge', reason: 'CAPTCHA needs browser review', actions: [], logs: [] }; }, parkReview: async () => {}, close: async () => {} } as unknown as AutoApplyRunner;
  };
  try {
    await runApplicationWorker({ profileFile: file, stateDir: directory, catalogueUrl: `${origin}/catalogue`, once: true, signal: AbortSignal.timeout(60000) });
    assert.equal(attempts, 1);
    assert.equal(probes, 1);
    const db = new DatabaseSync(path.join(directory, 'queue.sqlite'), { readOnly: true });
    try {
      assert.deepEqual(db.prepare('SELECT status FROM applications ORDER BY status').all().map(row => row.status), ['paused_for_review', 'queued']);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tenant_cooldowns').get()?.count, 1);
    } finally { db.close(); }
  } finally { AutoApplyRunner.prototype.forkApplication = original; await new Promise<void>(resolve => server.close(() => resolve())); }
});

for (const fail of [false, true]) test(`tenant cooldown preserves confirmation reconciliation status, failure=${fail}`, async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'worker-cooldown-mail-'));
  const file = path.join(directory, 'candidate.json');
  const email = 'fixture@example.test';
  writeFileSync(file, JSON.stringify({ personal: { firstName: 'Synthetic', email, country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] }));
  const created = new Date().toISOString();
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/catalogue') return response.end('[]');
    if (request.url === '/api/v1/messages') { if (fail) { response.statusCode = 500; return response.end('{}'); } return response.end(JSON.stringify({ messages: [{ ID: 'message', Created: created }] })); }
    if (request.url === '/api/v1/message/message') return response.end(JSON.stringify({ MessageID: 'fixture-message', From: { Address: 'noreply@greenhouse.io' }, To: [{ Address: email }], Created: created, Subject: 'Thank you for applying', Text: 'Fixture received your application for Software Engineer.' }));
    response.statusCode = 404; response.end('{}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const queue = new AutoaplyQueueManager({ statePath: path.join(directory, 'queue.sqlite'), candidateId: createHash('sha256').update(email).digest('hex').slice(0, 20) });
  const job = queue.enqueue({ externalJobId: 'greenhouse:fixture:1234', jobUrl: 'https://boards.greenhouse.io/fixture/jobs/1234', company: 'Fixture', title: 'Software Engineer', location: 'India', postedAt: '' });
  queue.pauseForReview(job.id, 'Submit outcome unknown'); queue.recordEvent(job.id, 'submit_clicked');
  queue.coolTenant(createHash('sha256').update('greenhouse:fixture').digest('hex'), Date.now() + 3600000); queue.close();
  const session = path.join(directory, 'applications', createHash('sha256').update(job.canonicalKey || job.jobUrl).digest('hex').slice(0, 20));
  mkdirSync(session, { recursive: true });
  writeFileSync(path.join(session, 'checkpoint.json'), JSON.stringify({ applicationUrl: job.jobUrl, currentUrl: job.jobUrl, report: { status: 'paused_for_review', reviewKind: 'receipt', submissionAttempted: true, humanInterventionRequired: true, submission: { phase: 'clicked', requests: [] }, startTime: new Date(Date.now() - 60000).toISOString(), actions: [], logs: [] } }));
  const previous = process.env.AUTOAPPLY_MAILPIT_URL; process.env.AUTOAPPLY_MAILPIT_URL = origin;
  try {
    await runApplicationWorker({ profileFile: file, stateDir: directory, catalogueUrl: `${origin}/catalogue`, once: true, signal: AbortSignal.timeout(60000) });
    const worker = JSON.parse(readFileSync(path.join(directory, 'worker.json'), 'utf8'));
    assert.equal(worker.mailboxStatus, fail ? 'error' : 'ok');
    assert(Number.isFinite(Date.parse(worker.mailboxCheckedAt)));
    const db = new DatabaseSync(path.join(directory, 'queue.sqlite'), { readOnly: true });
    try { assert.equal(db.prepare('SELECT status FROM applications').get()?.status, fail ? 'paused_for_review' : 'applied'); } finally { db.close(); }
  } finally {
    if (previous === undefined) delete process.env.AUTOAPPLY_MAILPIT_URL; else process.env.AUTOAPPLY_MAILPIT_URL = previous;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

for (const sourceStatus of [404, 503]) test(`parked unsubmitted job revalidates source before reopening (${sourceStatus})`, async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'worker-park-preflight-'));
  const file = path.join(directory, 'candidate.json');
  const email = 'fixture@example.test';
  writeFileSync(file, JSON.stringify({ personal: { firstName: 'Synthetic', email, country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] }));
  let probes = 0;
  const server = createServer((request, response) => {
    if (request.url === '/catalogue') { response.setHeader('Content-Type', 'application/json'); response.end('[]'); return; }
    probes++; response.statusCode = sourceStatus; response.end('unavailable');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const queue = new AutoaplyQueueManager({ statePath: path.join(directory, 'queue.sqlite'), candidateId: createHash('sha256').update(email).digest('hex').slice(0, 20) });
  const job = queue.enqueue({ externalJobId: 'fixture', jobUrl: `${origin}/job`, company: 'Fixture', title: 'Software Engineer', location: 'India', postedAt: '' });
  queue.pauseForReview(job.id, 'Required answer is missing'); queue.close();
  const session = path.join(directory, 'applications', createHash('sha256').update(job.canonicalKey || job.jobUrl).digest('hex').slice(0, 20));
  mkdirSync(session, { recursive: true });
  writeFileSync(path.join(session, 'checkpoint.json'), JSON.stringify({ applicationUrl: job.jobUrl, currentUrl: job.jobUrl, report: { status: 'paused_for_review', reviewKind: 'answers', reason: 'Required answer is missing', startTime: new Date().toISOString(), actions: [] } }));
  let browsers = 0;
  const original = AutoApplyRunner.prototype.forkApplication;
  AutoApplyRunner.prototype.forkApplication = async function () { browsers++; throw new Error('Browser must not open'); };
  try {
    const config = { profileFile: file, stateDir: directory, catalogueUrl: `${origin}/catalogue`, once: true, signal: AbortSignal.timeout(60000) };
    await runApplicationWorker(config);
    assert.equal(browsers, 0);
    const db = new DatabaseSync(path.join(directory, 'queue.sqlite'), { readOnly: true });
    try { assert.equal(db.prepare('SELECT status FROM applications').get()?.status, sourceStatus === 404 ? 'skipped' : 'paused_for_review'); } finally { db.close(); }
    if (sourceStatus === 503) {
      const checkpoint = JSON.parse(readFileSync(path.join(session, 'checkpoint.json'), 'utf8'));
      assert(Date.parse(checkpoint.report.preflightAfter) > Date.now());
      await runApplicationWorker({ ...config, signal: AbortSignal.timeout(60000) });
      assert.equal(probes, 1);
      assert.equal(browsers, 0);
    }
  } finally { AutoApplyRunner.prototype.forkApplication = original; await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('approved role boundary excludes queued and parked jobs and permits one-shot termination', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'worker-approval-'));
  const file = path.join(directory, 'candidate.json');
  const email = 'fixture@example.test';
  writeFileSync(file, JSON.stringify({ personal: { firstName: 'Synthetic', email, country: 'India' }, professional: {}, eeo: {}, workAuthorization: {}, education: [], experience: [] }));
  const queue = new AutoaplyQueueManager({ statePath: path.join(directory, 'queue.sqlite'), candidateId: createHash('sha256').update(email).digest('hex').slice(0, 20) });
  for (const name of ['queued', 'parked']) {
    const job = queue.enqueue({ externalJobId: name, jobUrl: `https://jobs.ashbyhq.com/unapproved/${name}`, company: 'Unapproved', title: 'Engineer', postedAt: '' });
    if (name === 'parked') queue.pauseForReview(job.id, 'Needs review');
  }
  queue.close();
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'application/json'); response.end('[]'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  try {
    await runApplicationWorker({ profileFile: file, stateDir: directory, catalogueUrl: `http://127.0.0.1:${address.port}`, approvedUrls: ['https://jobs.ashbyhq.com/approved/role'], once: true, signal: AbortSignal.timeout(10000) });
    const state = JSON.parse(readFileSync(path.join(directory, 'worker.json'), 'utf8'));
    assert.equal(state.status, 'stopped');
    assert.deepEqual(state.parked, []);
    const database = new DatabaseSync(path.join(directory, 'queue.sqlite'), { readOnly: true });
    try { assert.deepEqual(database.prepare('SELECT status FROM applications ORDER BY status').all().map(row => row.status), ['paused_for_review', 'queued']); } finally { database.close(); }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('ambiguous tenants do not prevent unrelated eligible tenants from running', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'worker-tenant-isolation-'));
  const file = path.join(directory, 'candidate.json');
  const email = 'fixture@example.test';
  writeFileSync(file, JSON.stringify({ personal: { firstName: 'Synthetic', email, country: 'India' }, professional: {}, eeo: {}, workAuthorization: {}, education: [], experience: [] }));
  const queue = new AutoaplyQueueManager({ statePath: path.join(directory, 'queue.sqlite'), candidateId: createHash('sha256').update(email).digest('hex').slice(0, 20) });
  const locked = queue.enqueue({ externalJobId: 'ashby:locked:old', jobUrl: 'https://jobs.ashbyhq.com/locked/old', company: 'Locked', title: 'Software Engineer', location: 'India', postedAt: '' });
  queue.pauseForReview(locked.id, 'Submit outcome unknown');
  queue.recordEvent(locked.id, 'submit_clicked');
  const lockedTwo = queue.enqueue({ externalJobId: 'ashby:lockedtwo:old', jobUrl: 'https://jobs.ashbyhq.com/lockedtwo/old', company: 'Locked Two', title: 'Software Engineer', location: 'India', postedAt: '' });
  queue.pauseForReview(lockedTwo.id, 'Submit outcome unknown');
  queue.recordEvent(lockedTwo.id, 'submit_clicked');
  const missing = queue.enqueue({ externalJobId: 'ashby:missing:old', jobUrl: 'https://jobs.ashbyhq.com/missing/old', company: 'Missing', title: 'Software Engineer', location: 'India', postedAt: '' });
  queue.pauseForReview(missing.id, 'Missing required fact');
  const tenants = ['locked', 'lockedtwo', 'closed', 'first', 'second'];
  const urls = tenants.map(tenant => `https://jobs.ashbyhq.com/${tenant}/new`);
  for (const [index, url] of urls.entries()) queue.enqueue({ externalJobId: `ashby:${tenants[index]}:new`, jobUrl: url, company: tenants[index]!, title: 'Software Engineer', location: 'India', postedAt: '' });
  queue.close();
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'application/json'); response.end('[]'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const originalFetch = globalThis.fetch;
  const originalFork = AutoApplyRunner.prototype.forkApplication;
  const visited: string[] = [];
  globalThis.fetch = (async (input, init) => {
    if (String(input).startsWith('https://api.ashbyhq.com/')) return Response.json({ jobs: String(input).endsWith('/closed') ? [] : [{ id: 'new', title: 'Software Engineer', location: 'Bengaluru, India', descriptionPlain: 'Software development in Bengaluru, India.' }] });
    return originalFetch(input, init);
  }) as typeof fetch;
  AutoApplyRunner.prototype.forkApplication = async function () {
    return { run: async (options: { url: string; submit?: boolean }) => {
      visited.push(options.url); assert.equal(options.submit, false);
      return { status: 'paused_for_review', reviewKind: 'answers', reason: 'Missing answer', humanInterventionRequired: true, startTime: new Date().toISOString(), actions: [], logs: [] };
    }, parkReview: async () => {}, reviewReady: async () => false, close: async () => {} } as unknown as AutoApplyRunner;
  };
  try {
    await runApplicationWorker({ profileFile: file, stateDir: directory, catalogueUrl: `http://127.0.0.1:${address.port}`, approvedUrls: urls, once: true, signal: AbortSignal.timeout(15000) });
    assert.deepEqual(new Set(visited), new Set(urls.slice(3)));
    const db = new DatabaseSync(path.join(directory, 'queue.sqlite'), { readOnly: true });
    try {
      const rows = db.prepare('SELECT payload FROM applications').all().map(row => JSON.parse(String(row.payload)));
      assert.equal(rows.find(job => job.jobUrl === urls[0]).status, 'queued');
      assert.equal(rows.find(job => job.jobUrl === urls[1]).status, 'queued');
      assert.equal(rows.find(job => job.jobUrl === urls[2]).status, 'skipped');
      assert.equal(rows.filter(job => urls.slice(3).includes(job.jobUrl) && job.status === 'paused_for_review').length, 2);
      assert.equal(rows.find(job => job.id === missing.id).status, 'paused_for_review');
    } finally { db.close(); }
  } finally { globalThis.fetch = originalFetch; AutoApplyRunner.prototype.forkApplication = originalFork; await new Promise<void>(resolve => server.close(() => resolve())); }
});

for (const evidence of ['journal', 'checkpoint', 'journal_parked'] as const) test(`restricted worker blocks approved sibling of an ambiguous out-of-scope job (${evidence})`, async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'worker-scope-ambiguity-'));
  const file = path.join(directory, 'candidate.json');
  const email = 'fixture@example.test';
  writeFileSync(file, JSON.stringify({ personal: { firstName: 'Synthetic', email, country: 'India' }, professional: {}, eeo: {}, workAuthorization: {}, education: [], experience: [] }));
  const queue = new AutoaplyQueueManager({ statePath: path.join(directory, 'queue.sqlite'), candidateId: createHash('sha256').update(email).digest('hex').slice(0, 20) });
  const prior = queue.enqueue({ externalJobId: 'ashby:fixture:prior', jobUrl: 'https://jobs.ashbyhq.com/fixture/prior', company: 'Fixture', title: 'Software Engineer', location: 'India', postedAt: '' });
  queue.pauseForReview(prior.id, 'Submit outcome unknown');
  if (evidence !== 'checkpoint') queue.recordEvent(prior.id, 'submit_clicked');
  const approved = queue.enqueue({ externalJobId: 'ashby:fixture:next', jobUrl: 'https://jobs.ashbyhq.com/fixture/next', company: 'Fixture', title: 'Software Engineer', location: 'India', postedAt: '' });
  if (evidence === 'journal_parked') queue.pauseForReview(approved.id, 'Waiting for requests');
  queue.close();
  if (evidence === 'checkpoint') {
    const session = path.join(directory, 'applications', createHash('sha256').update(prior.canonicalKey || prior.jobUrl).digest('hex').slice(0, 20));
    mkdirSync(session, { recursive: true });
    writeFileSync(path.join(session, 'checkpoint.json'), JSON.stringify({ report: { submission: { phase: 'dispatched', requests: [] } } }));
  }
  if (evidence === 'journal_parked') {
    const session = path.join(directory, 'applications', createHash('sha256').update(approved.canonicalKey || approved.jobUrl).digest('hex').slice(0, 20));
    mkdirSync(session, { recursive: true });
    writeFileSync(path.join(session, 'checkpoint.json'), JSON.stringify({ report: { reviewKind: 'network', startTime: new Date().toISOString(), actions: [], logs: [] } }));
  }
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'application/json'); response.end('[]'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const originalFetch = globalThis.fetch;
  let probes = 0;
  globalThis.fetch = (async (input, init) => {
    if (String(input).startsWith('https://api.ashbyhq.com/')) { probes++; return new Response('', { status: 404 }); }
    return originalFetch(input, init);
  }) as typeof fetch;
  try {
    await runApplicationWorker({ profileFile: file, stateDir: directory, catalogueUrl: `http://127.0.0.1:${address.port}`, approvedUrls: [approved.jobUrl], once: true, signal: AbortSignal.timeout(10000) });
    const db = new DatabaseSync(path.join(directory, 'queue.sqlite'), { readOnly: true });
    try { assert.equal(db.prepare('SELECT status FROM applications WHERE id=?').get(approved.id)?.status, evidence === 'journal_parked' ? 'paused_for_review' : 'queued'); } finally { db.close(); }
    assert.equal(JSON.parse(readFileSync(path.join(directory, 'worker.json'), 'utf8')).status, 'stopped');
    assert.equal(probes, 0);
  } finally { globalThis.fetch = originalFetch; await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('parked questions do not block next job and review checkpoints survive worker shutdown', { skip: process.platform !== 'win32', timeout: 100000 }, async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'worker-park-'));
  let origin = '';
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/catalogue') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(['one', 'two', 'three', 'four'].map(id => ({ id: `fixture:tenant:${id}`, url: origin + '/' + id, company: 'Fixture', title: 'Software Engineer', location: 'Bengaluru, India', lastSeen: '2026-10-30T00:00:00Z', postedAt: new Date().toISOString() }))));
    } else response.end(`<script type="application/ld+json">{"@type":"JobPosting","title":"Software Engineer","description":"Bengaluru software development role"}</script><h1>Software Engineer</h1><p>Bengaluru software development role</p><form><label>Email<input type=email required></label>${request.url === '/one' ? '<label>Employer-specific question<input required></label>' : ''}<button>Submit application</button></form>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string'); origin = `http://127.0.0.1:${address.port}`;
  const file = path.join(directory, 'candidate.json');
  writeFileSync(file, JSON.stringify({ personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: { totalYearsExperience: 1 }, eeo: {}, workAuthorization: {}, education: [], experience: [] }));
  try {
    await runApplicationWorker({ profileFile: file, stateDir: directory, catalogueUrl: origin + '/catalogue', once: true, headless: true, signal: AbortSignal.timeout(45000) });
    const database = new DatabaseSync(path.join(directory, 'queue.sqlite'), { readOnly: true });
    try {
      const rows = database.prepare('SELECT status,payload FROM applications').all();
      assert.equal(rows.length, 4);
      assert(rows.every(row => row.status === 'paused_for_review'));
      const state = JSON.parse(readFileSync(path.join(directory, 'worker.json'), 'utf8'));
      assert.equal(state.parked.length, 4);
      assert.equal(state.status, 'stopped');
    } finally { database.close(); }
    const candidate = JSON.parse(readFileSync(file, 'utf8'));
    candidate.answers = [{ scope: 'EMPLOYER_SCOPED', employerKey: 'fixture:tenant', question: 'Employer-specific question', value: 'Explicit fixture answer' }];
    writeFileSync(file, JSON.stringify(candidate));
    await runApplicationWorker({ profileFile: file, stateDir: directory, catalogueUrl: origin + '/catalogue', once: true, headless: true, signal: AbortSignal.timeout(45000) });
    const checkpoints = readdirSync(path.join(directory, 'applications')).map(name => JSON.parse(readFileSync(path.join(directory, 'applications', name, 'checkpoint.json'), 'utf8')));
    assert(checkpoints.some(checkpoint => checkpoint.report.actions.some((action: { value: string; status: string }) => action.status === 'filled' && action.value === 'Explicit fixture answer')));
    assert(checkpoints.every(checkpoint => !checkpoint.report.submissionAttempted));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
});

test('one-shot worker terminates after failed initial intake without launching browser', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'worker-once-'));
  const server = createServer((_request, response) => { response.statusCode = 503; response.end('retry later'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const file = path.join(directory, 'candidate.json');
  writeFileSync(file, JSON.stringify({ personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: {}, eeo: {}, workAuthorization: {}, education: [], experience: [] }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    await runApplicationWorker({ profileFile: file, stateDir: directory, catalogueUrl: `http://127.0.0.1:${address.port}`, once: true, intakeOnly: true, signal: controller.signal });
    assert.equal(controller.signal.aborted, false);
    const state = JSON.parse(readFileSync(path.join(directory, 'worker.json'), 'utf8'));
    assert.equal(state.status, 'stopped');
    assert.equal(state.metrics.totalApplied, 0);
  } finally { clearTimeout(timer); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
});



