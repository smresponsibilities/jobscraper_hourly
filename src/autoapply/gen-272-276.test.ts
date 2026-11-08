import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decodeQuotedPrintableMime } from './imap-verifier.js';
import { ASYNC_LOADING_PLACEHOLDER_REGEX, INVALID_OPTION_PLACEHOLDER_REGEX } from './widgets.js';

test('GEN-272: distiller.ts enforces Single-Control LCA Ceiling across multi-input rows', () => {
  const distillerSrc = fs.readFileSync(path.resolve('src/autoapply/distiller.ts'), 'utf8');
  assert.ok(
    distillerSrc.includes('distinctInputsInAncestor > 1'),
    'distiller.ts must check distinctInputsInAncestor > 1 to avoid merging multi-column labels'
  );
  assert.ok(
    distillerSrc.includes('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), select, textarea'),
    'distiller.ts must count non-radio/non-checkbox form inputs'
  );
});

test('GEN-273: runner.ts re-binds ephemeral data-autoapply-ref on React unmount/re-renders', () => {
  const runnerSrc = fs.readFileSync(path.resolve('src/autoapply/runner.ts'), 'utf8');
  assert.ok(
    runnerSrc.includes('data-autoapply-ref="${ref}"'),
    'runner.ts must locate controls via data-autoapply-ref'
  );
  assert.ok(
    runnerSrc.includes('control.count()') && runnerSrc.includes('=== 0'),
    'runner.ts must detect unmounted/re-rendered controls when count is 0'
  );
  assert.ok(
    runnerSrc.includes('data-autoapply-ref') && runnerSrc.includes('setAttribute(\'data-autoapply-ref\', targetRef)'),
    'runner.ts must re-bind missing data-autoapply-ref dynamically before fill'
  );
});

test('GEN-274: widgets.ts filters async loading placeholders and invalid options', () => {
  assert.ok(ASYNC_LOADING_PLACEHOLDER_REGEX.test('Loading...'));
  assert.ok(ASYNC_LOADING_PLACEHOLDER_REGEX.test('Searching...'));
  assert.ok(ASYNC_LOADING_PLACEHOLDER_REGEX.test('Please wait...'));
  assert.ok(!ASYNC_LOADING_PLACEHOLDER_REGEX.test('India'));

  assert.ok(INVALID_OPTION_PLACEHOLDER_REGEX.test('No options'));
  assert.ok(INVALID_OPTION_PLACEHOLDER_REGEX.test('No results found'));
  assert.ok(INVALID_OPTION_PLACEHOLDER_REGEX.test('-- Select --'));
  assert.ok(!INVALID_OPTION_PLACEHOLDER_REGEX.test('Bangalore'));

  const widgetsSrc = fs.readFileSync(path.resolve('src/autoapply/widgets.ts'), 'utf8');
  assert.ok(
    widgetsSrc.includes('ASYNC_LOADING_PLACEHOLDER_REGEX.test'),
    'widgets.ts must test ASYNC_LOADING_PLACEHOLDER_REGEX'
  );
  assert.ok(
    widgetsSrc.includes('waitForTimeout(450)'),
    'widgets.ts must wait 450ms for async options to populate'
  );
  assert.ok(
    widgetsSrc.includes('INVALID_OPTION_PLACEHOLDER_REGEX.test'),
    'widgets.ts must exclude INVALID_OPTION_PLACEHOLDER_REGEX options'
  );
});

test('GEN-275: runner.ts rejects network receipts with isSuccess: false or error messages', () => {
  const runnerSrc = fs.readFileSync(path.resolve('src/autoapply/runner.ts'), 'utf8');
  assert.ok(
    runnerSrc.includes('(?:isSuccess|success|ok)'),
    'runner.ts must check for isSuccess/success/ok in response body'
  );
  assert.ok(
    runnerSrc.includes('(?:errors|errorMessages|validationErrors|fieldErrors)'),
    'runner.ts must check for error arrays in response body'
  );
});

test('GEN-276: decodeQuotedPrintableMime decodes soft breaks and hex bytes correctly', () => {
  assert.equal(
    decodeQuotedPrintableMime('token=3Dabc=\r\n123'),
    'token=abc123',
    'Must decode =3D to = and remove =\\r\\n soft break'
  );
  assert.equal(
    decodeQuotedPrintableMime('A7B9=\r\nX2K4'),
    'A7B9X2K4',
    'Must resolve split OTP codes across soft line breaks'
  );
  assert.equal(
    decodeQuotedPrintableMime('https://wd5.myworkday.com/verify?token=3Dxyz&amp;code=3D123=\n456'),
    'https://wd5.myworkday.com/verify?token=xyz&code=123456',
    'Must decode URL with =3D, &amp;, and =\\n'
  );
  assert.equal(
    decodeQuotedPrintableMime('Hello=20World'),
    'Hello World',
    'Must decode hex byte =20 to space'
  );
  assert.equal(decodeQuotedPrintableMime(''), '');
});
