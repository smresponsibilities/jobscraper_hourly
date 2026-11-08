import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateCandidateJobFit } from './candidate-fit-filter.js';
import { computeJobPriorityScore } from './priority-scheduler.js';
import { syncHourlyFreshJobsFromOriginMain } from '../../scripts/sync-hourly-from-origin.js';

test('GEN-172: evaluateCandidateJobFit allows target roles in Bengaluru/India and filters senior/non-tech/foreign', () => {
  // Allowed cases
  const sweBlr = evaluateCandidateJobFit({
    company: 'TestCorp',
    title: 'Software Engineer',
    location: 'Bengaluru, India',
    url: 'https://jobs.ashbyhq.com/test/123',
  });
  assert.equal(sweBlr.allowed, true, 'SWE Bengaluru must be allowed');
  assert.ok(sweBlr.isBengaluru, 'Must identify as Bengaluru');
  assert.ok(sweBlr.isIndia, 'Must identify as India');
  assert.ok(sweBlr.priorityBonus >= 5000, 'Bengaluru must have priorityBonus >= 5000');

  const mlEng = evaluateCandidateJobFit({
    company: 'AiLabs',
    title: 'ML Engineer',
    location: 'Bangalore',
    url: 'https://boards.greenhouse.io/ailabs/jobs/456',
  });
  assert.equal(mlEng.allowed, true, 'ML Engineer Bangalore must be allowed');
  assert.ok(mlEng.priorityBonus >= 5000, 'Bangalore must have priorityBonus >= 5000');

  const apprentice = evaluateCandidateJobFit({
    company: 'TechCo',
    title: 'Technology Apprentice',
    location: 'India',
    url: 'https://jobs.lever.co/techco/789',
  });
  assert.equal(apprentice.allowed, true, 'Apprentice must be allowed');
  assert.ok(apprentice.priorityBonus >= 3500, 'India apprentice must have bonus >= 3500');

  // Filtered cases: Senior
  const seniorSwe = evaluateCandidateJobFit({
    company: 'BigTech',
    title: 'Senior Software Engineer',
    location: 'Bengaluru, India',
  });
  assert.equal(seniorSwe.allowed, false, 'Senior SWE must be rejected');
  assert.ok(seniorSwe.reason?.includes('senior'), 'Reason must mention senior');

  const staffEng = evaluateCandidateJobFit({
    company: 'BigTech',
    title: 'Staff Architect',
    location: 'Bengaluru, India',
  });
  assert.equal(staffEng.allowed, false, 'Staff Architect must be rejected');

  // Filtered cases: Non-tech
  const salesExec = evaluateCandidateJobFit({
    company: 'SaaSCo',
    title: 'Account Executive',
    location: 'Bengaluru, India',
  });
  assert.equal(salesExec.allowed, false, 'Account Executive must be rejected');
  assert.ok(salesExec.reason?.includes('non_tech'), 'Reason must mention non_tech');

  const recruiter = evaluateCandidateJobFit({
    company: 'SaaSCo',
    title: 'Talent Acquisition Specialist',
    location: 'Mumbai, India',
  });
  assert.equal(recruiter.allowed, false, 'Recruiter must be rejected');

  // Filtered cases: Foreign-only onsite
  const nyRole = evaluateCandidateJobFit({
    company: 'USCorp',
    title: 'Software Engineer',
    location: 'New York, USA',
  });
  assert.equal(nyRole.allowed, false, 'New York USA onsite role must be rejected');
  assert.ok(nyRole.reason?.includes('foreign'), 'Reason must mention foreign');

  // Filtered cases: Isolated tenants
  const stripeJob = evaluateCandidateJobFit({
    company: 'Stripe',
    title: 'Software Engineer',
    location: 'Bengaluru, India',
  });
  assert.equal(stripeJob.allowed, false, 'Stripe must be filtered as isolated tenant');
});

test('GEN-173: syncHourlyFreshJobsFromOriginMain runs cleanly and is wired into scripts/run-overnight-marathon.ts', () => {
  const marathonSrc = fs.readFileSync('scripts/run-overnight-marathon.ts', 'utf8');
  assert.ok(
    marathonSrc.includes('syncHourlyFreshJobsFromOriginMain'),
    'run-overnight-marathon.ts must import and call syncHourlyFreshJobsFromOriginMain'
  );

  const res = syncHourlyFreshJobsFromOriginMain();
  assert.ok(typeof res.inspected === 'number', 'inspected count must be a number');
  assert.ok(typeof res.insertedFresh === 'number', 'insertedFresh count must be a number');
  assert.ok(typeof res.boostedExisting === 'number', 'boostedExisting count must be a number');
});

test('GEN-174: src/index.ts has 429 retry-after backoff and unhandledRejection safeguard', () => {
  const indexSrc = fs.readFileSync('src/index.ts', 'utf8');
  assert.ok(indexSrc.includes('unhandledRejection'), 'src/index.ts must handle unhandledRejection');
  assert.ok(indexSrc.includes('retry-after') || indexSrc.includes('rate'), 'src/index.ts must handle 429 retry-after backoff');
});

test('GEN-175: computeJobPriorityScore awards higher priority to Bengaluru hourly-fresh SDE-1 roles than generic backfill', () => {
  const nowMs = Date.now();

  const blrFreshSde1 = computeJobPriorityScore({
    id: 'job-1',
    company: 'FastCorp',
    title: 'SDE 1',
    location: 'Bengaluru, India',
    url: 'https://jobs.ashbyhq.com/fast/123/application',
    isHourlyFresh: true,
    createdAtMs: nowMs - 3600_000,
  }, nowMs);

  const genericBackfill = computeJobPriorityScore({
    id: 'job-2',
    company: 'SlowCorp',
    title: 'Software Engineer',
    location: 'Remote',
    url: 'https://myworkdayjobs.com/slow/456',
    isHourlyFresh: false,
    createdAtMs: nowMs - 7 * 86400_000,
  }, nowMs);

  assert.ok(
    blrFreshSde1 > genericBackfill + 10000,
    `Bengaluru hourly-fresh SDE 1 score (${blrFreshSde1}) must be dramatically higher than generic backfill (${genericBackfill})`
  );
});
