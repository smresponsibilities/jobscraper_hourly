import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import type { Page } from 'patchright';
import { AutoApplyRunner } from './runner.js';
import type { CandidateExtendedProfile } from './types.js';

test('degree autocomplete falls back to a unique bachelor level', async () => {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<label for="degree">Degree</label><input id="degree" role="combobox" aria-autocomplete="list" aria-controls="degrees" required><ul id="degrees" role="listbox" hidden><li role="option">Bachelor's Degree</li></ul><script>const input=document.querySelector('#degree'), list=document.querySelector('#degrees');input.addEventListener('input',()=>{list.hidden=input.value!=='Bachelor'});list.addEventListener('click',()=>{input.value='';input.setAttribute('aria-valuetext',"Bachelor's Degree");list.hidden=true});</script>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test' }, professional: {}, workAuthorization: {}, eeo: {}, education: [{ degree: 'Bachelor of Engineering' }], experience: [] } as unknown as CandidateExtendedProfile;
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile, submit: false, keepOpen: true, timeoutMs: 1000 });
    assert.equal(report.actions.some(action => action.category === 'degree' && action.status === 'filled'), true);
    const page = (runner as unknown as { page: Page }).page;
    assert.equal(await page.locator('#degree').getAttribute('aria-valuetext'), "Bachelor's Degree");
  } finally { await runner.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('paced wizard enforces step and review dwell before native navigation and submission', { timeout: 120000 }, async () => {
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(`<h1>Information</h1><button id=next>Next</button><script>document.documentElement.dataset.enteredAt=Date.now();document.querySelector('#next').addEventListener('click',()=>{document.documentElement.dataset.nextAt=Date.now();document.body.innerHTML='<h1>Review</h1><label>Email<input type=email required></label><button id=send>Submit application</button>';document.querySelector('input').addEventListener('input',()=>document.documentElement.dataset.lastEdit=Date.now());document.querySelector('#send').addEventListener('click',()=>{document.documentElement.dataset.submitAt=Date.now();document.body.innerHTML='<h1>Thank you for applying</h1>';});});</script>`); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile, mode: 'stealth', submit: true, headless: false });
    assert.equal(report.status, 'submitted', report.reason);
    const page = (runner as unknown as { page: Page }).page;
    const times = await page.locator('html').evaluate(element => ({ entered: Number((element as HTMLElement).dataset.enteredAt), next: Number((element as HTMLElement).dataset.nextAt), edited: Number((element as HTMLElement).dataset.lastEdit), submitted: Number((element as HTMLElement).dataset.submitAt) }));
    assert(times.next - times.entered >= 4000);
    assert(times.submitted - times.edited >= 15000);
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('paced typing repairs reordered controlled input and refuses values the page cannot retain', async () => {
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const page = (runner as unknown as { page: Page }).page;
    await page.setContent('<input id=email type=email oninput="if(!this.dataset.changed && this.value.length>4){this.dataset.changed=1;this.value=this.value.slice(2)+this.value.slice(0,2)}">');
    const value = 'fixture@example.test';
    await runner.humanType(page.locator('#email'), value);
    assert.equal(await page.locator('#email').inputValue(), value);
    await page.setContent('<input id=blocked oninput="this.value=\'\'">');
    await assert.rejects(runner.humanType(page.locator('#blocked'), value), error => error instanceof Error && error.message === 'Typed field did not retain the intended value');
  } finally { await runner.close(); }
});

test('phone read-back accepts formatting but rejects changed digits or prefix', async () => {
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const page = (runner as unknown as { page: Page }).page;
    await page.setContent('<input type="tel" onblur="this.value=\'+91 99999-99999\'">');
    await runner.humanType(page.locator('input'), '+919999999999');
    await page.setContent('<input type="tel" onblur="this.value=\'+91 99999-99998\'">');
    await assert.rejects(runner.humanType(page.locator('input'), '+919999999999'));
    await page.setContent('<input type="tel" onblur="this.value=\'91 99999-99999\'">');
    await assert.rejects(runner.humanType(page.locator('input'), '+919999999999'));
  } finally { await runner.close(); }
});

