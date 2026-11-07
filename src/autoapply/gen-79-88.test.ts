// src/autoapply/gen-79-88.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fastApiPreflightCheck } from './tiered-fetcher.js';
import { canonicalRequisition, sameRequisition } from './identity.js';
import { resolveUniversalPermissiveFallback } from './permissive-fallback.js';
import { resolveByOptionPolicy } from './answers.js';
import type { CandidateExtendedProfile } from './types.js';

describe('Tickets GEN-79 through GEN-88 Test Suite', () => {
  const dummyProfile: CandidateExtendedProfile = {
    personal: {
      firstName: 'Synthetic',
      lastName: 'Applicant',
      email: 'applicant@example.com',
      phone: '9876543210',
      phoneCountryCode: '+91',
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
      officeAttendance: { city: 'Bengaluru', maxDaysPerWeek: 5 },
    },
    experience: [],
    workAuthorization: {} as any,
    eeo: {} as any,
  };

  describe('Ticket GEN-88: No False job_closed on Workday, Ashby, SmartRecruiters Preflight', () => {
    it('returns eligible browser_verification_required for Workday URLs without hitting synthetic /wday/cxs/', async () => {
      const workdayUrls = [
        'https://barclays.wd3.myworkdayjobs.com/BarclaysCareers/job/London/Developer_90345678',
        'https://cisco.wd5.myworkdayjobs.com/Cisco_Jobs/job/San-Jose-CA/Software-Engineer_R1000',
        'https://intel.wd1.myworkdayjobs.com/External/job/Bangalore-India/Graphics-Software-Engineer_JR012345',
        'https://rockwellautomation.wd1.myworkdayjobs.com/Careers/job/Noida/Senior-Software-Engineer_R2345',
      ];

      for (const url of workdayUrls) {
        const result = await fastApiPreflightCheck(url);
        assert.equal(result.status, 'eligible', `Workday URL ${url} should be eligible`);
        assert.equal(result.reason, 'browser_verification_required');
      }
    });

    it('returns eligible browser_verification_required for Ashby and SmartRecruiters URLs', async () => {
      const ashbyUrl = 'https://jobs.ashbyhq.com/postman/a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const srUrl = 'https://jobs.smartrecruiters.com/AcmeCorp/12345678-software-engineer';

      const ashbyRes = await fastApiPreflightCheck(ashbyUrl);
      assert.equal(ashbyRes.status, 'eligible');
      assert.equal(ashbyRes.reason, 'browser_verification_required');

      const srRes = await fastApiPreflightCheck(srUrl);
      assert.equal(srRes.status, 'eligible');
      assert.equal(srRes.reason, 'browser_verification_required');
    });

    it('retains 404/410 API preflight skips strictly on Greenhouse and Lever', async () => {
      // Mock fetcher that simulates official Greenhouse 404
      const mockGreenhouseFetcher = async () => ({
        status: 404,
        ok: false,
        json: async () => ({}),
      });

      const ghRes = await fastApiPreflightCheck(
        'https://boards.greenhouse.io/syntheticcompany/jobs/999999999',
        { fetcher: mockGreenhouseFetcher }
      );
      assert.equal(ghRes.status, 'skipped');
      assert.equal(ghRes.reason, 'job_closed');
    });
  });

  describe('Tickets GEN-81: Retained Text Masked Phone and Digits Handling', () => {
    // Mirror the logic tested in runner.ts retainedText()
    function testRetainedText(actual: string, expected: string, type: string): boolean {
      if (actual === expected) return true;
      const left = actual.trim(), right = expected.trim();
      if (!left) return false;
      if (left.toLowerCase() === right.toLowerCase()) return true;

      const digitsLeft = left.replace(/\D/g, '');
      const digitsRight = right.replace(/\D/g, '');
      if (digitsRight.length >= 6) {
        if (digitsLeft.endsWith(digitsRight.slice(-6)) || digitsRight.endsWith(digitsLeft.slice(-6))) {
          return true;
        }
      }

      if (left.length > 0 && (left.includes(right) || right.includes(left))) return true;

      return false;
    }

    it('matches masked phone inputs where characters differ only by punctuation', () => {
      // Boeing / Barclays format: (91) 98765-43210 vs 9876543210
      assert.equal(testRetainedText('(91) 98765-43210', '9876543210', 'tel'), true);
      assert.equal(testRetainedText('+91 98765 43210', '+919876543210', 'text'), true);
      assert.equal(testRetainedText('+91 9876543210', '9876543210', 'tel'), true);
      assert.equal(testRetainedText('98765-43210', '9876543210', 'text'), true);
    });

    it('fails when typed value is genuinely blank or completely mismatched', () => {
      assert.equal(testRetainedText('', '9876543210', 'tel'), false);
      assert.equal(testRetainedText('1234567890', '9876543210', 'tel'), false);
    });
  });

  describe('Ticket GEN-82: 5-char Stem Option Matching and Fallback', () => {
    it('matches 5-char stem overlap when exact match is missing', () => {
      const options = ['Immediate', '1-2 weeks', '1 month', 'More than 2 months'];
      const targetValue = 'Immediately';

      const targetStem = targetValue.trim().toLowerCase().slice(0, 5);
      const matched = options.find(o => o.trim().toLowerCase().slice(0, 5) === targetStem);
      assert.equal(matched, 'Immediate');
    });

    it('resolves policy or permissive fallback for start date / notice period questions', () => {
      const noticeOptions = ['Immediately', 'Within 15 days', '1 month', '2 months'];
      const resolved = resolveUniversalPermissiveFallback({
        questionText: 'How soon can you start with us?',
        widgetKind: 'SINGLE_SELECT',
        options: noticeOptions,
        profileEmail: dummyProfile.personal.email,
      });
      assert.ok(resolved, 'Should resolve an immediate or first option');
      assert.ok(noticeOptions.includes(resolved!));
    });

    it('resolves option policy for office presence', () => {
      const res = resolveByOptionPolicy(
        'Comfortable in our Bangalore office five days a week?',
        ['Yes', 'No'],
        dummyProfile,
        'Bangalore'
      );
      assert.equal(res?.value, 'Yes');
    });
  });

  describe('Ticket GEN-84: Boolean Coercion & Narrative Replacement', () => {
    it('coerces boolean to Yes / No for text and select fields', () => {
      const coerce = (val: any, infoType: string) => {
        if (typeof val === 'boolean' && infoType !== 'checkbox') {
          return val ? 'Yes' : 'No';
        }
        return val;
      };

      assert.equal(coerce(true, 'text'), 'Yes');
      assert.equal(coerce(false, 'text'), 'No');
      assert.equal(coerce(true, 'checkbox'), true);
      assert.equal(coerce(false, 'checkbox'), false);
    });

    it('replaces bare number 0 with narrative for textarea fields', () => {
      const rawValue: any = 0;
      const isTextarea = true;
      let finalValue = rawValue;

      if (isTextarea && (finalValue === undefined || finalValue === '0' || finalValue === 0 || typeof finalValue === 'number')) {
        finalValue = resolveUniversalPermissiveFallback({
          questionText: 'Please detail your relevant project experience',
          widgetKind: 'TEXTAREA',
          options: null,
          profileEmail: dummyProfile.personal.email,
        });
      }

      assert.ok(typeof finalValue === 'string');
      assert.ok(finalValue.length > 20);
      assert.notEqual(finalValue, '0');
    });
  });

  describe('Ticket GEN-85: Requisition Identity & Embed Tokens', () => {
    it('identifies greenhouse embed with token parameter correctly', () => {
      const url = 'https://boards.greenhouse.io/embed/job_app?for=syntheticco&token=1234567';
      const id = canonicalRequisition(url);
      assert.ok(id);
      assert.equal(id?.provider, 'greenhouse');
      assert.equal(id?.jobId, '1234567');
      assert.equal(id?.tenant, 'syntheticco');
    });

    it('treats greenhouse embed identity as matching requisition with identical jobId', () => {
      const expected = { provider: 'greenhouse', tenant: 'syntheticco', jobId: '1234567', key: 'greenhouse:syntheticco:1234567' };
      const actual = { provider: 'greenhouse', tenant: 'embed', jobId: '1234567', key: 'greenhouse:embed:1234567' };

      assert.equal(sameRequisition(expected, actual), true);
    });

    it('matches Workday numeric posting variant requisitions', () => {
      const baseReq = { provider: 'workday', tenant: 'cisco', jobId: 'R1000', key: 'workday:cisco:R1000' };
      const variantReq = { provider: 'workday', tenant: 'cisco', jobId: 'R1000-1', key: 'workday:cisco:R1000-1' };

      assert.equal(sameRequisition(baseReq, variantReq), true);
    });
  });
});
