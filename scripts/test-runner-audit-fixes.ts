import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { selectGroundedOptionFromDropdown } from '../src/autoapply/answers.js';
import { resolveHistoricalLedgerEntryGrounded } from '../src/autoapply/self-learning.js';
import { executeDirectHttpSubmission } from '../src/autoapply/direct-http-submitter.js';
import { evaluateCandidateJobFit } from '../src/autoapply/candidate-fit-filter.js';
import { resolveCandidatePortalPasswordChain } from '../src/autoapply/authentication.js';
import type { CandidateExtendedProfile } from '../src/autoapply/types.js';

const profile = { personal: { firstName: 'Fixture', country: 'India' }, professional: { totalYearsExperience: 1, noticePeriodDays: 0 }, education: [], experience: [] } as unknown as CandidateExtendedProfile;
assert.equal(selectGroundedOptionFromDropdown('First name', [{ label: 'Fixture', value: 'fixture' }], profile)?.factKey, 'personal.firstName');
assert.equal(selectGroundedOptionFromDropdown('Security clearance?', [{ label: 'Yes', value: 'yes' }], profile), null);
assert.equal(resolveHistoricalLedgerEntryGrounded({ questionText: 'First name' }, profile).value, 'Fixture');
assert.equal(resolveHistoricalLedgerEntryGrounded({ questionText: 'Security clearance?' }, profile).status, 'unresolved');
assert.equal(evaluateCandidateJobFit({ title: 'Software Engineer', location: 'Remote - US Only' }).reason, 'foreign_geo_locked_remote');
assert.equal(evaluateCandidateJobFit({ title: 'Software Engineer', location: 'Bengaluru, India' }).allowed, true);
const vault = { get: () => ({ email: 'fixture@example.test', password: 'fixture-password-123' }) };
assert(resolveCandidatePortalPasswordChain('fixture.invalid', 'fixture@example.test', vault as never).includes('fixture-password-123'));
const root = mkdtempSync(path.join(os.tmpdir(), 'runner-audit-'));
try {
  const file = path.join(root, 'resume.pdf'); writeFileSync(file, '%PDF-1.4\nfixture');
  const result = await executeDirectHttpSubmission({ url: 'https://jobs.ashbyhq.com/api/non-user-graphql?op=submitMultipleFormsAction', fields: { name: 'Fixture' }, resumePdfPath: file, fetcher: (async () => new Response(JSON.stringify({ data: { submitMultipleForms: { __typename: 'FormSubmitSuccess' } } }), { status: 200 })) as typeof fetch });
  assert(result.confirmed);
  assert.equal(result.exchange.request.payloadHash, createHash('sha256').update(Buffer.from(result.exchange.request.payloadBase64, 'base64')).digest('hex'));
} finally { rmSync(root, { recursive: true, force: true }); }
console.log('[RUNNER-AUDIT-FIXES] Grounded answers, geo-lock, credentials, and mock receipt passed');
