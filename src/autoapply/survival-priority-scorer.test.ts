import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeJobSurvivalPriorityScore } from './survival-priority-scorer.js';
import { computeJobPriorityScore } from './priority-scheduler.js';

test('freshness uses employer dates only, with future dates treated as unknown', () => {
  const now = Date.parse('2026-11-12T10:00:00Z');
  const base = { provider: 'greenhouse', location: 'Bengaluru, India' };
  const fresh = computeJobSurvivalPriorityScore({ ...base, publishedAt: now - 3_600_000 }, now);
  const old = computeJobSurvivalPriorityScore({ ...base, publishedAt: now - 48 * 3_600_000 }, now);
  const missing = computeJobSurvivalPriorityScore({ ...base, discoveredAt: new Date(now).toISOString() }, now);
  assert(fresh.totalScore > old.totalScore);
  assert(fresh.totalScore > missing.totalScore);
  assert.equal(missing.freshnessBonus, 0);
  assert.equal(computeJobSurvivalPriorityScore({ ...base, publishedAt: now + 1 }, now).freshnessBonus, 0);
  assert.equal(computeJobSurvivalPriorityScore({ ...base, publishedAt: 'invalid' }, now).freshnessBonus, 0);
  assert.equal(computeJobSurvivalPriorityScore({ ...base, publishedAt: now }, now).totalScore, 25_000);
});

test('queue scheduler does not treat discovery or update timestamps as publication', () => {
  const now = Date.parse('2026-11-12T10:00:00Z');
  const job = { id: 'fixture', company: 'Fixture', title: 'Software Engineer', url: 'https://jobs.ashbyhq.com/fixture/123', location: 'Bengaluru' };
  const noDate = computeJobPriorityScore(job, now);
  assert.equal(computeJobPriorityScore({ ...job, discoveredAt: new Date(now).toISOString(), payload: { updated_at: new Date(now).toISOString(), isHourlyFresh: true } }, now), noDate);
  assert(computeJobPriorityScore({ ...job, payload: { postedAt: new Date(now - 3_600_000).toISOString() } }, now) > noDate);
  assert.equal(computeJobPriorityScore({ ...job, payload: { postedAt: new Date(now + 3_600_000).toISOString() } }, now), noDate);
});
