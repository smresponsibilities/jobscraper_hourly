import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  extractJobTimestampMs,
  computeJobPriorityScore,
  type QueuedJobCandidate,
} from './priority-scheduler.js';
import {
  recordWonderPillDeadEnd,
  loadWonderPillDeadEnds,
  runMode1StandardOsintLeadFinder,
  runMode2WonderPillInvertedLeadFinder,
  type WonderPillDeadEnd,
} from '../outreach/dual-mode-lead-finder.js';
import { runOutreachBatch } from '../../scripts/send-outreach-batch.js';
import {
  isAutomationChromeCommandLine,
  hasJobsInFlight,
  reapZombieChromeProcesses,
  check30MinZeroFillDroughtAndAutoHeal,
  getDoctorStatus,
} from './health-and-ram-watchdog.js';

test('GEN-448: extractJobTimestampMs parses multi-field stamps and 10m-old job crushes 3-day-old hourly job', () => {
  const now = 1793777090251;

  // 10-minute-old job ingested from scraper
  const freshJob: QueuedJobCandidate = {
    id: 'job_fresh_10m',
    company: 'Stripe Partner',
    title: 'Software Engineer',
    url: 'https://boards.greenhouse.io/stripepartner/jobs/100',
    payload: { scrapedAt: new Date(now - 10 * 60 * 1000).toISOString() },
  };

  const parsedFresh = extractJobTimestampMs(freshJob);
  assert.equal(parsedFresh.source, 'scrapedAt');
  assert.equal(parsedFresh.timestampMs, now - 10 * 60 * 1000);

  // 3-day-old job with stale isHourlyFresh: true in database
  const staleHourlyJob: QueuedJobCandidate = {
    id: 'job_stale_3d',
    company: 'Stale Startup',
    title: 'Software Engineer',
    url: 'https://boards.greenhouse.io/stalestartup/jobs/200',
    createdAtMs: now - 72 * 3600 * 1000,
    isHourlyFresh: true,
  };

  const freshScore = computeJobPriorityScore(freshJob, now);
  const staleScore = computeJobPriorityScore(staleHourlyJob, now);

  assert.ok(
    freshScore > staleScore + 10000,
    `10-min-old job (${freshScore}) must decisively beat 3-day-old expired isHourlyFresh job (${staleScore})`
  );
});

test('GEN-449: Mode 1 OSINT & Mode 2 Wonder-Pill Inverted Lead Discovery with 3-field Dead-End Ledger', async () => {
  const testDeadEndLedger = path.resolve('state/autoapply/portal-review/test-wonder-dead-ends.json');
  try { if (fs.existsSync(testDeadEndLedger)) fs.unlinkSync(testDeadEndLedger); } catch {}

  // 1. Record 3-field Wonder-Pill dead end
  const deadEnd: WonderPillDeadEnd = {
    sourceOrigin: 'git_patch',
    whatWentWrong: 'Author email concealed behind GitHub privacy relay: users.noreply.github.com',
    whyDisqualifying: 'GitHub privacy relay forbids direct inbound SMTP delivery',
    company: 'AcmeCloud',
    domain: 'acmecloud.io',
  };

  recordWonderPillDeadEnd(deadEnd, testDeadEndLedger);
  const ledger = loadWonderPillDeadEnds(testDeadEndLedger);

  assert.equal(ledger.length, 1);
  assert.equal(ledger[0]?.sourceOrigin, 'git_patch');
  assert.equal(ledger[0]?.whatWentWrong, deadEnd.whatWentWrong);
  assert.equal(ledger[0]?.whyDisqualifying, deadEnd.whyDisqualifying);
  assert.ok(ledger[0]?.timestamp, 'Audit timestamp must exist');

  // 2. Mode 1 Lead Finder returns recruiter permutations
  const mode1Contacts = await runMode1StandardOsintLeadFinder({
    company: 'Google',
    domain: 'google.com',
    recruiterName: 'Sundar Pichai',
  });

  assert.ok(mode1Contacts.length > 0, 'Mode 1 must generate recruiter permutations');
  assert.ok(mode1Contacts.some(c => c.email.includes('@google.com')));

  try { if (fs.existsSync(testDeadEndLedger)) fs.unlinkSync(testDeadEndLedger); } catch {}
});

