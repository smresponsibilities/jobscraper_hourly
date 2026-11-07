import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildCoordinatedFillPlan,
  applyClubbedValueTransform,
  type ClubbedFieldPlan,
} from './clubbing.js';
import type { DistilledField } from './distiller.js';

function createMockField(overrides: Partial<DistilledField>): DistilledField {
  return {
    refKey: 'mock_key',
    widgetKind: 'TEXT',
    questionText: 'Mock Question',
    sectionHeading: '',
    isRequired: true,
    isFilled: false,
    currentValue: '',
    options: [],
    validationError: null,
    containerSelector: '',
    controlSelector: '',
    ...overrides,
  };
}

test('buildCoordinatedFillPlan prioritizes address cascading in exact dependency order', () => {
  const fields: DistilledField[] = [
    createMockField({ refKey: 'zip', questionText: 'Postal code / Zip Code', sectionHeading: 'Address' }),
    createMockField({ refKey: 'city', questionText: 'City / Locality', sectionHeading: 'Address' }),
    createMockField({ refKey: 'country', questionText: 'Country / Region', sectionHeading: 'Address' }),
    createMockField({ refKey: 'state', questionText: 'State / Province', sectionHeading: 'Address' }),
  ];

  const plan = buildCoordinatedFillPlan(fields);
  const orderedKeys = plan.map(p => p.field.refKey);

  // Address cascade order: Country (10) -> State (20) -> City (30) -> Postal/Zip (40)
  assert.deepEqual(orderedKeys, ['country', 'state', 'city', 'zip']);

  const countryPlan = plan.find(p => p.field.refKey === 'country')!;
  assert.equal(countryPlan.clubKind, 'ADDRESS_CASCADE');
  assert.equal(countryPlan.executionPriority, 10);
  assert.equal(countryPlan.postFillWaitMs, 700);

  const statePlan = plan.find(p => p.field.refKey === 'state')!;
  assert.equal(statePlan.clubKind, 'ADDRESS_CASCADE');
  assert.equal(statePlan.executionPriority, 20);
  assert.equal(statePlan.postFillWaitMs, 450);

  const cityPlan = plan.find(p => p.field.refKey === 'city')!;
  assert.equal(cityPlan.clubKind, 'ADDRESS_CASCADE');
  assert.equal(cityPlan.executionPriority, 30);
  assert.equal(cityPlan.postFillWaitMs, 200);

  const zipPlan = plan.find(p => p.field.refKey === 'zip')!;
  assert.equal(zipPlan.clubKind, 'ADDRESS_CASCADE');
  assert.equal(zipPlan.executionPriority, 40);
  assert.equal(zipPlan.postFillWaitMs, 100);
});

test('buildCoordinatedFillPlan clubs phone controls and strips country code when dropdown exists', () => {
  const fieldsWithDropdown: DistilledField[] = [
    createMockField({
      refKey: 'phone_num',
      questionText: 'Mobile Phone Number',
      sectionHeading: 'Contact',
    }),
    createMockField({
      refKey: 'phone_dial_code',
      widgetKind: 'SINGLE_SELECT',
      questionText: 'Phone Country Code',
      sectionHeading: 'Contact',
      options: ['+91', '+1', '+44'],
    }),
  ];

  const plan = buildCoordinatedFillPlan(fieldsWithDropdown);
  assert.equal(plan[0].field.refKey, 'phone_dial_code');
  assert.equal(plan[0].clubKind, 'PHONE_COMPOSITE');
  assert.equal(plan[0].executionPriority, 15);
  assert.equal(plan[0].postFillWaitMs, 300);

  assert.equal(plan[1].field.refKey, 'phone_num');
  assert.equal(plan[1].clubKind, 'PHONE_COMPOSITE');
  assert.equal(plan[1].executionPriority, 25);
  assert.equal(plan[1].valueTransform, 'strip_country_code');

  // Verify applyClubbedValueTransform strips +91 and spaces
  const transformed = applyClubbedValueTransform('+91 9000000000', plan[1]);
  assert.equal(transformed, '9000000000');

  const transformedPlain = applyClubbedValueTransform('91 9000000000', plan[1]);
  assert.equal(transformedPlain, '9000000000');
});

