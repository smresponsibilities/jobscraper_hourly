import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractVerbatimEmailsFromGitPatch, extractVerbatimEmailsFromNpmPackument } from './oss-lead-extractor.js';

test('only named, observed contacts at the exact target domain qualify', () => {
  const patch = 'From: Fixture Person <fixture.person@example.test>\nAuthor: Bot <dependabot@example.test>\nFrom: Recruiting <careers@example.test>\nFrom: Other <other@external.test>\nFrom: Fixture Person <fixture.person@example.test>\n';
  const leads = extractVerbatimEmailsFromGitPatch(patch, 'example.test', 'https://github.com/example/repo/commit/1.patch');
  assert.equal(leads.length, 1);
  assert.equal(leads[0]?.email, 'fixture.person@example.test');
  assert.equal(leads[0]?.provenance, 'TIER_A_VERBATIM_OBSERVED');
  assert.deepEqual(extractVerbatimEmailsFromGitPatch(patch, 'example.test', 'http://example.test/patch'), []);
  assert.deepEqual(extractVerbatimEmailsFromGitPatch('From: Person <person@stripe.com>', 'stripe.com', 'https://github.com/example/repo/commit/1.patch'), []);
  assert.equal(extractVerbatimEmailsFromNpmPackument({ maintainers: [{ name: 'Fixture Person', email: 'fixture.person@example.test' }, { name: 'Anonymous', email: 'noreply@example.test' }], author: { name: 'Fixture Person', email: 'fixture.person@example.test' } }, 'example.test', 'https://registry.npmjs.org/example').length, 1);
});
