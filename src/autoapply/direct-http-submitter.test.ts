import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildMultipartFormPayload, canAttemptDirectHttpSubmit } from './direct-http-submitter.js';
import type { CandidateExtendedProfile } from './types.js';

const profile = { personal: { firstName: 'Fixture', lastName: 'Candidate', email: 'fixture@example.test', phone: '0000000000', country: 'India' }, education: [], experience: [], professional: {} } as unknown as CandidateExtendedProfile;
const url = 'https://jobs.ashbyhq.com/example/posting';

test('direct eligibility requires safe provider and grounded required answers', () => {
  const schema = { questions: [{ name: 'first_name', label: 'First name', type: 'text', required: true }] };
  assert.equal(canAttemptDirectHttpSubmit(url, schema, profile).eligible, true);
  assert.equal(canAttemptDirectHttpSubmit(url, { ...schema, captchaRequired: true }, profile).eligible, false);
  assert.equal(canAttemptDirectHttpSubmit(url, { ...schema, protection: { turnstileSiteKey: 'key' } }, profile).eligible, false);
  assert.equal(canAttemptDirectHttpSubmit(url, { questions: [{ ...schema.questions[0], label: 'Unknown custom question', name: 'unknown' }] }, profile).eligible, false);
  assert.equal(canAttemptDirectHttpSubmit(url, { questions: [{ ...schema.questions[0], type: 'select', options: ['A', 'B'] }] }, profile).eligible, false);
  assert.equal(canAttemptDirectHttpSubmit('https://stripe.recruitee.com/o/test', schema, profile).eligible, false);
  assert.equal(canAttemptDirectHttpSubmit('https://jobs.ashbyhq.com.attacker.test/example/posting', schema, profile).eligible, false);
  assert.equal(canAttemptDirectHttpSubmit('https://user:password@jobs.ashbyhq.com/example/posting', schema, profile).eligible, false);
  assert.equal(canAttemptDirectHttpSubmit('https://jobs.ashbyhq.com:8443/example/posting', schema, profile).eligible, false);
  assert.equal(canAttemptDirectHttpSubmit(url, {}, profile).eligible, false);
});

test('multipart body round-trips fields and PDF and rejects header injection', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multipart-test-'));
  const file = path.join(dir, 'fixture.pdf');
  try {
    fs.writeFileSync(file, '%PDF-1.4\nfixture');
    const result = buildMultipartFormPayload({ answer: 'line one\nline two' }, file);
    const form = await new Response(new Uint8Array(result.body), { headers: { 'Content-Type': result.contentTypeHeader } }).formData();
    assert.equal(form.get('answer'), 'line one\nline two');
    const resume = form.get('resume') as File;
    assert.equal(resume.name, 'Shivam_Mahajan_Resume.pdf');
    assert.equal(resume.type, 'application/pdf');
    assert.equal(Buffer.from(await resume.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    assert.throws(() => buildMultipartFormPayload({ 'bad\r\nHeader': 'value' }, file), /Invalid multipart field/);
    assert.throws(() => buildMultipartFormPayload({ resume: 'value' }, file), /Invalid multipart field/);
    fs.writeFileSync(file, 'not a PDF');
    assert.throws(() => buildMultipartFormPayload({}, file), /must be a PDF/);
  } finally { fs.unlinkSync(file); fs.rmdirSync(dir); }
});
