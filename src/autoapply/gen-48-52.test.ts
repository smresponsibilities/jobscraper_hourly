import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isStrictlyIsolatedTenant,
  isEligibleEngineeringRoleTitle,
  computeJobPriorityScore,
} from './priority-scheduler.js';
import {
  unwrapDirectAtsApplicationUrl,
  isOfflineDinoPage,
} from './url-unwrapper.js';
import {
  fillAsyncLocationCombobox,
  selectAshbyYesNoOrCheckboxGroup,
} from './widgets.js';
import { resolveOvernightLearnedQuestions } from './self-learning.js';
import { resolveCandidateAnswer } from './answers.js';

test('GEN-48: isStrictlyIsolatedTenant rejects Stripe, Avoca, SS&C, PayPal', () => {
  assert.equal(isStrictlyIsolatedTenant('Stripe', 'https://jobs.lever.co/stripe/123'), true);
  assert.equal(isStrictlyIsolatedTenant('Avoca', 'https://boards.greenhouse.io/avoca/123'), true);
  assert.equal(isStrictlyIsolatedTenant('PayPal', 'https://paypal.wd1.myworkdayjobs.com/jobs'), true);
  assert.equal(isStrictlyIsolatedTenant('SS&C Technologies', 'https://ssctech.wd1.myworkdayjobs.com/jobs'), true);
  assert.equal(isStrictlyIsolatedTenant('DoorDash', 'https://boards.greenhouse.io/doordash/123'), false);
  assert.equal(isStrictlyIsolatedTenant('Databricks', 'https://databricks.com/jobs?gh_jid=123'), false);
});

test('GEN-48: isEligibleEngineeringRoleTitle filters non-engineering and senior roles', () => {
  // Ineligible
  assert.equal(isEligibleEngineeringRoleTitle('Full-Stack Marketer').eligible, false);
  assert.equal(isEligibleEngineeringRoleTitle('Scrum Master').eligible, false);
  assert.equal(isEligibleEngineeringRoleTitle('Key Business Developer').eligible, false);
  assert.equal(isEligibleEngineeringRoleTitle('Software Licensing Specialist').eligible, false);
  assert.equal(isEligibleEngineeringRoleTitle('Hindi Data Collector').eligible, false);
  assert.equal(isEligibleEngineeringRoleTitle('Senior Software Engineer').eligible, false);
  assert.equal(isEligibleEngineeringRoleTitle('Lead Backend Engineer').eligible, false);
  assert.equal(isEligibleEngineeringRoleTitle('Principal Architect').eligible, false);
  assert.equal(isEligibleEngineeringRoleTitle('Data Engineering Lv.4').eligible, false);

  // Eligible
  assert.equal(isEligibleEngineeringRoleTitle('Software Engineer').eligible, true);
  assert.equal(isEligibleEngineeringRoleTitle('Backend Engineer').eligible, true);
  assert.equal(isEligibleEngineeringRoleTitle('Full Stack Developer').eligible, true);
  assert.equal(isEligibleEngineeringRoleTitle('Associate Software Engineer').eligible, true);
  assert.equal(isEligibleEngineeringRoleTitle('New Grad Software Engineer (2025/2026)').eligible, true);
  assert.equal(isEligibleEngineeringRoleTitle('AI Engineer').eligible, true);
});

test('GEN-48: computeJobPriorityScore gives highest score to fresh SWE roles', () => {
  const now = Date.now();
  const freshSwe = computeJobPriorityScore({
    id: '1',
    company: 'GitLab',
    title: 'Software Engineer, Backend',
    url: 'https://job-boards.greenhouse.io/gitlab/jobs/123',
    createdAtMs: now - 30 * 60 * 1000, // 30m ago
  }, now);

  const olderRole = computeJobPriorityScore({
    id: '2',
    company: 'SomeCorp',
    title: 'General Support Engineer',
    url: 'https://somecorp.com/careers/456',
    createdAtMs: now - 10 * 24 * 3600 * 1000, // 10 days ago
  }, now);

  assert.ok(freshSwe > olderRole, 'Fresh SWE role must score significantly higher than old generic role');
});

