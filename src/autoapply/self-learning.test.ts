import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  normalizeQuestionKey,
  inferAnswerFromOptionSignature,
  resolveBySemanticSelfLearning,
  recordLearnedSuccess,
  loadSemanticMemory,
  logUnknownFieldForLearning,
} from './self-learning.js';
import type { CandidateExtendedProfile } from './types.js';

const mockProfile: CandidateExtendedProfile = {
  personal: {
    firstName: 'Shivam',
    lastName: 'Mahajan',
    email: 'shivam@example.com',
    phone: '+919876543210',
    country: 'India',
    linkedinUrl: 'https://www.linkedin.com/in/shivam-mahajan',
    githubUrl: 'https://github.com/smresponsibilities',
  },
  education: [
    {
      school: 'Test Institute',
      degree: 'B.Tech',
      fieldOfStudy: 'Computer Science',
      graduationYear: '2026',
    },
  ],
  experience: [],
  professional: {
    totalYearsExperience: 1,
    noticePeriodDays: 0,
    currentSalary: 1000000,
    expectedSalary: 1200000,
    salaryCurrency: 'INR',
    willingToRelocate: true,
    workPreference: 'hybrid',
  },
};

test('normalizeQuestionKey removes punctuation and normalizes whitespace', () => {
  assert.equal(
    normalizeQuestionKey('What is your expected CTC? *(Required)'),
    'what is your expected ctc'
  );
  assert.equal(
    normalizeQuestionKey('Earliest Available Start Date / Notice Period (in days):'),
    'earliest available start date notice period in days'
  );
});

test('inferAnswerFromOptionSignature infers answers from option sets', () => {
  // Referral source
  const referral = inferAnswerFromOptionSignature('How did you hear about us?', [
    'LinkedIn',
    'Glassdoor',
    'Company Website',
    'Other',
  ]);
  assert.ok(referral);
  assert.equal(referral?.category, 'referral_source');
  assert.equal(referral?.value, 'Company Website');

  // Notice period
  const notice = inferAnswerFromOptionSignature('When can you start?', [
    'Immediate',
    '15 days',
    '30 days',
    '60 days',
  ]);
  assert.ok(notice);
  assert.equal(notice?.category, 'notice_period');
  assert.equal(notice?.value, 'Immediate');

  // Experience buckets
  const exp = inferAnswerFromOptionSignature('Relevant Experience:', [
    '0 - 1 years',
    '1 - 3 years',
    '3 - 5 years',
    '5+ years',
  ]);
  assert.ok(exp);
  assert.equal(exp?.category, 'total_experience');
  assert.equal(exp?.value, '0 - 1 years');

  // Degree
  const degree = inferAnswerFromOptionSignature('Highest Level of Education:', [
    'High School',
    'Bachelor of Engineering',
    'Master of Science',
    'Doctorate',
  ]);
  assert.ok(degree);
  assert.equal(degree?.category, 'degree');
  assert.equal(degree?.value, 'Bachelor of Engineering');

  // EEO decline
  const eeo = inferAnswerFromOptionSignature('Gender Identity', [
    'Female',
    'Male',
    'Non-Binary',
    'I do not wish to answer',
  ]);
  assert.ok(eeo);
  assert.equal(eeo?.category, 'eeo_decline');
  assert.equal(eeo?.value, 'I do not wish to answer');

  // Country
  const countryOptions = [
    'Afghanistan', 'Australia', 'Brazil', 'Canada', 'Denmark',
    'Egypt', 'France', 'Germany', 'Hungary', 'India',
    'Japan', 'Kenya', 'Mexico', 'Netherlands', 'Singapore', 'United States'
  ];
  const country = inferAnswerFromOptionSignature('Nationality', countryOptions);
  assert.ok(country);
  assert.equal(country?.category, 'country');
  assert.equal(country?.value, 'India');
});

