import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import dns from 'node:dns';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'patchright';
import { computeJaccardSimilarity, inspectPdfPageCount, selectItemsViaSubmodularMmr, verifyPdfVisualGeometry, verifyPrintableResumeLayout } from '../src/resume/deterministic-builder.js';
import { coerceFieldValueByErrorMessage, auditEmptyRequiredFieldsInDom } from '../src/autoapply/validation-healer.js';
import { classifyFileUploadSlot } from '../src/autoapply/classifier.js';
import { translateCanonicalAnswerToOption } from '../src/autoapply/widgets.js';
import { resolveCandidateAnswer } from '../src/autoapply/answers.js';
import { formatCandidateTimelineDate } from '../src/autoapply/date-normalizer.js';
import { prefetchPublicPosting } from '../src/autoapply/public-posting-preflight.js';
import { canAttemptDirectHttpSubmit, buildMultipartFormPayload } from '../src/autoapply/direct-http-submitter.js';
import { computeJobSurvivalPriorityScore } from '../src/autoapply/survival-priority-scorer.js';
import { extractEmbeddedAtsSlugsFromHtml } from '../src/discovery/embedded-ats-extractor.js';
import { buildWorkdayCxsSearchRequest, parseWorkdayPostedOnToIso } from '../src/discovery/workday-cxs-harvester.js';
import { extractAtsTenantsFromCtDomains } from '../src/discovery/ct-log-normalizer.js';
import { evaluateRoleEligibilityForCandidate } from '../src/discovery/india-gcc-filter.js';
import { computeRoleDedupSignature, isDuplicateAppliedRoleWithinWindow } from '../src/autoapply/role-dedup-shield.js';
import { extractVerbatimEmailsFromGitPatch, extractVerbatimEmailsFromNpmPackument } from '../src/outreach/oss-lead-extractor.js';
import { composePersonaOutreachEmail } from '../src/outreach/playbook-hook-composer.js';
import { checkDomainMxDeliverability, classifySmtpBounceReply, isDisposableOrFreeEmailDomain } from '../src/outreach/zero-bounce-verifier.js';
import { extractOaAndInterviewSignalsFromEmail } from '../src/outreach/oa-interview-extractor.js';
import { extractGreenhouse8CharOtpFromEmail, extractWorkdayActivationLinkFromEmail, withSingleFlightImapLock } from '../src/autoapply/imap-multiplexer.js';
import { recoverStaleInProgressJobs } from '../src/autoapply/stale-recovery.js';
import { runSqliteMaintenanceAndBackup } from '../src/autoapply/sqlite-maintenance.js';
import { assessSystemMemoryPressure, isSafeToReapChromeCommandLine } from '../src/autoapply/memory-guard.js';
import { parseRetryAfterHeaderMs, computeAutoThrottleDelayMs } from '../src/autoapply/tenant-rate-limiter.js';
import { BatchBoundaryHotReloadDetector } from '../src/autoapply/hot-reload-detector.js';
import { resolveDomFieldsForExtensionBrain } from '../src/autoapply/extension-brain-adapter.js';
import { isTrustedDashboardRequest } from '../src/autoapply/dashboard-access.js';
import type { CandidateExtendedProfile } from '../src/autoapply/types.js';

const start = performance.now();
const profile = { personal: { firstName: 'Fixture', email: 'fixture@example.test', country: 'India' }, professional: { expectedSalary: 1200000, salaryCurrency: 'INR', noticePeriodDays: 0 }, workAuthorization: {}, eeo: {}, education: [{ startDate: '2022-08' }], experience: [], skills: ['Java', 'Python'] } as unknown as CandidateExtendedProfile;
const now = Date.parse('2026-11-12T12:00:00Z');
const root = mkdtempSync(path.join(os.tmpdir(), 'ats-canary-'));
const originalFetch = globalThis.fetch;
const scenarios: Array<{ label: string; run: () => unknown | Promise<unknown> }> = [];
const add = (label: string, run: () => unknown | Promise<unknown>) => scenarios.push({ label, run });
const expect = (label: string, actual: () => unknown, expected: unknown) => add(label, () => assert.deepEqual(actual(), expected));

