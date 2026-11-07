import test from 'node:test';
import assert from 'node:assert/strict';
import { selectDiversifiedMultiLaneChunk } from '../../scripts/run-overnight-marathon.js';
import { resolveBySemanticSelfLearning } from './self-learning.js';
import { resolveCandidateAnswer } from './answers.js';
import { getProviderTimeoutConfig, JobActivityWatchdog } from './watchdog-timer.js';
import { getRateLimitKey } from './session-pool.js';
import { composeGroundedNarrative } from './narrative-composer.js';
import type { AutoaplyJobItem, CandidateExtendedProfile } from './types.js';

const mockProfile: CandidateExtendedProfile = {
  personal: {
    firstName: 'Shivam',
    lastName: 'Mahajan',
    email: 'shivam.mahajan.swe@gmail.com',
    phone: '9876543210',
    city: 'Bengaluru',
    state: 'Karnataka',
    country: 'India',
  },
  professional: {
    totalYearsExperience: 1,
    noticePeriodDays: 0,
    expectedSalary: 1200000,
    currentSalary: 900000,
  },
  workAuthorization: {
    authorizedInCountry: true,
    requiresSponsorshipNowOrFuture: false,
    formerEmployee: false,
  },
  education: [
    {
      school: 'Chitkara University',
      degree: 'B.Tech',
      field: 'Computer Science and Engineering',
      graduationYear: 2026,
      gpa: '9.35',
    },
  ],
  experience: [
    {
      company: 'Morgan Stanley',
      title: 'Technology Apprentice',
      startDate: '2025-08-01',
      endDate: '2026-08-01',
      location: 'Bengaluru',
      current: false,
      description: 'Engineered scalable Java Spring Boot backend microservices and Python/PySpark data platforms.',
    },
  ],
  skillYears: {
    java: 2,
    python: 2,
    'spring boot': 1.5,
  },
};

