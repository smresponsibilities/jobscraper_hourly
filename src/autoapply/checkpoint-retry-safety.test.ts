import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { AutoApplyRunner } from './runner.js';
import type { CandidateExtendedProfile } from './types.js';

test('submit mode never deletes a prior ambiguous checkpoint', { timeout: 60000 }, async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'prior-submit-'));
  const url = 'https://jobs.ashbyhq.com/fixture/job';
  const checkpoint = path.join(directory, 'checkpoint.json');
  const stored = { applicationUrl: url, currentUrl: url, report: { submissionAttempted: true, submission: { phase: 'clicked', requests: [] }, actions: [], logs: [] } };
  writeFileSync(checkpoint, JSON.stringify(stored));
  const profile = { personal: { firstName: 'Fixture', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] } as CandidateExtendedProfile;
  const runner = new AutoApplyRunner();
  try {
    const report = await runner.run({ url, profile, sessionDir: directory, submit: true, resume: false, headless: true });
    assert.equal(report.status, 'paused_for_review');
    assert.equal(report.submissionAttempted, true);
    assert.deepEqual(JSON.parse(readFileSync(checkpoint, 'utf8')), stored);
  } finally { await runner.close(); rmSync(directory, { recursive: true, force: true }); }
});
