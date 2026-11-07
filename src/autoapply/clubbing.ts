// src/autoapply/clubbing.ts
import type { DistilledField } from './distiller.js';

export type CompositeClubKind =
  | 'ADDRESS_CASCADE'
  | 'PHONE_COMPOSITE'
  | 'WORK_EXPERIENCE_BLOCK'
  | 'EDUCATION_BLOCK'
  | 'COMPENSATION_COMPOSITE'
  | 'STANDALONE';

export interface ClubbedFieldPlan {
  field: DistilledField;
  clubKind: CompositeClubKind;
  executionPriority: number; // Lower runs first (e.g. Country=10 -> State=20 -> City=30 -> Zip=40)
  postFillWaitMs: number; // e.g. 650ms after Country so State dropdown populates
  valueTransform?: 'strip_country_code' | 'force_work_dates' | 'force_edu_dates' | 'lpa_vs_annual';
}

export function buildCoordinatedFillPlan(fields: DistilledField[]): ClubbedFieldPlan[] {
  const hasPhoneCountryDropdown = fields.some(
    f =>
      (f.widgetKind === 'SINGLE_SELECT' || (f.options && f.options.length > 0)) &&
      /\b(country code|phone code|dial code|calling code|phone type)\b/i.test(f.questionText)
  );

  return fields
    .map((field): ClubbedFieldPlan => {
      const q = field.questionText.toLowerCase();
      const sec = (field.sectionHeading || '').toLowerCase();

      // 0. Ticket GEN-58: Resume / CV File Upload FIRST (Priority = 1, wait 1500ms)
      // Uploading resume first triggers built-in parser on Lever, Ashby, Greenhouse & Workday
      if (field.widgetKind === 'FILE_UPLOAD' || /\b(resume|cv|curriculum vitae)\b/i.test(q)) {
        return { field, clubKind: 'STANDALONE', executionPriority: 1, postFillWaitMs: 1500 };
      }

      // 1. Address Cascade Ordering: Country (10) -> State (20) -> City (30) -> Postal/Zip (40)
      if (/\b(country|country\/region)\b/i.test(q) && !/code|phone|citizenship/i.test(q)) {
        return { field, clubKind: 'ADDRESS_CASCADE', executionPriority: 10, postFillWaitMs: 700 };
      }
      if (/\b(state|province|region)\b/i.test(q) && !/united states/i.test(q)) {
        return { field, clubKind: 'ADDRESS_CASCADE', executionPriority: 20, postFillWaitMs: 450 };
      }
      if (/\b(city|town|locality)\b/i.test(q)) {
        return { field, clubKind: 'ADDRESS_CASCADE', executionPriority: 30, postFillWaitMs: 200 };
      }
      if (/\b(postal|zip|pin\s*code)\b/i.test(q)) {
        return { field, clubKind: 'ADDRESS_CASCADE', executionPriority: 40, postFillWaitMs: 100 };
      }

      // 2. Phone Composite Clubbing (Country Code Dropdown = 15, National Number = 25)
      if (/\b(country code|phone code|dial code)\b/i.test(q)) {
        return { field, clubKind: 'PHONE_COMPOSITE', executionPriority: 15, postFillWaitMs: 300 };
      }
      if (/\b(phone|mobile|contact number|telephone)\b/i.test(q)) {
        return {
          field,
          clubKind: 'PHONE_COMPOSITE',
          executionPriority: 25,
          postFillWaitMs: 100,
          valueTransform: hasPhoneCountryDropdown ? 'strip_country_code' : undefined,
        };
      }

      // 3. Repeater Section Clubbing: Work Experience vs Education
      if (/\b(work experience|employment|professional experience|job\s*\d)\b/i.test(sec)) {
        return {
          field,
          clubKind: 'WORK_EXPERIENCE_BLOCK',
          executionPriority: 50,
          postFillWaitMs: 150,
          valueTransform: /\b(start|end|from|to|date)\b/i.test(q) ? 'force_work_dates' : undefined,
        };
      }
      if (/\b(education|university|academic|school|degree)\b/i.test(sec)) {
        return {
          field,
          clubKind: 'EDUCATION_BLOCK',
          executionPriority: 60,
          postFillWaitMs: 150,
          valueTransform: /\b(start|end|from|to|date|graduation)\b/i.test(q) ? 'force_edu_dates' : undefined,
        };
      }

      // 4. Compensation Clubbing (Currency first = 45, Amount second = 46)
      if (/\b(currency)\b/i.test(q)) {
        return { field, clubKind: 'COMPENSATION_COMPOSITE', executionPriority: 45, postFillWaitMs: 250 };
      }
      if (/\b(ctc|salary|compensation|pay expectation|remuneration)\b/i.test(q)) {
        return {
          field,
          clubKind: 'COMPENSATION_COMPOSITE',
          executionPriority: 46,
          postFillWaitMs: 100,
          valueTransform: 'lpa_vs_annual',
        };
      }

      return { field, clubKind: 'STANDALONE', executionPriority: 70, postFillWaitMs: 50 };
    })
    .sort((a, b) => a.executionPriority - b.executionPriority);
}

export function applyClubbedValueTransform(
  rawValue: string,
  plan: ClubbedFieldPlan
): string {
  if (!rawValue || typeof rawValue !== 'string') return rawValue || '';
  if (plan.valueTransform === 'strip_country_code') {
    // Strip leading +91 or 91 when a sibling country-code dropdown already selected +91
    return rawValue.replace(/^\+?91[\s-]*/, '').replace(/\s+/g, '');
  }
  if (plan.valueTransform === 'lpa_vs_annual') {
    const q = (plan.field?.questionText || '').toLowerCase();
    if (/\b(lpa|lakhs)\b/i.test(q) && Number(rawValue) > 100) return '12';
  }
  return rawValue;
}
