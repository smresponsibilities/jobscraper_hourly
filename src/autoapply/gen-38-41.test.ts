import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { JobActivityWatchdog, getProviderTimeoutConfig } from './watchdog-timer.js';
import { buildCoordinatedFillPlan, applyClubbedValueTransform, type ClubbedFieldPlan } from './clubbing.js';
import { generateParkIssuesScoreboard } from './park-telemetry.js';
import type { DistilledField } from './distiller.js';

test('JobActivityWatchdog enforces total and idle timeouts and resets heartbeat', () => {
  const watchdog = new JobActivityWatchdog(5000, 2000);
  assert.equal(typeof watchdog.getElapsedMs(), 'number');
  assert.equal(typeof watchdog.getIdleMs(), 'number');

  watchdog.heartbeat('test_stage');
  assert.doesNotThrow(() => watchdog.checkOrThrow());

  const workdayConfig = getProviderTimeoutConfig('https://mycompany.myworkdayjobs.com/en-US/careers');
  assert.equal(workdayConfig.maxTotalMs, 300_000);
  assert.equal(workdayConfig.maxIdleMs, 95_000);

  const greenhouseConfig = getProviderTimeoutConfig('https://boards.greenhouse.io/stripe');
  assert.equal(greenhouseConfig.maxTotalMs, 180_000);
  assert.equal(greenhouseConfig.maxIdleMs, 75_000);
});

test('buildCoordinatedFillPlan orders cascading address and composite phone controls', () => {
  const rawFields: DistilledField[] = [
    {
      refKey: 'zip',
      widgetKind: 'TEXT',
      questionText: 'Postal code / Zip',
      sectionHeading: 'Address',
      isRequired: true,
      isFilled: false,
      currentValue: '',
      options: [],
      validationError: null,
      containerSelector: '',
      controlSelector: '',
    },
    {
      refKey: 'country',
      widgetKind: 'SINGLE_SELECT',
      questionText: 'Country',
      sectionHeading: 'Address',
      isRequired: true,
      isFilled: false,
      currentValue: '',
      options: ['India', 'United States'],
      validationError: null,
      containerSelector: '',
      controlSelector: '',
    },
    {
      refKey: 'phone_code',
      widgetKind: 'SINGLE_SELECT',
      questionText: 'Country Code',
      sectionHeading: 'Contact',
      isRequired: true,
      isFilled: false,
      currentValue: '',
      options: ['+91', '+1'],
      validationError: null,
      containerSelector: '',
      controlSelector: '',
    },
    {
      refKey: 'phone',
      widgetKind: 'TEXT',
      questionText: 'Phone Number',
      sectionHeading: 'Contact',
      isRequired: true,
      isFilled: false,
      currentValue: '',
      options: [],
      validationError: null,
      containerSelector: '',
      controlSelector: '',
    },
    {
      refKey: 'state',
      widgetKind: 'SINGLE_SELECT',
      questionText: 'State / Province',
      sectionHeading: 'Address',
      isRequired: true,
      isFilled: false,
      currentValue: '',
      options: [],
      validationError: null,
      containerSelector: '',
      controlSelector: '',
    },
  ];

  const plan = buildCoordinatedFillPlan(rawFields);
  const orderedLabels = plan.map(p => p.field.questionText);
  // Country (10) -> Country Code (15) -> State (20) -> Phone (25) -> Postal/Zip (40)
  assert.equal(orderedLabels[0], 'Country');
  assert.equal(orderedLabels[1], 'Country Code');
  assert.equal(orderedLabels[2], 'State / Province');
  assert.equal(orderedLabels[3], 'Phone Number');
  assert.equal(orderedLabels[4], 'Postal code / Zip');

  const phonePlan = plan.find(p => p.field.refKey === 'phone')!;
  assert.equal(phonePlan.valueTransform, 'strip_country_code');
  const transformedPhone = applyClubbedValueTransform('+91 9000000000', phonePlan);
  assert.equal(transformedPhone, '9000000000');
});

test('generateParkIssuesScoreboard generates valid Pareto breakdown from queue.sqlite', () => {
  const result = generateParkIssuesScoreboard();
  assert.ok(result.generatedAt);
  assert.ok(typeof result.statusTotals === 'object');
  assert.ok(Array.isArray(result.paretoIssues));

  const scoreboardFile = path.resolve('state/autoapply/portal-review/park-issues-scoreboard.json');
  assert.ok(fs.existsSync(scoreboardFile));
  const saved = JSON.parse(fs.readFileSync(scoreboardFile, 'utf8'));
  assert.equal(saved.generatedAt, result.generatedAt);
});

test('partitionJobsIntoProviderLanes accurately shards jobs across ATS provider lanes', async () => {
  const { partitionJobsIntoProviderLanes, runWithHardTimeout } = await import('../../scripts/drain-backfill-and-hourly.js');

  const jobs = [
    { jobUrl: 'https://boards.greenhouse.io/coupang/jobs/123' },
    { jobUrl: 'https://jobs.ashbyhq.com/tekion/abc' },
    { jobUrl: 'https://selinc.wd1.myworkdayjobs.com/en-US/sel/job/1' },
    { jobUrl: 'https://jobs.smartrecruiters.com/renesas/2' },
  ];

  const partitioned = partitionJobsIntoProviderLanes(jobs);
  assert.equal(partitioned.greenhouse.length, 1);
  assert.equal(partitioned.ashby.length, 1);
  assert.equal(partitioned.workday.length, 1);
  assert.equal(partitioned.other.length, 1);

  // runWithHardTimeout success case
  const fastPromise = Promise.resolve('completed');
  const fastRes = await runWithHardTimeout(fastPromise, 1000);
  assert.equal(fastRes, 'completed');

  // runWithHardTimeout timeout case
  const slowPromise = new Promise(r => setTimeout(r, 200));
  await assert.rejects(
    () => runWithHardTimeout(slowPromise, 50, 'TestSlowJob'),
    /TestSlowJob timed out after 50ms/
  );
});
