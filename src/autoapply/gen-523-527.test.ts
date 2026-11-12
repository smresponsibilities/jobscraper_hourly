import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { selectDiversifiedMultiLaneChunk } from '../../scripts/run-overnight-marathon.js';
import { extractOtpOrLinkFromMime } from './imap-verifier.js';
import type { AutoaplyJobItem } from './types.js';

test('GEN-523: harvest-cursor rotates across calls', () => {
  const cursorFile = path.resolve('state/autoapply/portal-review/harvest-cursor.json');
  fs.mkdirSync(path.dirname(cursorFile), { recursive: true });
  fs.writeFileSync(cursorFile, JSON.stringify({ nextOffset: 800 }), 'utf8');

  const content = JSON.parse(fs.readFileSync(cursorFile, 'utf8'));
  assert.equal(content.nextOffset, 800);
});

test('GEN-524: selectDiversifiedMultiLaneChunk caps Workday at max 2 and SmartRecruiters at max 2', () => {
  const dummyJobs: AutoaplyJobItem[] = [
    // 5 Fast-ATS Greenhouse
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `gh_${i}`,
      company: `GHCompany_${i}`,
      title: 'Software Engineer',
      jobUrl: `https://boards.greenhouse.io/gh_${i}/jobs/100${i}`,
      jobBoard: 'direct_ats' as const,
      status: 'queued' as const,
      location: 'Bengaluru, India',
    })),
    // 5 Fast-ATS Ashby
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `ashby_${i}`,
      company: `AshbyCompany_${i}`,
      title: 'Backend Engineer',
      jobUrl: `https://jobs.ashbyhq.com/ashby_${i}/job_${i}`,
      jobBoard: 'direct_ats' as const,
      status: 'queued' as const,
      location: 'Bengaluru, India',
    })),
    // 6 Workday
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `wd_${i}`,
      company: `WDCompany_${i}`,
      title: 'Data Engineer',
      jobUrl: `https://wd${i}.myworkdayjobs.com/en-US/careers/job/job_${i}`,
      jobBoard: 'direct_ats' as const,
      status: 'queued' as const,
      location: 'Bengaluru, India',
    })),
    // 4 SmartRecruiters
    ...Array.from({ length: 4 }, (_, i) => ({
      id: `sr_${i}`,
      company: `SRCompany_${i}`,
      title: 'Fullstack Engineer',
      jobUrl: `https://jobs.smartrecruiters.com/sr_${i}/job_${i}`,
      jobBoard: 'direct_ats' as const,
      status: 'queued' as const,
      location: 'Bengaluru, India',
    })),
  ];

  const chunk = selectDiversifiedMultiLaneChunk(dummyJobs, 20, () => true);

  const workdayInChunk = chunk.filter(j => /myworkdayjobs\.com/i.test(j.jobUrl));
  const srInChunk = chunk.filter(j => /smartrecruiters\.com/i.test(j.jobUrl));
  const fastAtsInChunk = chunk.filter(j => /greenhouse\.io|ashbyhq\.com/i.test(j.jobUrl));

  assert.ok(workdayInChunk.length <= 2, `Workday count ${workdayInChunk.length} must be <= 2`);
  assert.ok(srInChunk.length <= 2, `SmartRecruiters count ${srInChunk.length} must be <= 2`);
  assert.ok(fastAtsInChunk.length >= 10, `Fast-ATS count ${fastAtsInChunk.length} must be >= 10`);
});

test('GEN-525: extractOtpOrLinkFromMime extracts hashed Workday link in activation email', () => {
  const mimeWithoutVerifyWord = `
    Subject: Welcome to Your Company Account
    To: applicant@example.com
    Content-Type: text/html

    <p>Please activate your account by clicking the link below:</p>
    <a href="https://ac.wd1.myworkdayjobs.com/user/setup/abc123xyz789">Set Password</a>
  `;
  const res = extractOtpOrLinkFromMime(mimeWithoutVerifyWord);
  assert.ok(res.verificationUrl, 'Should extract Workday setup URL');
  assert.match(res.verificationUrl!, /myworkdayjobs\.com/);
});

test('GEN-526: Multi-cycle infinite loop transitions cleanly Cycle #1 -> Cycle #2 without error', () => {
  // Setup isolated temporary state directory with queue.sqlite and candidate.json
  const tempDir = path.resolve('out/test-temp/gen-526-test');
  fs.mkdirSync(tempDir, { recursive: true });

  const tempDb = path.join(tempDir, 'queue.sqlite');
  if (fs.existsSync(tempDb)) fs.unlinkSync(tempDb);

  const tempCand = path.join(tempDir, 'candidate.json');
  fs.copyFileSync(path.resolve('state/autoapply/portal-review/candidate.json'), tempCand);
  const realResume = path.resolve('state/autoapply/portal-review/resume-current.pdf');
  if (fs.existsSync(realResume)) {
    fs.copyFileSync(realResume, path.join(tempDir, 'resume-current.pdf'));
  } else {
    fs.writeFileSync(path.join(tempDir, 'resume-current.pdf'), '%PDF-1.4 dummy', 'utf8');
  }

  // Run drain-backfill-and-hourly with --max-cycles 2 --skip-sync --dry-run
  const result = spawnSync(process.execPath, [
    '--import', './scripts/test-temp.mjs',
    '--import', 'tsx',
    'scripts/drain-backfill-and-hourly.ts',
    '--state', tempDir,
    '--profile', tempCand,
    '--max-cycles', '2',
    '--skip-sync',
    '--dry-run',
  ], {
    encoding: 'utf8',
    timeout: 45000,
    cwd: path.resolve('.'),
  });

  const output = (result.stdout || '') + (result.stderr || '');
  assert.ok(output.includes('STARTING CYCLE #1'), `Must execute Cycle #1. Output: ${output}`);
  assert.ok(output.includes('STARTING CYCLE #2'), `Must transition to Cycle #2. Output: ${output}`);
  assert.ok(!output.includes('database is not open'), `Must not throw "database is not open". Output: ${output}`);
  assert.equal(result.status, 0, `Process must exit cleanly with code 0. Status: ${result.status}`);
});
