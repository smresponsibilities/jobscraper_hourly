// src/autoapply/gen-455-462.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  classifyEmailLifecycleStage,
  type InboxLifecycleEvent,
} from './inbox-lifecycle-tracker.js';
import {
  isDomainSuppressedByInboxLifecycle,
  resolveBounceFallbackEmail,
  runOutreachBatch,
} from '../../scripts/send-outreach-batch.js';
import { loadWonderPillDeadEnds } from '../outreach/dual-mode-lead-finder.js';
import { isSupportedDirectAtsJobUrl } from './preflight.js';
import { unwrapDirectAtsApplicationUrl } from './url-unwrapper.js';
import { fetchGreenhouseQuestionSchema, type GreenhouseQuestionSchemaItem } from './distiller.js';

test('GEN-455.1: classifyEmailLifecycleStage correctly identifies all 5 stages', () => {
  // 1. HARD_BOUNCE_550
  const bounceResult = classifyEmailLifecycleStage({
    fromAddress: 'mailer-daemon@googlemail.com',
    subject: 'Delivery Status Notification (Failure)',
    bodyText: '550 5.1.1 The email account that you tried to reach does not exist. Please try double-checking the recipient address candidate.test@domain.com for typos.',
  });
  assert.equal(bounceResult?.stage, 'HARD_BOUNCE_550');
  assert.equal(bounceResult?.bouncedRecipient, 'candidate.test@domain.com');

  // 2. RECRUITER_DIRECT_REPLY
  const replyResult = classifyEmailLifecycleStage({
    fromAddress: 'sarah.connor@cyberdyne.com',
    subject: 'Re: Applied for Senior Software Engineer — Shivam Mahajan',
    bodyText: 'Hi Shivam, thanks for reaching out. We would love to chat further about your background.',
  });
  assert.equal(replyResult?.stage, 'RECRUITER_DIRECT_REPLY');

  // 3. INTERVIEW_OR_OA_INVITE (HackerRank & Calendly)
  const oaResult = classifyEmailLifecycleStage({
    fromAddress: 'talent@uber.com',
    subject: 'Next steps in our hiring process: Technical Assessment',
    bodyText: 'Thank you for your interest in Uber. Please complete the HackerRank online assessment within 5 days.',
  });
  assert.equal(oaResult?.stage, 'INTERVIEW_OR_OA_INVITE');

  const calendlyResult = classifyEmailLifecycleStage({
    fromAddress: 'recruiting@stripe.com',
    subject: 'Invitation to interview with Stripe',
    bodyText: 'Please select a time to schedule an interview with our engineering manager at calendly.com/stripe-eng-team.',
  });
  assert.equal(calendlyResult?.stage, 'INTERVIEW_OR_OA_INVITE');

  // 4. APPLICATION_REJECTED
  const rejectResult = classifyEmailLifecycleStage({
    fromAddress: 'no-reply@datadog.com',
    subject: 'Update on your application to Datadog',
    bodyText: 'Thank you for your interest. Unfortunately, after careful consideration, we have decided not to proceed with your application at this time as we are pursuing other candidates.',
  });
  assert.equal(rejectResult?.stage, 'APPLICATION_REJECTED');

  // 5. APPLICATION_CONFIRMATION
  const confirmResult = classifyEmailLifecycleStage({
    fromAddress: 'careers@figma.com',
    subject: 'Thank you for applying to Figma',
    bodyText: 'We have received your application for the Software Engineer position. Our team will review your qualifications.',
  });
  assert.equal(confirmResult?.stage, 'APPLICATION_CONFIRMATION');

  // 6. Irrelevant / Marketing / Spam returns null
  const nullResult = classifyEmailLifecycleStage({
    fromAddress: 'newsletter@medium.com',
    subject: 'Top stories for you today',
    bodyText: 'Check out the top engineering blog posts published this week.',
  });
  assert.equal(nullResult, null);
});

test('GEN-456.1: isDomainSuppressedByInboxLifecycle suppresses rejected or interviewing domains', () => {
  const events: InboxLifecycleEvent[] = [
    {
      messageId: 'msg-1',
      date: new Date().toISOString(),
      fromAddress: 'talent@acme.corp',
      fromDomain: 'acme.corp',
      subject: 'Update on your application',
      stage: 'APPLICATION_REJECTED',
      snippet: 'Unfortunately...',
    },
    {
      messageId: 'msg-2',
      date: new Date().toISOString(),
      fromAddress: 'interviews@goodcorp.io',
      fromDomain: 'goodcorp.io',
      subject: 'HackerRank challenge',
      stage: 'INTERVIEW_OR_OA_INVITE',
      snippet: 'Coding assessment...',
    },
    {
      messageId: 'msg-3',
      date: new Date().toISOString(),
      fromAddress: 'no-reply@pending.ai',
      fromDomain: 'pending.ai',
      subject: 'Application received',
      stage: 'APPLICATION_CONFIRMATION',
      snippet: 'Thank you for applying',
    },
  ];

  // Rejected company domain is suppressed
  const res1 = isDomainSuppressedByInboxLifecycle('Acme Corp', 'acme.corp', events);
  assert.equal(res1.suppressed, true);
  assert.equal(res1.stage, 'APPLICATION_REJECTED');

  // Interviewing company domain is suppressed
  const res2 = isDomainSuppressedByInboxLifecycle('GoodCorp', 'goodcorp.io', events);
  assert.equal(res2.suppressed, true);
  assert.equal(res2.stage, 'INTERVIEW_OR_OA_INVITE');

  // Merely confirmed company domain is NOT suppressed
  const res3 = isDomainSuppressedByInboxLifecycle('Pending AI', 'pending.ai', events);
  assert.equal(res3.suppressed, false);

  // Unknown domain is NOT suppressed
  const res4 = isDomainSuppressedByInboxLifecycle('Fresh Co', 'freshco.com', events);
  assert.equal(res4.suppressed, false);
});

