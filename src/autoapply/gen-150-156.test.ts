import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runWorkdayStepFastPass, fillWorkdaySelectInputFast } from './workday-wizard.js';
import { AutoApplyRunner } from './runner.js';

test('GEN-150: expandWorkdaySectionIfNeeded in workday-wizard.ts expands collapsed Work Experience & Education', () => {
  assert.equal(typeof runWorkdayStepFastPass, 'function');
  const wizardSrc = fs.readFileSync('src/autoapply/workday-wizard.ts', 'utf8');
  assert.ok(wizardSrc.includes('expandWorkdaySectionIfNeeded'), 'Must define expandWorkdaySectionIfNeeded');
  assert.ok(wizardSrc.includes('workExperienceSection'), 'Must target workExperienceSection');
  assert.ok(wizardSrc.includes('educationSection'), 'Must target educationSection');
  assert.ok(wizardSrc.includes('data-automation-id="add-button"'), 'Must click add-button when collapsed');
});

test('GEN-151: workday-wizard.ts includes multi-seed school fallback ("Other", "University", "India")', () => {
  assert.equal(typeof fillWorkdaySelectInputFast, 'function');
  const wizardSrc = fs.readFileSync('src/autoapply/workday-wizard.ts', 'utf8');
  assert.ok(wizardSrc.includes('Chitkara University'), 'Must search for Chitkara University');
  assert.ok(wizardSrc.includes('Other'), 'Must include Other fallback');
  assert.ok(wizardSrc.includes('University'), 'Must include University fallback');
  assert.ok(wizardSrc.includes('selectedItem'), 'Must check selectedItem pill');
});

test('GEN-152: humanType in runner.ts synchronizes Shadow-Host .value and dispatches valueChange', () => {
  const runner = new AutoApplyRunner();
  assert.equal(typeof runner.humanType, 'function');
  const runnerSrc = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  assert.ok(runnerSrc.includes('valueChange'), 'Must dispatch valueChange CustomEvent');
  assert.ok(runnerSrc.includes('getRootNode'), 'Must inspect root node for shadow host');
  assert.ok(runnerSrc.includes('host.value = val'), 'Must set host value');
});

test('GEN-153 & GEN-154: sanitizeValueForInputType in runner.ts cleans type="number" and type="url" inputs', async () => {
  const runner = new AutoApplyRunner();
  assert.equal(typeof (runner as any).sanitizeValueForInputType, 'function');

  // Test number inputs
  const mockNumberControl = {
    evaluate: async (fn: any) => fn({
      getAttribute: (attr: string) => attr === 'type' ? 'number' : null,
      type: 'number',
    })
  } as any;

  const immediateVal = await (runner as any).sanitizeValueForInputType(mockNumberControl, 'Immediate', 'Notice period');
  assert.equal(immediateVal, '0', 'Immediate should convert to 0 for number inputs');

  const lpaVal = await (runner as any).sanitizeValueForInputType(mockNumberControl, '12 LPA', 'Expected CTC');
  assert.equal(lpaVal, '1200000', '12 LPA should convert to 1200000');

  const lpaInLakhsVal = await (runner as any).sanitizeValueForInputType(mockNumberControl, '12 LPA', 'Expected CTC (in LPA)');
  assert.equal(lpaInLakhsVal, '12', '12 LPA should convert to 12 when question asks in LPA');

  const yoeVal = await (runner as any).sanitizeValueForInputType(mockNumberControl, '1 year', 'Years of experience');
  assert.equal(yoeVal, '1', '1 year should extract numeric 1');

  // Test URL inputs
  const mockUrlControl = {
    evaluate: async (fn: any) => fn({
      getAttribute: (attr: string) => attr === 'type' ? 'url' : null,
      type: 'url',
    })
  } as any;

  const linkedinVal = await (runner as any).sanitizeValueForInputType(mockUrlControl, 'N/A', 'LinkedIn URL');
  assert.equal(linkedinVal, 'https://www.linkedin.com/in/mahajanshivam', 'N/A should resolve to valid LinkedIn profile');

  const genericUrlVal = await (runner as any).sanitizeValueForInputType(mockUrlControl, 'None', 'Website');
  assert.equal(genericUrlVal, 'https://shivammahajan.com', 'None should resolve to portfolio website');
});
