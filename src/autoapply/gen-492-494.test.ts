import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'patchright';
import { AutoApplyRunner, ensureStepReadyBeforeNext } from './runner.js';
import { sha256 } from './submission.js';
import { resolveCandidateAnswer } from './answers.js';
import { resolveUniversalPermissiveFallback } from './permissive-fallback.js';
import { inferAnswerFromOptionSignature, resolveBySemanticSelfLearning } from './self-learning.js';
import { employerPublishedAt, isEmployerHourlyFresh } from '../sources/realtime-ats-delta-fetcher.js';
import { extractJobTimestampMs, computeJobPriorityScore } from './priority-scheduler.js';
import { buildDynamicResumePlanForJd, compileRuntimeTailoredResumeForJob, inspectPdfPageCount,
  rankMorganStanleyBulletsForJd, selectTop3ProjectsForJd, verifyNoKeywordStuffing, generateResumeHtml } from '../resume/deterministic-builder.js';

const now = Date.parse('2026-11-11T12:00:00Z');
test('unprovided facts and consent are not guessed', () => {
  const profile = { personal: { firstName: 'Test', lastName: 'User', email: 'test@example.test', country: 'India' }, education: [], experience: [], professional: {}, workAuthorization: {}, eeo: {} } as any;
  for (const question of ['What is your expected salary?', 'What is your GPA?', 'How many years of full-time experience?', 'Can you start immediately?', 'Do you agree to arbitration?']) {
    assert.equal(resolveCandidateAnswer('unknown', profile, { url: 'https://jobs.lever.co/example/123', question }).value, undefined, question);
    assert.equal(resolveUniversalPermissiveFallback({ questionText: question, widgetKind: 'CHECKBOX', options: ['Yes', 'No'] }), undefined);
    assert.equal(resolveBySemanticSelfLearning(question, 'CHECKBOX', ['Yes', 'No'], null, profile), null);
  }
  assert.equal(inferAnswerFromOptionSignature('Salary range', ['1 LPA', '12 LPA']), null);
});
test('GEN-493 employer timestamps survive all seven API field shapes', () => {
  for (const key of ['updated_at', 'publishedAt', 'createdAt', 'releasedDate', 'published_on', 'published_at', 'published_date']) {
    assert.equal(employerPublishedAt({ [key]: key === 'createdAt' ? now : new Date(now).toISOString() }), new Date(now).toISOString());
  }
  assert.equal(employerPublishedAt({ updated_at: 'invalid', publishedAt: new Date(now).toISOString() }), new Date(now).toISOString());
  assert.equal(employerPublishedAt({ createdAt: now / 1000 }), new Date(now).toISOString());
  assert.equal(employerPublishedAt({ createdAt: String(now / 1000) }), new Date(now).toISOString());
  assert.equal(employerPublishedAt({ discoveredAt: new Date(now).toISOString() }), undefined);
  for (const value of [undefined, 'invalid', new Date(now + 1).toISOString(), new Date(now - 86400001).toISOString()]) assert.equal(isEmployerHourlyFresh(value, now), false);
  assert.equal(isEmployerHourlyFresh(new Date(now - 86400000).toISOString(), now), true);
});

test('GEN-494 real employer dates outrank discovery, stale freshness flags cannot win', () => {
  const base = { id: 'job', title: 'Software Engineer', company: 'Example', url: 'https://jobs.lever.co/example/123/apply', discoveredAt: new Date(now).toISOString(), isHourlyFresh: true };
  const old = { ...base, payload: { publishedAt: '2026-06-01T00:00:00Z', scrapedAt: new Date(now).toISOString() } };
  const fresh = { ...base, payload: { publishedAt: new Date(now - 3600000).toISOString() } };
  const dayOld = { ...base, payload: { publishedAt: new Date(now - 86400000).toISOString() } };
  assert.ok(computeJobPriorityScore(dayOld, now) > computeJobPriorityScore(base, now));
  assert.equal(computeJobPriorityScore({ ...dayOld, isHourlyFresh: 0 }, now), computeJobPriorityScore(dayOld, now));
  assert.equal(extractJobTimestampMs(old).timestampMs, Date.parse(old.payload.publishedAt));
  assert.equal(extractJobTimestampMs({ ...base, payload: { postedAt: String(now / 1000) } }).timestampMs, now);
  assert.ok(computeJobPriorityScore(fresh, now) > computeJobPriorityScore(old, now) + 18000);
  assert.equal(extractJobTimestampMs({ ...base, payload: { postedAt: 'bad', updated_at: fresh.payload.publishedAt } }).source, 'updated_at');
  assert.equal(computeJobPriorityScore({ ...base, isHourlyFresh: false }, now), computeJobPriorityScore(base, now));
  assert.equal(computeJobPriorityScore({ ...fresh, isHourlyFresh: 3 }, now), computeJobPriorityScore(fresh, now));
  assert.equal(computeJobPriorityScore({ ...base, payload: { publishedAt: new Date(now + 1000).toISOString() } }, now), computeJobPriorityScore(base, now));
  assert.equal(computeJobPriorityScore({ ...base, payload: { isReposted: true, dateBumpedAt: 'invalid' } }, now), computeJobPriorityScore(base, now));
});

