// src/autoapply/gen-67-71.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeJobPriorityScore,
  type QueuedJobCandidate,
} from './priority-scheduler.js';
import {
  extractCleanQuestionText,
} from './distiller.js';
import {
  inferAnswerFromOptionSignature,
  resolveBySemanticSelfLearning,
} from './self-learning.js';
import {
  isUnsupportedProprietaryPortal,
} from './preflight.js';
import {
  appendJobRunHistory,
  readJobRunHistory,
  type JobRunHistoryEntry,
} from './run-history.js';
import {
  getHourlyJobsData,
} from '../../scripts/dashboard-server.js';
import type { CandidateExtendedProfile } from './types.js';

describe('Tickets GEN-67 through GEN-71 Implementation Suite', () => {
  const dummyProfile: CandidateExtendedProfile = {
    personal: {
      firstName: 'Shivam',
      lastName: 'Mahajan',
      email: 'shivam.mahajan@example.com',
      phone: '+919876543210',
      city: 'Bengaluru',
      state: 'Karnataka',
      country: 'India',
    },
    education: [
      {
        school: 'Chitkara University',
        degree: 'Bachelor of Engineering',
        field: 'Computer Science',
        graduationYear: '2026',
        gpa: '9.35',
      },
    ],
    professional: {
      totalYearsExperience: 1,
      expectedSalary: 1200000,
      noticePeriodDays: 0,
    },
  };

  describe('GEN-71: Hourly Fresh Job Priority Preemption (+10,000 pts)', () => {
    it('awards +10,000 priority points when isHourlyFresh is true', () => {
      const now = Date.now();
      const backfillJob: QueuedJobCandidate = {
        id: 'backfill_1',
        company: 'Legacy Corp',
        title: 'Software Engineer',
        url: 'https://example.com/job/1',
        createdAtMs: now - 3600_000 * 48, // 2 days old
      };

      const hourlyFreshJob: QueuedJobCandidate = {
        id: 'hourly_1',
        company: 'Stripe Partner',
        title: 'Software Engineer',
        url: 'https://example.com/job/2',
        createdAtMs: now - 600_000, // 10 minutes old
        isHourlyFresh: true,
        hourlySource: 'github_hunt',
        discoveredAt: new Date(now - 600_000).toISOString(),
      };

      const backfillScore = computeJobPriorityScore(backfillJob, now);
      const hourlyScore = computeJobPriorityScore(hourlyFreshJob, now);

      assert.ok(hourlyScore > backfillScore + 9000, `Hourly score (${hourlyScore}) must preempt backfill (${backfillScore}) by > 9000 pts`);
    });

    it('awards +10,000 priority points when payload has isHourlyFresh: true', () => {
      const now = Date.now();
      const jobWithPayload: QueuedJobCandidate = {
        id: 'hourly_payload_1',
        company: 'Fast Startup',
        title: 'Backend Engineer',
        url: 'https://jobs.ashbyhq.com/fast/1',
        payload: {
          isHourlyFresh: true,
          hourlySource: 'linkedin_1h',
        },
      };

      const score = computeJobPriorityScore(jobWithPayload, now);
      assert.ok(score >= 10000, `Score (${score}) must include +10,000 hourly boost`);
    });

    it('returns structured hourly data from getHourlyJobsData()', () => {
      const data = getHourlyJobsData();
      assert.ok(data);
      assert.equal(typeof data.discovered1h, 'number');
      assert.equal(typeof data.discovered24h, 'number');
      assert.equal(typeof data.appliedHourlyCount, 'number');
      assert.equal(typeof data.queuedHourlyCount, 'number');
      assert.ok(data.bySource && typeof data.bySource === 'object');
      assert.ok(Array.isArray(data.jobs));
    });
  });

  describe('GEN-68: Distiller Bare Option Filter & Clean Question Extraction', () => {
    it('rejects bare "Yes" / "No" option labels and climbs to the real question legend/title', () => {
      // Mock DOM element simulating a radio button inside a fieldset
      const mockFieldset = {
        parentElement: null,
        matches: () => false,
        getAttribute: () => null,
        querySelector: (sel: string) => {
          if (sel.includes('legend')) {
            return { textContent: 'Are you legally authorized to work in India?' };
          }
          return null;
        },
        querySelectorAll: () => [],
        cloneNode: () => ({
          querySelectorAll: () => [],
          textContent: 'Are you legally authorized to work in India? Yes No',
        }),
        getRootNode: () => ({
          querySelector: (sel: string) => {
            if (sel.includes('label[for=')) {
              return { textContent: 'Yes' }; // Bare label for radio ID
            }
            return null;
          },
        }),
      } as any;

      const mockRadio = {
        id: 'work_auth_yes',
        type: 'radio',
        parentElement: mockFieldset,
        closest: () => null,
        getAttribute: () => null,
        labels: [{ textContent: 'Yes' }],
        getRootNode: () => mockFieldset.getRootNode(),
      } as any;

      const extracted = extractCleanQuestionText(mockFieldset, [mockRadio]);
      assert.equal(extracted, 'Are you legally authorized to work in India?');
      assert.notEqual(extracted.toLowerCase(), 'yes');
    });
  });

  describe('GEN-68 & GEN-69: Top 15 Unmapped Question Resolvers in self-learning.ts', () => {
    it('resolves Month options to August (#7)', () => {
      const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      const res = inferAnswerFromOptionSignature('Start Month', months);
      assert.ok(res);
      assert.equal(res.value, 'August');
    });

    it('resolves Graduation Year to 2026 and Start Year to 2022 (#7)', () => {
      const years = ['2020', '2021', '2022', '2023', '2024', '2025', '2026', '2027', '2028'];
      const gradRes = inferAnswerFromOptionSignature('Year of Graduation / Completion', years);
      assert.ok(gradRes);
      assert.equal(gradRes.value, '2026');

      const startRes = inferAnswerFromOptionSignature('Start Year / From Year', years);
      assert.ok(startRes);
      assert.equal(startRes.value, '2022');
    });

    it('resolves Alert Frequency to "7" (#8)', () => {
      const res = resolveBySemanticSelfLearning('alert_frequency', 'SINGLE_SELECT', ['Daily', 'Weekly (7 days)', 'Monthly'], null, dummyProfile);
      assert.ok(res);
      assert.ok(res.value.includes('7') || res.value.toLowerCase().includes('weekly'));
    });

    it('resolves Confirm Email to candidate email (#11, #5, #6)', () => {
      const res = resolveBySemanticSelfLearning('Confirm Email Address*', 'TEXT', null, null, dummyProfile);
      assert.ok(res);
      assert.equal(res.value, 'shivam.mahajan@example.com');
    });

    it('resolves Accounting/ERP systems checklist to SQL/Python or None (#13)', () => {
      const optionsWithSql = ['QuickBooks', 'SAP ERP', 'SQL / Relational DBs', 'NetSuite'];
      const res1 = resolveBySemanticSelfLearning('Which financial or accounting systems have you used?', 'MULTI_SELECT', optionsWithSql, null, dummyProfile);
      assert.ok(res1);
      assert.equal(res1.value, 'SQL / Relational DBs');

      const optionsNone = ['Oracle Financials', 'Workday Financials', 'None of the above'];
      const res2 = resolveBySemanticSelfLearning('Accounting and ERP tools', 'SINGLE_SELECT', optionsNone, null, dummyProfile);
      assert.ok(res2);
      assert.equal(res2.value, 'None of the above');
    });

    it('resolves Post-employment restrictions to No (#14)', () => {
      const res = resolveBySemanticSelfLearning('Are you subject to any post-employment restrictions or non-compete agreements?', 'BOOLEAN_TOGGLE', ['Yes', 'No'], null, dummyProfile);
      assert.ok(res);
      assert.equal(res.value, 'No');
    });

    it('resolves Location (City) and Country/Region to Bengaluru and India (#3, #4, #12, #15)', () => {
      const cityRes = resolveBySemanticSelfLearning('Location (City)*', 'SINGLE_SELECT', ['New York', 'London', 'Bengaluru', 'Tokyo'], null, dummyProfile);
      assert.ok(cityRes);
      assert.equal(cityRes.value, 'Bengaluru');

      const countryRes = resolveBySemanticSelfLearning('Country/Region*', 'SINGLE_SELECT', ['United States', 'United Kingdom', 'India', 'Germany'], null, dummyProfile);
      assert.ok(countryRes);
      assert.equal(countryRes.value, 'India');
    });
  });

  describe('GEN-70: Preflight Blocking & Deduplicated Run History', () => {
    it('blocks successfactors.com and jobs.mahindra.com in preflight', () => {
      assert.equal(isUnsupportedProprietaryPortal('https://jobs.mahindra.com/job/Mumbai/123'), true);
      assert.equal(isUnsupportedProprietaryPortal('https://performancemanager8.successfactors.com/careers?company=123'), true);
      assert.equal(isUnsupportedProprietaryPortal('https://jobs.ashbyhq.com/valid/123'), false);
    });

    it('prevents marking status as applied if fieldsFilled is 0 or reason indicates timeout', () => {
      const fakeEntry: JobRunHistoryEntry = {
        jobId: `test_gen70_${Date.now()}`,
        company: 'Test Company',
        title: 'Software Engineer',
        provider: 'workday',
        lane: 'workday',
        url: 'https://example.com/test',
        status: 'applied',
        reason: 'Job timed out after 300000ms',
        fieldsFilled: 0,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 300000,
      };

      appendJobRunHistory(fakeEntry);
      const history = readJobRunHistory(10);
      const found = history.find(h => h.jobId === fakeEntry.jobId);
      assert.ok(found);
      assert.equal(found.status, 'failed', 'Status must be coerced to failed when fieldsFilled === 0 or reason has timeout');
    });
  });
});
