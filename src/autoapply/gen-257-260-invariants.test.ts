import test from 'node:test';
import assert from 'node:assert/strict';
import { runAllSystemInvariantsAndAutoHeal } from '../contracts/system-invariants.js';

test('GEN-257 to GEN-260: All 6 System Invariants & Anti-Regression Contracts Pass', () => {
  const report = runAllSystemInvariantsAndAutoHeal();
  assert.equal(report.invariantsPassed, true);
  assert.ok(report.companiesReport.totalBoards >= 13500);
});
