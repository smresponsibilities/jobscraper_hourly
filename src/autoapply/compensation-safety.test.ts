import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveCandidateAnswer } from './answers.js';
import type { CandidateExtendedProfile } from './types.js';

const profile = { personal: { firstName: 'Fixture', email: 'fixture@example.test', country: 'India' }, professional: { expectedSalary: 1200000, salaryCurrency: 'INR' }, workAuthorization: {}, eeo: {}, education: [], experience: [] } as CandidateExtendedProfile;
const salary = (question: string, options: Record<string, unknown> = {}) => resolveCandidateAnswer('expected_salary', profile, { url: 'https://example.test/job', question, ...options });
test('salary units and bounds preserve the supplied amount without inventing currency conversions', () => {
  assert.equal(salary('Expected salary LPA', { fieldType: 'number' }).value, 12);
  assert.equal(salary('Expected salary per month', { fieldType: 'number' }).value, 100000);
  assert.equal(salary('Expected salary', { placeholder: '₹ per year', fieldType: 'number' }).value, 1200000);
  assert.equal(salary('Expected salary', { placeholder: '$ per year' }).value, undefined);
  assert.equal(salary('Expected salary in USD').value, undefined);
  assert.equal(salary('Expected hourly rate').value, undefined);
  assert.equal(salary('Expected salary LPA', { min: 15 }).value, undefined);
  assert.equal(salary('Expected salary LPA', { min: 10, max: 15 }).value, 12);
  assert.equal(salary('Expected salary', { country: 'United States' }).value, undefined);
});
