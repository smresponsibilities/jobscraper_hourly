import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCandidateSlugs, extractAtsLinksFromHtml } from '../discovery/ats-board-resolver.js';
import {
  inferEmailPatternFromSamples,
  generatePermutedEmail,
} from '../outreach/free-contact-discovery.js';
import {
  canSendOutreachToTarget,
  pickRoleTailoredProjectsSummary,
  type OutreachLedgerState,
} from '../outreach/outreach-ledger.js';

test('GEN-177: generateCandidateSlugs generates permutations and extractAtsLinksFromHtml parses boards', () => {
  const slugs = generateCandidateSlugs('Sarvam AI', 'sarvam.ai');
  assert.ok(slugs.includes('sarvam'), 'Slugs must include base name');
  assert.ok(slugs.includes('sarvamai'), 'Slugs must include base + ai');
  assert.ok(slugs.includes('sarvamhq'), 'Slugs must include base + hq');

  const html = `
    <html>
      <body>
        <a href="https://boards.greenhouse.io/sarvam">Greenhouse</a>
        <a href="https://jobs.ashbyhq.com/hevo">Ashby</a>
        <a href="https://jobs.lever.co/emergent">Lever</a>
        <a href="https://jobs.smartrecruiters.com/square">SmartRecruiters</a>
        <a href="https://adobe.wd5.myworkdayjobs.com/external">Workday</a>
      </body>
    </html>
  `;
  const boards = extractAtsLinksFromHtml(html);
  assert.ok(boards.some((b) => b.ats === 'greenhouse' && b.boardSlug === 'sarvam'));
  assert.ok(boards.some((b) => b.ats === 'ashby' && b.boardSlug === 'hevo'));
  assert.ok(boards.some((b) => b.ats === 'lever' && b.boardSlug === 'emergent'));
  assert.ok(boards.some((b) => b.ats === 'smartrecruiters' && b.boardSlug === 'square'));
  assert.ok(boards.some((b) => b.ats === 'workday' && b.boardSlug === 'adobe:external'));
});

test('GEN-178: inferEmailPatternFromSamples and generatePermutedEmail deduce patterns safely', () => {
  const p1 = inferEmailPatternFromSamples([
    { name: 'John Doe', email: 'john.doe@company.com' },
  ]);
  assert.equal(p1, 'first.last');

  const p2 = inferEmailPatternFromSamples([
    { name: 'Alice Smith', email: 'alice@company.com' },
  ]);
  assert.equal(p2, 'first');

  const p3 = inferEmailPatternFromSamples([
    { name: 'Bob Wilson', email: 'bwilson@company.com' },
  ]);
  assert.equal(p3, 'flast');

  const email1 = generatePermutedEmail('Shivam Mahajan', 'techcorp.io', 'first.last');
  assert.equal(email1, 'shivam.mahajan@techcorp.io');

  const email2 = generatePermutedEmail('Shivam Mahajan', 'techcorp.io', 'first');
  assert.equal(email2, 'shivam@techcorp.io');

  const email3 = generatePermutedEmail('Shivam Mahajan', 'techcorp.io', 'flast');
  assert.equal(email3, 'smahajan@techcorp.io');

  // Verify poison prefix generation returns null
  const bad1 = generatePermutedEmail('Security Team', 'techcorp.io', 'first');
  assert.equal(bad1, null, 'Must reject security@ prefix');

  const bad2 = generatePermutedEmail('Privacy Officer', 'techcorp.io', 'first');
  assert.equal(bad2, null, 'Must reject privacy@ prefix');
});

test('GEN-179: canSendOutreachToTarget enforces 30-day cooldown and daily cap', () => {
  const now = Date.now();
  const mockLedger: OutreachLedgerState = {
    records: [
      {
        email: 'recruiter@techcorp.io',
        company: 'TechCorp',
        roleTitle: 'Software Engineer',
        sentAt: new Date(now - 10 * 24 * 3600 * 1000).toISOString(), // 10 days ago
      },
    ],
  };

  // Same recipient within 30d should be blocked
  const resEmail = canSendOutreachToTarget('recruiter@techcorp.io', 'OtherCorp', mockLedger);
  assert.equal(resEmail.allowed, false);
  assert.equal(resEmail.reason, 'recipient_contacted_within_30d');

  // Same company within 30d should be blocked
  const resComp = canSendOutreachToTarget('other@techcorp.io', 'TechCorp', mockLedger);
  assert.equal(resComp.allowed, false);
  assert.equal(resComp.reason, 'company_contacted_within_30d');

  // Different company & recipient allowed
  const resOk = canSendOutreachToTarget('lead@newcorp.io', 'NewCorp', mockLedger);
  assert.equal(resOk.allowed, true);

  // Daily cap enforcement
  const cappedLedger: OutreachLedgerState = {
    records: Array.from({ length: 40 }, (_, i) => ({
      email: `user${i}@randomcorp.io`,
      company: `RandomCorp${i}`,
      roleTitle: 'Software Engineer',
      sentAt: new Date(now - 1000 * 60).toISOString(),
    })),
  };
  const resCapped = canSendOutreachToTarget('new@freshcorp.io', 'FreshCorp', cappedLedger, 40);
  assert.equal(resCapped.allowed, false);
  assert.equal(resCapped.reason, 'daily_cap_reached_40');
});

test('GEN-179: pickRoleTailoredProjectsSummary selects tailored portfolio highlights', () => {
  const aiSummary = pickRoleTailoredProjectsSummary('Machine Learning Engineer - NLP');
  assert.ok(aiSummary.includes('Chaincode'), 'AI/ML roles must feature Chaincode');
  assert.ok(aiSummary.includes('Fertilizer Recommendation ML Microservice'), 'AI/ML roles must feature Fertilizer ML');

  const dataSummary = pickRoleTailoredProjectsSummary('Senior Data Engineer - Analytics');
  assert.ok(dataSummary.includes('ClickHouse Data Ingestion Tool'), 'Data roles must feature ClickHouse tool');
  assert.ok(dataSummary.includes('Shopify Insights'), 'Data roles must feature Shopify Insights');

  const mobileSummary = pickRoleTailoredProjectsSummary('Android Developer (Kotlin)');
  assert.ok(mobileSummary.includes('Productivity Caller'), 'Mobile roles must feature Productivity Caller');
});
