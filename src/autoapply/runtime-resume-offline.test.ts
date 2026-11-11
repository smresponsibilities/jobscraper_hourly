import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AutoApplyRunner } from './runner.js';
import { sha256 } from './submission.js';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('offline direct ATS resume replaces a stale selected file on resumed review', { timeout: 120000 }, async () => {
  const runner = new AutoApplyRunner();
  await runner.initBrowser(true);
  const internals = runner as any;
  const context = internals.context;
  const url = 'https://jobs.ashbyhq.com/offline-fixture/123/application';
  await context.route('**/*', async (route: any) => {
    if (route.request().url().startsWith('https://jobs.ashbyhq.com/offline-fixture/123')) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<div class="job-description">Build Kafka PySpark Snowflake pipelines.</div><label>Resume<input type="file" name="resume" required accept=".pdf"></label><button type="button">Next</button>' });
    } else await route.abort();
  });
  const profile = { personal: { firstName: 'Synthetic', lastName: 'Candidate', email: 'test@example.test', country: 'India' }, education: [], experience: [], professional: {}, workAuthorization: {}, eeo: {} } as any;
  try {
    const initial = await runner.run({ url, jobId: 'offline-resume-review', profile, applicationBrief: { title: 'Data Engineer', text: 'Kafka PySpark Snowflake' } as any, headless: true, keepOpen: true, maxSteps: 1 });
    assert.notEqual(initial.reason, 'unsupported_non_direct_ats_url');
    const page = internals.page;
    const input = page.locator('input[type=file]');
    await input.setInputFiles({ name: 'Shivam_Mahajan_Resume.pdf', mimeType: 'application/pdf', buffer: Buffer.from('old resume') });
    const resumed = await runner.run({ url, jobId: 'offline-resume-review', profile, applicationBrief: { title: 'Data Engineer', text: 'Kafka PySpark Snowflake' } as any, headless: true, keepOpen: true, maxSteps: 1, resume: true, preserveReviewedValues: true });
    const bytes = await input.evaluate(async (el: HTMLInputElement) => Array.from(new Uint8Array(await el.files![0]!.arrayBuffer())));
    assert.notEqual(sha256(Buffer.from(bytes)), sha256('old resume'));
    assert.ok(resumed.actions.some(action => action.documentHash === sha256(Buffer.from(bytes))));
    assert.equal(resumed.submissionAttempted, undefined);
  } finally { await runner.close(); }
});

test('ambiguous checkpoint survives retry without resubmitting', { timeout: 60000 }, async () => {
  const runner = new AutoApplyRunner();
  const sessionDir = mkdtempSync(path.join(tmpdir(), 'resume-checkpoint-'));
  const url = 'https://jobs.ashbyhq.com/offline-fixture/ambiguous/application';
  const checkpoint = path.join(sessionDir, 'checkpoint.json');
  writeFileSync(checkpoint, JSON.stringify({ jobId: 'ambiguous', applicationUrl: url, currentUrl: url, report: { submissionAttempted: true, actions: [], logs: [] } }));
  await runner.initBrowser(true);
  await (runner as any).context.route('**/*', (route: any) => route.abort());
  const profile = { personal: { firstName: 'Synthetic', lastName: 'Candidate', email: 'test@example.test', country: 'India' }, education: [], experience: [], professional: {}, workAuthorization: {}, eeo: {} } as any;
  try {
    const report = await runner.run({ url, jobId: 'ambiguous', profile, sessionDir, retryReviewed: true, headless: true });
    assert.equal(report.status, 'paused_for_review');
    assert.equal(report.submissionAttempted, true);
    assert.equal(report.receipt, undefined);
    assert.equal(JSON.parse(readFileSync(checkpoint, 'utf8')).report.submissionAttempted, true);
  } finally { await runner.close(); }
});
