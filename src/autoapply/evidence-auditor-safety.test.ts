import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildAndVerifyEvidenceMerkleLedger, verifyStoredEvidenceMerkleLedger } from './evidence-auditor.js';

test('ledger refuses invented dates and preserves an existing ledger', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'evidence-ledger-'));
  const database = path.join(dir, 'queue.sqlite'), ledger = path.join(dir, 'ledger.json');
  const db = new DatabaseSync(database);
  try {
    db.exec('CREATE TABLE applications(id TEXT, normalized_url TEXT, payload TEXT, status TEXT)');
    db.prepare('INSERT INTO applications VALUES (?, ?, ?, ?)').run('1', 'https://example.test/job', '{}', 'applied');
    assert.throws(() => buildAndVerifyEvidenceMerkleLedger(database, path.join(dir, 'new-ledger.json')), /Missing application timestamp/);
    writeFileSync(ledger, '[{"prior":"do not overwrite"}]');
    assert.throws(() => buildAndVerifyEvidenceMerkleLedger(database, ledger), /cannot be rewritten/);
    assert.equal(readFileSync(ledger, 'utf8'), '[{"prior":"do not overwrite"}]');
    db.prepare('UPDATE applications SET payload=?').run(JSON.stringify({ appliedAt: '2026-01-02T00:00:00Z' }));
    assert.throws(() => buildAndVerifyEvidenceMerkleLedger(database, ledger), /cannot be rewritten/);
    assert.equal(readFileSync(ledger, 'utf8'), '[{"prior":"do not overwrite"}]');
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('ledger marks source as unverified and checks the chain', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'evidence-ledger-'));
  const database = path.join(dir, 'queue.sqlite'), ledger = path.join(dir, 'ledger.json');
  const db = new DatabaseSync(database);
  try {
    db.exec('CREATE TABLE applications(id TEXT, normalized_url TEXT, payload TEXT, status TEXT)');
    db.prepare('INSERT INTO applications VALUES (?, ?, ?, ?)').run('1', 'https://example.test/job', JSON.stringify({ appliedAt: '2026-01-02T00:00:00Z' }), 'applied');
    const report = buildAndVerifyEvidenceMerkleLedger(database, ledger);
    assert.equal(report.entries[0]?.verificationSource, 'queue_timestamp_unverified');
    assert.equal(verifyStoredEvidenceMerkleLedger(ledger), true);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('backfilled older IDs append without changing existing evidence and altered rows fail closed', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'evidence-ledger-'));
  const database = path.join(dir, 'queue.sqlite'), ledger = path.join(dir, 'ledger.json');
  const db = new DatabaseSync(database);
  try {
    db.exec('CREATE TABLE applications(id TEXT, normalized_url TEXT, payload TEXT, status TEXT)');
    const insert = db.prepare('INSERT INTO applications VALUES (?, ?, ?, ?)');
    insert.run('b', 'https://example.test/b', JSON.stringify({ appliedAt: '2026-01-02T00:00:00Z' }), 'applied');
    const first = buildAndVerifyEvidenceMerkleLedger(database, ledger).entries;
    insert.run('a', 'https://example.test/a', JSON.stringify({ appliedAt: '2026-01-01T00:00:00Z' }), 'applied');
    const next = buildAndVerifyEvidenceMerkleLedger(database, ledger);
    assert.deepEqual(next.entries.slice(0, 1), first);
    assert.equal(next.entries[1]?.jobId, 'a');
    assert.equal(verifyStoredEvidenceMerkleLedger(ledger), true);
    const before = readFileSync(ledger, 'utf8');
    db.prepare('UPDATE applications SET payload=? WHERE id=?').run(JSON.stringify({ appliedAt: '2026-02-01T00:00:00Z' }), 'b');
    assert.throws(() => buildAndVerifyEvidenceMerkleLedger(database, ledger), /cannot be rewritten/);
    assert.equal(readFileSync(ledger, 'utf8'), before);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
