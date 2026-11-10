import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { NON_TECH_TITLE_REGEX, evaluateCandidateJobFit } from './candidate-fit-filter.js';

test('GEN-430: NON_TECH_TITLE_REGEX rejects non-software roles', () => {
  const rejected = [
    'HVAC Technician',
    'Structural Engineer II',
    'Civil Project Manager',
    'Mechanical Systems Specialist',
    'Sales Development Representative',
    'Account Executive - Enterprise',
    'Talent Acquisition Sourcer',
    'Staff Nurse / Clinical Care',
    'Corporate Tax Accountant',
    'Warehouse Operations Supervisor',
  ];

  for (const title of rejected) {
    assert.strictEqual(
      NON_TECH_TITLE_REGEX.test(title),
      true,
      `Expected "${title}" to be rejected by NON_TECH_TITLE_REGEX`
    );
  }
});

test('GEN-430: NON_TECH_TITLE_REGEX allows legitimate SWE / Data / ML roles', () => {
  const allowed = [
    'Software Engineer',
    'Backend Developer (Distributed Systems)',
    'Full Stack Engineer',
    'Data Engineer - Kafka / Spark',
    'Machine Learning Engineer',
    'AI Platform Engineer',
    'DevOps / SRE Engineer',
    'Cloud Infrastructure Engineer',
  ];

  for (const title of allowed) {
    assert.strictEqual(
      NON_TECH_TITLE_REGEX.test(title),
      false,
      `Expected "${title}" to NOT be rejected by NON_TECH_TITLE_REGEX`
    );
  }
});

test('GEN-430: evaluateCandidateJobFit rejects non-tech role before scoring', () => {
  const result = evaluateCandidateJobFit({
    id: 'test-1',
    company: 'Acme HVAC Inc',
    title: 'Lead HVAC Installation Engineer',
    url: 'https://example.com/job/1',
    location: 'Bengaluru, India',
    ats: 'greenhouse',
    isHourlyFresh: true,
  });

  assert.strictEqual(result.eligible, false);
  assert.strictEqual(result.score, -9999);
  assert.match(result.reasons[0], /Disqualified non-tech role/);
});

test('GEN-430: evaluateCandidateJobFit rejects sales/recruiting/operations roles even with software keywords', () => {
  const compositeRoles = [
    'Software Sales Representative',
    'Software Recruiter',
    'Senior Software Talent Acquisition Partner',
    'DevOps Recruiter',
    'Software Customer Support Rep',
  ];

  for (const title of compositeRoles) {
    const res = evaluateCandidateJobFit({
      id: `test-${title}`,
      company: 'Tech Corp',
      title,
      url: 'https://example.com/job/comp',
      location: 'Bengaluru, India',
    });

    assert.strictEqual(
      res.eligible,
      false,
      `Expected "${title}" to be rejected by evaluateCandidateJobFit`
    );
    assert.strictEqual(
      res.score,
      -9999,
      `Expected score -9999 for "${title}"`
    );
  }
});

