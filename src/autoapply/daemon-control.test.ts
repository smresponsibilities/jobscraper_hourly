import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { recoverPowerOffAndNetOffJobs } from './power-net-recovery.js';
import path from 'node:path';
import { stopFlagPath, isStopRequested, waitForDaemonWake, hasObservedApplicationReceipt } from './daemon-control.js';
import { check30MinZeroFillDroughtAndAutoHeal, selectOwnedChromeForReaping, ActiveBrowserRegistry, ActiveJobRegistry, hasJobsInFlight, isAutomationChromeCommandLine } from './health-and-ram-watchdog.js';
import { appendJobRunHistory, readJobRunHistory, sanitizeRunHistoryFile, type JobRunHistoryEntry } from './run-history.js';
import type { BotRunReport } from './types.js';

const tempRoot = path.resolve('out/test-temp');
fs.mkdirSync(tempRoot, { recursive: true });
const freshDir = () => fs.mkdtempSync(path.join(tempRoot, 'daemon-control-'));

test('operator stop uses queue directory and wakes an idle daemon without a restart', async () => {
  const stateDir = freshDir();
  assert.equal(stopFlagPath(stateDir), path.join(stateDir, 'STOP_AUTOAPPLY.flag'));
  const timer = setTimeout(() => fs.writeFileSync(stopFlagPath(stateDir), ''), 10);
  const start = Date.now();
  try { await waitForDaemonWake(stateDir, 10_000); }
  finally { clearTimeout(timer); }
  assert.ok(Date.now() - start < 2000, 'idle wait must notice stop before its normal polling deadline');
});

test('root stop flag also stops idle workers', async () => {
  const previous = process.cwd();
  const root = freshDir();
  const stateDir = path.join(root, 'state');
  try {
    fs.mkdirSync(stateDir);
    process.chdir(root);
    assert.equal(isStopRequested(stateDir), false);
    fs.writeFileSync(path.join(root, 'STOP_AUTOAPPLY.flag'), '');
    assert.equal(isStopRequested(stateDir), true);
    const start = Date.now();
    await waitForDaemonWake(stateDir, 10_000);
    assert.ok(Date.now() - start < 2000);
  } finally { process.chdir(previous); fs.rmSync(root, { recursive: true, force: true }); }
});

test('reason text and submit status alone cannot manufacture a receipt', () => {
  const report = { status: 'submitted', reason: 'No application submitted, thank you for applying example text' } as BotRunReport;
  assert.equal(hasObservedApplicationReceipt(report), false);
  report.receipt = { text: 'Application received', url: 'https://jobs.example/confirmation', verifiedAt: new Date().toISOString() };
  assert.equal(hasObservedApplicationReceipt(report), true);
  report.receipt.existing = true;
  assert.equal(hasObservedApplicationReceipt(report), false);
  report.receipt.existing = false;
  report.receipt.verifiedAt = 'invalid';
  assert.equal(hasObservedApplicationReceipt(report), false);
});

test('drought doctor reads finishedAt and receipt evidence without clearing backoff or changing policy', () => {
  const stateDir = freshDir();
  const now = Date.now();
  const historyPath = path.join(stateDir, 'run-history.jsonl');
  const rows = [
    { finishedAt: new Date(now - 60_000).toISOString(), status: 'failed', reason: 'selector_failed' },
    { finishedAt: new Date(now - 120_000).toISOString(), status: 'applied', receiptVerified: true },
    { finishedAt: new Date(now + 60_000).toISOString(), status: 'applied', receiptVerified: true },
  ];
  fs.writeFileSync(historyPath, rows.map(row => JSON.stringify(row)).join('\n'));
  const healthPath = path.join(stateDir, 'host-health.json');
  const backoff = JSON.stringify({ tenant: { backoffUntil: now + 60_000 } });
  fs.writeFileSync(healthPath, backoff);
  const policy = process.env.FORCE_PERMISSIVE_SUBMIT_ALL;
  const report = check30MinZeroFillDroughtAndAutoHeal({ stateDir, nowMs: now });
  assert.equal(report.processedLast30m, 2);
  assert.equal(report.appliedLast30m, 1);
  assert.equal(report.healed, false);
  assert.equal(report.permissiveModeEnabled, false);
  assert.equal(fs.readFileSync(healthPath, 'utf8'), backoff);
  assert.equal(process.env.FORCE_PERMISSIVE_SUBMIT_ALL, policy);
  assert.equal(check30MinZeroFillDroughtAndAutoHeal({ stateDir: freshDir(), nowMs: now }).actionsTaken.length, 0);
});

test('Chrome cleanup cannot select personal, foreign-worker or active process trees', () => {
  const commandLine = 'chrome --enable-automation --user-data-dir=state/autoapply/browser-profile-lane-test';
  const process = (pid: number, parentPid: number, extra = '') => ({ pid, parentPid, commandLine: commandLine + extra, ageSeconds: 999, workingSetMb: 10 });
  const processes = [process(10, 1), process(11, 10), process(20, 2), process(30, 1, ' --profile-directory="Default"')];
  assert.deepEqual(selectOwnedChromeForReaping(processes, 1, 180), [10, 11]);
  ActiveBrowserRegistry.add(11);
  try { assert.deepEqual(selectOwnedChromeForReaping(processes, 1, 0), []); }
  finally { ActiveBrowserRegistry.delete(11); }
});

