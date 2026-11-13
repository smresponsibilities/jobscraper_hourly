import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preflightJob } from './preflight.js';
import { ensureGreenhouseFormHydrated, ensureAshbyFormHydrated } from './runner.js';

test('SmartRecruiters deferral occurs before any network access', async () => {
  const original = process.env.ENABLE_SMARTRECRUITERS;
  delete process.env.ENABLE_SMARTRECRUITERS;
  try {
    const result = await preflightJob({ title: 'Engineer', company: 'Example', url: 'https://jobs.smartrecruiters.com/example/123' }, {} as never, { fetcher: (() => { throw new Error('unexpected fetch'); }) as typeof fetch });
    assert.equal(result.reason, 'smartrecruiters_login_wall_deferred');
    assert.equal(result.status, 'skipped');
  } finally {
    if (original === undefined) delete process.env.ENABLE_SMARTRECRUITERS; else process.env.ENABLE_SMARTRECRUITERS = original;
  }
});

test('hydration helpers wait for form readiness and dismiss Ashby consent', async () => {
  let selectorWaited = false, readinessWaited = false, clicked = false;
  const frame = { waitForSelector: async () => { selectorWaited = true; }, waitForFunction: async () => { readinessWaited = true; } };
  assert.equal(await ensureGreenhouseFormHydrated(frame as never, 100), true);
  assert(selectorWaited && readinessWaited);
  const page = { locator: () => ({ first: () => ({ isVisible: async () => true, click: async () => { clicked = true; } }) }), waitForFunction: async () => {} };
  assert.equal(await ensureAshbyFormHydrated(page as never, 100), true);
  assert(clicked);
});
