import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { auditAcceptance } from './acceptance.js';
import { CredentialVault } from './vault.js';
import { manifestPayload } from './evidence.js';
import { sha256 } from './submission.js';
import type { SubmissionExchange } from './network-proof.js';
import type { AutoaplyJobItem } from './types.js';

test('acceptance requires every ATS family and rejects manual, duplicate, existing and synthetic-endpoint proofs', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'acceptance-unit-fixtures-'));
  const vault = new CredentialVault(path.join(directory, 'vault'), randomBytes(32));
  const fixtures = [
    { provider: 'ashby', id: 'fixture-ashby', url: 'https://jobs.ashbyhq.com/fixture/fixture-ashby', endpoint: 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSubmitJobApplication', body: { data: { submitJobApplication: { isSuccess: true, applicationId: 'fixture-app-ashby' } } } },
    { provider: 'workday', id: 'REQ-1', url: 'https://fixture.myworkdayjobs.com/External/job/India/Engineer_REQ-1', endpoint: 'https://fixture.myworkdayjobs.com/wday/cxs/fixture/site/job', body: { stepType: 'Confirmation', applicationId: 'fixture-app-workday' } },
    { provider: 'greenhouse', id: '1', url: 'https://boards.greenhouse.io/fixture/jobs/1', endpoint: 'https://boards.greenhouse.io/embed/job_app', body: { success: true, applicationId: 'fixture-app-greenhouse' } },
    { provider: 'lever', id: 'fixture-lever', url: 'https://jobs.lever.co/fixture/fixture-lever', endpoint: 'https://api.lever.co/v0/postings/fixture-lever/apply', body: { ok: true, applicationId: 'fixture-app-lever' } },
  ];
  const make = (fixture: typeof fixtures[number], suffix = '', autonomous = true, local = false): AutoaplyJobItem => {
    const key = `${fixture.provider}:fixture:${fixture.id}`;
    const root = path.join(directory, fixture.provider + suffix); mkdirSync(root);
    const request = Buffer.from('synthetic-unit-fixture'); const response = Buffer.from(JSON.stringify(fixture.body));
    const exchange: SubmissionExchange = { request: { method: 'POST', url: local ? fixture.endpoint.replace(new URL(fixture.endpoint).origin, 'http://127.0.0.1') : fixture.endpoint, payloadHash: sha256(request), payloadBase64: request.toString('base64') }, response: { url: fixture.endpoint, status: 200, headers: { 'content-type': 'application/json' }, bodyBase64: response.toString('base64'), bodyAvailable: true } };
    const files: Record<string, string> = {};
    const save = (name: string, value: string | Buffer) => { writeFileSync(path.join(root, name), value); files[name] = sha256(value); };
    save('submitted_payload.json', JSON.stringify({ fields: [], documents: [] }));
    save('confirmation.html', '<h1>Synthetic unit fixture</h1>');
    save('confirmation.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA8sAAAAASUVORK5CYII=', 'base64'));
    save('network.json.encrypted', vault.sealEvidence(key, JSON.stringify([exchange])));
    save('receipt.json', JSON.stringify({ autonomous, applicationUrl: fixture.url, candidateEmail: 'fixture@example.test', requisition: { key, provider: fixture.provider }, submission: { phase: 'confirmed', requests: [{ url: exchange.request.url, method: 'POST', payloadHash: exchange.request.payloadHash, status: 200, headersHash: sha256(JSON.stringify(exchange.response.headers)), responseHash: sha256(response) }] }, receipt: {} }));
    const payload = manifestPayload(files);
    writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ ...JSON.parse(payload), signature: { algorithm: 'HMAC-SHA256', value: vault.signEvidence(payload) } }));
    return { id: fixture.provider + suffix, externalJobId: key, canonicalKey: key, title: 'Synthetic unit fixture', company: 'Fixture', jobUrl: fixture.url, jobBoard: 'direct_ats', postedAt: new Date().toISOString(), status: 'applied', receipt: { url: fixture.url, text: 'Synthetic unit fixture', verifiedAt: new Date().toISOString(), evidenceDir: root } };
  };
  try {
    const jobs = fixtures.map(fixture => make(fixture));
    assert.equal(auditAcceptance(jobs, 'fixture@example.test', vault, 4).complete, true);
    assert.equal(auditAcceptance(jobs.slice(0, 3), 'fixture@example.test', vault, 3).complete, false);
    assert.equal(auditAcceptance([...jobs, jobs[0]!], 'fixture@example.test', vault, 4).verifiedCount, 4);
    assert.equal(auditAcceptance(jobs, 'other@example.test', vault).verifiedCount, 0);
    assert.equal(auditAcceptance([make(fixtures[0]!, '-manual', false), make(fixtures[1]!, '-local', true, true)], 'fixture@example.test', vault).verifiedCount, 0);
    assert.equal(auditAcceptance([{ ...jobs[0]!, receipt: { ...jobs[0]!.receipt!, existing: true } }], 'fixture@example.test', vault).verifiedCount, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