test('resolveBySemanticSelfLearning resolves concept bags and self-heals validation errors', () => {
  // Concept bags
  const ctc = resolveBySemanticSelfLearning('Expected Annual Compensation / CTC', 'TEXT', null, null, mockProfile);
  assert.ok(ctc);
  assert.equal(ctc?.category, 'compensation_expectation');
  assert.match(ctc!.value, /12 LPA/);

  const numericCtc = resolveBySemanticSelfLearning('Target CTC (INR)', 'NUMBER', null, null, mockProfile);
  assert.ok(numericCtc);
  assert.equal(numericCtc?.category, 'compensation_expectation');
  assert.equal(numericCtc?.value, '1200000');

  const gpa = resolveBySemanticSelfLearning('Academic CGPA / Percentage', 'TEXT', null, null, mockProfile);
  assert.ok(gpa);
  assert.equal(gpa?.category, 'education_gpa_custom');
  assert.equal(gpa?.value, '9.35 / 10.0');

  const gradYear = resolveBySemanticSelfLearning('Year of Graduation (Batch)', 'TEXT', null, null, mockProfile);
  assert.ok(gradYear);
  assert.equal(gradYear?.category, 'graduation_year_custom');
  assert.equal(gradYear?.value, '2026');

  const pronouns = resolveBySemanticSelfLearning('Preferred Pronouns', 'TEXT', null, null, mockProfile);
  assert.ok(pronouns);
  assert.equal(pronouns?.category, 'pronouns_or_preferred_name');
  assert.equal(pronouns?.value, 'He/Him');

  // Validation error self-healing: URL
  const healedGithub = resolveBySemanticSelfLearning(
    'GitHub / Portfolio Repository',
    'TEXT',
    null,
    'Please enter a valid URL starting with http:// or https://',
    mockProfile
  );
  assert.ok(healedGithub);
  assert.equal(healedGithub?.category, 'healed_url');
  assert.equal(healedGithub?.value, 'https://github.com/smresponsibilities');

  const healedLinkedin = resolveBySemanticSelfLearning(
    'Professional Profile Link',
    'TEXT',
    null,
    'Must be a valid URL',
    mockProfile
  );
  assert.ok(healedLinkedin);
  assert.equal(healedLinkedin?.category, 'healed_url');
  assert.equal(healedLinkedin?.value, 'https://www.linkedin.com/in/shivam-mahajan');

  // Validation error self-healing: Numeric
  const healedNotice = resolveBySemanticSelfLearning(
    'Notice period days',
    'TEXT',
    null,
    'Must be a valid number or integer',
    mockProfile
  );
  assert.ok(healedNotice);
  assert.equal(healedNotice?.category, 'healed_notice_days');
  assert.equal(healedNotice?.value, '0');
});

test('recordLearnedSuccess persists and loads from semantic memory file', () => {
  const testMemoryFile = path.resolve('out/test-temp/test-semantic-memory.json');
  if (fs.existsSync(testMemoryFile)) fs.unlinkSync(testMemoryFile);

  recordLearnedSuccess(
    'What is your earliest joining date?',
    'notice_period_custom',
    'Immediate',
    0.85,
    testMemoryFile
  );

  const mem = loadSemanticMemory(testMemoryFile);
  assert.ok(mem['what is your earliest joining date']);
  assert.equal(mem['what is your earliest joining date'].resolvedValue, 'Immediate');
  assert.equal(mem['what is your earliest joining date'].successCount, 1);

  // Promoting again increases successCount and confidence
  recordLearnedSuccess(
    'What is your earliest joining date?',
    'notice_period_custom',
    'Immediate',
    0.85,
    testMemoryFile
  );

  const updatedMem = loadSemanticMemory(testMemoryFile);
  assert.equal(updatedMem['what is your earliest joining date'].successCount, 2);
  assert.ok(updatedMem['what is your earliest joining date'].confidence > 0.85);

  // resolveBySemanticSelfLearning picks up saved memory
  const resolved = resolveBySemanticSelfLearning(
    'What is your earliest joining date?',
    'TEXT',
    null,
    null,
    mockProfile,
    testMemoryFile
  );
  assert.ok(resolved);
  assert.equal(resolved?.value, 'Immediate');
});