// Résumé selection and PDF guard cases.
for (const [i, a, b, expected] of [
  [3, ['a'], ['a'], 1], [5, ['a','b'], ['a'], 0.5], [7, ['a','a'], ['a'], 1],
] as Array<[number, string[], string[], number]>) expect(`resume similarity ${i}`, () => computeJaccardSimilarity(a, b), expected);
for (let k = 0; k < 5; k++) expect(`resume selection size ${k}`, () => selectItemsViaSubmodularMmr([{ id: 'a', text: 'Java' }, { id: 'b', text: 'Python' }, { id: 'c', text: 'Kafka' }], new Map([['java', 1], ['python', 1], ['kafka', 1]]), k).selected.length, Math.min(k, 3));
expect('PDF rejects missing header', () => inspectPdfPageCount(Buffer.from('not a pdf')), 0);
expect('PDF rejects missing page tree', () => inspectPdfPageCount(Buffer.from('%PDF-1.4\n%%EOF')), 0);
expect('PDF detects one page marker', () => inspectPdfPageCount(Buffer.from('%PDF-1.4\n/Type /Page\n%%EOF')), 1);
expect('PDF detects two page markers', () => inspectPdfPageCount(Buffer.from('%PDF-1.4\n/Type /Page\n/Type /Page\n%%EOF')), 2);
expect('PDF geometry rejects too-small fixture', () => verifyPdfVisualGeometry(Buffer.from('%PDF-1.4\n/Type /Page\n%%EOF')).validSinglePage, false);

// Validation, required field and upload-routing cases.
for (const [label, expected] of [['Resume/CV','resume'], ['Cover letter','cover_letter'], ['Motivation letter','cover_letter'], ['Academic transcript','transcript'], ['Work sample','portfolio'], ['Resume or cover letter','other_optional'], ['Other document','other_optional']] as const) expect(`upload ${label}`, () => classifyFileUploadSlot(label), expected);
for (const [value, error, expected] of [['','must be a number',''], ['1,200','must be a number','1200'], ['Immediate','numeric','Immediate'], ['N/A','valid url','N/A'], ['example.test/path','valid url','https://example.test/path'], ['08/2026','valid date yyyy-mm-dd','08/2026']] as const) expect(`healer ${value} ${error}`, () => coerceFieldValueByErrorMessage(value, error), expected);
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let page: Awaited<ReturnType<NonNullable<typeof browser>['newPage']>> | undefined;
add('required-field audit sees missing inputs', async () => { browser = await chromium.launch({ channel: 'chrome', headless: true }); page = await browser.newPage(); await page.setContent('<input id="a" required><input id="b" required value="ok"><input id="c" type="checkbox" required>'); assert.deepEqual((await auditEmptyRequiredFieldsInDom(page)).map(field => field.selector).sort(), ['#a', '#c']); });
add('required-field audit does not click consent', async () => { assert(page); assert.equal(await page.locator('#c').isChecked(), false); });
add('real browser PDF does not claim verified geometry', async () => {
  assert(page);
  await page.setContent('<style>@page { size: A4; margin: 20mm }</style><main>Fixture résumé</main>');
  const pdf = await page.pdf({ format: 'A4' });
  const result = verifyPdfVisualGeometry(pdf);
  assert.equal(result.pageCount, 1);
  assert.equal(result.geometryVerified, false);
  assert.equal(result.hasOverflowWarning, true);
});
add('print layout accepts visible text inside page', async () => {
  assert(page);
  await page.emulateMedia({ media: 'print' });
  await page.setContent('<style>body{margin:0}</style><p>Readable fixture</p>');
  assert.equal((await verifyPrintableResumeLayout(page)).valid, true);
});
add('print layout rejects text outside page', async () => {
  assert(page);
  await page.setContent('<style>body{margin:0}.late{position:absolute;top:1100px}</style><p class="late">Outside page</p>');
  assert.equal((await verifyPrintableResumeLayout(page)).valid, false);
});

