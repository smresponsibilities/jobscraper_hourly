import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ensureWorkdayCompliantPassword } from './env-credentials.js';
import { CredentialVault } from './vault.js';
import { ensureSmartRecruitersApplicationStarted } from './runner.js';
import { isOfflineDinoOrNetworkError } from './power-net-recovery.js';
import { getAppliedJobsData, getDashboardTelemetry } from '../../scripts/dashboard-server.js';

describe('GEN-100: Auto-provisioning Workday and SmartRecruiters credentials', () => {
  it('ensureWorkdayCompliantPassword satisfies Workday password complexity constraints', () => {
    const rawPass = 'simplepass123';
    const compliant = ensureWorkdayCompliantPassword(rawPass);

    assert.ok(compliant.length >= 12, 'Password must be >= 12 characters');
    assert.match(compliant, /[A-Z]/, 'Must contain uppercase letter');
    assert.match(compliant, /[a-z]/, 'Must contain lowercase letter');
    assert.match(compliant, /\d/, 'Must contain numeric digit');
    assert.match(compliant, /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/, 'Must contain special character');
  });

  it('CredentialVault.get auto-provisions env credentials for unknown Workday tenant', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
    try {
      process.env.AUTOAPPLY_EMAIL = process.env.AUTOAPPLY_EMAIL || 'testuser@example.com';
      process.env.AUTOAPPLY_PASSWORD = process.env.AUTOAPPLY_PASSWORD || 'TestPass123!@#';

      const vault = new CredentialVault(tempDir, randomBytes(32));
      const tenant = 'lloyds.wd3.myworkdayjobs.com';
      const creds = vault.get(tenant);

      assert.ok(creds, 'Credentials should be auto-provisioned');
      assert.strictEqual(creds.email, process.env.AUTOAPPLY_EMAIL);
      assert.ok(creds.password.length >= 12);
      assert.match(creds.password, /[A-Z]/);
      assert.match(creds.password, /[a-z]/);
      assert.match(creds.password, /\d/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('CredentialVault.get auto-provisions env credentials for unknown SmartRecruiters tenant', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
    try {
      process.env.AUTOAPPLY_EMAIL = process.env.AUTOAPPLY_EMAIL || 'testuser@example.com';
      process.env.AUTOAPPLY_PASSWORD = process.env.AUTOAPPLY_PASSWORD || 'TestPass123!@#';

      const vault = new CredentialVault(tempDir, randomBytes(32));
      const tenant = 'jobs.smartrecruiters.com';
      const creds = vault.get(tenant);

      assert.ok(creds, 'SmartRecruiters credentials should be auto-provisioned');
      assert.strictEqual(creds.email, process.env.AUTOAPPLY_EMAIL);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('GEN-101: SmartRecruiters OneClick entry gate', () => {
  it('ensureSmartRecruitersApplicationStarted handles already oneclick-ui URL without navigation', async () => {
    let navigated = false;
    const fakePage = {
      url: () => 'https://jobs.smartrecruiters.com/oneclick-ui/company/job-id',
      locator: () => ({
        isVisible: async () => false,
        click: async () => {},
        first: () => ({
          isVisible: async () => false,
          click: async () => {},
          waitFor: async () => {},
        }),
      }),
      goto: async () => { navigated = true; },
      waitForLoadState: async () => {},
      waitForTimeout: async () => {},
    } as any;

    await ensureSmartRecruitersApplicationStarted(fakePage);
    assert.strictEqual(navigated, false, 'Should not navigate if already on oneclick-ui');
  });

  it('ensureSmartRecruitersApplicationStarted navigates to oneclick-ui UUID URL from apply button', async () => {
    let targetUrl = '';
    const fakePage = {
      url: () => 'https://jobs.smartrecruiters.com/Miratech/744000037190000-senior-dev',
      locator: () => ({
        isVisible: async () => true,
        click: async () => {},
        getAttribute: async () => 'https://jobs.smartrecruiters.com/oneclick-ui/company/Miratech/publication/3763c791-a387-4078-9ca4-00cbfbf9b1a6',
        first: () => ({
          isVisible: async () => true,
          click: async () => {},
          getAttribute: async () => 'https://jobs.smartrecruiters.com/oneclick-ui/company/Miratech/publication/3763c791-a387-4078-9ca4-00cbfbf9b1a6',
          waitFor: async () => {},
        }),
      }),
      goto: async (url: string) => { targetUrl = url; },
      waitForLoadState: async () => {},
      waitForTimeout: async () => {},
    } as any;

    await ensureSmartRecruitersApplicationStarted(fakePage);
    assert.ok(targetUrl.includes('/oneclick-ui/'), 'Should navigate to oneclick-ui URL');
    assert.ok(targetUrl.includes('3763c791-a387-4078-9ca4-00cbfbf9b1a6'), 'Should use 36-character UUID');
  });
});

describe('GEN-102: Network drop & offline dino recovery', () => {
  it('isOfflineDinoOrNetworkError recognizes DNS, Wi-Fi, and Dino error patterns', () => {
    assert.strictEqual(isOfflineDinoOrNetworkError(new Error('net::ERR_INTERNET_DISCONNECTED')), true);
    assert.strictEqual(isOfflineDinoOrNetworkError(new Error('net::ERR_NAME_NOT_RESOLVED')), true);
    assert.strictEqual(isOfflineDinoOrNetworkError(new Error('page crashed with net::ERR_CONNECTION_RESET')), true);
    assert.strictEqual(isOfflineDinoOrNetworkError(new Error('random application form validation error')), false);
  });
});

describe('GEN-103: Dashboard applied jobs & queue telemetry', () => {
  it('getAppliedJobsData returns verified applied jobs with required schema', () => {
    const data = getAppliedJobsData();
    assert.ok(data, 'Should return data object');
    assert.ok(typeof data.total === 'number');
    assert.ok(Array.isArray(data.jobs));
    assert.ok(data.total >= 48, 'Should have at least 48 verified receipts');

    if (data.jobs.length > 0) {
      const sample = data.jobs[0];
      assert.ok(sample.id, 'Job must have id');
      assert.ok(sample.company, 'Job must have company');
      assert.ok(sample.url, 'Job must have url');
      assert.ok(sample.provider, 'Job must have provider');
      assert.ok(sample.appliedAt, 'Job must have appliedAt');
    }
  });

  it('getDashboardTelemetry returns queued breakdown by ATS provider', () => {
    const tel = getDashboardTelemetry();
    assert.ok(tel, 'Should return telemetry object');
    assert.ok(tel.queuedBreakdown, 'Should have queuedBreakdown');
    assert.ok(typeof tel.queuedBreakdown.greenhouse === 'number');
    assert.ok(typeof tel.queuedBreakdown.ashby === 'number');
    assert.ok(typeof tel.queuedBreakdown.lever === 'number');
    assert.ok(typeof tel.queuedBreakdown.smartrecruiters === 'number');
    assert.ok(typeof tel.queuedBreakdown.workday === 'number');
    assert.ok(tel.queuedBreakdown.total > 0, 'Total queued should be > 0');
  });
});
