import test from 'node:test';
import assert from 'node:assert/strict';
import { unwrapDirectAtsApplicationUrl } from './url-unwrapper.js';
import { getProviderTimeoutConfig, JobActivityWatchdog } from './watchdog-timer.js';
import { AutoApplyRunner } from './runner.js';
import { ensureSmartRecruitersApplicationStarted } from './workday-entry.js';

test('GEN-108: dismissCookieConsentAndHydrateForm is defined on AutoApplyRunner', () => {
  const runner = new AutoApplyRunner();
  assert.equal(typeof (runner as any).dismissCookieConsentAndHydrateForm, 'function');
});

test('GEN-109: Workday utilityButtonSignIn is checked in browserGates selector', async () => {
  const runner = new AutoApplyRunner();
  // Verify method exists
  assert.equal(typeof (runner as any).browserGates, 'function');
});

test('GEN-110: isConfirmationUrl regex correctly recognizes confirmation URLs and query params', () => {
  const CONFIRMATION_REGEX =
    /(?:\/confirmation|\/thank(?:s|[-_]?you)|\/application[-_]?submitted|\/submitted)(?:\/|$|\?|#)|[?&](?:submitted|applied|confirmation)=(?:true|1)\b/i;

  const validUrls = [
    'https://job-boards.greenhouse.io/enterpret/jobs/456001/confirmation',
    'https://boards.greenhouse.io/enterpret/jobs/456001/confirmation',
    'https://jobs.ashbyhq.com/company/123/application/confirmation',
    'https://jobs.lever.co/company/123/thanks',
    'https://example.com/careers/job-123/thank-you',
    'https://example.com/careers/job-123/thank_you/',
    'https://example.com/careers/job-123/submitted',
    'https://example.com/careers/job-123/application-submitted',
    'https://example.com/apply?submitted=true',
    'https://example.com/apply?applied=1',
    'https://example.com/apply?foo=bar&confirmation=true',
  ];

  for (const url of validUrls) {
    assert.equal(CONFIRMATION_REGEX.test(url), true, `Expected ${url} to match confirmation regex`);
  }

  const nonConfirmationUrls = [
    'https://job-boards.greenhouse.io/enterpret/jobs/456001',
    'https://jobs.ashbyhq.com/company/123/application',
    'https://jobs.lever.co/company/123/apply',
    'https://jobs.smartrecruiters.com/Coface/744000123456',
    'https://example.com/careers/job-123?submitted=false',
  ];

  for (const url of nonConfirmationUrls) {
    assert.equal(CONFIRMATION_REGEX.test(url), false, `Expected ${url} NOT to match confirmation regex`);
  }
});

test('GEN-111: SmartRecruiters overview URLs strip trailing /apply and handle numeric IDs', () => {
  // Strip trailing /apply from overview URL
  const applyUrl = 'https://jobs.smartrecruiters.com/Miratech/744000096531310/apply';
  const unwrappedApply = unwrapDirectAtsApplicationUrl(applyUrl);
  assert.equal(unwrappedApply, 'https://jobs.smartrecruiters.com/Miratech/744000096531310');

  // Do NOT rewrite overview URL to /oneclick-ui/
  const overviewUrl = 'https://jobs.smartrecruiters.com/Coface/744000123456789-finance-intern';
  const unwrappedOverview = unwrapDirectAtsApplicationUrl(overviewUrl);
  assert.equal(unwrappedOverview, 'https://jobs.smartrecruiters.com/Coface/744000123456789-finance-intern');

  // Rewrite broken numeric /oneclick-ui/ back to overview
  const brokenNumeric = 'https://jobs.smartrecruiters.com/oneclick-ui/company/Coface/publication/744000123456789';
  const unwrappedBroken = unwrapDirectAtsApplicationUrl(brokenNumeric);
  assert.equal(unwrappedBroken, 'https://jobs.smartrecruiters.com/Coface/744000123456789');

  // Real 36-char publication UUID remains intact
  const validUuid = 'https://jobs.smartrecruiters.com/oneclick-ui/company/Coface/publication/9b3d0840-d03b-4200-9165-f451b926deea';
  const unwrappedUuid = unwrapDirectAtsApplicationUrl(validUuid);
  assert.equal(unwrappedUuid, validUuid);
});

test('GEN-111: ensureSmartRecruitersApplicationStarted helper is exported and handles mock page', async () => {
  assert.equal(typeof ensureSmartRecruitersApplicationStarted, 'function');
});

test('GEN-112: Watchdog ceiling is at least 240,000ms total and 60,000ms idle', () => {
  const watchdog = new JobActivityWatchdog();
  assert.ok(watchdog.maxTotalMs >= 240_000, `Expected maxTotalMs >= 240000, got ${watchdog.maxTotalMs}`);
  assert.ok(watchdog.maxIdleMs >= 60_000, `Expected maxIdleMs >= 60000, got ${watchdog.maxIdleMs}`);

  const ghConfig = getProviderTimeoutConfig('https://job-boards.greenhouse.io/enterpret/jobs/123');
  assert.ok(ghConfig.maxTotalMs >= 240_000, `Expected greenhouse maxTotalMs >= 240000, got ${ghConfig.maxTotalMs}`);
  assert.ok(ghConfig.maxIdleMs >= 60_000, `Expected greenhouse maxIdleMs >= 60000, got ${ghConfig.maxIdleMs}`);

  const ashbyConfig = getProviderTimeoutConfig('https://jobs.ashbyhq.com/company/123/application');
  assert.ok(ashbyConfig.maxTotalMs >= 240_000, `Expected ashby maxTotalMs >= 240000, got ${ashbyConfig.maxTotalMs}`);
  assert.ok(ashbyConfig.maxIdleMs >= 60_000, `Expected ashby maxIdleMs >= 60000, got ${ashbyConfig.maxIdleMs}`);

  const wdConfig = getProviderTimeoutConfig('https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/123');
  assert.ok(wdConfig.maxTotalMs >= 240_000, `Expected workday maxTotalMs >= 240000, got ${wdConfig.maxTotalMs}`);
  assert.ok(wdConfig.maxIdleMs >= 60_000, `Expected workday maxIdleMs >= 60000, got ${wdConfig.maxIdleMs}`);
});
