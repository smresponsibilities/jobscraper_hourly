import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('GEN-157: All .github/workflows/*.yml files use cancel-in-progress: false and atomic rebase-push retry loops', () => {
  const wfDir = '.github/workflows';
  const ymlFiles = fs.readdirSync(wfDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
  assert.ok(ymlFiles.length >= 7, 'Must have at least 7 workflow files');

  for (const f of ymlFiles) {
    const content = fs.readFileSync(path.join(wfDir, f), 'utf8');
    assert.ok(
      !content.includes('cancel-in-progress: true'),
      `${f} must not contain cancel-in-progress: true`
    );
    if (content.includes('concurrency:')) {
      assert.ok(
        content.includes('cancel-in-progress: false'),
        `${f} concurrency block must specify cancel-in-progress: false`
      );
    }
    if (content.includes('git push origin main') || content.includes('git push origin "$BRANCH"')) {
      assert.ok(
        content.includes('--autostash') || content.includes('git pull') || content.includes('rebase'),
        `${f} push must use autostash/rebase retry loop`
      );
    }
  }
});

test('GEN-158: runner.ts checks ghVisibleInputCount < 2 and clicks btn--pill on Greenhouse Remix boards', () => {
  const runnerSrc = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  assert.ok(runnerSrc.includes('ghVisibleInputCount'), 'runner.ts must check ghVisibleInputCount');
  assert.ok(runnerSrc.includes('ghVisibleInputCount < 2'), 'runner.ts must check ghVisibleInputCount < 2');
  assert.ok(runnerSrc.includes('button.btn--pill:has-text("Apply")'), 'runner.ts must target button.btn--pill:has-text("Apply")');
});

test('GEN-159: runner.ts fast-chunks humanType for text.length > 2, uses 4000ms floor, and 360s dynamic activity watchdog', () => {
  const runnerSrc = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  const wtSrc = fs.readFileSync('src/autoapply/watchdog-timer.ts', 'utf8');
  const marathonSrc = fs.readFileSync('scripts/run-overnight-marathon.ts', 'utf8');

  assert.ok(runnerSrc.includes('if (text.length > 2)'), 'runner.ts humanType must fast-chunk for text.length > 2');
  assert.ok(runnerSrc.includes('alreadyElapsedMs >= 4000'), 'runner.ts must use 4000ms pre-submit floor');
  assert.ok(wtSrc.includes('360_000'), 'watchdog-timer.ts must use 360_000ms maxTotalMs');
  assert.ok(marathonSrc.includes('runWithDynamicActivityTimeout'), 'run-overnight-marathon.ts must use runWithDynamicActivityTimeout');
  assert.ok(marathonSrc.includes('cpFieldsFilled'), 'run-overnight-marathon.ts catch block must preserve checkpoint fieldsFilled');
});

test('GEN-160: workday-entry.ts clicks a.js-oneclick and falls back to in-page window.location.assign with 15000ms hydration', () => {
  const entrySrc = fs.readFileSync('src/autoapply/workday-entry.ts', 'utf8');
  assert.ok(entrySrc.includes('a.js-oneclick'), 'workday-entry.ts must include a.js-oneclick');
  assert.ok(entrySrc.includes('window.location.assign(a.href)'), 'workday-entry.ts must include window.location.assign fallback');
  assert.ok(entrySrc.includes('waitForOneClickInputs(15000)'), 'workday-entry.ts must wait 15000ms for Shadow-DOM hydration');
});

test('GEN-161: authentication.ts auto-checks createAccountCheckbox before clicking createAccountSubmitButton', () => {
  const authSrc = fs.readFileSync('src/autoapply/authentication.ts', 'utf8');
  assert.ok(authSrc.includes('checkWorkdayCreateAccountConsentIfPresent'), 'authentication.ts must define checkWorkdayCreateAccountConsentIfPresent');
  assert.ok(authSrc.includes('createAccountCheckbox'), 'authentication.ts must check createAccountCheckbox selector');
});

test('GEN-162: run-overnight-marathon.ts includes checkJobPostingHttpAliveFast for 404/410 filtering', async () => {
  const marathonSrc = fs.readFileSync('scripts/run-overnight-marathon.ts', 'utf8');
  assert.ok(marathonSrc.includes('checkJobPostingHttpAliveFast'), 'run-overnight-marathon.ts must define and use checkJobPostingHttpAliveFast');
  assert.ok(marathonSrc.includes('res.status === 404 || res.status === 410'), 'checkJobPostingHttpAliveFast must check 404 and 410 statuses');
  assert.ok(marathonSrc.includes('HTTP 404/410 pre-flight'), 'Must record 404/410 preflight message');
});
