import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { recoverStaleInProgressJobs } from './stale-recovery.js';

test('stale recovery requeues only guarded pre-dispatch work and stops crash loops', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'stale-recovery-'));
  const file = path.join(dir, 'queue.sqlite'), db = new DatabaseSync(file);
  const originalKill = process.kill;
  try {
    db.exec('CREATE TABLE applications(candidate_id TEXT,id TEXT,canonical_key TEXT,normalized_url TEXT,payload TEXT,status TEXT,owner TEXT,expires INTEGER); CREATE TABLE workers(owner TEXT,pid INTEGER,expires INTEGER); CREATE TABLE application_events(candidate_id TEXT,job_id TEXT,timestamp TEXT,phase TEXT,reason_code TEXT,step_index INTEGER);');
    db.prepare('INSERT INTO workers VALUES(?,?,?)').run('dead-owner', 999999, 0);
    db.prepare('INSERT INTO workers VALUES(?,?,?)').run('live-owner', process.pid, 0);
    process.kill = ((pid: number, signal: string | number) => { if (pid === 999999) throw Object.assign(new Error('gone'), { code: 'ESRCH' }); return originalKill(pid, signal as never); }) as typeof process.kill;
    const now = Date.now(), url = 'https://jobs.ashbyhq.com/fixture/1';
    const insert = db.prepare('INSERT INTO applications VALUES(?,?,?,?,?,?,?,?)');
    const payload = JSON.stringify({ jobUrl: url, company: 'Fixture' });
    insert.run('candidate', 'safe', null, url, payload, 'applying', 'dead-owner', now - 20 * 60_000);
    insert.run('candidate', 'live', null, url, payload, 'applying', 'live-owner', now - 20 * 60_000);
    insert.run('candidate', 'ambiguous', null, url, payload, 'applying', 'dead-owner', now - 20 * 60_000);
    db.prepare('INSERT INTO application_events VALUES(?,?,?,?,?,?)').run('candidate', 'ambiguous', '2026-01-01T00:00:00Z', 'submit_clicked', null, null);
    const session = createHash('sha256').update(url).digest('hex').slice(0, 20);
    const directory = path.join(dir, 'applications', session); mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'checkpoint.json'), JSON.stringify({ applicationUrl: url, report: { recoveryGuardVersion: 1, submissionAttempted: false, credentialAttempts: [] } }));
    assert.deepEqual(recoverStaleInProgressJobs(file, 15, 2, now), { recoveredIds: ['safe'], quarantinedCrashLoopIds: [] });
    const status = (id: string) => (db.prepare('SELECT status FROM applications WHERE id=?').get(id) as { status: string }).status;
    assert.equal(status('ambiguous'), 'applying'); assert.equal(status('live'), 'applying');
    for (let retry = 2; retry <= 3; retry++) {
      db.prepare("UPDATE applications SET status='applying', owner='dead-owner', expires=? WHERE id='safe'").run(now - 20 * 60_000);
      const result = recoverStaleInProgressJobs(file, 15, 2, now);
      assert.deepEqual(retry === 2 ? result.recoveredIds : result.quarantinedCrashLoopIds, ['safe']);
    }
    assert.equal(status('safe'), 'failed');
  } finally { process.kill = originalKill; db.close(); rmSync(dir, { recursive: true, force: true }); }
});
