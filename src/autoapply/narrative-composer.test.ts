import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeGroundedNarrative, composePortfolioProjectNarrative, lookupPortfolioProjectFact, selectBestPortfolioProjectForQuestion, verifyTruthfulNarrative } from './narrative-composer.js';
import { resolveCandidateAnswer } from './answers.js';
import { getPortfolioProjects } from '../resume/deterministic-builder.js';
import type { CandidateExtendedProfile } from './types.js';

const profile = {
  personal: { firstName: 'Shivam', lastName: 'Mahajan', country: 'India' },
  professional: { totalYearsExperience: 1 },
  education: [],
  experience: [{ company: 'Fixture', title: 'Apprentice', description: 'Used Jenkins and Maven for continuous integration. Built Java Spring Boot REST APIs.' }],
  skills: ['Java'], skillYears: { Java: 1 },
} as unknown as CandidateExtendedProfile;

test('selects the relevant catalogue project for six technical domains', () => {
  const prompts: Array<[string, RegExp]> = [
    ['ClickHouse ETL data engineering', /clickhouse/i],
    ['Real-time WebSockets concurrency', /quizdeck/i],
    ['LLM Gemini AI project', /chaincode/i],
    ['Next.js cohort analytics fullstack', /shopify/i],
    ['Android Kotlin mobile', /productivity caller/i],
    ['Rust C99 WebAssembly systems', /wordle|clickless/i],
  ];
  for (const [question, title] of prompts) {
    const project = selectBestPortfolioProjectForQuestion(question);
    assert.match(project.title, title);
    assert.match(project.url, /^https:\/\/(?:github\.com|shivammahajan\.com)\//);
    assert.match(project.factKey, /^projectCatalog\./);
    assert.deepEqual(lookupPortfolioProjectFact(project.factKey), project);
  }
  assert.match(selectBestPortfolioProjectForQuestion('unrelated').title, /morgan stanley/i);
  assert.equal(getPortfolioProjects().length, 15);
  assert.match(selectBestPortfolioProjectForQuestion('Build an HTTP API testing client').title, /postie/i);
  assert.match(selectBestPortfolioProjectForQuestion('C99 WebAssembly Wordle').title, /wordle/i);
  assert.match(selectBestPortfolioProjectForQuestion('Rust keyboard cursor').title, /clickless/i);
});

test('project answers cite catalogue and do not apply to a different candidate', () => {
  const question = 'Describe a WebSockets project you built';
  const project = composePortfolioProjectNarrative(question, profile);
  assert.match(project?.text || '', /QuizDeck/);
  assert.match(project?.text || '', /500 concurrent players/);
  assert.equal(composePortfolioProjectNarrative(question, { ...profile, personal: { ...profile.personal, firstName: 'Other' } }), null);
  const answer = resolveCandidateAnswer('unknown', profile, { url: 'https://example.test/1', question, fieldType: 'textarea' });
  assert.equal(answer.reason, 'verified_project_catalog');
  assert.deepEqual(answer.sourceFactKeys, [project?.factKey]);
});

test('narratives use provided excerpts and leave unsupported personal incidents unresolved', () => {
  assert.equal(composeGroundedNarrative('Describe release tools you used', profile), 'Used Jenkins and Maven for continuous integration.');
  assert.equal(composeGroundedNarrative('Describe a release tool you built in Go', profile), null);
  assert.equal(composeGroundedNarrative('Describe a difficult production failure', profile), null);
  assert.equal(composeGroundedNarrative('Describe a time you handled conflict', profile), null);
  assert.equal(composeGroundedNarrative('Tell us something not on your resume', profile), null);
  assert.equal(composeGroundedNarrative('What is your notice period?', profile), null);
  assert.equal(verifyTruthfulNarrative('I have 5 years of professional experience.', profile), false);
});
