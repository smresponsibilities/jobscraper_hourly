import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applicationFit } from './fit.js';
import { AutoaplyQueueManager } from './autoaply.js';
import type { CandidateExtendedProfile } from './types.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const profile = { skills: ['Java', 'C++'], personal: {}, professional: {}, education: [], experience: [], workAuthorization: {}, eeo: {} } as unknown as CandidateExtendedProfile;
const now = Date.parse('2026-11-01T00:00:00Z');
test('fit uses whole skill names, title and bounded freshness without inventing experience', () => {
  const job = { title: 'Software Engineer', description: 'JavaScript', postedAt: new Date(now).toISOString() };
  assert.equal(applicationFit(job, profile, now), 40);
  assert.equal(applicationFit({ ...job, description: 'Java and C++' }, profile, now), 100);
  assert.equal(applicationFit({ ...job, postedAt: 'invalid' }, profile, now), 30);
  assert.equal(applicationFit({ ...job, postedAt: new Date(now + 86400000).toISOString() }, profile, now), 30);
  assert.equal(applicationFit({ ...job, postedAt: '2026-09-01' }, profile, now), 30);
  assert.deepEqual(profile.skills, ['Java', 'C++']);
});

test('dispatch rotates providers, ranks fit and preserves a warm company batch', async () => {
  const queue = new AutoaplyQueueManager();
  const visited: string[] = [];
  const roles = [
    ['workday', 'https://one.wd1.myworkdayjobs.com/jobs/job/India/Engineer_R1', 'Java C++'],
    ['greenhouse-low', 'https://boards.greenhouse.io/low/jobs/1', 'JavaScript'],
    ['greenhouse-high', 'https://boards.greenhouse.io/high/jobs/1', 'Java C++'],
    ['greenhouse-sibling', 'https://boards.greenhouse.io/high/jobs/2', 'Java'],
    ['lever', 'https://jobs.lever.co/fixture/role', 'Java'],
    ['ashby', 'https://jobs.ashbyhq.com/fixture/role', 'Java'],
  ];
  for (const [id, url, description] of roles) queue.enqueue({ externalJobId: id!, jobUrl: url!, company: id!, title: 'Software Engineer', description, postedAt: new Date().toISOString() });
  const runner = { run: async (options: { url: string }) => { visited.push(options.url); return { status: 'skipped', fieldsFilled: 0, unmappedFields: 0 }; } };
  for (let index = 0; index < roles.length; index++) await queue.processNext(runner, profile);
  assert.deepEqual(visited, [roles[2]![1], roles[3]![1], roles[4]![1], roles[5]![1], roles[0]![1], roles[1]![1]]);
  queue.close();
});

test('provider rotation continues after a worker restart', async () => {
  const statePath = path.join(mkdtempSync(path.join(tmpdir(), 'provider-rotation-')), 'queue.sqlite');
  let queue = new AutoaplyQueueManager({ statePath, candidateId: 'fixture' });
  const urls = ['https://boards.greenhouse.io/one/jobs/1', 'https://jobs.lever.co/two/2', 'https://jobs.ashbyhq.com/three/3'];
  for (const [index, url] of urls.entries()) queue.enqueue({ externalJobId: String(index), jobUrl: url, company: String(index), title: 'Software Engineer', postedAt: new Date().toISOString() });
  const visited: string[] = [];
  const runner = { run: async (options: { url: string }) => { visited.push(options.url); return { status: 'skipped', fieldsFilled: 0, unmappedFields: 0 }; } };
  try {
    await queue.processNext(runner, profile);
    queue.close();
    queue = new AutoaplyQueueManager({ statePath, candidateId: 'fixture' });
    await queue.processNext(runner, profile);
    assert.deepEqual(visited, urls.slice(0, 2));
  } finally { queue.close(); }
});
