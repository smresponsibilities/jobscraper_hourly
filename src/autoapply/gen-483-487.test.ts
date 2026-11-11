// src/autoapply/gen-483-487.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { unwrapDirectAtsApplicationUrl } from './url-unwrapper.js';
import { fetchGreenhouseQuestionSchema } from './distiller.js';
import { fillPhoneInputSmart, getActiveFormFrame } from './widgets.js';
import { resolveUniversalPermissiveFallback } from './permissive-fallback.js';
import { completeInPageEmailVerificationIfPrompted } from './imap-verifier.js';

test('GEN-483.1: Workday /fr-FR/ and /de-DE/ URL rewriting forces English (/en-US/) locale', () => {
  const frenchUrl = 'https://bosch.wd3.myworkdayjobs.com/fr-FR/Bosch_Jobs/job/Paris/Software-Engineer_12345';
  const unwrappedFrench = unwrapDirectAtsApplicationUrl(frenchUrl);
  assert.equal(unwrappedFrench, 'https://bosch.wd3.myworkdayjobs.com/en-US/Bosch_Jobs/job/Paris/Software-Engineer_12345');

  const germanUrl = 'https://airbus.wd3.myworkdayjobs.com/de-DE/Airbus/job/Munich/DevOps-Engineer_67890';
  const unwrappedGerman = unwrapDirectAtsApplicationUrl(germanUrl);
  assert.equal(unwrappedGerman, 'https://airbus.wd3.myworkdayjobs.com/en-US/Airbus/job/Munich/DevOps-Engineer_67890');

  const japaneseUrl = 'https://renesas.wd3.myworkdayjobs.com/ja-JP/Renesas/job/Tokyo/Firmware_999';
  const unwrappedJapanese = unwrapDirectAtsApplicationUrl(japaneseUrl);
  assert.equal(unwrappedJapanese, 'https://renesas.wd3.myworkdayjobs.com/en-US/Renesas/job/Tokyo/Firmware_999');

  const spanishUrl = 'https://coface.wd3.myworkdayjobs.com/es-ES/Coface/job/Madrid/Analyst_111';
  const unwrappedSpanish = unwrapDirectAtsApplicationUrl(spanishUrl);
  assert.equal(unwrappedSpanish, 'https://coface.wd3.myworkdayjobs.com/en-US/Coface/job/Madrid/Analyst_111');

  // English URLs must remain unchanged
  const englishUrl = 'https://bosch.wd3.myworkdayjobs.com/en-US/Bosch_Jobs/job/Paris/Software-Engineer_12345';
  assert.equal(unwrapDirectAtsApplicationUrl(englishUrl), englishUrl);

  // URLs without a locale prefix must not be modified
  const noLocaleUrl = 'https://bosch.wd3.myworkdayjobs.com/Bosch_Jobs/job/Paris/Software-Engineer_12345';
  assert.equal(unwrapDirectAtsApplicationUrl(noLocaleUrl), noLocaleUrl);
});

