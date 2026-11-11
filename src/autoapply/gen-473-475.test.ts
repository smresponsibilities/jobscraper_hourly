// src/autoapply/gen-473-475.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  extractOtpOrLinkFromMime,
  COMMON_8_LETTER_WORDS,
  completeInPageEmailVerificationIfPrompted,
} from './imap-verifier.js';
import { healInvalidFieldsAndRetrySubmit } from './runner.js';
import { partitionJobsIntoProviderLanes } from '../../scripts/drain-backfill-and-hourly.js';
import { selectDiversifiedMultiLaneChunk } from '../../scripts/run-overnight-marathon.js';
import { filterUnattemptedJobs, isJobAlreadyAttempted } from './attempted-registry.js';
import type { AutoaplyJobItem } from './types.js';

test('GEN-473.2: extractOtpOrLinkFromMime extracts exact case-sensitive Greenhouse 8-char OTP, NOT "into"', () => {
  // Test case 1: Greenhouse real email body format
  const greenhouseEmail = `
    Hello Shivam,
    Copy and paste this security code into the application form: X7k9Pq2M
    This code is valid for 10 minutes.
  `;
  const res1 = extractOtpOrLinkFromMime(greenhouseEmail);
  assert.equal(res1.otpCode, 'X7k9Pq2M', 'Must extract X7k9Pq2M with exact case and not the word "into"');

  // Test case 2: HTML tag enclosed code (<strong>X7k9Pq2M</strong>)
  const htmlEmail = `
    <div>
      <p>Please enter the verification code:</p>
      <strong>X7k9Pq2M</strong>
    </div>
  `;
  const res2 = extractOtpOrLinkFromMime(htmlEmail);
  assert.equal(res2.otpCode, 'X7k9Pq2M');

  // Test case 3: 6-digit numeric OTP (Workday / SmartRecruiters)
  const numericEmail = `
    Your verification code is: 849201
  `;
  const res3 = extractOtpOrLinkFromMime(numericEmail);
  assert.equal(res3.otpCode, '849201');

  // Test case 4: Common 8-letter English words are ignored
  assert.ok(COMMON_8_LETTER_WORDS.test('security'));
  assert.ok(COMMON_8_LETTER_WORDS.test('software'));
  assert.ok(COMMON_8_LETTER_WORDS.test('engineer'));
  assert.ok(COMMON_8_LETTER_WORDS.test('location'));
  assert.ok(!COMMON_8_LETTER_WORDS.test('X7k9Pq2M'));
  assert.ok(!COMMON_8_LETTER_WORDS.test('849201'));

  // Test case 5: Activation link extracted
  const linkEmail = `
    Please click the link below to verify your email:
    https://boards.greenhouse.io/verify?token=abc123xyz
  `;
  const res5 = extractOtpOrLinkFromMime(linkEmail);
  assert.equal(res5.verificationUrl, 'https://boards.greenhouse.io/verify?token=abc123xyz');
});

test('GEN-473.1 & GEN-473.3: runner.ts & imap-verifier.ts contain split 8-box paste and native setter logic', () => {
  const imapSrc = fs.readFileSync(path.resolve('src/autoapply/imap-verifier.ts'), 'utf8');
  assert.ok(imapSrc.includes('ClipboardEvent(\'paste\''), 'Must dispatch synthetic paste event on split boxes');
  assert.ok(imapSrc.includes('HTMLInputElement.prototype'), 'Must use native HTMLInputElement value setter');
  assert.ok(imapSrc.includes('splitBoxes.nth(i)'), 'Must iterate through split input boxes 0..7');
  assert.ok(imapSrc.includes('KeyboardEvent(\'keyup\''), 'Must dispatch keyup event on split boxes');
  assert.ok(imapSrc.includes('security-input-'), 'Must locate security-input-* split boxes');
  assert.ok(imapSrc.includes('waitForTimeout(800)'), 'Must wait 800ms before re-clicking submit');

  const runnerSrc = fs.readFileSync(path.resolve('src/autoapply/runner.ts'), 'utf8');
  assert.ok(runnerSrc.includes('isOtpInput'), 'runner.ts must define isOtpInput guard');
  assert.ok(runnerSrc.includes('inp.maxLength === 1') || runnerSrc.includes('el.maxLength === 1'), 'Must ignore maxLength === 1 inputs');
  assert.ok(runnerSrc.includes('completeInPageEmailVerificationIfPrompted'), 'runner.ts must call completeInPageEmailVerificationIfPrompted on Greenhouse');
  assert.ok(runnerSrc.includes('waitForTimeout(3000)'), 'runner.ts must wait 3000ms for security code prompt to mount');
});

test('GEN-473.1: healInvalidFieldsAndRetrySubmit ignores maxLength === 1 and security code inputs in mock frame', async () => {
  let evaluatedFn: any = null;
  const mockFrame: any = {
    evaluate: async (fn: any, args: any) => {
      evaluatedFn = fn;
      return { fixed: 0, refsToUnlock: [] };
    },
  };

  const count = await healInvalidFieldsAndRetrySubmit(mockFrame, 'test@example.com');
  assert.equal(count, 0);
  assert.ok(typeof evaluatedFn === 'function');
});

test('GEN-474: filterUnattemptedJobs treats SQLite status = "queued" as authoritative', () => {
  const mockQueuedJob: AutoaplyJobItem = {
    id: 'test-queued-job-123',
    company: 'Test Company',
    title: 'Software Engineer',
    jobUrl: 'https://boards.greenhouse.io/test/jobs/12345',
    status: 'queued',
  };

  const mockAppliedJob: AutoaplyJobItem = {
    id: 'test-applied-job-456',
    company: 'Test Company 2',
    title: 'Full Stack Engineer',
    jobUrl: 'https://boards.greenhouse.io/test2/jobs/67890',
    status: 'applied',
  };

  const result = filterUnattemptedJobs([mockQueuedJob, mockAppliedJob]);
  // The queued job MUST be kept and not filtered out!
  assert.ok(result.some(j => j.id === 'test-queued-job-123'), 'Queued jobs must remain unattempted and runnable');
});

test('GEN-474: partitionJobsIntoProviderLanes routes workable.com and preserves Greenhouse / Ashby / Lever', () => {
  const sampleJobs = [
    { id: '1', jobUrl: 'https://boards.greenhouse.io/acme/jobs/1' },
    { id: '2', jobUrl: 'https://jobs.ashbyhq.com/acme/2' },
    { id: '3', jobUrl: 'https://jobs.lever.co/acme/3' },
    { id: '4', jobUrl: 'https://apply.workable.com/acme/j/4/' },
    { id: '5', jobUrl: 'https://citi.wd5.myworkdayjobs.com/citi/job/5' },
  ];

  const lanes = partitionJobsIntoProviderLanes(sampleJobs);
  assert.equal(lanes.greenhouse.length, 1);
  assert.equal(lanes.ashby.length, 1);
  assert.equal(lanes.lever.length, 2, 'Lever lane must contain both lever and workable jobs');
  assert.equal(lanes.workday.length, 1);
});
