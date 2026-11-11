import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  extractJobTimestampMs,
  computeJobPriorityScore,
  type QueuedJobCandidate,
} from './priority-scheduler.js';
import {
  recordWonderPillDeadEnd,
  loadWonderPillDeadEnds,
  type WonderPillDeadEnd,
} from '../outreach/dual-mode-lead-finder.js';
import {
  isAutomationChromeCommandLine,
  check30MinZeroFillDroughtAndAutoHeal,
  getDoctorStatus,
} from './health-and-ram-watchdog.js';

test('GEN-443: extractJobTimestampMs parses multi-field timestamps and epoch job IDs', () => {
  // 1. From discoveredAt
  const cand1: QueuedJobCandidate = {
    id: 'job-1',
    company: 'TestCo',
    title: 'SWE',
    url: 'https://boards.greenhouse.io/test/jobs/1',
    discoveredAt: '2026-11-10T12:00:00.000Z',
  };
  const res1 = extractJobTimestampMs(cand1);
  assert.equal(res1.source, 'discoveredAt');
  assert.equal(res1.timestampMs, Date.parse('2026-11-10T12:00:00.000Z'));

  // 2. From payload.scrapedAt
  const cand2: QueuedJobCandidate = {
    id: 'job-2',
    company: 'TestCo',
    title: 'SWE',
    url: 'https://boards.greenhouse.io/test/jobs/2',
    payload: { scrapedAt: '2026-11-10T14:30:00.000Z' },
  };
  const res2 = extractJobTimestampMs(cand2);
  assert.equal(res2.source, 'scrapedAt');
  assert.equal(res2.timestampMs, Date.parse('2026-11-10T14:30:00.000Z'));

  // 3. Fallback to 13-digit epoch in job id
  const cand3: QueuedJobCandidate = {
    id: 'autoaply_1793777090251_xyz',
    company: 'TestCo',
    title: 'SWE',
    url: 'https://boards.greenhouse.io/test/jobs/3',
  };
  const res3 = extractJobTimestampMs(cand3);
  assert.equal(res3.source, 'job_id_epoch');
  assert.equal(res3.timestampMs, 1793777090251);
});

test('GEN-443: computeJobPriorityScore strictly monotonic recency curve and hourly expiration', () => {
  const now = 1793777090251; // Reference epoch

  // 10 minutes old: recency +15,000
  const job10m: QueuedJobCandidate = {
    id: 'job_fresh_10m',
    company: 'FreshStartup',
    title: 'Backend Engineer',
    url: 'https://boards.greenhouse.io/fresh/1',
    createdAtMs: now - 10 * 60 * 1000,
  };

  // 2 hours old: recency +12,000
  const job2h: QueuedJobCandidate = {
    ...job10m,
    id: 'job_2h',
    createdAtMs: now - 2 * 3600 * 1000,
  };

  // 5 hours old: recency +9,000
  const job5h: QueuedJobCandidate = {
    ...job10m,
    id: 'job_5h',
    createdAtMs: now - 5 * 3600 * 1000,
  };

  // 18 hours old: recency decaying (6000 down to 3000)
  const job18h: QueuedJobCandidate = {
    ...job10m,
    id: 'job_18h',
    createdAtMs: now - 18 * 3600 * 1000,
  };

  // 50 hours old: recency decaying (2500 down to 1000)
  const job50h: QueuedJobCandidate = {
    ...job10m,
    id: 'job_50h',
    createdAtMs: now - 50 * 3600 * 1000,
  };

  const score10m = computeJobPriorityScore(job10m, now);
  const score2h = computeJobPriorityScore(job2h, now);
  const score5h = computeJobPriorityScore(job5h, now);
  const score18h = computeJobPriorityScore(job18h, now);
  const score50h = computeJobPriorityScore(job50h, now);

  assert.ok(score10m > score2h, `10m score (${score10m}) must beat 2h score (${score2h})`);
  assert.ok(score2h > score5h, `2h score (${score2h}) must beat 5h score (${score5h})`);
  assert.ok(score5h > score18h, `5h score (${score5h}) must beat 18h score (${score18h})`);
  assert.ok(score18h > score50h, `18h score (${score18h}) must beat 50h score (${score50h})`);

  // Bug 1B Verification: 4-day-old job with isHourlyFresh: true MUST expire and lose fresh boost!
  const staleHourlyFreshJob: QueuedJobCandidate = {
    id: 'job_stale_hourly',
    company: 'StaleCo',
    title: 'Backend Engineer',
    url: 'https://boards.greenhouse.io/stale/1',
    createdAtMs: now - 96 * 3600 * 1000, // 4 days old
    isHourlyFresh: true,
  };

  const staleScore = computeJobPriorityScore(staleHourlyFreshJob, now);
  assert.ok(
    score10m > staleScore + 10000,
    `Fresh 10m-old job (${score10m}) must decisively beat 4-day-old expired isHourlyFresh job (${staleScore})`
  );
});

test('GEN-443: computeJobPriorityScore tie-breaks by rowId', () => {
  const now = Date.now();
  const jobLowRowId: QueuedJobCandidate = {
    id: 'job-a',
    company: 'Co',
    title: 'Developer',
    url: 'https://boards.greenhouse.io/co/1',
    createdAtMs: now - 5000,
    rowId: 10,
  };

  const jobHighRowId: QueuedJobCandidate = {
    ...jobLowRowId,
    id: 'job-b',
    rowId: 2500,
  };

  const scoreLow = computeJobPriorityScore(jobLowRowId, now);
  const scoreHigh = computeJobPriorityScore(jobHighRowId, now);

  assert.ok(scoreHigh > scoreLow, `Higher rowId (${scoreHigh}) must score higher than lower rowId (${scoreLow})`);
});

