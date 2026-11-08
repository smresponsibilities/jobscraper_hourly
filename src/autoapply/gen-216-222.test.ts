import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  hasAntonymOrPolarityConflict,
  lookupQuestionIn1000Bank,
} from './portal-question-bank-1000.js';
import { translateCanonicalAnswerToOption } from './widgets.js';
import {
  loadDeadBoardSlugs,
  saveDeadBoardSlugs,
  DEAD_SLUGS_PATH,
} from '../../scripts/harvest-100-hourly-jobs.js';

test('GEN-216: hasAntonymOrPolarityConflict blocks opposite concepts in fuzzy matching', () => {
  // 1. First name vs Last name / Middle name
  assert.equal(
    hasAntonymOrPolarityConflict('applicant legal first name', 'applicant legal last name'),
    true
  );
  assert.equal(
    hasAntonymOrPolarityConflict('first name', 'middle name'),
    true
  );

  // 2. Current CTC vs Expected CTC
  assert.equal(
    hasAntonymOrPolarityConflict('what is your current annual ctc in lpa', 'what is your expected annual ctc in lpa'),
    true
  );
  assert.equal(
    hasAntonymOrPolarityConflict('current compensation', 'desired compensation'),
    true
  );

  // 3. Start date vs Graduation date
  assert.equal(
    hasAntonymOrPolarityConflict('start date', 'graduation date'),
    true
  );
  assert.equal(
    hasAntonymOrPolarityConflict('start month and year', 'passing month and year'),
    true
  );

  // 4. Positive polarity: non-conflicting terms should not trigger conflict
  assert.equal(
    hasAntonymOrPolarityConflict('first name', 'given name'),
    false
  );
  assert.equal(
    hasAntonymOrPolarityConflict('expected salary', 'desired salary'),
    false
  );

  // 5. Verify lookupQuestionIn1000Bank returns distinct answers
  const first = lookupQuestionIn1000Bank('Applicant legal first name');
  const last = lookupQuestionIn1000Bank('Applicant legal last name');
  assert.equal(first, 'Shivam');
  assert.equal(last, 'Mahajan');
  assert.notEqual(first, last);
});

test('GEN-217: translateCanonicalAnswerToOption correctly translates canonical values into portal dropdown options', () => {
  // 1. Experience (1 yr) -> "0-2 years"
  const expRes = translateCanonicalAnswerToOption('1', 'Total years of experience', [
    '0-2 years',
    '3-5 years',
    '5+ years',
  ]);
  assert.equal(expRes, '0-2 years');

  // 2. Notice Period ("Immediate") -> "0 - 15 Days"
  const noticeRes = translateCanonicalAnswerToOption('Immediate', 'Notice period in days', [
    '0 - 15 Days',
    '15 - 30 Days',
    '30 - 60 Days',
  ]);
  assert.equal(noticeRes, '0 - 15 Days');

  // 3. CGPA ("9.35") -> "> 9.0"
  const cgpaRes = translateCanonicalAnswerToOption('9.35', 'Undergraduate CGPA / GPA', [
    '> 9.0',
    '8.0 - 9.0',
    '7.0 - 8.0',
    '< 7.0',
  ]);
  assert.equal(cgpaRes, '> 9.0');

  // 4. Gender ("Male") -> "Man"
  const genderRes = translateCanonicalAnswerToOption('Male', 'Gender identity', [
    'Man',
    'Woman',
    'Non-binary',
    'Prefer not to disclose',
  ]);
  assert.equal(genderRes, 'Man');

  // 5. Degree ("Bachelor's Degree") -> "B.E. / B.Tech"
  const degreeRes = translateCanonicalAnswerToOption("Bachelor's Degree", 'Education level', [
    'High School Diploma',
    'B.E. / B.Tech',
    "Master's Degree",
  ]);
  assert.equal(degreeRes, 'B.E. / B.Tech');

  // 6. Work Auth ("Yes") -> verbose agreement
  const authRes = translateCanonicalAnswerToOption('Yes', 'Work authorization status', [
    'Authorized to work in India for any employer',
    'Requires visa sponsorship',
  ]);
  assert.ok(authRes && authRes.includes('Authorized'));
});

test('GEN-219 & GEN-220: harvest-100-hourly-jobs handles multi-locations and dead-slug quarantine', () => {
  // Check source code has Ashby secondaryLocations and Lever allLocations
  const harvestSrc = fs.readFileSync('scripts/harvest-100-hourly-jobs.ts', 'utf8');
  assert.ok(
    harvestSrc.includes('j.secondaryLocations'),
    'Ashby harvester must include j.secondaryLocations'
  );
  assert.ok(
    harvestSrc.includes('j.categories?.allLocations') || harvestSrc.includes('j.categories.allLocations'),
    'Lever harvester must include j.categories.allLocations'
  );
  assert.ok(
    harvestSrc.includes('offLocs') || harvestSrc.includes('j.offices'),
    'Greenhouse harvester must include j.offices'
  );
  assert.ok(
    harvestSrc.includes('dead-board-slugs.json'),
    'Harvester must maintain dead-board-slugs.json quarantine'
  );

  // Test dead slug loading and saving
  const testStore: Record<string, number> = {
    'greenhouse:fake-slug-404': Date.now(),
  };
  saveDeadBoardSlugs(testStore);
  const reloaded = loadDeadBoardSlugs();
  assert.ok(reloaded['greenhouse:fake-slug-404']);
});
