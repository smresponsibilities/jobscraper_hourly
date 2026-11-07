import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { AutoApplyRunner } from './runner.js';
import { ATS_STRATEGIES, identifyApplicationAts } from './wizard.js';
import type { CandidateExtendedProfile } from './types.js';

const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', city: 'Bengaluru', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [], recruitmentPrivacyConsent: true } as unknown as CandidateExtendedProfile;

test('strategy detection covers all requested ATS domains without matching lookalike hosts', () => {
  for (const [provider, strategy] of Object.entries(ATS_STRATEGIES)) {
    for (const domain of strategy.domains) {
      assert.equal(identifyApplicationAts(`https://careers.${domain}/job`), provider);
      assert.equal(identifyApplicationAts(`https://${domain}.example.test/job`), 'generic');
    }
  }
  assert.equal(identifyApplicationAts('https://example.test', '<div data-automation-id="ordinary-component">'), 'generic');
});

// Synthetic contracts exercise navigation and transport, not live certification.
for (const provider of ['icims', 'smartrecruiters', 'workable', 'oracle', 'successfactors', 'taleo', 'recruitee']) {
  test(`${provider} contract fills controls and observes exactly one local submission`, { timeout: 45000 }, async () => {
    let origin = ''; let submissions = 0;
    const field = '<label id="email-label">Email</label><input id="email" type="email" aria-labelledby="email-label" required>';
    const form = `<form onsubmit="event.preventDefault();fetch('/submit',{method:'POST'}).then(()=>{this.innerHTML='<h1>Application submitted</h1>'})">${field}${provider === 'recruitee' ? '<label>I agree to the recruitment privacy notice<input type="checkbox" required></label>' : ''}<button>${provider === 'smartrecruiters' ? 'Send Application' : 'Submit Application'}</button></form>`;
    const server = createServer((request, response) => {
      response.setHeader('Content-Type', 'text/html');
      if (request.url === '/submit') { submissions++; response.end('accepted'); return; }
      if (request.url === '/child') { response.end(form); return; }
      if (request.url === '/next') { setTimeout(() => response.end('ready'), 300); return; }
      if (provider === 'icims') response.end(`<iframe id="icims_content_iframe" src="${origin.replace('127.0.0.1', 'localhost')}/child"></iframe>`);
      else if (provider === 'oracle') response.end(`<spl-form-field id="host"></spl-form-field><script>document.querySelector('#host').attachShadow({mode:'open'}).innerHTML=${JSON.stringify(form)}</script>`);
      else if (provider === 'successfactors' || provider === 'taleo') response.end(`<div ${provider === 'successfactors' ? 'id="applyForm"' : 'class="tal-form"'}><h1>First step</h1><input type="button" value="${provider === 'taleo' ? 'Save and Continue' : 'Next'}" onclick="fetch('/next').then(()=>this.parentElement.innerHTML=${JSON.stringify(form).replaceAll('&', '&amp;').replaceAll('"', '&quot;')})"></div>`);
      else response.end(`<section ${provider === 'workable' ? 'data-ui="application-form"' : `class="${provider === 'recruitee' ? 'offer-apply-form' : 'smartrec-apply'}"`}>${form}</section>`);
    });
    await new Promise<void>(resolve => server.listen(0, '0.0.0.0', resolve));
    const address = server.address(); assert(address && typeof address !== 'string'); origin = `http://127.0.0.1:${address.port}`;
    const runner = new AutoApplyRunner();
    try {
      await runner.initBrowser(true);
      const report = await runner.run({ url: origin, profile, submit: true, advanceReviewedStep: true, maxSteps: 3, headless: false });
      assert.equal(report.ats, provider);
      assert.equal(report.status, 'submitted', report.reason + JSON.stringify(report.actions));
      assert.equal(submissions, 1);
      assert(report.actions.some(action => action.status === 'filled' && action.value === profile.personal.email));
      assert(report.receipt);
    } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
}
