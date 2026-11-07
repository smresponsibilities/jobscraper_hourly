import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureWorkdayCompliantPassword } from './authentication.js';
import { ensureWorkdayApplicationStarted } from './workday-entry.js';
import { fillWorkdaySpinbuttonDates, fillWorkdaySelectInputFast } from './workday-wizard.js';

test('ensureWorkdayCompliantPassword enforces Workday complexity constraints', () => {
  // Case 1: Simple weak password gets upgraded with symbols, digits, and length >= 12
  const weak = 'secret';
  const upgraded = ensureWorkdayCompliantPassword(weak);
  assert.ok(upgraded.length >= 12, 'Password length must be >= 12');
  assert.ok(/[A-Z]/.test(upgraded), 'Must contain uppercase');
  assert.ok(/[a-z]/.test(upgraded), 'Must contain lowercase');
  assert.ok(/[0-9]/.test(upgraded), 'Must contain digit');
  assert.ok(/[!@#$%^&*]/.test(upgraded), 'Must contain special char');

  // Case 2: Candidate name stripped
  const withName = 'ShivamMahajan123';
  const upgradedName = ensureWorkdayCompliantPassword(withName);
  assert.strictEqual(/shivam|mahajan/i.test(upgradedName), false, 'Must not contain candidate name');
  assert.ok(upgradedName.length >= 12);

  // Case 3: Already compliant strong password is kept unchanged
  const strong = 'Abcdef12345!@#';
  assert.strictEqual(ensureWorkdayCompliantPassword(strong), strong);
});

test('ensureWorkdayApplicationStarted passes through non-workday pages', async () => {
  const fakePage: any = {
    url: () => 'https://boards.greenhouse.io/embed/job_app?token=123',
  };
  const res = await ensureWorkdayApplicationStarted(fakePage);
  assert.strictEqual(res.enteredWizard, true);
  assert.strictEqual(res.jobClosed, false);
  assert.strictEqual(res.entryMethod, 'already_in_wizard');
});

test('ensureWorkdayApplicationStarted detects closed postings', async () => {
  const fakePage: any = {
    url: () => 'https://citi.wd5.myworkdayjobs.com/en-US/Careers/job/Pune/Engineer_123',
    evaluate: async (fn: any) => true, // simulates closed job text match
    locator: () => ({ first: () => ({ waitFor: async () => {} }) }),
  };
  const res = await ensureWorkdayApplicationStarted(fakePage);
  assert.strictEqual(res.enteredWizard, false);
  assert.strictEqual(res.jobClosed, true);
  assert.strictEqual(res.entryMethod, 'closed');
});

test('fillWorkdaySpinbuttonDates handles split month/year spinbuttons cleanly', async () => {
  let filledMonth = '';
  let filledYear = '';

  const mockMonthInput: any = {
    isVisible: async () => true,
    inputValue: async () => 'MM',
    click: async () => {},
    pressSequentially: async (val: string) => { filledMonth = val; },
  };

  const mockDayInput: any = {
    isVisible: async () => false,
  };

  const mockYearInput: any = {
    isVisible: async () => true,
    inputValue: async () => 'YYYY',
    click: async () => {},
    pressSequentially: async (val: string) => { filledYear = val; },
  };

  const mockField: any = {
    innerText: async () => 'Start Date (Month and Year)',
    locator: (selector: string) => {
      if (selector.includes('dateSectionMonth-input')) return { first: () => mockMonthInput };
      if (selector.includes('dateSectionDay-input')) return { first: () => mockDayInput };
      if (selector.includes('dateSectionYear-input')) return { first: () => mockYearInput };
      return { first: () => ({ isVisible: async () => false }) };
    },
  };

  const mockDateFields: any = {
    count: async () => 1,
    nth: () => mockField,
  };

  const mockFrame: any = {
    locator: (selector: string) => ({
      filter: () => mockDateFields,
      first: () => ({ isVisible: async () => false }),
    }),
  };

  const filledCount = await fillWorkdaySpinbuttonDates(mockFrame);
  assert.strictEqual(filledCount, 2);
  assert.strictEqual(filledMonth, '08');
  assert.strictEqual(filledYear, '2025');
});
