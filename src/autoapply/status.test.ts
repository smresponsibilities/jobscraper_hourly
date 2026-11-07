import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AutoaplyQueueManager } from './autoaply.js';
import { readApplicationStatus, workerLiveness } from './status.js';

test('liveness requires a fresh heartbeat and the same process start', () => {
  const now = Date.now();
  const state = { pid: process.pid, status: 'running', heartbeatAt: new Date(now).toISOString(), processStartedAt: new Date(now - 10000).toISOString() };
  assert.equal(workerLiveness(state, now, () => now - 10000), 'running');
  assert.equal(workerLiveness(state, now, () => now - 30000), 'crashed');
  assert.equal(workerLiveness({ ...state, heartbeatAt: new Date(now - 60000).toISOString() }, now, () => now - 10000), 'unresponsive');
  assert.equal(workerLiveness({ ...state, heartbeatAt: new Date(now + 6000).toISOString() }, now, () => now - 10000), 'unknown');
  assert.equal(workerLiveness({ ...state, processStartedAt: undefined }, now), 'unknown');
  assert.equal(workerLiveness({ ...state, status: 'stopped' }, now), 'stopped');
});

test('status and explain omit profile and job contents', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'application-status-'));
  const queue = new AutoaplyQueueManager({ statePath: path.join(directory, 'queue.sqlite'), candidateId: 'fixture' });
  const job = queue.enqueue({ externalJobId: 'fixture', company: 'private-company', title: 'private-title', jobUrl: 'https://example.test/private', postedAt: '' });
  queue.pauseForReview(job.id, 'Required answer is missing');
  queue.close();
  writeFileSync(path.join(directory, 'candidate.json'), 'private-profile-secret');
  const result = JSON.stringify([readApplicationStatus(directory), readApplicationStatus(directory, job.id)]);
  assert(!result.includes('private-'));
  assert(result.includes('PARKED_MISSING_FACT'));
});

test('mailbox status exposes only known states and normalized timestamps', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'application-mail-status-'));
  const queue = new AutoaplyQueueManager({ statePath: path.join(directory, 'queue.sqlite'), candidateId: 'fixture' });
  queue.close();
  const file = path.join(directory, 'worker.json');
  writeFileSync(file, JSON.stringify({ mailboxStatus: 'error', mailboxCheckedAt: '2026-11-02T00:00:00Z' }));
  assert.deepEqual((readApplicationStatus(directory) as { mailbox: unknown }).mailbox, { status: 'error', checkedAt: '2026-11-02T00:00:00.000Z' });
  writeFileSync(file, JSON.stringify({ mailboxStatus: 'private-secret', mailboxCheckedAt: 'private-secret' }));
  assert.equal((readApplicationStatus(directory) as { mailbox?: unknown }).mailbox, undefined);
});

test('status filters summary values and survives partial history writes', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'application-status-summary-'));
  const queue = new AutoaplyQueueManager({ statePath: path.join(directory, 'queue.sqlite'), candidateId: 'fixture' });
  queue.close();
  const observedAt = '2026-11-01T00:00:00.000Z';
  writeFileSync(path.join(directory, 'worker.json'), '{');
  writeFileSync(path.join(directory, 'production-acceptance.json'), JSON.stringify({ auditedAt: 'private-secret', verifiedCount: 'private-secret', target: 50, byProvider: { greenhouse: 2, lever: 'private-secret', 'private-secret': 4 } }));
  writeFileSync(path.join(directory, 'intake-history.jsonl'), JSON.stringify({ observedAt, totals: { imported: 3, skipped: 'private-secret', retry: -1, fetched: true, extra: 'private-secret' } }) + '\n{"observedAt":');
  const result = readApplicationStatus(directory) as { worker: string; acceptance: object; intake: object };
  assert.equal(result.worker, 'unknown');
  assert.deepEqual(result.acceptance, { auditedAt: undefined, verifiedCount: undefined, target: 50, byProvider: { greenhouse: 2 } });
  assert.deepEqual(result.intake, { observedAt, totals: { imported: 3, fetched: true } });
  assert(!JSON.stringify(result).includes('private-secret'));
});
