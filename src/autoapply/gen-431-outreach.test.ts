import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { verifyDomainMxRecords } from '../outreach/free-contact-discovery.js';
import { isDomainOnCooldown } from '../outreach/outreach-ledger.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

test('GEN-431: verifyDomainMxRecords confirms real mail domains and rejects invalid', async () => {
  const isGmailValid = await verifyDomainMxRecords('gmail.com');
  assert.strictEqual(isGmailValid, true, 'gmail.com must have valid MX records');

  const isInvalidValid = await verifyDomainMxRecords('this-domain-does-not-exist-xyz999.invalid');
  assert.strictEqual(isInvalidValid, false, 'Invalid domain must fail MX resolution');
});

test('GEN-431: isDomainOnCooldown respects 30-day window', () => {
  const tmpDir = path.resolve(process.cwd(), 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const testLedger = path.join(tmpDir, 'test-sent-ledger.json');

  const now = new Date();
  const twentyDaysAgo = new Date(now.getTime() - (20 * 24 * 60 * 60 * 1000)).toISOString();
  const fortyDaysAgo = new Date(now.getTime() - (40 * 24 * 60 * 60 * 1000)).toISOString();

  fs.writeFileSync(testLedger, JSON.stringify([
    { domain: 'recent-company.com', sentAt: twentyDaysAgo },
    { domain: 'old-company.com', sentAt: fortyDaysAgo }
  ]));

  assert.strictEqual(isDomainOnCooldown('recent-company.com', testLedger), true);
  assert.strictEqual(isDomainOnCooldown('old-company.com', testLedger), false);
  assert.strictEqual(isDomainOnCooldown('uncontacted.com', testLedger), false);
});
