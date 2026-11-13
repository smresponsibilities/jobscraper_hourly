import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

test('extension bundle resolves supplied profile without server modules or static candidate answers', () => {
  const generated = readFileSync('extension/content/content.js', 'utf8');
  const bundle = generated.split('\n')[1];
  const sandbox = { URL };
  runInNewContext(bundle, sandbox);
  const answers = sandbox.JobscraperAnswers;
  const profile = { personal: { firstName: 'Fixture', email: 'fixture@example.test', country: 'India' }, professional: { noticePeriodDays: 0 }, workAuthorization: {}, eeo: {}, education: [], experience: [] };
  const context = { url: 'https://example.test/job', question: 'First name' };
  assert.equal(answers.resolveCandidateAnswer('first_name', profile, context).value, 'Fixture');
  assert.equal(answers.resolveCandidateAnswer('notice_period', profile, { ...context, question: 'Notice period in days', fieldType: 'number' }).value, 0);
  assert.equal(answers.resolveCandidateAnswer('sponsorship', profile, { ...context, question: 'Will you require sponsorship?' }).value, undefined);
  assert(!bundle.includes('9876543210'));
  assert(!bundle.includes('shivammahajan.com'));
  assert(!bundle.includes('node:fs'));
});