test('GEN-97: selectDiversifiedMultiLaneChunk picks 40 distinct hosts across all 4 lanes with 0 same-host duplicates and 0 Stripe jobs', () => {
  // Generate 200 dummy jobs with massive clusters of Citi (50), Cisco (50), Barclays (20), etc.
  const dummyJobs: AutoaplyJobItem[] = [];

  // 5 Stripe jobs (should be 100% excluded)
  for (let i = 0; i < 5; i++) {
    dummyJobs.push({
      id: `stripe_${i}`,
      company: 'Stripe',
      jobUrl: `https://boards.greenhouse.io/stripe/jobs/${1000 + i}`,
      title: `Software Engineer ${i}`,
      status: 'queued',
    });
  }

  // 10 Fresh Hourly Jobs (Priority #1, different companies)
  for (let i = 0; i < 10; i++) {
    dummyJobs.push({
      id: `hourly_${i}`,
      company: `FreshCompany_${i}`,
      jobUrl: `https://boards.greenhouse.io/fresh_${i}/jobs/100`,
      title: 'Backend Engineer',
      status: 'queued',
      postedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    });
  }

  // 50 Citi Workday Jobs (Massive Cluster)
  for (let i = 0; i < 50; i++) {
    dummyJobs.push({
      id: `citi_${i}`,
      company: 'Citi',
      jobUrl: `https://citi.wd5.myworkdayjobs.com/en-US/2/job/pune/job_${i}`,
      title: `Officer ${i}`,
      status: 'queued',
      postedAt: '2026-10-01T00:00:00Z',
    });
  }

  // 40 Cisco Workday Jobs (Massive Cluster)
  for (let i = 0; i < 40; i++) {
    dummyJobs.push({
      id: `cisco_${i}`,
      company: 'Cisco',
      jobUrl: `https://cisco.wd5.myworkdayjobs.com/en-US/Cisco_Careers/job/bangalore/job_${i}`,
      title: `Software Engineer ${i}`,
      status: 'queued',
      postedAt: '2026-10-01T00:00:00Z',
    });
  }

  // 15 Other Workday companies (Hitachi, HPE, Barclays, Harman, PwC, Intel, ABB, etc.)
  const workdayCompanies = ['Hitachi', 'HPE', 'Barclays', 'Harman', 'PwC', 'Intel', 'ABB', 'Amgen', 'NTT', 'DB', 'Diconium', 'Airbus', 'Rockwell', 'Fugro', 'Philips'];
  for (let i = 0; i < workdayCompanies.length; i++) {
    const comp = workdayCompanies[i]!;
    dummyJobs.push({
      id: `wd_${comp}`,
      company: comp,
      jobUrl: `https://${comp.toLowerCase()}.wd3.myworkdayjobs.com/en-US/careers/job/${comp}_1`,
      title: 'Engineer',
      status: 'queued',
      postedAt: '2026-10-01T00:00:00Z',
    });
  }

  // 20 Greenhouse companies
  for (let i = 0; i < 20; i++) {
    dummyJobs.push({
      id: `gh_${i}`,
      company: `GHCompany_${i}`,
      jobUrl: `https://boards.greenhouse.io/gh_${i}/jobs/200`,
      title: 'Full Stack Engineer',
      status: 'queued',
      postedAt: '2026-10-01T00:00:00Z',
    });
  }

  // 20 Ashby companies
  for (let i = 0; i < 20; i++) {
    dummyJobs.push({
      id: `ashby_${i}`,
      company: `AshbyCompany_${i}`,
      jobUrl: `https://jobs.ashbyhq.com/ashby_${i}/app`,
      title: 'Product Engineer',
      status: 'queued',
      postedAt: '2026-10-01T00:00:00Z',
    });
  }

  // 20 Other/SmartRecruiters companies
  for (let i = 0; i < 20; i++) {
    dummyJobs.push({
      id: `other_${i}`,
      company: `OtherCompany_${i}`,
      jobUrl: `https://jobs.smartrecruiters.com/other_${i}/app`,
      title: 'DevOps Engineer',
      status: 'queued',
      postedAt: '2026-10-01T00:00:00Z',
    });
  }

  // Run selectDiversifiedMultiLaneChunk with 40-job chunk size
  const chunk = selectDiversifiedMultiLaneChunk(dummyJobs, 40, () => true);

  // Assertions
  assert.equal(chunk.length, 40, 'Should select exactly 40 jobs');

  // Verify 0 Stripe jobs
  const stripeHits = chunk.filter(j => /stripe/i.test(j.company) || /stripe/i.test(j.jobUrl));
  assert.equal(stripeHits.length, 0, 'Must contain 0 Stripe jobs');

  // Verify 0 same-host / same-rate-limit-key duplicates
  const hostCounts = new Map<string, number>();
  for (const job of chunk) {
    const host = getRateLimitKey(job.jobUrl).toLowerCase();
    hostCounts.set(host, (hostCounts.get(host) || 0) + 1);
  }
  for (const [host, count] of hostCounts.entries()) {
    assert.equal(count, 1, `Rate limit key / host ${host} appeared ${count} times; must be max 1!`);
  }

  // Verify Citi appeared at most 1 time despite having 50 jobs
  const citiHits = chunk.filter(j => j.company.toLowerCase() === 'citi');
  assert.equal(citiHits.length, 1, 'Citi must appear exactly 1 time in the chunk');

  // Verify Cisco appeared at most 1 time
  const ciscoHits = chunk.filter(j => j.company.toLowerCase() === 'cisco');
  assert.equal(ciscoHits.length, 1, 'Cisco must appear exactly 1 time in the chunk');

  // Verify multi-lane interleaving: Greenhouse, Ashby, Workday, and Other all got slots
  const ghCount = chunk.filter(j => j.jobUrl.includes('greenhouse.io')).length;
  const ashbyCount = chunk.filter(j => j.jobUrl.includes('ashbyhq.com')).length;
  const wdCount = chunk.filter(j => j.jobUrl.includes('myworkdayjobs.com')).length;
  const otherCount = chunk.filter(j => j.jobUrl.includes('smartrecruiters.com')).length;

  assert.ok(ghCount >= 8, `Greenhouse should have >= 8 jobs (got ${ghCount})`);
  assert.ok(ashbyCount >= 5, `Ashby should have >= 5 jobs (got ${ashbyCount})`);
  assert.ok(wdCount >= 8, `Workday should have >= 8 jobs (got ${wdCount})`);
  assert.ok(otherCount >= 5, `Other/SmartRecruiters should have >= 5 jobs (got ${otherCount})`);
});

