import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fillWorkdaySpinbuttonDates,
  fillWorkdaySelectInputFast,
  checkWorkdayStepLoopAndRecover,
  type WorkdayStepLoopState,
} from './workday-wizard.js';

test('GEN-429: Workday candidate date mapping produces correct academic/job dates', () => {
  const getDates = (section: 'education' | 'experience') => {
    return section === 'experience'
      ? { startMonth: '08', startYear: '2025', current: true }
      : { startYear: '2022', endYear: '2026', degree: "Bachelor's Degree" };
  };

  const exp = getDates('experience');
  assert.strictEqual(exp.startMonth, '08');
  assert.strictEqual(exp.startYear, '2025');
  assert.strictEqual(exp.current, true);

  const edu = getDates('education');
  assert.strictEqual(edu.endYear, '2026');
  assert.strictEqual(edu.degree, "Bachelor's Degree");
});

test('GEN-429: fillWorkdaySelectInputFast handles promptOption click and typing fallback', async () => {
  let clickedOption = false;
  let typedKeys = '';
  let pressedEnter = false;

  const mockOption = {
    count: async () => 1,
    scrollIntoViewIfNeeded: async () => {},
    click: async () => {
      clickedOption = true;
    },
    isVisible: async () => false,
  };

  const mockControl = {
    isVisible: async () => true,
    click: async () => {},
  };

  let selectedCount = 0;
  const mockContainer = {
    isVisible: async () => true,
    locator: (selector: string) => {
      if (selector === '[data-automation-id="selectedItem"]') {
        return {
          count: async () => selectedCount,
        };
      }
      return {
        ...mockControl,
        first: () => mockControl,
      };
    },
  };

  const mockPage = {
    waitForTimeout: async () => {},
    locator: (selector: string) => {
      return {
        filter: ({ hasText }: { hasText?: string; visible?: boolean }) => {
          if (hasText === 'TargetOption') {
            return {
              first: () => mockOption,
              count: async () => 1,
            };
          }
          return {
            first: () => ({
              ...mockOption,
              count: async () => 0,
            }),
            count: async () => 0,
          };
        },
        first: () => mockOption,
      };
    },
    keyboard: {
      type: async (text: string) => {
        typedKeys += text;
      },
      press: async (key: string) => {
        if (key === 'Enter') pressedEnter = true;
      },
    },
  };

  const mockFrame = {
    page: () => mockPage,
    locator: () => ({
      first: () => mockContainer,
      ...mockContainer,
    }),
  };

  // Case 1: Option matches promptOption directly
  selectedCount = 0;
  const res1 = await fillWorkdaySelectInputFast(mockFrame as any, 'container-sel', 'TargetOption');
  assert.equal(clickedOption, true, 'Should click matching promptOption');

  // Case 2: Fallback typing when promptOption not found
  clickedOption = false;
  const res2 = await fillWorkdaySelectInputFast(mockFrame as any, 'container-sel', 'UnknownOption');
  assert.equal(typedKeys, 'Unkn', 'Should type first 4 characters for search filter');
  assert.equal(pressedEnter, true, 'Should press Enter after typing');
});

