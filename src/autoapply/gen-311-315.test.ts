import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LOW_RAM_CHROMIUM_ARGS } from './runner.js';
import {
  evaluateSystemHealthAndAdaptiveLanes,
  ContinuousRamAndHealthWatchdog,
  reapZombieChromeProcesses,
  scrubBrowserCachesAndTempDirs,
} from './health-and-ram-watchdog.js';

test('GEN-311: LOW_RAM_CHROMIUM_ARGS caps memory and processes', () => {
  assert.ok(LOW_RAM_CHROMIUM_ARGS.includes('--renderer-process-limit=2'), 'must limit renderer processes');
  assert.ok(LOW_RAM_CHROMIUM_ARGS.includes('--js-flags=--max-old-space-size=384'), 'must cap V8 old space to 384MB');
  assert.ok(LOW_RAM_CHROMIUM_ARGS.includes('--disable-gpu'), 'must disable GPU');
  assert.ok(LOW_RAM_CHROMIUM_ARGS.includes('--headless=new'), 'must default to new headless');
  assert.ok(LOW_RAM_CHROMIUM_ARGS.includes('--aggressive-cache-discard'), 'must discard cache aggressively');
});

test('GEN-312: evaluateSystemHealthAndAdaptiveLanes returns valid snapshot and writes state file', () => {
  const snapshot = evaluateSystemHealthAndAdaptiveLanes(false);
  assert.ok(snapshot.totalRamGb > 0, 'totalRamGb should be > 0');
  assert.ok(snapshot.freeRamGb >= 0, 'freeRamGb should be >= 0');
  assert.ok(snapshot.usedRamPct >= 0 && snapshot.usedRamPct <= 100, 'usedRamPct should be between 0 and 100');
  assert.ok(snapshot.recommendedLaneCount >= 1 && snapshot.recommendedLaneCount <= 6, 'recommendedLaneCount between 1 and 6');
  assert.ok(['OPTIMAL_SCALE_UP', 'NORMAL', 'THROTTLE_DOWN_LOW_RAM', 'CRITICAL_RAM_RECOVERY'].includes(snapshot.healthStatus));

  const jsonPath = path.resolve('state/autoapply/ram-health.json');
  assert.ok(fs.existsSync(jsonPath), 'state/autoapply/ram-health.json must exist');
  const diskData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  assert.equal(diskData.totalRamGb, snapshot.totalRamGb);
});

test('GEN-313: ContinuousRamAndHealthWatchdog lifecycle and adaptive methods', () => {
  const watchdog = new ContinuousRamAndHealthWatchdog(60_000);
  watchdog.start();
  const lanes = watchdog.getRecommendedLanes();
  assert.ok(lanes >= 1 && lanes <= 6, 'lanes must be between 1 and 6');

  const snap = watchdog.getSnapshot();
  assert.ok(snap.timestamp, 'snapshot must have timestamp');

  // Verify inter-chunk cleanup does not throw
  const cleanedSnap = watchdog.performInterChunkFullCleanup();
  assert.ok(cleanedSnap.timestamp, 'cleaned snapshot must have timestamp');
  watchdog.stop();
});

test('GEN-314: ContinuousRamAndHealthWatchdog wired into marathon, drain and scoreboard scripts', () => {
  const marathonSrc = fs.readFileSync('scripts/run-overnight-marathon.ts', 'utf8');
  assert.ok(marathonSrc.includes('ContinuousRamAndHealthWatchdog'), 'marathon must import and use ContinuousRamAndHealthWatchdog');
  assert.ok(marathonSrc.includes('ramWatchdog.getRecommendedLanes()'), 'marathon must check recommended lanes');
  assert.ok(marathonSrc.includes('performInterChunkFullCleanup'), 'marathon must call performInterChunkFullCleanup');

  const drainSrc = fs.readFileSync('scripts/drain-backfill-and-hourly.ts', 'utf8');
  assert.ok(drainSrc.includes('ContinuousRamAndHealthWatchdog'), 'drain must import and use ContinuousRamAndHealthWatchdog');
  assert.ok(drainSrc.includes('ramWatchdog.getRecommendedLanes()'), 'drain must check recommended lanes');
  assert.ok(drainSrc.includes('performInterChunkFullCleanup'), 'drain must call performInterChunkFullCleanup');

  const scoreboardSrc = fs.readFileSync('scripts/watch-live-scoreboard.ts', 'utf8');
  assert.ok(scoreboardSrc.includes('evaluateSystemHealthAndAdaptiveLanes'), 'scoreboard must call evaluateSystemHealthAndAdaptiveLanes');

  const dashboardSrc = fs.readFileSync('scripts/dashboard-server.ts', 'utf8');
  assert.ok(dashboardSrc.includes('/api/ram-health'), 'dashboard must expose /api/ram-health');
});
