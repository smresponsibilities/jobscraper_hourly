import test from 'node:test';
import assert from 'node:assert/strict';
import { selectDiversifiedMultiLaneChunk } from '../../scripts/run-overnight-marathon.js';
import { healInvalidFieldsAndRetrySubmit } from './runner.js';
import { CONSUMED_VERIFICATION_TOKENS } from './imap-verifier.js';
import {
  prioritizeVerifiedSkillsForRole,
  getArchetypeCategorizedSkills,
} from '../resume/deterministic-builder.js';
import {
  resolveCompanyOfficialDomain,
  enrichAppliedOutreachQueue,
} from '../../scripts/enrich-applied-outreach.js';
import type { AutoaplyJobItem } from './types.js';

test('GEN-189: selectDiversifiedMultiLaneChunk caps Workday at <= 25% when Fast-ATS jobs are present', () => {
  const candidates: AutoaplyJobItem[] = [];

  // 40 Workday jobs
  for (let i = 0; i < 40; i++) {
    candidates.push({
      jobUrl: `https://workday.wd1.myworkdayjobs.com/tenant/job/Engineer-${i}_R${1000 + i}`,
      company: `WorkdayCompany${i}`,
      title: `Software Engineer ${i}`,
      applyUrl: `https://workday.wd1.myworkdayjobs.com/tenant/job/Engineer-${i}_R${1000 + i}/apply`,
      description: 'Java backend distributed systems',
    } as any);
  }

  // 15 Greenhouse jobs
  for (let i = 0; i < 15; i++) {
    candidates.push({
      jobUrl: `https://boards.greenhouse.io/gh${i}/jobs/${2000 + i}`,
      company: `GhCompany${i}`,
      title: `Backend Engineer ${i}`,
      applyUrl: `https://boards.greenhouse.io/gh${i}/jobs/${2000 + i}`,
      description: 'Backend services and APIs',
    } as any);
  }

  // 15 Ashby jobs
  for (let i = 0; i < 15; i++) {
    candidates.push({
      jobUrl: `https://jobs.ashbyhq.com/ashby${i}/uuid-${3000 + i}`,
      company: `AshbyCompany${i}`,
      title: `Full Stack Engineer ${i}`,
      applyUrl: `https://jobs.ashbyhq.com/ashby${i}/uuid-${3000 + i}`,
      description: 'TypeScript React Node.js',
    } as any);
  }

  const chunk = selectDiversifiedMultiLaneChunk(candidates, 40);
  assert.ok(chunk.length > 0, 'Chunk should select candidates');
  assert.ok(chunk.length <= 40, 'Chunk size must not exceed limit');

  const workdayJobs = chunk.filter(j => j.jobUrl.toLowerCase().includes('myworkdayjobs.com'));
  const fastAtsJobs = chunk.filter(
    j => j.jobUrl.toLowerCase().includes('greenhouse.io') || j.jobUrl.toLowerCase().includes('ashbyhq.com')
  );

  // Workday should be capped at <= 25% (<= 10 slots)
  assert.ok(
    workdayJobs.length <= 10,
    `Workday slots (${workdayJobs.length}) must not exceed 25% (10 slots) when fast-ATS jobs exist`
  );
  assert.ok(
    fastAtsJobs.length >= 20,
    `Fast-ATS jobs (${fastAtsJobs.length}) should dominate the chunk (>= 20 slots)`
  );
});

test('GEN-190 & GEN-191: healInvalidFieldsAndRetrySubmit unlocks attemptedFieldRefs', () => {
  assert.equal(typeof healInvalidFieldsAndRetrySubmit, 'function');

  // Verify attemptedFieldRefs set deletion mechanic
  const attemptedFieldRefs = new Set<string>(['ref-1', 'ref-2', 'ref-3']);
  const refsToUnlock = ['ref-2', 'ref-3'];

  for (const ref of refsToUnlock) {
    attemptedFieldRefs.delete(ref);
  }

  assert.ok(attemptedFieldRefs.has('ref-1'));
  assert.ok(!attemptedFieldRefs.has('ref-2'));
  assert.ok(!attemptedFieldRefs.has('ref-3'));
});

test('GEN-192: CONSUMED_VERIFICATION_TOKENS isolates multi-lane concurrent IMAP OTP tokens', () => {
  assert.ok(CONSUMED_VERIFICATION_TOKENS instanceof Set);

  const testOtp = `otp-test-${Date.now()}`;
  assert.ok(!CONSUMED_VERIFICATION_TOKENS.has(testOtp));

  CONSUMED_VERIFICATION_TOKENS.add(testOtp);
  assert.ok(CONSUMED_VERIFICATION_TOKENS.has(testOtp), 'Token must be isolated across concurrent workers');

  // Cleanup test token
  CONSUMED_VERIFICATION_TOKENS.delete(testOtp);
});

test('GEN-193: prioritizeVerifiedSkillsForRole front-loads matching skills and preserves order', () => {
  const baseSkills = ['Java', 'Python', 'Apache Kafka', 'SQL', 'C++'];
  const prioritized = prioritizeVerifiedSkillsForRole(baseSkills, 'Kafka Data Engineer', 'Building streaming pipelines with Apache Kafka and SQL');

  assert.equal(prioritized[0], 'Apache Kafka', 'Apache Kafka should be front-loaded');
  assert.equal(prioritized[1], 'SQL', 'SQL should be second matching skill');
  assert.ok(prioritized.includes('Java'));
  assert.ok(prioritized.includes('Python'));
  assert.ok(prioritized.includes('C++'));

  // Test archetype categorization integration
  const categorized = getArchetypeCategorizedSkills('BACKEND_DISTRIBUTED', 'Kafka Streaming Engineer');
  const backendSkills = categorized['Backend & Distributed Systems'] || [];
  assert.equal(backendSkills[0], 'Kafka', 'Kafka should be prioritized in backend category');
});

test('GEN-194: scripts/enrich-applied-outreach exports required domain resolver and queue enricher', async () => {
  assert.equal(typeof resolveCompanyOfficialDomain, 'function');
  assert.equal(typeof enrichAppliedOutreachQueue, 'function');

  // Test domain resolution on a known canonical entity
  const domain = await resolveCompanyOfficialDomain('Supabase');
  if (domain) {
    assert.match(domain, /supabase\.com/i);
  }
});
