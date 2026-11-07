import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { partitionJobsIntoProviderLanes, acquireLock, releaseLock, isPidRunningNode } from '../../scripts/drain-backfill-and-hourly.js';
import {
  detectJobArchetype,
  getArchetypeOrderedBullets,
  getArchetypeCategorizedSkills,
  generateResumeHtml,
} from '../resume/deterministic-builder.js';

test('GEN-45: partitionJobsIntoProviderLanes partitions jobs into 4 isolated provider lanes', () => {
  const sampleJobs = [
    { jobUrl: 'https://job-boards.greenhouse.io/datadog/jobs/12345', company: 'Datadog' },
    { jobUrl: 'https://jobs.ashbyhq.com/tekion/64b332be-cc41-4b4a-b0bf-6c5a7308fdb6', company: 'Tekion' },
    { jobUrl: 'https://wd3.myworkdayjobs.com/Fugro/job/123', company: 'Fugro' },
    { jobUrl: 'https://jobs.lever.co/example/abc', company: 'Example' },
    { jobUrl: 'https://careers.custom-domain.com/job/456', provider: 'greenhouse', company: 'CustomGH' },
    { jobUrl: 'https://careers.ashby-custom.com/job/789', provider: 'ashby', company: 'CustomAshby' },
  ];

  const lanes = partitionJobsIntoProviderLanes(sampleJobs);
  assert.equal(lanes.greenhouse.length, 2);
  assert.equal(lanes.ashby.length, 2);
  assert.equal(lanes.workday.length, 1);
  assert.equal(lanes.other.length, 1);
  assert.equal(lanes.greenhouse[0].company, 'Datadog');
  assert.equal(lanes.greenhouse[1].company, 'CustomGH');
  assert.equal(lanes.ashby[0].company, 'Tekion');
  assert.equal(lanes.ashby[1].company, 'CustomAshby');
  assert.equal(lanes.workday[0].company, 'Fugro');
  assert.equal(lanes.other[0].company, 'Example');
});

test('GEN-44: Resume generator populates dynamic candidate data without any auto-apply bot text', () => {
  const candidateJsonPath = path.resolve('state/autoapply/portal-review/candidate.json');
  const candidate = JSON.parse(fs.readFileSync(candidateJsonPath, 'utf8'));

  const html = generateResumeHtml(candidate, 'FULLSTACK');
  assert.ok(html.includes(candidate.personal.email));
  assert.ok(html.includes(candidate.personal.phone));
  assert.ok(html.includes('linkedin.com/in/mahajanshivam'));
  assert.ok(html.includes('github.com/smresponsibilities'));

  // Ensure FULLSTACK bullet starts with fullstack engineering
  const bullets = getArchetypeOrderedBullets('FULLSTACK');
  assert.ok(bullets[0].includes('Developed full-stack web interfaces'));
  assert.ok(bullets[0].includes('React, TypeScript, JavaScript, Node.js, Express.js'));

  // Ensure no forbidden terms
  assert.equal(/anti-bot|job board automation|jobscraper|stealth traversal/i.test(html), false);

  // Ensure no unverified skills
  const skills = getArchetypeCategorizedSkills('FULLSTACK');
  const allSkills = Object.values(skills).flat();
  assert.equal(allSkills.includes('Tailwind CSS'), false);
  assert.ok(allSkills.includes('React'));
  assert.ok(allSkills.includes('Angular'));
  assert.ok(allSkills.includes('Node.js'));
  assert.ok(allSkills.includes('Express.js'));
});

test('GEN-43: Stale worker lock detection detects dead PID and cleans up', () => {
  const tmpLock = path.resolve('out/test-temp/test-worker.lock');
  fs.mkdirSync(path.dirname(tmpLock), { recursive: true });

  // 1. Verify isPidRunningNode correctly identifies current node process vs dead PID
  assert.equal(isPidRunningNode(process.pid), true, 'Current node process PID must be identified as running node');
  assert.equal(isPidRunningNode(999999), false, 'Non-existent PID 999999 must not be running node');
  assert.equal(isPidRunningNode(-1), false, 'Negative PID must be false');
  assert.equal(isPidRunningNode(0), false, 'PID 0 must be false');

  // 2. Write a stale lock with dead PID 999999
  fs.writeFileSync(tmpLock, JSON.stringify({ pid: 999999, startedAt: new Date().toISOString() }), 'utf8');
  assert.ok(fs.existsSync(tmpLock));

  // 3. acquireLock must detect the stale lock from dead PID, clear it, and successfully acquire the lock
  const acquired = acquireLock(tmpLock);
  assert.equal(acquired, true, 'acquireLock must recover stale lock and succeed');

  // Verify the lock now holds current PID
  const currentLockData = JSON.parse(fs.readFileSync(tmpLock, 'utf8'));
  assert.equal(currentLockData.pid, process.pid);

  // 4. releaseLock must release the lock
  releaseLock(tmpLock);
  assert.equal(fs.existsSync(tmpLock), false, 'releaseLock must remove lock file');
});