// Combobox and date cases. Deterministic checkbox/combobox guessers were removed
// from widgets.ts, so those cases no longer have a production function to check.
expect('location synonym', () => translateCanonicalAnswerToOption('Bengaluru', 'City', ['Bangalore','Delhi']), 'Bangalore');
expect('unknown gender is not male', () => translateCanonicalAnswerToOption('Female', 'Gender', ['Male','Prefer not to say']), null);
const salary = (question: string, extra: Record<string, unknown> = {}) => resolveCandidateAnswer('expected_salary', profile, { url: 'https://example.test/job', question, ...extra }).value;
expect('annual INR salary', () => salary('Expected CTC in INR'), 1200000);
expect('LPA salary', () => salary('Expected salary LPA'), 12);
expect('monthly salary', () => salary('Expected salary monthly'), 100000);
expect('foreign currency needs evidence', () => salary('Expected salary in USD'), undefined);
expect('salary bounds need review', () => salary('Expected salary LPA', { min: 15 }), undefined);
expect('month-only date has no day', () => formatCandidateTimelineDate('edu_start', { profile }).isoDate, '');
expect('month-only date retains month', () => formatCandidateTimelineDate('edu_start', { profile }).mmYyyy, '08/2022');

// 15 provider preflight and direct multipart cases; all HTTP is mocked.
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const preflight = async (url: string, body: unknown, status = 200) => { globalThis.fetch = (async () => response(body, status)) as typeof fetch; try { return await prefetchPublicPosting(url); } finally { globalThis.fetch = originalFetch; } };
add('SmartRecruiters JD', async () => assert.equal((await preflight('https://jobs.smartrecruiters.com/example/123', { jobAd: { sections: { jobDescription: { text: 'Fixture description' } } } }))?.jdText, 'Fixture description'));
add('SmartRecruiters closed', async () => assert.equal((await preflight('https://jobs.smartrecruiters.com/example/123', {}, 404))?.isClosed, true));
add('SmartRecruiters server error', async () => assert.equal(await preflight('https://jobs.smartrecruiters.com/example/123', {}, 500), null));
add('Recruitee questions', async () => assert.equal((await preflight('https://example.recruitee.com/o/job', { offer: { questions: [{ label: 'Name' }] } }))?.questions.length, 1));
add('Recruitee description', async () => assert.equal((await preflight('https://example.recruitee.com/o/job', { offer: { description: 'Fixture' } }))?.jdText, 'Fixture'));
add('Breezy questions', async () => assert.equal((await preflight('https://example.breezy.hr/p/job', { questionnaire: [{ label: 'Name' }] }))?.questions.length, 1));
add('Breezy description', async () => assert.equal((await preflight('https://example.breezy.hr/p/job', { description: 'Fixture' }))?.jdText, 'Fixture'));
add('Workable closed', async () => assert.equal((await preflight('https://apply.workable.com/example/j/abc', { state: 'closed' }))?.isClosed, true));
add('Workable published', async () => assert.equal((await preflight('https://apply.workable.com/example/j/abc', { state: 'published' }))?.isClosed, false));
add('isolated preflight blocked', async () => assert.equal(await preflight('https://stripe.recruitee.com/o/job', {}), null));
const schema = { questions: [{ name: 'first_name', label: 'First name', type: 'text', required: true }] };
expect('direct grounded schema', () => canAttemptDirectHttpSubmit('https://jobs.ashbyhq.com/example/job', schema, profile).eligible, true);
expect('direct captcha blocked', () => canAttemptDirectHttpSubmit('https://jobs.ashbyhq.com/example/job', { ...schema, captchaRequired: true }, profile).eligible, false);
expect('direct untrusted host blocked', () => canAttemptDirectHttpSubmit('https://jobs.ashbyhq.com.attacker.test/example/job', schema, profile).eligible, false);
expect('direct isolated tenant blocked', () => canAttemptDirectHttpSubmit('https://stripe.recruitee.com/o/job', schema, profile).eligible, false);
add('multipart includes PDF', () => { const file = path.join(root, 'resume.pdf'); writeFileSync(file, '%PDF-1.4\nfixture'); assert(buildMultipartFormPayload({ first_name: 'Fixture' }, file).body.includes(Buffer.from('%PDF-'))); });

