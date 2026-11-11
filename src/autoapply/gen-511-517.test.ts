import test from 'node:test';
import assert from 'node:assert/strict';
import { isStrictTechRole, isStrictIndiaLocation } from '../../scripts/harvest-fast-ats-jobs.js';
import { resolveCandidateAnswer } from './answers.js';
import { loadProfile } from './profile.js';

test('GEN-511-517: isStrictTechRole rejects non-SWE, non-tech, and senior titles', () => {
  const rejectedTitles = [
    'CARNIVAL - PHOTOGRAPHER TRAINEE',
    'CARNIVAL Pool & Deck Supervisor TRAINEE',
    'Public Relation Intern',
    'HR Intern - Talent Acquisition',
    'BIM /REVIT Engineer',
    'Fire & Life Safety -Field Engineer',
    'Senior Software Engineer',
    'Staff Data Engineer',
    'Principal Platform Architect',
    'Lead Frontend Developer',
    'Engineering Manager',
    'Director of Engineering',
  ];
  for (const t of rejectedTitles) {
    assert.equal(isStrictTechRole(t), false, `Should reject: ${t}`);
  }
});

test('GEN-511-517: isStrictTechRole accepts junior, associate, apprentice, and mid engineering roles', () => {
  const acceptedTitles = [
    'Software Engineer',
    'Associate Backend Engineer',
    'Data Engineer',
    'AI Solutions Engineer',
    'Technology Apprentice',
    'SDE Intern',
    'Graduate Software Engineer',
    'Fullstack Developer',
    'Machine Learning Engineer',
  ];
  for (const t of acceptedTitles) {
    assert.equal(isStrictTechRole(t), true, `Should accept: ${t}`);
  }
});

test('GEN-511-517: isStrictIndiaLocation rejects foreign-restricted locations and accepts India/Remote', () => {
  assert.equal(isStrictIndiaLocation('Nairobi, ke', 'Software Engineer'), false);
  assert.equal(isStrictIndiaLocation('[U.S. Remote]', 'Data Engineer'), false);
  assert.equal(isStrictIndiaLocation('London, United Kingdom', 'Backend Developer'), false);
  assert.equal(isStrictIndiaLocation('Washington, D.C.', 'AI Engineer'), false);

  assert.equal(isStrictIndiaLocation('Bangalore, Karnataka, India', 'Data Engineer'), true);
  assert.equal(isStrictIndiaLocation('Bengaluru', 'Software Engineer I'), true);
  assert.equal(isStrictIndiaLocation('Pune, India', 'Associate Backend Engineer'), true);
  assert.equal(isStrictIndiaLocation('Remote', 'Fullstack Engineer'), true);
});

test('GEN-511-517: U.S. Person status resolves to non-US selection', () => {
  const profile = loadProfile('state/autoapply/portal-review/candidate.json');
  const res = resolveCandidateAnswer('custom', profile, {
    question: 'A “U.S. person” is a citizen, legal permanent resident, or legal temporary resident of the United States. Which best describes your “U.S. person” status?',
    options: ['U.S. Citizen', 'U.S. Permanent Resident', 'I am not a U.S. person'],
  });
  assert.equal(res.value, 'I am not a U.S. person');

  const resText = resolveCandidateAnswer('custom', profile, {
    question: 'Are you a U.S. person under ITAR / export control regulations?',
  });
  assert.equal(resText.value, 'No');
});
