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
  computeRecommendedLanes,
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

test('GEN-426: Recalibrated lane thresholds run 4 lanes at 1.17 GB free RAM and verify boundary conditions', () => {
  // Baseline test: 1.17 GB free RAM and ~85% used RAM runs 4 lanes in NORMAL mode
  const at117Gb = computeRecommendedLanes(1.17, 85.0);
  assert.equal(at117Gb.recommendedLaneCount, 4, '1.17 GB free RAM must run 4 lanes');
  assert.equal(at117Gb.healthStatus, 'NORMAL');

  // CRITICAL_RAM_RECOVERY: only when freeRamGb < 0.45 OR usedRamPct >= 95
  const critLowRam = computeRecommendedLanes(0.44, 80.0);
  assert.equal(critLowRam.recommendedLaneCount, 1);
  assert.equal(critLowRam.healthStatus, 'CRITICAL_RAM_RECOVERY');

  const critHighUsed = computeRecommendedLanes(1.5, 95.0);
  assert.equal(critHighUsed.recommendedLaneCount, 1);
  assert.equal(critHighUsed.healthStatus, 'CRITICAL_RAM_RECOVERY');

  // THROTTLE_DOWN_LOW_RAM: when 0.45 <= freeRamGb < 0.85 OR usedRamPct >= 91
  const throttleLowRam = computeRecommendedLanes(0.45, 80.0);
  assert.equal(throttleLowRam.recommendedLaneCount, 2);
  assert.equal(throttleLowRam.healthStatus, 'THROTTLE_DOWN_LOW_RAM');

  const throttleUpperLowRam = computeRecommendedLanes(0.84, 80.0);
  assert.equal(throttleUpperLowRam.recommendedLaneCount, 2);
  assert.equal(throttleUpperLowRam.healthStatus, 'THROTTLE_DOWN_LOW_RAM');

  const throttleHighUsed = computeRecommendedLanes(1.2, 91.0);
  assert.equal(throttleHighUsed.recommendedLaneCount, 2);
  assert.equal(throttleHighUsed.healthStatus, 'THROTTLE_DOWN_LOW_RAM');

  // NORMAL: when 0.85 <= freeRamGb < 2.4
  const normalLower = computeRecommendedLanes(0.85, 80.0);
  assert.equal(normalLower.recommendedLaneCount, 4);
  assert.equal(normalLower.healthStatus, 'NORMAL');

  const normalUpper = computeRecommendedLanes(2.39, 75.0);
  assert.equal(normalUpper.recommendedLaneCount, 4);
  assert.equal(normalUpper.healthStatus, 'NORMAL');

  // OPTIMAL_SCALE_UP: when freeRamGb >= 2.4 AND usedRamPct <= 80
  const optimal = computeRecommendedLanes(2.4, 80.0);
  assert.equal(optimal.recommendedLaneCount, 6);
  assert.equal(optimal.healthStatus, 'OPTIMAL_SCALE_UP');

  // If freeRamGb >= 2.4 but usedRamPct > 80, drops back to NORMAL (4 lanes)
  const optimalBlockedByUsedRam = computeRecommendedLanes(2.5, 80.1);
  assert.equal(optimalBlockedByUsedRam.recommendedLaneCount, 4);
  assert.equal(optimalBlockedByUsedRam.healthStatus, 'NORMAL');
});
