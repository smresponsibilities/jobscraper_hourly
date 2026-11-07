import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { AutoaplyQueueManager } from './autoaply.js';
import { DatabaseSync } from 'node:sqlite';

test('daily submission reservations survive restarts and are shared by workers', () => {
  const statePath = path.join(mkdtempSync(path.join(tmpdir(), 'application-cap-')), 'queue.sqlite');
  const first = new AutoaplyQueueManager({ statePath, candidateId: 'fixture' });
  const second = new AutoaplyQueueManager({ statePath, candidateId: 'fixture' });
  try {
    assert.equal(first.reserveSubmission('2026-11-01', 2), true);
    assert.equal(second.reserveSubmission('2026-11-01', 2), true);
    assert.equal(first.reserveSubmission('2026-11-01', 2), false);
    assert.equal(second.submissionCount('2026-11-01'), 2);
  } finally { first.close(); second.close(); }
  const reopened = new AutoaplyQueueManager({ statePath, candidateId: 'fixture' });
  try {
    assert.equal(reopened.reserveSubmission('2026-11-01', 2), false);
    assert.equal(reopened.reserveSubmission('2026-11-02', 2), true);
  } finally { reopened.close(); }
});

test('tenant submissions share the daily cap and expire after one hour', () => {
  const statePath = path.join(mkdtempSync(path.join(tmpdir(), 'application-tenant-cap-')), 'queue.sqlite');
  const queue = new AutoaplyQueueManager({ statePath, candidateId: 'fixture' });
  try {
    assert.equal(queue.reserveTenantSubmission('2026-11-01', 3, 'tenant-a', 10000000, 2), 'ok');
    assert.equal(queue.reserveTenantSubmission('2026-11-01', 3, 'tenant-a', 10000001, 2), 'ok');
    assert.equal(queue.reserveTenantSubmission('2026-11-01', 3, 'tenant-a', 10000002, 2), 'tenant');
    assert(queue.limitedTenants(10000002 - 3600000, 2).has('tenant-a'));
    assert.equal(queue.reserveTenantSubmission('2026-11-01', 3, 'tenant-b', 10000002, 2), 'ok');
    assert.equal(queue.reserveTenantSubmission('2026-11-01', 3, 'tenant-b', 10000003, 2), 'daily');
    assert.equal(queue.reserveTenantSubmission('2026-11-02', 3, 'tenant-a', 13600002, 2), 'ok');
  } finally { queue.close(); }
});

test('tenant challenge cooldown persists across restarts and never shortens', () => {
  const statePath = path.join(mkdtempSync(path.join(tmpdir(), 'application-challenge-')), 'queue.sqlite');
  let queue = new AutoaplyQueueManager({ statePath, candidateId: 'fixture' });
  try {
    queue.coolTenant('tenant-a', 2000);
    queue.coolTenant('tenant-a', 1500);
    queue.close();
    queue = new AutoaplyQueueManager({ statePath, candidateId: 'fixture' });
    assert(queue.coolingTenants(1999).has('tenant-a'));
    assert(!queue.coolingTenants(2000).has('tenant-a'));
    assert(!queue.coolingTenants(1000).has('tenant-b'));
  } finally { queue.close(); }
});

test('outcomes retain closed reason codes and old rows remain readable', () => {
  const statePath = path.join(mkdtempSync(path.join(tmpdir(), 'application-reason-')), 'queue.sqlite');
  const queue = new AutoaplyQueueManager({ statePath, candidateId: 'fixture' });
  try {
    const job = queue.enqueue({ externalJobId: 'fixture', title: 'Engineer', company: 'Fixture', jobUrl: 'https://example.test/job', postedAt: '' });
    assert.equal(job.reasonCode, undefined);
    queue.skip(job.id, 'ineligible_jd_experience');
    assert.equal(queue.list()[0]!.reasonCode, 'SKIPPED_YOE');
  } finally { queue.close(); }
  const reopened = new AutoaplyQueueManager({ statePath, candidateId: 'fixture' });
  try { assert.equal(reopened.list()[0]!.reasonCode, 'SKIPPED_YOE'); } finally { reopened.close(); }
});

