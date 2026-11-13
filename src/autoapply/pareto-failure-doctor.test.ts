import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { analyzeQueueFailurePareto } from './pareto-failure-doctor.js';

test('groups every parked or failed row without changing the queue', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'failure-pareto-'));
  const file = path.join(directory, 'queue.sqlite');
  const db = new DatabaseSync(file);
  try {
    db.exec('CREATE TABLE applications(status TEXT, normalized_url TEXT, payload TEXT)');
    const add = db.prepare('INSERT INTO applications VALUES (?, ?, ?)');
    for (const reason of ['required answer missing', 'unmapped required field', 'email verification code timeout', 'CAPTCHA challenge', 'HTTP 422 validation', 'Workday login failed', 'posting closed', 'previous submit may have reached employer', 'unexpected network condition']) {
      add.run('paused_for_review', 'https://example.test/job?token=private', JSON.stringify({ error: reason }));
    }
    add.run('failed', 'https://example.test/other', '{bad');
    add.run('queued', 'https://example.test/queued', '{}');
    const report = analyzeQueueFailurePareto(file);
    assert.equal(report.totalFailedOrPaused, 10);
    assert.equal(report.buckets.reduce((sum, bucket) => sum + bucket.count, 0), 10);
    assert.equal(report.buckets[0]?.count, 2);
    for (const category of ['UNRESOLVED_CUSTOM_QUESTION', 'OTP_OR_EMAIL_VERIFICATION_TIMEOUT', 'CAPTCHA_OR_BOT_BLOCK', 'SERVER_400_422_VALIDATION', 'WORKDAY_AUTH_OR_LOCALE', 'CLOSED_OR_404_POSTING', 'AMBIGUOUS_DISPATCH', 'OTHER_TRANSIENT_ERROR']) assert(report.buckets.some(bucket => bucket.category === category), category);
    assert(report.buckets.flatMap(bucket => bucket.sampleUrls).every(url => !url.includes('?')));
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM applications').get() as { count: number }).count, 11);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