test('history never promotes a reason string to applied or rewrites it on read', () => {
  const filePath = path.join(freshDir(), 'run-history.jsonl');
  const row = { jobId: `fixture-${Date.now()}`, status: 'failed', reason: 'Application submitted', fieldsFilled: 3, durationMs: 1000, finishedAt: new Date().toISOString() } as JobRunHistoryEntry;
  appendJobRunHistory(row, filePath);
  const original = fs.readFileSync(filePath, 'utf8');
  assert.equal(readJobRunHistory(10, filePath)[0]!.status, 'failed');
  assert.equal(sanitizeRunHistoryFile(filePath), 0);
  assert.equal(fs.readFileSync(filePath, 'utf8'), original);
  appendJobRunHistory({ ...row, jobId: row.jobId + '-unverified', status: 'applied' }, filePath);
  assert.equal(readJobRunHistory(10, filePath)[0]!.status, 'paused_for_review');
});


test('two simultaneous daemon starts cannot both acquire the same lock', { timeout: 45_000 }, async () => {
  const lockPath = path.join(freshDir(), 'worker.lock');
  const moduleUrl = pathToFileURL(path.resolve('scripts/drain-backfill-and-hourly.ts')).href;
  const code = `import { acquireLock, releaseLock } from ${JSON.stringify(moduleUrl)};
    process.send({ ready: true });
    process.on('message', message => {
      if (message === 'acquire') process.send({ acquired: acquireLock(${JSON.stringify(lockPath)}) });
      if (message === 'release') { releaseLock(${JSON.stringify(lockPath)}); process.exit(0); }
    });`;
  const children = [0, 1].map(() => spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }));
  try {
    await Promise.all(children.map(async child => {
      const [message] = await once(child, 'message');
      assert.equal(message.ready, true);
    }));
    const results = children.map(child => once(child, 'message'));
    children.forEach(child => child.send('acquire'));
    const acquired = await Promise.all(results);
    assert.equal(acquired.filter(([message]) => message.acquired).length, 1);
    const exits = children.map(child => once(child, 'exit'));
    children.forEach(child => child.send('release'));
    await Promise.all(exits);
  } finally { children.forEach(child => { if (child.exitCode === null) child.kill(); }); }
});


test('worker activity and unquoted personal profiles prevent cleanup', () => {
  ActiveJobRegistry.add('fixture');
  try { assert.equal(hasJobsInFlight(), true); }
  finally { ActiveJobRegistry.delete('fixture'); }
  assert.equal(isAutomationChromeCommandLine('chrome --enable-automation --profile-directory=Default'), false);
  assert.equal(isAutomationChromeCommandLine('chrome --enable-automation --profile-directory="Profile 12"'), false);
});

test('startup recovery preserves reviews, bounds launch retries, and parks interrupted dispatches', async () => {
  const modelPolicy = process.env.AUTOAPPLY_NO_MODEL;
  const { resetEligiblePausedJobs } = await import('../../scripts/drain-backfill-and-hourly.js');
  assert.equal(process.env.AUTOAPPLY_NO_MODEL, modelPolicy, 'importing a scheduling helper must not disable model policy');
  const dir = freshDir();
  const dbPath = path.join(dir, 'queue.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE applications (id TEXT PRIMARY KEY, status TEXT, payload TEXT)');
  const insert = db.prepare('INSERT INTO applications VALUES (?, ?, ?)');
  const rows = [
    ['review', 'paused_for_review', { company: 'Tekion', error: 'Validation or field errors' }],
    ['ambiguous', 'failed', { error: 'browserType.launch failed', submission: { phase: 'dispatched' } }],
    ['safe', 'failed', { error: 'browserType.launch failed' }],
    ['network', 'failed', { error: 'ERR_INTERNET_DISCONNECTED' }],
    ['interrupted', 'applying', { submission: { phase: 'dispatched' } }],
    ['confirmed', 'applied', { receipt: { text: 'Observed receipt' } }],
  ] as const;
  for (const [id, status, payload] of rows) insert.run(id, status, JSON.stringify(payload));
  assert.equal(resetEligiblePausedJobs(dbPath), 1);
  const status = (id: string) => (db.prepare('SELECT status FROM applications WHERE id=?').get(id) as {status: string}).status;
  assert.equal(status('review'), 'paused_for_review');
  assert.equal(status('ambiguous'), 'failed');
  assert.equal(status('network'), 'failed');
  for (const expected of [1, 1, 0]) {
    db.prepare("UPDATE applications SET status='failed' WHERE id='safe'").run();
    assert.equal(resetEligiblePausedJobs(dbPath), expected);
  }
  const journalPath = path.join(dir, 'in-flight-checkpoint.json');
  const journal = JSON.stringify({ interrupted: { jobId: 'interrupted', currentUrl: 'https://example.test/confirmation' } });
  fs.writeFileSync(journalPath, journal);
  const recovered = recoverPowerOffAndNetOffJobs(dbPath);
  assert.equal(recovered.recoveredInFlight, 1);
  assert.equal(status('interrupted'), 'paused_for_review');
  assert.equal(status('network'), 'failed');
  assert.equal(status('confirmed'), 'applied');
  assert.equal(fs.readFileSync(journalPath, 'utf8'), journal);
  db.close();
});