// 15 discovery and scheduling cases.
expect('freshness favors recent roles', () => computeJobSurvivalPriorityScore({ provider: 'ashby', publishedAt: now }, now).freshnessBonus > computeJobSurvivalPriorityScore({ provider: 'ashby', publishedAt: now - 86400000 }, now).freshnessBonus, true);
expect('future posting is not fresh', () => computeJobSurvivalPriorityScore({ provider: 'ashby', publishedAt: now + 1000 }, now).freshnessBonus, 0);
expect('greenhouse embed', () => extractEmbeddedAtsSlugsFromHtml('<script src="https://boards.greenhouse.io/embed/job_board?for=example"></script>')[0]?.slug, 'example');
expect('isolated embed blocked', () => extractEmbeddedAtsSlugsFromHtml('<a href="https://stripe.recruitee.com/o/job">x</a>').length, 0);
expect('Workday search tenant', () => buildWorkdayCxsSearchRequest('https://example.wd5.myworkdayjobs.com/en-US/Careers')?.endpointUrl, 'https://example.wd5.myworkdayjobs.com/wday/cxs/example/Careers/jobs');
expect('Workday isolated blocked', () => buildWorkdayCxsSearchRequest('https://stripe.wd5.myworkdayjobs.com/Careers'), null);
expect('Workday today', () => parseWorkdayPostedOnToIso('Posted Today', now), new Date(now).toISOString());
expect('Workday open-ended age', () => parseWorkdayPostedOnToIso('Posted 30+ Days Ago', now), null);
expect('CT staging excluded', () => extractAtsTenantsFromCtDomains(['example-staging.recruitee.com']).length, 0);
expect('CT candidate included', () => extractAtsTenantsFromCtDomains(['*.example.recruitee.com'])[0]?.tenant, 'example');
expect('Bengaluru tier', () => evaluateRoleEligibilityForCandidate({ title: 'Software Engineer', company: 'Example', location: 'Bengaluru' }).locationTier, 'BENGALURU_LOCAL');
expect('nontechnical title rejected', () => evaluateRoleEligibilityForCandidate({ title: 'Account Executive', company: 'Example', location: 'India' }).eligible, false);
expect('senior title rejected', () => evaluateRoleEligibilityForCandidate({ title: 'Senior Engineer', company: 'Example', location: 'India' }).eligible, false);
expect('role signature strips requisition', () => computeRoleDedupSignature('Example Inc', 'Engineer (Req #1)'), computeRoleDedupSignature('Example', 'Engineer'));
expect('role dedup expires', () => isDuplicateAppliedRoleWithinWindow('a', new Map([['a', now - 31 * 86400000]]), 30, now), false);

