import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveCandidateAnswer } from './answers.js';
import { validateProfile } from './profile.js';
import { classifyAtsField } from './classifier.js';
import { matchBestOption } from './aihawk.js';
import type { CandidateExtendedProfile } from './types.js';

const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: { totalYearsExperience: 2, expectedSalary: 1500000, salaryCurrency: 'INR', noticePeriodDays: 14 }, education: [], experience: [], workAuthorization: { authorizedInCountry: true, requiresSponsorshipNowOrFuture: false, formerEmployee: false }, eeo: {}, skillYears: { Java: 1, JavaScript: 2, 'C++': 0.5 } } as unknown as CandidateExtendedProfile;
const context = { url: 'https://jobs.ashbyhq.com/company-x/job-a/application', country: 'India', question: '' };

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
