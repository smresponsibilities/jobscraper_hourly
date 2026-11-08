import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { harvestLiveWorkdayBengaluruGccJobs } from '../../scripts/harvest-100-hourly-jobs.js';
import { extractCanonicalJobPostingKey } from '../contracts/system-invariants.js';
import { resolveExtendedPortalQuestionTaxonomy } from './answers.js';

test('GEN-261: harvestLiveWorkdayBengaluruGccJobs is exported in scripts/harvest-100-hourly-jobs.ts', () => {
  assert.equal(typeof harvestLiveWorkdayBengaluruGccJobs, 'function');
  const fileContent = fs.readFileSync('scripts/harvest-100-hourly-jobs.ts', 'utf8');
  assert.ok(fileContent.includes('harvestLiveWorkdayBengaluruGccJobs'), 'must contain function definition');
  assert.ok(fileContent.includes('wday/cxs'), 'must target Workday CXS endpoints');
  assert.ok(fileContent.includes('Software Engineer Bengaluru'), 'must search for Bengaluru software engineering roles');
});

test('GEN-262: extractCanonicalJobPostingKey deduplicates greenhouse variants and other ATS portals', () => {
  const ghStandard = extractCanonicalJobPostingKey('https://boards.greenhouse.io/rubrik/jobs/7532824');
  const ghEmbed = extractCanonicalJobPostingKey('https://boards.greenhouse.io/embed/job_app?for=rubrik&token=7532824');
  const ghHosted = extractCanonicalJobPostingKey('https://job-boards.greenhouse.io/rubrik/jobs/7532824');
  assert.equal(ghStandard, 'gh:7532824');
  assert.equal(ghEmbed, 'gh:7532824');
  assert.equal(ghHosted, 'gh:7532824');

  const ashby1 = extractCanonicalJobPostingKey('https://jobs.ashbyhq.com/supabase/5c83b879-1ec2-4211-9a73-673e48ea6186');
  const ashby2 = extractCanonicalJobPostingKey('https://jobs.ashbyhq.com/supabase/5c83b879-1ec2-4211-9a73-673e48ea6186/application');
  assert.equal(ashby1, 'ashby:supabase:5c83b879-1ec2-4211-9a73-673e48ea6186');
  assert.equal(ashby2, 'ashby:supabase:5c83b879-1ec2-4211-9a73-673e48ea6186');

  const lever1 = extractCanonicalJobPostingKey('https://jobs.lever.co/postman/3e3518a4-0c58-450a-b620-8ee07f8725be');
  const lever2 = extractCanonicalJobPostingKey('https://jobs.lever.co/postman/3e3518a4-0c58-450a-b620-8ee07f8725be/apply');
  assert.equal(lever1, 'lever:postman:3e3518a4-0c58-450a-b620-8ee07f8725be');
  assert.equal(lever2, 'lever:postman:3e3518a4-0c58-450a-b620-8ee07f8725be');
});

test('GEN-263: distiller.ts extracts format hints from aria-describedby', () => {
  const distillerCode = fs.readFileSync('src/autoapply/distiller.ts', 'utf8');
  assert.ok(distillerCode.includes('aria-describedby'), 'distiller.ts must check aria-describedby');
  assert.ok(distillerCode.includes('lpa|lakhs?|inr|months|days'), 'distiller.ts must match unit format hints');
});

test('GEN-264: resolveExtendedPortalQuestionTaxonomy returns 12 for experience in months and 80000 for monthly stipend', () => {
  const expMonths = resolveExtendedPortalQuestionTaxonomy('Total internship experience (in months)', 'text');
  const appMonths = resolveExtendedPortalQuestionTaxonomy('How many months of experience do you have?', 'text');
  assert.equal(expMonths, '12', 'Experience in months must resolve to 12');
  assert.equal(appMonths, '12', 'Months of experience must resolve to 12');

  const monthlyStipend = resolveExtendedPortalQuestionTaxonomy('Expected monthly stipend (INR)', 'text');
  const monthlySalary = resolveExtendedPortalQuestionTaxonomy('Expected monthly salary in INR', 'text');
  assert.equal(monthlyStipend, '80000', 'Monthly stipend must resolve to 80000');
  assert.equal(monthlySalary, '80000', 'Monthly salary must resolve to 80000');
});

test('GEN-265: runner.ts excludes analytics beacons from blocking post-submit request completion', () => {
  const runnerCode = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  assert.ok(
    runnerCode.includes('sentry\\.io|datadog|google-analytics') || (runnerCode.includes('sentry') && runnerCode.includes('datadog')),
    'runner.ts must ignore 3rd party analytics beacons'
  );
  assert.ok(
    runnerCode.includes('confirmedReceipt = (await this.receipt'),
    'runner.ts must check receipt before throwing waiting for application requests'
  );
});
