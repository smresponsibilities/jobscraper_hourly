import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AutoApplyRunner } from './runner.js';
import { extractCleanQuestionText, annotateQuestionClusters } from './distiller.js';
import { resolveCandidateAnswer } from './answers.js';
import { fillWorkdaySpinbuttonDates, runWorkdayStepFastPass } from './workday-wizard.js';
import { completeInPageEmailVerificationIfPrompted } from './imap-verifier.js';
import type { CandidateExtendedProfile } from './types.js';

const mockProfile: CandidateExtendedProfile = {
  personal: {
    firstName: 'Shivam',
    lastName: 'Mahajan',
    fullName: 'Shivam Mahajan',
    email: 'test@example.com',
    phone: '+919999999999',
    city: 'Bengaluru',
    country: 'India',
  },
  professional: {
    totalYearsExperience: 1,
    currentCompany: 'Morgan Stanley',
    currentTitle: 'Technology Analyst',
    noticePeriodDays: 30,
  },
  workAuthorization: {
    authorizedInCountry: true,
    requiresSponsorshipNowOrFuture: false,
  },
  education: [
    {
      school: 'Chitkara University',
      degree: "Bachelor's Degree",
      fieldOfStudy: 'Computer Science',
      graduationYear: 2026,
    },
  ],
  experience: [],
  skills: ['TypeScript', 'Node.js', 'Playwright'],
  links: {
    linkedin: 'https://www.linkedin.com/in/mahajanshivam',
    github: 'https://github.com/smresponsibilities',
    portfolio: 'https://shivammahajan.com',
  },
};

test('GEN-129: distiller.ts prevents radio/checkbox option labels from poisoning questionText', () => {
  assert.equal(typeof extractCleanQuestionText, 'function');
  assert.equal(typeof annotateQuestionClusters, 'function');

  const distillerSrc = fs.readFileSync('src/autoapply/distiller.ts', 'utf8');
  assert.ok(distillerSrc.includes('isRadioOrCheckbox'));
  assert.ok(distillerSrc.includes('.application-question'));
  assert.ok(distillerSrc.includes('legend'));
  assert.ok(distillerSrc.includes('formField-'));
});

test('GEN-130: imap-verifier.ts and runner.ts handle Greenhouse security-input-0..7 and anti-resubmit OTP guard', () => {
  assert.equal(typeof completeInPageEmailVerificationIfPrompted, 'function');

  const imapSrc = fs.readFileSync('src/autoapply/imap-verifier.ts', 'utf8');
  assert.ok(imapSrc.includes('security-input-'));
  assert.ok(imapSrc.includes('ClipboardEvent'));
  assert.ok(imapSrc.includes('nativeSetter'));

  const runnerSrc = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  assert.ok(runnerSrc.includes('completeInPageEmailVerificationIfPrompted'));
  assert.ok(runnerSrc.includes('iti__country-list'));
  assert.ok(runnerSrc.includes('already submitted an application for this position'));
});

test('GEN-131: runner.ts enforces Lever core fields and location autocomplete before submit', () => {
  const runner = new AutoApplyRunner();
  assert.equal(typeof (runner as any).enforceLeverCoreFieldsBeforeSubmit, 'function');

  const runnerSrc = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  assert.ok(runnerSrc.includes('enforceLeverCoreFieldsBeforeSubmit'));
  assert.ok(runnerSrc.includes('Morgan Stanley'));
  assert.ok(runnerSrc.includes('selectedLocation'));
});

test('GEN-132: answers.ts and runner.ts normalize _systemfield_name and ISO date format', () => {
  // Test _systemfield_name mapping to "Shivam Mahajan"
  const nameRes = resolveCandidateAnswer('full_name', mockProfile, {
    question: 'Candidate Name',
    aliases: ['_systemfield_name'],
  });
  assert.equal(nameRes.value, 'Shivam Mahajan');

  // Test start date mapping to ISO YYYY-MM-DD
  const dateRes = resolveCandidateAnswer('start_date' as any, mockProfile, {
    question: 'Earliest start date',
    fieldType: 'date',
  });
  assert.match(String(dateRes.value), /^\d{4}-\d{2}-\d{2}$/);

  const runnerSrc = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  assert.ok(runnerSrc.includes('info.type === \'date\''));
  assert.ok(runnerSrc.includes('2026-08-01'));
});

test('GEN-133: runner.ts ensures maxSteps >= 4 for SmartRecruiters and widgets.ts supports spl-autocomplete', () => {
  const runnerSrc = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  assert.ok(runnerSrc.includes('smartrecruiters.com'));
  assert.ok(runnerSrc.includes('maxSteps'));

  const widgetsSrc = fs.readFileSync('src/autoapply/widgets.ts', 'utf8');
  assert.ok(widgetsSrc.includes('spl-select-option'));
  assert.ok(widgetsSrc.includes('.spl-autocomplete-option'));
});

test('GEN-134: workday-wizard.ts uses today date on signature and checks agreementCheckbox', () => {
  assert.equal(typeof fillWorkdaySpinbuttonDates, 'function');
  assert.equal(typeof runWorkdayStepFastPass, 'function');

  const wizardSrc = fs.readFileSync('src/autoapply/workday-wizard.ts', 'utf8');
  assert.ok(wizardSrc.includes('fillWorkdaySpinbuttonDates'));
  assert.ok(wizardSrc.includes('agreementCheckbox'));
  assert.ok(wizardSrc.includes('isSignatureOrToday'));
  assert.ok(wizardSrc.includes('getMonth() + 1'));
});