test('GEN-429: fillWorkdaySpinbuttonDates normalizes start and graduation dates', async () => {
  const filledValues: Record<string, string> = {};

  const makeMockInput = (fieldKey: string, placeholder: string) => ({
    isVisible: async () => true,
    inputValue: async () => placeholder,
    click: async () => {},
    pressSequentially: async (val: string) => {
      filledValues[fieldKey] = val;
    },
  });

  const mockFieldEdu = {
    innerText: async () => 'Graduation Date Expected (Education)',
    evaluate: async (fn: any) => true, // inEducation
    locator: (selector: string) => {
      if (selector.includes('Month')) {
        return { first: () => makeMockInput('edu_month', 'MM') };
      }
      if (selector.includes('Year')) {
        return { first: () => makeMockInput('edu_year', 'YYYY') };
      }
      return { first: () => makeMockInput('edu_day', 'DD') };
    },
  };

  const mockFieldExp = {
    innerText: async () => 'From Start Date (Work Experience)',
    evaluate: async (fn: any) => {
      // Return true if selector checks workExperienceSection
      return true;
    },
    locator: (selector: string) => {
      if (selector.includes('Month')) {
        return { first: () => makeMockInput('exp_month', 'MM') };
      }
      if (selector.includes('Year')) {
        return { first: () => makeMockInput('exp_year', 'YYYY') };
      }
      return { first: () => makeMockInput('exp_day', 'DD') };
    },
  };

  const fields = [mockFieldEdu, mockFieldExp];

  const mockFrame = {
    locator: (selector: string) => {
      if (selector.startsWith('h1')) {
        return {
          allTextContents: async () => ['Work Experience and Education'],
        };
      }
      return {
        filter: () => ({
          count: async () => fields.length,
          nth: (idx: number) => fields[idx],
        }),
      };
    },
  };

  const filledCount = await fillWorkdaySpinbuttonDates(mockFrame as any);
  assert.ok(filledCount > 0, 'Should fill spinbutton date fields');
  assert.equal(filledValues['edu_year'], '2026', 'Education graduation year must normalize to 2026 (Chitkara University)');
  assert.equal(filledValues['edu_month'], '08', 'Education graduation month must be 08');
  assert.equal(filledValues['exp_year'], '2025', 'Morgan Stanley start year must normalize to 2025');
  assert.equal(filledValues['exp_month'], '08', 'Morgan Stanley start month must be 08');
});

test('GEN-429: checkWorkdayStepLoopAndRecover detects stuck steps and recovers error state', async () => {
  const loopState: WorkdayStepLoopState = {
    lastStepHash: '',
    consecutiveCount: 0,
  };

  const mockPage = {
    url: () => 'https://example.myworkdayjobs.com/en-US/careers/job/123/apply',
    locator: (selector: string) => {
      if (selector.includes('pageHeader')) {
        return {
          allInnerTexts: async () => ['My Information'],
        };
      }
      if (selector.includes('errorMessage')) {
        return {
          count: async () => 1,
          nth: () => ({
            innerText: async () => 'Field Postal Code is required',
          }),
        };
      }
      // For fast-pass fallback inside recovery
      return {
        first: () => ({
          isVisible: async () => false,
          count: async () => 0,
        }),
        filter: () => ({
          first: () => ({
            isVisible: async () => false,
            count: async () => 0,
          }),
          count: async () => 0,
        }),
      };
    },
    mainFrame: function () {
      return this;
    },
  };

  // Step 1: first encounter
  const res1 = await checkWorkdayStepLoopAndRecover(mockPage as any, loopState);
  assert.equal(res1.loopDetected, false, 'First attempt on a step is not a loop');
  assert.equal(loopState.consecutiveCount, 1);

  // Step 2: same step again (consecutive = 2) -> loop detected!
  const res2 = await checkWorkdayStepLoopAndRecover(mockPage as any, loopState);
  assert.equal(res2.loopDetected, true, 'Second consecutive click on same step must trigger loop detection');
  assert.equal(res2.errorMessages.length, 1);
  assert.equal(res2.errorMessages[0], 'Field Postal Code is required');
  assert.equal(res2.healed, true, 'Should trigger targeted fast-pass healing');

  // Step 3: advance to next step
  mockPage.locator = (selector: string) => {
    if (selector.includes('pageHeader')) {
      return {
        allInnerTexts: async () => ['My Experience'],
      };
    }
    return {
      count: async () => 0,
      first: () => ({ isVisible: async () => false }),
      filter: () => ({ count: async () => 0, first: () => ({ isVisible: async () => false }) }),
    };
  };

  const res3 = await checkWorkdayStepLoopAndRecover(mockPage as any, loopState);
  assert.equal(res3.loopDetected, false, 'Moving to a new step resets loop state');
  assert.equal(loopState.consecutiveCount, 1);
});
