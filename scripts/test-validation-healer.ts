import { chromium } from 'patchright';
import assert from 'node:assert';
import { parseAndHealServerValidationErrors, coerceFieldValueByErrorMessage } from '../src/autoapply/validation-healer.js';

async function testValidationHealer() {
  console.log('[TEST-GEN-536] Starting Validation Healer test...');

  // 1. Test unit coercion logic
  assert.strictEqual(coerceFieldValueByErrorMessage('12 LPA', 'Expected salary must be a number'), '1200000');
  assert.strictEqual(coerceFieldValueByErrorMessage('shivammahajan.com', 'Please enter a valid URL'), 'https://shivammahajan.com');
  assert.strictEqual(coerceFieldValueByErrorMessage('N/A', 'Please enter a valid URL'), 'https://shivammahajan.com/projects/');
  console.log('✔ Field value coercions verified');

  // 2. Test DOM healing with mocked server responses
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.setContent(`
      <html>
        <body>
          <form id="ashby-form">
            <!-- Ashby field with formId_fieldUuid pattern -->
            <input type="text" id="field_c83d6a71-6679-4bb4-9467-f3c5dc71891b" name="c83d6a71-6679-4bb4-9467-f3c5dc71891b" value="12 LPA" />
            <!-- Greenhouse field -->
            <input type="text" id="job_application_answers_attributes_1_boolean_value" name="website" value="shivammahajan.com" />
            <!-- OTP input should never be touched -->
            <input type="text" id="security-input-1" name="security_code" maxlength="1" value="5" />
          </form>
        </body>
      </html>
    `);

    // Mock Ashby GraphQL response
    const ashbyResponse = {
      url: 'https://jobs.ashbyhq.com/api/non-user-graphql?op=submitApplicationFormAction',
      status: 200,
      body: {
        data: {
          submitApplicationFormAction: {
            formErrors: [
              {
                fieldEntryId: 'form_c83d6a71-6679-4bb4-9467-f3c5dc71891b',
                message: 'Value must be a number',
              },
            ],
          },
        },
      },
    };

    // Mock Greenhouse 422 response
    const ghResponse = {
      url: 'https://boards.greenhouse.io/test/jobs/12345',
      status: 422,
      body: {
        errors: [
          {
            field: 'website',
            message: 'Must be a valid URL',
          },
        ],
      },
    };

    const res = await parseAndHealServerValidationErrors(page, 'ashby', [ashbyResponse, ghResponse]);
    console.log('Healer result:', res);
    assert.strictEqual(res.healedCount, 2, 'Should heal both fields');

    // Verify DOM updates
    const salaryVal = await page.$eval('#field_c83d6a71-6679-4bb4-9467-f3c5dc71891b', (el: any) => el.value);
    assert.strictEqual(salaryVal, '1200000', 'Salary should be coerced from 12 LPA to 1200000');

    const websiteVal = await page.$eval('#job_application_answers_attributes_1_boolean_value', (el: any) => el.value);
    assert.strictEqual(websiteVal, 'https://shivammahajan.com', 'Website should have https:// prepended');

    const otpVal = await page.$eval('#security-input-1', (el: any) => el.value);
    assert.strictEqual(otpVal, '5', 'OTP input must never be touched');

    console.log('[TEST-GEN-536 PASS] Validation Healer tests passed successfully.');
  } finally {
    await browser.close();
  }
}

testValidationHealer().catch(err => {
  console.error('[TEST-GEN-536 FAIL]', err);
  process.exit(1);
});
