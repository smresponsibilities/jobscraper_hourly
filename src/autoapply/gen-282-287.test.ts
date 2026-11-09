import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { selectDiversifiedMultiLaneChunk, countQueuedTier2Jobs, MARATHON_BOOT_MS } from '../../scripts/run-overnight-marathon.js';
import { isPostedWithinHours } from '../../scripts/harvest-100-hourly-jobs.js';
import { getProviderTimeoutConfig } from './watchdog-timer.js';
import { decodeQuotedPrintableMime } from './imap-verifier.js';
import { inferAnswerFromOptionSignature } from './self-learning.js';
import { WORKDAY_COMPLEXITY_FALLBACK_PASSWORD, ensureWorkdayCompliantPassword } from './authentication.js';
import type { AutoaplyJobItem } from './types.js';

test('GEN-282: isPostedWithinHours correctly flags postings updated/published within 72 hours', () => {
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const twentyHoursAgo = new Date(now.getTime() - 20 * 60 * 60 * 1000).toISOString();
  const eightyHoursAgo = new Date(now.getTime() - 80 * 60 * 60 * 1000).toISOString();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

  assert.equal(isPostedWithinHours(twoHoursAgo, 72), true, '2 hours ago must be < 72h');
  assert.equal(isPostedWithinHours(twentyHoursAgo, 72), true, '20 hours ago must be < 72h');
  assert.equal(isPostedWithinHours(eightyHoursAgo, 72), false, '80 hours ago must be >= 72h');
  assert.equal(isPostedWithinHours(twoWeeksAgo, 72), false, '2 weeks ago must be >= 72h');
  assert.equal(isPostedWithinHours(undefined, 72), false, 'Undefined date must return false');
});

test('GEN-283: selectDiversifiedMultiLaneChunk enforces breadth-first pacing (max 2/company) and 85/15 ratio', () => {
  const candidates: AutoaplyJobItem[] = [];

  // 10 roles at CompanyA (Ashby) - should only take 2!
  for (let i = 0; i < 10; i++) {
    candidates.push({
      id: `ashby_compA_${i}`,
      company: 'CompanyA',
      jobUrl: `https://jobs.ashbyhq.com/companya/uuid-${i}`,
      title: `Software Engineer (Fullstack) Track ${i}`,
      location: 'Bengaluru, India',
      is_hourly_fresh: 3,
    } as any);
  }

  // 25 distinct Fast-ATS companies (2 roles each = 50 candidate roles)
  for (let i = 0; i < 25; i++) {
    for (let r = 0; r < 2; r++) {
      candidates.push({
        id: `gh_${i}_${r}`,
        company: `GhComp_${i}`,
        jobUrl: `https://boards.greenhouse.io/gh_${i}/jobs/${1000 + i * 10 + r}`,
        title: `Software Engineer ${r === 0 ? 'Backend' : 'Frontend'}`,
        location: 'Bengaluru, India',
        is_hourly_fresh: 2,
      } as any);
    }
  }

  // 10 SmartRecruiters GCC roles
  for (let i = 0; i < 10; i++) {
    candidates.push({
      id: `sr_${i}`,
      company: `SrGCCComp_${i}`,
      jobUrl: `https://jobs.smartrecruiters.com/sr_${i}/${5000 + i}`,
      title: `Infrastructure Engineer ${i}`,
      location: 'Bengaluru, India',
      is_hourly_fresh: 2,
    } as any);
  }

  const chunk = selectDiversifiedMultiLaneChunk(candidates, 40);
  assert.equal(chunk.length, 40, 'Chunk must select exactly 40 jobs');

  // Breadth-first pacing: CompanyA must have AT MOST 2 jobs in this 40-job chunk
  const compAJobs = chunk.filter(j => j.company.toLowerCase() === 'companya');
  assert.ok(compAJobs.length <= 2, `CompanyA must have <= 2 jobs in chunk, got ${compAJobs.length}`);

  // 85% Fast-ATS (34 slots) and 15% GCC (6 slots)
  const gccInChunk = chunk.filter(
    j => j.jobUrl.toLowerCase().includes('smartrecruiters.com') || j.jobUrl.toLowerCase().includes('myworkdayjobs.com')
  );
  const fastInChunk = chunk.filter(
    j => j.jobUrl.toLowerCase().includes('greenhouse.io') || j.jobUrl.toLowerCase().includes('ashbyhq.com') || j.jobUrl.toLowerCase().includes('lever.co')
  );

  assert.equal(fastInChunk.length, 34, 'Fast-ATS must fill 34 slots (85%)');
  assert.equal(gccInChunk.length, 6, 'GCC must fill 6 slots (15%)');
});

