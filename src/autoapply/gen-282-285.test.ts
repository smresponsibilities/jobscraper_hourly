import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { selectDiversifiedMultiLaneChunk, countQueuedTier2Jobs } from '../../scripts/run-overnight-marathon.js';
import { getProviderTimeoutConfig } from './watchdog-timer.js';
import { runWithHardTimeout } from '../../scripts/drain-backfill-and-hourly.js';
import type { AutoaplyJobItem } from './types.js';

test('GEN-282: countQueuedTier2Jobs and skip blocking harvest when tier2Count >= 40', () => {
  assert.equal(typeof countQueuedTier2Jobs, 'function');
  const count = countQueuedTier2Jobs('state/autoapply/portal-review/queue.sqlite');
  assert.ok(typeof count === 'number', 'count must be a number');
  assert.ok(count >= 0, 'count must be non-negative');

  const marathonSrc = fs.readFileSync(path.resolve('scripts/run-overnight-marathon.ts'), 'utf8');
  assert.ok(
    marathonSrc.includes('tier2Count >= 40'),
    'run-overnight-marathon.ts must check tier2Count >= 40 to fast-launch chunk'
  );
  assert.ok(
    marathonSrc.includes('jobFreshLevel < 2'),
    'run-overnight-marathon.ts must skip checkJobPostingHttpAliveFast for tier 2 jobs'
  );
});

test('GEN-283: selectDiversifiedMultiLaneChunk dedicates 100% of chunk to Fast-ATS (Greenhouse, Ashby, Lever) when available', () => {
  const candidates: AutoaplyJobItem[] = [];

  // 20 Greenhouse candidates
  for (let i = 0; i < 20; i++) {
    candidates.push({
      id: `gh_${i}`,
      company: `GhCompany${i}`,
      jobUrl: `https://boards.greenhouse.io/gh${i}/jobs/${1000 + i}`,
      title: `Software Engineer (Fullstack) Track ${i}`,
      location: 'Bengaluru, India',
      is_hourly_fresh: 2,
    } as any);
  }

  // 20 Ashby candidates
  for (let i = 0; i < 20; i++) {
    candidates.push({
      id: `ashby_${i}`,
      company: `AshbyCompany${i}`,
      jobUrl: `https://jobs.ashbyhq.com/ashby${i}/uuid-${2000 + i}`,
      title: `Fullstack Developer ${i}`,
      location: 'Bengaluru, India',
      is_hourly_fresh: 2,
    } as any);
  }

  // 30 Workday candidates
  for (let i = 0; i < 30; i++) {
    candidates.push({
      id: `wd_${i}`,
      company: `WdCompany${i}`,
      jobUrl: `https://wd5.myworkdayjobs.com/tenant/job/SWE-${i}`,
      title: `Backend Engineer ${i}`,
      location: 'Bengaluru, India',
      is_hourly_fresh: 0,
    } as any);
  }

  // 15 SmartRecruiters candidates
  for (let i = 0; i < 15; i++) {
    candidates.push({
      id: `sr_${i}`,
      company: `SrCompany${i}`,
      jobUrl: `https://jobs.smartrecruiters.com/sr${i}/${3000 + i}`,
      title: `DevOps Engineer ${i}`,
      location: 'Bengaluru, India',
      is_hourly_fresh: 2,
    } as any);
  }

  const chunk = selectDiversifiedMultiLaneChunk(candidates, 40);
  assert.equal(chunk.length, 40, 'Chunk must select 40 jobs');

  // Verify 0 Workday jobs and 0 SmartRecruiters jobs were taken because 40 Fast-ATS jobs (20 GH + 20 Ashby) filled all 40 slots!
  const workdayInChunk = chunk.filter(j => j.jobUrl.toLowerCase().includes('myworkdayjobs.com'));
  const srInChunk = chunk.filter(j => j.jobUrl.toLowerCase().includes('smartrecruiters.com'));
  const fastAtsInChunk = chunk.filter(
    j => j.jobUrl.toLowerCase().includes('greenhouse.io') || j.jobUrl.toLowerCase().includes('ashbyhq.com') || j.jobUrl.toLowerCase().includes('lever.co')
  );

  assert.equal(workdayInChunk.length, 0, 'Workday must be 0 when 40 fast-ATS jobs exist');
  assert.equal(srInChunk.length, 0, 'SmartRecruiters must be 0 when 40 fast-ATS jobs exist');
  assert.equal(fastAtsInChunk.length, 40, 'Fast-ATS jobs must fill 100% of chunk slots');
});

test('GEN-284: Fast-ATS hard timeout is capped at <= 95_000ms (95s)', () => {
  const ghConfig = getProviderTimeoutConfig('https://boards.greenhouse.io/rubrik/jobs/123');
  assert.equal(ghConfig.maxTotalMs, 95_000, 'Greenhouse max timeout must be 95_000ms');

  const ashbyConfig = getProviderTimeoutConfig('https://jobs.ashbyhq.com/supabase/abc-123');
  assert.equal(ashbyConfig.maxTotalMs, 95_000, 'Ashby max timeout must be 95_000ms');

  const leverConfig = getProviderTimeoutConfig('https://jobs.lever.co/hevodata/def-456');
  assert.equal(leverConfig.maxTotalMs, 95_000, 'Lever max timeout must be 95_000ms');

  const wdConfig = getProviderTimeoutConfig('https://citi.wd5.myworkdayjobs.com/careers/job/123');
  assert.equal(wdConfig.maxTotalMs, 160_000, 'Workday max timeout must be 160_000ms');

  const srConfig = getProviderTimeoutConfig('https://jobs.smartrecruiters.com/company/456');
  assert.equal(srConfig.maxTotalMs, 160_000, 'SmartRecruiters max timeout must be 160_000ms');

  assert.equal(typeof runWithHardTimeout, 'function');
});

test('GEN-285: watch-live-scoreboard.ts displays run-history.jsonl recent runs and velocity', () => {
  const scoreboardSrc = fs.readFileSync(path.resolve('scripts/watch-live-scoreboard.ts'), 'utf8');
  assert.ok(
    scoreboardSrc.includes('run-history.jsonl'),
    'watch-live-scoreboard.ts must read run-history.jsonl'
  );
  assert.ok(
    scoreboardSrc.includes('LAST 10 RUNS') || scoreboardSrc.includes('recent'),
    'watch-live-scoreboard.ts must display recent runs'
  );
  assert.ok(
    scoreboardSrc.includes('Velocity (Last 10m)'),
    'watch-live-scoreboard.ts must compute 10-minute velocity'
  );
});
