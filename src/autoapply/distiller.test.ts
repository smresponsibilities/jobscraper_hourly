import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'patchright';
import {
  distillFormStep,
  isInteractiveChoiceReadOnly,
  extractCleanQuestionText,
  groupKeyFor,
  collectControls
} from './distiller.js';

test('isInteractiveChoiceReadOnly identifies comboboxes, listboxes, and custom select controls', () => {
  const mkEl = (attrs: Record<string, string>) => {
    return {
      getAttribute: (k: string) => attrs[k] || null
    } as unknown as Element;
  };

  assert.equal(isInteractiveChoiceReadOnly(mkEl({ role: 'combobox' })), true);
  assert.equal(isInteractiveChoiceReadOnly(mkEl({ role: 'listbox' })), true);
  assert.equal(isInteractiveChoiceReadOnly(mkEl({ 'data-uxi-widget-type': 'selectinput' })), true);
  assert.equal(isInteractiveChoiceReadOnly(mkEl({ 'aria-haspopup': 'listbox' })), true);
  assert.equal(isInteractiveChoiceReadOnly(mkEl({ 'aria-controls': 'menu-1' })), true);
  assert.equal(isInteractiveChoiceReadOnly(mkEl({ 'aria-owns': 'owns-1' })), true);
  assert.equal(isInteractiveChoiceReadOnly(mkEl({ role: 'textbox' })), false);
});

test('collectControls excludes honeypots and non-interactive readonly inputs', () => {
  const mkInput = (id: string, name: string, readOnly: boolean, attrs: Record<string, string> = {}) => {
    return {
      id,
      readOnly,
      getAttribute: (k: string) => k === 'name' ? name : (attrs[k] || null)
    } as unknown as HTMLInputElement;
  };

  const honeypot = mkInput('bot-trap', 'honey-pot-1', false);
  const beecatcher = mkInput('field-1', 'beecatcher_field', false);
  const normal = mkInput('field-2', 'user_name', false);
  const normalReadOnly = mkInput('field-3', 'static_info', true);
  const comboboxReadOnly = mkInput('field-4', 'country_choice', true, { role: 'combobox' });

  const collected = collectControls([honeypot, beecatcher, normal, normalReadOnly, comboboxReadOnly]);
  assert.equal(collected.length, 2);
  assert(collected.includes(normal));
  assert(collected.includes(comboboxReadOnly));
  assert(!collected.includes(honeypot));
  assert(!collected.includes(beecatcher));
  assert(!collected.includes(normalReadOnly));
});

test('distiller groups split dates as single DATE_SPLIT and strips radio option labels from questionText', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <form>
        <fieldset data-automation-id="formField-startDate">
          <legend>Start Date</legend>
          <input data-automation-id="dateSectionMonth-input" placeholder="MM">
          <input data-automation-id="dateSectionYear-input" placeholder="YYYY">
        </fieldset>
        <fieldset role="radiogroup" aria-labelledby="relocate-title">
          <div id="relocate-title">Are you willing to relocate?</div>
          <label><input type="radio" name="relocate" value="yes"> Yes</label>
          <label><input type="radio" name="relocate" value="no"> No</label>
        </fieldset>
        <input name="honey-pot-1" id="beecatcher">
      </form>
    `);

    const fields = await distillFormStep(page.mainFrame());
    // Honeypot excluded
    assert.equal(fields.some(f => f.questionText.includes('honey-pot') || f.controlSelector.includes('beecatcher')), false);

    // Split date grouped as 1 DATE_SPLIT field
    const dateFields = fields.filter(f => f.widgetKind === 'DATE_SPLIT');
    assert.equal(dateFields.length, 1);
    assert.match(dateFields[0]!.questionText, /Start Date/i);

    // Radio group has clean questionText without "Yes" or "No"
    const radioFields = fields.filter(f => f.widgetKind === 'BOOLEAN_TOGGLE');
    assert.equal(radioFields.length, 1);
    assert.match(radioFields[0]!.questionText, /Are you willing to relocate\?/i);
    assert.equal(radioFields[0]!.questionText.includes('Yes'), false);
    assert.equal(radioFields[0]!.questionText.includes('No'), false);
  } finally {
    await browser.close();
  }
});

test('0 missing questionText labels across all non-empty saved HTML captures', async () => {
  const root = path.resolve('state/autoapply/portal-review');
  const directories = [path.join(root, 'applications'), path.resolve('out/portal-audit')];
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let totalNonEmptyCaptures = 0;
  let totalMissingLabels = 0;
  let totalHoneypotsExtracted = 0;

  try {
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();

    for (const directory of directories) {
      if (!existsSync(directory)) continue;
      for (const item of readdirSync(directory, { withFileTypes: true })) {
        const filename = item.isDirectory()
          ? path.join(directory, item.name, 'review.html')
          : item.name.endsWith('.html') ? path.join(directory, item.name) : '';
        if (!filename || !existsSync(filename)) continue;

        const content = readFileSync(filename, 'utf8');
        await page.setContent(content, { waitUntil: 'domcontentloaded', timeout: 20000 });
        const fields = await distillFormStep(page.mainFrame());

        if (fields.length > 0) {
          totalNonEmptyCaptures++;
          for (const field of fields) {
            if (!field.questionText || !field.questionText.trim()) {
              totalMissingLabels++;
            }
            if (/beecatcher|honey-?pot|bot-trap/i.test(field.refKey)) {
              totalHoneypotsExtracted++;
            }
          }
        }
      }
    }
  } finally {
    await browser.close();
  }

  assert(totalNonEmptyCaptures > 0, 'Must have at least one non-empty capture');
  assert.equal(totalMissingLabels, 0, `Expected 0 missing labels, found ${totalMissingLabels}`);
  assert.equal(totalHoneypotsExtracted, 0, `Expected 0 honeypot fields, found ${totalHoneypotsExtracted}`);
});