test('GEN-49: unwrapDirectAtsApplicationUrl unwraps ?gh_jid= to embed and Ashby to /application', () => {
  // Greenhouse ?gh_jid= wrapper unwrapping
  const wrappedGh = 'https://www.esri.com/en-us/about/careers/job-detail?gh_jid=5264798007';
  assert.equal(
    unwrapDirectAtsApplicationUrl(wrappedGh),
    'https://boards.greenhouse.io/embed/job_app?token=5264798007'
  );

  const databricksGh = 'https://www.databricks.com/company/careers/open-positions?gh_jid=67890';
  assert.equal(
    unwrapDirectAtsApplicationUrl(databricksGh),
    'https://boards.greenhouse.io/embed/job_app?token=67890'
  );

  // Ashby URL auto-append /application
  const ashbyOverview = 'https://jobs.ashbyhq.com/bjak/0076054c-1df5-4f73-88b0-2af635e20f51';
  assert.equal(
    unwrapDirectAtsApplicationUrl(ashbyOverview),
    'https://jobs.ashbyhq.com/bjak/0076054c-1df5-4f73-88b0-2af635e20f51/application'
  );

  // Ashby already on /application stays unchanged
  const ashbyApp = 'https://jobs.ashbyhq.com/bjak/0076054c-1df5-4f73-88b0-2af635e20f51/application';
  assert.equal(unwrapDirectAtsApplicationUrl(ashbyApp), ashbyApp);
});

test('GEN-49: isOfflineDinoPage detects Chrome offline and DNS errors', () => {
  assert.equal(isOfflineDinoPage('This site can’t be reached'), true);
  assert.equal(isOfflineDinoPage('Press space to play'), true);
  assert.equal(isOfflineDinoPage('net::ERR_INTERNET_DISCONNECTED'), true);
  assert.equal(isOfflineDinoPage('net::ERR_NAME_NOT_RESOLVED'), true);
  assert.equal(isOfflineDinoPage('Application Form - Software Engineer'), false);
});

test('GEN-50 & 51: Helper functions are exported and callable', () => {
  assert.equal(typeof fillAsyncLocationCombobox, 'function');
  assert.equal(typeof selectAshbyYesNoOrCheckboxGroup, 'function');
});

test('GEN-52: resolveOvernightLearnedQuestions answers overnight unmapped questions', () => {
  const dummyProfile = {
    personal: {
      email: 'shivam.mahajan@example.com',
      phone: '+919876543210',
      city: 'Bengaluru',
      state: 'Karnataka',
      country: 'India',
    },
    education: [{ degree: 'B.Tech in Computer Science', school: 'Thapar Institute' }],
  };

  // 1. Confirm email
  assert.equal(
    resolveOvernightLearnedQuestions('Confirm your email', 'TEXT', null, dummyProfile),
    'shivam.mahajan@example.com'
  );

  // 2. Design portfolio / work samples
  assert.equal(
    resolveOvernightLearnedQuestions('Design Portfolio', 'TEXT', null, dummyProfile),
    'https://shivammahajan.com/projects/'
  );

  // 3. Supabase async / remote
  assert.equal(
    resolveOvernightLearnedQuestions('Are you comfortable working in an async and fully remote environment?', 'BOOLEAN_TOGGLE', ['Yes', 'No'], dummyProfile),
    'Yes'
  );

  // 4. Diagrid AI tools
  assert.equal(
    resolveOvernightLearnedQuestions('Which AI coding tools do you actively use in your workflow?', 'TEXT', null, dummyProfile),
    'Cursor, GitHub Copilot, Claude Code'
  );

  // 5. CrowdGen US residency
  assert.equal(
    resolveOvernightLearnedQuestions('I do not reside in the US', 'BOOLEAN_TOGGLE', ['Yes', 'No'], dummyProfile),
    'Yes'
  );

  // 6. Smart Working Solutions LPA select
  const lpaOptions = ['Select', '1 LPA', '2 LPA', '3 LPA', '4 LPA', '5 LPA', '6 LPA', '10 LPA'];
  assert.equal(
    resolveOvernightLearnedQuestions('Expected Annual CTC (in LPA)', 'SELECT', lpaOptions, dummyProfile),
    '3 LPA'
  );

  // 7. Lever asterisks stripped
  assert.equal(
    resolveOvernightLearnedQuestions('Confirm your email \u2731', 'TEXT', null, dummyProfile),
    'shivam.mahajan@example.com'
  );
});
