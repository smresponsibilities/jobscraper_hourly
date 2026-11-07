import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalRequisition, sameRequisition } from './identity.js';
import { preflightJob } from './preflight.js';
import type { CandidateExtendedProfile } from './types.js';
import { CatalogueIntake } from './intake.js';
import { AutoaplyQueueManager } from './autoaply.js';
import { mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const profile = { personal: { country: 'India' }, professional: { totalYearsExperience: 1 } } as CandidateExtendedProfile;

test('single-role intake never probes or queues another employer', async () => {
  const stateDir = mkdtempSync(path.join(tmpdir(), 'single-role-intake-'));
  const queue = new AutoaplyQueueManager({ statePath: path.join(stateDir, 'queue.sqlite'), candidateId: 'fixture' });
  const approvedUrl = 'https://boards.greenhouse.io/approved/jobs/1';
  let probes = 0;
  const fetcher = (async (input: string | URL | Request) => {
    if (String(input) === 'https://catalogue.example.test/jobs.json') return new Response(JSON.stringify([
      { id: 'greenhouse:approved:1', company: 'Approved', title: 'Software Engineer', url: approvedUrl, location: 'India' },
      { id: 'greenhouse:other:2', company: 'Other', title: 'Software Engineer', url: 'https://boards.greenhouse.io/other/jobs/2', location: 'India' },
    ]));
    assert.equal(String(input), 'https://boards-api.greenhouse.io/v1/boards/approved/jobs/1');
    probes++;
    return new Response(JSON.stringify({ title: 'Software Engineer', content: 'Software development in India.' }));
  }) as typeof fetch;
  try {
    const intake = new CatalogueIntake({ source: 'https://catalogue.example.test/jobs.json', stateDir, queue, profile: () => profile, fetcher, approvedUrls: [approvedUrl] });
    await intake.poll();
    assert.equal(probes, 1);
    assert.deepEqual(queue.list().map(job => job.company), ['Approved']);
  } finally { queue.close(); }
});

test('intake rechecks an unconfirmed remote location when source changes', async () => {
  const stateDir = mkdtempSync(path.join(tmpdir(), 'remote-recheck-'));
  const queue = new AutoaplyQueueManager({ statePath: path.join(stateDir, 'queue.sqlite'), candidateId: 'fixture' });
  let location = 'Remote';
  const fetcher = (async (input: string | URL | Request) => String(input).includes('catalogue.example.test')
    ? new Response(JSON.stringify([{ id: 'greenhouse:fixture:1', company: 'Fixture', title: 'Software Engineer', url: 'https://boards.greenhouse.io/fixture/jobs/1', location }]))
    : new Response(JSON.stringify({ title: 'Software Engineer', location: { name: location }, content: 'Software development.' }))) as typeof fetch;
  const intake = new CatalogueIntake({ source: 'https://catalogue.example.test/jobs.json', stateDir, queue, profile: () => profile, fetcher });
  try {
    await intake.poll();
    assert.equal(queue.list()[0]?.error, 'unconfirmed_india_remote');
    location = 'Remote - India';
    await intake.poll();
    assert.equal(queue.list()[0]?.status, 'queued');
  } finally { queue.close(); }
});

test('intake restores historical queue descriptions in bounded batches without overwriting a claimed job', async () => {
  const stateDir = mkdtempSync(path.join(tmpdir(), 'fit-backfill-'));
  const queue = new AutoaplyQueueManager({ statePath: path.join(stateDir, 'queue.sqlite'), candidateId: 'fixture' });
  const rows = Array.from({ length: 26 }, (_, index) => ({ id: `greenhouse:fixture:${index + 1}`, company: 'Fixture', title: 'Software Engineer', url: `https://boards.greenhouse.io/fixture/jobs/${index + 1}`, location: 'India' }));
  const queued = rows.map(row => queue.enqueue({ externalJobId: row.id, company: row.company, title: row.title, jobUrl: row.url, location: row.location, postedAt: '' }));
  let probes = 0;
  const fetcher = (async (input: string | URL | Request) => {
    if (String(input) === 'https://catalogue.example.test/jobs.json') return new Response(JSON.stringify(rows));
    probes++;
    if (String(input).endsWith('/1')) queue.pauseForReview(queued[0]!.id, 'Changed during source check');
    if (String(input).endsWith('/2')) return new Response('', { status: 404 });
    if (String(input).endsWith('/3')) return new Response('', { status: 503 });
    return new Response(JSON.stringify({ title: 'Software Engineer', content: 'Build Python APIs. 0-1 years experience.' }));
  }) as typeof fetch;
  const intake = new CatalogueIntake({ source: 'https://catalogue.example.test/jobs.json', stateDir, queue, profile: () => profile, fetcher });
  try {
    await intake.poll();
    assert.equal(probes, 24);
    assert.equal(queue.list().filter(job => job.description).length, 21);
    assert.equal(queue.list().find(job => job.id === queued[0]!.id)?.status, 'paused_for_review');
    assert.equal(queue.list().find(job => job.id === queued[1]!.id)?.error, 'closed_at_source');
    assert.equal(queue.list().find(job => job.id === queued[2]!.id)?.status, 'queued');
    await intake.poll();
    assert.equal(probes, 27); // Two remaining descriptions and one closed-role recheck.
    assert.equal(queue.list().filter(job => job.description).length, 23);
  } finally { queue.close(); }
});

test('canonical requisitions survive host aliases, tracking, locale and corporate presentation URLs', () => {
  assert.equal(canonicalRequisition('https://boards.greenhouse.io/stripe/jobs/5123456')?.key, canonicalRequisition('https://job-boards.greenhouse.io/stripe/jobs/5123456?gh_src=linkedin')?.key);
  assert.equal(canonicalRequisition('https://stripe.com/jobs/listing/software-engineer/5123456?gh_jid=5123456', 'greenhouse:stripe:5123456')?.key, 'greenhouse:stripe:5123456');
  assert.equal(canonicalRequisition('https://amgen.wd1.myworkdayjobs.com/en-US/Careers/job/India/Engineer_R-246001/apply/applyManually')?.key, 'workday:amgen:R-246001');
  assert.equal(canonicalRequisition('https://amgen.wd1.myworkdayjobs.com/Careers/job/India/Engineer_R-246001')?.key, 'workday:amgen:R-246001');
  assert.equal(canonicalRequisition('https://jobs.ashbyhq.com/example/uuid/application')?.key, 'ashby:example:uuid');
  assert.equal(canonicalRequisition('https://iaceiz.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/270586')?.key, 'oracle:iaceiz:270586');
  assert.equal(canonicalRequisition('https://apply.workable.com/cxg/j/1082C4E931')?.key, 'workable:cxg:1082C4E931');
});

test('Workday source aliases and posting variants require the same tenant and requisition', () => {
  const url = 'https://fixture.wd1.myworkdayjobs.com/Careers/job/India/Engineer_R_12345-1/apply';
  const source = canonicalRequisition(url, 'phenom:careers.fixture.test:R_12345')!;
  const direct = canonicalRequisition(url)!;
  assert.equal(source.key, 'workday:fixture:R_12345');
  assert.equal(direct.key, 'workday:fixture:R_12345-1');
  assert(sameRequisition(source, direct));
  assert(!sameRequisition(source, canonicalRequisition(url.replace('R_12345-1', 'R_123456-1'))!));
  assert(!sameRequisition(source, canonicalRequisition(url.replace('fixture.wd1', 'other.wd1'))!));
  assert.equal(canonicalRequisition(url, 'phenom:careers.fixture.test:R_99999')?.provider, 'phenom');
});

test('intake revalidates previously skipped Workday source aliases', async () => {
  const stateDir = mkdtempSync(path.join(tmpdir(), 'workday-alias-recheck-'));
  const queue = new AutoaplyQueueManager({ statePath: path.join(stateDir, 'queue.sqlite'), candidateId: 'fixture' });
  const url = 'https://fixture.wd1.myworkdayjobs.com/Careers/job/India/Engineer_R12345-1/apply';
  const id = 'phenom:careers.fixture.test:R12345';
  const job = queue.enqueue({ externalJobId: id, company: 'Fixture', title: 'Software Engineer', jobUrl: url, location: 'India', postedAt: '' });
  queue.skip(job.id, 'requisition_identity_mismatch');
  const fetcher = (async (input: string | URL | Request) => String(input) === 'https://catalogue.example.test/jobs.json'
    ? new Response(JSON.stringify([{ id, company: 'Fixture', title: 'Software Engineer', url, location: 'India' }]))
    : new Response(JSON.stringify({ jobPostingInfo: { title: 'Software Engineer', jobDescription: 'Build software in India. 0-2 years experience.' } }))) as typeof fetch;
  try {
    const intake = new CatalogueIntake({ source: 'https://catalogue.example.test/jobs.json', stateDir, queue, profile: () => profile, fetcher });
    await intake.poll();
    assert.equal(queue.list().length, 1);
    assert.equal(queue.list()[0]?.status, 'queued');
  } finally { queue.close(); }
});

test('closed and stale catalogue rows never make a network request', async () => {
  const fetcher = (async () => { throw Error('Unexpected network request'); }) as typeof fetch;
  const job = { id: 'greenhouse:fixture:1', title: 'Software Engineer', company: 'Fixture', url: 'https://jobs.example.test/1' };
  assert.equal((await preflightJob({ ...job, closedAt: '2026-10-01' }, profile, { fetcher })).reason, 'closed_in_catalogue');
  assert.equal((await preflightJob({ ...job, lastSeen: '2026-10-01' }, profile, { fetcher, latestPollAt: '2026-10-02' })).reason, 'stale_catalogue_entry');
});

test('preflight rejects a catalogue identity that contradicts its direct ATS URL', async () => {
  const fetcher = (async () => { throw Error('Unexpected network request'); }) as typeof fetch;
  const job = { id: 'greenhouse:fixture:1', title: 'Software Engineer', company: 'Fixture', url: 'https://boards.greenhouse.io/fixture/jobs/2', location: 'India' };
  assert.equal((await preflightJob(job, profile, { fetcher })).reason, 'requisition_identity_mismatch');
  assert.equal((await preflightJob({ ...job, url: 'https://boards.greenhouse.io/other/jobs/1' }, profile, { fetcher })).reason, 'requisition_identity_mismatch');
  assert.equal((await preflightJob({ ...job, url: 'https://jobs.lever.co/fixture/1' }, profile, { fetcher })).reason, 'requisition_identity_mismatch');
});

test('preflight verifies live ATS data, requirements and definitive source closure', async () => {
  const job = { id: 'greenhouse:fixture:1', title: 'Software Engineer', company: 'Fixture', url: 'https://jobs.example.test/1', location: 'Bengaluru, India' };
  const data = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  assert.equal((await preflightJob(job, profile, { fetcher: data({}, 404) })).reason, 'closed_at_source');
  assert.equal((await preflightJob(job, profile, { fetcher: data({}, 429) })).status, 'retry');
  assert.equal((await preflightJob(job, profile, { fetcher: data({ title: 'Software Engineer', content: 'Minimum 8 years of professional software development experience.' }) })).reason, 'ineligible_jd_experience');
  assert.equal((await preflightJob(job, profile, { fetcher: data({ title: 'Software Engineer', content: 'A minimum of five years of professional experience developing software.' }) })).reason, 'ineligible_jd_experience');
  assert.equal((await preflightJob(job, profile, { fetcher: data({ title: 'Software Engineer', content: '4-7&#xa0;years of software engineering experience.' }) })).reason, 'ineligible_jd_experience');
  assert.equal((await preflightJob(job, profile, { fetcher: data({ title: 'Software Engineer', content: 'Two to five years of software engineering experience.' }) })).status, 'eligible');
  assert.equal((await preflightJob(job, profile, { fetcher: data({ title: 'Software Engineer', content: 'Must be a US citizen. Active TS/SCI clearance required.' }) })).reason, 'ineligible_jd_citizenship_or_clearance');
  assert.equal((await preflightJob(job, profile, { fetcher: data({ title: 'Software Engineer', content: 'Build Python APIs. 0-2 years experience.' }) })).status, 'eligible');
});

test('a missing Ashby posting is closed, while a failed board response remains retryable', async () => {
  const job = { id: 'ashby:fixture:missing', title: 'Software Engineer', company: 'Fixture', url: 'https://jobs.ashbyhq.com/fixture/missing', location: 'India' };
  assert.equal((await preflightJob(job, profile, { fetcher: (async () => new Response('{"jobs":[]}')) as typeof fetch })).reason, 'closed_at_source');
  assert.equal((await preflightJob(job, profile, { fetcher: (async () => new Response('{"error":"upstream"}')) as typeof fetch })).status, 'retry');
});

test('SmartRecruiters inactive postings are closed even when the API returns 200', async () => {
  const job = { id: 'smartrecruiters:fixture:123', title: 'Software Engineer', company: 'Fixture', url: 'https://jobs.smartrecruiters.com/fixture/123', location: 'India' };
  const data = (active: boolean) => (async () => new Response(JSON.stringify({ active, name: 'Software Engineer', jobAd: { sections: { jobDescription: { text: 'Build software in India.' } } } }))) as typeof fetch;
  assert.equal((await preflightJob(job, profile, { fetcher: data(false) })).reason, 'closed_at_source');
  assert.equal((await preflightJob(job, profile, { fetcher: data(true) })).status, 'eligible');
});

test('published catalogue intake deduplicates aliases, preflights rows, and retries failed probes after HTTP 304', async () => {
  const stateDir = mkdtempSync(path.join(tmpdir(), 'catalogue-worker-'));
  const queue = new AutoaplyQueueManager({ statePath: path.join(stateDir, 'queue.sqlite'), candidateId: 'fixture' });
  let catalogueRequests = 0;
  let retryRequests = 0;
  const rows = [
    { id: 'phenom:fixture:missing-link', title: 'Software Engineer', company: 'Fixture', url: '', location: 'India' },
    { id: 'greenhouse:fixture:1', title: 'Software Engineer', company: 'Fixture', url: 'https://boards.greenhouse.io/fixture/jobs/1', location: 'India', postedAt: null, lastSeen: '2026-10-30T08:00:00Z' },
    { id: 'greenhouse:fixture:1', title: 'Software Engineer', company: 'Fixture', url: 'https://job-boards.greenhouse.io/fixture/jobs/1?gh_src=linkedin', location: 'India', lastSeen: '2026-10-30T08:00:00Z' },
    { id: 'greenhouse:fixture:2', title: 'Software Engineer', company: 'Fixture', url: 'https://boards.greenhouse.io/fixture/jobs/2', location: 'India', lastSeen: '2026-10-30T08:00:00Z', closedAt: '2026-10-30T08:00:00Z' },
    { id: 'greenhouse:fixture:3', title: 'Software Engineer', company: 'Fixture', url: 'https://boards.greenhouse.io/fixture/jobs/3', location: 'India', lastSeen: '2026-10-29T08:00:00Z' },
    { id: 'greenhouse:fixture:4', title: 'Software Engineer', company: 'Fixture', url: 'https://boards.greenhouse.io/fixture/jobs/4', location: 'India', lastSeen: '2026-10-30T08:00:00Z' },
  ];
  const fetcher = (async (input: string | URL | Request, options?: RequestInit) => {
    const url = String(input);
    if (url === 'https://catalogue.example.test/jobs.json') {
      catalogueRequests++;
      if (catalogueRequests > 1) { assert.equal((options?.headers as Record<string, string>)['If-None-Match'], 'snapshot-one'); return new Response(null, { status: 304 }); }
      return new Response(JSON.stringify(rows), { headers: { ETag: 'snapshot-one' } });
    }
    if (url.endsWith('/4') && ++retryRequests === 1) return new Response('upstream unavailable', { status: 503 });
    assert(!url.endsWith('/2') && !url.endsWith('/3'), 'Closed/stale jobs must not reach a public job API');
    return new Response(JSON.stringify({ title: 'Software Engineer', content: 'Build Python APIs. 0-1 years experience.' }));
  }) as typeof fetch;
  const intake = new CatalogueIntake({ source: 'https://catalogue.example.test/jobs.json', stateDir, queue, profile: () => profile, fetcher });
  try {
    assert.deepEqual(await intake.poll(), { fetched: true, imported: 1, skipped: 2, retry: 1 });
    assert.equal(queue.getPendingQueue().length, 1);
    assert.deepEqual(await intake.poll(), { fetched: false, imported: 1, skipped: 2, retry: 0 });
    assert.equal(queue.getPendingQueue().length, 2);
    assert.equal(queue.list().filter(job => job.canonicalKey === 'greenhouse:fixture:1').length, 1);
    const history = readFileSync(path.join(stateDir, 'intake-history.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(history.length, 2);
    assert.equal(history[0].reasons.closed_in_catalogue, 1);
    assert(!JSON.stringify(history).includes('fixture@example.test'));
  } finally { queue.close(); }
});
