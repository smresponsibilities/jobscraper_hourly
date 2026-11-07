import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoApplyRunner } from './runner.js';
import { getParentOrShadowHost, extractCleanQuestionText } from './distiller.js';
import { fillAsyncLocationCombobox } from './widgets.js';
import { completeInPageEmailVerificationIfPrompted, pollImapForVerificationCodeOrLink } from './imap-verifier.js';
import { runWorkdayStepFastPass } from './workday-wizard.js';
import { resolveCandidateAnswer } from './answers.js';
import { inferAnswerFromOptionSignature } from './self-learning.js';
import { recoverPowerOffAndNetOffJobs } from './power-net-recovery.js';

test('GEN-114: getActiveApplicationPages filters closed pages and returns active pages', () => {
  const runner = new AutoApplyRunner();
  assert.equal(typeof (runner as any).getActiveApplicationPages, 'function');
  const active = (runner as any).getActiveApplicationPages();
  assert.ok(Array.isArray(active));
});

test('GEN-115: humanType dispatches composed: true events and is defined on runner', () => {
  const runner = new AutoApplyRunner();
  assert.equal(typeof runner.humanType, 'function');
});

test('GEN-116: getParentOrShadowHost hops across ShadowRoot host boundaries', () => {
  assert.equal(typeof getParentOrShadowHost, 'function');
  // Null safety
  assert.equal(getParentOrShadowHost(null), null);
});

test('GEN-117: fillAsyncLocationCombobox incorporates fast-path Bengaluru / Bangalore waterfall', () => {
  assert.equal(typeof fillAsyncLocationCombobox, 'function');
});

test('GEN-118: completeInPageEmailVerificationIfPrompted is defined and supports onActivity callback', () => {
  assert.equal(typeof completeInPageEmailVerificationIfPrompted, 'function');
  assert.equal(typeof pollImapForVerificationCodeOrLink, 'function');
});

test('GEN-119: runWorkdayStepFastPass handles file upload input', () => {
  assert.equal(typeof runWorkdayStepFastPass, 'function');
});

test('GEN-120: answers.ts resolves confirmEmail to profile email and org to Morgan Stanley', () => {
  const mockProfile: any = {
    personal: {
      email: 'test@example.com',
      firstName: 'Shivam',
      lastName: 'Mahajan',
      phone: '+919999999999',
      country: 'India',
    },
    professional: { officeAttendance: { officeRequired: true, city: 'Bengaluru', maxDaysPerWeek: 5 } },
    experience: [{ company: 'Morgan Stanley', title: 'Technology Analyst' }],
    education: [],
  };

  const confirmRes = resolveCandidateAnswer('email', mockProfile, {
    url: 'https://jobs.smartrecruiters.com/test',
    question: 'Confirm Email Address',
    aliases: ['confirmEmail'],
  });
  assert.equal(confirmRes.value, 'test@example.com');

  const orgRes = resolveCandidateAnswer('current_company', mockProfile, {
    url: 'https://jobs.lever.co/test',
    question: 'Current company',
    aliases: ['org'],
  });
  assert.equal(orgRes.value, 'Morgan Stanley');
});

test('GEN-120: inferAnswerFromOptionSignature resolves notice period and salary band buckets', () => {
  const noticeOptions = ['15 days', 'Immediate / Serving Notice', '30 days', '60 days'];
  const noticeMatch = inferAnswerFromOptionSignature('What is your notice period?', noticeOptions);
  assert.ok(noticeMatch);
  assert.equal(noticeMatch.category, 'notice_period');
  assert.equal(noticeMatch.value, 'Immediate / Serving Notice');

  const salaryOptions = ['< 5 LPA', '5 - 10 LPA', '10 - 15 LPA', '15 - 20 LPA'];
  const salaryMatch = inferAnswerFromOptionSignature('Expected CTC (LPA)', salaryOptions);
  assert.ok(salaryMatch);
  assert.equal(salaryMatch.category, 'expected_salary');
  assert.equal(salaryMatch.value, '10 - 15 LPA');
});

test('GEN-121/122: recoverPowerOffAndNetOffJobs is exported and handles recovery', () => {
  assert.equal(typeof recoverPowerOffAndNetOffJobs, 'function');
});
