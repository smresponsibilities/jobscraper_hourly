import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchGreenhouseJobs, fetchAshbyJobs, fetchLeverJobs, fetchWorkableJobs } from '../../scripts/harvest-fast-ats-jobs.js';
import { list as smartRecruiters } from '../fetchers/smartrecruiters.js';
import { list as recruitee } from '../fetchers/recruitee.js';
import { list as breezy } from '../fetchers/breezy.js';
import { employerPublishedAt, isEmployerHourlyFresh } from '../sources/realtime-ats-delta-fetcher.js';
import { computeJobPriorityScore } from './priority-scheduler.js';
import { selectDiversifiedMultiLaneChunk } from '../../scripts/run-overnight-marathon.js';
import { AutoaplyQueueManager } from './autoaply.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('seven ATS response shapes preserve employer dates through scheduling', async () => {
  const now = Date.parse('2026-11-11T12:00:00Z');
  const stamp = new Date(now - 3600000).toISOString();
  const payloads: Record<string, unknown> = {
    greenhouse: { jobs: [{ title: 'Software Engineer', absolute_url: 'https://boards.greenhouse.io/example/jobs/123', location: { name: 'India' }, updated_at: stamp }] },
    ashby: { jobs: [{ title: 'Software Engineer', jobUrl: 'https://jobs.ashbyhq.com/example/123', location: 'India', publishedAt: stamp }] },
    lever: [{ text: 'Software Engineer', applyUrl: 'https://jobs.lever.co/example/123', categories: { location: 'India' }, createdAt: now - 3600000 }],
    workable: { results: [{ title: 'Software Engineer', shortcode: '123', location: { country: 'India' }, published_on: stamp }] },
  };
  const previousFetch = globalThis.fetch;
  try {
    for (const [name, fn] of Object.entries({ greenhouse: fetchGreenhouseJobs, ashby: fetchAshbyJobs, lever: fetchLeverJobs, workable: fetchWorkableJobs })) {
      globalThis.fetch = (async () => new Response(JSON.stringify(payloads[name]), { status: 200 })) as typeof fetch;
      const jobs = await fn('example', 'Example');
      assert.equal(jobs[0]?.publishedAt, stamp, name);
      assert.equal(isEmployerHourlyFresh(jobs[0]?.publishedAt, now), true, name);
    }
  } finally { globalThis.fetch = previousFetch; }
  const company = { name: 'Example', token: 'example', ats: 'smartrecruiters' } as any;
  const sourceFixtures: Array<[string, typeof smartRecruiters, unknown]> = [
    ['smartrecruiters', smartRecruiters, { totalFound: 1, content: [{ id: '123', name: 'Software Engineer', releasedDate: stamp }] }],
    ['recruitee', recruitee, { offers: [{ id: 123, title: 'Software Engineer', published_at: 'invalid', created_at: stamp }] }],
    ['breezy', breezy, [{ id: '123', name: 'Software Engineer', published_date: stamp }]],
  ];
  for (const [name, list, body] of sourceFixtures) {
    const jobs = await list(company, (async () => body) as any);
    assert.equal(employerPublishedAt(jobs[0] as any), stamp, name);
  }
  const base = { id: '1', company: 'Example', title: 'Software Engineer', url: 'https://jobs.lever.co/example/123', location: 'India' };
  const score = (payload: object) => computeJobPriorityScore({ ...base, payload }, now);
  assert.ok(score({ postedAt: stamp, discoveredAt: '2020-01-01' }) > score({ postedAt: '2020-01-01', discoveredAt: stamp, is_hourly_fresh: 3 }));
  assert.equal(score({ postedAt: new Date(now + 1000).toISOString(), isReposted: true }), score({}));
  assert.equal(score({ postedAt: 'invalid', is_hourly_fresh: 3 }), score({}));
});

test('diversification preserves scheduler order despite legacy flags', () => {
  const fresh = { id: 'fresh', title: 'Software Engineer', company: 'Example A', jobUrl: 'https://jobs.ashbyhq.com/example-a/123', location: 'India', postedAt: '2026-11-11T11:00:00Z', isHourlyFresh: false };
  const stale = { id: 'stale', title: 'Software Engineer', company: 'Example B', jobUrl: 'https://jobs.lever.co/example-b/456', location: 'India', postedAt: '2026-01-01T00:00:00Z', is_hourly_fresh: 3, priorityScore: 999999 };
  const selected = selectDiversifiedMultiLaneChunk([fresh, stale] as any, 2);
  assert.deepEqual(selected.map(job => job.id), ['fresh', 'stale']);
});

test('durable queue keeps employer timestamp ordering through selection', () => {
  const queue = new AutoaplyQueueManager({ statePath: path.join(mkdtempSync(path.join(tmpdir(), 'fresh-queue-')), 'queue.sqlite'), candidateId: 'fixture' });
  const now = Date.parse('2026-11-11T12:00:00Z');
  try {
    for (const job of [
      { id: 'old', company: 'Example A', jobUrl: 'https://jobs.ashbyhq.com/example-a/123', postedAt: '2025-01-01T00:00:00Z' },
      { id: 'fresh', company: 'Example B', jobUrl: 'https://jobs.lever.co/example-b/456', postedAt: '2026-11-11T11:00:00Z' },
    ]) queue.enqueue({ ...job, title: 'Software Engineer', location: 'India' });
    const sorted = queue.list('queued').map(job => ({ job, score: computeJobPriorityScore({ id: job.id, title: job.title, company: job.company, url: job.jobUrl, location: job.location, payload: { postedAt: job.postedAt } }, now) })).sort((a, b) => b.score - a.score).map(item => item.job);
    assert.deepEqual(selectDiversifiedMultiLaneChunk(sorted, 2).map(job => job.id), ['fresh', 'old']);
  } finally { queue.close(); }
});
