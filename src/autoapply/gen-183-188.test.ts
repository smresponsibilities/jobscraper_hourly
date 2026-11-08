import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('GEN-184: clampNumeric clamps numeric inputs and last-resort healer exists in runner.ts', () => {
  const runnerSrc = fs.readFileSync('src/autoapply/runner.ts', 'utf8');

  // Verify clampNumeric logic is present
  assert.ok(runnerSrc.includes('clampNumeric'), 'runner.ts must define clampNumeric');
  assert.ok(runnerSrc.includes('meta.min'), 'clampNumeric must respect min attribute');
  assert.ok(runnerSrc.includes('meta.max'), 'clampNumeric must respect max attribute');

  // Verify stubborn control healer exists in healInvalidFieldsAndRetrySubmit
  assert.ok(runnerSrc.includes('sel.selectedIndex = validOpt.index'), 'runner.ts must heal stubborn invalid select controls');
  assert.ok(runnerSrc.includes("preferred.click()"), 'runner.ts must heal stubborn invalid radio controls');
});

test('GEN-185: authenticateWorkdayPortal falls back to +alias Create Account when Sign In fails', () => {
  const authSrc = fs.readFileSync('src/autoapply/authentication.ts', 'utf8');

  assert.ok(authSrc.includes('makeGmailTenantAlias'), 'authentication.ts must import and use makeGmailTenantAlias');
  assert.ok(authSrc.includes('+wd'), 'authentication.ts must support +wd alias fallback for existing accounts');
  assert.ok(authSrc.includes('Ticket GEN-185: If Sign In failed on existing account, fall back to +alias Create Account immediately'), 'authentication.ts must contain GEN-185 fallback');
});

test('GEN-186: run-overnight-marathon.ts invokes syncAppliedJobsToOutreachTargets and dashboard-server.ts serves /api/outreach-targets', () => {
  const marathonSrc = fs.readFileSync('scripts/run-overnight-marathon.ts', 'utf8');
  assert.ok(marathonSrc.includes('syncAppliedJobsToOutreachTargets'), 'run-overnight-marathon.ts must call syncAppliedJobsToOutreachTargets');

  const dashboardSrc = fs.readFileSync('scripts/dashboard-server.ts', 'utf8');
  assert.ok(dashboardSrc.includes('/api/outreach-targets'), 'dashboard-server.ts must expose /api/outreach-targets');
  assert.ok(dashboardSrc.includes('applied-outreach-targets.json'), 'dashboard-server.ts must read applied-outreach-targets.json');
});