test('lifecycle events retain phases and codes without job content', () => {
  const statePath = path.join(mkdtempSync(path.join(tmpdir(), 'application-events-')), 'queue.sqlite');
  const queue = new AutoaplyQueueManager({ statePath, candidateId: 'fixture' });
  try {
    const job = queue.enqueue({ externalJobId: 'fixture', title: 'Secret title', company: 'Secret company', jobUrl: 'https://example.test/job', postedAt: '' });
    queue.markApplying(job.id);
    queue.recordEvent(job.id, 'step', 1);
    queue.pauseForReview(job.id, 'Required answer is missing');
    const db = new DatabaseSync(statePath, { readOnly: true });
    try {
      const events = db.prepare('SELECT phase,reason_code,step_index FROM application_events ORDER BY rowid').all();
      assert.deepEqual(events.map(row => row.phase), ['queued', 'claimed', 'step', 'paused_for_review']);
      assert.equal(events.at(-1)?.reason_code, 'PARKED_MISSING_FACT');
      assert(!JSON.stringify(events).includes('Secret'));
    } finally { db.close(); }
  } finally { queue.close(); }
});

test('legacy experience skips are marked once for source revalidation', () => {
  const statePath = path.join(mkdtempSync(path.join(tmpdir(), 'experience-recheck-')), 'queue.json');
  writeFileSync(statePath, JSON.stringify({ version: 1, candidateId: 'fixture', jobs: [{ id: 'old', externalJobId: 'fixture', title: 'Software Engineer', company: 'Fixture', jobUrl: 'https://example.test/job', postedAt: '', jobBoard: 'direct_ats', status: 'skipped', error: 'ineligible_jd_experience' }] }));
  const first = new AutoaplyQueueManager({ statePath, candidateId: 'fixture' });
  try {
    assert.equal(first.list()[0]!.error, 'experience_recheck_pending');
    assert(first.reopenAtSource('old'));
    first.skip('old', 'ineligible_jd_experience');
  } finally { first.close(); }
  const second = new AutoaplyQueueManager({ statePath, candidateId: 'fixture' });
  try { assert.equal(second.list()[0]!.error, 'ineligible_jd_experience'); } finally { second.close(); }
});

const item = { externalJobId: 'greenhouse:fixture:1', title: 'Engineer', company: 'Fixture', jobUrl: 'https://boards.greenhouse.io/fixture/jobs/1', postedAt: '2026-10-30T00:00:00Z' };

test('only one worker may own a queue until it closes', () => {
  const statePath = path.join(mkdtempSync(path.join(tmpdir(), 'application-worker-lock-')), 'queue.sqlite');
  const first = new AutoaplyQueueManager({ statePath, candidateId: 'fixture' });
  const second = new AutoaplyQueueManager({ statePath, candidateId: 'fixture' });
  try {
    assert.equal(first.acquireWorkerLock(), true);
    assert.equal(second.acquireWorkerLock(), false);
    first.close();
    assert.equal(second.acquireWorkerLock(), true);
  } finally { first.close(); second.close(); }
});

test('expired heartbeat does not release a live worker claim', () => {
  const statePath = path.join(mkdtempSync(path.join(tmpdir(), 'application-sleep-')), 'queue.sqlite');
  const first = new AutoaplyQueueManager({ statePath, candidateId: 'fixture' });
  const job = first.enqueue(item);
  try {
    assert.equal(first.markApplying(job.id), true);
    const db = new DatabaseSync(statePath);
    try { db.exec('UPDATE workers SET expires=0; UPDATE applications SET expires=0'); } finally { db.close(); }
    const second = new AutoaplyQueueManager({ statePath, candidateId: 'fixture' });
    try {
      assert.equal(second.list().find(entry => entry.id === job.id)?.status, 'applying');
      assert.equal(second.markApplying(job.id), false);
    } finally { second.close(); }
  } finally { first.close(); }
});

