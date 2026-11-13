import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeRoleDedupSignature, isDuplicateAppliedRoleWithinWindow } from './role-dedup-shield.js';
import { isAlreadyAppliedSameCompanyRoleWithin30Days } from './priority-scheduler.js';

test('queue and discovery share requisition-aware role deduplication', () => {
  const now = Date.parse('2026-11-12T00:00:00Z');
  const company = 'Example Technologies Inc';
  const title = 'Software Engineer - Backend (Req #99182)';
  const signature = computeRoleDedupSignature(company, title);
  assert.equal(signature, computeRoleDedupSignature('Example Corp', 'Software Engineer - Backend'));
  assert.equal(isDuplicateAppliedRoleWithinWindow(signature, new Map([[signature, now - 29 * 86_400_000]]), 30, now), true);
  const row = { company: 'Example Corp', title: 'Software Engineer - Backend', appliedAt: new Date(now - 29 * 86_400_000).toISOString() };
  assert.equal(isAlreadyAppliedSameCompanyRoleWithin30Days(company, title, [row], now), true);
  assert.equal(isAlreadyAppliedSameCompanyRoleWithin30Days(company, title, [{ ...row, appliedAt: new Date(now - 31 * 86_400_000).toISOString() }], now), false);
  assert.equal(isAlreadyAppliedSameCompanyRoleWithin30Days('Labs Inc', title, [row], now), false);
});
