import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { AutoApplyRunner } from './runner.js';
import { resolveDynamicQuestion, matchBestOption } from './aihawk.js';

test('option aliases preserve known facts and reject unrelated fallbacks', () => {
  assert.equal(matchBestOption('Mr.', [{ value: 'mr', label: 'Mr' }])?.value, 'mr');
  assert.equal(matchBestOption('Mobile', [{ value: 'cell', label: 'Cellular' }])?.value, 'cell');
  assert.equal(matchBestOption('Bangalore', [{ value: 'blr', label: 'Bengaluru' }])?.value, 'blr');
  assert.equal(matchBestOption('BE', [{ value: 'be', label: 'Bachelor of Engineering' }])?.value, 'be');
  assert.equal(matchBestOption('BE', [{ value: 'bt', label: 'Bachelor of Technology' }]), null);
  assert.equal(matchBestOption('Mobile', [{ value: 'home', label: 'Home' }]), null);
  assert.equal(matchBestOption('Chitkara University', [{ value: 'other', label: 'Other' }]), null);
  assert.equal(matchBestOption('Company Website', [{ value: 'linkedin', label: 'LinkedIn' }]), null);
});
import { classifyAtsField, resolveExtendedProfileValue } from './classifier.js';
import { AutoaplyQueueManager } from './autoaply.js';
import type { CandidateExtendedProfile } from './types.js';

const profile: CandidateExtendedProfile = {
  personal: { firstName: 'Test', lastName: 'Candidate', email: 'test@example.test', phone: '123', country: 'India' },
  education: [], experience: [],
  professional: { totalYearsExperience: 0, noticePeriodDays: 0, willingToRelocate: false, workPreference: 'remote' },
  workAuthorization: { authorizedInCountry: false, requiresSponsorshipNowOrFuture: true, formerEmployee: false, hasNonCompete: false, hasSecurityClearance: false, felonyConviction: true },
  eeo: { gender: 'Prefer not to say', raceOrEthnicity: '', isHispanicLatino: false, veteranStatus: 'Prefer not to say', disabilityStatus: 'Prefer not to say' },
};

test('observed misspelled expected CTC remains distinct from current salary', () => {
  assert.equal(classifyAtsField({ label: 'What is your excepected CTC?' }).category, 'expected_salary');
  assert.equal(classifyAtsField({ label: 'What is your current CTC?' }).category, 'current_salary');
});

test('dialing codes match an exact country-label suffix and never a numeric substring', () => {
  const india = { value: 'IN', label: 'India (+91)' };
  assert.equal(matchBestOption('+91', [india]), india);
  assert.equal(matchBestOption('+1', [india]), null);
  assert.equal(matchBestOption('+1', [{ value: 'US', label: 'United States (+1)' }, { value: 'CA', label: 'Canada (+1)' }]), null);
});

test('unknown questions, consent, dates and salary are never invented', () => {
  for (const question of ['Do you consent to a background check?', 'Are you 18 years of age?', 'Can you work weekends?', 'Years of experience with Rust?', 'Anything else?']) {
    assert.equal(resolveDynamicQuestion(question, profile).value, undefined);
  }
  assert.equal(resolveDynamicQuestion('Years of experience?', profile).value, 0);
  assert.equal(resolveDynamicQuestion('Have you been convicted of a felony?', profile).value, true);
  assert.equal(resolveDynamicQuestion('Expected salary?', profile).value, undefined);
  for (const category of ['date_year', 'date_month', 'date_day', 'disability_signature_name', 'disability_signature_date'] as const) {
    assert.equal(resolveExtendedProfileValue(category, profile), undefined);
  }
});

test('option matching rejects arbitrary options and negated authorization', () => {
  assert.equal(matchBestOption('India', [{ value: 'us', label: 'United States' }]), null);
  assert.equal(matchBestOption(true, [{ value: 'no', label: 'Not authorized' }]), null);
  assert.equal(matchBestOption(false, [{ value: 'no', label: 'No' }])?.value, 'no');
});

