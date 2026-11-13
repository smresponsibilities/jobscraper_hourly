import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'patchright';

const moduleUrl = pathToFileURL(path.resolve('out/dashboard-access-build/scripts/dashboard-server.js')).href;
test('extension endpoint enforces token and resolves only synthetic profile facts', async () => {
  const previous = process.cwd();
  const directory = mkdtempSync(path.join(os.tmpdir(), 'dashboard-access-'));
  const token = 'fixture-token-'.repeat(4);
  const previousToken = process.env.AUTOAPPLY_DASHBOARD_TOKEN;
  process.env.AUTOAPPLY_DASHBOARD_TOKEN = token;
  process.chdir(directory);
  mkdirSync(path.join(directory, 'state/autoapply/portal-review'), { recursive: true });
  writeFileSync(path.join(directory, 'state/autoapply/portal-review/candidate.json'), JSON.stringify({ personal: { firstName: 'Fixture', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] }));
  const { startDashboardServer } = await import(moduleUrl);
  const server = startDashboardServer(0);
  let browser;
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}/api/extension-brain`;
    assert.equal((await fetch(endpoint)).status, 403);
    assert.equal((await fetch(endpoint, { headers: { Origin: 'https://attacker.example', Authorization: `Bearer ${token}` } })).status, 403);
    const res = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jobUrl: 'https://example.test/job', fields: [{ id: 'first', label: 'First Name' }, { id: 'unknown', label: 'Unknown experience example' }] }) });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.answers.length, 1);
    assert.equal(json.answers[0].resolvedValue, 'Fixture');
    assert.equal(json.answers[0].factKey, 'personal.firstName');

    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const result = await page.evaluate(() => {
      const payload = `<img src=x onerror="window.__dashboardInjected=true">`;
      window.updateAppliedJobsUi({ total: 1, observedReceipts: 0, jobs: [{ company: payload, title: payload, provider: 'fixture', url: 'javascript:alert(1)', receiptText: payload }], providerCounts: {} });
      window.updateOutreachLeadsUi([{ company: payload, roleTitle: payload, subject: payload, targetEmail: 'fixture@example.test', body: `');window.__dashboardInjected=true;//` }]);
      window.updateOvernightErrorsUi({ topFailureCategories: [{ category: payload, count: 1, percentage: payload }], topUnknownQuestions: [{ questionText: payload, widgetKind: payload, options: [payload] }], missedButtonStalls: [{ company: payload, visibleButtons: [{ text: payload }] }] });
      return {
        appliedText: document.querySelector('#applied-tbody').textContent,
        posting: document.querySelector('#applied-tbody a').getAttribute('href'),
        images: document.querySelectorAll('#applied-tbody img, #outreach-tbody img, #overnight-categories-pills img, #unmapped-questions-tbody img, #missed-buttons-tbody img').length,
        inlineCopyHandler: document.querySelector('.copy-outreach-body').getAttribute('onclick'),
        receiptCount: document.querySelector('#applied-verified-pill').textContent,
      };
    });
    assert.match(result.appliedText, /<img/);
    assert.equal(result.posting, '#');
    assert.equal(result.images, 0);
    assert.equal(result.inlineCopyHandler, null);
    assert.equal(result.receiptCount, '0');
    assert.equal(await page.evaluate(() => window.__dashboardInjected), undefined);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    process.chdir(previous);
    if (previousToken === undefined) delete process.env.AUTOAPPLY_DASHBOARD_TOKEN; else process.env.AUTOAPPLY_DASHBOARD_TOKEN = previousToken;
    rmSync(directory, { recursive: true, force: true });
  }
});
