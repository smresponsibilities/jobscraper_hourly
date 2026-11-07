import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { canonicalEmployerKey } from './identity.js';
import { resolveCandidateAnswer } from './answers.js';
import { AutoaplyQueueManager } from './autoaply.js';
import { AutoApplyRunner } from './runner.js';
import { startReviewDashboard } from './dashboard.js';
import type { CandidateExtendedProfile } from './types.js';
import type { Page } from 'patchright';
import { createServer } from 'node:http';

const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: {}, education: [], experience: [], workAuthorization: {}, eeo: {} } as unknown as CandidateExtendedProfile;

test('company identity groups tenants and isolates unresolved public ATS routes', () => {
  assert.equal(canonicalEmployerKey('https://abb.wd3.myworkdayjobs.com/en-US/jobs/job/India/Engineer_JR1'), canonicalEmployerKey('https://abb.wd3.myworkdayjobs.com/en-US/jobs/job/India/Engineer_JR2'));
  assert.notEqual(canonicalEmployerKey('https://jobs.ashbyhq.com/one/role'), canonicalEmployerKey('https://jobs.ashbyhq.com/two/role'));
  assert.notEqual(canonicalEmployerKey('https://apply.workable.com/j/AAA/'), canonicalEmployerKey('https://apply.workable.com/j/BBB/'));
  assert.equal(canonicalEmployerKey('https://apply.workable.com/j/AAA/', 'workable:known-company:AAA'), 'workable:known-company');
});

test('company answers carry across its roles while role overrides and conflicts stay scoped', () => {
  const question = 'Why apply?';
  const candidate = { ...profile, answers: [
    { scope: 'EMPLOYER_SCOPED' as const, employerKey: 'ashby:one', question, value: 'Company facts' },
    { scope: 'EMPLOYER_SCOPED' as const, employerKey: 'ashby:one', requisitionKey: 'ashby:one:role-a', question, value: 'Role A answer' },
  ] };
  const answer = (company: string, role: string) => resolveCandidateAnswer('unknown', candidate, { url: `https://jobs.ashbyhq.com/${company}/${role}`, question });
  assert.equal(answer('one', 'role-a').value, 'Role A answer');
  assert.equal(answer('one', 'role-b').value, 'Company facts');
  assert.equal(answer('two', 'role-a').value, undefined);
  candidate.answers.push({ ...candidate.answers[1]!, value: 'Conflicting role answer' });
  assert.equal(answer('one', 'role-a').reason, 'conflicting_saved_answers');
  assert.equal(answer('one', 'role-b').value, 'Company facts');
});

test('dispatch completes an available company batch with distinct receipts and retains approval boundaries', async () => {
  const queue = new AutoaplyQueueManager({ candidateId: 'fixture', statePath: path.join(mkdtempSync(path.join(tmpdir(), 'company-queue-')), 'queue.sqlite') });
  const urls = ['https://jobs.ashbyhq.com/one/a', 'https://jobs.ashbyhq.com/two/a', 'https://jobs.ashbyhq.com/one/b'];
  try {
    for (const [index, jobUrl] of urls.entries()) queue.enqueue({ externalJobId: `fixture-${index}`, jobUrl, company: 'Same display name', title: 'Engineer', postedAt: new Date(Date.now() - index * 1000).toISOString() });
    const unauthorized = queue.enqueue({ externalJobId: 'unauthorized', jobUrl: 'https://jobs.ashbyhq.com/one/c', company: 'Same display name', title: 'Engineer', postedAt: new Date().toISOString() });
    const visited: string[] = [];
    const runner = { run: async (options: { url: string }) => { visited.push(options.url); return { status: 'submitted', fieldsFilled: 1, unmappedFields: 0, receipt: { url: options.url + '/confirmation', text: 'Application submitted', verifiedAt: new Date().toISOString() } }; } };
    for (let count = 0; count < 3; count++) assert.equal((await queue.processNext(runner, profile, 'stealth', false, true, job => urls.includes(job.jobUrl))).processed, true);
    assert.deepEqual(visited, [urls[0], urls[2], urls[1]]);
    const applied = queue.list().filter(job => job.status === 'applied');
    assert.equal(applied.length, 3);
    assert.equal(new Set(applied.map(job => job.receipt?.url)).size, 3);
    assert.equal(queue.list().find(job => job.id === unauthorized.id)?.status, 'queued');
  } finally { queue.close(); }
});

