import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import dns from 'node:dns';
import assert from 'node:assert';
import {
  sendVerifiedOutreachEmail,
  ZeroBounceBlockedError,
  DEFAULT_QUARANTINE_PATH,
} from '../src/outreach/zero-bounce-verifier.js';

async function runTests() {
  console.log('[TEST-GEN-534] Starting RFC 5321 Zero-Bounce Gate verification...');

  const mockTransporter = {
    sendMail: async (options: any) => ({
      messageId: `mock_${Date.now()}`,
      accepted: [options.to],
    }),
  };

  const testQuarantinePath = 'state/outreach/test-quarantined-guesses.json';
  if (fs.existsSync(testQuarantinePath)) {
    fs.unlinkSync(testQuarantinePath);
  }

  // 1. TIER_A_VERBATIM_OBSERVED with evidenceUrl -> Must PASS
  const leadA = {
    transporter: mockTransporter,
    mailOptions: { to: 'founder@example.com', text: 'Hello' },
    to: 'founder@example.com',
    provenanceTier: 'TIER_A_VERBATIM_OBSERVED' as const,
    evidenceUrl: 'https://github.com/example/repo/commit/123.patch',
    quarantinePath: testQuarantinePath,
  };
  const resA = await sendVerifiedOutreachEmail(leadA);
  assert(resA.messageId, 'Lead A should succeed');
  console.log('✔ TIER_A with evidenceUrl passed successfully');

  // 1b. TIER_A without evidenceUrl -> Must FAIL and quarantine
  let blockedA = false;
  try {
    await sendVerifiedOutreachEmail({
      ...leadA,
      evidenceUrl: '',
    });
  } catch (err: any) {
    console.log('Caught expected error in 1b:', err?.name, err?.constructor?.name, err?.message);
    if (err instanceof ZeroBounceBlockedError || err?.name === 'ZeroBounceBlockedError' || /ZeroBounceBlocked/i.test(err?.message)) {
      blockedA = true;
    }
  }
  assert(blockedA, 'TIER_A without evidenceUrl must throw ZeroBounceBlockedError');
  console.log('✔ TIER_A without evidenceUrl correctly blocked');

  // 2. TIER_B_MAILBOX_VERIFIED with status VALID & non-catchall -> Must PASS
  const leadB = {
    transporter: mockTransporter,
    mailOptions: { to: 'cto@example.com', text: 'Hello' },
    to: 'cto@example.com',
    provenanceTier: 'TIER_B_MAILBOX_VERIFIED' as const,
    mailboxStatus: 'VALID',
    isCatchAll: false,
    quarantinePath: testQuarantinePath,
  };
  const resB = await sendVerifiedOutreachEmail(leadB);
  assert(resB.messageId, 'Lead B should succeed');
  console.log('✔ TIER_B (VALID, non-catchall) passed successfully');

  // 2b. TIER_B with catchAll: true -> Must FAIL
  let blockedBCatchAll = false;
  try {
    await sendVerifiedOutreachEmail({
      ...leadB,
      isCatchAll: true,
    });
  } catch (err: any) {
    if (err instanceof ZeroBounceBlockedError) {
      blockedBCatchAll = true;
    }
  }
  assert(blockedBCatchAll, 'TIER_B catch-all must throw ZeroBounceBlockedError');
  console.log('✔ TIER_B catch-all correctly blocked');

  // 3. TIER_C_UNVERIFIED_GUESS -> Must FAIL and write to quarantined-guesses.json
  const leadC = {
    transporter: mockTransporter,
    mailOptions: { to: 'talent@startup.io', text: 'Hello' },
    to: 'talent@startup.io',
    provenanceTier: 'TIER_C_UNVERIFIED_GUESS' as const,
    quarantinePath: testQuarantinePath,
  };
  let blockedC = false;
  try {
    await sendVerifiedOutreachEmail(leadC);
  } catch (err: any) {
    if (err instanceof ZeroBounceBlockedError) {
      blockedC = true;
    }
  }
  assert(blockedC, 'TIER_C must throw ZeroBounceBlockedError');

  // Verify file written to testQuarantinePath
  assert(fs.existsSync(testQuarantinePath), 'Quarantine file should exist');
  const quarantined = JSON.parse(fs.readFileSync(testQuarantinePath, 'utf8'));
  assert(Array.isArray(quarantined), 'Quarantine should be an array');
  assert(quarantined.some((q: any) => q.to === 'talent@startup.io'), 'Quarantine must contain talent@startup.io');
  console.log('✔ TIER_C quarantined to file and blocked');

  // Clean test quarantine
  if (fs.existsSync(testQuarantinePath)) {
    fs.unlinkSync(testQuarantinePath);
  }

  console.log('[TEST-GEN-534 PASS] All RFC 5321 zero-bounce gate tests passed.');
}

const originalDirectory = process.cwd();
const originalOutreachSetting = process.env.ENABLE_OUTREACH_EMAIL;
const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-bounce-test-'));
const originalResolveMx = dns.promises.resolveMx;
process.chdir(fixtureDirectory);
dns.promises.resolveMx = async () => [{ exchange: 'mail.fixture.test', priority: 10 }];
// Only the in-memory mock transporter is used by this fixture.
process.env.ENABLE_OUTREACH_EMAIL = 'true';

runTests().catch(err => {
  console.error('[TEST-GEN-534 FAIL]', err);
  process.exitCode = 1;
}).finally(() => {
  if (originalOutreachSetting === undefined) delete process.env.ENABLE_OUTREACH_EMAIL;
  else process.env.ENABLE_OUTREACH_EMAIL = originalOutreachSetting;
  dns.promises.resolveMx = originalResolveMx;
  process.chdir(originalDirectory);
  for (const file of ['test-quarantined-guesses.json', 'domain-mx-cache.json']) {
    const target = path.join(fixtureDirectory, 'state', 'outreach', file);
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
  for (const dir of [path.join(fixtureDirectory, 'state', 'outreach'), path.join(fixtureDirectory, 'state'), fixtureDirectory]) {
    if (fs.existsSync(dir)) fs.rmdirSync(dir);
  }
});