test('GEN-96: All 10 Section-4 questions resolve deterministically', () => {
  // 1) Total years of full time experience -> "1" (Never 3!)
  const yoeLearned = resolveBySemanticSelfLearning(
    'How many years of full time experience do you have?*',
    'TEXT',
    null,
    null,
    mockProfile
  );
  assert.equal(yoeLearned?.value, '1', 'Years of experience must be 1');

  const yoeAnswer = resolveCandidateAnswer(
    'total_experience',
    mockProfile,
    { question: 'How many years of full time experience do you have?*' }
  );
  assert.equal(yoeAnswer.value, '1', 'Candidate answer must be 1');

  // 2) Have you previously worked at or consulted for GitLab? -> "No"
  const gitlabLearned = resolveBySemanticSelfLearning(
    'Have you previously worked at or consulted for GitLab?*',
    'TEXT',
    ['Yes', 'No'],
    null,
    mockProfile
  );
  assert.equal(gitlabLearned?.value, 'No', 'GitLab previous work must be No');

  // 3) Will you now or in the future require sponsorship...? -> "No"
  const sponsorLearned = resolveBySemanticSelfLearning(
    'Will you now or in the future require sponsorship for a visa to remain in your current location?*',
    'TEXT',
    ['Yes', 'No'],
    null,
    mockProfile
  );
  assert.equal(sponsorLearned?.value, 'No', 'Sponsorship requirement must be No');

  // 4) Ruby on Rails narrative -> Adjacent-stack Morgan Stanley Spring Boot / Python / Kafka
  const rorNarrative = composeGroundedNarrative(
    'Give example of your experience building and maintaining production Ruby on Rails applications',
    mockProfile
  );
  assert.ok(rorNarrative, 'Ruby on Rails narrative must not be null');
  assert.ok(rorNarrative.includes('Morgan Stanley'), 'Narrative must reference Morgan Stanley');
  assert.ok(rorNarrative.includes('Spring Boot'), 'Narrative must reference Spring Boot');
  assert.ok(rorNarrative.includes('Kafka'), 'Narrative must reference Kafka');

  const rorAnswer = resolveCandidateAnswer(
    'skill_experience',
    mockProfile,
    {
      question: 'Give example of your experience building and maintaining production Ruby on Rails applications',
      fieldType: 'textarea',
    }
  );
  assert.ok(rorAnswer.value, 'Textarea answer must resolve');
  assert.ok(typeof rorAnswer.value === 'string' && rorAnswer.value.includes('Morgan Stanley'));

  // 5) How soon can you start with us? -> "I can start right away"
  const noticeOptions = [
    'I can start right away',
    'I can start 1 month from now',
    'I can start 2 months from now',
    'I can start 3 months from now',
  ];
  const noticeLearned = resolveBySemanticSelfLearning(
    'How soon can you start with us?*',
    'COMBOBOX',
    noticeOptions,
    null,
    mockProfile
  );
  assert.equal(noticeLearned?.value, 'I can start right away');

  const noticeAnswer = resolveCandidateAnswer(
    'notice_period',
    mockProfile,
    {
      question: 'How soon can you start with us?*',
      options: noticeOptions,
    }
  );
  assert.equal(noticeAnswer.value, 'I can start right away');

  // 6) Educational Qualification -> "BE/B.Tech / Dual Degree -  Computer Science /EE"
  const eduOptions = [
    'BE/B.Tech / Dual Degree -  Computer Science /EE',
    'Other',
  ];
  const eduLearned = resolveBySemanticSelfLearning(
    'Educational Qualification*',
    'COMBOBOX',
    eduOptions,
    null,
    mockProfile
  );
  assert.equal(eduLearned?.value, 'BE/B.Tech / Dual Degree -  Computer Science /EE');

  // 7) Name of the College -> "Other"
  const collegeOptions = ['IIT', 'Other'];
  const collegeLearned = resolveBySemanticSelfLearning(
    'Name of the College*',
    'COMBOBOX',
    collegeOptions,
    null,
    mockProfile
  );
  assert.equal(collegeLearned?.value, 'Other');

  // 8) Are you comfortable with performing highly repetitive tasks? -> "Yes"
  const taskLearned = resolveBySemanticSelfLearning(
    'Are you comfortable with performing highly repetitive tasks?',
    'INPUT',
    null,
    null,
    mockProfile
  );
  assert.equal(taskLearned?.value, 'Yes');

  // 9) Phone direct resolution
  const phoneAnswer = resolveCandidateAnswer(
    'phone',
    mockProfile,
    { question: 'Phone' }
  );
  assert.equal(phoneAnswer.value, mockProfile.personal.phone);

  // 10) Country/Region
  const countryOptions = ['United States', 'United Kingdom', 'India', 'Germany'];
  const countryLearned = resolveBySemanticSelfLearning(
    'Country/Region*',
    'COMBOBOX',
    countryOptions,
    null,
    mockProfile
  );
  assert.equal(countryLearned?.value, 'India');
});

test('GEN-98/104: Watchdog timeouts configured for fail-fast (150s Greenhouse/Ashby/Lever/SmartRecruiters and 180s Workday)', () => {
  const workdayCfg = getProviderTimeoutConfig('https://citi.wd5.myworkdayjobs.com/en-US/2/job/pune');
  assert.equal(workdayCfg.maxTotalMs, 180000, 'Workday total timeout must be 180s');
  assert.equal(workdayCfg.maxIdleMs, 50000, 'Workday idle timeout must be 50s');

  const ghCfg = getProviderTimeoutConfig('https://boards.greenhouse.io/figma/jobs/123');
  assert.equal(ghCfg.maxTotalMs, 150000, 'Greenhouse total timeout must be 150s');
  assert.equal(ghCfg.maxIdleMs, 45000, 'Greenhouse idle timeout must be 45s');

  const ashbyCfg = getProviderTimeoutConfig('https://jobs.ashbyhq.com/linear/app');
  assert.equal(ashbyCfg.maxTotalMs, 150000, 'Ashby total timeout must be 150s');
  assert.equal(ashbyCfg.maxIdleMs, 45000, 'Ashby idle timeout must be 45s');

  const srCfg = getProviderTimeoutConfig('https://jobs.smartrecruiters.com/miratech/123');
  assert.equal(srCfg.maxTotalMs, 150000, 'SmartRecruiters total timeout must be 150s');
  assert.equal(srCfg.maxIdleMs, 45000, 'SmartRecruiters idle timeout must be 45s');

  const watchdog = new JobActivityWatchdog(workdayCfg.maxTotalMs, workdayCfg.maxIdleMs);
  assert.equal(watchdog.maxTotalMs, 180000);
  assert.equal(watchdog.maxIdleMs, 50000);
});
