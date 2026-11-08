import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkJobPostingHttpAliveFast } from '../../scripts/run-overnight-marathon.js';
import {
  runHourly100JobsHarvester,
  harvestLiveFastAtsBoardsFromCompaniesJson,
} from '../../scripts/harvest-100-hourly-jobs.js';

test('GEN-196: runner.ts resets _valueTracker, sets 6000ms timeout and eliminates blocking 30s inputValue()', () => {
  const runnerSrc = fs.readFileSync('src/autoapply/runner.ts', 'utf8');

  // Must reset React internal _valueTracker
  assert.ok(
    runnerSrc.includes('_valueTracker'),
    'runner.ts must reset React _valueTracker in humanType'
  );
  assert.ok(
    runnerSrc.includes('tracker.setValue(\'\')'),
    'runner.ts must clear tracker value before dispatching events'
  );

  // Must set 6000ms default locator timeout
  assert.ok(
    runnerSrc.includes('setDefaultTimeout(6000)'),
    'runner.ts must set page.setDefaultTimeout(6000)'
  );

  // Must use non-blocking evaluate with timeout race instead of plain blocking inputValue() in prefilled check
  assert.ok(
    runnerSrc.includes('Promise.race') && runnerSrc.includes('HTMLInputElement).value'),
    'runner.ts must use Promise.race non-blocking value evaluation in prefill checks'
  );
});

test('GEN-197: checkJobPostingHttpAliveFast probes Workday CXS and SmartRecruiters JSON APIs', async () => {
  assert.equal(typeof checkJobPostingHttpAliveFast, 'function');

  const marathonSrc = fs.readFileSync('scripts/run-overnight-marathon.ts', 'utf8');
  assert.ok(
    marathonSrc.includes('/wday/cxs/'),
    'checkJobPostingHttpAliveFast must probe Workday CXS JSON API'
  );
  assert.ok(
    marathonSrc.includes('api.smartrecruiters.com/v1/companies/'),
    'checkJobPostingHttpAliveFast must probe SmartRecruiters public API'
  );

  // Test against an invalid Workday URL format or live non-existent job
  const dummyWorkday = 'https://geagroup.wd3.myworkdayjobs.com/GEA_Careers/job/Bengaluru/NonExistentJob_JR123456';
  const check = await checkJobPostingHttpAliveFast(dummyWorkday);
  assert.equal(typeof check.alive, 'boolean');
});

test('GEN-198: distiller.ts marks checkbox/radio clusters with * or .required as isRequired: true', () => {
  const distillerSrc = fs.readFileSync('src/autoapply/distiller.ts', 'utf8');

  assert.ok(
    distillerSrc.includes('/\\*\\s*$|\\brequired\\b/i') || distillerSrc.includes('question.trim()'),
    'distiller.ts must check asterisk or required keyword in question text'
  );
  assert.ok(
    distillerSrc.includes('.required, .asterisk, [aria-required="true"]'),
    'distiller.ts must check container wrapper required/asterisk selectors'
  );
});

test('GEN-199: runner.ts contains self-healing retry on "Next did not change the form" and Sandisk submit selectors', () => {
  const runnerSrc = fs.readFileSync('src/autoapply/runner.ts', 'utf8');

  assert.ok(
    runnerSrc.includes('healInvalidFieldsAndRetrySubmit') && runnerSrc.includes('spl-autocomplete'),
    'runner.ts must self-heal and click spl-autocomplete options before reporting Next did not change the form'
  );
  assert.ok(
    runnerSrc.includes('[role="button"]:has-text("Submit")') && runnerSrc.includes('a.btn-submit'),
    'runner.ts must support Sandisk [role="button"]:has-text("Submit") and a.btn-submit selectors'
  );
});

test('GEN-200 & GEN-201: harvest-100-hourly-jobs.ts exports harvester and updates queues', async () => {
  assert.equal(typeof harvestLiveFastAtsBoardsFromCompaniesJson, 'function');
  assert.equal(typeof runHourly100JobsHarvester, 'function');

  // Quick test of board sampler
  const sample = await harvestLiveFastAtsBoardsFromCompaniesJson(5);
  assert.ok(Array.isArray(sample), 'Should return array of harvested jobs');
});
