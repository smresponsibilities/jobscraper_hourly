import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AutoApplyRunner } from './runner.js';

test('runner selects supplied skills and owner-authorized consent', { timeout: 60000 }, async () => {
  const runner = new AutoApplyRunner() as any;
  try {
    await runner.initBrowser(true);
    const page = runner.page;
    await page.setContent('<fieldset aria-required="true"><legend>Programming skills</legend><label><input type="checkbox" name="skills" value="java">Java</label><label><input type="checkbox" name="skills" value="python">Python</label><label><input type="checkbox" name="skills" value="ruby">Ruby</label></fieldset><fieldset aria-required="true"><legend>Consent to unrelated terms</legend><label><input type="checkbox" name="consent" value="yes">Yes</label><label><input type="checkbox" name="consent" value="no">No</label></fieldset>');
    const profile = { personal: { firstName: 'Fixture', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [], skills: ['Java', 'Python'] };
    const report = { mode: 'copilot', url: 'https://example.test/job', ats: 'generic', startTime: new Date().toISOString(), fieldsFound: 0, fieldsFilled: 0, unmappedFields: 0, stepsTraversed: 0, status: 'queued', actions: [], logs: [] };
    await runner.fillFrame(page.mainFrame(), { url: report.url, profile, mode: 'copilot' }, report);
    assert.deepEqual(await page.locator('input[name="skills"]').evaluateAll(items => items.map(item => (item as HTMLInputElement).checked)), [true, true, false]);
    assert.deepEqual(await page.locator('input[name="consent"]').evaluateAll(items => items.map(item => (item as HTMLInputElement).checked)), [true, false]);
  } finally { await runner.close(); }
});
