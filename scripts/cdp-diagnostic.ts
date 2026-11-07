import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
import type { Page } from 'patchright';
import { AutoApplyRunner } from '../src/autoapply/runner.js';
import { sha256 } from '../src/autoapply/submission.js';

// Upstream blob decf524adca8d6306120adafdbe91407dde7adb4, reviewed locally.
const expected = 'cd60904619d05fb6fa9a3f73a748493a50d2ea1d820b492688cf7d75d3a9e0a5';
mkdirSync('out', { recursive: true });
const file = 'out/rebrowser-detector.js';
if (!existsSync(file)) {
  const response = await fetch('https://raw.githubusercontent.com/rebrowser/rebrowser-bot-detector/main/index.js');
  if (!response.ok) throw new Error('Detector source unavailable');
  const source = await response.text();
  assert.equal(sha256(source), expected, 'Upstream changed; review source before updating pin');
  writeFileSync(file, source);
}
const source = readFileSync(file, 'utf8');
assert.equal(sha256(source), expected);
const names = ['dummyFnInit', 'runtimeEnableLeakInit', 'testNavigatorWebdriver', 'testSourceUrl', 'escapeHtml', 'bareFileNamesInStack'];
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text));
assert.equal(functions.length, names.length);
const detector = `const usePatchesTip='';window.detections={};function addDetection(data){window.detections[data.type]=data;document.querySelector('textarea').value=JSON.stringify(window.detections)}\n` + functions.map(node => node.getText(ast)).join('\n') + '\ndummyFnInit();runtimeEnableLeakInit();testNavigatorWebdriver();testSourceUrl();document.getElementById("baseline");';
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/detector.js' ? 'text/javascript' : 'text/html');
  response.end(request.url === '/detector.js' ? detector : '<h1>Local CDP diagnostic</h1><textarea></textarea><script src="/detector.js"></script>');
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address(); assert(address && typeof address !== 'string');
const runner = new AutoApplyRunner();
try {
  await runner.initBrowser(false);
  const page = (runner as unknown as { page: Page }).page;
  await page.goto(`http://127.0.0.1:${address.port}/`);
  const isolatedDummyAccessible = await page.evaluate(() => typeof (window as unknown as { dummyFn?: unknown }).dummyFn !== 'undefined');
  await page.evaluate(() => document.getElementById('probe'));
  await page.waitForTimeout(2000);
  const detections = JSON.parse(await page.locator('textarea').inputValue());
  const result = { upstreamBlob: 'decf524adca8d6306120adafdbe91407dde7adb4', sourceSha256: expected, testedAt: new Date().toISOString(), browser: 'Patchright branded Chrome headed', isolatedDummyAccessible, detections };
  writeFileSync('out/cdp-diagnostic.json', JSON.stringify(result, null, 2));
  assert.equal(isolatedDummyAccessible, false);
  for (const type of ['runtimeEnableLeak', 'navigatorWebdriver', 'sourceUrlLeak']) assert.equal(detections[type]?.rating, -1, `${type} diagnostic failed`);
  assert.equal(detections.dummyFn.rating, 0, 'Main-world trap unexpectedly executed');
  console.log('CDP diagnostic passed: Runtime.enable, webdriver, sourceURL and isolated-world dummyFn boundary');
} finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
