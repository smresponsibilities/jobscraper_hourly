// src/autoapply/gen-72-78.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeGmailTenantAlias } from './imap-verifier.js';
import { isUnsupportedProprietaryPortal } from './preflight.js';
import { resolveUniversalPermissiveFallback } from './permissive-fallback.js';
import { resolveCandidateAnswer } from './answers.js';
import { computeJobPriorityScore, isFillableAtsUrl, type QueuedJobCandidate } from './priority-scheduler.js';
import { readJobRunHistory, sanitizeRunHistoryFile, HISTORY_FILE } from './run-history.js';
import { fillSmartRecruitersCountryCombobox } from './widgets.js';
import { canonicalRequisition, sameRequisition } from './identity.js';
import { fastApiPreflightCheck } from './tiered-fetcher.js';
import type { CandidateExtendedProfile } from './types.js';

describe('Tickets GEN-72 through GEN-78 Test Suite', () => {
  const dummyProfile: CandidateExtendedProfile = {
    personal: {
      firstName: 'Synthetic',
      lastName: 'Applicant',
      email: 'user@example.test',
      phone: '9000000000',
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
    experience: [],
    workAuthorization: {} as any,
    eeo: {} as any,
  };

  describe('GEN-73 & GEN-74: Gmail +alias Workday Tenant Generator', () => {
    it('generates deterministic +wd_<tenant> alias for Workday tenants', () => {
      const aliasCiti = makeGmailTenantAlias('user@gmail.com', 'https://citi.wd5.myworkdayjobs.com/en-US/Careers/job/123');
      assert.equal(aliasCiti, 'user+wd_citi@gmail.com');

      const aliasBarclays = makeGmailTenantAlias('user@gmail.com', 'https://barclays.wd3.myworkdayjobs.com/BarclaysCareers');
      assert.equal(aliasBarclays, 'user+wd_barclays@gmail.com');

      const aliasAirbus = makeGmailTenantAlias('john.doe@gmail.com', 'https://airbus.wd3.myworkdayjobs.com/Airbus');
      assert.equal(aliasAirbus, 'john.doe+wd_airbus@gmail.com');
    });

    it('preserves existing non-alias local parts cleanly', () => {
      const aliasAlready = makeGmailTenantAlias('user+old@gmail.com', 'https://cisco.wd5.myworkdayjobs.com/Cisco');
      assert.equal(aliasAlready, 'user+wd_cisco@gmail.com');
    });
  });

  describe('GEN-75: Hourly Direct ATS Routing & Proprietary Portal Blocking', () => {
    it('blocks oraclecloud.com, raw linkedin, and raw ycombinator URLs in preflight', () => {
      assert.equal(isUnsupportedProprietaryPortal('https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/123'), true);
      assert.equal(isUnsupportedProprietaryPortal('https://www.linkedin.com/jobs/view/3928172910'), true);
      assert.equal(isUnsupportedProprietaryPortal('https://www.ycombinator.com/companies/biorender/jobs/12345'), true);
    });

    it('allows direct ATS forms through preflight', () => {
      assert.equal(isUnsupportedProprietaryPortal('https://boards.greenhouse.io/stripe/jobs/12345'), false);
      assert.equal(isUnsupportedProprietaryPortal('https://jobs.lever.co/postman/67890'), false);
      assert.equal(isUnsupportedProprietaryPortal('https://jobs.ashbyhq.com/modernhealth/54321'), false);
      assert.equal(isUnsupportedProprietaryPortal('https://citi.wd5.myworkdayjobs.com/Careers/job/123'), false);
    });

    it('grants +10,000 priority only to fillable direct ATS URLs, demoting wrapper URLs', () => {
      const now = Date.now();
      const directAtsJob: QueuedJobCandidate = {
        id: 'direct_1',
        company: 'Stripe',
        title: 'Software Engineer',
        url: 'https://boards.greenhouse.io/stripe/jobs/123',
        isHourlyFresh: true,
      };
      const wrapperJob: QueuedJobCandidate = {
        id: 'wrapper_1',
        company: 'BioRender',
        title: 'Backend Engineer',
        url: 'https://www.ycombinator.com/companies/biorender/jobs/123',
        isHourlyFresh: true,
      };

      assert.equal(isFillableAtsUrl(directAtsJob.url), true);
      assert.equal(isFillableAtsUrl(wrapperJob.url), false);

      const directScore = computeJobPriorityScore(directAtsJob, now);
      const wrapperScore = computeJobPriorityScore(wrapperJob, now);

      assert.ok(directScore >= 10000, `Direct ATS job must get +10,000 preemption score, got ${directScore}`);
      assert.ok(wrapperScore < 10000, `Wrapper job must NOT get +10,000 preemption score, got ${wrapperScore}`);
    });
  });

  describe('GEN-75: Corrupted Run Duration Sanitation', () => {
    it('ensures zero entries > 360,000ms exist in run-history.jsonl', () => {
      sanitizeRunHistoryFile();
      const entries = readJobRunHistory(500);
      for (const e of entries) {
        assert.ok(e.durationMs <= 360_000, `entry for ${e.company} had duration ${e.durationMs}ms which exceeds 360,000ms`);
      }
    });
  });

  describe('GEN-76: Attempt-1 Universal Permissive Fallback for Domain & Protocol Questions', () => {
    it('resolves FIX protocol questions without PARKED_MISSING_FACT', () => {
      const fixAnswer = resolveUniversalPermissiveFallback({
        questionText: 'Describe your experience with the FIX protocol',
        widgetKind: 'TEXT',
        options: null,
        profileEmail: 'test@example.com',
      });
      assert.ok(fixAnswer && fixAnswer.length > 10, 'Expected non-empty FIX experience text');
      assert.ok(!/PARKED_MISSING_FACT/i.test(fixAnswer));

      const fixAnswerDropdown = resolveUniversalPermissiveFallback({
        questionText: 'Do you have experience with FIX protocol?',
        widgetKind: 'SINGLE_SELECT',
        options: ['Yes', 'No'],
        profileEmail: 'test@example.com',
      });
      assert.equal(fixAnswerDropdown, 'Yes');
    });

    it('resolves through resolveCandidateAnswer on Attempt 1 without returning needs_review or missing fact', () => {
      const ans = resolveCandidateAnswer('skill_experience', dummyProfile, {
        url: 'https://boards.greenhouse.io/flextrade/jobs/123',
        question: 'Do you have experience with FIX protocol?',
        options: ['Yes', 'No'],
        fieldType: 'SINGLE_SELECT',
      });
      assert.ok(ans.value !== undefined, 'Expected answer value to be resolved on Attempt 1');
      assert.equal(ans.reason, 'universal_permissive_fallback');
      assert.equal(ans.value, 'Yes');
    });
  });

  describe('GEN-77 & GEN-78: SmartRecruiters Combobox & Greenhouse Embed Identity', () => {
    it('exports fillSmartRecruitersCountryCombobox helper function', () => {
      assert.equal(typeof fillSmartRecruitersCountryCombobox, 'function');
    });

    it('matches requisition identities for Greenhouse embed URLs', () => {
      const canonical = canonicalRequisition('https://boards.greenhouse.io/embed/job_app?for=company&token=12345');
      assert.ok(canonical);
      assert.equal(canonical?.provider, 'greenhouse');
      assert.equal(canonical?.jobId, '12345');

      const regular = canonicalRequisition('https://boards.greenhouse.io/company/jobs/12345');
      assert.ok(regular);
      assert.equal(sameRequisition(regular!, canonical!), true);
    });
  });

  describe('Generalized Closed Job Fast-Skip & Preflight', () => {
    it('blocks news.ycombinator.com, turbohire.co, eightfold.ai, and bajajauto careers in preflight', () => {
      assert.equal(isUnsupportedProprietaryPortal('https://news.ycombinator.com/item?id=50357486'), true);
      assert.equal(isUnsupportedProprietaryPortal('https://navi.turbohire.co/jobs/12345'), true);
      assert.equal(isUnsupportedProprietaryPortal('https://hp.eightfold.ai/careers/job/45205119'), true);
      assert.equal(isUnsupportedProprietaryPortal('https://careers.bajajauto.com/job/Full-Stack-Developer/1263198801/'), true);
    });

    it('fast-skips unsupported portal URLs in 0ms via fastApiPreflightCheck', async () => {
      const res = await fastApiPreflightCheck('https://news.ycombinator.com/item?id=50357486');
      assert.equal(res.status, 'skipped');
      assert.equal(res.reason, 'unsupported_proprietary_portal');
    });

    it('generalizes fastApiPreflightCheck to skip closed Workday CXS endpoints returning 404', async () => {
      const fakeFetcher = async (url: string) => {
        if (url.includes('/wday/cxs/')) {
          return { status: 404, ok: false, json: async () => ({}) };
        }
        return { status: 200, ok: true, json: async () => ({}) };
      };
      const res = await fastApiPreflightCheck(
        'https://gia.wd1.myworkdayjobs.com/en-US/GIAServices/job/Associate_R0011399',
        { fetcher: fakeFetcher as any }
      );
      assert.equal(res.status, 'skipped');
      assert.equal(res.reason, 'job_closed');
    });

    it('generalizes fastApiPreflightCheck to skip archived SmartRecruiters postings', async () => {
      const fakeFetcher = async (url: string) => {
        if (url.includes('api.smartrecruiters.com')) {
          return { status: 200, ok: true, json: async () => ({ active: false, released: false }) };
        }
        return { status: 200, ok: true, json: async () => ({}) };
      };
      const res = await fastApiPreflightCheck(
        'https://jobs.smartrecruiters.com/Eurofins/744000158214474',
        { fetcher: fakeFetcher as any }
      );
      assert.equal(res.status, 'skipped');
      assert.equal(res.reason, 'job_closed');
    });

    it('generalizes fastApiPreflightCheck to skip unlisted Ashby postings', async () => {
      const fakeFetcher = async (url: string) => {
        if (url.includes('api.ashbyhq.com')) {
          return { status: 200, ok: true, json: async () => ({ jobs: [{ id: '999', isListed: true }] }) };
        }
        return { status: 200, ok: true, json: async () => ({}) };
      };
      const res = await fastApiPreflightCheck(
        'https://jobs.ashbyhq.com/diagrid/06fdf2f3-fff0-4628-b58c-2c07d408e656/application',
        { fetcher: fakeFetcher as any }
      );
      assert.equal(res.status, 'skipped');
      assert.equal(res.reason, 'job_closed');
    });
  });
});