test('queue never records an unsubmitted fill or dry run as applied', async () => {
  for (const [status, dryRun] of [['completed', false], ['submitted', true], ['paused_for_review', false]] as const) {
    const queue = new AutoaplyQueueManager();
    const job = queue.enqueue({ externalJobId: '1', title: 'Engineer', company: 'Test', jobUrl: 'https://example.test/job', postedAt: new Date().toISOString() });
    const result = await queue.processNext({ run: async () => ({ status, fieldsFilled: 1, unmappedFields: 0 }) }, profile, 'copilot', dryRun);
    assert.equal(result.status, dryRun ? 'inspected' : 'paused_for_review');
    assert.equal(job.status, dryRun ? 'queued' : 'paused_for_review');
    assert.equal(queue.getMetrics().totalApplied, 0);
  }
});

test('browser fill handles false radio/checkbox, unusual IDs, empty pages and dry-run next buttons', async () => {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(req.url === '/empty' ? '<p>No application available</p>' : `
      <label for='email:input'>Email</label><input id='email:input'>
      <label>Authorized to work? <input type='radio' name='work_authorization' value='yes'>Yes</label>
      <label>Authorized to work? <input type='radio' name='work_authorization' value='no'>No</label>
      <label>Willing to relocate<input type='checkbox' name='relocate' checked></label>
      <label>Background check consent<input type='checkbox' id='consent'></label>
      <button data-automation-id='bottom-navigation-next-button' onclick="document.body.dataset.advanced='yes'">Next</button>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const runner = new AutoApplyRunner();
  // Keep the owned page open for assertions, then explicitly close it.
  const pageOf = () => (runner as unknown as { page: import('playwright').Page }).page;
  try {
    await runner.initBrowser(true);
    const dry = await runner.run({ url: base + '/?workday=myworkdayjobs.com', profile, dryRun: true, headless: false, mode: 'stealth' });
    assert.equal(dry.fieldsFilled, 0);
    assert.equal(await pageOf().locator('body').getAttribute('data-advanced'), null);
    assert.equal(await pageOf().locator('[id="email:input"]').inputValue(), '');
    const filled = await runner.run({ url: base, profile, applicationCountry: 'India', headless: false });
    assert.equal(filled.status, 'paused_for_review');
    assert.equal(await pageOf().locator('[id="email:input"]').inputValue(), profile.personal.email);
    assert.equal(await pageOf().locator('[value="no"]').isChecked(), true);
    assert.equal(await pageOf().locator('[value="yes"]').isChecked(), false);
    assert.equal(await pageOf().locator('[name="relocate"]').isChecked(), false);
    assert.equal(await pageOf().locator('#consent').isChecked(), false);
    const empty = await runner.run({ url: base + '/empty', profile, headless: false });
    assert.equal(empty.status, 'paused_for_review');
    assert.equal(empty.fieldsFilled, 0);
    assert(!empty.logs.some(line => line.includes('test@example.test')));
    await pageOf().setContent(`<label>Email<input name="email"></label>
      <label>Expected salary<input name="expected_salary"></label>
      <label>Background check consent<input type="checkbox" id="consent"></label>
      <label>Race<input name="race"></label>`);
    await pageOf().addScriptTag({ content: `window.chrome = { runtime: { onMessage: {
      addListener: function(listener) { window.extensionListener = listener; }
    } } };` });
    await pageOf().addScriptTag({ path: 'extension/content/content.js' });
    // The extension executes in the main world; Patchright evaluates in isolation.
    await pageOf().addScriptTag({ content: `window.extensionListener({type:'AUTOFILL_FORM',profile:${JSON.stringify(profile)}},{},result=>document.documentElement.dataset.extensionResult=JSON.stringify(result));` });
    await pageOf().waitForFunction(() => Boolean(document.documentElement.dataset.extensionResult));
    const response = await pageOf().evaluate(() => JSON.parse(document.documentElement.dataset.extensionResult!) as { count: number; errors: unknown[] });
    assert.equal(response.errors.length, 0);
    assert.equal(await pageOf().locator('[name="email"]').inputValue(), profile.personal.email);
    assert.equal(await pageOf().locator('[name="expected_salary"]').inputValue(), '');
    assert.equal(await pageOf().locator('[name="race"]').inputValue(), '');
    assert.equal(await pageOf().locator('#consent').isChecked(), false);
  } finally {
    await runner.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

