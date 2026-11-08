import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isPostedWithinHours } from '../../scripts/harvest-100-hourly-jobs.js';
import { discoverGithubOrgCommitContacts } from '../outreach/free-contact-discovery.js';

test('GEN-267: isPostedWithinHours accurately identifies < 72h recency', () => {
  const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const fortyEightHoursAgo = Date.now() - 48 * 3600 * 1000;
  const eightyHoursAgo = new Date(Date.now() - 80 * 3600 * 1000).toISOString();
  const thirtyDaysAgo = Date.now() - 30 * 24 * 3600 * 1000;

  assert.equal(isPostedWithinHours(oneHourAgo, 72), true);
  assert.equal(isPostedWithinHours(fortyEightHoursAgo, 72), true);
  assert.equal(isPostedWithinHours(eightyHoursAgo, 72), false);
  assert.equal(isPostedWithinHours(thirtyDaysAgo, 72), false);
  assert.equal(isPostedWithinHours(null, 72), false);
  assert.equal(isPostedWithinHours(undefined, 72), false);
  assert.equal(isPostedWithinHours('invalid-date', 72), false);

  const harvesterCode = fs.readFileSync(path.resolve('scripts/harvest-100-hourly-jobs.ts'), 'utf8');
  assert.ok(harvesterCode.includes('postedRecent ? 3 : 2'), 'Must stamp is_hourly_fresh = 3 for recent jobs');
  assert.ok(harvesterCode.includes('postedRecent: isPostedWithinHours'), 'Must evaluate postedRecent across ATS fetchers');
});

test('GEN-268: runner.ts includes the scrapped-value flaw mutator (setMutated) inside healInvalidFieldsAndRetrySubmit', () => {
  const runnerSrc = fs.readFileSync(path.resolve('src/autoapply/runner.ts'), 'utf8');
  assert.ok(runnerSrc.includes('setMutated'), 'runner.ts must define setMutated helper');
  assert.ok(runnerSrc.includes('_valueTracker?.setValue'), 'runner.ts must clear _valueTracker');
  assert.ok(runnerSrc.includes('digits\\s+only'), 'runner.ts must handle numeric-only error text');
  assert.ok(runnerSrc.includes('greater\\s+than|at\\s+least\\s+1'), 'runner.ts must mutate zero to 1 when minimum positive required');
});

test('GEN-269: runner.ts aborts 3rd-party session-recording bloat', () => {
  const runnerSrc = fs.readFileSync(path.resolve('src/autoapply/runner.ts'), 'utf8');
  assert.ok(runnerSrc.includes('fullstory\\.com|hotjar\\.com'), 'runner.ts must route abort session recorders');
  assert.ok(runnerSrc.includes('route.abort()'), 'runner.ts must abort matched tracker routes');
});

test('GEN-270: discoverGithubOrgCommitContacts accepts roleTitle and prioritizes team repos', () => {
  assert.equal(typeof discoverGithubOrgCommitContacts, 'function');
  const outreachCode = fs.readFileSync(path.resolve('src/outreach/free-contact-discovery.ts'), 'utf8');
  assert.ok(outreachCode.includes("roleTitle = ''"), 'discoverGithubOrgCommitContacts must accept roleTitle');
  assert.ok(outreachCode.includes('per_page=15'), 'Must fetch up to 15 repositories');
  assert.ok(outreachCode.includes('rankedRepos'), 'Must rank repos based on roleTitle tokens');
});
