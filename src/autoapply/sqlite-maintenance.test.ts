import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runSqliteMaintenanceAndBackup } from './sqlite-maintenance.js';

test('queue snapshot includes WAL data and replaces the prior backup atomically', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-snapshot-test-'));
  const file = path.join(dir, 'queue.sqlite');
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE applications(id TEXT, status TEXT, normalized_url TEXT, payload TEXT); INSERT INTO applications VALUES('one','applied','https://jobs.ashbyhq.com/acme/job','{}'),('two','queued','https://example.test/job','{}')");
    const first = runSqliteMaintenanceAndBackup(file);
    assert.equal(first.integrityOk, true);
    assert.equal(first.backupCreated, true);
    assert.equal(first.appliedCount, 1);
    assert.equal(first.unknownProviderCount, 1);
    const backup = new DatabaseSync(first.backupPath, { readOnly: true });
    try { assert.equal((backup.prepare('SELECT count(*) AS n FROM applications').get() as { n: number }).n, 2); }
    finally { backup.close(); }
    db.exec("INSERT INTO applications VALUES('three','applied','https://jobs.lever.co/acme/job','{}')");
    const second = runSqliteMaintenanceAndBackup(file);
    assert.equal(second.backupCreated, true);
    assert.equal(second.appliedCount, 2);
    const newer = new DatabaseSync(second.backupPath, { readOnly: true });
    try { assert.equal((newer.prepare('SELECT count(*) AS n FROM applications').get() as { n: number }).n, 3); }
    finally { newer.close(); }
    db.exec('DROP TABLE applications');
    assert.throws(() => runSqliteMaintenanceAndBackup(file));
    const preserved = new DatabaseSync(second.backupPath, { readOnly: true });
    try { assert.equal((preserved.prepare('SELECT count(*) AS n FROM applications').get() as { n: number }).n, 3); }
    finally { preserved.close(); }
    assert.throws(() => runSqliteMaintenanceAndBackup(second.backupPath), /must differ/);
  } finally {
    db.close();
    for (const entry of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, entry));
    fs.rmdirSync(dir);
  }
});

test('maintenance refuses to create a missing queue', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-missing-test-'));
  try {
    const file = path.join(dir, 'missing.sqlite');
    assert.throws(() => runSqliteMaintenanceAndBackup(file), /does not exist/);
    assert.equal(fs.existsSync(file), false);
  } finally { fs.rmdirSync(dir); }
});
