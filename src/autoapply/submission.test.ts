import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AutoApplyRunner } from './runner.js';
import { sha256, observeSubmission } from './submission.js';
import type { CandidateExtendedProfile, BotRunReport } from './types.js';
import type { Page } from 'patchright';
import { CredentialVault } from './vault.js';
import { randomBytes } from 'node:crypto';
import { verifyEvidenceBundle } from './evidence-verifier.js';
import { writeFileSync } from 'node:fs';

const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;

test('late API-only confirmation survives parking and retains encrypted network proof without another Submit', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'late-network-proof-'));
  const vault = new CredentialVault(path.join(directory, 'vault'), randomBytes(32));
  let posts = 0; let release: (() => void) | undefined;
  const server = createServer((request, response) => {
    if (request.method === 'POST') { posts++; release = () => { if (response.writableEnded) return; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: { submitJobApplication: { isSuccess: true, applicationId: 'late-api-1' } } })); }; return; }
    response.setHeader('Content-Type', 'text/html'); response.end(`<form onsubmit="event.preventDefault();fetch('/api/non-user-graphql?op=ApiSubmitJobApplication',{method:'POST',body:'application'})"><label>Email<input type=email required></label><button>Submit application</button></form>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const options = { url: `http://127.0.0.1:${address.port}/`, profile, vault, headless: false, sessionDir: directory, submit: true, timeoutMs: 200 };
    const parked = await runner.run(options);
    assert.equal(parked.status, 'paused_for_review'); assert.equal(posts, 1); assert(release);
    release();
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) { ready = await runner.reviewReady(parked, options); if (ready) break; await new Promise(resolve => setTimeout(resolve, 100)); }
    assert(ready, 'API confirmation must wake the parked job');
    const recovered = await runner.run({ ...options, resume: true });
    assert.equal(recovered.status, 'submitted', recovered.reason); assert.equal(posts, 1); assert(recovered.evidenceDir);
    const proof = verifyEvidenceBundle(recovered.evidenceDir, { vault, candidateEmail: profile.personal.email });
    assert.equal(proof.authenticated, true); assert.equal(proof.networkVerified, true); assert.equal(proof.applicationId, 'late-api-1');
  } finally { release?.(); await runner.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
});

