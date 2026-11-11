// src/autoapply/gen-463-472.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  composeTechnicalOpenerHook,
  composeDay5FollowUpWithNewProof,
} from '../outreach/personalized-hook-composer.js';
import {
  buildDay5FollowUpDraft,
  isDay5FollowUpEligible,
} from '../outreach/follow-up-sequencer.js';
import { isSupportedDirectAtsJobUrl } from './preflight.js';
import { unwrapDirectAtsApplicationUrl } from './url-unwrapper.js';
import { selectBestArchetypeByJdHardMatch } from '../resume/deterministic-builder.js';
import {
  normalizeCompanyRoleSignature,
  isAlreadyAppliedSameCompanyRoleWithin30Days,
  computeJobPriorityScore,
} from './priority-scheduler.js';
import { generateDailyExecutiveDigest } from '../../scripts/generate-daily-executive-digest.js';

test('GEN-463: composeTechnicalOpenerHook generates role/artifact-grounded hooks', () => {
  // 1. NPM Maintainer lead
  const npmHook = composeTechnicalOpenerHook({
    company: 'Vercel',
    roleTitle: 'Backend Engineer',
    personName: 'Guillermo Rauch',
    personRole: 'Maintaining (turbo)',
    discoveryStep: 'inversion1_npm_maintainer_registry',
  });
  assert.match(npmHook, /^Hi Guillermo,/);
  assert.match(npmHook, /maintaining the turbo package/);
  assert.match(npmHook, /Vercel's engineering stack/);
  assert.match(npmHook, /Backend Engineer/);

  // 2. Git Commit lead
  const gitHook = composeTechnicalOpenerHook({
    company: 'Supabase',
    roleTitle: 'Distributed Systems Engineer',
    personName: 'Paul Copplestone',
    personRole: '(postgrest-js)',
    discoveryStep: 'inversion2_git_patch_header',
  });
  assert.match(gitHook, /^Hi Paul,/);
  assert.match(gitHook, /recent engineering contributions to postgrest-js on GitHub/);
  assert.match(gitHook, /Distributed Systems Engineer position at Supabase/);

  // 3. GitHub Org Events lead
  const orgEventHook = composeTechnicalOpenerHook({
    company: 'PostHog',
    roleTitle: 'Data Engineer',
    personName: 'James Hawkins',
    personRole: '(posthog)',
    discoveryStep: 'github_org_events',
  });
  assert.match(orgEventHook, /^Hi James,/);
  assert.match(orgEventHook, /recent engineering contributions to posthog on GitHub/);

  // 4. Clean fallback hook (no artifacts)
  const cleanHook = composeTechnicalOpenerHook({
    company: 'Acme Corp',
    roleTitle: 'Software Engineer',
  });
  assert.match(cleanHook, /^Hi Acme Corp Engineering Team,/);
  assert.match(cleanHook, /recently submitted my application for the Software Engineer role at Acme Corp/);
});

test('GEN-464: composeDay5FollowUpWithNewProof and buildDay5FollowUpDraft inject new technical proof', () => {
  const followUp = composeDay5FollowUpWithNewProof({
    company: 'Datadog',
    roleTitle: 'Platform Engineer',
  });

  assert.equal(followUp.subject, "Re: Applied for Platform Engineer — Shivam Mahajan (Morgan Stanley / CSE '26)");
  assert.match(followUp.body, /Morgan Stanley \(engineering Apache Kafka, PySpark, and Azure Snowflake CIAM pipelines/);
  assert.match(followUp.body, /QuizDeck, benchmarked for 500 concurrent users at 31 ms latency/);
  assert.match(followUp.body, /ClickHouse OLAP ingestion tool/);
  assert.match(followUp.body, /shivammahajan\.com\/projects\//);

  // Eligibility check: >= 5 days is eligible
  const sixDaysAgo = new Date(Date.now() - 6 * 86_400_000).toISOString();
  const eligibleCheck = isDay5FollowUpEligible(
    { company: 'Datadog', domain: 'datadog.com', sentAt: sixDaysAgo, followUpCount: 0 },
    []
  );
  assert.equal(eligibleCheck.eligible, true);

  // Ineligible if under 5 days
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const tooRecentCheck = isDay5FollowUpEligible(
    { company: 'Datadog', domain: 'datadog.com', sentAt: twoDaysAgo, followUpCount: 0 },
    []
  );
  assert.equal(tooRecentCheck.eligible, false);
  assert.equal(tooRecentCheck.reason, 'under_5_days_since_touch_1');

  // Ineligible if already followed up
  const alreadyFollowedUp = isDay5FollowUpEligible(
    { company: 'Datadog', domain: 'datadog.com', sentAt: sixDaysAgo, followUpCount: 1 },
    []
  );
  assert.equal(alreadyFollowedUp.eligible, false);
  assert.equal(alreadyFollowedUp.reason, 'already_followed_up');

  // Ineligible if domain suppressed by inbox lifecycle rejection
  const suppressedCheck = isDay5FollowUpEligible(
    { company: 'Datadog', domain: 'datadog.com', sentAt: sixDaysAgo, followUpCount: 0 },
    [
      {
        messageId: 'rej-1',
        fromDomain: 'datadog.com',
        company: 'Datadog',
        stage: 'APPLICATION_REJECTED',
        receivedAt: new Date().toISOString(),
      },
    ]
  );
  assert.equal(suppressedCheck.eligible, false);
  assert.match(suppressedCheck.reason || '', /suppressed_by_inbox_lifecycle/);

  // Full draft builder
  const draft = buildDay5FollowUpDraft(
    { company: 'Datadog', roleTitle: 'Platform Engineer', domain: 'datadog.com', followUpCount: 0 },
    sixDaysAgo,
    []
  );
  assert.equal(draft.eligible, true);
  assert.match(draft.subject || '', /Applied for Platform Engineer/);
  assert.match(draft.body || '', /QuizDeck/);
});

test('GEN-465 & GEN-466: Recruitee and BreezyHR direct URL unwrapping and preflight support', () => {
  // Recruitee unwrapping
  const recruiteeUrl = 'https://acme.recruitee.com/o/backend-engineer';
  assert.equal(unwrapDirectAtsApplicationUrl(recruiteeUrl), 'https://acme.recruitee.com/o/backend-engineer/c/new');

  // BreezyHR unwrapping
  const breezyUrl = 'https://acme.breezy.hr/p/12345-data-engineer';
  assert.equal(unwrapDirectAtsApplicationUrl(breezyUrl), 'https://acme.breezy.hr/p/12345-data-engineer/apply');

  // Already unwrapped URLs remain idempotent
  assert.equal(
    unwrapDirectAtsApplicationUrl('https://acme.recruitee.com/o/backend-engineer/c/new'),
    'https://acme.recruitee.com/o/backend-engineer/c/new'
  );
  assert.equal(
    unwrapDirectAtsApplicationUrl('https://acme.breezy.hr/p/12345-data-engineer/apply'),
    'https://acme.breezy.hr/p/12345-data-engineer/apply'
  );

  // Preflight isSupportedDirectAtsJobUrl
  assert.equal(isSupportedDirectAtsJobUrl('https://acme.recruitee.com/o/backend-engineer'), true);
  assert.equal(isSupportedDirectAtsJobUrl('https://acme.breezy.hr/p/12345-data-engineer'), true);

  // Root or vendor pages must be rejected
  assert.equal(isSupportedDirectAtsJobUrl('https://acme.recruitee.com/'), false);
  assert.equal(isSupportedDirectAtsJobUrl('https://acme.breezy.hr/'), false);
  assert.equal(isSupportedDirectAtsJobUrl('https://random-blog.com/careers'), false);
});

test('GEN-467 & GEN-468: selectBestArchetypeByJdHardMatch maps generic titles to JD tech stack', () => {
  // Generic "Software Engineer" title with Data Engineering JD text
  const matchData = selectBestArchetypeByJdHardMatch(
    'Software Engineer',
    'We are scaling high-throughput pipelines using PySpark, ClickHouse, Snowflake, and ETL workflows with SQL and Airflow.'
  );
  assert.equal(matchData.archetype, 'DATA_ENGINEERING');
  assert.ok(matchData.matchScore > 30);
  assert.ok(matchData.matchedKeywords.includes('pyspark'));
  assert.ok(matchData.matchedKeywords.includes('clickhouse'));

  // Generic "Member of Technical Staff" with AI/ML JD
  const matchAi = selectBestArchetypeByJdHardMatch(
    'Member of Technical Staff',
    'Experience deploying machine learning models with TensorFlow, scikit-learn, XGBoost, and LLM GenAI prompt pipelines.'
  );
  assert.equal(matchAi.archetype, 'AI_ML_SYSTEMS');
  assert.ok(matchAi.matchedKeywords.includes('machine learning'));
  assert.ok(matchAi.matchedKeywords.includes('xgboost'));

  // Frontend / React stack
  const matchReact = selectBestArchetypeByJdHardMatch(
    'Software Developer',
    'Must have production experience with React, Next.js, TypeScript, Full Stack web development and WebSockets.'
  );
  assert.equal(matchReact.archetype, 'FULLSTACK_REACT');
  assert.ok(matchReact.matchedKeywords.includes('react'));

  // Systems / Low-level stack
  const matchSys = selectBestArchetypeByJdHardMatch(
    'Software Engineer',
    'Writing high-performance multithreading concurrency code in C++, Rust, WebAssembly, and Linux kernel systems.'
  );
  assert.equal(matchSys.archetype, 'SYSTEMS_LOWLEVEL');
  assert.ok(matchSys.matchedKeywords.includes('c++'));
  assert.ok(matchSys.matchedKeywords.includes('rust'));

  // Backend Distributed stack
  const matchBackend = selectBestArchetypeByJdHardMatch(
    'Software Engineer',
    'Hands-on with Java Spring Boot, Apache Kafka, microservices, OAuth, and distributed architectures.'
  );
  assert.equal(matchBackend.archetype, 'BACKEND_DISTRIBUTED');
  assert.ok(matchBackend.matchedKeywords.includes('kafka'));
});

test('GEN-469 & GEN-470: Date-bump boost and 30-day same company+role dedup guard', () => {
  // 1. Signature normalization
  const sig1 = normalizeCompanyRoleSignature('Morgan Stanley India', 'Software Engineer - Bengaluru');
  const sig2 = normalizeCompanyRoleSignature('morganstanley', 'Software Engineer');
  assert.equal(sig1, 'morganstanley::softwareengineer');
  assert.equal(sig2, 'morganstanley::softwareengineer');
  assert.equal(sig1, sig2);

  // 2. 30-day dedup detection
  const now = Date.now();
  const threeDaysAgoIso = new Date(now - 3 * 86_400_000).toISOString();
  const thirtyFiveDaysAgoIso = new Date(now - 35 * 86_400_000).toISOString();

  const appliedRows = [
    {
      company: 'Amazon',
      title: 'SDE 1 - Bengaluru',
      appliedAt: threeDaysAgoIso,
    },
    {
      company: 'Google',
      title: 'Software Engineer',
      appliedAt: thirtyFiveDaysAgoIso,
    },
  ];

  // Amazon applied 3 days ago -> should be caught by dedup shield
  const amazonCheck = isAlreadyAppliedSameCompanyRoleWithin30Days('Amazon India', 'SDE 1', appliedRows, now);
  assert.equal(amazonCheck, true);

  // Google applied 35 days ago -> outside 30-day window, eligible to apply
  const googleCheck = isAlreadyAppliedSameCompanyRoleWithin30Days('Google', 'Software Engineer', appliedRows, now);
  assert.equal(googleCheck, false);

  // Microsoft never applied -> eligible
  const msftCheck = isAlreadyAppliedSameCompanyRoleWithin30Days('Microsoft', 'Software Engineer', appliedRows, now);
  assert.equal(msftCheck, false);

  // 3. Date-bump priority boost (+3500 points)
  const baseJob = {
    id: 'job_1',
    company: 'Acme',
    title: 'Software Engineer',
    url: 'https://boards.greenhouse.io/acme/jobs/12345',
    payload: {},
  };
  const baseScore = computeJobPriorityScore(baseJob, now);

  const bumpedJob = {
    id: 'job_2',
    company: 'Acme',
    title: 'Software Engineer',
    url: 'https://boards.greenhouse.io/acme/jobs/12345',
    payload: {
      dateBumpedAt: new Date(now - 2 * 3600_000).toISOString(),
    },
  };
  const bumpedScore = computeJobPriorityScore(bumpedJob, now);
  assert.equal(bumpedScore - baseScore, 3500);

  // 4. India GCC priority boost (+1500 points)
  const gccJob = {
    id: 'job_3',
    company: 'Goldman Sachs', // in domains-gcc.txt
    title: 'Software Engineer',
    url: 'https://boards.greenhouse.io/gs/jobs/12345',
    payload: {
      domain: 'goldmansachs.com',
    },
  };
  const gccScore = computeJobPriorityScore(gccJob, now);
  assert.ok(gccScore >= 1500);
});

test('GEN-471: generateDailyExecutiveDigest writes Markdown and returns complete telemetry', async () => {
  const digest = await generateDailyExecutiveDigest();

  // Validate core milestones
  assert.ok(digest.totalConfirmedApplications >= 243, `Expected >= 243 confirmed applications, got ${digest.totalConfirmedApplications}`);
  assert.ok(digest.outreach.totalLeadsReady >= 301, `Expected >= 301 outreach leads, got ${digest.outreach.totalLeadsReady}`);
  assert.ok(typeof digest.throughput.last1Hour === 'number');
  assert.ok(typeof digest.throughput.last24Hours === 'number');
  assert.ok(typeof digest.inboxLifecycle.totalEvents === 'number');
  assert.ok(typeof digest.doctorHealth.active === 'boolean');

  // Validate generated markdown
  assert.ok(digest.markdown.includes('# Daily Executive Digest'));
  assert.ok(digest.markdown.includes('Total Confirmed Applications'));
  assert.ok(digest.markdown.includes('Inbound Lifecycle & Candidate Traction'));
  assert.ok(digest.markdown.includes('Per-ATS Conversion Rate'));
  assert.ok(digest.markdown.includes('Cold Outreach & Day-5 Second-Touch Engine'));
  assert.ok(digest.markdown.includes('Doctor 30-Minute Self-Heal Status'));

  // Validate file was written to out/DAILY-EXECUTIVE-DIGEST.md
  const outPath = path.resolve('out/DAILY-EXECUTIVE-DIGEST.md');
  assert.equal(fs.existsSync(outPath), true);
  const fileContent = fs.readFileSync(outPath, 'utf8');
  assert.equal(fileContent, digest.markdown);
});