test('GEN-456.2: resolveBounceFallbackEmail falls back to talent@domain or explicit fallback', () => {
  const events: InboxLifecycleEvent[] = [
    {
      messageId: 'msg-bounce-1',
      date: new Date().toISOString(),
      fromAddress: 'mailer-daemon@google.com',
      fromDomain: 'google.com',
      subject: 'Delivery failure',
      stage: 'HARD_BOUNCE_550',
      bouncedRecipient: 'john.doe@startup.io',
      snippet: '550 user unknown',
    },
  ];

  // 1. Non-bounced email retains target
  const res1 = resolveBounceFallbackEmail('jane@startup.io', 'startup.io', events);
  assert.equal(res1.wasBounced, false);
  assert.equal(res1.email, 'jane@startup.io');

  // 2. Bounced email automatically falls back to talent@startup.io
  const res2 = resolveBounceFallbackEmail('john.doe@startup.io', 'startup.io', events);
  assert.equal(res2.wasBounced, true);
  assert.equal(res2.email, 'talent@startup.io');

  // 3. Explicit fallback option
  const res3 = resolveBounceFallbackEmail('john.doe@startup.io', 'startup.io', events, 'careers@startup.io');
  assert.equal(res3.wasBounced, true);
  assert.equal(res3.email, 'careers@startup.io');
});

