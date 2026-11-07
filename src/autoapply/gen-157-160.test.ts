import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveBySemanticSelfLearning } from './self-learning.js';
import type { CandidateExtendedProfile } from './types.js';

const mockProfile: CandidateExtendedProfile = {
  personal: {
    firstName: 'Shivam',
    lastName: 'Mahajan',
    email: 'test@example.com',
    phone: '9000000000',
    city: 'Bengaluru',
    state: 'Karnataka',
    country: 'India',
  },
  professional: {
    expectedSalary: 1200000,
    noticePeriodDays: 0,
    totalYearsExperience: 1,
  },
  education: [
    {
      institution: 'Chitkara University',
      degree: 'Bachelor of Engineering',
      fieldOfStudy: 'Computer Science and Engineering',
      graduationYear: 2026,
      gpa: '9.35',
    },
  ],
  experience: [],
  skills: [],
};

test('GEN-157: pacedClick has 3500ms timeout and Escape + dispatchEvent fallback', () => {
  const runnerSrc = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  assert.ok(runnerSrc.includes('await control.click({ timeout: 3500 })'), 'Must have timeout on pacedClick');
  assert.ok(runnerSrc.includes("keyboard.press('Escape')"), 'Must press Escape on failure');
  assert.ok(runnerSrc.includes("dispatchEvent('click')"), 'Must fallback to dispatchEvent click');
});

test('GEN-158: post-submit receipt polling deadline is capped at 25s with watchdog heartbeat', () => {
  const runnerSrc = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  assert.ok(runnerSrc.includes('Math.min(timeout, 25_000)'), 'Must cap post-submit receipt polling deadline to 25s');
  assert.ok(runnerSrc.includes("watchdog.heartbeat('post_submit_poll')"), 'Must heartbeat in receipt loop');
});

test('GEN-159: attachNetworkReceiptListener handles 200-399 status and modern Greenhouse endpoints', () => {
  const runnerSrc = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  assert.ok(runnerSrc.includes('status < 200 || status >= 400'), 'Must permit 200-399 HTTP statuses including redirects');
  assert.ok(runnerSrc.includes('\\/jobs\\/\\d+(?:\\/applications)?'), 'Must match Greenhouse jobs with or without /applications');
});

test('GEN-160: self-learning resolves highest degree and official notice period in days correctly', () => {
  const degreeResult = resolveBySemanticSelfLearning(
    'What is your highest degree and field of study? Please include your university and graduation year.*',
    'TEXT',
    null,
    '',
    mockProfile
  );
  assert.ok(degreeResult, 'Must resolve highest degree question');
  assert.ok(degreeResult.value.includes('Chitkara University'), 'Must include Chitkara University');
  assert.ok(degreeResult.value.includes('2026'), 'Must include 2026');

  const noticeResult = resolveBySemanticSelfLearning(
    'Official Notice Period in Days*',
    'TEXT',
    null,
    '',
    mockProfile
  );
  assert.ok(noticeResult, 'Must resolve notice period in days');
  assert.equal(noticeResult.value, '0', 'Must return 0 for immediate notice period in days');
});
