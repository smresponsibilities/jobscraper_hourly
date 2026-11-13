import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRoleEligibilityForCandidate } from './india-gcc-filter.js';
import { filterAndDeduplicateDiscoveredJobs } from './sync-github-discoveries.js';
import { computeRoleDedupSignature, isDuplicateAppliedRoleWithinWindow } from '../autoapply/role-dedup-shield.js';

test('discovery eligibility rejects isolated tenants, non-tech jobs, high experience and unclear geography', () => {
  const base = { title: 'Software Engineer', company: 'Acme', location: 'Bengaluru, India', url: 'https://jobs.ashbyhq.com/acme/123' };
  assert.equal(evaluateRoleEligibilityForCandidate(base).locationTier, 'BENGALURU_LOCAL');
  assert.equal(evaluateRoleEligibilityForCandidate({ ...base, company: 'Stripe' }).reason, 'ISOLATED_TENANT');
  assert.equal(evaluateRoleEligibilityForCandidate({ ...base, title: 'Account Executive' }).reason, 'NON_TECH_TITLE');
  assert.equal(evaluateRoleEligibilityForCandidate({ ...base, title: 'Senior Staff Engineer' }).reason, 'EXCEEDS_3_YOE');
  assert.equal(evaluateRoleEligibilityForCandidate({ ...base, jdText: 'Requires 5+ years of experience' }).reason, 'EXCEEDS_3_YOE');
  assert.equal(evaluateRoleEligibilityForCandidate({ ...base, location: 'Remote - United States only' }).eligible, false);
  assert.equal(evaluateRoleEligibilityForCandidate({ ...base, location: 'Remote' }).eligible, false);
  assert.equal(evaluateRoleEligibilityForCandidate({ ...base, location: 'Worldwide remote' }).locationTier, 'GLOBAL_REMOTE');
});

test('30-day role signatures normalize requisition suffixes without suppressing after the window', () => {
  const a = computeRoleDedupSignature('Acme Corp, Inc.', 'Software Engineer - Backend (Req #99182)');
  const b = computeRoleDedupSignature('Acme Corp', 'Software Engineer - Backend');
  assert.equal(a, b);
  const now = Date.now();
  assert.equal(isDuplicateAppliedRoleWithinWindow(a, new Map([[b, now - 29 * 86_400_000]]), 30, now), true);
  assert.equal(isDuplicateAppliedRoleWithinWindow(a, new Map([[b, now - 31 * 86_400_000]]), 30, now), false);
  assert.equal(isDuplicateAppliedRoleWithinWindow(a, new Map([[b, NaN]]), 30, now), true);
});

test('mixed discovery input keeps highest-priority duplicate and blocks unsafe entries', () => {
  const now = Date.now();
  const job = { company: 'Acme', title: 'Software Engineer', location: 'Bengaluru, India', url: 'https://jobs.ashbyhq.com/acme/old', publishedAt: new Date(now - 48 * 3_600_000).toISOString() };
  const applied = computeRoleDedupSignature('Prior Inc', 'Software Engineer');
  const results = filterAndDeduplicateDiscoveredJobs([
    job,
    { ...job, url: 'https://jobs.ashbyhq.com/acme/new', publishedAt: new Date(now - 3_600_000).toISOString() },
    { ...job, company: 'Stripe', url: 'https://stripe.recruitee.com/o/job' },
    { ...job, company: 'Prior', url: 'https://jobs.ashbyhq.com/prior/1' },
    { ...job, company: 'Other', title: 'Account Executive', url: 'https://jobs.ashbyhq.com/other/2' },
    { ...job, company: 'Senior', title: 'Senior Staff Engineer', url: 'https://jobs.ashbyhq.com/senior/3' },
    { ...job, company: 'Missing', location: '', url: 'https://jobs.ashbyhq.com/missing/4' },
    { ...job, company: 'Phishing', url: 'https://jobs.ashbyhq.com.attacker.test/evil/5' },
  ], new Map([[applied, now - 1000]]));
  assert.equal(results.length, 1);
  assert.equal(results[0]?.url, 'https://jobs.ashbyhq.com/acme/new');
});
