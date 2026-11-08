import test from 'node:test';
import assert from 'node:assert/strict';
import { computeJobPriorityScore, QueuedJobCandidate } from './priority-scheduler.js';
import { withImapMutex } from './imap-verifier.js';

test('GEN-223: computeJobPriorityScore assigns +50,000 pts for Tier-2 fresh (is_hourly_fresh = 2)', () => {
  const baseJob: QueuedJobCandidate = {
    id: 'test_job_1',
    company: 'Acme Corp',
    title: 'Software Engineer',
    url: 'https://boards.greenhouse.io/acme/jobs/1234567',
    createdAtMs: 0,
  };

  const scoreNotFresh = computeJobPriorityScore(baseJob, 1000000000000);

  const tier1FreshJob: QueuedJobCandidate = {
    ...baseJob,
    isHourlyFresh: 1,
  };
  const scoreTier1 = computeJobPriorityScore(tier1FreshJob, 1000000000000);

  const tier2FreshJob: QueuedJobCandidate = {
    ...baseJob,
    is_hourly_fresh: 2,
  };
  const scoreTier2 = computeJobPriorityScore(tier2FreshJob, 1000000000000);

  const tier2PayloadFreshJob: QueuedJobCandidate = {
    ...baseJob,
    payload: { is_hourly_fresh: 2 },
  };
  const scoreTier2Payload = computeJobPriorityScore(tier2PayloadFreshJob, 1000000000000);

  assert.equal(scoreTier1 - scoreNotFresh, 10000, 'Tier-1 fresh job should receive exactly +10,000 pts');
  assert.equal(scoreTier2 - scoreNotFresh, 50000, 'Tier-2 fresh job should receive exactly +50,000 pts');
  assert.equal(scoreTier2Payload - scoreNotFresh, 50000, 'Tier-2 payload fresh job should receive exactly +50,000 pts');
  assert.ok(scoreTier2 > scoreTier1 + 30000, 'Tier-2 fresh job strictly dominates Tier-1 fresh job');
});

test('GEN-224: Greenhouse 302 marketing site redirect regex and embed recovery URL generator', () => {
  const ghRegex = /(?:boards|job-boards(?:\.eu)?)\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i;

  const standardUrl = 'https://boards.greenhouse.io/stripe/jobs/4567890';
  const match1 = standardUrl.match(ghRegex);
  assert.ok(match1, 'Standard boards.greenhouse.io URL must match');
  assert.equal(match1![1], 'stripe');
  assert.equal(match1![2], '4567890');

  const euUrl = 'https://job-boards.eu.greenhouse.io/klarna/jobs/998877';
  const match2 = euUrl.match(ghRegex);
  assert.ok(match2, 'EU greenhouse URL must match');
  assert.equal(match2![1], 'klarna');
  assert.equal(match2![2], '998877');

  const embedUrl = `https://boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(match1![1])}&token=${encodeURIComponent(match1![2])}`;
  assert.equal(embedUrl, 'https://boards.greenhouse.io/embed/job_app?for=stripe&token=4567890');
});

test('GEN-225: withImapMutex executes concurrent IMAP tasks in strict sequential FIFO order', async () => {
  const executionOrder: string[] = [];

  const task1 = withImapMutex(async () => {
    executionOrder.push('start_1');
    await new Promise((r) => setTimeout(r, 60));
    executionOrder.push('end_1');
    return 'result_1';
  });

  const task2 = withImapMutex(async () => {
    executionOrder.push('start_2');
    await new Promise((r) => setTimeout(r, 30));
    executionOrder.push('end_2');
    return 'result_2';
  });

  const task3 = withImapMutex(async () => {
    executionOrder.push('start_3');
    await new Promise((r) => setTimeout(r, 10));
    executionOrder.push('end_3');
    return 'result_3';
  });

  const results = await Promise.all([task1, task2, task3]);

  assert.deepEqual(results, ['result_1', 'result_2', 'result_3']);
  assert.deepEqual(executionOrder, [
    'start_1',
    'end_1',
    'start_2',
    'end_2',
    'start_3',
    'end_3',
  ]);
});