test('GEN-283: 4-lane shared work-stealing queue, 150s OTP timeout and hot reload present in run-overnight-marathon.ts', () => {
  const marathonSrc = fs.readFileSync(path.resolve('scripts/run-overnight-marathon.ts'), 'utf8');

  // Shared work-stealing index
  assert.ok(
    marathonSrc.includes('sharedCursor') && marathonSrc.includes('sharedCursor++'),
    'run-overnight-marathon.ts must implement sharedCursor++ work-stealing across lanes'
  );

  // 4 lanes defined
  assert.ok(
    marathonSrc.includes('laneKeys = [\'lane-0\', \'lane-1\', \'lane-2\', \'lane-3\']') ||
    marathonSrc.includes("['lane-0', 'lane-1', 'lane-2', 'lane-3']"),
    'run-overnight-marathon.ts must define 4 shared work-stealing lanes lane-0..lane-3'
  );

  // 150s OTP-safe Fast-ATS timeout
  assert.ok(
    marathonSrc.includes('150_000') || marathonSrc.includes('150000'),
    'run-overnight-marathon.ts must enforce 150s timeout for Fast-ATS'
  );

  // Hot reload check
  assert.ok(
    marathonSrc.includes('MARATHON_BOOT_MS') && marathonSrc.includes('mtimeMs > MARATHON_BOOT_MS'),
    'run-overnight-marathon.ts must implement MARATHON_BOOT_MS hot-reload check'
  );
  assert.ok(typeof MARATHON_BOOT_MS === 'number', 'MARATHON_BOOT_MS must be exported as number');
});

test('GEN-284: Watchdog timeout configs provide 150s for Fast-ATS and 180s for Workday/SmartRecruiters', () => {
  const ghConfig = getProviderTimeoutConfig('https://boards.greenhouse.io/rubrik/jobs/123');
  assert.equal(ghConfig.maxTotalMs, 150_000, 'Greenhouse max timeout must be 150_000ms');

  const ashbyConfig = getProviderTimeoutConfig('https://jobs.ashbyhq.com/supabase/abc-123');
  assert.equal(ashbyConfig.maxTotalMs, 150_000, 'Ashby max timeout must be 150_000ms');

  const leverConfig = getProviderTimeoutConfig('https://jobs.lever.co/hevodata/def-456');
  assert.equal(leverConfig.maxTotalMs, 150_000, 'Lever max timeout must be 150_000ms');

  const wdConfig = getProviderTimeoutConfig('https://citi.wd5.myworkdayjobs.com/careers/job/123');
  assert.equal(wdConfig.maxTotalMs, 180_000, 'Workday max timeout must be 180_000ms');

  const srConfig = getProviderTimeoutConfig('https://jobs.smartrecruiters.com/company/456');
  assert.equal(srConfig.maxTotalMs, 180_000, 'SmartRecruiters max timeout must be 180_000ms');
});

test('GEN-284: decodeQuotedPrintableMime decodes soft breaks, hex codes, and UTF-8 characters', () => {
  const rawQp = 'Your verification code is: =3D<b>849201</b>=\r\n. Please use within 10 minutes=2E';
  const decoded = decodeQuotedPrintableMime(rawQp);
  assert.ok(decoded.includes('Your verification code is: =<b>849201</b>. Please use within 10 minutes.'));

  const utf8Qp = 'Welcome=E2=80=94to our team!';
  const decodedUtf8 = decodeQuotedPrintableMime(utf8Qp);
  assert.equal(decodedUtf8, 'Welcome—to our team!');
});

test('GEN-284: inferAnswerFromOptionSignature resolves Mobile, Fluent, Full-time, Hybrid, and L', () => {
  // Mobile phone device
  const phoneRes = inferAnswerFromOptionSignature('Phone Type', ['Work', 'Mobile', 'Home']);
  assert.equal(phoneRes?.category, 'phone_device_type');
  assert.equal(phoneRes?.value, 'Mobile');

  // Fluent language proficiency
  const langRes = inferAnswerFromOptionSignature('English Proficiency', ['Basic', 'Conversational', 'Fluent', 'Native']);
  assert.equal(langRes?.category, 'language_proficiency');
  assert.equal(langRes?.value, 'Fluent');

  // Full-time employment schedule
  const empRes = inferAnswerFromOptionSignature('Employment Preference', ['Contract', 'Part-time', 'Full-time']);
  assert.equal(empRes?.category, 'employment_type');
  assert.equal(empRes?.value, 'Full-time');

  // Hybrid workplace model
  const workRes = inferAnswerFromOptionSignature('Work Arrangement', ['On-site', 'Hybrid', 'Remote']);
  assert.equal(workRes?.category, 'workplace_model');
  assert.equal(workRes?.value, 'Hybrid');

  // L clothing size
  const sizeRes = inferAnswerFromOptionSignature('T-shirt Size', ['S', 'M', 'L', 'XL', 'XXL']);
  assert.equal(sizeRes?.category, 'tshirt_size');
  assert.equal(sizeRes?.value, 'L');
});

test('GEN-284: Workday 16-char fallback password satisfies Workday complexity and is exported', () => {
  assert.equal(WORKDAY_COMPLEXITY_FALLBACK_PASSWORD, 'Wk9#mP4$vL7@nQ2!');
  assert.equal(WORKDAY_COMPLEXITY_FALLBACK_PASSWORD.length, 16);
  assert.ok(/[A-Z]/.test(WORKDAY_COMPLEXITY_FALLBACK_PASSWORD), 'Must contain uppercase');
  assert.ok(/[a-z]/.test(WORKDAY_COMPLEXITY_FALLBACK_PASSWORD), 'Must contain lowercase');
  assert.ok(/[0-9]/.test(WORKDAY_COMPLEXITY_FALLBACK_PASSWORD), 'Must contain digit');
  assert.ok(/[!@#$%^&*]/.test(WORKDAY_COMPLEXITY_FALLBACK_PASSWORD), 'Must contain special char');
  assert.equal(ensureWorkdayCompliantPassword(''), WORKDAY_COMPLEXITY_FALLBACK_PASSWORD);
});
