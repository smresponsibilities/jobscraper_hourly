import assert from 'node:assert/strict';
import { test } from 'node:test';
import { translateCanonicalAnswerToOption } from './widgets.js';
import { resolveCandidateAnswer } from './answers.js';
import { validateProfile } from './profile.js';
import { classifyAtsField } from './classifier.js';
import { matchBestOption } from './aihawk.js';
import type { CandidateExtendedProfile } from './types.js';

const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: { totalYearsExperience: 2, expectedSalary: 1500000, salaryCurrency: 'INR', noticePeriodDays: 14 }, education: [], experience: [], workAuthorization: { authorizedInCountry: true, requiresSponsorshipNowOrFuture: false, formerEmployee: false }, eeo: {}, skillYears: { Java: 1, JavaScript: 2, 'C++': 0.5 } } as unknown as CandidateExtendedProfile;
const context = { url: 'https://jobs.ashbyhq.com/company-x/job-a/application', country: 'India', question: '' };

test('owner-confirmed currency and shift facts are used only when present', () => {
  const candidate = { ...profile, confirmedFacts: { expectedAnnualUSD: 50000, expectedHourlyUSD: 25, lastMonthlyPayINR: 87000, lastAnnualPayINR: 1044000, shiftFlexibility: true, lastWorkingDate: '2026-08-10' } };
  const answer = (question: string) => resolveCandidateAnswer('unknown', candidate, { ...context, question });
  assert.equal(answer('What are your pay expectations in USD?').value, 50000);
  assert.equal(answer('What hourly rate are you requesting in USD?').value, 25);
  assert.equal(answer('What was your previous monthly salary?').value, 87000);
  assert.equal(answer('Are you willing to work US night shifts?').value, true);
  assert.equal(answer('What is your last working date?').value, '2026-08-10');
  assert.equal(resolveCandidateAnswer('unknown', profile, { ...context, question: 'What is your last working date?' }).value, undefined);
});

test('option lists alone do not prove unrelated facts or consent', () => {
  const candidate = { ...profile, recruitmentPrivacyConsent: true };
  const answer = (question: string, options: string[]) => resolveCandidateAnswer('unknown', candidate, { ...context, question, options }).value;
  assert.equal(answer('Have you been convicted?', ['Yes']), undefined);
  assert.equal(answer('Do you have OMS experience?', ['No OMS Experience']), undefined);
});

test('standard autocomplete identifies candidate fields without using verification codes', () => {
  assert.equal(classifyAtsField({ autocomplete: 'section-contact shipping given-name', label: 'Name' }).category, 'first_name');
  assert.equal(classifyAtsField({ autocomplete: 'email', label: 'Email' }).source, 'autocomplete');
  assert.equal(classifyAtsField({ autocomplete: 'one-time-code', label: 'Phone verification code' }).category, 'unknown');
  assert.equal(classifyAtsField({ autocomplete: 'email', label: 'Supervisor email' }).category, 'unknown');
  assert.notEqual(classifyAtsField({ autocomplete: 'email', label: 'Secondary email' }).source, 'autocomplete');
});

test('numeric ranges require one unambiguous matching option', () => {
  const options = [{ value: 'a', label: '0-2 years' }, { value: 'b', label: '3-5 years' }];
  assert.equal(matchBestOption(1, options)?.value, 'a');
  assert.equal(matchBestOption(3, options)?.value, 'b');
  assert.equal(matchBestOption(1, [{ value: 'a', label: '0-1 years' }, { value: 'b', label: '1-2 years' }]), null);
  assert.equal(matchBestOption(1, [{ value: '1', label: '0-1 years' }, { value: '2', label: '1-2 years' }]), null);
  assert.equal(matchBestOption(1, [{ value: 'a', label: '1' }, { value: 'b', label: '2+ years' }])?.value, 'a');
  assert.equal(matchBestOption(3, [{ value: 'a', label: 'Less than 3 years' }]), null);
});

test('former employer requires confirmed complete history and employer context', () => {
  const candidate = { ...profile, completeEmploymentHistory: true, experience: [{ company: 'Example Bank', title: 'Apprentice' }] } as CandidateExtendedProfile;
  const answer = (company?: string, question = 'Have you previously worked for this company?') => resolveCandidateAnswer('former_employee', candidate, { ...context, company, question }).value;
  assert.equal(answer('Example Bank India'), true);
  assert.equal(answer('Other Company'), false);
  assert.equal(answer(), undefined);
  assert.equal(answer('Example Bank', 'Have you never worked for this company?'), undefined);
  assert.equal(resolveCandidateAnswer('former_employee', { ...candidate, completeEmploymentHistory: false }, { ...context, company: 'Other Company', question: 'Have you previously worked here?' }).value, undefined);
});

