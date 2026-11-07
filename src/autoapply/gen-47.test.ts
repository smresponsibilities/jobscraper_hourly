import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  normalizeReasonCode,
  recordOvernightError,
  compileMorningImprovementReport,
  capturePageDiagnostics,
  type OvernightErrorRecord,
} from './overnight-error-logger.js';
import { reapStrayChrome, countAutomationChrome } from '../../scripts/run-overnight-marathon.js';
import { getOvernightErrorsData } from '../../scripts/dashboard-server.js';

test('GEN-47: normalizeReasonCode maps failure and pause messages to standardized Pareto categories', () => {
  assert.equal(normalizeReasonCode('Next did not change the form'), 'WIZARD_NEXT_STALLED');
  assert.equal(normalizeReasonCode('unchanged_form_state'), 'WIZARD_NEXT_STALLED');
  assert.equal(normalizeReasonCode('No supported submit control found'), 'MISSING_SUBMIT_BUTTON');
  assert.equal(normalizeReasonCode('Missing submit control on final step'), 'MISSING_SUBMIT_BUTTON');
  assert.equal(normalizeReasonCode('Required answer is missing'), 'PARKED_MISSING_FACT');
  assert.equal(normalizeReasonCode('unmapped form field'), 'PARKED_MISSING_FACT');
  assert.equal(normalizeReasonCode('CAPTCHA challenge encountered'), 'CAPTCHA_VISUAL_CHALLENGE');
  assert.equal(normalizeReasonCode('captcha_deferred', 'captcha_deferred'), 'CAPTCHA_VISUAL_CHALLENGE');
  assert.equal(normalizeReasonCode('Job timed out after 75000ms'), 'STEP_TIMEOUT');
  assert.equal(normalizeReasonCode('WATCHDOG_HEARTBEAT_TIMEOUT'), 'STEP_TIMEOUT');
  assert.equal(normalizeReasonCode('Validation or field errors require review'), 'FORM_VALIDATION_ERROR');
  assert.equal(normalizeReasonCode('Login needs browser review'), 'AUTH_OR_LOGIN_BLOCKER');
});

test('GEN-47: capturePageDiagnostics returns safe fallback when page is null or closed', async () => {
  const diag1 = await capturePageDiagnostics(null);
  assert.deepEqual(diag1, {
    stepHeading: '',
    validationErrorsOnPage: [],
    visibleButtonsOnPage: [],
    unmappedFields: [],
  });

  const mockClosedPage = {
    isClosed: () => true,
    evaluate: async () => { throw new Error('Target closed'); },
  };
  const diag2 = await capturePageDiagnostics(mockClosedPage);
  assert.deepEqual(diag2, {
    stepHeading: '',
    validationErrorsOnPage: [],
    visibleButtonsOnPage: [],
    unmappedFields: [],
  });
});

