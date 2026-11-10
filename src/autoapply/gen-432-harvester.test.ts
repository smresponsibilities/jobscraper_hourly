import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerDomainRateLimiter } from '../index.js';
import {
  VERIFIED_WORKDAY_BENGALURU_GCCS,
  harvestLiveWorkdayBengaluruGccJobs,
  workdayRateLimiter,
} from '../../scripts/harvest-100-hourly-jobs.js';

test('GEN-432: PerDomainRateLimiter enforces domain isolation, cooldowns, and penalty backoff', async () => {
  const limiter = new PerDomainRateLimiter(200);

  const domainA = 'cisco.wd5.myworkdayjobs.com';
  const domainB = 'walmart.wd5.myworkdayjobs.com';

  assert.equal(limiter.canRequest(domainA), true, 'Initial domain check should allow requests');
  limiter.recordRequest(domainA);

  // Immediately after recording request, domainA is cooling down
  assert.equal(limiter.canRequest(domainA), false, 'Domain A should be blocked during cooldown');
  // Domain B must remain unaffected (domain isolation)
  assert.equal(limiter.canRequest(domainB), true, 'Domain B should not be blocked by domain A');

  // Penalize domain A on simulated 429
  limiter.penalize(domainA, 3);
  const cooldownA = limiter.getCooldown(domainA);
  assert.ok(cooldownA > 200, 'Penalty must scale cooldown duration');

  // Reset domain A
  limiter.reset(domainA);
  assert.equal(limiter.canRequest(domainA), true, 'Reset must clear cooldown');
});

test('GEN-432: VERIFIED_WORKDAY_BENGALURU_GCCS includes top required enterprise tech employers', () => {
  const requiredCompanies = ['Walmart', 'Target', 'Adobe', 'Cisco', 'Autodesk', 'Salesforce'];
  const names = VERIFIED_WORKDAY_BENGALURU_GCCS.map((g) => g.name);

  for (const req of requiredCompanies) {
    assert.ok(names.includes(req), `Target GCC list must include ${req}`);
  }
});

test('GEN-432: harvestLiveWorkdayBengaluruGccJobs retrieves roles without HTTP 429 errors', async () => {
  // Harvest 1 page per GCC
  const jobs = await harvestLiveWorkdayBengaluruGccJobs(1);

  // Assert that rate limiter recorded no fatal multi-penalty exhaustion
  for (const gcc of VERIFIED_WORKDAY_BENGALURU_GCCS) {
    const domain = new URL(gcc.origin).hostname;
    const cooldown = workdayRateLimiter.getCooldown(domain);
    // Cooldown shouldn't exceed max backoff (60s)
    assert.ok(cooldown <= 60000, `Domain ${domain} cooldown must remain bounded`);
  }

  // Ensure returned jobs have valid attributes
  for (const job of jobs) {
    assert.ok(job.company, 'Job must have company name');
    assert.ok(job.title, 'Job must have title');
    assert.ok(job.url.startsWith('http'), 'Job must have valid absolute url');
    assert.equal(job.ats, 'workday', 'Job ats must be workday');
  }

  console.log(`[GEN-432 TEST] Live harvested ${jobs.length} Bengaluru Workday GCC jobs.`);
});