test('SQLite lets intake continue during a leased application and only one worker claims it', () => {
  const statePath = path.join(mkdtempSync(path.join(tmpdir(), 'application-wal-')), 'queue.sqlite');
  const first = new AutoaplyQueueManager({ statePath, candidateId: 'fixture' });
  const second = new AutoaplyQueueManager({ statePath, candidateId: 'fixture' });
  try {
    const job = first.enqueue(item);
    assert.equal(first.markApplying(job.id), true);
    assert.equal(second.markApplying(job.id), false);
    second.enqueue({ ...item, externalJobId: 'greenhouse:fixture:2', jobUrl: 'https://job-boards.greenhouse.io/fixture/jobs/2' });
    assert.equal(first.list().length, 2);
    const receipt = { url: 'https://job-boards.greenhouse.io/fixture/jobs/1/confirmation', text: 'Application submitted', verifiedAt: new Date().toISOString() };
    first.markApplied(job.id, receipt);
    assert.equal(second.list().find(entry => entry.id === job.id)?.status, 'applied');
    assert.deepEqual(second.list().find(entry => entry.id === job.id)?.receipt, receipt);
    const appliedAt = second.list().find(entry => entry.id === job.id)?.appliedAt;
    second.markApplied(job.id, { ...receipt, emailConfirmationId: '<role-confirmed@fixture>' });
    const upgraded = first.list().find(entry => entry.id === job.id)!;
    assert.equal(upgraded.receipt?.emailConfirmationId, '<role-confirmed@fixture>');
    assert.equal(upgraded.appliedAt, appliedAt);
    assert.equal(first.getMetrics().totalApplied, 1);
    assert.equal(second.getPendingQueue().length, 1);
    assert.equal(second.enqueue({ ...item, jobUrl: 'https://job-boards.greenhouse.io/fixture/jobs/1?gh_src=linkedin' }).id, job.id);
  } finally { second.close(); first.close(); }
});

test('legacy JSON migration preserves receipts and the original file byte-for-byte', () => {
  const statePath = path.join(mkdtempSync(path.join(tmpdir(), 'application-migration-')), 'queue.json');
  const receipt = { url: item.jobUrl, text: 'Already applied', verifiedAt: new Date().toISOString(), existing: true };
  const original = JSON.stringify({ version: 1, candidateId: 'fixture', jobs: [{ ...item, id: 'original', status: 'applied', jobBoard: 'direct_ats', receipt }] }, null, 2);
  writeFileSync(statePath, original);
  const queue = new AutoaplyQueueManager({ statePath, candidateId: 'fixture' });
  try {
    assert.deepEqual(queue.list()[0]?.receipt, receipt);
    assert.equal(queue.enqueue({ ...item, jobUrl: 'https://job-boards.greenhouse.io/fixture/jobs/1/application' }).id, 'original');
    assert.equal(queue.getMetrics().totalApplied, 1);
    assert.equal(readFileSync(statePath, 'utf8'), original);
  } finally { queue.close(); }
});

test('a killed worker leaves no stale file lock and its leased job is recovered for review', async () => {
  const statePath = path.join(mkdtempSync(path.join(tmpdir(), 'application-crash-')), 'queue.sqlite');
  const source = `import {AutoaplyQueueManager} from './src/autoapply/autoaply.ts';const q=new AutoaplyQueueManager({statePath:process.argv[1],candidateId:'fixture'});if(!q.acquireWorkerLock())throw Error('lock unavailable');const j=q.enqueue(${JSON.stringify(item)});q.markApplying(j.id);console.log('claimed');setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source, statePath], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const timer = setTimeout(() => child.kill(), 60000);
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.on('data', chunk => { output += chunk.toString(); if (output.includes('claimed')) resolve(); });
      child.once('error', reject);
      child.once('exit', () => { if (!output.includes('claimed')) reject(Error('Fixture worker exited before claim')); });
    });
    const stopped = new Promise<void>(resolve => child.once('close', () => resolve()));
    child.kill('SIGKILL');
    await stopped;
    const queue = new AutoaplyQueueManager({ statePath, candidateId: 'fixture' });
    try { assert.equal(queue.list()[0]?.status, 'paused_for_review'); assert.equal(queue.acquireWorkerLock(), true); }
    finally { queue.close(); }
  } finally { clearTimeout(timer); child.kill(); }
});
