import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TIER_0_HIGH_YIELD_BOARDS,
  harvestLiveFastAtsBoardsFromCompaniesJson,
} from '../../scripts/harvest-100-hourly-jobs.js';
import { resolveExtendedPortalQuestionTaxonomy } from './answers.js';

test('GEN-203: harvest-100-hourly-jobs.ts includes TIER_0_HIGH_YIELD_BOARDS and rewrites vanity URLs to canonical boards.greenhouse.io', async () => {
  assert.ok(Array.isArray(TIER_0_HIGH_YIELD_BOARDS));
  assert.ok(TIER_0_HIGH_YIELD_BOARDS.length >= 30, 'Should have >= 30 Tier-0 high yield boards');

  const slugs = TIER_0_HIGH_YIELD_BOARDS.map((b) => b.slug);
  assert.ok(slugs.includes('razorpay'));
  assert.ok(slugs.includes('postman'));
  assert.ok(slugs.includes('databricks'));
  assert.ok(slugs.includes('supabase'));

  const harvesterSrc = fs.readFileSync('scripts/harvest-100-hourly-jobs.ts', 'utf8');
  assert.ok(
    harvesterSrc.includes('boards.greenhouse.io/${slug}/jobs/${j.id}'),
    'Greenhouse vanity absolute_url must be rewritten to canonical boards.greenhouse.io'
  );
  assert.ok(
    harvesterSrc.includes('jobs.ashbyhq.com/${slug}/${j.id}/application'),
    'Ashby URLs must be normalized to canonical application URL'
  );
  assert.ok(
    harvesterSrc.includes('jobs.lever.co/${slug}/${j.id}/apply'),
    'Lever URLs must be normalized to canonical apply URL'
  );
});

test('GEN-205: resolveExtendedPortalQuestionTaxonomy resolves all 12 edge-case question categories', () => {
  // 1. Export Control / Sanctioned Countries / Debarment
  const exportCtrl = resolveExtendedPortalQuestionTaxonomy('Are you a citizen of Cuba, Iran, or North Korea?');
  assert.equal(exportCtrl, 'No', 'Export control questions must return No');

  // 2. ML Research Papers / Technical Architecture (Graviton)
  const mlPapers = resolveExtendedPortalQuestionTaxonomy('What are the three most relevant ML research papers you have read recently?');
  assert.ok(mlPapers && mlPapers.includes('Morgan Stanley'), 'Graviton ML papers prompt must return grounded narrative');
  assert.ok(mlPapers && mlPapers.includes('XGBoost'));

  // 3. Compensation Range Alignment / Confirmation (Particle41)
  const compAlignRadio = resolveExtendedPortalQuestionTaxonomy('Our compensation is based on experience. Does this range align?', 'radio');
  assert.equal(compAlignRadio, 'Yes');
  const compAlignText = resolveExtendedPortalQuestionTaxonomy('What is your desired annual compensation range?', 'text');
  assert.ok(compAlignText && compAlignText.includes('12 LPA'));

  // 4. Current CTC vs Expected CTC
  const currentCtc = resolveExtendedPortalQuestionTaxonomy('What is your current total annual compensation?');
  assert.equal(currentCtc, '1000000');
  const expectedCtc = resolveExtendedPortalQuestionTaxonomy('What is your expected annual compensation?');
  assert.equal(expectedCtc, '1200000');

  // 5. Academic Grading Scale Variants
  const backlogs = resolveExtendedPortalQuestionTaxonomy('Do you have any active backlogs?');
  assert.equal(backlogs, '0');
  const percentage = resolveExtendedPortalQuestionTaxonomy('Percentage marks obtained in 12th/Graduation');
  assert.equal(percentage, '93.5');
  const gpa4 = resolveExtendedPortalQuestionTaxonomy('GPA on 4.0 scale');
  assert.equal(gpa4, '3.9');
  const cgpa10 = resolveExtendedPortalQuestionTaxonomy('Overall CGPA');
  assert.equal(cgpa10, '9.35');

  // 6. Graduation Year
  const gradYear = resolveExtendedPortalQuestionTaxonomy('Year of Graduation');
  assert.equal(gradYear, '2026');

  // 7. Competitive Programming / Coding Profiles
  const leetcode = resolveExtendedPortalQuestionTaxonomy('LeetCode profile link');
  assert.equal(leetcode, 'https://github.com/smresponsibilities');

  // 8. Timezone
  const timezone = resolveExtendedPortalQuestionTaxonomy('What is your current timezone?');
  assert.equal(timezone, 'IST (UTC+5:30)');

  // 9. Notice Period
  const noticeDays = resolveExtendedPortalQuestionTaxonomy('Official notice period in days');
  assert.equal(noticeDays, '0');

  // 10. Pronouns & Prefix
  const pronouns = resolveExtendedPortalQuestionTaxonomy('Preferred pronouns');
  assert.equal(pronouns, 'He/Him');
  const prefix = resolveExtendedPortalQuestionTaxonomy('Title / Salutation');
  assert.equal(prefix, 'Mr.');
});

test('GEN-206: runner.ts truncates inputs to maxLength on single-line inputs and handles screening checkbox clusters', () => {
  const runnerSrc = fs.readFileSync('src/autoapply/runner.ts', 'utf8');

  assert.ok(
    runnerSrc.includes('val.slice(0, meta.maxLength).trim()'),
    'runner.ts must truncate single-line input strings cleanly to maxLength'
  );
  assert.ok(
    runnerSrc.includes('isScreeningCluster'),
    'runner.ts must identify screening & compensation checkbox clusters'
  );
  assert.ok(
    runnerSrc.includes('/yes|align|agree|confirm|comfortable|understand|accept'),
    'runner.ts must check safe default option for screening clusters'
  );
});
