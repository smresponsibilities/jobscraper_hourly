import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { translateCanonicalAnswerToOption } from './widgets.js';
import { resolveExtendedPortalQuestionTaxonomy } from './answers.js';
import { lookupQuestionIn1000Bank } from './portal-question-bank-1000.js';
import { recordVerifiedAcceptedApplicationAnswers, lookupVerifiedAcceptedAnswer } from './self-learning.js';
import { unwrapDirectAtsApplicationUrl } from './url-unwrapper.js';

test('GEN-342 & GEN-343: ISO-3166-1 and ISO-3166-2:IN canonical option matching', () => {
  const countryOpts = ['United States', 'India', 'Canada', 'United Kingdom'];
  assert.equal(translateCanonicalAnswerToOption('India', 'Country', countryOpts), 'India');

  const countryCodes = ['USA', 'IND', 'GBR', 'CAN'];
  assert.equal(translateCanonicalAnswerToOption('India', 'Country Code', countryCodes), 'IND');

  const countryDial = ['India (+91)', 'United States (+1)', 'United Kingdom (+44)'];
  assert.equal(translateCanonicalAnswerToOption('India', 'Country of Residence', countryDial), 'India (+91)');

  const stateOpts = ['Maharashtra', 'Karnataka', 'Tamil Nadu', 'Delhi'];
  assert.equal(translateCanonicalAnswerToOption('Karnataka', 'State / Province', stateOpts), 'Karnataka');

  const stateCodes = ['MH', 'KA', 'TN', 'DL'];
  assert.equal(translateCanonicalAnswerToOption('Karnataka', 'State Code', stateCodes), 'KA');
});

test('GEN-323: Phone Country Code and Mobile Phone Number answer resolution', () => {
  assert.equal(resolveExtendedPortalQuestionTaxonomy('Phone Country Code'), '+91');
  assert.equal(resolveExtendedPortalQuestionTaxonomy('Country Dial Code'), '+91');
  assert.equal(resolveExtendedPortalQuestionTaxonomy('Mobile Phone Number'), '9876543210');
  assert.equal(resolveExtendedPortalQuestionTaxonomy('National Phone Number'), '9876543210');
});

test('GEN-324: Salary Currency and Expected CTC resolution in taxonomy & bank', () => {
  assert.equal(resolveExtendedPortalQuestionTaxonomy('Salary Currency'), 'INR');
  assert.equal(resolveExtendedPortalQuestionTaxonomy('Compensation Currency'), 'INR');
  assert.equal(resolveExtendedPortalQuestionTaxonomy('Currency'), 'INR');
  assert.equal(lookupQuestionIn1000Bank('Salary Currency'), 'INR');
  assert.equal(lookupQuestionIn1000Bank('Preferred Currency'), 'INR');
  assert.equal(resolveExtendedPortalQuestionTaxonomy('Expected CTC'), '1200000');
  assert.equal(lookupQuestionIn1000Bank('Expected CTC'), '1200000');
});

test('GEN-325: Split Date Component Fallbacks', () => {
  assert.equal(resolveExtendedPortalQuestionTaxonomy('Graduation Month (Education)'), '08');
  assert.equal(resolveExtendedPortalQuestionTaxonomy('Graduation Year (Education)'), '2026');
  assert.equal(resolveExtendedPortalQuestionTaxonomy('Start Month (Work Experience)'), '08');
  assert.equal(resolveExtendedPortalQuestionTaxonomy('Start Year (Work Experience)'), '2025');
  assert.equal(resolveExtendedPortalQuestionTaxonomy('Month'), '08');
  assert.equal(resolveExtendedPortalQuestionTaxonomy('Day'), '01');
  assert.equal(resolveExtendedPortalQuestionTaxonomy('Year'), '2026');
});

test('GEN-347: EU cluster routing in url-unwrapper & regex pattern', () => {
  const euUrl1 = 'https://boards.eu.greenhouse.io/acme/jobs/123456';
  const euUrl2 = 'https://job-boards.eu.greenhouse.io/acme/jobs/123456';
  const euRegex = /(?:(?:boards|job-boards)(?:\.eu)?)\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i;

  const match1 = euUrl1.match(euRegex);
  assert.ok(match1, 'boards.eu.greenhouse.io must match EU greenhouse pattern');
  assert.equal(match1[1], 'acme');
  assert.equal(match1[2], '123456');

  const match2 = euUrl2.match(euRegex);
  assert.ok(match2, 'job-boards.eu.greenhouse.io must match EU greenhouse pattern');
  assert.equal(match2[1], 'acme');
  assert.equal(match2[2], '123456');

  const wrapperUrl = 'https://careers.acme.eu/apply?gh_jid=987654';
  const unwrapped = unwrapDirectAtsApplicationUrl(wrapperUrl);
  assert.equal(unwrapped, 'https://job-boards.eu.greenhouse.io/embed/job_app?token=987654');
});

test('GEN-403: Verified accepted answer recording and retrieval ledger', () => {
  const tmpPath = path.resolve('state/autoapply/test-verified-answers.json');
  try {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);

    recordVerifiedAcceptedApplicationAnswers(
      'https://jobs.ashbyhq.com/test/123',
      [
        { questionText: 'What is your preferred development IDE?', answer: 'VS Code' },
        { questionText: 'Do you have experience with WebSockets?', answer: 'Yes' },
      ],
      tmpPath
    );

    assert.equal(lookupVerifiedAcceptedAnswer('What is your preferred development IDE?', tmpPath), 'VS Code');
    assert.equal(lookupVerifiedAcceptedAnswer('Do you have experience with WebSockets?', tmpPath), 'Yes');
    assert.equal(lookupVerifiedAcceptedAnswer('Unseen question?', tmpPath), null);
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
});
