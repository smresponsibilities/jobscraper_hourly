/**
 * JobWizard Multi-Page Workday/Taleo Form Handler Engine.
 * Reverse-engineered from JobWizard's multi-step enterprise ATS orchestration.
 */

import type { MultiPageStepStatus } from './types.js';

export type WorkdayStepName =
  | 'my_information'
  | 'my_experience'
  | 'application_questions'
  | 'voluntary_disclosures'
  | 'review'
  | 'unknown';

export interface WorkdayStepDefinition {
  name: WorkdayStepName;
  headerKeywords: RegExp[];
  keySelectors: string[];
}

export const WORKDAY_STEPS: WorkdayStepDefinition[] = [
  {
    name: 'my_information',
    headerKeywords: [/my[_\-\s]?information/i, /contact[_\-\s]?info/i, /personal[_\-\s]?information/i],
    keySelectors: [
      '[data-automation-id="legalNameSection_firstName"]',
      '[data-automation-id="addressSection_country"]',
      '[data-automation-id="phone-number"]',
    ],
  },
  {
    name: 'my_experience',
    headerKeywords: [/my[_\-\s]?experience/i, /work[_\-\s]?experience/i, /resume/i, /cv/i],
    keySelectors: [
      '[data-automation-id="file-upload-dropzone"]',
      '[data-automation-id="workExperienceSection"]',
      '[data-automation-id="educationSection"]',
    ],
  },
  {
    name: 'application_questions',
    headerKeywords: [/application[_\-\s]?questions/i, /questionnaire/i, /additional[_\-\s]?questions/i],
    keySelectors: [
      '[data-automation-id*="question"]',
      '[data-automation-id*="workAuth"]',
    ],
  },
  {
    name: 'voluntary_disclosures',
    headerKeywords: [/voluntary[_\-\s]?disclosures/i, /self[_\-\s]?identification/i, /eeo/i, /diversity/i],
    keySelectors: [
      '[data-automation-id="gender"]',
      '[data-automation-id="veteranStatus"]',
      '[data-automation-id="disabilityStatus"]',
    ],
  },
  {
    name: 'review',
    headerKeywords: [/review/i, /review[_\-\s]?and[_\-\s]?submit/i, /summary/i],
    keySelectors: [
      '[data-automation-id="bottom-navigation-submit-button"]',
      '[data-automation-id="reviewSection"]',
    ],
  },
];

export const WORKDAY_SELECTORS = {
  nextButton: 'button[data-automation-id="bottom-navigation-next-button"]:not(:has-text("Submit")), button[data-automation-id="page-navigation-next-button"]:not(:has-text("Submit")), button[data-automation-id="pageFooterNextButton"]:not(:has-text("Submit")), button[data-automation-id*="saveAndContinue" i], button[data-automation-id*="next" i], button[data-automation-id*="continue" i]',
  submitButton: 'button[data-automation-id="bottom-navigation-submit-button"], button[data-automation-id="pageFooterSubmitButton"], button[data-automation-id="submit-button"], button[data-automation-id*="submit" i], button[data-automation-id="bottom-navigation-next-button"]:has-text("Submit"), button[data-automation-id="pageFooterNextButton"]:has-text("Submit")',
  backButton: 'button[data-automation-id="bottom-navigation-back-button"]',
  saveAndContinue: 'button[data-automation-id*="saveAndContinue"], button[data-automation-id*="next"]',
  progressBar: '[data-automation-id="progressBar"], nav[aria-label="Progress"]',
  combobox: 'button[role="combobox"], div[data-automation-id*="dropdown"], [data-uxi-element-id*="select"]',
  popupOptions: '[role="listbox"] [role="option"], [data-automation-id*="popup"] [role="option"]',
  radioGroups: 'div[data-automation-id*="radio"]',
  errorBanners: '[data-automation-id="errorWidget"], [data-automation-id*="alert"], [aria-invalid="true"]',
  cookieConsent: 'button:has-text("Accept Cookies"), button:has-text("Accept"), [data-automation-id="legalNoticeAcceptButton"]',
  signInWithEmail: 'button[data-automation-id="SignInWithEmailButton"]',
  honeypot: 'input[data-automation-id="beecatcher"]',
};

/**
 * Dismisses cookie consent modals on Workday and related portals if present.
 */
export async function dismissCookieConsent(page: any): Promise<boolean> {
  try {
    const cookieBtn = page.locator('button:has-text("Accept Cookies"), button:has-text("Accept"), [data-automation-id="legalNoticeAcceptButton"]').filter({ visible: true }).first();
    if (await cookieBtn.isVisible().catch(() => false)) {
      await cookieBtn.click().catch(() => {});
      await page.waitForTimeout(500);
      return true;
    }
  } catch {}
  return false;
}

export const TALEO_SELECTORS = {
  iframe: 'iframe#requisitionDescriptionInterface, iframe[id*="taleo"], iframe[name*="taleo"]',
  nextButton: 'input[value*="Save and Continue" i], input[value*="Next" i], input[id*="btnNext" i], a.wizard-btn-next',
  submitButton: 'input[value*="Submit" i], input[id*="btnSubmit" i]',
  stepHeaders: '.wizardStepHeader, .stepTitle, th.wizard-step',
  errorContainer: '.error-message, .alert-error, #errorSection',
};

/**
 * Detects whether the given DOM/context represents Workday or Taleo.
 */
