import test from 'node:test';
import assert from 'node:assert/strict';
import { inferAtsProviderFromUrl, reclassifyQueuedJobs } from '../../scripts/reclassify-unknown-queued-jobs.js';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

test('GEN-529: inferAtsProviderFromUrl correctly identifies ATS providers from URLs', () => {
  assert.equal(inferAtsProviderFromUrl('https://boards.greenhouse.io/embed/job_app?token=8605361002'), 'greenhouse');
  assert.equal(inferAtsProviderFromUrl('https://jobs.ashbyhq.com/company/abc-123/application'), 'ashby');
  assert.equal(inferAtsProviderFromUrl('https://jobs.lever.co/company/xyz-789'), 'lever');
  assert.equal(inferAtsProviderFromUrl('https://philips.wd3.myworkdayjobs.com/jobs/job/Bangalore/Dev_123'), 'workday');
  assert.equal(inferAtsProviderFromUrl('https://jobs.smartrecruiters.com/company/744000143236689'), 'smartrecruiters');
  assert.equal(inferAtsProviderFromUrl('https://apply.workable.com/company/j/ABC12345/'), 'workable');
  assert.equal(inferAtsProviderFromUrl('https://inallmedia-llc.breezy.hr/p/123-dev'), 'breezy');
  assert.equal(inferAtsProviderFromUrl('https://random.recruitee.com/o/swe'), 'recruitee');
  assert.equal(inferAtsProviderFromUrl('https://unknown-portal.com/career'), null);
});

test('GEN-529: reclassifyQueuedJobs updates payload.provider and eliminates unknown queued rows', () => {
  const tmpDir = path.resolve('out/test-temp/gen-529-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpDb = path.join(tmpDir, 'queue.sqlite');

  const db = new DatabaseSync(tmpDb);
  db.exec(`
    CREATE TABLE applications (
      candidate_id TEXT NOT NULL,
      id TEXT NOT NULL PRIMARY KEY,
      canonical_key TEXT,
      normalized_url TEXT NOT NULL,
      status TEXT NOT NULL,
      payload TEXT NOT NULL,
      owner TEXT,
      expires INTEGER,
      last_error TEXT
    );
  `);

  const insert = db.prepare(`
    INSERT INTO applications (candidate_id, id, canonical_key, normalized_url, status, payload)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  // Row 1: Workday with unknown provider
  insert.run(
    'c1', 'j1', 'k1',
    'https://abinbev.wd1.myworkdayjobs.com/en-US/IND/job/Bangalore/Data-Scientist_30105223',
    'queued',
    JSON.stringify({ title: 'Data Scientist', location: 'Bengaluru, India', company: 'Abinbev', provider: 'unknown' })
  );

  // Row 2: Ashby with missing provider
  insert.run(
    'c1', 'j2', 'k2',
    'https://jobs.ashbyhq.com/testcorp/abc-123/application',
    'queued',
    JSON.stringify({ title: 'Software Engineer', location: 'India (Remote)', company: 'TestCorp' })
  );

  // Row 3: Unsupported URL -> should be skipped
  insert.run(
    'c1', 'j3', 'k3',
    'https://ebxr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/100',
    'queued',
    JSON.stringify({ title: 'Software Engineer', location: 'Bengaluru, India', company: 'OracleSite' })
  );

  db.close();

  const report = reclassifyQueuedJobs(tmpDb);
  assert.equal(report.remainingUnknown, 0);
  assert.equal(report.skippedUnsupported, 1);
  assert.equal(report.reclassified, 2);

  const dbCheck = new DatabaseSync(tmpDb);
  const rows = dbCheck.prepare(`SELECT id, status, payload FROM applications`).all() as any[];
  dbCheck.close();

  const j1 = rows.find(r => r.id === 'j1');
  const j2 = rows.find(r => r.id === 'j2');
  const j3 = rows.find(r => r.id === 'j3');

  assert.equal(j1.status, 'queued');
  assert.equal(JSON.parse(j1.payload).provider, 'workday');

  assert.equal(j2.status, 'queued');
  assert.equal(JSON.parse(j2.payload).provider, 'ashby');

  assert.equal(j3.status, 'skipped');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