test('observed prior employment wording uses confirmed history and employer scope', () => {
  const question = 'Have you previously been employed with us at any location? If yes, please provide details in the fields below. If no, please move on to the next section.';
  const candidate = { ...profile, completeEmploymentHistory: true, experience: [{ company: 'Example Bank', title: 'Apprentice' }] } as CandidateExtendedProfile;
  const category = classifyAtsField({ label: question }).category;
  assert.equal(category, 'former_employee');
  assert.equal(resolveCandidateAnswer(category, candidate, { ...context, company: 'Other Company', question }).value, false);
  assert.equal(resolveCandidateAnswer(category, candidate, { ...context, company: 'Example Bank', question }).value, true);
  assert.equal(resolveCandidateAnswer(category, { ...candidate, completeEmploymentHistory: false }, { ...context, company: 'Other Company', question }).value, undefined);
  assert.equal(resolveCandidateAnswer(category, candidate, { ...context, company: undefined, question }).value, undefined);
});

test('employment restriction questions are not classified as an employer name', () => {
  const label = 'Are you subject to any employment agreements and/or post-employment restrictions with your current employer or a past employer?';
  assert.notEqual(classifyAtsField({ label }).category, 'current_company');
  assert.equal(classifyAtsField({ label: 'Current employer' }).category, 'current_company');
});

test('current or previous employment uses only an unambiguous complete history', () => {
  const candidate = { ...profile, completeEmploymentHistory: true, experience: [{ company: 'Example Bank', title: 'Apprentice' }] } as CandidateExtendedProfile;
  const answer = (person: CandidateExtendedProfile, question: string) => resolveCandidateAnswer('unknown', person, { ...context, question }).value;
  assert.equal(answer(candidate, 'Who is your current or previous employer?'), 'Example Bank');
  assert.equal(answer(candidate, 'What is your current or previous job title?'), 'Apprentice');
  assert.equal(answer({ ...candidate, completeEmploymentHistory: false }, 'Who is your current or previous employer?'), undefined);
  assert.equal(answer({ ...candidate, experience: [...candidate.experience, candidate.experience[0]!] }, 'What is your current or previous job title?'), undefined);
  assert.equal(answer(candidate, 'Who is your current or previous employer in the United States?'), undefined);
  assert.equal(answer(candidate, 'Who is your previous supervisor?'), undefined);
});

test('phone type and salutation require explicit profile values', () => {
  const candidate = { ...profile, personal: { ...profile.personal, prefix: 'Mr.', phoneDeviceType: 'Mobile' } };
  assert.equal(resolveCandidateAnswer('unknown', candidate, { ...context, question: 'Salutation' }).value, 'Mr.');
  assert.equal(resolveCandidateAnswer('unknown', candidate, { ...context, question: 'Phone device type' }).value, 'Mobile');
  assert.equal(resolveCandidateAnswer('unknown', profile, { ...context, question: 'Phone device type' }).value, undefined);
});

