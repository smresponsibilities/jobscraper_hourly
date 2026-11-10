import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import {
  NON_TECH_TITLE_REGEX,
  WHITELIST_SOFTWARE_TITLE_REGEX,
  evaluateCandidateJobFit,
} from './candidate-fit-filter.js';
import { scrubNonTechJobs } from '../../scripts/scrub-non-tech-jobs.js';

test('GEN-431: NON_TECH_TITLE_REGEX catches non-tech, operational, sales, and senior management roles', () => {
  const rejectedTitles = [
    'Director of Human Resources',
    'Business Development Representative',
    'Legal Counsel',
    'Engineering Operations Manager',
    'Customer Support Specialist',
    'Corporate Accountant',
    'Head of Talent Acquisition',
    'Clinical Nurse Specialist',
    'Procurement Specialist',
    'Social Media Manager',
    'HVAC Tech',
    'Quality Inspector',
    'Civil Drafter',
    'Structural Drafter',
    'Hardware Technician',
    'Safety Officer',
    'Site Supervisor',
    'Tax Auditor',
  ];

  for (const title of rejectedTitles) {
    assert.ok(
      NON_TECH_TITLE_REGEX.test(title),
      `Expected "${title}" to match NON_TECH_TITLE_REGEX`
    );
  }
});

test('GEN-431: WHITELIST_SOFTWARE_TITLE_REGEX whitelists authentic core SWE/Data/ML roles', () => {
  const whitelistedTitles = [
    'Software Engineer',
    'Backend Engineer',
    'Frontend Developer',
    'Full Stack Engineer',
    'Data Engineer',
    'Data Platform Engineer',
    'Machine Learning Engineer',
    'ML Engineer',
    'AI Engineer',
    'Cloud Engineer',
    'DevOps Engineer',
    'Platform Engineer',
    'SRE',
  ];

  for (const title of whitelistedTitles) {
    assert.ok(
      WHITELIST_SOFTWARE_TITLE_REGEX.test(title),
      `Expected "${title}" to match WHITELIST_SOFTWARE_TITLE_REGEX`
    );
  }
});

test('GEN-431: evaluateCandidateJobFit enforces zero-leak gating with whitelist override', () => {
  // Pure non-tech role -> rejected
  const resNonTech = evaluateCandidateJobFit({
    title: 'Business Development Manager',
    company: 'TechCorp',
    location: 'Bengaluru, India',
  });
  assert.equal(resNonTech.allowed, false, 'Business development must be rejected');

  // Whitelisted tech role with overlapping non-tech token -> allowed
  const resWhitelisted = evaluateCandidateJobFit({
    title: 'Software Engineer - Sales Platform',
    company: 'TechCorp',
    location: 'Bengaluru, India',
  });
  assert.equal(resWhitelisted.allowed, true, 'Software Engineer role must be whitelisted');
});

test('GEN-431: scrubNonTechJobs purges non-tech queued rows from SQLite database', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen431-db-'));
  const testDbPath = path.join(tmpDir, 'queue.sqlite');

  try {
    const db = new DatabaseSync(testDbPath);
    db.exec(`
      CREATE TABLE applications (
        candidate_id TEXT NOT NULL,
        id TEXT NOT NULL PRIMARY KEY,
        canonical_key TEXT,
        normalized_url TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        owner TEXT,
        expires INTEGER
      );
    `);

    const appNonTech = { id: 'app-1', title: 'HR Operations Lead', company: 'CorpA' };
    const appTech = { id: 'app-2', title: 'Fullstack Engineer', company: 'CorpB' };
    const appSales = { id: 'app-3', title: 'Senior Sales Representative', company: 'CorpC' };

    const insert = db.prepare('INSERT INTO applications VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    insert.run('cand', 'app-1', null, 'http://example.com/1', 'queued', JSON.stringify(appNonTech), null, null);
    insert.run('cand', 'app-2', null, 'http://example.com/2', 'queued', JSON.stringify(appTech), null, null);
    insert.run('cand', 'app-3', null, 'http://example.com/3', 'paused_for_review', JSON.stringify(appSales), null, null);
    db.close();

    const { scrubbedApplications } = scrubNonTechJobs(testDbPath);
    assert.equal(scrubbedApplications, 2, 'Should have scrubbed exactly 2 non-tech applications');

    const verifyDb = new DatabaseSync(testDbPath);
    const rows = verifyDb.prepare('SELECT id, status, payload FROM applications').all() as Array<any>;
    verifyDb.close();

    const statusMap = new Map(rows.map(r => [r.id, r.status]));
    assert.equal(statusMap.get('app-1'), 'skipped', 'HR Lead must be set to skipped');
    assert.equal(statusMap.get('app-2'), 'queued', 'Fullstack Engineer must remain queued');
    assert.equal(statusMap.get('app-3'), 'skipped', 'Sales Rep must be set to skipped');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