test('buildCoordinatedFillPlan preserves phone number without country code dropdown', () => {
  const fieldsWithoutDropdown: DistilledField[] = [
    createMockField({
      refKey: 'phone_num',
      questionText: 'Mobile Phone Number',
      sectionHeading: 'Contact',
    }),
  ];

  const plan = buildCoordinatedFillPlan(fieldsWithoutDropdown);
  assert.equal(plan[0].field.refKey, 'phone_num');
  assert.equal(plan[0].valueTransform, undefined);

  const val = applyClubbedValueTransform('+91 9000000000', plan[0]);
  assert.equal(val, '+91 9000000000');
});

test('buildCoordinatedFillPlan coordinates compensation fields and applies lpa_vs_annual transform', () => {
  const fields: DistilledField[] = [
    createMockField({
      refKey: 'salary_amt',
      questionText: 'Expected CTC / Salary (in LPA or Lakhs)',
      sectionHeading: 'Compensation',
    }),
    createMockField({
      refKey: 'salary_curr',
      questionText: 'Currency',
      sectionHeading: 'Compensation',
    }),
  ];

  const plan = buildCoordinatedFillPlan(fields);
  // Currency (45) before Amount (46)
  assert.equal(plan[0].field.refKey, 'salary_curr');
  assert.equal(plan[0].clubKind, 'COMPENSATION_COMPOSITE');
  assert.equal(plan[0].executionPriority, 45);

  assert.equal(plan[1].field.refKey, 'salary_amt');
  assert.equal(plan[1].clubKind, 'COMPENSATION_COMPOSITE');
  assert.equal(plan[1].executionPriority, 46);
  assert.equal(plan[1].valueTransform, 'lpa_vs_annual');

  // Verify transform converts annual amount to LPA value
  const transformed = applyClubbedValueTransform('1200000', plan[1]);
  assert.equal(transformed, '12');

  // Non-LPA salary retains raw value
  const nonLpaField = createMockField({
    refKey: 'annual_salary',
    questionText: 'Expected Salary (Annual USD)',
    sectionHeading: 'Compensation',
  });
  const plan2 = buildCoordinatedFillPlan([nonLpaField]);
  const transformed2 = applyClubbedValueTransform('1200000', plan2[0]);
  assert.equal(transformed2, '1200000');
});

test('buildCoordinatedFillPlan separates Work Experience and Education blocks with date tags', () => {
  const fields: DistilledField[] = [
    createMockField({
      refKey: 'edu_grad',
      questionText: 'Graduation Date',
      sectionHeading: 'Education Details',
    }),
    createMockField({
      refKey: 'work_start',
      questionText: 'Start Date',
      sectionHeading: 'Work Experience',
    }),
    createMockField({
      refKey: 'work_role',
      questionText: 'Job Title',
      sectionHeading: 'Work Experience',
    }),
    createMockField({
      refKey: 'custom_misc',
      questionText: 'Portfolio Website',
      sectionHeading: 'General',
    }),
  ];

  const plan = buildCoordinatedFillPlan(fields);

  // Work experience (50) before Education (60) before Standalone (70)
  const workFields = plan.filter(p => p.clubKind === 'WORK_EXPERIENCE_BLOCK');
  assert.equal(workFields.length, 2);
  assert.equal(workFields[0].executionPriority, 50);

  const workDatePlan = plan.find(p => p.field.refKey === 'work_start')!;
  assert.equal(workDatePlan.valueTransform, 'force_work_dates');

  const eduDatePlan = plan.find(p => p.field.refKey === 'edu_grad')!;
  assert.equal(eduDatePlan.clubKind, 'EDUCATION_BLOCK');
  assert.equal(eduDatePlan.executionPriority, 60);
  assert.equal(eduDatePlan.valueTransform, 'force_edu_dates');

  const miscPlan = plan.find(p => p.field.refKey === 'custom_misc')!;
  assert.equal(miscPlan.clubKind, 'STANDALONE');
  assert.equal(miscPlan.executionPriority, 70);
});

test('buildCoordinatedFillPlan safely handles empty fields array', () => {
  const plan = buildCoordinatedFillPlan([]);
  assert.deepEqual(plan, []);
});