test('confirmed preferences answer only the matching language, geography and paid terms', () => {
  const candidate = { ...profile, applicationPreferences: {
    citizenship: 'Indian', spokenLanguages: ['Hindi', 'English'], languageProficiency: { Hindi: 'native', English: 'native', French: 'none' },
    relocationCountries: ['India'], travelCountries: ['India'], businessTravel: true, nightShifts: true, weekendWork: true,
    employmentTypes: ['full-time', 'internship', 'contract'], paidRolesOnly: true,
    annualSalaryRangeINR: { minimum: 1200000, maximum: 1500000 }, noExperienceWith: ['FIX protocol', 'accounting/ERP software', 'payments products', 'Selenium'],
  } } as any;
  const answer = (question: string, extra: object = {}) => resolveCandidateAnswer('unknown', candidate, { ...context, question, ...extra }).value;
  assert.equal(answer('Which accounting/ERP systems have you used for working with financial data?', { options: ['SAP', 'None of the above'] }), 'None of the above');
  assert.equal(answer('Which accounting/ERP systems have you used for working with financial data?', { fieldType: 'checkbox' }), undefined);
  assert.equal(answer('What years of experience in Java with Selenium do you have?', { fieldType: 'number' }), 0);
  assert.equal(answer('Do you have experience with the FIX protocol?'), false);
  assert.equal(answer('Comment évalueriez-vous votre maîtrise du français?', { options: ['Aucune connaissance – Je ne parle pas le français.', 'Natif – Le français est ma langue maternelle.'] }), 'Aucune connaissance – Je ne parle pas le français.');
  assert.equal(answer('Comment évalueriez-vous votre maîtrise de l’anglais?', { options: ['Aucune connaissance – Je ne parle pas anglais.', 'Natif – L’anglais est ma langue maternelle.'] }), 'Natif – L’anglais est ma langue maternelle.');
  assert.equal(answer('What is your English proficiency?', { options: ['Native / Bilingual', 'Beginner'] }), 'Native / Bilingual');
  assert.equal(answer('Can you speak French?'), false);
  assert.equal(answer('What is your citizenship?'), 'Indian');
  assert.equal(answer('Are you willing to work night shifts?'), true);
  assert.equal(answer('Can you travel internationally?'), false);
  assert.equal(answer('Can you travel within India?'), true);
  assert.equal(answer('Are you willing to relocate?'), undefined);
  assert.equal(answer('Are you willing to relocate?', { location: 'Bengaluru, India' }), true);
  assert.equal(answer('Are you willing to relocate to London?'), false);
  assert.equal(answer('What is your expected salary?'), '12–15 LPA annually (INR)');
  assert.equal(answer('What is your expected internship stipend?'), undefined);
  assert.equal(answer('Are you open to a paid internship?'), true);
  assert.equal(answer('Are you open to an unpaid internship?'), false);
  assert.equal(answer('Are you open to an internship?'), undefined);
  assert.equal(answer('What is your expected salary in USD per hour?'), undefined);
  assert.equal(answer('Have you used Selenium?', { options: ['Yes', 'No'] }), 'No');
  assert.equal(answer('Do you consent to waive legal rights?'), undefined);
  assert.equal(translateCanonicalAnswerToOption('5', 'Years of experience', ['0–1 years', '1–2 years']), null);
  assert.equal(translateCanonicalAnswerToOption('No', 'Do you need sponsorship?', ['Yes', 'No']), 'No');
});

test('Snowflake professional option requires experience and an explicit matching choice', () => {
  const candidate = { ...profile, skillYears: { Snowflake: 1 }, experience: [{ company: 'Fixture', description: 'Used Snowflake professionally' }] } as any;
  const question = 'Which of the following best describes your experience with Snowflake?';
  const answer = resolveCandidateAnswer('unknown', candidate, { ...context, question, options: ['No experience using Snowflake', 'Professional-level experience', 'Advanced user with extensive professional experience'] });
  assert.equal(answer.value, 'Professional-level experience');
  assert.deepEqual(answer.sourceFactKeys, ['skillYears.Snowflake', 'experience.0']);
  assert.equal(resolveCandidateAnswer('unknown', { ...candidate, experience: [] }, { ...context, question, options: ['Professional-level experience'] }).value, undefined);
});

test('owner-requested blank fields do not receive website fallback values', () => {
  const candidate = { ...profile, personal: { ...profile.personal, website: 'https://example.test' }, applicationPreferences: { skipOptionalQuestions: ['Facebook', 'X (fka Twitter)'] } } as any;
  assert.equal(resolveCandidateAnswer('website', candidate, { ...context, question: 'Facebook' }).value, undefined);
  assert.equal(resolveCandidateAnswer('website', candidate, { ...context, question: 'X (fka Twitter)' }).value, undefined);
});

test('confirmed declarations do not answer inverted or unrelated questions', () => {
  const candidate = { ...profile, declarations: { backgroundCheckConsent: true, talentPoolConsent: true, termsAndAccuracyConsent: true, relativesAtCompany: false } };
  const answer = (question: string) => resolveCandidateAnswer('unknown', candidate, { ...context, question }).value;
  assert.equal(answer('Do you consent to a background check?'), true);
  assert.equal(answer('Do you consent to join our talent pool?'), true);
  assert.equal(answer('Do any relatives work at this company?'), false);
  assert.equal(answer('I accept the terms and conditions'), true);
  assert.equal(answer('I accept the terms and conditions and waive employment rights'), undefined);
  assert.equal(answer('Do you not consent to a background check?'), undefined);
  assert.equal(answer('Do your relatives work for a competitor?'), undefined);
});

test('authorization and sponsorship polarity use explicit jurisdiction facts', () => {
  const answer = (category: 'work_authorization' | 'sponsorship', question: string) => resolveCandidateAnswer(category, profile, { ...context, question }).value;
  assert.equal(answer('work_authorization', 'Are you legally authorized to work in India?'), true);
  assert.equal(answer('sponsorship', 'Will you now or in the future require visa sponsorship to work in India?'), false);
  assert.equal(answer('sponsorship', 'Are you legally authorized to work without visa sponsorship?'), true);
  assert.equal(answer('sponsorship', 'Do you not require visa sponsorship?'), true);
  assert.equal(answer('work_authorization', 'Are you authorized to work in the United States?'), undefined);
  const indiaOnly = { ...profile, indiaOnlyWorkAuthorization: true };
  assert.equal(resolveCandidateAnswer('work_authorization', indiaOnly, { ...context, question: 'Are you authorized to work outside India?' }).value, false);
  assert.equal(resolveCandidateAnswer('work_authorization', indiaOnly, { ...context, question: 'Are you authorized to work in the United States?' }).value, false);
  assert.equal(resolveCandidateAnswer('sponsorship', indiaOnly, { ...context, question: 'Do you need sponsorship to work outside India?' }).value, true);
});

