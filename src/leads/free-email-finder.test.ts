import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  verifyDomainMx,
  resolveEmployerDomain,
  generateEmailPermutations,
  discoverGithubOrgEmailsAndPattern,
  findFreeCompanyLeads,
  generateColdOutreachDraft,
  recordOutreachLead,
  isHiringEmail,
  NON_HIRING_EMAILS_REGEX,
  type OutreachDraft,
} from './free-email-finder.js';

test('resolveEmployerDomain shields against ATS vendor domains and maps to employer domain', async () => {
  // Should reject Ashby ATS host and resolve real ClickHouse domain
  const clickhouseDomain = await resolveEmployerDomain('ClickHouse', 'https://jobs.ashbyhq.com/clickhouse/123');
  assert.equal(clickhouseDomain, 'clickhouse.com');

  // Should reject Greenhouse ATS host and resolve real GitLab domain
  const gitlabDomain = await resolveEmployerDomain('GitLab', 'https://boards.greenhouse.io/gitlab/jobs/123');
  assert.equal(gitlabDomain, 'gitlab.com');

  // Direct domain
  const direct = await resolveEmployerDomain('Acme', 'https://acme.org/jobs');
  assert.equal(direct, 'acme.org');
});

test('verifyDomainMx identifies active mail providers', async () => {
  // Real domain with Google Workspace / MX
  const google = await verifyDomainMx('google.com');
  assert.equal(google.valid, true);
  assert.ok(google.provider);

  // Non-existent domain
  const nonExistent = await verifyDomainMx('thisdomaindoesnotexist123456789.org');
  assert.equal(nonExistent.valid, false);
  assert.equal(nonExistent.provider, null);
});

test('generateEmailPermutations builds and ranks email candidates properly', () => {
  const perms = generateEmailPermutations('Shivam', 'Mahajan', 'example.com', 'first.last');
  assert.ok(perms.length >= 3);
  assert.equal(perms[0]!.email, 'shivam.mahajan@example.com');
  assert.equal(perms[0]!.confidence, 0.94);

  const firstPreferred = generateEmailPermutations('Satya', 'Nadella', 'microsoft.com', 'first');
  assert.equal(firstPreferred[0]!.email, 'satya@microsoft.com');

  const empty = generateEmailPermutations('', '', 'example.com');
  assert.deepEqual(empty, []);
});

