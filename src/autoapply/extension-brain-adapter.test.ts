import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveDomFieldsForExtensionBrain, ingestHumanCorrectionFromExtension } from './extension-brain-adapter.js';
import type { CandidateExtendedProfile } from './types.js';

test('extension brain maps supplied profile facts and skips duplicates or unknowns', () => {
  const profile = { personal: { firstName: 'Fixture', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] } as CandidateExtendedProfile;
  const rows = resolveDomFieldsForExtensionBrain([{ id: 'a', name: 'first', label: 'First Name', type: 'text' }, { id: 'b', name: 'unknown', label: 'Describe a personal outage', type: 'text' }], '', { profile, jobUrl: 'https://example.test/job' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.resolvedValue, 'Fixture');
  assert.equal(rows[0]?.factKey, 'personal.firstName');
  assert.equal(ingestHumanCorrectionFromExtension({ questionLabel: 'Years of experience', humanValue: '5', factKey: 'professional.totalYearsExperience' }).recorded, false);
});
