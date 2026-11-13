import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'patchright';
import { selectAshbyYesNoOrCheckboxGroup, solveCheckboxGroupDeterministically } from './widgets.js';

test('checkbox groups match one explicit option without accepting partial or duplicate labels', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent('<fieldset><label><input type="checkbox">Java</label><label><input type="checkbox">JavaScript</label><label><input type="checkbox">Python</label></fieldset>');
    const group = page.locator('fieldset');
    assert.equal(await selectAshbyYesNoOrCheckboxGroup(group, 'Java'), true);
    assert.deepEqual(await group.locator('input').evaluateAll(items => items.map(item => (item as HTMLInputElement).checked)), [true, false, false]);
    assert.equal(await selectAshbyYesNoOrCheckboxGroup(group, 'Script'), false);
    assert.deepEqual(await group.locator('input').evaluateAll(items => items.map(item => (item as HTMLInputElement).checked)), [true, false, false]);
    await page.setContent('<fieldset><label><input type="checkbox">Java</label><label><input type="checkbox">Java</label></fieldset>');
    assert.equal(await selectAshbyYesNoOrCheckboxGroup(page.locator('fieldset'), 'Java'), false);
  } finally { await browser.close(); }
});


test('multi-select solver uses the supplied skill list and does not assume consent', () => {
  const choices = ['Java', 'Python', 'TypeScript', 'Ruby', 'PHP'];
  assert.deepEqual(solveCheckboxGroupDeterministically('Programming skills', choices, ['Java', 'Python', 'TypeScript']), [0, 1, 2]);
  assert.deepEqual(solveCheckboxGroupDeterministically('Programming skills', choices), []);
  assert.deepEqual(solveCheckboxGroupDeterministically('Consent', ['Yes', 'No'], ['Yes']), []);
  assert.deepEqual(solveCheckboxGroupDeterministically('Work authorization', ['No', 'N/A'], ['No']), []);
});


test('numeric answers do not select button positions', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent('<fieldset><button type="button" aria-pressed="false" onclick="this.setAttribute(\'aria-pressed\',\'true\')">Yes</button><button type="button" aria-pressed="false" onclick="this.setAttribute(\'aria-pressed\',\'true\')">No</button></fieldset>');
    const group = page.locator('fieldset');
    assert.equal(await selectAshbyYesNoOrCheckboxGroup(group, 0), false);
    assert.equal(await page.getByRole('button', { name: 'Yes' }).getAttribute('aria-pressed'), 'false');
  } finally { await browser.close(); }
});