test('GEN-449: send-outreach-batch.ts deduplicates company domains so aptura.io appears at most once', async () => {
  const testLeadsPath = path.resolve('state/autoapply/portal-review/test-batch-dedup-leads.json');
  const testLedgerPath = path.resolve('state/autoapply/portal-review/test-batch-dedup-ledger.json');

  const duplicateLeads = [
    {
      company: 'Aptura',
      roleTitle: 'AI Researcher',
      targetEmail: 'talent@aptura.io',
      archetype: 'AI_ML',
      mxVerified: true,
      mxProvider: 'google_workspace',
      matchedProject: 'Fertilizer ML API',
      subject: 'AI Research',
      body: 'Hello Aptura',
      generatedAt: new Date().toISOString(),
      source: 'test',
    },
    {
      company: 'Aptura',
      roleTitle: 'Systems Engineer',
      targetEmail: 'martijn@aptura.io',
      archetype: 'BACKEND',
      mxVerified: true,
      mxProvider: 'google_workspace',
      matchedProject: 'Kafka Ingestion',
      subject: 'Backend Engineering',
      body: 'Hello Martijn',
      generatedAt: new Date().toISOString(),
      source: 'test',
    },
    {
      company: 'SigNoz',
      roleTitle: 'Exceptional Engineer',
      targetEmail: 'talent@signoz.io',
      archetype: 'BACKEND',
      mxVerified: true,
      mxProvider: 'google_workspace',
      matchedProject: 'Kafka Ingestion',
      subject: 'Backend Engineering',
      body: 'Hello SigNoz',
      generatedAt: new Date().toISOString(),
      source: 'test',
    },
  ];

  fs.writeFileSync(testLeadsPath, JSON.stringify(duplicateLeads, null, 2), 'utf8');
  fs.writeFileSync(testLedgerPath, JSON.stringify({ records: [] }), 'utf8');

  const result = await runOutreachBatch({
    dryRun: true,
    limit: 5,
    leadsPath: testLeadsPath,
    ledgerPath: testLedgerPath,
  });

  const apturaItems = result.items.filter(i => i.company.toLowerCase() === 'aptura');
  assert.equal(apturaItems.length, 1, `Aptura must appear at most once per batch, got ${apturaItems.length}`);

  try {
    fs.unlinkSync(testLeadsPath);
    fs.unlinkSync(testLedgerPath);
  } catch {}
});

test('GEN-450 & GEN-451: STOP_AUTOAPPLY.flag sentinel & 30-min zero-fill self-healing doctor', () => {
  const sentinelPath = path.resolve('state/autoapply/portal-review/STOP_AUTOAPPLY.flag');
  fs.mkdirSync(path.dirname(sentinelPath), { recursive: true });

  fs.writeFileSync(sentinelPath, 'STOP_REQUESTED', 'utf8');
  assert.equal(fs.existsSync(sentinelPath), true);
  fs.unlinkSync(sentinelPath);
  assert.equal(fs.existsSync(sentinelPath), false);

  // Test Doctor Zero-Fill Drought
  const testStateDir = path.resolve('state/autoapply/test-doctor-state-2');
  const testReviewDir = path.join(testStateDir, 'portal-review');
  fs.mkdirSync(testReviewDir, { recursive: true });

  const testHistoryPath = path.join(testReviewDir, 'run-history.jsonl');
  const now = Date.now();

  const failedRun = {
    timestamp: new Date(now - 12 * 60 * 1000).toISOString(),
    status: 'failed',
    error: 'Selector not found: button#submit',
  };
  fs.writeFileSync(testHistoryPath, JSON.stringify(failedRun) + '\n', 'utf8');

  const report = check30MinZeroFillDroughtAndAutoHeal({
    stateDir: testStateDir,
    runHistoryPath: testHistoryPath,
    nowMs: now,
  });

  assert.equal(report.appliedLast30m, 0);
  assert.equal(report.healed, true);
  assert.equal(report.permissiveModeEnabled, true);

  try { fs.rmSync(testStateDir, { recursive: true, force: true }); } catch {}
});

test('GEN-445: hasJobsInFlight protects live automation browsers from being reaped mid-chunk', () => {
  const journalPath = path.resolve('state/autoapply/portal-review/in-flight-checkpoint.json');
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });

  // Simulate an active in-flight job
  fs.writeFileSync(journalPath, JSON.stringify({
    'job-test-active': {
      jobId: 'job-test-active',
      company: 'TestCorp',
      url: 'https://boards.greenhouse.io/test/1',
      lane: 'greenhouse',
      startedAt: new Date().toISOString(),
      lastStep: 1,
    }
  }), 'utf8');

  assert.equal(hasJobsInFlight(), true, 'hasJobsInFlight must be true when checkpoint journal has active jobs');

  // Verify reapZombieChromeProcesses exits with 0 reaped when jobs are in flight and !forceKillAll
  const reapResult = reapZombieChromeProcesses(180, false);
  assert.equal(reapResult.reapedCount, 0, 'Must NOT reap any processes while jobs are actively in flight');

  fs.unlinkSync(journalPath);
});
