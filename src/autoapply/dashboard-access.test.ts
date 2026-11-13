import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTrustedDashboardRequest } from './dashboard-access.js';

const token = 'a'.repeat(40);
const local = { remoteAddress: '127.0.0.1', host: '127.0.0.1:4321', method: 'GET', path: '/api/extension-brain' };
test('dashboard rejects remote hosts, rebinding, untrusted origins and missing tokens', () => {
  assert.equal(isTrustedDashboardRequest({ ...local, authorization: `Bearer ${token}` }, token), true);
  assert.equal(isTrustedDashboardRequest({ ...local }, token), false);
  assert.equal(isTrustedDashboardRequest({ ...local, authorization: `Bearer ${token}`, remoteAddress: '192.0.2.4' }, token), false);
  assert.equal(isTrustedDashboardRequest({ ...local, authorization: `Bearer ${token}`, host: 'attacker.example:4321' }, token), false);
  assert.equal(isTrustedDashboardRequest({ ...local, authorization: `Bearer ${token}`, origin: 'https://attacker.example' }, token), false);
  assert.equal(isTrustedDashboardRequest({ ...local, authorization: `Bearer ${token}`, origin: `chrome-extension://${'a'.repeat(32)}` }, token), true);
  assert.equal(isTrustedDashboardRequest({ ...local, path: '/api/action', method: 'POST', origin: 'https://attacker.example' }, token), false);
  assert.equal(isTrustedDashboardRequest({ ...local, method: 'OPTIONS', origin: 'https://attacker.example' }, token), false);
  assert.equal(isTrustedDashboardRequest({ ...local, authorization: `Bearer ${token}` }, ''), false);
});