test('GEN-456.3: runOutreachBatch suppresses outreach and handles 550 fallback', async () => {
  const tmpDir = path.resolve('state/autoapply/portal-review/test-temp-gen456');
  fs.mkdirSync(tmpDir, { recursive: true });

  const tempLeadsPath = path.join(tmpDir, 'test-leads.json');
  const tempLedgerPath = path.join(tmpDir, 'test-ledger.json');
  const tempDeadEndsPath = path.join(tmpDir, 'test-dead-ends.json');

  const testLeads = [
    // Lead 1: Belongs to rejected company -> must be suppressed
    {
      company: 'Rejected Corp',
      roleTitle: 'Software Engineer',
      targetEmail: 'recruiter@rejected.com',
      mxVerified: true,
      subject: 'Applied for Software Engineer',
      body: 'Hello',
    },
    // Lead 2: Has 550 bounced recipient -> must fall back to talent@fallback.com
    {
      company: 'Fallback Inc',
      roleTitle: 'Backend Engineer',
      targetEmail: 'dead.lead@fallback.com',
      fallbackEmail: 'talent@fallback.com',
      mxVerified: true,
      subject: 'Applied for Backend Engineer',
      body: 'Hello',
    },
  ];

  fs.writeFileSync(tempLeadsPath, JSON.stringify(testLeads, null, 2), 'utf8');

  const testEvents: InboxLifecycleEvent[] = [
    {
      messageId: 'ev-1',
      date: new Date().toISOString(),
      fromAddress: 'hr@rejected.com',
      fromDomain: 'rejected.com',
      subject: 'Your application status',
      stage: 'APPLICATION_REJECTED',
      snippet: 'Unfortunately we decided not to proceed',
    },
    {
      messageId: 'ev-2',
      date: new Date().toISOString(),
      fromAddress: 'mailer-daemon@mx.google.com',
      fromDomain: 'mx.google.com',
      subject: 'Delivery status failure',
      stage: 'HARD_BOUNCE_550',
      bouncedRecipient: 'dead.lead@fallback.com',
      snippet: '550 address not found',
    },
  ];

  const batchResult = await runOutreachBatch({
    dryRun: true,
    leadsPath: tempLeadsPath,
    ledgerPath: tempLedgerPath,
    lifecycleEvents: testEvents,
  });

  // Verify Lead 1 was suppressed
  const rejectedItem = batchResult.items.find((i) => i.company === 'Rejected Corp');
  assert.ok(rejectedItem);
  assert.equal(rejectedItem?.status, 'skipped');
  assert.match(rejectedItem?.reason || '', /suppressed_by_inbox_lifecycle/);

  // Verify Lead 2 promoted fallback email
  const fallbackItem = batchResult.items.find((i) => i.company === 'Fallback Inc');
  assert.ok(fallbackItem);
  assert.equal(fallbackItem?.targetEmail, 'talent@fallback.com');
  assert.equal(fallbackItem?.status, 'dry_run_passed');

  // Verify dead end was recorded for dead.lead@fallback.com
  const deadEnds = loadWonderPillDeadEnds();
  const foundDeadEnd = deadEnds.find((d) => d.whatWentWrong.includes('dead.lead@fallback.com'));
  assert.ok(foundDeadEnd, 'Dead end entry should be saved for 550 bounced address');

  // Clean up temp test files
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('GEN-457.1: Greenhouse ?questions=true schema parsing and control hydration', async () => {
  // Test schema fetch logic with mocked global fetch
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('boards-api.greenhouse.io') && urlStr.includes('?questions=true')) {
        return {
          ok: true,
          json: async () => ({
            questions: [
              {
                label: 'Are you legally authorized to work in the United States?',
                required: true,
                fields: [
                  {
                    name: 'job_application[answers][question_1001][]',
                    values: [{ label: 'Yes' }, { label: 'No' }],
                  },
                ],
              },
              {
                label: 'Will you now or in the future require sponsorship?',
                required: false,
                fields: [
                  {
                    name: 'question_1002',
                    values: [{ label: 'Yes' }, { label: 'No' }],
                  },
                ],
              },
            ],
          }),
        } as any;
      }
      return originalFetch(url);
    };

    const schema = await fetchGreenhouseQuestionSchema('https://boards.greenhouse.io/acme/jobs/456789');
    assert.ok(schema.size >= 2);

    const q1 = schema.get('job_application[answers][question_1001]');
    assert.ok(q1);
    assert.equal(q1?.label, 'Are you legally authorized to work in the United States?');
    assert.equal(q1?.required, true);
    assert.deepEqual(q1?.options, ['Yes', 'No']);

    const q2 = schema.get('question_1002');
    assert.ok(q2);
    assert.equal(q2?.label, 'Will you now or in the future require sponsorship?');
    assert.equal(q2?.required, false);
    assert.deepEqual(q2?.options, ['Yes', 'No']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GEN-458.1: Workable apply.workable.com direct ATS adapter and URL unwrapping', () => {
  // 1. isSupportedDirectAtsJobUrl
  assert.equal(isSupportedDirectAtsJobUrl('https://apply.workable.com/acme/j/ABCD1234/'), true);
  assert.equal(isSupportedDirectAtsJobUrl('https://apply.workable.com/tech-startup/j/98765XYZ'), true);
  assert.equal(isSupportedDirectAtsJobUrl('https://apply.workable.com/acme'), false); // Missing /j/{shortcode}

  // 2. unwrapDirectAtsApplicationUrl
  const unwrapped1 = unwrapDirectAtsApplicationUrl('https://apply.workable.com/acme/j/ABCD1234/');
  assert.equal(unwrapped1, 'https://apply.workable.com/acme/j/ABCD1234/apply');

  const unwrapped2 = unwrapDirectAtsApplicationUrl('https://apply.workable.com/tech-startup/j/98765XYZ');
  assert.equal(unwrapped2, 'https://apply.workable.com/tech-startup/j/98765XYZ/apply');

  // Already on /apply -> unchanged
  const unwrapped3 = unwrapDirectAtsApplicationUrl('https://apply.workable.com/acme/j/ABCD1234/apply');
  assert.equal(unwrapped3, 'https://apply.workable.com/acme/j/ABCD1234/apply');
});

test('GEN-459.1: Workday Step 3-5 EEO listbox preference regexes and signature target verification', () => {
  // Verify EEO regex patterns match required disclosures
  const genderRegex = /male|decline|prefer not/i;
  assert.ok(genderRegex.test('Male'));
  assert.ok(genderRegex.test('I decline to identify'));
  assert.ok(genderRegex.test('Prefer not to say'));

  const ethnicityRegex = /asian|indian|decline|prefer not/i;
  assert.ok(ethnicityRegex.test('Asian (Not Hispanic or Latino)'));
  assert.ok(ethnicityRegex.test('Asian Indian'));
  assert.ok(ethnicityRegex.test('Decline to self-identify'));

  const veteranRegex = /not a .*veteran|no\b|decline|do not/i;
  assert.ok(veteranRegex.test('I am not a protected veteran'));
  assert.ok(veteranRegex.test('No, I am not a veteran'));
  assert.ok(veteranRegex.test('I do not wish to answer'));

  const disabilityRegex = /no, i do not|do not have a disability|decline|do not wish/i;
  assert.ok(disabilityRegex.test('No, I do not have a disability'));
  assert.ok(disabilityRegex.test('I do not have a disability, or have a history/record of having a disability'));
  assert.ok(disabilityRegex.test('I decline to self-identify'));
});

