import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { CandidateExtendedProfile } from './types.js';
import { loadDotEnvIntoProcess } from './env-credentials.js';

// The profile is an external input, including files imported by the extension.
export function validateProfile(value: unknown): asserts value is CandidateExtendedProfile {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!object(value)) throw new Error('Profile must be an object');
  if (value.recruitmentPrivacyConsent !== undefined && typeof value.recruitmentPrivacyConsent !== 'boolean') throw new Error('recruitmentPrivacyConsent must be boolean');
  if (value.adult !== undefined && typeof value.adult !== 'boolean') throw new Error('adult must be boolean');
  if (value.unlistedSkillYears !== undefined && (typeof value.unlistedSkillYears !== 'number' || !Number.isFinite(value.unlistedSkillYears) || value.unlistedSkillYears < 0)) throw new Error('unlistedSkillYears must be a nonnegative number');
  if (value.completeEmploymentHistory !== undefined && typeof value.completeEmploymentHistory !== 'boolean') throw new Error('completeEmploymentHistory must be boolean');
  if (value.indiaOnlyWorkAuthorization !== undefined && typeof value.indiaOnlyWorkAuthorization !== 'boolean') throw new Error('indiaOnlyWorkAuthorization must be boolean');
  if (value.applicationPreferences !== undefined) {
    const prefs = value.applicationPreferences;
    if (!object(prefs)) throw new Error('applicationPreferences must be an object');
    for (const key of ['workCountries', 'relocationCountries', 'spokenLanguages', 'employmentTypes', 'travelCountries', 'noExperienceWith', 'skipOptionalQuestions']) {
      if (prefs[key] !== undefined && (!Array.isArray(prefs[key]) || (prefs[key] as unknown[]).some(item => typeof item !== 'string' || !item.trim()))) throw new Error(`applicationPreferences.${key} must contain nonempty text`);
    }
    for (const key of ['languageProficiencyLevelsProvided', 'paidRolesOnly', 'nightShifts', 'weekendWork', 'businessTravel', 'recruitmentDataProcessingConsent', 'backgroundCheckConsent', 'marketingConsent']) {
      if (prefs[key] !== undefined && typeof prefs[key] !== 'boolean') throw new Error(`applicationPreferences.${key} must be boolean`);
    }
    if (prefs.citizenship !== undefined && typeof prefs.citizenship !== 'string') throw new Error('applicationPreferences.citizenship must be text');
    if (prefs.demographicDisclosure !== undefined && prefs.demographicDisclosure !== 'prefer_not_to_disclose') throw new Error('Invalid demographic disclosure preference');
    if (prefs.languageProficiency !== undefined && (!object(prefs.languageProficiency) || Object.entries(prefs.languageProficiency).some(([language, level]) => !language.trim() || !['native', 'none'].includes(String(level))))) throw new Error('Invalid language proficiency');
    if (prefs.annualSalaryRangeINR !== undefined) {
      const range = prefs.annualSalaryRangeINR;
      if (!object(range) || typeof range.minimum !== 'number' || typeof range.maximum !== 'number' || !Number.isFinite(range.minimum) || !Number.isFinite(range.maximum) || range.minimum < 0 || range.maximum < range.minimum) throw new Error('Invalid annual INR salary range');
    }
  }
  if (value.declarations !== undefined && (!object(value.declarations) || Object.entries(value.declarations).some(([key, answer]) => !['termsAndAccuracyConsent', 'talentPoolConsent', 'backgroundCheckConsent', 'relativesAtCompany', 'governmentOfficial', 'big4Auditor'].includes(key) || typeof answer !== 'boolean'))) throw new Error('Invalid declarations');
  for (const key of ['personal', 'professional', 'workAuthorization', 'eeo']) {
    if (!object(value[key])) throw new Error(`Profile.${key} must be an object`);
  }
  const p = value.personal as Record<string, unknown>;
  if (typeof p.firstName !== 'string' || !p.firstName.trim() || typeof p.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) {
    throw new Error('Provide a first name and valid email');
  }
  const booleans = new Set(['willingToRelocate', 'authorizedInCountry', 'requiresSponsorshipNowOrFuture', 'formerEmployee', 'hasNonCompete', 'hasSecurityClearance', 'felonyConviction', 'isHispanicLatino', 'current']);
  const numbers = new Set(['age', 'totalYearsExperience', 'noticePeriodDays', 'currentSalary', 'expectedSalary']);
  function checkFields(v: Record<string, unknown>, label: string) {
    for (const [key, item] of Object.entries(v)) {
      if (item === undefined) continue;
      if (label === 'professional' && key === 'officeAttendance') {
        if (!object(item) || typeof item.city !== 'string' || !item.city.trim() || !Number.isInteger(item.maxDaysPerWeek) || Number(item.maxDaysPerWeek) < 1 || Number(item.maxDaysPerWeek) > 7 || Object.keys(item).some(key => !['city', 'maxDaysPerWeek'].includes(key))) throw new Error('professional.officeAttendance requires city and days from 1 to 7');
      } else if (booleans.has(key)) {
        if (typeof item !== 'boolean') throw new Error(`${label}.${key} must be boolean or omitted`);
      } else if (numbers.has(key)) {
        if (typeof item !== 'number' || !Number.isFinite(item) || item < 0) throw new Error(`${label}.${key} must be a nonnegative number`);
      } else if (typeof item !== 'string') throw new Error(`${label}.${key} must be text or omitted`);
    }
  }
  for (const key of ['personal', 'professional', 'workAuthorization', 'eeo']) checkFields(value[key] as Record<string, unknown>, key);
  for (const key of ['education', 'experience']) {
    if (!Array.isArray(value[key])) throw new Error(`Profile.${key} must be an array`);
    for (const entry of value[key]) {
      if (!object(entry)) throw new Error(`Profile.${key} entries must be objects`);
      checkFields(entry, key);
    }
  }
  if (value.skills !== undefined && (!Array.isArray(value.skills) || value.skills.some(skill => typeof skill !== 'string' || !skill.trim()))) throw new Error('skills must be an array of nonempty text');
  if (value.referralSources !== undefined && (!Array.isArray(value.referralSources) || value.referralSources.some(source => typeof source !== 'string' || !source.trim()))) throw new Error('referralSources must be an array of nonempty text');
  if (value.coverLetterText !== undefined && typeof value.coverLetterText !== 'string') throw new Error('coverLetterText must be text');
  if (value.skillYears !== undefined) {
    if (!object(value.skillYears) || Object.entries(value.skillYears).some(([key, years]) => !key.trim() || typeof years !== 'number' || !Number.isFinite(years) || years < 0)) throw new Error('skillYears requires skill names and nonnegative numeric years');
  }
  if (value.answers !== undefined) {
    if (!Array.isArray(value.answers)) throw new Error('answers must be an array');
    for (const answer of value.answers) {
      if (!object(answer) || typeof answer.question !== 'string' || !answer.question.trim() || !['string', 'boolean', 'number'].includes(typeof answer.value) || (typeof answer.value === 'number' && !Number.isFinite(answer.value)) || !['GLOBAL_FACT', 'JURISDICTION_SCOPED', 'EMPLOYER_SCOPED'].includes(String(answer.scope))) throw new Error('Invalid scoped answer');
      if (answer.scope === 'JURISDICTION_SCOPED' && (typeof answer.country !== 'string' || !answer.country.trim())) throw new Error('Jurisdiction answer requires country');
      if (answer.scope === 'EMPLOYER_SCOPED' && !(typeof answer.employerKey === 'string' && answer.employerKey.trim()) && !(typeof answer.requisitionKey === 'string' && answer.requisitionKey.trim())) throw new Error('Employer answer requires employerKey or requisitionKey');
    }
  }
  if (value.workAuthorizationByCountry !== undefined) {
    if (!object(value.workAuthorizationByCountry)) throw new Error('workAuthorizationByCountry must be an object');
    for (const [country, authorization] of Object.entries(value.workAuthorizationByCountry)) {
      if (!country.trim() || !object(authorization) || Object.entries(authorization).some(([key, answer]) => !['authorizedInCountry', 'requiresSponsorshipNowOrFuture'].includes(key) || typeof answer !== 'boolean')) throw new Error('Invalid jurisdiction work authorization');
    }
  }
  for (const key of ['qaBank', 'documents']) {
    if (value[key] !== undefined) {
      if (!object(value[key])) throw new Error(`Profile.${key} must be an object`);
      for (const [name, answer] of Object.entries(value[key])) {
        if (!name.trim() || (typeof answer !== 'string' && !(key === 'qaBank' && typeof answer === 'boolean'))) throw new Error(`Profile.${key} requires nonempty keys and ${key === 'qaBank' ? 'text or boolean' : 'text'} values`);
      }
    }
  }
  const professional = value.professional as Record<string, unknown>;
  if (professional.workPreference !== undefined && !['remote', 'hybrid', 'onsite'].includes(String(professional.workPreference))) {
    throw new Error('workPreference must be remote, hybrid or onsite');
  }
}

