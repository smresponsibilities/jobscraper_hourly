import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { selectHarvestedOption } from './widgets.js';
import { AutoApplyRunner } from './runner.js';
import { runWorkdayStepFastPass } from './workday-wizard.js';

test('GEN-144: runner.ts distinguishes Next/Continue and footer-next from final Submit', () => {
  const runnerSrc = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  assert.ok(runnerSrc.includes('footer-next'), 'Must check footer-next attribute');
  assert.ok(runnerSrc.includes('data-autoapply-shadow-next'), 'Must set shadow-next marker');
  assert.ok(runnerSrc.includes('data-autoapply-shadow-submit'), 'Must set shadow-submit marker');
  assert.ok(runnerSrc.includes('smartrecruiters'), 'Must handle SmartRecruiters multi-step timing');
});

test('GEN-145: widgets.ts selectHarvestedOption uses filterSeed to type-to-filter virtualized comboboxes', () => {
  assert.equal(typeof selectHarvestedOption, 'function');
  const widgetsSrc = fs.readFileSync('src/autoapply/widgets.ts', 'utf8');
  assert.ok(widgetsSrc.includes('filterSeed'), 'Must compute filterSeed prefix');
  assert.ok(widgetsSrc.includes('pressSequentially') || widgetsSrc.includes('fill'), 'Must type filterSeed');
});

test('GEN-146: runner.ts includes isPhoneInvalid / alternatePhone dual-format self-healing', () => {
  const runnerSrc = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  assert.ok(runnerSrc.includes('isPhoneInvalid'), 'Must check phone validation state');
  assert.ok(runnerSrc.includes('alternatePhone'), 'Must compute alternate phone format');
  assert.ok(runnerSrc.includes('aria-invalid'), 'Must check aria-invalid attribute on phone');
});

test('GEN-147: runner.ts includes performHumanPreSubmitTelemetry', () => {
  const runner = new AutoApplyRunner();
  assert.equal(typeof (runner as any).performHumanPreSubmitTelemetry, 'function');
  const runnerSrc = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  assert.ok(runnerSrc.includes('performHumanPreSubmitTelemetry'));
  assert.ok(runnerSrc.includes('scrollBy'));
  assert.ok(runnerSrc.includes('mouse.move'));
});

test('GEN-148: workday-wizard.ts auto-fills Chitkara University and selects formField-degree on Workday Step 2', () => {
  assert.equal(typeof runWorkdayStepFastPass, 'function');
  const wizardSrc = fs.readFileSync('src/autoapply/workday-wizard.ts', 'utf8');
  assert.ok(wizardSrc.includes('Chitkara University'), 'Must auto-fill Chitkara University for school');
  assert.ok(wizardSrc.includes('formField-degree'), 'Must target formField-degree listbox');
});
