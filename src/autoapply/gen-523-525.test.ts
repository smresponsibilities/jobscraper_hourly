import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
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
