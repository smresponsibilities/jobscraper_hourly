import test from 'node:test';
import assert from 'node:assert/strict';
import { isSupportedDirectAtsJobUrl } from './preflight.js';
import { isWorkdayHostVerified, markWorkdayHostVerified } from './authentication.js';
import { resolveOvernightLearnedQuestions } from './self-learning.js';
import { resolveUniversalPermissiveFallback } from './permissive-fallback.js';

test('GEN-91: isSupportedDirectAtsJobUrl positive allowlist', () => {
  // Positive ATS URLs
  assert.equal(isSupportedDirectAtsJobUrl('https://boards.greenhouse.io/anthropic/jobs/1234567'), true);
  assert.equal(isSupportedDirectAtsJobUrl('https://boards.greenhouse.io/embed/job_app?token=1234567'), true);
  assert.equal(isSupportedDirectAtsJobUrl('https://jobs.ashbyhq.com/scale/b8e051a8-1234'), true);
  assert.equal(isSupportedDirectAtsJobUrl('https://jobs.lever.co/palantir/5f8e02d1-5678'), true);
  assert.equal(isSupportedDirectAtsJobUrl('https://cisco.wd5.myworkdayjobs.com/en-US/CiscoCareers/job/Bengaluru/SWE_R12345'), true);
  assert.equal(isSupportedDirectAtsJobUrl('https://jobs.smartrecruiters.com/Square/7439999-swe'), true);

  // Negative / Aggregator / Unsupported Portals
  assert.equal(isSupportedDirectAtsJobUrl('https://www.ycombinator.com/companies/apollo/jobs/123'), false);
  assert.equal(isSupportedDirectAtsJobUrl('https://www.linkedin.com/jobs/view/4012345678'), false);
  assert.equal(isSupportedDirectAtsJobUrl('https://tatacapital.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/12345'), false);
  assert.equal(isSupportedDirectAtsJobUrl('https://morganstanley.eightfold.ai/careers/job/12345'), false);
  assert.equal(isSupportedDirectAtsJobUrl('https://jobs.adani.com/job/123'), false);
  assert.equal(isSupportedDirectAtsJobUrl('https://datavail.com/careers/openings/123'), false);
  assert.equal(isSupportedDirectAtsJobUrl('https://example.turbohire.co/jobs/123'), false);
  assert.equal(isSupportedDirectAtsJobUrl(''), false);
});

test('GEN-93: Workday Host Verification tracking', () => {
  const testHost = `test-tenant-${Date.now()}.wd3.myworkdayjobs.com`;
  assert.equal(isWorkdayHostVerified(testHost), false);
  markWorkdayHostVerified(testHost);
  assert.equal(isWorkdayHostVerified(testHost), true);
});

test('GEN-94.1: Single-Option Dropdown Auto-Select', () => {
  const result = resolveOvernightLearnedQuestions(
    'Please submit a PDF version of your resume',
    'SINGLE_SELECT',
    ['Select...', 'I have submitted a PDF version of my resume.'],
    {}
  );
  assert.equal(result, 'I have submitted a PDF version of my resume.');
});

test('GEN-94.2: Social Profile Links Auto-Fill / Skip', () => {
  const twitterRes = resolveOvernightLearnedQuestions('Twitter Profile URL', 'INPUT', null, {});
  assert.equal(twitterRes, 'https://github.com/smresponsibilities');

  const fbRes = resolveOvernightLearnedQuestions('Facebook Link', 'INPUT', null, {});
  assert.equal(fbRes, 'https://github.com/smresponsibilities');
});

test('GEN-94.3: GitLab RBAC vs Flextrade FIX Protocol', () => {
  // RBAC -> Yes
  const rbacRes = resolveOvernightLearnedQuestions(
    'Do you have hands-on experience with authorization concepts (RBAC)?',
    'RADIO',
    ['Yes', 'No'],
    {}
  );
  assert.equal(rbacRes, 'Yes');

  // FIX Protocol -> No
  const fixRes = resolveOvernightLearnedQuestions(
    'Do you have experience with the FIX Protocol?',
    'RADIO',
    ['Yes', 'No'],
    {}
  );
  assert.equal(fixRes, 'No');
});

test('GEN-94.4: ERP / Accounting Checkbox Group Auto-Heal', () => {
  const erpRes = resolveOvernightLearnedQuestions(
    'Which accounting/ERP systems have you used?',
    'CHECKBOX',
    ['NetSuite', 'SAP', 'QuickBooks', 'None of the above'],
    {}
  );
  assert.equal(erpRes, 'None of the above');
});
