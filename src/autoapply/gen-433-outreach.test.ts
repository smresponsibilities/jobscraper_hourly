import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  verifyDomainMxRecords,
  isPoisonPrefixEmail,
  POISON_PREFIXES,
} from '../outreach/free-contact-discovery.js';
import {
  canSendOutreachToTarget,
  canSendOutreachToDomain,
  matchCandidateProjectToCompanyStack,
  saveAppliedOutreachTarget,
  type OutreachLedgerState,
} from '../outreach/outreach-ledger.js';

test('GEN-433: verifyDomainMxRecords probes DNS MX records correctly', async () => {
  // Real domain with established MX infrastructure
  const isGoogleMx = await verifyDomainMxRecords('google.com');
  assert.equal(isGoogleMx, true, 'google.com must have valid MX records');

  // Synthetic invalid domain must fail cleanly without throwing
  const isInvalidMx = await verifyDomainMxRecords('invalid-domain-xyz-123.com');
  assert.equal(isInvalidMx, false, 'invalid-domain-xyz-123.com must resolve to false');
});

test('GEN-433: isPoisonPrefixEmail enforces 24-prefix generic inbox shield', () => {
  assert.equal(POISON_PREFIXES.length >= 24, true, 'Must define at least 24 poison prefixes');

  const genericEmails = [
    'jobs@example.com',
    'careers@example.com',
    'hr@example.com',
    'info@example.com',
    'support@example.com',
    'legal@example.com',
    'privacy@example.com',
    'noreply@example.com',
    'hello@example.com',
    'admin@example.com',
  ];

  for (const email of genericEmails) {
    assert.equal(isPoisonPrefixEmail(email), true, `Expected ${email} to be flagged as poison prefix`);
  }

  // Authentic human emails must pass
  assert.equal(isPoisonPrefixEmail('alex.rivas@example.com'), false);
  assert.equal(isPoisonPrefixEmail('cto@example.com'), false);
  assert.equal(isPoisonPrefixEmail('shivam.mahajan@example.com'), false);
});

test('GEN-433: 30-day domain cooldown suppresses duplicate employer outreach', () => {
  const now = Date.now();
  const ledgerRecent: OutreachLedgerState = {
    records: [
      {
        email: 'engineering-lead@acme.com',
        company: 'Acme Corp',
        roleTitle: 'Engineering Lead',
        sentAt: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
      },
    ],
  };

  // Attempt to contact another person at Acme Corp
  const checkRecent = canSendOutreachToTarget('vp-eng@acme.com', 'Acme Corp', ledgerRecent);
  assert.equal(checkRecent.allowed, false, 'Company contacted 5 days ago must be blocked');

  const checkDomain = canSendOutreachToDomain('acme.com', ledgerRecent);
  assert.equal(checkDomain.allowed, false, 'Domain contacted 5 days ago must be blocked');

  // Record from 35 days ago (past 30-day window)
  const ledgerOld: OutreachLedgerState = {
    records: [
      {
        email: 'engineering-lead@acme.com',
        company: 'Acme Corp',
        roleTitle: 'Engineering Lead',
        sentAt: new Date(now - 35 * 24 * 60 * 60 * 1000).toISOString(), // 35 days ago
      },
    ],
  };

  const checkOld = canSendOutreachToTarget('vp-eng@acme.com', 'Acme Corp', ledgerOld);
  assert.equal(checkOld.allowed, true, 'Company contacted 35 days ago must be eligible again');
});

test('GEN-433: matchCandidateProjectToCompanyStack pairs technical projects with employer stack', () => {
  // ClickHouse / Kafka stack
  const resData = matchCandidateProjectToCompanyStack('High throughput ClickHouse OLAP cluster with Kafka streaming');
  assert.equal(resData.projectTitle, 'ClickHouse Data Ingestion Pipeline (5M+ rows)');

  // Real-time / WebSockets / React
  const resRealtime = matchCandidateProjectToCompanyStack('Building real-time collaborative workspace with WebSockets and React');
  assert.equal(resRealtime.projectTitle, 'QuizDeck Real-Time Learning Platform (500 players, 31ms)');

  // ML / Python / XGBoost
  const resML = matchCandidateProjectToCompanyStack('Predictive analytics service using Python and XGBoost models');
  assert.equal(resML.projectTitle, 'Fertilizer Recommendation Microservice (XGBoost)');
});

test('GEN-433: saveAppliedOutreachTarget stores verified leads to JSON ledger', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen433-test-'));
  const targetPath = path.join(tmpDir, 'applied-outreach-targets.json');

  try {
    saveAppliedOutreachTarget(
      {
        company: 'Stripe',
        domain: 'stripe.com',
        targetRole: 'Software Engineer',
        contactEmail: 'engineering-lead@stripe.com',
        matchedProject: 'ClickHouse Data Ingestion Pipeline (5M+ rows)',
        mxVerified: true,
        discoveredAt: new Date().toISOString(),
      },
      targetPath
    );

    assert.ok(fs.existsSync(targetPath), 'Target ledger file must exist');
    const stored = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].company, 'Stripe');
    assert.equal(stored[0].mxVerified, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
