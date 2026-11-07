import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'patchright';
import { classifyAtsField } from './classifier.js';
import { resolveByOptionPolicy } from './answers.js';
import { composeGroundedNarrative, verifyTruthfulNarrative } from './narrative-composer.js';
import { distillFormStep } from './distiller.js';
import { harvestControlOptions, selectHarvestedOption } from './widgets.js';
import { reserveStateAction } from './state-guard.js';
import { exceedsExperienceGate } from './preflight.js';
import { extractRequisitionToken } from './identity.js';
import type { CandidateExtendedProfile } from './types.js';

const profile = { personal: { country: 'India' }, professional: { totalYearsExperience: 1, noticePeriodDays: 14, officeAttendance: { city: 'Bengaluru', maxDaysPerWeek: 5 } }, education: [], experience: [{ company: 'Example', title: 'Apprentice', description: 'Used Jenkins and Maven for continuous integration. Built Java Spring Boot REST APIs.' }] } as unknown as CandidateExtendedProfile;

test('boolean controls cannot resolve employer-name facts', () => {
  assert.notEqual(classifyAtsField({ name: 'current_company', label: 'Are you bound by a restrictive covenant with your current company?', type: 'radio' }).category, 'current_company');
  assert.equal(classifyAtsField({ name: 'current_company', label: 'Current company', type: 'text' }).category, 'current_company');
  assert.equal(classifyAtsField({ label: 'Degree', type: 'radio', widgetKind: 'SINGLE_SELECT' }).category, 'degree');
  assert.equal(classifyAtsField({ label: 'Total experience', widgetKind: 'BOOLEAN_TOGGLE' }).category, 'unknown');
});

test('office policy stays within confirmed city, days and polarity', () => {
  assert.equal(resolveByOptionPolicy('Comfortable in our Bangalore office five days a week?', ['Yes', 'No'], profile)?.value, 'Yes');
  assert.equal(resolveByOptionPolicy('Comfortable in our London office five days a week?', ['Yes', 'No'], profile), undefined);
  assert.equal(resolveByOptionPolicy('Unable to work in our Bangalore office five days a week?', ['Yes', 'No'], profile), undefined);
  assert.equal(resolveByOptionPolicy('Total professional experience', ['0-2 years', '3-5 years'], profile)?.value, '0-2 years');
  assert.equal(resolveByOptionPolicy('Notice period', ['Less than 30 days', '30-60 days'], profile)?.value, 'Less than 30 days');
  assert.equal(resolveByOptionPolicy('Notice period', ['Less than 3 months', '3-6 months'], profile), undefined);
});

test('narratives are certified excerpts, with unsupported incidents left unresolved', () => {
  assert.equal(composeGroundedNarrative('Describe release tools you used', profile), 'Used Jenkins and Maven for continuous integration.');
  assert.equal(composeGroundedNarrative('Describe a difficult production failure', profile), null);
  assert.equal(verifyTruthfulNarrative('Reduced latency by 80 percent using Kubernetes.', profile), false);
});

test('experience and provider-aware requisition token guards', () => {
  assert.equal(exceedsExperienceGate('Minimum 4 years of software development experience.'), true);
  assert.equal(exceedsExperienceGate('Minimum 1 year of software development experience.'), false);
  assert.equal(extractRequisitionToken('https://jobs.smartrecruiters.com/Example/744000123456789-software-engineer'), '744000123456789');
  assert.equal(extractRequisitionToken('https://untrusted.example/123456789'), null);
  assert.equal(extractRequisitionToken('https://jobs.smartrecruiters.com/en-GB/Example/744000123456789-other-slug'), '744000123456789');
});

test('shadow questions, mounted options and unchanged-state actions', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id=host></div><div>Current employer<input id=employer></div><input name=honey-pot-1><button id=next>Next</button><button role=combobox aria-controls=menu onclick="document.querySelector(\'#menu\').hidden=false">Choose</button><div role=listbox id=menu hidden><div role=option onclick="document.querySelector(\'[role=combobox]\').setAttribute(\'aria-valuetext\',\'India\');this.parentElement.hidden=true">India</div></div>');
    await page.locator('#host').evaluate(el => { el.attachShadow({ mode: 'open' }).innerHTML = '<div>First name<input id=given></div>'; });
    await page.locator('body').evaluate(body => { const date = document.createElement('div'); date.setAttribute('data-automation-id', 'formField-startDate'); date.innerHTML = 'Start date<input data-automation-id="dateSectionMonth-input"><input data-automation-id="dateSectionYear-input">'; body.append(date); });
    const fields = await distillFormStep(page.mainFrame());
    assert(fields.some(field => field.questionText === 'First name'));
    assert(!fields.some(field => field.questionText.includes('honey-pot')));
    assert.equal(fields.filter(field => field.widgetKind === 'DATE_SPLIT').length, 1);
    const combo = page.getByRole('combobox');
    assert.deepEqual((await harvestControlOptions(page.mainFrame(), combo)).options, ['India']);
    assert.equal(await selectHarvestedOption(page.mainFrame(), combo, 'India'), true);
    const next = page.locator('#next');
    assert.equal(await reserveStateAction(page.mainFrame(), next, 'next'), true);
    assert.equal(await reserveStateAction(page.mainFrame(), next, 'next'), false);
    await page.locator('#employer').fill('Changed');
    assert.equal(await reserveStateAction(page.mainFrame(), next, 'next'), true);
  } finally { await browser.close(); }
});
