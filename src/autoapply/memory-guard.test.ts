import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessSystemMemoryPressure, isSafeToReapChromeCommandLine } from './memory-guard.js';
const gb = 1024 ** 3;
test('memory pressure reduces lane count without exceeding safe limits', () => {
  assert.equal(assessSystemMemoryPressure({ freeMemBytes: 4 * gb, rssBytes: 0 }).recommendedLaneCount, 4);
  assert.equal(assessSystemMemoryPressure({ freeMemBytes: 1.5 * gb, rssBytes: 0 }).recommendedLaneCount, 2);
  assert.equal(assessSystemMemoryPressure({ freeMemBytes: 0.9 * gb, rssBytes: 0 }).recommendedLaneCount, 1);
  assert.equal(assessSystemMemoryPressure({ freeMemBytes: 4 * gb, rssBytes: 1.3 * gb }).pressureLevel, 'CRITICAL');
  assert.equal(assessSystemMemoryPressure({ freeMemBytes: NaN, rssBytes: 0 }).recommendedLaneCount, 2);
});
test('reaper excludes personal and non-headless browser profiles', () => {
  assert.equal(isSafeToReapChromeCommandLine('chrome --headless=new --user-data-dir=D:\\state\\autoapply\\fixture'), true);
  assert.equal(isSafeToReapChromeCommandLine('chrome --user-data-dir=D:\\state\\autoapply\\fixture'), false);
  assert.equal(isSafeToReapChromeCommandLine('chrome --headless=new --user-data-dir=D:\\state\\autoapply --profile-directory="Profile 1"'), false);
  assert.equal(isSafeToReapChromeCommandLine('chrome --headless=new --enable-automation'), false);
});