test('skill experience distinguishes Java, JavaScript, C and C++ without borrowing total experience', () => {
  const answer = (question: string) => resolveCandidateAnswer('total_experience', profile, { ...context, question }).value;
  assert.equal(answer('Years of experience with Java?'), 1);
  assert.equal(answer('Years of experience with JavaScript?'), 2);
  assert.equal(answer('Years of experience with C++?'), 0.5);
  assert.equal(answer('Years of experience with C?'), undefined);
  assert.equal(answer('Years of experience with Rust?'), undefined);
  const certified = { ...profile, unlistedSkillYears: 0 };
  assert.equal(resolveCandidateAnswer('total_experience', certified, { ...context, question: 'Years of experience with Rust?' }).value, 0);
  assert.equal(resolveCandidateAnswer('total_experience', certified, { ...context, question: 'Years of experience with Java and Rust?' }).value, undefined);
  assert.equal(resolveCandidateAnswer('total_experience', certified, { ...context, question: 'Years of experience in software engineering?' }).value, undefined);
});

test('salary and notice answers retain exact units and reject unsupported currency/hour conversions', () => {
  const answer = (question: string) => resolveCandidateAnswer('expected_salary', profile, { ...context, question }).value;
  assert.equal(answer('Expected CTC in LPA?'), 15);
  assert.equal(answer('Expected annual compensation in INR?'), 1500000);
  assert.equal(answer('Expected monthly compensation in INR?'), 125000);
  assert.equal(answer('Expected compensation in annual USD?'), undefined);
  assert.equal(answer('Expected hourly rate?'), undefined);
  assert.equal(resolveCandidateAnswer('notice_period', profile, { ...context, question: 'Notice period in days?', fieldType: 'number' }).value, 14);
  assert.equal(resolveCandidateAnswer('notice_period', profile, { ...context, question: 'Notice period in weeks?' }).value, 2);
});

test('employer and jurisdiction scopes cannot leak into the next application', () => {
  const candidate: CandidateExtendedProfile = { ...profile, answers: [
    { question: 'Why do you want to work here?', value: 'Company X specific response', scope: 'EMPLOYER_SCOPED', employerKey: 'ashby:company-x' },
    { question: 'Privacy consent', value: true, scope: 'EMPLOYER_SCOPED', requisitionKey: 'ashby:company-x:job-a' },
    { question: 'Country-specific declaration', value: false, scope: 'JURISDICTION_SCOPED', country: 'India' },
  ] };
  validateProfile(candidate);
  assert.equal(resolveCandidateAnswer('unknown', candidate, { ...context, question: 'Why do you want to work here?' }).value, 'Company X specific response');
  assert.equal(resolveCandidateAnswer('unknown', candidate, { ...context, url: 'https://jobs.ashbyhq.com/company-y/job-b', question: 'Why do you want to work here?' }).value, undefined);
  assert.equal(resolveCandidateAnswer('unknown', candidate, { ...context, url: 'https://jobs.ashbyhq.com/company-x/job-b', question: 'Privacy consent' }).value, undefined);
  assert.equal(resolveCandidateAnswer('unknown', candidate, { ...context, country: 'United States', question: 'Country-specific declaration' }).value, undefined);
  assert.equal(resolveCandidateAnswer('former_employee', profile, { ...context, question: 'Have you worked for Company Y?' }).value, undefined);
});

test('conflicting saved answers and unscoped sensitive legacy entries fail closed', () => {
  const candidate = { ...profile, qaBank: { smsConsent: true, 'Years of experience with Java': '1' }, answers: [
    { scope: 'EMPLOYER_SCOPED' as const, employerKey: 'ashby:company-x', question: 'Privacy consent', value: true },
    { scope: 'EMPLOYER_SCOPED' as const, employerKey: 'ashby:company-x', question: 'Privacy consent', value: false },
  ] };
  assert.equal(resolveCandidateAnswer('unknown', candidate, { ...context, question: 'Privacy consent' }).reason, 'conflicting_saved_answers');
  assert.equal(resolveCandidateAnswer('unknown', candidate, { ...context, question: 'Receive messages?', aliases: ['smsConsent'] }).value, undefined);
});
