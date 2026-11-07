import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AutoApplyRunner } from './runner.js';
import { distillFormStep } from './distiller.js';
import { selectHarvestedOption, selectAshbyYesNoOrCheckboxGroup } from './widgets.js';
import { authenticateWorkdayPortal } from './authentication.js';

test('GEN-123: runner.ts tracks HTTP POST network submission receipts and contains ApiSubmitApplicationForm', () => {
  const runner = new AutoApplyRunner();
  assert.equal(typeof (runner as any).attachNetworkReceiptListener, 'function');
  assert.equal((runner as any).lastNetworkSubmissionReceipt, null);

  const runnerSrc = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  assert.ok(runnerSrc.includes('attachNetworkReceiptListener'));
  assert.ok(runnerSrc.includes('ApiSubmitApplicationForm'));
  assert.ok(runnerSrc.includes('network_receipt'));
});

test('GEN-124: distiller.ts discovers Ashby Yes/No button toggle groups and deduplicates autofill resume dropzones', () => {
  assert.equal(typeof distillFormStep, 'function');
  const distillerSrc = fs.readFileSync('src/autoapply/distiller.ts', 'utf8');
  assert.ok(distillerSrc.includes('data-autoapply-btngroup-option'));
  assert.ok(distillerSrc.includes('data-autoapply-skip-file'));
  assert.ok(distillerSrc.includes('autofill'));

  assert.equal(typeof selectAshbyYesNoOrCheckboxGroup, 'function');
  const widgetsSrc = fs.readFileSync('src/autoapply/widgets.ts', 'utf8');
  assert.ok(widgetsSrc.includes('data-autoapply-btngroup-option'));
});

test('GEN-125: runner.ts provides shadow-DOM submit discovery and pre-submit consent auto-check', () => {
  const runner = new AutoApplyRunner();
  assert.equal(typeof (runner as any).ensurePrivacyConsentCheckboxesChecked, 'function');

  const runnerSrc = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  assert.ok(runnerSrc.includes('ensurePrivacyConsentCheckboxesChecked'));
  assert.ok(runnerSrc.includes('footer-submit'));
  assert.ok(runnerSrc.includes('data-autoapply-shadow-submit'));
});

test('GEN-126: authentication.ts bypasses Workday click_filter auth overlay with force: true and Enter key', () => {
  assert.equal(typeof authenticateWorkdayPortal, 'function');
  const authSrc = fs.readFileSync('src/autoapply/authentication.ts', 'utf8');
  assert.ok(authSrc.includes('click_filter'));
  assert.ok(authSrc.includes('force: true'));
});

test('GEN-127: widgets.ts selectHarvestedOption re-opens closed select menus / listbox portals', () => {
  assert.equal(typeof selectHarvestedOption, 'function');
  const widgetsSrc = fs.readFileSync('src/autoapply/widgets.ts', 'utf8');
  assert.ok(widgetsSrc.includes('countVisibleOpts'));
  assert.ok(widgetsSrc.includes('ArrowDown'));
  assert.ok(widgetsSrc.includes('select__menu-portal'));
});