test('paced mode emits pointer trajectories and trusted keyboard events across checkbox, dropdown and Submit', { timeout: 60000 }, async () => {
  let posts = 0;
  const server = createServer((request, response) => {
    if (request.method === 'POST') { posts++; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ success: true, applicationId: 'paced-1' })); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<style>label{display:block;margin:24px}input{margin:8px}li{padding:12px}button{margin:32px}</style><form onsubmit="event.preventDefault();fetch('/applications',{method:'POST',body:'synthetic'})"><label>Willing to relocate<input type=checkbox id=relocate checked></label><label for=country>Country</label><input id=country role=combobox aria-autocomplete=list aria-controls=countries onclick="document.querySelector('#countries').hidden=false"><ul id=countries role=listbox hidden><li id=india role=option onclick="document.querySelector('#country').value='';document.querySelector('#country').setAttribute('aria-valuetext','India');this.parentElement.hidden=true">India</li></ul><label>Email<input id=email type=email required></label><button id=send>Submit application</button></form><script>window.trace=[];function record(event){window.trace.push(event);document.documentElement.dataset.trace=JSON.stringify(window.trace)}let moves=0;document.addEventListener('mousemove',()=>moves++);document.addEventListener('click',e=>{record({kind:'click',id:e.target.id,moves,trusted:e.isTrusted});moves=0});for(const kind of ['keydown','input','keyup','focusin','focusout'])document.addEventListener(kind,e=>record({kind,id:e.target.id,trusted:e.isTrusted}));</script>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const profile = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: { willingToRelocate: false }, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile, mode: 'stealth', headless: false, applicationCountry: 'India', submit: true, timeoutMs: 5000 });
    assert.equal(report.status, 'submitted', report.reason); assert.equal(posts, 1);
    const page = (runner as unknown as { page: Page }).page;
    const trace = JSON.parse((await page.locator('html').getAttribute('data-trace'))!) as Array<{ kind: string; id: string; moves: number; trusted: boolean }>;
    for (const id of ['relocate', 'country', 'india', 'send']) {
      const clicks = trace.filter(event => event.kind === 'click' && event.id === id);
      assert.equal(clicks.length, 1, `${id} must not toggle twice`);
      assert(clicks[0]!.moves >= 3, `${id} needs an actual curved pointer trajectory`);
      assert.equal(clicks[0]!.trusted, true);
    }
    for (const kind of ['keydown', 'input', 'keyup', 'focusin', 'focusout']) assert(trace.some(event => event.id === 'email' && event.kind === kind && event.trusted));
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('launcher preserves native viewport and hardware API implementations', async () => {
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(false);
    const page = (runner as unknown as { page: Page }).page;
    assert.equal(page.viewportSize(), null);
    await page.goto('chrome://version');
    const command = await page.locator('#command_line').innerText();
    assert(!command.includes('--enable-automation'));
    const metrics = await page.evaluate(async () => {
      const audio = new AudioContext(); const sampleRate = audio.sampleRate; await audio.close();
      return { webdriver: navigator.webdriver, platform: navigator.platform, width: innerWidth, outer: outerWidth, audioRate: sampleRate, audioNative: AudioContext.toString().includes('[native code]'), webglNative: WebGLRenderingContext.prototype.getParameter.toString().includes('[native code]'), cores: navigator.hardwareConcurrency };
    });
    assert.equal(metrics.webdriver, false); assert(metrics.width > 0 && metrics.outer >= metrics.width);
    assert(metrics.audioRate > 0 && metrics.audioNative && metrics.webglNative && metrics.cores > 0);
    if (process.platform === 'win32') assert.equal(metrics.platform, 'Win32');
  } finally { await runner.close(); }
});

