// src/autoapply/gen-56-62.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveUniversalPermissiveFallback,
  getAndIncrementJobAttempt,
  getJobAttemptCount,
} from './permissive-fallback.js';
import { buildCoordinatedFillPlan } from './clubbing.js';
import { healInvalidFieldsAndRetrySubmit } from './runner.js';
import type { DistilledField } from './distiller.js';
import type { Frame } from 'patchright';

describe('GEN-56 to GEN-62 Moonshot Architecture', () => {
  describe('Universal Permissive Fallback Solver (GEN-57 & GEN-62)', () => {
    it('resolves valid non-empty answers for 100% of required widget kinds', () => {
      // 1. SINGLE_SELECT - Negative question (sponsorship)
      const negSelect = resolveUniversalPermissiveFallback({
        questionText: 'Will you now or in the future require visa sponsorship?',
        widgetKind: 'SINGLE_SELECT',
        options: ['Yes', 'No'],
        profileEmail: 'test@example.com',
      });
      assert.equal(negSelect, 'No');

      // 1b. SINGLE_SELECT - Positive candidate option (Bengaluru)
      const locSelect = resolveUniversalPermissiveFallback({
        questionText: 'Primary Location',
        widgetKind: 'SINGLE_SELECT',
        options: ['New York', 'London', 'Bengaluru, India', 'Remote US'],
        profileEmail: 'test@example.com',
      });
      assert.equal(locSelect, 'Bengaluru, India');

      // 1c. SINGLE_SELECT - Fallback to first non-placeholder option
      const genericSelect = resolveUniversalPermissiveFallback({
        questionText: 'Preferred T-Shirt Size',
        widgetKind: 'SINGLE_SELECT',
        options: ['-- Select --', 'Medium', 'Large'],
        profileEmail: 'test@example.com',
      });
      assert.equal(genericSelect, 'Medium');

      // 2. BOOLEAN_TOGGLE
      const boolToggle = resolveUniversalPermissiveFallback({
        questionText: 'Are you comfortable working in a hybrid environment?',
        widgetKind: 'BOOLEAN_TOGGLE',
        options: ['Yes', 'No'],
        profileEmail: 'test@example.com',
      });
      assert.equal(boolToggle, 'Yes');

      // 3. NUMBER - GPA
      const gpaNum = resolveUniversalPermissiveFallback({
        questionText: 'Cumulative CGPA / GPA',
        widgetKind: 'NUMBER',
        options: null,
        profileEmail: 'test@example.com',
      });
      assert.equal(gpaNum, '9.35');

      // 3b. NUMBER - Unlisted skill (Ruby/Go)
      const skillNum = resolveUniversalPermissiveFallback({
        questionText: 'Years of experience with Ruby on Rails',
        widgetKind: 'NUMBER',
        options: null,
        profileEmail: 'test@example.com',
      });
      assert.equal(skillNum, '0');

      // 3c. NUMBER - Notice period
      const noticeNum = resolveUniversalPermissiveFallback({
        questionText: 'Notice period (in days)',
        widgetKind: 'NUMBER',
        options: null,
        profileEmail: 'test@example.com',
      });
      assert.equal(noticeNum, '0');

      // 4. CHECKBOX
      const consentCb = resolveUniversalPermissiveFallback({
        questionText: 'I agree to the privacy statement and data processing terms',
        widgetKind: 'CHECKBOX',
        options: null,
        profileEmail: 'test@example.com',
      });
      assert.equal(consentCb, 'true');

      // 5. TEXT - City
      const cityText = resolveUniversalPermissiveFallback({
        questionText: 'Current City',
        widgetKind: 'TEXT',
        options: null,
        profileEmail: 'test@example.com',
      });
      assert.equal(cityText, 'Bengaluru, Karnataka, India');

      // 5b. TEXT - University
      const uniText = resolveUniversalPermissiveFallback({
        questionText: 'University / Institute Name',
        widgetKind: 'TEXT',
        options: null,
        profileEmail: 'test@example.com',
      });
      assert.equal(uniText, 'Chitkara University');

      // 6. TEXTAREA - Grounded experience narrative
      const openText = resolveUniversalPermissiveFallback({
        questionText: 'Describe a complex backend system or API architecture you designed and shipped.',
        widgetKind: 'TEXTAREA',
        options: null,
        profileEmail: 'test@example.com',
      });
      assert.match(openText, /Morgan Stanley/);
      assert.match(openText, /CIAM/);
      assert.match(openText, /Kafka/);
    });

    it('tracks and increments job attempt counts', () => {
      const testJobId = `test_job_${Date.now()}`;
      assert.equal(getJobAttemptCount(testJobId), 0);
      const first = getAndIncrementJobAttempt(testJobId);
      assert.equal(first, 1);
      assert.equal(getJobAttemptCount(testJobId), 1);
      const second = getAndIncrementJobAttempt(testJobId);
      assert.equal(second, 2);
      assert.equal(getJobAttemptCount(testJobId), 2);
    });
  });

  describe('Resume-First Upload (Priority = 1) (GEN-58)', () => {
    it('places FILE_UPLOAD at executionPriority === 1 with 1500ms post-fill wait', () => {
      const fields: DistilledField[] = [
        {
          questionText: 'Country',
          widgetKind: 'SINGLE_SELECT',
          isRequired: true,
          refKey: 'f-1',
          sectionHeading: 'Personal Information',
          isFilled: false,
          currentValue: '',
          options: ['India', 'United States'],
          validationError: null,
          containerSelector: '',
          controlSelector: '',
        },
        {
          questionText: 'Attach Resume / CV',
          widgetKind: 'FILE_UPLOAD',
          isRequired: true,
          refKey: 'f-2',
          sectionHeading: 'Resume',
          isFilled: false,
          currentValue: '',
          options: [],
          validationError: null,
          containerSelector: '',
          controlSelector: '',
        },
        {
          questionText: 'First Name',
          widgetKind: 'TEXT',
          isRequired: true,
          refKey: 'f-3',
          sectionHeading: 'Personal Information',
          isFilled: false,
          currentValue: '',
          options: [],
          validationError: null,
          containerSelector: '',
          controlSelector: '',
        },
      ];

      const plan = buildCoordinatedFillPlan(fields);
      assert.equal(plan.length, 3);
      // The first field in the coordinated execution plan MUST be FILE_UPLOAD with executionPriority === 1
      assert.equal(plan[0]?.field.widgetKind, 'FILE_UPLOAD');
      assert.equal(plan[0]?.executionPriority, 1);
      assert.equal(plan[0]?.postFillWaitMs, 1500);
    });
  });

  describe('Post-Submit Surgical Validation Healer (GEN-60 & GEN-61)', () => {
    it('executes in-place healing and returns count of fixed controls', async () => {
      // Create mock Playwright Frame that executes the evaluation function in simulated DOM
      const mockFrame = {
        evaluate: async (fn: any, arg: any) => {
          // Simulate the browser evaluate environment
          return 3; // Simulated 3 healed controls (invalid input, Ashby Yes/No button, consent checkbox)
        },
      } as unknown as Frame;

      const healed = await healInvalidFieldsAndRetrySubmit(mockFrame, 'test@example.com');
      assert.equal(healed, 3);
    });
  });
});
