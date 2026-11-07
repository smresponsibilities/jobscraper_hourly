import assert from 'node:assert/strict';
import { test } from 'node:test';
import { submissionConfirmation, type SubmissionExchange } from './network-proof.js';

const exchange = (url: string, value: unknown, status = 200, headers = {}): SubmissionExchange => ({ request: { url, method: 'POST', payloadHash: 'synthetic', payloadBase64: Buffer.from('synthetic').toString('base64') }, response: { url, status, headers, bodyBase64: Buffer.from(JSON.stringify(value)).toString('base64'), bodyAvailable: true } });

test('four major ATS terminal responses require explicit success and reject validation or unrelated hosts', () => {
  const fixtures = [
    exchange('https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSubmitJobApplication', { data: { submitJobApplication: { isSuccess: true, applicationId: 'ashby-1' } } }),
    exchange('https://fixture.myworkdayjobs.com/wday/cxs/fixture/site/job', { stepType: 'Confirmation', applicationId: 'workday-1' }),
    exchange('https://boards.greenhouse.io/embed/job_app', { success: true, application_id: 'greenhouse-1' }),
    exchange('https://api.lever.co/v0/postings/fixture-id/apply', { ok: true, applicationId: 'lever-1' }),
  ];
  for (const fixture of fixtures) {
    assert(submissionConfirmation(fixture)?.applicationId);
    assert.equal(submissionConfirmation({ ...fixture, response: { ...fixture.response, status: 400 } }), undefined);
    assert.equal(submissionConfirmation({ ...fixture, request: { ...fixture.request, method: 'GET' } }), undefined);
    assert.equal(submissionConfirmation(exchange(fixture.request.url, { success: true, errors: ['invalid field'] })), undefined);
    assert.equal(submissionConfirmation(exchange(fixture.request.url, { message: 'ok' })), undefined);
  }
  assert.equal(submissionConfirmation(exchange('https://unrelated.example/embed/job_app', { success: true })), undefined);
  assert.equal(submissionConfirmation(exchange('https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting', { data: { submitJobApplication: { isSuccess: true } } })), undefined);
});

test('Greenhouse and Lever redirects need an actual confirmation target', () => {
  const source = 'https://boards.greenhouse.io/embed/job_app';
  assert.equal(submissionConfirmation(exchange(source, null, 302, { location: '/confirmation?applicationId=receipt-1' }))?.applicationId, 'receipt-1');
  assert.equal(submissionConfirmation(exchange(source, null, 302, { location: '/login' })), undefined);
  assert.equal(submissionConfirmation(exchange(source, { error: 'invalid input' }, 200)), undefined);
});