// Outreach and inbox cases.
const patchUrl = 'https://github.com/example/repo/commit/a.patch';
expect('patch author observed', () => extractVerbatimEmailsFromGitPatch('From: Fixture Person <fixture@example.test>', 'example.test', patchUrl).length, 1);
expect('patch role address rejected', () => extractVerbatimEmailsFromGitPatch('From: Careers <careers@example.test>', 'example.test', patchUrl).length, 0);
expect('npm author observed', () => extractVerbatimEmailsFromNpmPackument({ author: { name: 'Fixture', email: 'fixture@example.test' } }, 'example.test', 'https://registry.npmjs.org/example').length, 1);
expect('draft does not invent application', () => /I applied/.test(composePersonaOutreachEmail({ recipientName: 'Fixture', recipientRole: 'ENGINEERING_LEAD', companyName: 'Example', jobTitle: 'Engineer' }).bodyText), false);
expect('hard bounce', () => classifySmtpBounceReply(550, '5.1.1 no such user').category, 'HARD_INVALID_MAILBOX');
expect('greylist bounce', () => classifySmtpBounceReply(451, '4.7.1 greylist').category, 'GREYLISTED_OR_TRANSIENT');
expect('consumer domain', () => isDisposableOrFreeEmailDomain('gmail.com').isFreeConsumer, true);
expect('assessment link', () => extractOaAndInterviewSignalsFromEmail({ subject: 'Assessment', from: 'sender@example.test', bodyText: 'https://www.hackerrank.com/test/abc' }).category, 'OA_ASSESSMENT');
expect('OTP extraction', () => extractGreenhouse8CharOtpFromEmail('Code: A1B2C3D4', new Set()), 'A1B2C3D4');
expect('activation host spoof blocked', () => extractWorkdayActivationLinkFromEmail('https://example.wd5.myworkdayjobs.com.attacker.test/activate'), null);
add('mailbox lock serializes concurrent tasks and recovers after failure', async () => {
  let active = 0, maximum = 0;
  const results = await Promise.allSettled([0, 1, 2].map(index => withSingleFlightImapLock(String(index), async () => {
    maximum = Math.max(maximum, ++active);
    try {
      await new Promise(resolve => setTimeout(resolve, 1));
      if (index === 1) throw new Error('fixture');
    } finally { active--; }
  })));
  assert.equal(maximum, 1);
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected', 'fulfilled']);
});
add('null MX blocks delivery', async () => {
  const originalCwd = process.cwd(), originalResolve = dns.promises.resolveMx;
  try {
    process.chdir(root);
    dns.promises.resolveMx = (async () => [{ exchange: '.', priority: 0 }]) as typeof dns.promises.resolveMx;
    const result = await checkDomainMxDeliverability('canary-null.fixture.test');
    assert.equal(result.isNullMx, true);
    assert.equal(result.hasValidMx, false);
  } finally { dns.promises.resolveMx = originalResolve; process.chdir(originalCwd); }
});

