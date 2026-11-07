import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { appendJobRunHistory, readJobRunHistory, type JobRunHistoryEntry } from './run-history.js';
import { getDashboardTelemetry } from '../../scripts/dashboard-server.js';

test('GEN-46: appendJobRunHistory and readJobRunHistory record and read job telemetry', () => {
  const testEntry: JobRunHistoryEntry = {
    jobId: `test_job_${Date.now()}`,
    company: 'TestCorp',
    title: 'Senior Distributed Engineer',
    provider: 'greenhouse',
    lane: 'greenhouse',
    url: 'https://job-boards.greenhouse.io/testcorp/jobs/12345',
    status: 'applied',
    reason: 'Application submitted successfully',
    fieldsFilled: 12,
    startedAt: new Date(Date.now() - 25000).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 25000,
    receiptVerified: true,
  };

  appendJobRunHistory(testEntry);

  const history = readJobRunHistory(50);
  assert.ok(history.length > 0);
  const found = history.find(h => h.jobId === testEntry.jobId);
  assert.ok(found, 'Appended job must be found in run history');
  assert.equal(found?.company, 'TestCorp');
  assert.equal(found?.durationMs, 25000);
  assert.equal(found?.status, 'applied');

  // Verify getDashboardTelemetry incorporates the history entry
  const telemetry = getDashboardTelemetry();
  assert.ok(telemetry.window1h.totalProcessed >= 1);
  assert.ok(telemetry.window24h.totalProcessed >= 1);
  assert.ok(telemetry.providerStats.greenhouse);
  assert.ok(telemetry.providerStats.greenhouse.runs >= 1);
  assert.ok(telemetry.providerStats.greenhouse.fastestSec);
  assert.ok(telemetry.providerStats.greenhouse.slowestSec);
  assert.ok(telemetry.providerStats.greenhouse.p95Sec);
  assert.ok(typeof telemetry.verifiedReceipts === 'number');
  assert.ok(typeof telemetry.outreachLeads === 'number');
  assert.ok(Array.isArray(telemetry.activeLanes));
  assert.ok(telemetry.activeLanes.includes('greenhouse'));
  assert.ok(telemetry.recentRuns.some(r => r.jobId === testEntry.jobId));
});
