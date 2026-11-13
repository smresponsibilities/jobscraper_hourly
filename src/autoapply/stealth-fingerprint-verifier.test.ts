import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getMandatoryStealthLaunchArgs, verifyPageStealthInvariants } from './stealth-fingerprint-verifier.js';
test('reports observed failures rather than assuming stealth', async () => {
  assert(getMandatoryStealthLaunchArgs().includes('--enforce-webrtc-ip-permission-check'));
  const page = { evaluate: async () => ({ webdriverFalse: true, userAgentClean: false, timezoneValid: true, languagesValid: true }) } as any;
  const result = await verifyPageStealthInvariants(page);
  assert.equal(result.passed, false);
  assert.deepEqual(result.issues, ['userAgentClean']);
});
