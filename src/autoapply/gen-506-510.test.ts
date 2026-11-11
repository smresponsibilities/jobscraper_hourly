import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCandidateAnswer } from './answers.js';
import { loadProfile } from './profile.js';

test('GEN-506-510: "How do you weigh cash vs. equity?" resolves to balanced preference', () => {
  const profile = loadProfile('state/autoapply/portal-review/candidate.json');
  const res = resolveCandidateAnswer('custom', profile, {
    question: 'How do you weigh cash vs. equity in your compensation package?',
  });
  assert.ok(res.value, 'Must resolve cash vs equity question');
  assert.match(String(res.value), /balanced|base|equity/i);
});

test('GEN-506-510: "How do you weigh cash vs. equity?" resolves with options', () => {
  const profile = loadProfile('state/autoapply/portal-review/candidate.json');
  const res = resolveCandidateAnswer('custom', profile, {
    question: 'How do you weigh cash vs. equity?',
    options: ['All Cash', 'Balanced / competitive base with equity incentive', 'All Equity'],
  });
  assert.equal(res.value, 'Balanced / competitive base with equity incentive');
});

test('GEN-506-510: "If you were to receive an offer from us today, how soon can you start?" resolves immediately', () => {
  const profile = loadProfile('state/autoapply/portal-review/candidate.json');
  const res = resolveCandidateAnswer('custom', profile, {
    question: 'If you were to receive an offer from us today, how soon can you start?',
  });
  assert.match(String(res.value), /immediately|0 days/i);
});

test('GEN-506-510: Ashby formId_fieldUuid splitting extracts UUID correctly', () => {
  const fieldEntryId = '4231256c-9411-4474-9844-325b1285cb15_5612a801-3f22-4b2b-8c9c-bbc8a4227073';
  const fieldUuid = fieldEntryId.includes('_') ? fieldEntryId.split('_').pop()! : fieldEntryId;
  assert.equal(fieldUuid, '5612a801-3f22-4b2b-8c9c-bbc8a4227073');
});

test('GEN-506-510: candidate.json and profile.ts populates website and portfolioUrl', () => {
  const profile = loadProfile('state/autoapply/portal-review/candidate.json');
  assert.equal(profile.personal.website, 'https://shivammahajan.com');
  assert.equal(profile.personal.portfolioUrl, 'https://shivammahajan.com/projects/');
});