export function identifyEnterpriseAts(url: string, htmlSnippet = ''): 'workday' | 'taleo' | null {
  const lowerUrl = url.toLowerCase();
  const lowerHtml = htmlSnippet.toLowerCase();

  if (
    lowerUrl.includes('myworkdayjobs.com') ||
    lowerUrl.includes('myworkdaysite.com') ||
    /data-automation-id=["'](?:workday["']|formfield-|applyflow|progressbar)/.test(lowerHtml) ||
    lowerHtml.includes('workdayexternalcareersite')
  ) {
    return 'workday';
  }

  if (
    lowerUrl.includes('taleo.net') ||
    lowerHtml.includes('requisitiondescriptioninterface') ||
    lowerHtml.includes('taleo')
  ) {
    return 'taleo';
  }

  return null;
}

/**
 * Classifies current Workday step based on page headings and present selectors.
 */
export function classifyWorkdayStep(
  headingsText: string,
  presentSelectors: string[]
): WorkdayStepName {
  for (const step of WORKDAY_STEPS) {
    // Check heading keywords
    for (const kw of step.headerKeywords) {
      if (kw.test(headingsText)) {
        return step.name;
      }
    }

    // Check selectors presence
    for (const sel of step.keySelectors) {
      if (presentSelectors.includes(sel)) {
        return step.name;
      }
    }
  }

  return 'unknown';
}

/**
 * Evaluates multi-page progression status.
 */
export function evaluateStepStatus(
  ats: 'workday' | 'taleo',
  stepName: WorkdayStepName,
  hasErrors = false
): MultiPageStepStatus {
  const isWorkday = ats === 'workday';
  const isTaleo = ats === 'taleo';

  let stepIdx = 0;
  const total = 5;

  switch (stepName) {
    case 'my_information': stepIdx = 1; break;
    case 'my_experience': stepIdx = 2; break;
    case 'application_questions': stepIdx = 3; break;
    case 'voluntary_disclosures': stepIdx = 4; break;
    case 'review': stepIdx = 5; break;
    default: stepIdx = 1;
  }

  const isLast = stepIdx === total || stepName === 'review';
  const canAdvance = !hasErrors && !isLast;

  return {
    currentStepIndex: stepIdx,
    totalStepsEstimate: total,
    stepTitle: stepName.replace(/_/g, ' ').toUpperCase(),
    isWorkday,
    isTaleo,
    isLastStep: isLast,
    canAdvance,
  };
}

/** Platform hints supplement native role/label locators; frames and open shadows
 * remain owned by the shared browser runner. No strategy clears challenges. */
export const ATS_STRATEGIES: Record<string, { domains: string[]; form: string; marker: RegExp; next?: string; submit?: string }> = {
  workday: { domains: ['myworkdayjobs.com', 'myworkdaysite.com'], form: '[data-automation-id="applyFlowPage"]', marker: /data-automation-id=["'](?:applyFlow|formField-)/i, next: WORKDAY_SELECTORS.nextButton, submit: WORKDAY_SELECTORS.submitButton },
  greenhouse: { domains: ['greenhouse.io'], form: '#application_form,#application', marker: /id=["']application_form["']/i, submit: '#submit_app, button[type="submit"], input[type="submit"]' },
  lever: { domains: ['lever.co'], form: '.application-form', marker: /lever-application|postings-btn-wrapper/i, submit: '#btn-submit, [data-qa="btn-submit"], button[type="submit"]' },
  ashby: { domains: ['ashbyhq.com'], form: '.ashby-application-form-container', marker: /ashby-application-form/i, submit: 'button[type="submit"], .ashby-application-form-submit-button' },
  icims: { domains: ['icims.com'], form: '#icims_content_iframe,.iCIMS_MainWrapper', marker: /icims_content_iframe|iCIMS_MainWrapper/i, next: 'input[type="submit"][value*="Next" i],input[type="button"][value*="Continue" i]' },
  smartrecruiters: {
    domains: ['smartrecruiters.com', 'smartr.me'],
    form: '.smartrec-apply,form.application-form',
    marker: /smartrec-apply/i,
    next: 'button[data-test="footer-next"], oc-button[data-test*="next"] button, spl-button[data-test*="next"] button',
    submit: 'button[data-test="job-apply-submit"], button[data-test="footer-submit"], oc-button[data-test*="submit"] button, spl-button[type="submit"], oc-button button, spl-button button, button[type="submit"], #create-profile-submit-btn',
  },
  workable: { domains: ['workable.com'], form: 'section[data-ui="application-form"]', marker: /data-ui=["']application-form["']/i, submit: 'button[data-ui="submit-application"], button[type="submit"]' },
  oracle: { domains: ['oraclecloud.com'], form: '[data-test-component="form"],spl-form-field', marker: /spl-form-field|data-test-component=["']form["']/i },
  successfactors: { domains: ['successfactors.com', 'successfactors.eu'], form: '#applyForm,.sf-form', marker: /id=["']applyForm["']|class=["'][^"']*\bsf-form\b/i, next: 'input[type="submit"][value="Next" i],input[type="submit"][value="Continue" i]' },
  taleo: { domains: ['taleo.net'], form: '#mainContent,.tal-form', marker: /requisitionDescriptionInterface|\btal-form\b/i, next: TALEO_SELECTORS.nextButton, submit: TALEO_SELECTORS.submitButton },
  recruitee: { domains: ['recruitee.com'], form: '.offer-apply-form', marker: /\boffer-apply-form\b/i },
};

export function identifyApplicationAts(url: string, htmlSnippet = ''): string {
  const host = new URL(url).hostname.toLowerCase();
  return Object.entries(ATS_STRATEGIES).find(([, strategy]) => strategy.domains.some(domain => host === domain || host.endsWith(`.${domain}`)))?.[0]
    || Object.entries(ATS_STRATEGIES).find(([, strategy]) => strategy.marker.test(htmlSnippet))?.[0]
    || identifyEnterpriseAts('https://local.invalid', htmlSnippet) || 'generic';
}