export function loadProfile(file: string): CandidateExtendedProfile {
  loadDotEnvIntoProcess();
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const p = value as any;
  if (p && p.personal) {
    if (!p.personal.email && (process.env.AUTOAPPLY_EMAIL || process.env.IMAP_USER)) {
      p.personal.email = (process.env.AUTOAPPLY_EMAIL || process.env.IMAP_USER)!.trim();
    }
    if (!p.personal.phone && (process.env.AUTOAPPLY_PHONE || process.env.PHONE)) {
      p.personal.phone = process.env.AUTOAPPLY_PHONE || process.env.PHONE;
    }
    if (!p.personal.phoneCountryCode && (process.env.AUTOAPPLY_PHONE_COUNTRY_CODE || process.env.PHONE_COUNTRY_CODE)) {
      p.personal.phoneCountryCode = process.env.AUTOAPPLY_PHONE_COUNTRY_CODE || process.env.PHONE_COUNTRY_CODE;
    }
  }
  validateProfile(value);
  for (const [kind, document] of Object.entries(value.documents || {})) {
    const fullPath = path.resolve(path.dirname(file), document);
    if (!statSync(fullPath).isFile()) throw new Error(`${kind} must refer to a file`);
    value.documents![kind as 'resume' | 'coverLetter'] = fullPath;
  }
  return value;
}