test('logUnknownFieldForLearning persists and sorts by occurrences descending', () => {
  const testLedgerFile = path.resolve('out/test-temp/test-unknown-ledger.json');
  if (fs.existsSync(testLedgerFile)) fs.unlinkSync(testLedgerFile);

  logUnknownFieldForLearning(
    {
      questionText: 'Do you hold a TS/SCI clearance?',
      widgetKind: 'RADIO',
      isRequired: true,
      options: ['Yes', 'No'],
      company: 'DefenseCorp',
      url: 'https://example.com/job1',
    },
    testLedgerFile
  );

  logUnknownFieldForLearning(
    {
      questionText: 'What is your favourite programming language?',
      widgetKind: 'TEXT',
      isRequired: false,
      company: 'TechCorp',
      url: 'https://example.com/job2',
    },
    testLedgerFile
  );

  // Increment TS/SCI clearance occurrence
  logUnknownFieldForLearning(
    {
      questionText: 'Do you hold a TS/SCI clearance?',
      widgetKind: 'RADIO',
      isRequired: true,
      options: ['Yes', 'No'],
      company: 'AnotherCorp',
      url: 'https://example.com/job3',
    },
    testLedgerFile
  );

  const ledger: Record<string, any> = JSON.parse(fs.readFileSync(testLedgerFile, 'utf8'));
  const keys = Object.keys(ledger);
  assert.equal(keys.length, 2);
  // Highest occurrences should be first
  assert.equal(ledger[keys[0]!]!.signature, 'do you hold a ts sci clearance::RADIO');
  assert.equal(ledger[keys[0]!]!.occurrences, 2);
  assert.equal(ledger[keys[0]!]!.sampleCompanies.length, 2);
  assert.equal(ledger[keys[1]!]!.occurrences, 1);
});