test('parked tab mutations cannot dispatch or confirm the active application', async () => {
  const server = createServer((request, response) => {
    if (request.method !== 'POST') { response.setHeader('Content-Type', 'text/html'); response.end('<h1>Fixture</h1>'); return; }
    let body = ''; request.on('data', chunk => { body += chunk.toString(); });
    request.on('end', () => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: { submitJobApplication: { isSuccess: true, applicationId: body } } })); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const active = (runner as unknown as { page: Page }).page;
    const parked = await active.context().newPage();
    await active.goto(origin); await parked.goto(origin);
    const report: BotRunReport = { mode: 'copilot', url: origin, ats: 'ashby', startTime: new Date().toISOString(), fieldsFound: 0, fieldsFilled: 0, unmappedFields: 0, stepsTraversed: 0, status: 'paused_for_review', actions: [], logs: [], submission: { phase: 'clicked', requests: [] } };
    const observer = observeSubmission(active.context(), new Set([active]), report, () => {});
    const receipt = () => report.receipt;
    try {
      await parked.evaluate(async () => { await (await fetch('/api/non-user-graphql?op=ApiSubmitJobApplication', { method: 'POST', body: 'parked-job' })).text(); });
      await observer.drain();
      assert.equal(report.submission!.requests.length, 0); assert.equal(receipt(), undefined);
      await active.evaluate(async () => { await (await fetch('/api/non-user-graphql?op=ApiSubmitJobApplication', { method: 'POST', body: 'active-job' })).text(); });
      await observer.drain();
      assert.equal(report.submission!.requests.length, 1); assert.equal(receipt()?.applicationId, 'active-job');
    } finally { observer.close(); }
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('structured employer submission API supplies network proof without a DOM receipt', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'network-receipt-'));
  let posts = 0;
  const server = createServer((request, response) => {
    if (request.method === 'POST') { posts++; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: { submitJobApplication: { isSuccess: true, applicationId: 'network-123' } } })); return; }
    response.setHeader('Content-Type', 'text/html'); response.end(`<form onsubmit="event.preventDefault();fetch('/api/non-user-graphql?op=ApiSubmitJobApplication',{method:'POST',body:'application'})"><label>Email<input type=email required></label><button>Submit application</button></form>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  const vault = new CredentialVault(path.join(directory, 'vault'), randomBytes(32));
  try {
    await runner.initBrowser(true);
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile, vault, headless: false, sessionDir: directory, submit: true, timeoutMs: 3000 });
    assert.equal(report.status, 'submitted', report.reason);
    assert.equal(posts, 1);
    assert.equal(report.receipt?.applicationId, 'network-123');
    assert(report.evidenceDir);
    assert.equal(JSON.parse(readFileSync(path.join(report.evidenceDir, 'receipt.json'), 'utf8')).proof, 'NETWORK_VERIFIED');
    const verified = verifyEvidenceBundle(report.evidenceDir, { vault, candidateEmail: profile.personal.email });
    assert.equal(verified.authenticated, true); assert.equal(verified.networkVerified, true);
    assert.equal(verified.applicationId, 'network-123');
    assert.throws(() => verifyEvidenceBundle(report.evidenceDir!, { vault, candidateEmail: 'other@example.test' }), /candidate mismatch/);
    const manifestFile = path.join(report.evidenceDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    const receiptFile = path.join(report.evidenceDir, 'receipt.json');
    const tampered = readFileSync(receiptFile, 'utf8').replace('network-123', 'forged-id');
    writeFileSync(receiptFile, tampered); manifest.files['receipt.json'] = sha256(tampered);
    writeFileSync(manifestFile, JSON.stringify(manifest));
    assert.throws(() => verifyEvidenceBundle(report.evidenceDir!, { vault }), /signature/);
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
});

test('killed browser worker after POST dispatch reconciles employer state without another click', { timeout: 45000 }, async () => {
  let posts = 0;
  let dispatched!: () => void;
  const requestSeen = new Promise<void>(resolve => { dispatched = resolve; });
  const directory = mkdtempSync(path.join(os.tmpdir(), 'submission-crash-'));
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    if (request.method === 'POST') { posts++; dispatched(); setTimeout(() => response.end('accepted'), 5000); return; }
    response.end(posts ? '<h1>You have already applied to this position</h1>' : `<form onsubmit="event.preventDefault();fetch('/submit',{method:'POST',body:'application'}).then(()=>document.body.innerHTML='<h1>Application submitted</h1>')"><label>Email<input type=email required></label><button>Submit application</button></form>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/`;
  const source = `import {AutoApplyRunner} from './src/autoapply/runner.ts';const r=new AutoApplyRunner();await r.initBrowser(true);await r.run({url:process.argv[1],profile:${JSON.stringify(profile)},sessionDir:process.argv[2],headless:false,submit:true,timeoutMs:15000});await r.close();`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source, url, directory], { windowsHide: true, stdio: 'ignore' });
  const timeout = setTimeout(() => child.kill(), 20000);
  const runner = new AutoApplyRunner();
  try {
    await Promise.race([requestSeen, new Promise<never>((_, reject) => child.once('exit', () => reject(new Error('Worker exited before dispatch'))))]);
    await new Promise(resolve => setTimeout(resolve, 50));
    const exit = new Promise<void>(resolve => child.once('close', () => resolve())); child.kill('SIGKILL'); await exit;
    const checkpoint = JSON.parse(readFileSync(path.join(directory, 'checkpoint.json'), 'utf8'));
    assert.equal(checkpoint.report.submission.phase, 'dispatched');
    await runner.initBrowser(true);
    const recovered = await runner.run({ url, profile, sessionDir: directory, headless: false, submit: true, resume: true, timeoutMs: 1000 });
    assert.equal(recovered.status, 'submitted', recovered.reason);
    assert.equal(recovered.receipt?.existing, true);
    assert.equal(posts, 1);
  } finally { clearTimeout(timeout); child.kill(); await runner.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
});

test('application entry accepts a decorative word joiner in its accessible name', async () => {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(request.url === '/apply' ? '<form><label>Email<input type="email" required></label><button>Submit application</button></form>' : '<a href="/apply">Apply for this role &#8288;</a>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile, submit: false, timeoutMs: 1000 });
    assert.equal(report.reason, 'Ready for submission review; use --submit to send');
    assert.equal(report.fieldsFilled, 1);
  } finally { await runner.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('checkbox option resolves an explicitly scoped answer without selecting siblings', async () => {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<fieldset><legend>When can you start?</legend><label><input type="checkbox">Quarter one</label><label><input type="checkbox">Quarter two</label></fieldset>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const candidate = { ...profile, answers: [{ question: 'Quarter one', value: true, scope: 'EMPLOYER_SCOPED' as const, employerKey: 'fixture:company', requisitionKey: 'fixture:company:1' }] };
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile: candidate, requisition: { provider: 'fixture', tenant: 'company', jobId: '1', key: 'fixture:company:1' }, submit: false, timeoutMs: 1000 });
    assert.equal(report.actions.filter(action => action.status === 'filled').length, 1);
    assert.equal(report.actions.filter(action => action.status === 'needs_review').length, 1);
  } finally { await runner.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('resuming an unchecked required checkbox parks for an unknown answer', async () => {
  let posts = 0;
  const server = createServer((request, response) => {
    if (request.method === 'POST') { posts++; response.end(); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end('<form onsubmit="event.preventDefault();fetch(\'/submit\',{method:\'POST\'})"><label>Email<input type="email" required></label><label><input type="checkbox" required>Unrecognized declaration</label><button>Submit application</button></form>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const url = `http://127.0.0.1:${address.port}/`;
    await runner.run({ url, profile, submit: false, keepOpen: true, timeoutMs: 1000 });
    const report = await runner.run({ url, profile, resume: true, preserveReviewedValues: true, submit: true, keepOpen: true, timeoutMs: 1000 });
    assert.equal(report.actions.some(action => action.status === 'failed' && action.error === 'Required answer is missing'), true);
    assert.equal(report.submissionAttempted, undefined);
    assert.equal(posts, 0);
  } finally { await runner.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

for (const selected of [false, true]) test(`required checkbox group ${selected ? 'accepts a known selection' : 'parks when empty'}`, async () => {
  let posts = 0;
  const server = createServer((request, response) => {
    if (request.method === 'POST') { posts++; response.end(); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end('<form onsubmit="event.preventDefault();fetch(\'/submit\',{method:\'POST\'})"><label>Email<input type="email" required></label><fieldset role="group" aria-required="true"><legend>When can you start?</legend><label><input type="checkbox" name="quarter">Quarter one</label><label><input type="checkbox" name="quarter">Quarter two</label></fieldset><button>Submit application</button></form>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const candidate = selected ? { ...profile, answers: [{ question: 'Quarter one', value: true, scope: 'EMPLOYER_SCOPED' as const, employerKey: 'fixture:company', requisitionKey: 'fixture:company:1' }] } : profile;
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile: candidate, requisition: { provider: 'fixture', tenant: 'company', jobId: '1', key: 'fixture:company:1' }, submit: !selected, timeoutMs: 1000 });
    assert.equal(report.reason, selected ? 'Ready for submission review; use --submit to send' : 'Validation or field errors require review');
    assert.equal(posts, 0);
  } finally { await runner.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

for (const submit of [false, true]) test(`a zero-field page never reports ready, reserves or submits (submit=${submit})`, async () => {
  let posts = 0;
  let reservations = 0;
  const server = createServer((request, response) => {
    if (request.method === 'POST') { posts++; response.end('unexpected'); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end('<button onclick="fetch(\'/submit\',{method:\'POST\'})">Submit application</button>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile, submit, reserveSubmission: () => { reservations++; return true; }, timeoutMs: 1000 });
    assert.equal(report.reason, 'No application fields observed; review before submission');
    assert.equal(report.submissionAttempted, undefined);
    assert.equal(reservations, 0);
    assert.equal(posts, 0);
  } finally { await runner.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('a challenge on a login page is classified as a challenge', async () => {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<input type="password"><div data-sitekey="fixture" style="width:40px;height:40px">Challenge</div>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile, submit: true, timeoutMs: 1000 });
    assert.equal(report.reviewKind, 'challenge');
    assert.equal(report.submissionAttempted, undefined);
  } finally { await runner.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

for (const kind of ['bounce', 'client-error', 'dispatch', 'popup'] as const) test(`submission transaction: ${kind}`, async () => {
  let posts = 0;
  const directory = mkdtempSync(path.join(os.tmpdir(), 'submission-proof-'));
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    if (request.method === 'POST') { posts++; response.end('accepted'); return; }
    if (request.url?.startsWith('/confirmation')) { response.end('<h1>Application submitted</h1>'); return; }
    if (request.url === '/popup') { response.end(`<form onsubmit="event.preventDefault();fetch('/submit',{method:'POST',body:'application'}).then(()=>{opener.location='/confirmation?applicationId=fixture-123';window.close()})"><label>Email<input type=email required></label><button>Submit application</button></form>`); return; }
    if (kind === 'popup') { response.end('<a href="/popup" target="_blank" rel="opener">Apply now</a>'); return; }
    const submit = kind === 'client-error' ? "throw new Error('Synthetic client validation failure')" : kind === 'bounce' ? "document.querySelector('input').setAttribute('aria-invalid','true');document.querySelector('[role=alert]').textContent='Correct email'" : "fetch('/submit',{method:'POST',body:'application'})";
    response.end(`<footer><p>You have already applied to this position. Log in above.</p></footer><form onsubmit="event.preventDefault();${submit}"><label>Email<input type=email required></label><p role=alert></p><button>Submit application</button></form>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/`;
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const report = await runner.run({ url, profile, headless: false, submit: true, sessionDir: directory, timeoutMs: 2500 });
    if (kind === 'bounce' || kind === 'client-error') {
      assert.equal(posts, 0);
      assert.equal(report.submissionAttempted, true);
      assert.equal(report.submission?.phase, 'clicked');
      assert.match(report.reason!, /Verify the outcome before retrying/);
      const resumed = await runner.run({ url, profile, headless: false, submit: true, resume: true, sessionDir: directory, timeoutMs: 1000 });
      assert.equal(resumed.submissionAttempted, true);
      assert.equal(posts, 0);
    } else if (kind === 'dispatch') {
      assert.equal(posts, 1);
      assert.equal(report.submission?.phase, 'dispatched');
      assert.equal(report.receipt, undefined);
      const resumed = await runner.run({ url, profile, headless: false, submit: true, resume: true, sessionDir: directory, timeoutMs: 1000 });
      assert.equal(resumed.submissionAttempted, true);
      assert.equal(posts, 1);
    } else {
      assert.equal(posts, 1);
      assert.equal(report.status, 'submitted', report.reason);
      assert.equal(report.submission?.phase, 'confirmed');
      assert.equal(report.submission?.requests[0]?.status, 200);
      assert.equal(report.receipt?.applicationId, 'fixture-123');
      assert(report.evidenceDir);
      const manifest = JSON.parse(readFileSync(path.join(report.evidenceDir, 'manifest.json'), 'utf8'));
      for (const [name, hash] of Object.entries(manifest.files)) assert.equal(sha256(readFileSync(path.join(report.evidenceDir, name))), hash);
      const payload = JSON.parse(readFileSync(path.join(report.evidenceDir, 'submitted_payload.json'), 'utf8'));
      assert.equal(payload.fields[0].value, profile.personal.email);
      const receipt = JSON.parse(readFileSync(path.join(report.evidenceDir, 'receipt.json'), 'utf8'));
      assert.equal(receipt.proof, 'DOM_VERIFIED');
      assert.equal(receipt.receipt.applicationId, 'fixture-123');
    }
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
});


