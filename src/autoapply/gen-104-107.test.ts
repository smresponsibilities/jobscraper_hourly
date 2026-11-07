import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { unwrapDirectAtsApplicationUrl } from './url-unwrapper.js';
import { enforceHumanSubmissionPacingFloor } from './ram-and-pacing.js';
import { getProviderTimeoutConfig } from './watchdog-timer.js';
import { ensureSmartRecruitersApplicationStarted } from './runner.js';

describe('GEN-104: Greenhouse, Ashby & Lever timing and unwrapping optimizations', () => {
  it('unwrapDirectAtsApplicationUrl appends /apply to Lever overview URLs', () => {
    const rawLeverUrl = 'https://jobs.lever.co/beghouconsulting/c617f838-8297-44a3-aadb-db9b19d8fe43';
    const unwrapped = unwrapDirectAtsApplicationUrl(rawLeverUrl);
    assert.strictEqual(
      unwrapped,
      'https://jobs.lever.co/beghouconsulting/c617f838-8297-44a3-aadb-db9b19d8fe43/apply',
      'Should append /apply to Lever job posting URLs'
    );
  });

  it('unwrapDirectAtsApplicationUrl preserves already-applied Lever URLs', () => {
    const appliedLeverUrl = 'https://jobs.lever.co/beghouconsulting/c617f838-8297-44a3-aadb-db9b19d8fe43/apply';
    const unwrapped = unwrapDirectAtsApplicationUrl(appliedLeverUrl);
    assert.strictEqual(unwrapped, appliedLeverUrl, 'Should not modify URL if /apply is already present');
  });

  it('enforceHumanSubmissionPacingFloor returns 0ms when elapsed >= 18000ms', async () => {
    const fakePage = {
      evaluate: async () => {},
      waitForTimeout: async () => {},
      mouse: { move: async () => {} },
    } as any;

    const formOpenedAtMs = Date.now() - 25_000; // 25s elapsed already
    const dwellMs = await enforceHumanSubmissionPacingFloor(fakePage, formOpenedAtMs, 10);
    assert.strictEqual(dwellMs, 0, 'Dwell must be 0ms when already spent >= 18s on the form');
  });

  it('getProviderTimeoutConfig provides 150s for ATS and 180s for Workday with 45s/50s idle stall', () => {
    const ghCfg = getProviderTimeoutConfig('https://job-boards.greenhouse.io/enterpret/jobs/7723230003');
    assert.strictEqual(ghCfg.maxTotalMs, 150_000, 'Greenhouse total timeout must be 150s');
    assert.strictEqual(ghCfg.maxIdleMs, 45_000, 'Greenhouse idle timeout must be 45s');

    const ashbyCfg = getProviderTimeoutConfig('https://jobs.ashbyhq.com/coram-ai/4689a957-bf88-4eea-9b32-004025bf4544');
    assert.strictEqual(ashbyCfg.maxTotalMs, 150_000, 'Ashby total timeout must be 150s');

    const leverCfg = getProviderTimeoutConfig('https://jobs.lever.co/hevodata/6cbbe304-e065-4711-bf3e-756795d2bc2a/apply');
    assert.strictEqual(leverCfg.maxTotalMs, 150_000, 'Lever total timeout must be 150s');

    const srCfg = getProviderTimeoutConfig('https://jobs.smartrecruiters.com/oneclick-ui/company/Coface/publication/8a9b1c2d-3e4f-4a5b-6c7d-8e9f0a1b2c3d');
    assert.strictEqual(srCfg.maxTotalMs, 150_000, 'SmartRecruiters total timeout must be 150s');

    const wdCfg = getProviderTimeoutConfig('https://citi.wd5.myworkdayjobs.com/en-US/2/job/Pune/Data-Engineer_261000770');
    assert.strictEqual(wdCfg.maxTotalMs, 180_000, 'Workday total timeout must be 180s');
    assert.strictEqual(wdCfg.maxIdleMs, 50_000, 'Workday idle timeout must be 50s');
  });
});

describe('GEN-105 & GEN-106: SmartRecruiters UUID resolution & numeric-ID guard', () => {
  it('ensureSmartRecruitersApplicationStarted goes back if on numeric ID publication URL', async () => {
    let wentBack = false;
    const fakePage = {
      url: () => 'https://jobs.smartrecruiters.com/oneclick-ui/company/Coface/publication/744000123456789',
      goBack: async () => { wentBack = true; },
      locator: () => ({
        isVisible: async () => false,
        click: async () => {},
        first: () => ({
          isVisible: async () => false,
          click: async () => {},
          waitFor: async () => {},
        }),
      }),
      waitForTimeout: async () => {},
    } as any;

    await ensureSmartRecruitersApplicationStarted(fakePage);
    assert.strictEqual(wentBack, true, 'Should navigate back if on /publication/<10+ digits> numeric ID URL');
  });

  it('ensureSmartRecruitersApplicationStarted resolves UUID from apply button href', async () => {
    let navigatedUrl = '';
    const fakePage = {
      url: () => 'https://jobs.smartrecruiters.com/BlueOptima/744000012345678-developer',
      locator: () => ({
        isVisible: async () => true,
        first: () => ({
          isVisible: async () => true,
          getAttribute: async (attr: string) =>
            attr === 'href'
              ? 'https://jobs.smartrecruiters.com/oneclick-ui/company/BlueOptima/publication/a1b2c3d4-e5f6-7890-abcd-ef1234567890?dcr_ci=BlueOptima'
              : null,
          click: async () => {},
          waitFor: async () => {},
        }),
      }),
      goto: async (target: string) => { navigatedUrl = target; },
      waitForTimeout: async () => {},
    } as any;

    await ensureSmartRecruitersApplicationStarted(fakePage);
    assert.ok(navigatedUrl.includes('/oneclick-ui/company/BlueOptima/publication/a1b2c3d4-e5f6-7890-abcd-ef1234567890'));
    assert.strictEqual(navigatedUrl.includes('/publication/744000012345678'), false, 'Must NEVER use 15-digit numeric ID in publication URL');
  });
});
