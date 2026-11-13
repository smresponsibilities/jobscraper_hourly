import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildLiveDashboardTelemetrySnapshot } from './dashboard-telemetry-snapshot.js';

test('snapshot counts queue rows and checks supervisor and stop state', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dashboard-snapshot-'));
  const dbPath = path.join(dir, 'queue.sqlite'), ledgerPath = path.join(dir, 'ledger.json'), supervisorLockPath = path.join(dir, 'supervisor.lock'), stopFlagPath = path.join(dir, 'stop.flag');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('CREATE TABLE applications(status TEXT, normalized_url TEXT)');
    const add = db.prepare('INSERT INTO applications VALUES (?, ?)');
    add.run('applied', 'https://example.test/job');
    add.run('queued', 'https://boards.greenhouse.io/example/jobs/1');
    add.run('queued', 'https://example.test/job');
    writeFileSync(supervisorLockPath, String(process.pid));
    writeFileSync(stopFlagPath, 'stop');
    const result = buildLiveDashboardTelemetrySnapshot({ dbPath, ledgerPath, supervisorLockPath, stopFlagPath });
    assert.equal(result.totalApplied, 1);
    assert.equal(result.queuedByProvider.greenhouse, 1);
    assert.equal(result.queuedByProvider.unknown, 1);
    assert.equal(result.fastAtsQueuedTotal, 1);
    assert.equal(result.merkleChainVerified, false);
    assert.equal(result.supervisorAlive, true);
    assert.equal(result.stopFlagPresent, true);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('default snapshot detects a root stop flag', () => {
  const previous = process.cwd();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dashboard-root-stop-'));
  const dbPath = path.join(dir, 'queue.sqlite');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('CREATE TABLE applications(status TEXT, normalized_url TEXT)');
    writeFileSync(path.join(dir, 'STOP_AUTOAPPLY.flag'), 'stop');
    process.chdir(dir);
    assert.equal(buildLiveDashboardTelemetrySnapshot({ dbPath }).stopFlagPresent, true);
  } finally { process.chdir(previous); db.close(); rmSync(dir, { recursive: true, force: true }); }
});
