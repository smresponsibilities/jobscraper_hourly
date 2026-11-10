import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ActiveBrowserRegistry,
  registerActiveBrowserPid,
  unregisterActiveBrowserPid,
  identifyOrphanedChromePids,
  computeRecommendedLanes,
  evaluateSystemHealthAndAdaptiveLanes,
} from './health-and-ram-watchdog.js';

test('GEN-434: ActiveBrowserRegistry registers and unregisters running browser PIDs', () => {
  ActiveBrowserRegistry.clear();

  registerActiveBrowserPid(12345);
  registerActiveBrowserPid(67890);
  assert.equal(ActiveBrowserRegistry.has(12345), true);
  assert.equal(ActiveBrowserRegistry.has(67890), true);
  assert.equal(ActiveBrowserRegistry.has(99999), false);

  unregisterActiveBrowserPid(12345);
  assert.equal(ActiveBrowserRegistry.has(12345), false);
  assert.equal(ActiveBrowserRegistry.has(67890), true);

  ActiveBrowserRegistry.clear();
});

test('GEN-434: identifyOrphanedChromePids distinguishes active vs orphaned zombies', () => {
  ActiveBrowserRegistry.clear();
  registerActiveBrowserPid(5001); // Active worker browser PID

  const mockProcesses = [
    { pid: 5001, ageSeconds: 300 }, // Old but registered in ActiveBrowserRegistry -> PROTECTED
    { pid: 5002, ageSeconds: 220 }, // Old (> 180s) and NOT registered -> ORPHANED ZOMBIE
    { pid: 5003, ageSeconds: 45 },  // Young (< 180s) and NOT registered -> SPAWNING / RECENT
    { pid: 5004, ageSeconds: 600 }, // Ancient (> 180s) and NOT registered -> ORPHANED ZOMBIE
  ];

  const orphaned = identifyOrphanedChromePids(mockProcesses, 180);
  assert.deepEqual(orphaned, [5002, 5004], 'Must isolate exactly unregistered chrome PIDs > 180s old');

  ActiveBrowserRegistry.clear();
});

test('GEN-434: computeRecommendedLanes calibrates concurrency based on RAM thresholds', () => {
  // 1. < 500 MB free RAM -> 1 lane, CRITICAL_RAM_RECOVERY
  const critical = computeRecommendedLanes(0.35, 96);
  assert.equal(critical.recommendedLaneCount, 1);
  assert.equal(critical.healthStatus, 'CRITICAL_RAM_RECOVERY');

  // 2. 500 MB - 1000 MB free RAM -> 2 lanes, THROTTLE_DOWN_LOW_RAM
  const lowRam = computeRecommendedLanes(0.75, 88);
  assert.equal(lowRam.recommendedLaneCount, 2);
  assert.equal(lowRam.healthStatus, 'THROTTLE_DOWN_LOW_RAM');

  // 3. > 1000 MB free RAM -> 4 lanes, NORMAL
  const normal = computeRecommendedLanes(1.8, 75);
  assert.equal(normal.recommendedLaneCount, 4);
  assert.equal(normal.healthStatus, 'NORMAL');
});

test('GEN-434: evaluateSystemHealthAndAdaptiveLanes writes telemetry snapshot', () => {
  const snapshot = evaluateSystemHealthAndAdaptiveLanes(false);
  assert.ok(snapshot.totalRamGb > 0, 'Total RAM must be positive');
  assert.ok(snapshot.freeRamGb >= 0, 'Free RAM must be non-negative');
  assert.ok(snapshot.usedRamPct >= 0 && snapshot.usedRamPct <= 100, 'Used RAM % must be between 0 and 100');
  assert.ok([1, 2, 4, 6].includes(snapshot.recommendedLaneCount), 'Recommended lanes must be valid');

  const outPath = path.resolve('state/autoapply/ram-health.json');
  assert.ok(fs.existsSync(outPath), 'ram-health.json must exist');
  const diskData = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(diskData.healthStatus, snapshot.healthStatus);
});
