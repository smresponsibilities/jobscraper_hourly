import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'patchright';
import { collectInputsAcrossShadowRoots } from './widgets.js';
test('inspects nested open roots with accurate depth and labels', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="root"></div>');
    await page.evaluate(() => {
      let node = document.querySelector('#root')!;
      for (let depth = 1; depth <= 3; depth++) {
        const shadow = node.attachShadow({ mode: 'open' });
        shadow.innerHTML = `<label for="field${depth}">Level ${depth}</label><input id="field${depth}"><div></div>`;
        node = shadow.querySelector('div')!;
      }
    });
    assert.deepEqual((await collectInputsAcrossShadowRoots(page)).map(({ id, label, shadowDepth }) => ({ id, label, shadowDepth })), [
      { id: 'field1', label: 'Level 1', shadowDepth: 1 },
      { id: 'field2', label: 'Level 2', shadowDepth: 2 },
      { id: 'field3', label: 'Level 3', shadowDepth: 3 },
    ]);
  } finally { await browser.close(); }
});