test('review dashboard groups companies and saves shared or role-specific answers explicitly', async () => {
  const saved: unknown[] = [];
  const cards = [
    { id: 'a1', employerKey: 'ashby:one', company: 'Same name', title: 'Role 1', questions: ['Shared question'] },
    { id: 'a2', employerKey: 'ashby:one', company: 'Same name', title: 'Role 2', questions: ['Shared question'] },
    { id: 'b1', employerKey: 'ashby:two', company: 'Same name', title: 'Role 3', questions: ['Shared question'] },
  ];
  const dashboard = await startReviewDashboard({ cards: () => cards, jobs: () => cards.map(card => ({ ...card, status: 'paused_for_review' })), open: async () => {}, resume: () => {}, step: () => {}, answer: (...args) => { saved.push(args); } });
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const page = (runner as unknown as { page: Page }).page;
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(dashboard.url);
    await page.locator('.company-group').nth(1).waitFor();
    assert.equal(await page.locator('.company-group').count(), 2);
    const company = page.locator('.company-group').first();
    assert.equal(await company.getByRole('heading', { name: 'Answer once for this company' }).count(), 1);
    await company.locator('textarea').first().fill('yes');
    const shared = page.waitForResponse(response => response.url().endsWith('/api/answer'));
    await company.getByRole('button', { name: 'Save for company', exact: true }).click(); await shared;
    assert.deepEqual(saved[0], ['a1', 'Shared question', true, 'company']);
    const role = company.locator('article').nth(1);
    await role.locator('summary').click(); await role.locator('textarea').fill('no');
    const specific = page.waitForResponse(response => response.url().endsWith('/api/answer'));
    await role.getByRole('button', { name: 'Save for this role' }).click(); await specific;
    assert.deepEqual(saved[1], ['a2', 'Shared question', false, 'role']);
    assert.equal(await page.locator('#history td[rowspan="2"]').count(), 1);
    assert.deepEqual(errors, []);
  } finally { await runner.close(); await dashboard.close(); }
});

for (const scenario of [{ reuse: false, unknown: false }, { reuse: true, unknown: false }, { reuse: true, unknown: true }]) {
  test(`native prior-application reuse=${scenario.reuse} still validates role answers, unknown=${scenario.unknown}`, async () => {
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      const form = `<div data-automation-id="formField-email"><label>Email<input id="email" type="email" value="old@example.test" required></label></div>${scenario.unknown ? '<div data-automation-id="formField-motivation"><label>Motivation for this role<textarea required>Previous role essay</textarea></label></div>' : ''}<button>Submit application</button>`;
      response.end(`<div id="entry"><button onclick="enter('manual')">Apply Manually</button><button onclick="enter('reuse')">Use My Last Application</button></div><script>function enter(kind){document.documentElement.dataset.entry=kind;document.querySelector('#entry').innerHTML=${JSON.stringify(form)}}</script>`);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert(address && typeof address !== 'string');
    const runner = new AutoApplyRunner();
    try {
      await runner.initBrowser(true);
      const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile, reuseCompanyApplication: scenario.reuse, submit: scenario.unknown, headless: false });
      const page = (runner as unknown as { page: Page }).page;
      assert.equal(await page.locator('html').getAttribute('data-entry'), scenario.reuse ? 'reuse' : 'manual');
      assert.equal(await page.locator('#email').inputValue(), profile.personal.email);
      assert.equal(!!report.submissionAttempted, false);
      if (scenario.unknown) assert(report.actions.some(action => action.status === 'failed' && /Motivation/.test(action.question || '')));
      else assert.match(report.reason || '', /Ready for submission review/);
    } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
}
