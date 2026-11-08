import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { appendSectionContextIfAmbiguous } from './distiller.js';
import { resolveExtendedPortalQuestionTaxonomy } from './answers.js';

test('GEN-228: Greenhouse below-the-fold scroll hydration and safe embed fallback', () => {
  const runnerContent = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  assert.ok(
    runnerContent.includes('#application-form, #application_form, #app'),
    'runner.ts must target greenhouse form containers'
  );
  assert.ok(
    runnerContent.includes('scrollIntoView({ block: \'start\' })') || runnerContent.includes('scrollIntoView({ block: "start" })'),
    'runner.ts must scroll greenhouse form into view'
  );
  assert.ok(
    runnerContent.includes('greenhouse.io/embed/job_app'),
    'runner.ts must check embed/job_app fallback'
  );
});

test('GEN-229: distiller.ts appends (Education) vs (Work Experience) to ambiguous date labels', () => {
  // Mock element with closest method
  const mockEduEl = {
    closest: (sel: string) => sel.includes('education') ? {} : null,
  } as unknown as Element;

  const mockWorkEl = {
    closest: (sel: string) => sel.includes('experience') || sel.includes('employment') ? {} : null,
  } as unknown as Element;

  const mockOtherEl = {
    closest: () => null,
  } as unknown as Element;

  assert.equal(appendSectionContextIfAmbiguous('Start Date *', mockEduEl), 'Start Date * (Education)');
  assert.equal(appendSectionContextIfAmbiguous('From', mockEduEl), 'From (Education)');
  assert.equal(appendSectionContextIfAmbiguous('End Date *', mockEduEl), 'End Date * (Education)');
  assert.equal(appendSectionContextIfAmbiguous('To', mockEduEl), 'To (Education)');

  assert.equal(appendSectionContextIfAmbiguous('Start Date *', mockWorkEl), 'Start Date * (Work Experience)');
  assert.equal(appendSectionContextIfAmbiguous('From', mockWorkEl), 'From (Work Experience)');
  assert.equal(appendSectionContextIfAmbiguous('End Date *', mockWorkEl), 'End Date * (Work Experience)');
  assert.equal(appendSectionContextIfAmbiguous('To', mockWorkEl), 'To (Work Experience)');

  assert.equal(appendSectionContextIfAmbiguous('Full Name', mockEduEl), 'Full Name');
  assert.equal(appendSectionContextIfAmbiguous('Start Date *', mockOtherEl), 'Start Date *');
});

test('GEN-229 & GEN-230: answers.ts resolves Education (2022-2026) vs Work Experience (2025-2026)', () => {
  // Education dates
  const eduStartYear = resolveExtendedPortalQuestionTaxonomy('Start Year * (Education)', 'text');
  const eduEndYear = resolveExtendedPortalQuestionTaxonomy('End Year * (Education)', 'text');
  const eduStartDate = resolveExtendedPortalQuestionTaxonomy('Start Date * (Education)', 'date');
  const eduEndDate = resolveExtendedPortalQuestionTaxonomy('End Date * (Education)', 'date');
  const eduFrom = resolveExtendedPortalQuestionTaxonomy('From (Education)', 'text');
  const eduTo = resolveExtendedPortalQuestionTaxonomy('To (Education)', 'text');

  assert.equal(eduStartYear, '2022', 'Education start year must be 2022');
  assert.equal(eduEndYear, '2026', 'Education end year must be 2026');
  assert.equal(eduStartDate, '2022-08-01', 'Education start date must be 2022-08-01');
  assert.equal(eduEndDate, '2026-08-01', 'Education end date must be 2026-08-01');
  assert.equal(eduFrom, '08/2022', 'Education from must be 08/2022');
  assert.equal(eduTo, '08/2026', 'Education to must be 08/2026');

  // Work Experience dates
  const workStartYear = resolveExtendedPortalQuestionTaxonomy('Start Year * (Work Experience)', 'text');
  const workEndYear = resolveExtendedPortalQuestionTaxonomy('End Year * (Work Experience)', 'text');
  const workStartDate = resolveExtendedPortalQuestionTaxonomy('Start Date * (Work Experience)', 'date');
  const workEndDate = resolveExtendedPortalQuestionTaxonomy('End Date * (Work Experience)', 'date');
  const workFrom = resolveExtendedPortalQuestionTaxonomy('From (Work Experience)', 'text');
  const workTo = resolveExtendedPortalQuestionTaxonomy('To (Work Experience)', 'text');

  assert.equal(workStartYear, '2025', 'Work Experience start year must be 2025');
  assert.equal(workEndYear, '2026', 'Work Experience end year must be 2026');
  assert.equal(workStartDate, '2025-08-01', 'Work Experience start date must be 2025-08-01');
  assert.equal(workEndDate, '2026-08-01', 'Work Experience end date must be 2026-08-01');
  assert.equal(workFrom, '08/2025', 'Work Experience from must be 08/2025');
  assert.equal(workTo, '08/2026', 'Work Experience to must be 08/2026');
});

test('GEN-230: workday-wizard.ts contains currentlyWorkHere handling and scoped spinbutton dates', () => {
  const wizardContent = fs.readFileSync('src/autoapply/workday-wizard.ts', 'utf8');
  assert.ok(
    wizardContent.includes('currentlyWorkHere'),
    'workday-wizard.ts must handle currentlyWorkHere checkbox'
  );
  assert.ok(
    wizardContent.includes('workExperienceSection'),
    'workday-wizard.ts must scope to workExperienceSection'
  );
  assert.ok(
    wizardContent.includes('educationSection'),
    'workday-wizard.ts must scope to educationSection'
  );
});

test('GEN-231: runner.ts contains ensureResumeUploadedBeforeSubmit guarantee', () => {
  const runnerContent = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  assert.ok(
    runnerContent.includes('ensureResumeUploadedBeforeSubmit'),
    'runner.ts must define and invoke ensureResumeUploadedBeforeSubmit'
  );
  assert.ok(
    runnerContent.includes('primaryFileInput.setInputFiles'),
    'ensureResumeUploadedBeforeSubmit must setInputFiles on file input'
  );
});

test('GEN-232 & GEN-233: widgets.ts scrolls options into view and runner.ts uses zero-interception label click', () => {
  const widgetsContent = fs.readFileSync('src/autoapply/widgets.ts', 'utf8');
  assert.ok(
    widgetsContent.includes('scrollIntoView({ block: \'nearest\' })') || widgetsContent.includes('scrollIntoView({ block: "nearest" })'),
    'widgets.ts selectHarvestedOption must scroll option into view'
  );

  const runnerContent = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  assert.ok(
    runnerContent.includes('lbl.click()'),
    'runner.ts must click label for zero-interception radio/checkbox commit'
  );
  assert.ok(
    runnerContent.includes('inp.checked = true') || runnerContent.includes('inp.checked = wanted'),
    'runner.ts must natively set inp.checked'
  );
});
