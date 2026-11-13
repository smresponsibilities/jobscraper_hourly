import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'patchright';
import { inspectPdfPageCount, verifyPdfVisualGeometry, verifyPrintableResumeLayout } from './deterministic-builder.js';

test('print layout rejects text beyond page bounds and never claims unsupported PDF inspection', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 698, height: 1035 } });
    await page.emulateMedia({ media: 'print' });
    await page.setContent('<style>body{margin:0}</style><p>Readable fixture</p>');
    assert.equal((await verifyPrintableResumeLayout(page)).valid, true);
    const pdf = await page.pdf({ format: 'A4' });
    assert.equal(inspectPdfPageCount(pdf), 1);
    assert.equal(verifyPdfVisualGeometry(pdf).geometryVerified, false);
    await page.setContent('<style>body{margin:0}.late{position:absolute;top:1100px}</style><p class="late">Outside page</p>');
    assert.equal((await verifyPrintableResumeLayout(page)).valid, false);
  } finally { await browser.close(); }
});