test('discoverGithubOrgEmailsAndPattern parses commit author emails and detects pattern', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    if (String(url).includes('api.github.com')) {
      return {
        ok: true,
        json: async () => [
          {
            payload: {
              commits: [
                { author: { email: 'john.doe@techcorp.com', name: 'John Doe' } },
                { author: { email: 'jane.smith@techcorp.com', name: 'Jane Smith' } },
                { author: { email: 'noreply@github.com', name: 'GitHub' } },
              ],
            },
          },
        ],
      } as Response;
    }
    return originalFetch(url);
  }) as typeof fetch;

  try {
    const res = await discoverGithubOrgEmailsAndPattern('techcorp', 'techcorp.com');
    assert.equal(res.detectedPattern, 'first.last');
    assert.equal(res.observedEmails.length, 2);
    assert.ok(res.observedEmails.includes('john.doe@techcorp.com'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('findFreeCompanyLeads enriches leads with direct, permutation and fallback emails', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    if (String(url).includes('api.github.com')) {
      return {
        ok: true,
        json: async () => [],
      } as Response;
    }
    return originalFetch(url);
  }) as typeof fetch;

  try {
    const lead = await findFreeCompanyLeads({
      company: 'Google',
      domain: 'google.com',
      personName: 'Sundar Pichai',
      personTitle: 'CEO',
      directEmails: ['sundar@google.com'],
    });

    assert.equal(lead.company, 'Google');
    assert.equal(lead.domain, 'google.com');
    assert.ok(lead.emails.length > 0);
    assert.ok(lead.emails.some(e => e.email === 'sundar@google.com'));
    assert.ok(lead.emails.some(e => e.source === 'hn_direct'));
    assert.ok(lead.emails.some(e => e.source === 'permutation_mx_verified'));
    assert.ok(lead.emails.some(e => e.source === 'role_fallback'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('generateColdOutreachDraft generates grounded 4-sentence note', () => {
  const draft = generateColdOutreachDraft('Razorpay', 'Backend Software Engineer', {
    company: 'Razorpay',
    domain: 'razorpay.com',
    personName: 'Harshil Mathur',
    personTitle: 'Founder & CEO',
    emails: [{ email: 'harshil@razorpay.com', confidence: 0.95, source: 'permutation_mx_verified' }],
    mxProvider: 'google_workspace',
  });

  assert.equal(draft.company, 'Razorpay');
  assert.equal(draft.roleTitle, 'Backend Software Engineer');
  assert.equal(draft.targetEmail, 'harshil@razorpay.com');
  assert.match(draft.subject, /Applied for Backend Software Engineer — Shivam Mahajan/);
  assert.match(draft.body, /Morgan Stanley/);
  assert.match(draft.body, /Chitkara University/);
  assert.match(draft.body, /Java Spring Boot/);
  assert.match(draft.body, /0 days notice/);
  assert.match(draft.body, /9000000000/);
  assert.match(draft.body, /mahajanshivam/);
});

test('recordOutreachLead appends and updates outreach-leads file', () => {
  const testFile = path.resolve('out/test-temp/test-outreach-leads.json');
  if (fs.existsSync(testFile)) fs.unlinkSync(testFile);

  const sampleLead: OutreachDraft = {
    company: 'Postman',
    roleTitle: 'Software Engineer',
    targetEmail: 'recruiting@postman.com',
    recipientName: 'Abhinav Asthana',
    subject: 'Applied for Software Engineer — Shivam Mahajan',
    body: 'Test body',
    generatedAt: new Date().toISOString(),
    source: 'role_fallback',
  };

  recordOutreachLead(sampleLead, testFile);
  let content = JSON.parse(fs.readFileSync(testFile, 'utf8'));
  assert.equal(content.length, 1);
  assert.equal(content[0].company, 'Postman');

  // Updating the same company + roleTitle deduplicates
  sampleLead.targetEmail = 'abhinav@postman.com';
  recordOutreachLead(sampleLead, testFile);
  content = JSON.parse(fs.readFileSync(testFile, 'utf8'));
  assert.equal(content.length, 1);
  assert.equal(content[0].targetEmail, 'abhinav@postman.com');
});

test('NON_HIRING_EMAILS_REGEX strictly rejects non-hiring addresses', () => {
  const rejected = [
    'security@clickhouse.com',
    'abuse@domain.com',
    'privacy@company.org',
    'noreply@gitlab.com',
    'no-reply@uipath.com',
    'psirt@cisco.com',
    'legal@enterprise.com',
    'support@service.io',
    'sales@saas.com',
    'billing@corp.com',
    'press@media.net',
    'info@abacusinsights.com',
    'contact@headout.com',
    'admin@company.com',
    'partnerships@shift.com',
    'marketing@corp.com',
    'bizdev@enterprise.com',
  ];
  for (const email of rejected) {
    assert.equal(isHiringEmail(email), false, `Expected ${email} to be rejected`);
    assert.ok(NON_HIRING_EMAILS_REGEX.test(email), `Regex should match ${email}`);
  }

  const accepted = [
    'recruiting@clickhouse.com',
    'talent@gitlab.com',
    'careers@shift.com',
    'john.doe@company.com',
  ];
  for (const email of accepted) {
    assert.equal(isHiringEmail(email), true, `Expected ${email} to be accepted`);
  }
});

test('findFreeCompanyLeads rejects non-hiring emails and handles enterprise vs startup fallbacks', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    return {
      ok: true,
      text: async () => 'Contact us at security@clickhouse.com or careers@clickhouse.com. <input placeholder="john@shift.com" />',
      json: async () => [],
    } as Response;
  }) as typeof fetch;

  try {
    const enterpriseLead = await findFreeCompanyLeads({
      company: 'ClickHouse',
      domain: 'clickhouse.com',
      directEmails: ['security@clickhouse.com', 'abuse@clickhouse.com', 'privacy@clickhouse.com', 'noreply@clickhouse.com', 'info@clickhouse.com', 'contact@clickhouse.com'],
    });

    // Zero security@, abuse@, privacy@, noreply@, info@, contact@
    assert.ok(enterpriseLead.emails.every(e => !NON_HIRING_EMAILS_REGEX.test(e.email)));
    assert.equal(isHiringEmail('security@clickhouse.com'), false);
    assert.equal(isHiringEmail('abuse@clickhouse.com'), false);
    assert.equal(isHiringEmail('privacy@clickhouse.com'), false);
    assert.equal(isHiringEmail('noreply@clickhouse.com'), false);
    assert.equal(isHiringEmail('info@clickhouse.com'), false);
    assert.equal(isHiringEmail('contact@clickhouse.com'), false);

    // Verify generateColdOutreachDraft strictly avoids non-hiring emails
    const poisonedDraft = generateColdOutreachDraft('ClickHouse', 'Software Engineer', {
      company: 'ClickHouse',
      domain: 'clickhouse.com',
      emails: [{ email: 'security@clickhouse.com', confidence: 0.99, source: 'website_scrape' }],
      mxProvider: 'google_workspace',
    });
    assert.notEqual(poisonedDraft.targetEmail, 'security@clickhouse.com');
    assert.ok(
      poisonedDraft.targetEmail === 'talent@clickhouse.com' ||
      poisonedDraft.targetEmail === 'recruiting@clickhouse.com'
    );

    // Enterprise company should never have founders@ or hello@
    assert.ok(enterpriseLead.emails.every(e => !/^(?:founders|hello)@/i.test(e.email)));
    assert.ok(enterpriseLead.emails.some(e => e.email === 'talent@clickhouse.com' || e.email === 'recruiting@clickhouse.com' || e.email === 'careers@clickhouse.com'));

    // Shift (enterprise) should fall back to talent@shift.com, never placeholder john@shift.com
    const shiftLead = await findFreeCompanyLeads({
      company: 'Shift',
      domain: 'shift.com',
    });
    assert.ok(shiftLead.emails.every(e => e.email !== 'john@shift.com'));
    assert.ok(shiftLead.emails.some(e => e.email === 'talent@shift.com' || e.email === 'recruiting@shift.com' || e.email === 'careers@shift.com'));

    // Startup company allows founders@
    const startupLead = await findFreeCompanyLeads({
      company: 'Sarvam AI',
      domain: 'sarvam.ai',
      isStartup: true,
    });
    assert.ok(startupLead.emails.some(e => e.email === 'founders@sarvam.ai'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

