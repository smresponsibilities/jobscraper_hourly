import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  attachNetworkReceiptListener,
  validateSubmissionReceipt,
} from './runner.js';

test('GEN-430: attachNetworkReceiptListener sets verified only on HTTP 200..204 without error payload', async () => {
  let responseHandler: ((resp: any) => Promise<void>) | null = null;
  const mockPage = {
    on: (event: string, handler: any) => {
      if (event === 'response') {
        responseHandler = handler;
      }
    },
  };

  const listener = attachNetworkReceiptListener(mockPage as any);
  assert.equal(listener.getStatus(), false, 'Initial state must be unverified');
  assert.ok(responseHandler, 'Response handler should be registered');

  // Case 1: Non-submit endpoint (e.g. static assets) -> remains false
  await responseHandler!({
    url: () => 'https://example.com/assets/bundle.js',
    status: () => 200,
    text: async () => 'var x = 1;',
  });
  assert.equal(listener.getStatus(), false, 'Non-submit endpoint should not verify');

  // Case 2: Submit endpoint with HTTP 500 error -> remains false
  await responseHandler!({
    url: () => 'https://boards-api.greenhouse.io/v1/applications',
    status: () => 500,
    text: async () => 'Internal Server Error',
  });
  assert.equal(listener.getStatus(), false, 'HTTP 500 must not verify');

  // Case 3: Submit endpoint with HTTP 200 but validation error JSON -> remains false
  await responseHandler!({
    url: () => 'https://job-boards.greenhouse.io/api/v1/applications',
    status: () => 200,
    text: async () => '{"error": "invalid_phone_number"}',
  });
  assert.equal(listener.getStatus(), false, 'HTTP 200 with error JSON must not verify');

  // Case 4: Submit endpoint with HTTP 200 and success response -> sets true
  await responseHandler!({
    url: () => 'https://job-boards.greenhouse.io/api/v1/applications',
    status: () => 200,
    text: async () => '{"success": true, "id": 12345}',
  });
  assert.equal(listener.getStatus(), true, 'HTTP 200 with clean response verifies receipt');

  // Case 5: Ashby /api/submitSingleApplicationForm
  const ashbyListener = attachNetworkReceiptListener(mockPage as any);
  await responseHandler!({
    url: () => 'https://jobs.ashbyhq.com/api/submitSingleApplicationForm',
    status: () => 200,
    text: async () => '{"isSuccess": false, "errors": ["invalid_resume"]}',
  });
  assert.equal(ashbyListener.getStatus(), false, 'Ashby with isSuccess: false must not verify');

  await responseHandler!({
    url: () => 'https://jobs.ashbyhq.com/api/submitSingleApplicationForm',
    status: () => 200,
    text: async () => '{"isSuccess": true}',
  });
  assert.equal(ashbyListener.getStatus(), true, 'Ashby with isSuccess: true must verify');

  // Case 6: SmartRecruiters /oneclick-ui/company/submit
  const srListener = attachNetworkReceiptListener(mockPage as any);
  await responseHandler!({
    url: () => 'https://www.smartrecruiters.com/oneclick-ui/company/submit',
    status: () => 201,
    text: async () => '{"id": "cand_123"}',
  });
  assert.equal(srListener.getStatus(), true, 'SmartRecruiters HTTP 201 must verify');

  // Case 7: Workday /apply/submit
  const wdListener = attachNetworkReceiptListener(mockPage as any);
  await responseHandler!({
    url: () => 'https://company.myworkdayjobs.com/en-US/job/apply/submit',
    status: () => 200,
    text: async () => '{"status": "SUBMITTED"}',
  });
  assert.equal(wdListener.getStatus(), true, 'Workday HTTP 200 must verify');
});

test('GEN-430: validateSubmissionReceipt enforces network-verified receipt and flags unconfirmed disappearance', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen430-test-'));
  const testErrorsPath = path.join(tmpDir, 'overnight-errors.jsonl');

  try {
    // 1. Legitimate confirmation heading -> applied
    const resHeading = validateSubmissionReceipt({
      hasConfirmationHeading: true,
      errorFilePath: testErrorsPath,
    });
    assert.equal(resHeading.isApplied, true);
    assert.equal(resHeading.status, 'applied');

    // 2. Legitimate confirmation URL without validation errors -> applied
    const resUrl = validateSubmissionReceipt({
      hasConfirmationUrl: true,
      hasValidationErrorText: false,
      errorFilePath: testErrorsPath,
    });
    assert.equal(resUrl.isApplied, true);
    assert.equal(resUrl.status, 'applied');

    // 3. Confirmation URL hijacked by visible validation error -> NOT applied
    const resUrlError = validateSubmissionReceipt({
      hasConfirmationUrl: true,
      hasValidationErrorText: true,
      errorFilePath: testErrorsPath,
    });
    assert.equal(resUrlError.isApplied, false);
    assert.notEqual(resUrlError.status, 'applied');

    // 4. Network receipt verified -> applied
    const resNetwork = validateSubmissionReceipt({
      networkReceiptVerified: true,
      errorFilePath: testErrorsPath,
    });
    assert.equal(resNetwork.isApplied, true);
    assert.equal(resNetwork.status, 'applied');

    // 5. Form unmounted but network receipt failed / absent -> review_required / failed with UNCONFIRMED_FORM_DISAPPEARANCE
    const resUnmountFailure = validateSubmissionReceipt({
      formUnmounted: true,
      networkReceiptVerified: false,
      hasConfirmationHeading: false,
      hasConfirmationUrl: false,
      candidateId: 'test-cand',
      jobUrl: 'https://boards.greenhouse.io/company/jobs/999',
      company: 'TestCorp',
      errorFilePath: testErrorsPath,
    });

    assert.equal(resUnmountFailure.isApplied, false, 'Unconfirmed unmount must NOT be applied');
    assert.equal(resUnmountFailure.status, 'review_required');
    assert.equal(resUnmountFailure.reason, 'UNCONFIRMED_FORM_DISAPPEARANCE');

    // Check that overnight error was logged to file
    assert.ok(fs.existsSync(testErrorsPath), 'Overnight errors log file must exist');
    const logContent = fs.readFileSync(testErrorsPath, 'utf8');
    assert.ok(logContent.includes('UNCONFIRMED_FORM_DISAPPEARANCE'), 'Log file must record UNCONFIRMED_FORM_DISAPPEARANCE');
    assert.ok(logContent.includes('TestCorp'), 'Log file must include company info');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
