import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PORTAL_QUESTION_BANK_1000,
  lookupQuestionIn1000Bank,
} from './portal-question-bank-1000.js';
import { resolveExtendedPortalQuestionTaxonomy } from './answers.js';
import { resolveUniversalPermissiveFallback } from './permissive-fallback.js';

test('GEN-209 & GEN-210: companies.json contains >= 20,000 unique ATS boards and 0 isolated tenants', () => {
  assert.ok(fs.existsSync('companies.json'), 'companies.json must exist');
  const raw = JSON.parse(fs.readFileSync('companies.json', 'utf8'));
  const list: Array<Record<string, unknown>> = Array.isArray(raw) ? raw : raw.companies || [];

  assert.ok(
    list.length >= 20000,
    `companies.json must contain >= 20,000 boards (found ${list.length})`
  );

  const isolatedTenants = ['stripe', 'avoca', 'ssctech', 'paypal'];
  for (const item of list) {
    const slug = String(item.token || item.slug || item.board || item.id || '').toLowerCase();
    for (const isolated of isolatedTenants) {
      assert.notEqual(
        slug,
        isolated,
        `Isolated tenant "${isolated}" must not be present in companies.json`
      );
    }
  }

  // Check ATS diversity: greenhouse, ashby, lever, smartrecruiters, workday
  const atsSet = new Set(list.map((c) => String(c.ats || c.provider || '').toLowerCase()));
  assert.ok(atsSet.has('greenhouse'), 'Must include greenhouse');
  assert.ok(atsSet.has('ashby'), 'Must include ashby');
  assert.ok(atsSet.has('lever'), 'Must include lever');
  assert.ok(atsSet.has('smartrecruiters'), 'Must include smartrecruiters');
});

test('GEN-211 to GEN-214: PORTAL_QUESTION_BANK_1000 contains >= 1,000 explicit questions across all 25 domains', () => {
  assert.ok(
    PORTAL_QUESTION_BANK_1000.length >= 1000,
    `PORTAL_QUESTION_BANK_1000 must contain >= 1000 questions (found ${PORTAL_QUESTION_BANK_1000.length})`
  );

  const uniqueDomains = new Set(PORTAL_QUESTION_BANK_1000.map((q) => q.domain));
  assert.ok(
    uniqueDomains.size >= 25,
    `Must cover at least 25 canonical domains (found ${uniqueDomains.size})`
  );

  const expectedDomains = [
    'identity',
    'contact',
    'address',
    'mobility',
    'work_auth',
    'education',
    'grading',
    'employment',
    'compensation',
    'notice',
    'languages_matrix',
    'backend_distributed',
    'data_streaming',
    'ai_ml',
    'frontend_mobile',
    'devops_cloud',
    'conflict_interest',
    'export_control',
    'eeo',
    'referral',
    'india_compliance',
    'behavioral_essays',
    'technical_essays',
    'gdpr_privacy',
    'logistics',
  ];

  for (const dom of expectedDomains) {
    assert.ok(uniqueDomains.has(dom), `Missing canonical domain: ${dom}`);
  }
});