test('GEN-483.2: fetchGreenhouseQuestionSchema extracts board slug from frame form action or og:url on embed URLs', async () => {
  const originalFetch = globalThis.fetch;
  let requestedApiUrl = '';

  globalThis.fetch = (async (url: any) => {
    requestedApiUrl = String(url);
    return {
      ok: true,
      json: async () => ({
        questions: [
          {
            label: 'Are you legally authorized to work in India?',
            required: true,
            fields: [{ name: 'question_9001', values: [{ label: 'Yes' }, { label: 'No' }] }],
          },
        ],
      }),
    } as any;
  }) as any;

  try {
    // Mock frame with <form id="application_form" action="/uber/jobs/12345">
    const mockFrameFormAction: any = {
      evaluate: async (fn: any) => ({
        action: 'https://boards.greenhouse.io/uber/jobs/12345',
        metaOg: '',
      }),
    };

    const schema1 = await fetchGreenhouseQuestionSchema(
      'https://boards.greenhouse.io/embed/job_app?token=12345',
      mockFrameFormAction
    );
    assert.ok(schema1.size > 0, 'Schema should be hydrated from extracted board slug');
    assert.ok(requestedApiUrl.includes('/boards/uber/jobs/12345'), 'Api url should target uber board');

    // Mock frame with <meta property="og:url" content="https://boards.greenhouse.io/stripe/jobs/67890">
    const mockFrameMetaOg: any = {
      evaluate: async (fn: any) => ({
        action: '',
        metaOg: 'https://boards.greenhouse.io/stripe/jobs/67890',
      }),
    };

    const schema2 = await fetchGreenhouseQuestionSchema(
      'https://boards.greenhouse.io/embed/job_app?token=67890',
      mockFrameMetaOg
    );
    assert.ok(schema2.size > 0, 'Schema should be hydrated from extracted meta og:url board');
    assert.ok(requestedApiUrl.includes('/boards/stripe/jobs/67890'), 'Api url should target stripe board');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GEN-484.1: fillPhoneInputSmart handles maxlength="10" truncation recovery and E.164 +91 formatting', async () => {
  // Case A: maxlength="10" input directly receives 10-digit national number
  let filledValueA = '';
  const mockControlA: any = {
    evaluate: async (fn: any) => fn({ maxLength: 10, getAttribute: (attr: string) => (attr === 'maxlength' ? '10' : null) }),
    fill: async (val: string) => { filledValueA = val; },
    inputValue: async () => filledValueA,
  };
  const resA = await fillPhoneInputSmart(mockControlA, '+919876543210');
  assert.equal(resA, '9876543210', 'Should directly fill 10-digit national when maxLength === 10');
  assert.equal(filledValueA, '9876543210');

  // Case B: hasSeparateCountryCodeField === true directly receives 10-digit national number
  let filledValueB = '';
  const mockControlB: any = {
    evaluate: async (fn: any) => fn({ maxLength: -1, getAttribute: () => null }),
    fill: async (val: string) => { filledValueB = val; },
    inputValue: async () => filledValueB,
  };
  const resB = await fillPhoneInputSmart(mockControlB, '+919876543210', true);
  assert.equal(resB, '9876543210', 'Should directly fill 10-digit national when country code field is separate');
  assert.equal(filledValueB, '9876543210');

  // Case C: Standard input with no length restriction keeps full E.164 +91 format
  let filledValueC = '';
  const mockControlC: any = {
    evaluate: async (fn: any) => fn({ maxLength: -1, getAttribute: () => null }),
    fill: async (val: string) => { filledValueC = val; },
    inputValue: async () => filledValueC,
  };
  const resC = await fillPhoneInputSmart(mockControlC, '9876543210', false);
  assert.equal(resC, '+919876543210', 'Should format as +91 E.164 for standard input');
  assert.equal(filledValueC, '+919876543210');

  // Case D: Input without maxLength attribute that dynamically truncates +919876543210 to 10 chars (+919876543)
  // Must detect truncation (!readBackDigits.endsWith('3210')) and immediately re-fill with 10-digit national!
  let filledValueD = '';
  let fillCountD = 0;
  const mockControlD: any = {
    evaluate: async (fn: any) => fn({ maxLength: -1, getAttribute: () => null }),
    fill: async (val: string) => {
      fillCountD++;
      // Simulate input truncating to 10 chars when filled with +91
      filledValueD = val.slice(0, 10);
    },
    inputValue: async () => filledValueD,
  };
  const resD = await fillPhoneInputSmart(mockControlD, '9876543210', false);
  assert.equal(fillCountD, 2, 'Should fill twice: first +91, then recovery refill with national');
  assert.equal(resD, '9876543210', 'Should recover and return 10-digit national');
  assert.equal(filledValueD, '9876543210');
});

test('GEN-485.1: resolveUniversalPermissiveFallback returns "false" for conflicting checkboxes', () => {
  // "I currently work here" MUST return 'false' so it never conflicts with 08/2026 end date!
  const resCurrentlyWorkHere = resolveUniversalPermissiveFallback({
    questionText: 'I currently work here',
    widgetKind: 'CHECKBOX',
    options: null,
  });
  assert.equal(resCurrentlyWorkHere, 'false');

  const resCurrentJob = resolveUniversalPermissiveFallback({
    questionText: 'Is this your current job?',
    widgetKind: 'CHECKBOX',
    options: null,
  });
  assert.equal(resCurrentJob, 'false');

  const resDoNotContact = resolveUniversalPermissiveFallback({
    questionText: 'Do not contact current employer',
    widgetKind: 'CHECKBOX',
    options: null,
  });
  assert.equal(resDoNotContact, 'false');

  const resDisability = resolveUniversalPermissiveFallback({
    questionText: 'I have a disability',
    widgetKind: 'CHECKBOX',
    options: null,
  });
  assert.equal(resDisability, 'false');

  const resVeteran = resolveUniversalPermissiveFallback({
    questionText: 'I am a protected veteran',
    widgetKind: 'CHECKBOX',
    options: null,
  });
  assert.equal(resVeteran, 'false');

  const resHispanic = resolveUniversalPermissiveFallback({
    questionText: 'Are you Hispanic or Latino?',
    widgetKind: 'CHECKBOX',
    options: null,
  });
  assert.equal(resHispanic, 'false');

  // Normal consent checkboxes must continue to return 'true'
  const resAgreement = resolveUniversalPermissiveFallback({
    questionText: 'I agree to the terms and privacy policy',
    widgetKind: 'CHECKBOX',
    options: null,
  });
  assert.equal(resAgreement, 'true');
});

test('GEN-486.1: completeInPageEmailVerificationIfPrompted auto signs in after Workday verification link reload', async () => {
  let emailFilled = '';
  let passwordFilled = '';
  let submitClicked = false;

  const mockPage: any = {
    context: () => ({
      newPage: async () => ({
        goto: async () => {},
        waitForTimeout: async () => {},
        locator: () => ({
          first: () => ({
            isVisible: async () => false,
          }),
        }),
        close: async () => {},
      }),
    }),
    reload: async () => {},
    waitForTimeout: async () => {},
    locator: (selector: string) => {
      return {
        filter: () => ({
          count: async () => (selector.includes('signInContent') || selector.includes('password') ? 1 : 0),
          first: () => ({
            isVisible: async () => true,
            click: async () => {
              if (selector.includes('signInSubmitButton') || selector.includes('click_filter')) {
                submitClicked = true;
              }
            },
            fill: async (val: string) => {
              if (selector.includes('input-4') || selector.includes('formField-email')) {
                emailFilled = val;
              }
              if (selector.includes('password')) {
                passwordFilled = val;
              }
            },
          }),
        }),
      };
    },
  };

  const mockFrame: any = {
    evaluate: async () => 'verification required enter security code',
    locator: () => ({
      filter: () => ({
        count: async () => 1,
      }),
    }),
  };

  const verified = await completeInPageEmailVerificationIfPrompted(
    mockPage,
    mockFrame,
    undefined,
    {
      email: 'shivam.test@example.com',
      password: 'SecretPassword123!',
      imapPoller: async () => ({
        found: true,
        verificationUrl: 'https://workday.com/verify-email?token=xyz',
      }),
    }
  );
  assert.equal(verified, true, 'Verification should report successful completion');
  assert.equal(emailFilled, 'shivam.test@example.com', 'Candidate email should be filled into sign-in form');
  assert.ok(passwordFilled.length >= 8, 'Compliant password should be filled');
  assert.equal(submitClicked, true, 'Sign-in submit button should be clicked');
});

test('GEN-487.1: Active form frame resolution and 8-ATS terminal confirmation selectors in runner.ts', () => {
  const runnerSrc = fs.readFileSync(path.resolve('src/autoapply/runner.ts'), 'utf8');

  // Must define and use active form frame prioritization
  assert.ok(runnerSrc.includes('getActiveFormFrame'), 'runner.ts must import and use getActiveFormFrame');
  assert.ok(runnerSrc.includes('getPrioritizedFormFrames'), 'runner.ts must prioritize active form frames');

  // Must include the 4 terminal confirmation selectors for 8-ATS engines
  assert.ok(runnerSrc.includes('[data-automation-id="thankYouMessage"]'), 'Terminal check must include thankYouMessage');
  assert.ok(runnerSrc.includes('[data-ui="application-success"]'), 'Terminal check must include application-success');
  assert.ok(runnerSrc.includes('.ashby-application-form-success'), 'Terminal check must include ashby success');
  assert.ok(runnerSrc.includes('#application_confirmation'), 'Terminal check must include application_confirmation');

  // Verify getActiveFormFrame logic on mock page
  const mainFrame: any = { url: () => 'https://corporate.employer.com/careers' };
  const atsIframe: any = { url: () => 'https://boards.greenhouse.io/embed/job_app?token=123' };
  const mockMultiFramePage: any = {
    frames: () => [mainFrame, atsIframe],
    mainFrame: () => mainFrame,
  };

  const active = getActiveFormFrame(mockMultiFramePage);
  assert.equal(active, atsIframe, 'getActiveFormFrame must select the embedded ATS iframe over mainFrame');
});
