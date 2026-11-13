import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'patchright';
import { selectHarvestedOption, translateCanonicalAnswerToOption, verifyChoiceReadBack, pickBestComboboxOptionIndex } from './widgets.js';

test('option translation uses only grounded unique matches', () => {
  assert.equal(translateCanonicalAnswerToOption('No', 'Sponsorship', ['Yes', 'No']), 'No');
  assert.equal(translateCanonicalAnswerToOption('Female', 'Gender', ['Male', 'Prefer not to say']), null);
  assert.equal(translateCanonicalAnswerToOption('Male', 'Gender', ['Female', 'Prefer not to say']), null);
  assert.equal(translateCanonicalAnswerToOption('Woman', 'Gender', ['Man', 'Prefer not to say']), null);
  assert.equal(translateCanonicalAnswerToOption('30', 'Notice period days', ['Immediate', '0-15 days']), null);
  assert.equal(translateCanonicalAnswerToOption('Bengaluru', 'City', ['Bangalore', 'Delhi']), 'Bangalore');
  assert.equal(translateCanonicalAnswerToOption('1', 'Years of experience', ['0-2 years', '3-5 years']), '0-2 years');
});

test('native selection refuses unrelated and ambiguous options', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent('<select id=s><option value="">Select</option><option>Yes</option><option>No</option></select>');
    const input = page.locator('#s');
    assert.equal(await selectHarvestedOption(page.mainFrame(), input, 'Maybe', 'Consent'), false);
    assert.equal(await input.inputValue(), '');
    assert.equal(await selectHarvestedOption(page.mainFrame(), input, 'No', 'Consent'), true);
    assert.equal(await input.inputValue(), 'No');
    assert.equal(await verifyChoiceReadBack(input, input, 'Yes'), false);
    assert.equal(await verifyChoiceReadBack(input, input, 'No'), true);
    await page.setContent('<select id=s><option>Yes</option><option>Yes</option></select>');
    assert.equal(await selectHarvestedOption(page.mainFrame(), page.locator('#s'), 'Yes'), false);
  } finally { await browser.close(); }
});


test('combobox matching avoids false schools and ambiguous choices', () => {
  assert.deepEqual(pickBestComboboxOptionIndex('Chitkara University', ['MIT', 'Stanford', 'Other / Not Listed'], 'school'), { bestIndex: 2, matchType: 'other_fallback' });
  assert.equal(pickBestComboboxOptionIndex('Chitkara University', ['MIT', 'Stanford'], 'school').bestIndex, -1);
  assert.equal(pickBestComboboxOptionIndex('Bengaluru', ['Bangalore', 'Delhi'], 'location').bestIndex, 0);
  assert.equal(pickBestComboboxOptionIndex('University of California', ['University of Colorado'], 'school').bestIndex, -1);
  assert.equal(pickBestComboboxOptionIndex('Bengaluru', ['Bengaluru', 'Bengaluru'], 'location').bestIndex, -1);
  assert.equal(pickBestComboboxOptionIndex('Chitkara University', ['Chitkara University, Punjab', 'Chitkara University, Himachal', 'Other'], 'school').bestIndex, -1);
});


test('native school selection accepts a unique named option, not an unsupported Other', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent('<select id=s><option value="">Select</option><option>Chitkara University, Punjab</option><option>Other / Not Listed</option></select>');
    assert.equal(await selectHarvestedOption(page.mainFrame(), page.locator('#s'), 'Chitkara University', 'School'), true);
    assert.equal(await page.locator('#s').inputValue(), 'Chitkara University, Punjab');
    await page.setContent('<select id=s><option value="">Select</option><option>MIT</option><option>Other / Not Listed</option></select>');
    assert.equal(await selectHarvestedOption(page.mainFrame(), page.locator('#s'), 'Chitkara University', 'School'), false);
    assert.equal(await page.locator('#s').inputValue(), '');
  } finally { await browser.close(); }
});