test('inferAnswerFromOptionSignature handles boundary conditions and variants', () => {
  // Empty or null options
  assert.equal(inferAnswerFromOptionSignature('test', []), null);
  assert.equal(inferAnswerFromOptionSignature('test', null as any), null);

  // India with dial code in long country list
  const countryList = [
    'Albania', 'Belgium', 'Canada', 'Denmark', 'Estonia', 'Finland', 'Germany',
    'Hungary', 'Iceland', 'India (+91)', 'Japan', 'Kenya', 'Lithuania', 'Malaysia',
    'Norway', 'Portugal', 'Spain', 'Sweden'
  ];
  const indResult = inferAnswerFromOptionSignature('Country of residence', countryList);
  assert.ok(indResult);
  assert.equal(indResult?.category, 'country');
  assert.equal(indResult?.value, 'India (+91)');

  // Fresher option signature
  const fresherResult = inferAnswerFromOptionSignature('Total Work Experience', [
    'Fresher', '1-3 years', '3-5 years', '5+ years'
  ]);
  assert.ok(fresherResult);
  assert.equal(fresherResult?.category, 'total_experience');
  assert.equal(fresherResult?.value, 'Fresher');

  // Exact number matching does not falsely match '30 days' for '0'
  const noticeNumericMatch = resolveBySemanticSelfLearning(
    'Notice period required',
    'NUMBER',
    ['Immediate', '15 days', '30 days', '60 days'],
    null,
    mockProfile
  );
  assert.ok(noticeNumericMatch);
  assert.equal(noticeNumericMatch?.category, 'notice_period');
  assert.equal(noticeNumericMatch?.value, 'Immediate');

  // GPA numeric returns '9.35' rather than '9.35 / 10.0'
  const gpaNumeric = resolveBySemanticSelfLearning(
    'Cumulative GPA',
    'NUMBER',
    null,
    null,
    mockProfile
  );
  assert.ok(gpaNumeric);
  assert.equal(gpaNumeric?.value, '9.35');

  // Native Chromium URL validation message
  const nativeUrl = resolveBySemanticSelfLearning(
    'GitHub Link',
    'TEXT',
    null,
    'Please enter a URL.',
    mockProfile
  );
  assert.ok(nativeUrl);
  assert.equal(nativeUrl?.category, 'healed_url');
  assert.equal(nativeUrl?.value, 'https://github.com/smresponsibilities');

  // Native Chromium Number validation message
  const nativeNum = resolveBySemanticSelfLearning(
    'Cumulative Grade Point Average (CGPA)',
    'TEXT',
    null,
    'Please enter a number.',
    mockProfile
  );
  assert.ok(nativeNum);
  assert.equal(nativeNum?.category, 'healed_cgpa');
  assert.equal(nativeNum?.value, '9.35');

  // Month option signature (from Ashby/Workday forms like Tekion)
  const monthResult = inferAnswerFromOptionSignature('Start Month', [
    'Month...', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'
  ]);
  assert.ok(monthResult);
  assert.equal(monthResult?.category, 'date_month');
  assert.equal(monthResult?.value, 'June');

  // Year option signature
  const yearResult = inferAnswerFromOptionSignature('Graduation Year', [
    'Year...', '2023', '2024', '2025', '2026', '2027'
  ]);
  assert.ok(yearResult);
  assert.equal(yearResult?.category, 'date_year');
  assert.equal(yearResult?.value, '2026');

  // Work Authorization custom prompt
  const authCustom = resolveBySemanticSelfLearning(
    'Are you legally authorized to work in India?',
    'RADIO',
    ['Yes', 'No'],
    null,
    mockProfile
  );
  assert.ok(authCustom);
  assert.equal(authCustom?.category, 'work_authorization_custom');
  assert.equal(authCustom?.value, 'Yes');

  // Visa Sponsorship custom prompt
  const sponsorCustom = resolveBySemanticSelfLearning(
    'Will you now or in the future require visa sponsorship?',
    'RADIO',
    ['Yes', 'No'],
    null,
    mockProfile
  );
  assert.ok(sponsorCustom);
  assert.equal(sponsorCustom?.category, 'visa_sponsorship_custom');
  assert.equal(sponsorCustom?.value, 'No');

  // Gender options without decline
  const genderResult = inferAnswerFromOptionSignature('Gender', [
    'Male', 'Female', 'Non-Binary'
  ]);
  assert.ok(genderResult);
  assert.equal(genderResult?.category, 'gender');
  assert.equal(genderResult?.value, 'Male');

  // GEN-23: Australia work authorization option signature
  const ausResult = inferAnswerFromOptionSignature('What is your current work authorisation status in Australia?', [
    'Select...',
    'Australian Citizen',
    'Australian Permanent Resident / NZ Citizen',
    'Temporary visa with unrestricted full-time work rights (e.g. 482, 485)',
    'Temporary visa with limited work rights (e.g. Working Holiday, Student visa)',
    'I do not currently have Australian work rights'
  ]);
  assert.ok(ausResult);
  assert.equal(ausResult?.category, 'australia_work_rights');
  assert.equal(ausResult?.value, 'I do not currently have Australian work rights');

  // GEN-23: Name as per Aadhaar card
  const aadhaar = resolveBySemanticSelfLearning('Name as per Aadhaar card', 'TEXT', null, null, mockProfile);
  assert.ok(aadhaar);
  assert.equal(aadhaar?.category, 'legal_name_government_id');
  assert.equal(aadhaar?.value, 'Shivam Mahajan');

  // GEN-23: Total Years of Work Experience
  const yoe = resolveBySemanticSelfLearning('Total Years of Work Experience', 'TEXT', null, null, mockProfile);
  assert.ok(yoe);
  assert.equal(yoe?.category, 'total_experience_custom');
  assert.equal(yoe?.value, '1');

  // GEN-23: Commuting distance to Columbus, OH
  const commute = resolveBySemanticSelfLearning('Do you live within reasonable commuting distance to Columbus, OH?', 'RADIO', [
    'Yes',
    'No',
    'Not right now,  but I am willing to relocate'
  ], null, mockProfile);
  assert.ok(commute);
  assert.equal(commute?.category, 'commute_relocation');
  assert.match(commute?.value || '', /relocate/i);

  // GEN-23: Enterprise deal closing $1M+ contracts
  const deals = resolveBySemanticSelfLearning('Have you closed services contracts of $1M or more?', 'RADIO', ['Yes', 'No'], null, mockProfile);
  assert.ok(deals);
  assert.equal(deals?.category, 'disqualifying_affirmation_negative');
  assert.equal(deals?.value, 'No');

  // GEN-23: Located in US
  const locatedUs = resolveBySemanticSelfLearning('Are you currently located in the United States?', 'RADIO', ['Yes', 'No'], null, mockProfile);
  assert.ok(locatedUs);
  assert.equal(locatedUs?.category, 'disqualifying_affirmation_negative');
  assert.equal(locatedUs?.value, 'No');

  // GEN-23: Lever card textarea custom field
  const cardNarrative = resolveBySemanticSelfLearning('cards[2d8e4220-f41d-4474-9164-3b1e1033ba8a][field0]', 'TEXTAREA', null, null, mockProfile);
  assert.ok(cardNarrative);
  assert.equal(cardNarrative?.category, 'lever_custom_card_narrative');
  assert.match(cardNarrative?.value || '', /Morgan Stanley/i);

  // GEN-23: Salary ranges dropdown (Atomic)
  const salaryRange = inferAnswerFromOptionSignature('Please share with us your base salary expectations', [
    'Select...',
    '$50,000 - $70,000',
    '$70,001 - $90,000',
    '$90,001 - $110,000',
  ]);
  assert.ok(salaryRange);
  assert.equal(salaryRange?.category, 'salary_range_option');
  assert.equal(salaryRange?.value, '$50,000 - $70,000');

  // GEN-23: Indian State signature with diacritics
  const stateOption = inferAnswerFromOptionSignature('State*', [
    'Select One',
    'Delhi',
    'Goa',
    'Karnātaka',
    'Mahārāshtra',
  ]);
  assert.ok(stateOption);
  assert.equal(stateOption?.category, 'indian_state');
  assert.equal(stateOption?.value, 'Karnātaka');

  // GEN-23: Location selection dropdown
  const locSelect = inferAnswerFromOptionSignature('Which location are you applying for?', [
    'Select...',
    'United States',
    'Canada',
  ]);
  assert.ok(locSelect);
  assert.equal(locSelect?.category, 'location_selection');
  assert.equal(locSelect?.value, 'United States');

  // GEN-23: Tekion previous contractor or relation
  const tekion = resolveBySemanticSelfLearning('If you are presently working, or have worked in the past, as a contractor or consultant for Tekion, please provide details', 'TEXTAREA', null, null, mockProfile);
  assert.ok(tekion);
  assert.equal(tekion?.category, 'previous_employment_or_relation');
  assert.equal(tekion?.value, 'No');

  // GEN-23: Gaming industry experience
  const gaming = resolveBySemanticSelfLearning('How many years of gaming industry experience do you have?', 'TEXT', null, null, mockProfile);
  assert.ok(gaming);
  assert.equal(gaming?.category, 'specialized_industry_experience');
  assert.equal(gaming?.value, '0 years');

  // GEN-23: CCTC / ECTC
  const cctc = resolveBySemanticSelfLearning('What is your CCTC in LPA ?*', 'TEXT', null, null, mockProfile);
  assert.ok(cctc);
  assert.equal(cctc?.category, 'cctc_ectc_inr');
  assert.equal(cctc?.value, '12 LPA');

  // GEN-23: Offer in hand
  const offer = resolveBySemanticSelfLearning('Do you have any offer in hand?*', 'TEXT', null, null, mockProfile);
  assert.ok(offer);
  assert.equal(offer?.category, 'competing_offer_in_hand');
  assert.equal(offer?.value, 'No');

  // GEN-23: ITAR US citizen
  const itar = resolveBySemanticSelfLearning('Are you a U.S. citizen for ITAR?*', 'RADIO', ['Yes', 'No'], null, mockProfile);
  assert.ok(itar);
  assert.equal(itar?.category, 'disqualifying_affirmation_negative');
  assert.equal(itar?.value, 'No');

  // GEN-23: Raw yes/no input fallback
  const rawToggle = resolveBySemanticSelfLearning('Yes', 'INPUT', null, null, mockProfile);
  assert.ok(rawToggle);
  assert.equal(rawToggle?.category, 'binary_toggle_safe_default');
  assert.equal(rawToggle?.value, 'No');

  // GEN-23: Linkedln typo
  const linkedin = resolveBySemanticSelfLearning('Linkedln Profile*', 'TEXT', null, null, mockProfile);
  assert.ok(linkedin);
  assert.equal(linkedin?.category, 'linkedin_url_custom');
  assert.equal(linkedin?.value, 'https://www.linkedin.com/in/shivam-mahajan');

  // GEN-23: Scoped consulting AI solutions
  const aiConsulting = resolveBySemanticSelfLearning('Have you sold or scoped consulting engagements that included AI or agentic workflow solutions and personally led client conversations at the executive level about how these capabilities drive business value?', 'TEXTAREA', null, null, mockProfile);
  assert.ok(aiConsulting);
  assert.equal(aiConsulting?.category, 'consulting_ai_agentic_solutions');
  assert.match(aiConsulting?.value || '', /Morgan Stanley/);

  // GEN-23: Do you live in the United States
  const liveUs = resolveBySemanticSelfLearning('Do you live in the United States?✱', 'RADIO', ['Yes', 'No'], null, mockProfile);
  assert.ok(liveUs);
  assert.equal(liveUs?.category, 'disqualifying_affirmation_negative');
  assert.equal(liveUs?.value, 'No');

  // GEN-23: Do you have a bachelors degree (without apostrophe)
  const bachelors = resolveBySemanticSelfLearning('Do you have a bachelors degree?', 'RADIO', ['Yes', 'No'], null, mockProfile);
  assert.ok(bachelors);
  assert.equal(bachelors?.category, 'qualifying_affirmation_positive');
  assert.equal(bachelors?.value, 'Yes');

  // GEN-23: Checkbox negative safety: Tekion employee, female, restrictions
  const tekionCheck = resolveBySemanticSelfLearning('Are you currently a tekion employee if yes please apply via ashby s internal job board', 'CHECKBOX', null, null, mockProfile);
  assert.ok(tekionCheck);
  assert.equal(tekionCheck?.category, 'checkbox_negative');
  assert.equal(tekionCheck?.value, 'No');

  const femaleCheck = resolveBySemanticSelfLearning('Female', 'CHECKBOX', null, null, mockProfile);
  assert.ok(femaleCheck);
  assert.equal(femaleCheck?.category, 'checkbox_negative');
  assert.equal(femaleCheck?.value, 'No');

  const maleCheck = resolveBySemanticSelfLearning('Male', 'CHECKBOX', null, null, mockProfile);
  assert.ok(maleCheck);
  assert.equal(maleCheck?.category, 'checkbox_gender_male');
  assert.equal(maleCheck?.value, 'Yes');

  const shiftWork = resolveBySemanticSelfLearning('Are you willing to work in shift or in 24 7 environment?', 'TEXT', null, null, mockProfile);
  assert.ok(shiftWork);
  assert.equal(shiftWork?.category, 'shift_environment_affirmative');
  assert.equal(shiftWork?.value, 'Yes');

  const authRbac = resolveBySemanticSelfLearning('Do you have hands on experience with authorization concepts such as role based access control or fine grained permissions from work or projects?', 'TEXT', null, null, mockProfile);
  assert.ok(authRbac);
  assert.equal(authRbac?.category, 'authorization_rbac_experience');
  assert.match(authRbac?.value || '', /Role-Based Access Control/);

  // GEN-24: Recurring fields from ledger
  const alertFreq = resolveBySemanticSelfLearning('Select how often (in days) to receive an alert:', 'NUMBER', null, null, mockProfile);
  assert.ok(alertFreq);
  assert.equal(alertFreq?.category, 'job_alert_frequency_days');
  assert.equal(alertFreq?.value, '7');

  const locCity = resolveBySemanticSelfLearning('Location (City)*', 'INPUT', null, null, mockProfile);
  assert.ok(locCity);
  assert.equal(locCity?.category, 'current_or_preferred_location');
  assert.equal(locCity?.value, 'Bengaluru, India');

  const bfsiDomain = resolveBySemanticSelfLearning('Do you have Experience in Banking or BFSI Domain?*', 'TEXT', ['Yes', 'No'], null, mockProfile);
  assert.ok(bfsiDomain);
  assert.equal(bfsiDomain?.category, 'banking_bfsi_domain_affirmative');
  assert.equal(bfsiDomain?.value, 'Yes');

  const hadoopExp = resolveBySemanticSelfLearning('Do you have experience in Hadoop and scheduling services?', 'TEXT', null, null, mockProfile);
  assert.ok(hadoopExp);
  assert.equal(hadoopExp?.category, 'hadoop_scheduling_experience');
  assert.match(hadoopExp?.value || '', /Hadoop/);

  const canadaVisa = resolveBySemanticSelfLearning('Currently in Canada on a work permit/visa', 'INPUT', null, null, mockProfile);
  assert.ok(canadaVisa);
  assert.equal(canadaVisa?.category, 'canada_work_permit_negative');
  assert.equal(canadaVisa?.value, 'No');
});