test('GEN-492 ranks experience and all eight projects from job text without adding skills', () => {
  assert.match(rankMorganStanleyBulletsForJd('Data Engineer', 'Kafka PySpark Snowflake')[0]!, /5,000,000/);
  assert.match(rankMorganStanleyBulletsForJd('Backend Java Spring Boot', 'REST OAuth')[0]!, /Java Spring Boot/);
  assert.match(rankMorganStanleyBulletsForJd('DevOps Jenkins CI/CD', 'Maven release')[0]!, /Jenkins/);
  assert.match(rankMorganStanleyBulletsForJd('React TypeScript Node.js', '')[0]!, /full-stack/);
  assert.equal(selectTop3ProjectsForJd('Android Kotlin Jetpack Compose', '')[0]!.title, 'Productivity Caller');
  assert.ok(Object.values(buildDynamicResumePlanForJd('Android Developer', 'Kotlin Jetpack Compose').skillLines).flat().includes('Kotlin'));
  assert.equal(selectTop3ProjectsForJd('Astro GitHub Actions Python', '')[0]!.title, "SM'S DEX");
  const plan = buildDynamicResumePlanForJd('Backend Developer', 'Python Spring Boot');
  assert.equal(plan.selectedProjects.length, 3);
  assert.equal(plan.skillLines.Languages![0], 'Python');
  const html = generateResumeHtml({} as any, plan.archetype, 'Backend Developer', 'Python Spring Boot');
  for (const project of plan.selectedProjects) assert.ok(html.includes(project.stack));
  assert.equal(verifyNoKeywordStuffing('python '.repeat(5) + Array.from({ length: 500 }, (_, i) => `unique${i}`).join(' '), 0.02, 4).clean, false);
});

test('GEN-492 compiles actual one-page PDF and DOCX using existing browser context', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  try {
    const started = performance.now();
    const profile = { personal: { firstName: 'Shivam', lastName: 'Mahajan', email: 'test@example.com' } } as any;
    const [result, second] = await Promise.all([
      compileRuntimeTailoredResumeForJob({ jobId: 'gen-492-test/../../job', jobTitle: 'Data Engineer', jdText: 'Kafka PySpark Snowflake', browser: context, profile }),
      compileRuntimeTailoredResumeForJob({ jobId: 'gen-492-test/../../job', jobTitle: 'Android Kotlin', jdText: 'Jetpack Compose', browser: context, profile }),
    ]);
    assert.equal(path.basename(result.pdfPath), 'Shivam_Mahajan_Resume.pdf');
    assert.equal(inspectPdfPageCount(fs.readFileSync(result.pdfPath)), 1);
    assert.equal(fs.readFileSync(result.docxPath).subarray(0, 2).toString(), 'PK');
    const AdmZip = createRequire(import.meta.url)('adm-zip');
    const documentXml: string = new AdmZip(result.docxPath).readAsText('word/document.xml');
    const docText = documentXml.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&');
    const plan = buildDynamicResumePlanForJd('Data Engineer', 'Kafka PySpark Snowflake');
    const html = generateResumeHtml(profile, plan.archetype, 'Data Engineer', 'Kafka PySpark Snowflake');
    for (const bullet of plan.morganStanleyBullets) { assert.ok(docText.includes(bullet)); assert.ok(html.includes(bullet)); }
    for (const project of plan.selectedProjects) {
      assert.ok(docText.includes(project.title));
      assert.ok(docText.includes(project.stack));
      assert.ok(html.includes(project.title));
      assert.ok(html.includes(project.stack));
    }
    for (const skills of Object.values(plan.skillLines)) for (const skill of skills) { assert.ok(docText.includes(skill)); assert.ok(html.includes(skill)); }
    assert.equal(context.pages().length, 0);
    assert.equal(result.verifiedClean, true);
    assert.notEqual(result.pdfPath, second.pdfPath);
    assert.notDeepEqual(fs.readFileSync(result.pdfPath), fs.readFileSync(second.pdfPath));
    const page = await context.newPage();
    await page.setContent('<label>Resume<input type="file" name="resume" accept=".pdf"></label>');
    const input = page.locator('input');
    await input.setInputFiles(second.pdfPath);
    const runner = new AutoApplyRunner() as any;
    await runner.ensureResumeUploadedBeforeSubmit(page, result.pdfPath);
    const bytes = await input.evaluate(async el => Array.from(new Uint8Array(await (el as HTMLInputElement).files![0]!.arrayBuffer())));
    assert.equal(sha256(Buffer.from(bytes)), sha256(fs.readFileSync(result.pdfPath)));
    await page.setContent('<label>Resume<input type="file" name="resume" accept=".docx"></label>');
    await page.locator('input').setInputFiles(second.docxPath);
    await ensureStepReadyBeforeNext(page.mainFrame(), result.pdfPath);
    const docxBytes = await page.locator('input').evaluate(async el => Array.from(new Uint8Array(await (el as HTMLInputElement).files![0]!.arrayBuffer())));
    assert.equal(sha256(Buffer.from(docxBytes)), sha256(fs.readFileSync(result.docxPath)));
    await page.close();
    console.log(`Runtime compile measured ${Math.round(performance.now() - started)}ms`);
  } finally { await context.close(); await browser.close(); }
});
