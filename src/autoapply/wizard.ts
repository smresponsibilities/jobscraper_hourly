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
  nextButton: 'button[data-automation-id="bottom-navigation-next-button"], button[data-automation-id="page-navigation-next-button"]',
  submitButton: 'button[data-automation-id="bottom-navigation-submit-button"]',
  backButton: 'button[data-automation-id="bottom-navigation-back-button"]',
  saveAndContinue: 'button[data-automation-id*="saveAndContinue"], button[data-automation-id*="next"]',
  progressBar: '[data-automation-id="progressBar"], nav[aria-label="Progress"]',
  combobox: 'button[role="combobox"], div[data-automation-id*="dropdown"], [data-uxi-element-id*="select"]',
  popupOptions: '[role="listbox"] [role="option"], [data-automation-id*="popup"] [role="option"]',
  radioGroups: 'div[data-automation-id*="radio"]',
  errorBanners: '[data-automation-id="errorWidget"], [data-automation-id*="alert"], [aria-invalid="true"]',
};

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
    lowerHtml.includes('data-automation-id') ||
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
