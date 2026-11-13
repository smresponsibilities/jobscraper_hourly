import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deriveWorkdayCompliantPassword, extractWorkdayTenantKey, getWorkdayTenantQuirks, recordWorkdayTenantQuirk } from './workday-tenant-registry.js';
import { coerceFieldValueByErrorMessage } from './validation-healer.js';

test('tenant registry persists valid quirks and preserves corrupt files', () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'tenant-registry-')), 'registry.json');
  const url = 'https://example.wd5.myworkdayjobs.com/en-US/Careers/job/one';
  assert.equal(extractWorkdayTenantKey(url), 'example.wd5.myworkdayjobs.com/careers');
  assert.equal(extractWorkdayTenantKey('https://stripe.wd5.myworkdayjobs.com/Careers'), null);
  assert.deepEqual(getWorkdayTenantQuirks(url, file), {});
  recordWorkdayTenantQuirk(url, { requiresNumericNoticeDays: true }, file);
  assert.equal(getWorkdayTenantQuirks(url, file).requiresNumericNoticeDays, true);
  writeFileSync(file, '{bad json');
  assert.deepEqual(getWorkdayTenantQuirks(url, file), {});
  assert.throws(() => recordWorkdayTenantQuirk(url, { verifiedLocale: 'en-US' }, file));
  assert.equal(readFileSync(file, 'utf8'), '{bad json');
});

test('new Workday passwords satisfy policy and remain deterministic', () => {
  for (let i = 0; i < 100; i++) {
    const password = deriveWorkdayCompliantPassword('fixture-secret', `tenant-${i}`, { maxLength: 12, allowedSymbols: '@' });
    assert.equal(password, deriveWorkdayCompliantPassword('fixture-secret', `tenant-${i}`, { maxLength: 12, allowedSymbols: '@' }));
    assert.equal(password.length, 12);
    assert((password.match(/[A-Z]/g) || []).length >= 2);
    assert((password.match(/[a-z]/g) || []).length >= 2);
    assert((password.match(/[0-9]/g) || []).length >= 2);
    assert(password.includes('@'));
    assert(!/(.)\1/.test(password));
  }
  assert.throws(() => deriveWorkdayCompliantPassword('secret', 'tenant', { maxLength: 11 }));
  assert.throws(() => deriveWorkdayCompliantPassword('secret', 'tenant', { minLength: -1 }));
  assert.throws(() => deriveWorkdayCompliantPassword('secret', 'tenant', { allowedSymbols: '$' }));
});

test('validation healing never invents values', () => {
  assert.equal(coerceFieldValueByErrorMessage('', 'must be a number'), '');
  assert.equal(coerceFieldValueByErrorMessage('Immediate', 'must be a number'), 'Immediate');
  assert.equal(coerceFieldValueByErrorMessage('1,200', 'must be a number'), '1200');
  assert.equal(coerceFieldValueByErrorMessage('N/A', 'enter a valid URL'), 'N/A');
  assert.equal(coerceFieldValueByErrorMessage('example.test/path', 'enter a valid URL'), 'https://example.test/path');
  assert.equal(coerceFieldValueByErrorMessage('08/2026', 'valid date yyyy-mm-dd'), '08/2026');
});
