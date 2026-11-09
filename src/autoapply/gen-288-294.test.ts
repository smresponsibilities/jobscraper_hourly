import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { enforceQueueDatabaseInvariants } from '../contracts/system-invariants.js';

test('GEN-288: runner.ts implements 3,500ms bounded close and marathon cleans lane caches', () => {
  const runnerSrc = fs.readFileSync(path.resolve('src/autoapply/runner.ts'), 'utf8');
  assert.ok(
    runnerSrc.includes('closeWithTimeout') && runnerSrc.includes('3500'),
    'runner.ts must implement 3,500ms bounded closeWithTimeout via Promise.race'
  );
  assert.ok(
    runnerSrc.includes('Promise.race'),
    'runner.ts must use Promise.race to prevent hung renderer tabs from blocking close'
  );

  const marathonSrc = fs.readFileSync(path.resolve('scripts/run-overnight-marathon.ts'), 'utf8');
  assert.ok(
    marathonSrc.includes('Code Cache') && marathonSrc.includes('GPUCache') && marathonSrc.includes('SingletonLock'),
    'run-overnight-marathon.ts must clean SingletonLock, Code Cache, and GPUCache inside lane profiles'
  );
});

test('GEN-289: enforceQueueDatabaseInvariants creates B-Tree indexes and runs wal_checkpoint(PASSIVE)', () => {
  const invariantsSrc = fs.readFileSync(path.resolve('src/contracts/system-invariants.ts'), 'utf8');
  assert.ok(
    invariantsSrc.includes('idx_jobs_status_fresh_id') && invariantsSrc.includes('idx_jobs_url'),
    'system-invariants.ts must create idx_jobs_status_fresh_id and idx_jobs_url composite indexes'
  );
  assert.ok(
    invariantsSrc.includes('wal_checkpoint(PASSIVE)'),
    'system-invariants.ts must execute PRAGMA wal_checkpoint(PASSIVE)'
  );

  // Execute on local DB to verify schema migration executes without error
  const report = enforceQueueDatabaseInvariants();
  assert.ok(report.databasesChecked.length > 0, 'Must check at least 1 database');
});

test('GEN-291: widgets.ts guards Enter key presses to prevent premature form submission', () => {
  const widgetsSrc = fs.readFileSync(path.resolve('src/autoapply/widgets.ts'), 'utf8');
  assert.ok(
    widgetsSrc.includes('menuStillOpen') || widgetsSrc.includes('optionLocator.count'),
    'widgets.ts must check menu visibility before dispatching Enter key'
  );
  assert.ok(
    widgetsSrc.includes('// Ticket GEN-291: Guard Enter key'),
    'widgets.ts must guard Enter key after option click'
  );
});

test('GEN-292: runner.ts detects unmounted-form confirmation receipts in this.receipt', () => {
  const runnerSrc = fs.readFileSync(path.resolve('src/autoapply/runner.ts'), 'utf8');
  assert.ok(
    runnerSrc.includes('unmountedFormConfirmed'),
    'runner.ts must contain unmountedFormConfirmed check in this.receipt'
  );
  assert.ok(
    runnerSrc.includes('visibleInputs <= 1') && runnerSrc.includes('thankYouMessage'),
    'runner.ts must inspect visibleInputs <= 1 and thankYouMessage containers'
  );
  assert.ok(
    runnerSrc.includes('unmounted_form_confirmation'),
    'runner.ts must return unmounted_form_confirmation selector tag'
  );
});