test('GEN-47: Overnight error logging & Morning Improvement Report generation', () => {
  const tmpDir = path.resolve('out/test-temp/gen-47');
  fs.mkdirSync(tmpDir, { recursive: true });

  const tmpErrors = path.join(tmpDir, 'test-overnight-errors.jsonl');
  const tmpMd = path.join(tmpDir, 'test-MORNING-REPORT.md');
  const tmpJson = path.join(tmpDir, 'test-improvement-report.json');
  const tmpLedger = path.join(tmpDir, 'test-unknown-ledger.json');

  if (fs.existsSync(tmpErrors)) fs.unlinkSync(tmpErrors);
  if (fs.existsSync(tmpMd)) fs.unlinkSync(tmpMd);
  if (fs.existsSync(tmpJson)) fs.unlinkSync(tmpJson);

  // Seed sample unknown-fields-ledger
  fs.writeFileSync(
    tmpLedger,
    JSON.stringify({
      'notice_period_days::SELECT': {
        questionText: 'What is your official notice period?',
        widgetKind: 'SELECT',
        isRequired: true,
        options: ['Immediate', '15 Days', '30 Days', '60 Days', '90 Days'],
        occurrences: 14,
        sampleCompanies: ['Stripe', 'Atlassian', 'Uber'],
      },
      'willing_to_relocate::RADIO': {
        questionText: 'Are you willing to relocate to Bengaluru?',
        widgetKind: 'RADIO',
        isRequired: true,
        options: ['Yes', 'No'],
        occurrences: 9,
        sampleCompanies: ['Tekion', 'PhonePe'],
      },
    }),
    'utf8'
  );

  // 1. Record sample error records
  const sample1: OvernightErrorRecord = {
    timestamp: new Date().toISOString(),
    jobId: 'job_test_01',
    company: 'Acme AI',
    title: 'Senior Backend Engineer',
    provider: 'greenhouse',
    lane: 'greenhouse',
    url: 'https://job-boards.greenhouse.io/acmeai/jobs/101',
    durationMs: 34120, // Real measured duration
    status: 'paused_for_review',
    reasonCode: 'WIZARD_NEXT_STALLED',
    errorMessage: 'Next did not change the form',
    stepNumber: 2,
    stepHeading: 'Work Authorization & Preferences',
    unmappedFields: [
      {
        questionText: 'Are you open to working 5 days in office?',
        widgetKind: 'RADIO',
        isRequired: true,
        options: ['Yes', 'No'],
        sectionHeading: 'Office Policy',
        domIdOrName: 'question_101_office',
      },
    ],
    validationErrorsOnPage: ['Please answer required question: Office Attendance'],
    visibleButtonsOnPage: [
      {
        tag: 'button',
        text: 'Save and Continue',
        ariaLabel: 'Next Step',
        dataAutomationId: 'wizardNextButton',
        dataTest: 'btn-next',
        className: 'btn btn-primary submit-btn',
        inShadowDom: false,
      },
      {
        tag: 'button',
        text: 'Back',
        ariaLabel: 'Previous Step',
        dataAutomationId: 'wizardBackButton',
        dataTest: 'btn-back',
        className: 'btn btn-secondary',
        inShadowDom: false,
      },
    ],
  };

  const sample2: OvernightErrorRecord = {
    timestamp: new Date().toISOString(),
    jobId: 'job_test_02',
    company: 'Workday Tenant Corp',
    title: 'Staff Platform Engineer',
    provider: 'workday',
    lane: 'workday',
    url: 'https://wd3.myworkdayjobs.com/corp/job/202',
    durationMs: 48900,
    status: 'failed',
    reasonCode: 'MISSING_SUBMIT_BUTTON',
    errorMessage: 'No supported submit control found',
    stepNumber: 3,
    stepHeading: 'Review & Submit',
    unmappedFields: [],
    validationErrorsOnPage: [],
    visibleButtonsOnPage: [
      {
        tag: 'button',
        text: 'Submit Application',
        ariaLabel: 'Submit Application Button',
        dataAutomationId: 'bottom-submit-button',
        dataTest: '',
        className: 'css-submit-wd',
        inShadowDom: true,
      },
    ],
  };

  recordOvernightError(sample1, tmpErrors);
  recordOvernightError(sample2, tmpErrors);

  assert.ok(fs.existsSync(tmpErrors));
  const rawLines = fs.readFileSync(tmpErrors, 'utf8').trim().split('\n');
  assert.equal(rawLines.length, 2);

  // 2. Compile morning improvement report
  const { reportMarkdown, reportJson } = compileMorningImprovementReport({
    errorsPath: tmpErrors,
    ledgerPath: tmpLedger,
    outMdPath: tmpMd,
    outJsonPath: tmpJson,
  });

  assert.ok(fs.existsSync(tmpMd));
  assert.ok(fs.existsSync(tmpJson));

  // Verify Markdown structure
  assert.ok(reportMarkdown.includes('## Section 1: Overnight Summary'));
  assert.ok(reportMarkdown.includes('Total Processed'));
  assert.ok(reportMarkdown.includes('Per-ATS Latency & Durations'));
  assert.ok(reportMarkdown.includes('GREENHOUSE'));
  assert.ok(reportMarkdown.includes('34.1s')); // Avg duration
  assert.ok(reportMarkdown.includes('WORKDAY'));
  assert.ok(reportMarkdown.includes('48.9s'));

  assert.ok(reportMarkdown.includes('## Section 2: Top 15 Failure & Pause Categories'));
  assert.ok(reportMarkdown.includes('WIZARD_NEXT_STALLED'));
  assert.ok(reportMarkdown.includes('MISSING_SUBMIT_BUTTON'));
  assert.ok(reportMarkdown.includes('Acme AI'));

  assert.ok(reportMarkdown.includes('## Section 3: Top 25 Unknown / Unmapped Questions Encountered'));
  assert.ok(reportMarkdown.includes('What is your official notice period?'));
  assert.ok(reportMarkdown.includes('Are you willing to relocate to Bengaluru?'));
  assert.ok(reportMarkdown.includes('Are you open to working 5 days in office?'));

  assert.ok(reportMarkdown.includes('## Section 4: Top Missed Button Selectors & Wizard Stalls'));
  assert.ok(reportMarkdown.includes('Acme AI (greenhouse)'));
  assert.ok(reportMarkdown.includes('Please answer required question: Office Attendance'));
  assert.ok(reportMarkdown.includes('wizardNextButton'));
  assert.ok(reportMarkdown.includes('bottom-submit-button'));

  // Verify JSON structure
  assert.equal(reportJson.summary.failed >= 1, true);
  assert.equal(reportJson.topFailureCategories.length, 2);
  assert.equal(reportJson.topUnknownQuestions.length >= 3, true);
  assert.equal(reportJson.missedButtonStalls.length, 2);
  assert.equal(reportJson.missedButtonStalls[0].company, 'Acme AI');
  assert.equal(reportJson.missedButtonStalls[0].visibleButtons[0].dataAutomationId, 'wizardNextButton');
  assert.equal(reportJson.missedButtonStalls[1].visibleButtons[0].inShadowDom, true);
});

test('GEN-47: reapStrayChrome and countAutomationChrome run safely without throwing', () => {
  const countBefore = countAutomationChrome();
  assert.equal(typeof countBefore, 'number');
  assert.ok(countBefore >= 0);

  const reaped = reapStrayChrome();
  assert.equal(typeof reaped, 'number');
  assert.ok(reaped >= 0);
});

test('GEN-47: getOvernightErrorsData returns compiled report JSON for /api/overnight-errors', () => {
  const data = getOvernightErrorsData();
  assert.ok(data);
  assert.ok(data.generatedAt);
  assert.ok(data.summary);
  assert.ok(Array.isArray(data.topFailureCategories));
  assert.ok(Array.isArray(data.topUnknownQuestions));
  assert.ok(Array.isArray(data.missedButtonStalls));
});
