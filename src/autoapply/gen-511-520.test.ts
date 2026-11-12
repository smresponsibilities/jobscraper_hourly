import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCandidateAnswer } from './answers.js';
import { loadProfile } from './profile.js';
import { isStrictTechRole, isStrictIndiaLocation } from '../../scripts/harvest-fast-ats-jobs.js';
import { submissionConfirmation } from './network-proof.js';

test('GEN-511-520: U.S. Person status resolves to non-US selection', () => {
  const profile = loadProfile('state/autoapply/portal-review/candidate.json');
  const res = resolveCandidateAnswer('custom', profile, {
    question: 'A “U.S. person” is a citizen, legal permanent resident, or legal temporary resident of the United States. Which best describes your “U.S. person” status?',
    options: ['U.S. Citizen', 'U.S. Permanent Resident', 'I am not a U.S. person'],
  });
  assert.equal(res.value, 'I am not a U.S. person');
});

test('GEN-511-520: harvest-fast-ats-jobs rejects non-SWE, photographer, and senior roles', () => {
  assert.equal(isStrictTechRole('CARNIVAL - PHOTOGRAPHER TRAINEE'), false);
  assert.equal(isStrictTechRole('Public Relation Intern'), false);
  assert.equal(isStrictTechRole('HR Intern'), false);
  assert.equal(isStrictTechRole('BIM /REVIT Engineer'), false);
  assert.equal(isStrictTechRole('Senior Data Engineer'), false);

  assert.equal(isStrictIndiaLocation('[U.S. Remote]', 'Senior Data Engineer'), false);
});

test('GEN-511-520: submissionConfirmation accepts submitMultipleFormsAction and ignores texting consent', () => {
  const multipleFormsSuccess = submissionConfirmation({
    request: {
      method: 'POST',
      url: 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSubmitMultipleFormsAction',
      headers: {},
      postDataBase64: Buffer.from('{}').toString('base64'),
    },
    response: {
      status: 200,
      url: 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSubmitMultipleFormsAction',
      headers: { 'content-type': 'application/json' },
      bodyAvailable: true,
      bodyBase64: Buffer.from(JSON.stringify({
        data: {
          submitMultipleFormsAction: {
            applicationId: 'app_ashby_12345',
            isSuccess: true,
          },
        },
      })).toString('base64'),
    },
  });
  assert.ok(multipleFormsSuccess, 'Should accept submitMultipleFormsAction as verified submission receipt');
  assert.equal(multipleFormsSuccess?.applicationId, 'app_ashby_12345');

  const textingConsent = submissionConfirmation({
    request: {
      method: 'POST',
      url: 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSubmitCandidateTextingConsent',
      headers: {},
      postDataBase64: Buffer.from('{}').toString('base64'),
    },
    response: {
      status: 200,
      url: 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSubmitCandidateTextingConsent',
      headers: { 'content-type': 'application/json' },
      bodyAvailable: true,
      bodyBase64: Buffer.from(JSON.stringify({
        data: {
          submitCandidateTextingConsent: { success: true },
        },
      })).toString('base64'),
    },
  });
  assert.equal(textingConsent, undefined, 'Should ignore submitCandidateTextingConsent');
});
