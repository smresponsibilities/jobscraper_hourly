import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeGroundedNarrative, verifyTruthfulNarrative } from './narrative-composer.js';
import type { CandidateExtendedProfile } from './types.js';

const profile = {
  personal: { firstName: 'Candidate', country: 'India' },
  professional: { totalYearsExperience: 1 },
  education: [{ school: 'Chitkara University', degree: 'Bachelor of Engineering', fieldOfStudy: 'Computer Science and Engineering', graduationYear: 2026, gpa: '9.35' }],
  experience: [{ company: 'Morgan Stanley', title: 'Technology Apprentice', description: 'Used Jenkins and Maven for continuous integration. Built Java Spring Boot REST APIs.' }],
  skills: ['Java', 'Python', 'Spring Boot', 'Kafka', 'Spark'],
  skillYears: { Java: 1, Python: 1, 'Spring Boot': 1, Kafka: 1, Spark: 1 }
} as unknown as CandidateExtendedProfile;

test('Branch 0: GitLab Go/Ruby prompt returns adjacent-stack disclosure without affirmative Go authorship claim', () => {
  const gitlabPrompt = 'Tell us about a release tool you built or improved in Go or Ruby, or your experience with such tooling.';
  const res = composeGroundedNarrative(gitlabPrompt, profile);
  assert.notEqual(res, null);
  assert(res!.includes('While I have not personally built a standalone release tool in Go or Ruby yet'));
  assert(res!.includes('Morgan Stanley'));
  assert(res!.includes('Jenkins CI/CD'));
  assert.equal(verifyTruthfulNarrative(res!, profile), true);
});

test('Branch 1: CI/CD, Release, Build prompt returns grounded Morgan Stanley release narrative', () => {
  const cicdPrompt = 'Describe your experience with CI/CD deployment pipelines, build tools, and Jenkins.';
  const res = composeGroundedNarrative(cicdPrompt, profile);
  assert.notEqual(res, null);
  assert(res!.includes('Morgan Stanley'));
  assert(res!.includes('Jenkins CI/CD'));
  assert.equal(verifyTruthfulNarrative(res!, profile), true);
});

test('Branch 2: Diagrid backend, distributed systems, or debugging prompt returns Kafka/Spark/Spring narrative', () => {
  const diagridPrompt = 'Tell us about an event-driven distributed system or backend microservice API project you built and are proud of, or a difficult bug you solved.';
  const res = composeGroundedNarrative(diagridPrompt, profile);
  assert.notEqual(res, null);
  assert(res!.includes('Java Spring Boot REST APIs'));
  assert(res!.includes('Apache Kafka'));
  assert(res!.includes('Azure Snowflake'));
  assert.equal(verifyTruthfulNarrative(res!, profile), true);
});

test('Branch 3: Data engineering / ETL prompt returns Morgan Stanley data pipeline narrative', () => {
  const etlPrompt = 'What experience do you have building data pipelines, ETL workflows, and working with SQL/NoSQL databases?';
  const res = composeGroundedNarrative(etlPrompt, profile);
  assert.notEqual(res, null);
  assert(res!.includes('Python and PySpark ETL data pipelines'));
  assert(res!.includes('Kafka'));
  assert.equal(verifyTruthfulNarrative(res!, profile), true);
});

test('Branch 4: Motivation, why company, or additional info returns grounded educational and availability summary', () => {
  const whyPrompt = 'Why do you want to work at our company and why should we hire you?';
  const res = composeGroundedNarrative(whyPrompt, profile);
  assert.notEqual(res, null);
  assert(res!.includes('Chitkara University'));
  assert(res!.includes('Morgan Stanley'));
  assert(res!.includes('Bengaluru'));
  assert.equal(verifyTruthfulNarrative(res!, profile), true);

  // Short prompts (CEA, Plane, Tekion)
  assert.notEqual(composeGroundedNarrative('Why CEA?', profile), null);
  assert.notEqual(composeGroundedNarrative('Why Plane?', profile), null);
  assert.notEqual(composeGroundedNarrative('Why Tekion?', profile), null);
});

test('Branch 5: Universal grounded fallback returns Morgan Stanley apprenticeship narrative for open-ended prompts', () => {
  const prompt = 'Please elaborate on your overall technical journey and background.';
  const res = composeGroundedNarrative(prompt, profile);
  assert.notEqual(res, null);
  assert(res!.includes('Morgan Stanley in Bengaluru'));
  assert(res!.includes('Java Spring Boot REST APIs'));
  assert(res!.includes('Chitkara University'));
  assert.equal(verifyTruthfulNarrative(res!, profile), true);

  // Prompts with describe/explain/tell but without tech keywords fall back to Branch 5
  assert.notEqual(composeGroundedNarrative('Please describe a time you handled conflict on a team.', profile), null);
  assert.notEqual(composeGroundedNarrative('Explain your greatest accomplishment outside of academia.', profile), null);
  assert.notEqual(composeGroundedNarrative('Tell us something not on your resume.', profile), null);

  // Universal open-ended prompts without explicit trigger words
  assert.notEqual(composeGroundedNarrative('Key engineering achievements and core strengths', profile), null);

  // Numeric and factual questions should be rejected by isBinaryClosed
  assert.equal(composeGroundedNarrative('How many years of experience with Python do you have?', profile), null);
  assert.equal(composeGroundedNarrative('What is your notice period?', profile), null);
});

test('verifyTruthfulNarrative boundary checks reject false multi-year or affirmative Go authorship claims', () => {
  assert.equal(verifyTruthfulNarrative('I have 5 years of professional experience building cloud systems.'), false);
  assert.equal(verifyTruthfulNarrative('I wrote and authored a large production release service in Go.'), false);
  assert.equal(verifyTruthfulNarrative('Short'), false);
  assert.equal(verifyTruthfulNarrative('Reduced latency by 80 percent using Kubernetes.', profile), false);
  assert.equal(verifyTruthfulNarrative('During my Technology Apprenticeship at Morgan Stanley, I built Java APIs.', profile), true);
});
