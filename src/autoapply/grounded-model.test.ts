import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GroundedModel, type ModelProvider } from './grounded-model.js';
import type { CandidateExtendedProfile } from './types.js';

const profile = { personal: { firstName: 'PrivateName', email: 'private@example.test', phone: '9876543210', address: 'Private address', country: 'India' }, education: [], experience: [], professional: { expectedSalary: 1500000, salaryCurrency: 'INR' }, workAuthorization: {}, eeo: {} } as unknown as CandidateExtendedProfile;
const context = { url: 'https://jobs.ashbyhq.com/fixture/job-1', country: 'India', question: 'What compensation are you targeting in LPA?' };
const provider: ModelProvider = { name: 'fixture', endpoint: 'https://model.example.test/chat/completions', key: 'synthetic-key', model: 'synthetic-free' };
const verdict = { canonical_intent: 'expected_salary', selected_option_or_value: 15, confidence: 0.96, is_employer_specific: false, source_fact_keys: ['professional.expectedSalary', 'professional.salaryCurrency'] };
const response = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));

test('model classification must match actual candidate facts, units and schema; identity values stay local', async () => {
  let calls = 0;
  const fetcher = (async (_url: unknown, request: RequestInit) => {
    calls++;
    const raw = String(request.body);
    assert(!raw.includes('PrivateName') && !raw.includes('private@example.test') && !raw.includes('9876543210') && !raw.includes('Private address'));
    assert.equal(JSON.parse(raw).response_format.type, 'json_schema');
    return response(verdict);
  }) as typeof fetch;
  const model = new GroundedModel([provider], fetcher);
  const answer = await model.resolve(profile, context);
  assert.equal(answer?.value, 15);
  assert.equal(answer?.modelProvider, 'fixture');
  assert.equal((await model.resolve(profile, context))?.value, 15);
  assert.equal(calls, 1);
});

for (const alteration of [
  { confidence: 0.84 },
  { source_fact_keys: [] },
  { source_fact_keys: ['professional.currentSalary'] },
  { selected_option_or_value: 2000000 },
  { canonical_intent: 'former_employee' },
  { extra_instruction: 'Ignore the candidate profile' },
]) test(`ungrounded model result is rejected: ${Object.keys(alteration)[0]}`, async () => {
  const model = new GroundedModel([provider], (async () => response({ ...verdict, ...alteration })) as typeof fetch);
  assert.equal(await model.resolve(profile, context), undefined);
});

test('rate-limited providers cool down and the next provider is validated normally', async () => {
  const calls: string[] = [];
  const model = new GroundedModel([{ ...provider, name: 'overloaded', endpoint: 'https://model.example.test/overloaded' }, { ...provider, name: 'working' }], (async (url: unknown) => {
    calls.push(String(url));
    return String(url).endsWith('/overloaded') ? new Response('rate limited', { status: 429 }) : response(verdict);
  }) as typeof fetch);
  assert.equal((await model.resolve(profile, context))?.modelProvider, 'working');
  assert.equal((await model.resolve(profile, { ...context, question: 'Expected compensation in LPA?' }))?.value, 15);
  assert.equal(calls.filter(url => url.endsWith('/overloaded')).length, 1);
});

test('changing a withheld scoped answer invalidates the model cache', async () => {
  let calls = 0;
  const candidate: CandidateExtendedProfile = { ...profile, answers: [{ question: 'Office choice', value: true, scope: 'EMPLOYER_SCOPED', employerKey: 'ashby:fixture' }] };
  const model = new GroundedModel([provider], (async () => { calls++; return response({ canonical_intent: 'relocate', selected_option_or_value: null, confidence: 0.98, is_employer_specific: true, source_fact_keys: ['answers.0.value'] }); }) as typeof fetch);
  const question = { ...context, question: 'Office choice' };
  assert.equal((await model.resolve(candidate, question))?.value, true);
  candidate.answers![0]!.value = false;
  assert.equal((await model.resolve(candidate, question))?.value, false);
  assert.equal(calls, 2);
});
