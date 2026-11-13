import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { historicalLedgerEntries, historicalReplayMeetsGate, replayHistoricalQuestions } from '../../scripts/replay-historical-questions.js';
import { synthesizeNewDeterministicRule } from './self-learning.js';
import { verifyStoredEvidenceMerkleLedger } from './evidence-auditor.js';
import type { CandidateExtendedProfile } from './types.js';
import { profileFactValue, resolveCandidateAnswer } from './answers.js';

const profile = { personal: { firstName: 'Fixture', lastName: 'Candidate', email: 'fixture@example.test', phone: '0000000000', country: 'India' }, education: [], experience: [], professional: { totalYearsExperience: 1, noticePeriodDays: 0 } } as unknown as CandidateExtendedProfile;

test('fact paths preserve skill names with dots and current employment is distinguished from past employment', () => {
  const candidate = { ...profile, skillYears: { 'Node.js': 1 }, experience: [{ company: 'Previous employer', title: 'Apprentice' }], answers: [{ question: 'What is your current employment status?', value: 'Unemployed', scope: 'GLOBAL_FACT' }] } as unknown as CandidateExtendedProfile;
  assert.equal(profileFactValue(candidate, 'skillYears.Node.js'), 1);
  const current = resolveCandidateAnswer('current_company', candidate, { url: 'https://neutral.invalid', question: 'Current employer' });
  assert.equal(current.value, 'Unemployed');
  const previous = resolveCandidateAnswer('current_company', candidate, { url: 'https://neutral.invalid', question: 'Previous employer' });
  assert.equal(previous.value, 'Previous employer');
  assert.deepEqual(previous.sourceFactKeys, ['experience.0.company']);
});

test('historical ledger metadata is not replayed as a question', () => {
  const item = { questionText: 'First name', widgetKind: 'TEXT_INPUT' };
  assert.deepEqual(historicalLedgerEntries({ version: 1, unmappedQuestions: [], signature: item }), [item]);
  assert.deepEqual(historicalLedgerEntries({ version: 1, unmappedQuestions: [item] }), [item]);
  assert.deepEqual(historicalLedgerEntries([item]), [item]);
  assert.throws(() => historicalLedgerEntries(null));
});

test('replay counts missing questions and refuses unsupported answers without writing rules', () => {
  const before = JSON.stringify(profile);
  const summary = replayHistoricalQuestions([{ label: 'First name' }, {}, { label: 'What is your security clearance?' }], profile);
  assert.equal(summary.total, 3);
  assert.equal(summary.resolved, 1);
  assert.equal(summary.unresolved, 2);
  assert.equal(summary.malformed, 1);
  assert.equal(historicalReplayMeetsGate(summary), false);
  assert.equal(historicalReplayMeetsGate({ total: 0, resolved: 0, skipped: 0, excluded: 0, unresolved: 0, missingFactReferences: 0, malformed: 0, independentlyVerified: 0 }), false);
  assert.equal(JSON.stringify(profile), before);
});

test('excludes only context-free Yes records by owner instruction', () => {
  const summary = replayHistoricalQuestions([{ questionText: 'Yes', sectionHeading: '', options: ['Yes', 'No'] }, { questionText: 'Yes', sectionHeading: 'Question context' }], profile);
  assert.equal(summary.excluded, 1);
  assert.equal(summary.unresolved, 1);
});

test('owner exclusions are counted without resolving or fabricating an answer', () => {
  const summary = replayHistoricalQuestions([{ label: 'What is your security clearance?', excludedByOwner: true }, { label: 'What is your security clearance?' }], profile);
  assert.equal(summary.excluded, 1);
  assert.equal(summary.resolved, 0);
  assert.equal(summary.unresolved, 1);
});

test('only explicitly optional owner-skipped fields are counted as skipped', () => {
  const candidate = { ...profile, applicationPreferences: { skipOptionalQuestions: ['Facebook'] } } as CandidateExtendedProfile;
  const summary = replayHistoricalQuestions([{ label: 'Facebook', isRequired: false }, { label: 'Facebook', isRequired: true }], candidate);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.unresolved, 1);
  assert.equal(historicalReplayMeetsGate(summary), false);
});

test('synthesis does not invent facts or overwrite corrupt memory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-synthesis-test-'));
  const file = path.join(dir, 'memory.json');
  try {
    assert.equal(synthesizeNewDeterministicRule('Do you require sponsorship in the United States?', profile, file), null);
    assert.equal(synthesizeNewDeterministicRule('Do you consent to data transfer?', profile, file), null);
    assert.equal(fs.existsSync(file), false);
    const rule = synthesizeNewDeterministicRule('How many years of professional experience do you have?', profile, file);
    assert.equal(rule?.factKey, 'professional.totalYearsExperience');
    assert.equal(rule?.resolvedValue, '1');
    fs.writeFileSync(file, 'corrupt');
    assert.equal(synthesizeNewDeterministicRule('How many years of professional experience do you have?', profile, file), null);
    assert.equal(fs.readFileSync(file, 'utf8'), 'corrupt');
  } finally { if (fs.existsSync(file)) fs.unlinkSync(file); fs.rmdirSync(dir); }
});

test('stored evidence chain verification is read-only and detects tampering', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-check-test-'));
  const file = path.join(dir, 'ledger.json');
  try {
    const prevHash = 'GENESIS_BLOCK_00000000000000000000000000000000000000000000000000000000';
    const entry = { index: 1, jobId: 'fixture', provider: 'ashby', url: 'https://jobs.ashbyhq.com/fixture/1', appliedAt: '2026-01-01', prevHash, entryHash: '' };
    entry.entryHash = createHash('sha256').update(`${prevHash}||${entry.jobId}||${entry.provider}||${entry.url}||${entry.appliedAt}`).digest('hex');
    const original = JSON.stringify([entry]);
    fs.writeFileSync(file, original);
    assert.equal(verifyStoredEvidenceMerkleLedger(file), true);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
    fs.writeFileSync(file, JSON.stringify([{ ...entry, url: 'https://other.example.test' }]));
    assert.equal(verifyStoredEvidenceMerkleLedger(file), false);
    fs.writeFileSync(file, '[]');
    assert.equal(verifyStoredEvidenceMerkleLedger(file), false);
  } finally { fs.unlinkSync(file); fs.rmdirSync(dir); }
});


test('replay reports independent review separately and rejects contradictory reviews', () => {
  const summary = replayHistoricalQuestions([{ label: 'First name' }], profile);
  assert.equal(summary.resolved, 1);
  assert.equal(summary.independentlyVerified, 0);
  assert.equal(historicalReplayMeetsGate(summary, 1), true);
  const reviewed = replayHistoricalQuestions([{ label: 'First name', reviewedByOwner: true, verifiedExpectedValue: 'Fixture' }], profile);
  assert.equal(historicalReplayMeetsGate(reviewed, 1), true);
  assert.equal(historicalReplayMeetsGate(reviewed), true);
  const mismatch = replayHistoricalQuestions([{ label: 'First name', reviewedByOwner: true, verifiedExpectedValue: 'Different' }], profile);
  assert.equal(historicalReplayMeetsGate(mismatch, 1), false);
});
