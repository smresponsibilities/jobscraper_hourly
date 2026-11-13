import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'patchright';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyFileUploadSlot } from './classifier.js';
import { selectIdentifiedResumeInput } from './runner.js';
import { uploadFileWithCdpFallback } from './widgets.js';

test('classifies distinct upload labels and refuses ambiguous or unknown fields', () => {
  assert.equal(classifyFileUploadSlot('Resume/CV'), 'resume');
  assert.equal(classifyFileUploadSlot('coverLetter'), 'cover_letter');
  assert.equal(classifyFileUploadSlot('Motivation letter'), 'cover_letter');
  assert.equal(classifyFileUploadSlot('Academic transcript'), 'transcript');
  assert.equal(classifyFileUploadSlot('Work sample'), 'portfolio');
  assert.equal(classifyFileUploadSlot('Resume or cover letter'), 'other_optional');
  assert.equal(classifyFileUploadSlot('Upload document'), 'other_optional');
});

test('resume selector never chooses cover letter, transcript or ambiguous input', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <label for="cover">Cover letter</label><input type="file" id="cover" name="resumeCoverLetter">
      <label for="academic">Transcript</label><input type="file" id="academic">
      <span id="resume-label">Resume / CV</span><input type="file" id="actual" aria-labelledby="resume-label">
      <input type="file" id="unknown">
    `);
    const selected = await selectIdentifiedResumeInput(page);
    assert.equal(await selected?.getAttribute('id'), 'actual');
    await page.locator('#actual').evaluate(el => el.remove());
    assert.equal(await selectIdentifiedResumeInput(page), undefined);
    assert.equal(await page.locator('#cover').evaluate(el => (el as HTMLInputElement).files?.length), 0);
    assert.equal(await page.locator('#academic').evaluate(el => (el as HTMLInputElement).files?.length), 0);
  } finally { await browser.close(); }
});

test('upload fallback reaches open shadow input and never claims missing inputs succeeded', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'upload-fallback-'));
  const file = path.join(directory, 'fixture.pdf');
  writeFileSync(file, '%PDF-1.4\nfixture');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<input id="plain" type="file"><div id="host"></div>');
    await page.locator('#host').evaluate(host => {
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = '<input id="shadow" type="file">';
    });
    const plain = page.locator('#plain');
    assert.equal((await uploadFileWithCdpFallback(page, plain, file)).method, 'playwright_set_input_files');
    const shadow = page.locator('#shadow');
    const forcedFallback = new Proxy(shadow, { get(target, key) {
      if (key === 'setInputFiles') return async () => { throw new Error('forced fallback'); };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const result = await uploadFileWithCdpFallback(page, forcedFallback, file);
    assert.equal(result.uploaded, true);
    assert.equal(result.method, 'cdp_dom_set_file_input_files');
    assert.equal(await shadow.evaluate(el => (el as HTMLInputElement).files?.[0]?.name), 'fixture.pdf');
    assert.equal((await uploadFileWithCdpFallback(page, page.locator('#missing'), file)).uploaded, false);
  } finally { await browser.close(); rmSync(directory, { recursive: true, force: true }); }
});