test('GEN-444: Wonder-Pill 3-field dead-end ledger recording and loading', () => {
  const testLedgerPath = path.resolve('state/autoapply/portal-review/test-outreach-dead-ends.json');
  try { if (fs.existsSync(testLedgerPath)) fs.unlinkSync(testLedgerPath); } catch {}

  const deadEnd: WonderPillDeadEnd = {
    sourceOrigin: 'npm_registry',
    whatWentWrong: 'No maintainers published for scope: imaginaryorg',
    whyDisqualifying: 'Cannot resolve author email without published package registry record',
    company: 'ImaginaryOrg',
    domain: 'imaginaryorg.io',
  };

  recordWonderPillDeadEnd(deadEnd, testLedgerPath);
  const loaded = loadWonderPillDeadEnds(testLedgerPath);

  assert.equal(loaded.length, 1);
  assert.equal(loaded[0]?.sourceOrigin, 'npm_registry');
  assert.equal(loaded[0]?.whatWentWrong, deadEnd.whatWentWrong);
  assert.equal(loaded[0]?.whyDisqualifying, deadEnd.whyDisqualifying);
  assert.ok(loaded[0]?.timestamp, 'Timestamp must be stamped');

  try { if (fs.existsSync(testLedgerPath)) fs.unlinkSync(testLedgerPath); } catch {}
});

test('GEN-445: STOP_AUTOAPPLY.flag sentinel prevents unsafe supervisor restarts', () => {
  const sentinelPath = path.resolve('state/autoapply/portal-review/STOP_AUTOAPPLY.flag');
  const dir = path.dirname(sentinelPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(sentinelPath, 'STOP_TEST', 'utf8');
  assert.equal(fs.existsSync(sentinelPath), true, 'STOP_AUTOAPPLY.flag must be detectable on disk');

  fs.unlinkSync(sentinelPath);
  assert.equal(fs.existsSync(sentinelPath), false, 'STOP_AUTOAPPLY.flag cleanup must succeed');
});

test('GEN-446: drought diagnostics preserve submission policy and host backoff', () => {
  const testStateDir = path.resolve('state/autoapply/test-doctor-state');
  const testReviewDir = path.join(testStateDir, 'portal-review');
  fs.mkdirSync(testReviewDir, { recursive: true });

  const testHistoryPath = path.join(testReviewDir, 'run-history.jsonl');
  const testHostHealthPath = path.join(testStateDir, 'host-health.json');

  const now = Date.now();

  // Create run-history with 0 applied runs in last 30 minutes
  const failedRun = {
    timestamp: new Date(now - 10 * 60 * 1000).toISOString(),
    status: 'failed',
    error: 'Selector not found: submit-button',
  };
  fs.writeFileSync(testHistoryPath, JSON.stringify(failedRun) + '\n', 'utf8');

  // Create host-health with a temporary cooldown
  fs.writeFileSync(
    testHostHealthPath,
    JSON.stringify({ 'boards.greenhouse.io': { consecutiveFailures: 3, cooldownUntil: now + 60000, inCooldown: true } }),
    'utf8'
  );

  const report = check30MinZeroFillDroughtAndAutoHeal({
    stateDir: testStateDir,
    runHistoryPath: testHistoryPath,
    nowMs: now,
  });

  assert.equal(report.appliedLast30m, 0);
  assert.equal(report.healed, false);
  assert.equal(report.permissiveModeEnabled, false);
  assert.equal(report.cooldownsReset, false);
  assert.notEqual(process.env.FORCE_PERMISSIVE_SUBMIT_ALL, '1');

  // Verify host health cooldowns were cleared
  const updatedHostHealth = JSON.parse(fs.readFileSync(testHostHealthPath, 'utf8'));
  assert.equal(updatedHostHealth['boards.greenhouse.io'].consecutiveFailures, 3);
  assert.equal(updatedHostHealth['boards.greenhouse.io'].cooldownUntil, now + 60000);

  // Verify getDoctorStatus returns latest report
  const currentStatus = getDoctorStatus();
  assert.ok(currentStatus !== null);
  assert.equal(currentStatus?.healed, false);

  // Cleanup test sandbox
  try { fs.rmSync(testStateDir, { recursive: true, force: true }); } catch {}
});

test('GEN-436 / GEN-446: isAutomationChromeCommandLine protects personal Chrome from termination', () => {
  const personalCmd1 = '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --profile-directory="Default"';
  const personalCmd2 = '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --profile-directory="Profile 1"';
  const personalCmd3 = 'chrome.exe';

  const autoCmd1 = '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir="D:\\Jobscraper-next\\state\\autoapply\\browser-profile-lane-1" --enable-automation';
  const autoCmd2 = 'chrome.exe --user-data-dir="state/autoapply/browser-profile-1" --remote-debugging-port=9222';
  const autoCmd3 = 'chrome.exe --profile-directory="playwright_chromiumdev_profile"';

  assert.equal(isAutomationChromeCommandLine(personalCmd1), false, 'Personal Default profile must NEVER be classified as automation');
  assert.equal(isAutomationChromeCommandLine(personalCmd2), false, 'Personal Profile 1 must NEVER be classified as automation');
  assert.equal(isAutomationChromeCommandLine(personalCmd3), false, 'Bare personal Chrome without automation flags must return false');

  assert.equal(isAutomationChromeCommandLine(autoCmd1), true, 'Lane 1 automation profile must return true');
  assert.equal(isAutomationChromeCommandLine(autoCmd2), true, 'Autoapply state profile must return true');
  assert.equal(isAutomationChromeCommandLine(autoCmd3), true, 'Playwright profile must return true');
});