// Infrastructure and resilience cases.
expect('memory critical', () => assessSystemMemoryPressure({ freeMemBytes: 500000000, rssBytes: 0 }).recommendedLaneCount, 1);
expect('memory elevated', () => assessSystemMemoryPressure({ freeMemBytes: 1500000000, rssBytes: 0 }).recommendedLaneCount, 2);
expect('personal browser protected', () => isSafeToReapChromeCommandLine('chrome --headless=new --user-data-dir=state/autoapply --profile-directory=Default'), false);
expect('retry-after seconds', () => parseRetryAfterHeaderMs('120', now), 120000);
expect('retry-after invalid', () => parseRetryAfterHeaderMs('not a date', now), null);
expect('throttle smooths latency', () => computeAutoThrottleDelayMs({ previousDelayMs: 4000, responseLatencyMs: 4000 }), 3000);
add('hot reload detects content changes', () => { const file = path.join(root, 'artifact.js'); writeFileSync(file, 'old'); const detector = new BatchBoundaryHotReloadDetector([file]); writeFileSync(file, 'new'); assert.equal(detector.hasBuildChangedOnDisk().changed, true); });
expect('extension profile fact', () => resolveDomFieldsForExtensionBrain([{ id: 'first', name: 'first', label: 'First Name', type: 'text' }], '', { profile, jobUrl: 'https://example.test/job' })[0]?.resolvedValue, 'Fixture');
expect('dashboard remote access denied', () => isTrustedDashboardRequest({ remoteAddress: '192.0.2.1', host: '127.0.0.1:4321', path: '/api/extension-brain' }, 'x'.repeat(40)), false);
expect('dashboard missing token denied', () => isTrustedDashboardRequest({ remoteAddress: '127.0.0.1', host: '127.0.0.1:4321', path: '/api/extension-brain' }, 'x'.repeat(40)), false);
add('SQLite recovery preserves ambiguous submissions', () => {
  const directory = path.join(root, 'recovery');
  mkdirSync(directory);
  const file = path.join(directory, 'queue.sqlite');
  const db = new DatabaseSync(file);
  const originalKill = process.kill;
  try {
    db.exec('CREATE TABLE applications(candidate_id TEXT,id TEXT,canonical_key TEXT,normalized_url TEXT,payload TEXT,status TEXT,owner TEXT,expires INTEGER); CREATE TABLE workers(owner TEXT,pid INTEGER,expires INTEGER); CREATE TABLE application_events(candidate_id TEXT,job_id TEXT,timestamp TEXT,phase TEXT,reason_code TEXT,step_index INTEGER);');
    const url = 'https://jobs.ashbyhq.com/fixture/job';
    const payload = JSON.stringify({ jobUrl: url, company: 'Fixture' });
    db.prepare('INSERT INTO workers VALUES(?,?,?)').run('fixture-worker', 999999, 0);
    const insert = db.prepare('INSERT INTO applications VALUES(?,?,?,?,?,?,?,?)');
    for (const id of ['safe', 'ambiguous']) insert.run('candidate', id, null, url, payload, 'applying', 'fixture-worker', now - 3600000);
    db.prepare('INSERT INTO application_events VALUES(?,?,?,?,?,?)').run('candidate', 'ambiguous', new Date(now).toISOString(), 'submit_clicked', null, null);
    const session = createHash('sha256').update(url).digest('hex').slice(0, 20);
    const checkpointDir = path.join(directory, 'applications', session);
    mkdirSync(checkpointDir, { recursive: true });
    writeFileSync(path.join(checkpointDir, 'checkpoint.json'), JSON.stringify({ applicationUrl: url, report: { recoveryGuardVersion: 1, submissionAttempted: false, credentialAttempts: [] } }));
    process.kill = ((pid: number, signal: string | number) => {
      if (pid === 999999) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      return originalKill(pid, signal as never);
    }) as typeof process.kill;
    assert.deepEqual(recoverStaleInProgressJobs(file, 15, 2, now).recoveredIds, ['safe']);
    assert.equal((db.prepare('SELECT status FROM applications WHERE id=?').get('ambiguous') as { status: string }).status, 'applying');
  } finally { process.kill = originalKill; db.close(); }
});
add('SQLite backup includes WAL changes', () => {
  const directory = path.join(root, 'backup');
  mkdirSync(directory);
  const file = path.join(directory, 'queue.sqlite');
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE applications(status TEXT, normalized_url TEXT); INSERT INTO applications VALUES('applied','https://jobs.ashbyhq.com/fixture/job')");
    const result = runSqliteMaintenanceAndBackup(file);
    assert.equal(result.integrityOk, true);
    assert.equal(result.backupCreated, true);
    const snapshot = new DatabaseSync(result.backupPath, { readOnly: true });
    try { assert.equal((snapshot.prepare('SELECT COUNT(*) AS count FROM applications').get() as { count: number }).count, 1); }
    finally { snapshot.close(); }
  } finally { db.close(); }
});

let failed = 0;
try {
  assert.equal(scenarios.length, 100, 'Canary matrix must contain exactly 100 scenarios');
  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i]!;
    try { await scenario.run(); }
    catch (error) { failed++; console.error(`[CANARY-100] ${i + 1}: ${scenario.label}: ${error instanceof Error ? error.message : String(error)}`); }
  }
} finally { globalThis.fetch = originalFetch; await browser?.close(); rmSync(root, { recursive: true, force: true }); }
const elapsed = performance.now() - start;
if (failed || elapsed >= 10000) {
  console.error(`[CANARY-100] ${100 - failed} / 100 passed; elapsed ${(elapsed / 1000).toFixed(2)}s`);
  process.exitCode = 1;
} else {
  console.error('[CANARY-100] Smoke scenarios passed; PDF geometry and live integration acceptance remain unverified.');
  process.exitCode = 1;
}