test('GEN-211 to GEN-214: lookupQuestionIn1000Bank resolves accurately across text, number, and choice widgets', () => {
  // 1. Identity & Personal Details
  assert.equal(lookupQuestionIn1000Bank('First Name'), 'Shivam');
  assert.equal(lookupQuestionIn1000Bank('Legal Last Name'), 'Mahajan');
  assert.equal(lookupQuestionIn1000Bank('Full Legal Name'), 'Shivam Mahajan');
  assert.equal(lookupQuestionIn1000Bank('Title / Salutation'), 'Mr.');
  assert.equal(lookupQuestionIn1000Bank('What is your nationality?'), 'Indian');
  assert.equal(lookupQuestionIn1000Bank('Are you 18 years of age or older?', 'radio'), 'Yes');

  // 2. Contact & Profiles
  assert.equal(lookupQuestionIn1000Bank('Mobile Phone'), '9876543210');
  assert.equal(lookupQuestionIn1000Bank('LinkedIn URL'), 'https://www.linkedin.com/in/mahajanshivam');
  assert.equal(lookupQuestionIn1000Bank('GitHub Profile'), 'https://github.com/smresponsibilities');
  assert.equal(lookupQuestionIn1000Bank('LeetCode URL'), 'https://github.com/smresponsibilities');
  assert.equal(lookupQuestionIn1000Bank('Personal Website'), 'https://shivammahajan.com');

  // 3. Address & Geo-Location
  assert.equal(lookupQuestionIn1000Bank('Current City'), 'Bengaluru');
  assert.equal(lookupQuestionIn1000Bank('State'), 'Karnataka');
  assert.equal(lookupQuestionIn1000Bank('Postal Code'), '560001');

  // 4. Mobility & Relocation
  assert.equal(lookupQuestionIn1000Bank('Are you willing to relocate?', 'radio'), 'Yes');
  assert.equal(lookupQuestionIn1000Bank('Can you work onsite 3 days a week?', 'radio'), 'Yes');
  assert.equal(lookupQuestionIn1000Bank('What is your current timezone?'), 'IST (UTC+5:30)');

  // 5. Work Auth & Immigration
  assert.equal(lookupQuestionIn1000Bank('Are you legally authorized to work in India?', 'radio'), 'Yes');
  assert.equal(lookupQuestionIn1000Bank('Will you now or in the future require visa sponsorship?', 'radio'), 'No');

  // 6 & 7. Education & Academic Grading
  assert.equal(lookupQuestionIn1000Bank('University'), 'Chitkara University');
  assert.equal(lookupQuestionIn1000Bank('Degree'), 'Bachelor of Engineering (B.E.)');
  assert.equal(lookupQuestionIn1000Bank('Graduation Year', 'number'), '2026');
  assert.equal(lookupQuestionIn1000Bank('Overall CGPA', 'number'), '9.35');
  assert.equal(lookupQuestionIn1000Bank('GPA on 4.0 scale', 'number'), '3.9');
  assert.equal(lookupQuestionIn1000Bank('Percentage marks obtained in 12th/Graduation', 'number'), '93.5');
  assert.equal(lookupQuestionIn1000Bank('Do you have any active backlogs?', 'number'), '0');

  // 8. Morgan Stanley Experience
  assert.equal(lookupQuestionIn1000Bank('Current Employer'), 'Morgan Stanley');
  assert.equal(lookupQuestionIn1000Bank('Current Job Title'), 'Technology Apprentice');
  assert.equal(lookupQuestionIn1000Bank('Total Years of Experience', 'number'), '1');

  // 9 & 10. Compensation & Notice Period
  assert.equal(lookupQuestionIn1000Bank('Current CTC', 'number'), '1000000');
  assert.equal(lookupQuestionIn1000Bank('Expected CTC', 'number'), '1200000');
  assert.equal(lookupQuestionIn1000Bank('Current CTC (in LPA)', 'number'), '10');
  assert.equal(lookupQuestionIn1000Bank('Expected CTC (in LPA)', 'number'), '12');
  assert.equal(lookupQuestionIn1000Bank('Notice Period', 'text'), 'Immediate');
  assert.equal(lookupQuestionIn1000Bank('Official notice period in days', 'number'), '0');

  // 11-16. Skill Matrix (Verified vs Unverified)
  assert.equal(lookupQuestionIn1000Bank('Do you have experience with Python?', 'radio'), 'Yes');
  assert.equal(lookupQuestionIn1000Bank('How many years of experience do you have with Java?', 'number'), '1');
  assert.equal(lookupQuestionIn1000Bank('Do you have experience with Apache Kafka?', 'radio'), 'Yes');
  assert.equal(lookupQuestionIn1000Bank('Do you have commercial experience with Ruby?', 'radio'), 'No');
  assert.equal(lookupQuestionIn1000Bank('How many years of experience do you have with Go?', 'number'), '0');

  // 17 & 18. Conflict of Interest & Export Control
  assert.equal(lookupQuestionIn1000Bank('Have you previously worked for this company?', 'radio'), 'No');
  assert.equal(lookupQuestionIn1000Bank('Are you a citizen of Cuba, Iran, or North Korea?', 'radio'), 'No');
  assert.equal(lookupQuestionIn1000Bank('Have you ever been convicted of a felony or criminal offense?', 'radio'), 'No');

  // 19 & 20. EEO & Referral
  assert.equal(lookupQuestionIn1000Bank('Gender', 'select'), 'Male');
  assert.equal(lookupQuestionIn1000Bank('Race / Ethnicity', 'select'), 'Asian');
  assert.equal(lookupQuestionIn1000Bank('How did you hear about us?', 'select'), 'LinkedIn');

  // 21. India Compliance
  assert.equal(lookupQuestionIn1000Bank('Do you have a valid PAN card?', 'radio'), 'Yes');

  // 22 & 23. Essays
  const essay = lookupQuestionIn1000Bank('What are the three most relevant ML research papers you have read recently?');
  assert.ok(essay && essay.includes('Morgan Stanley'));

  // 24. GDPR / Consent
  assert.equal(lookupQuestionIn1000Bank('Do you consent to background verification (BGV)?', 'radio'), 'Yes');

  // 25. Logistics
  assert.equal(lookupQuestionIn1000Bank('English Proficiency', 'select'), 'Fluent');
});

test('GEN-212: Integration with answers.ts and permissive-fallback.ts', () => {
  // Test via answers.ts resolveExtendedPortalQuestionTaxonomy
  const panAnswer = resolveExtendedPortalQuestionTaxonomy('Do you have a valid PAN card?', 'radio');
  assert.equal(panAnswer, 'Yes');

  const ctcAnswer = resolveExtendedPortalQuestionTaxonomy('Current CTC', 'number');
  assert.equal(ctcAnswer, '1000000');

  // Test via permissive-fallback.ts resolveUniversalPermissiveFallback
  const fbPan = resolveUniversalPermissiveFallback({
    questionText: 'Do you have a valid PAN card?',
    widgetKind: 'RADIO',
    options: ['Yes', 'No'],
  });
  assert.equal(fbPan, 'Yes');

  const fbNotice = resolveUniversalPermissiveFallback({
    questionText: 'Official notice period in days',
    widgetKind: 'NUMBER',
    options: null,
  });
  assert.equal(fbNotice, '0');
});
