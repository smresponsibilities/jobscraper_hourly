import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveCandidateAnswer } from './answers.js';
import type { CandidateExtendedProfile, ExtendedFieldCategory } from './types.js';

const profile = { personal: { firstName: 'Fixture', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [], applicationPreferences: {}, declarations: {} } as CandidateExtendedProfile;
const resolve = (question: string, category: ExtendedFieldCategory = 'unknown') => resolveCandidateAnswer(category, profile, { url: 'https://example.test/job', question });

test('unprovided compensation, consent, address and outcomes stay unresolved', () => {
  for (const [question, category] of [
    ['What is your current salary?', 'current_salary'],
    ['What hourly rate in USD do you require?', 'unknown'],
    ['Do you consent to us referring you to other organizations?', 'unknown'],
    ['Do you agree to our legal agreements?', 'unknown'],
    ['What measurable outcome did it produce?', 'unknown'],
    ['What is your home address?', 'address'],
    ['Please provide your portfolio link', 'website'],
  ] as Array<[string, ExtendedFieldCategory]>) assert.equal(resolve(question, category).value, undefined, question);
});

test('employer history does not answer affiliate questions without scoped evidence', () => {
  const candidate = { ...profile, completeEmploymentHistory: true, experience: [{ company: 'Example Corp' }] } as CandidateExtendedProfile;
  const result = resolveCandidateAnswer('former_employee', candidate, { url: 'https://example.test/job', question: 'Have you worked for an affiliate?', company: 'Example Corp' });
  assert.equal(result.value, undefined);
});
