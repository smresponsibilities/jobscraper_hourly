import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyAtsField } from './classifier.js';

test('question intent takes priority over incidental field nouns', () => {
  const category = (label: string) => classifyAtsField({ label, type: 'text' }).category;
  assert.equal(category('Do any first degree blood relatives work here?'), 'unknown');
  assert.equal(category('Are you legally able to work in this country?'), 'work_authorization');
  assert.equal(category('Consent to recruiting SMS at your phone number'), 'unknown');
  assert.equal(category('Phone Country'), 'phone_country_code');
  assert.equal(category('Do you have knowledge of GitHub?'), 'unknown');
  assert.equal(category('Are there post-employment restrictions with your current employer?'), 'non_compete');
  assert.equal(category('Have you resigned from your current employer?'), 'unknown');
  assert.equal(category('What is your last working date?'), 'unknown');
});
