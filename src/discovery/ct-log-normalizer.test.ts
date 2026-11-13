import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAtsTenantsFromCtDomains } from './ct-log-normalizer.js';

test('certificate names become deduplicated ATS candidates without isolated or staging tenants', () => {
  const results = extractAtsTenantsFromCtDomains([
    '*.acme.recruitee.com', 'acme.recruitee.com', 'acme-staging.recruitee.com',
    'corp.wd1.myworkdayjobs.com', 'stripe.recruitee.com', 'paypal.wd5.myworkdayjobs.com',
    'Example.breezy.hr\nexample.breezy.hr', 'foo.pinpointhq.com', '*.myworkdayjobs.com',
    'jobs.ashbyhq.com', 'invalid_.recruitee.com', 'acme.recruitee.com.attacker.test',
    'x-test.greenhouse.io', 'sub.acme.recruitee.com',
  ]);
  assert.deepEqual(results, [
    { provider: 'recruitee', tenant: 'acme', boardUrl: 'https://acme.recruitee.com' },
    { provider: 'workday', tenant: 'corp', boardUrl: 'https://corp.wd1.myworkdayjobs.com' },
    { provider: 'breezy', tenant: 'example', boardUrl: 'https://example.breezy.hr' },
    { provider: 'pinpoint', tenant: 'foo', boardUrl: 'https://foo.pinpointhq.com' },
  ]);
});
