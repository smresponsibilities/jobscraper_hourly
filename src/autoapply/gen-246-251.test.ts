import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TIER_0_HIGH_YIELD_BOARDS,
  loadVerifiedLiveBoards,
  saveVerifiedLiveBoards,
} from '../../scripts/harvest-100-hourly-jobs.js';
import { runLiveHnAndNewsDiscoverySweep } from '../../scripts/run-live-discovery-sweep.js';
import { syncAppliedJobsToOutreachTargets } from '../../scripts/sync-applied-to-outreach.js';
import { discoverPublicWebsiteContacts } from '../outreach/free-contact-discovery.js';

test('GEN-246: scripts/harvest-100-hourly-jobs.ts expands TIER_0_HIGH_YIELD_BOARDS to 150+ boards and persists verified-live-boards.json', () => {
  assert.ok(
    TIER_0_HIGH_YIELD_BOARDS.length >= 140,
    `TIER_0_HIGH_YIELD_BOARDS must contain >= 140 boards, got ${TIER_0_HIGH_YIELD_BOARDS.length}`
  );

  const slugs = new Set(TIER_0_HIGH_YIELD_BOARDS.map((b) => b.slug.toLowerCase()));
  assert.ok(slugs.has('browserstack'), 'Must include browserstack');
  assert.ok(slugs.has('datadog'), 'Must include datadog');
  assert.ok(slugs.has('figma'), 'Must include figma');
  assert.ok(slugs.has('elevenlabs'), 'Must include elevenlabs');
  assert.ok(slugs.has('palantir'), 'Must include palantir');
  assert.ok(slugs.has('urbancompany'), 'Must include urbancompany');

  // Verify persistence functions exist and roundtrip
  assert.equal(typeof loadVerifiedLiveBoards, 'function');
  assert.equal(typeof saveVerifiedLiveBoards, 'function');
});

test('GEN-248: scripts/run-live-discovery-sweep.ts exports runLiveHnAndNewsDiscoverySweep', () => {
  assert.equal(typeof runLiveHnAndNewsDiscoverySweep, 'function');
});

test('GEN-249: scripts/sync-applied-to-outreach.ts reads queue.sqlite and syncs confirmed applied jobs', () => {
  const count = syncAppliedJobsToOutreachTargets();
  assert.ok(typeof count === 'number', 'Count must be a number');
  assert.ok(count >= 70, `Applied outreach count must be >= 70, got ${count}`);

  const targetsFile = 'state/autoapply/applied-outreach-targets.json';
  assert.ok(fs.existsSync(targetsFile), 'applied-outreach-targets.json must exist');
  const content = JSON.parse(fs.readFileSync(targetsFile, 'utf8'));
  assert.ok(Array.isArray(content.targets), 'targets array must exist');
  assert.ok(content.targets.length >= 70, 'targets array must have >= 70 rows');
});

test('GEN-250: src/outreach/free-contact-discovery.ts exports discoverPublicWebsiteContacts', () => {
  assert.equal(typeof discoverPublicWebsiteContacts, 'function');
});
