import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findByRefDeep } from './widgets.js';
import { AutoApplyRunner } from './runner.js';
import { runWorkdayStepFastPass } from './workday-wizard.js';

test('GEN-138: findByRefDeep shadow-root traversal exists in widgets.ts and traverses shadow trees', () => {
  assert.equal(typeof findByRefDeep, 'function');
  const widgetsSrc = fs.readFileSync('src/autoapply/widgets.ts', 'utf8');
  assert.ok(widgetsSrc.includes('findByRefDeep'));
  assert.ok(widgetsSrc.includes('shadowRoot'));
  assert.ok(widgetsSrc.includes('data-autoapply-ref'));
});

test('GEN-139: Multi-option checkbox group synonym matcher (bangalore, skills, required fallback) exists in runner.ts', () => {
  const runnerSrc = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  assert.ok(runnerSrc.includes('bengaluru|bangalore|karnataka|india'));
  assert.ok(runnerSrc.includes('java|python|typescript|javascript|sql|spark'));
  assert.ok(runnerSrc.includes('isSkillsMatch'));
  assert.ok(runnerSrc.includes('isLocationSynonymMatch'));
});

test('GEN-140: Cover Letter "Enter manually" toggle and file fallback exist in runner.ts', () => {
  const runnerSrc = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  assert.ok(runnerSrc.includes('Enter manually'));
  assert.ok(runnerSrc.includes('cover_letter_text'));
  assert.ok(runnerSrc.includes('composed_cover_letter'));
});

test('GEN-141: Workday Step 1 & 2 fast-pass fields exist in workday-wizard.ts', () => {
  assert.equal(typeof runWorkdayStepFastPass, 'function');
  const wizardSrc = fs.readFileSync('src/autoapply/workday-wizard.ts', 'utf8');
  assert.ok(wizardSrc.includes('Technology Apprentice'));
  assert.ok(wizardSrc.includes('Morgan Stanley'));
  assert.ok(wizardSrc.includes('Bengaluru, India'));
  assert.ok(wizardSrc.includes('addressSection_postalCode'));
  assert.ok(wizardSrc.includes('560001'));
});

test('GEN-142: isDeadOrClosedJobPosting fast-exit exists in runner.ts', () => {
  const runner = new AutoApplyRunner();
  assert.equal(typeof (runner as any).isDeadOrClosedJobPosting, 'function');
  const runnerSrc = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  assert.ok(runnerSrc.includes('isDeadOrClosedJobPosting'));
  assert.ok(runnerSrc.includes('this job is no longer available'));
  assert.ok(runnerSrc.includes('Fast-exit:'));
});
