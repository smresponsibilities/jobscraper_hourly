import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preflightJob } from './preflight.js';
import type { CandidateExtendedProfile } from './types.js';
import { resolveCandidateAnswer } from './answers.js';

test('rolling intake restricts location, role and target experience', async () => {
  const profile = {} as CandidateExtendedProfile;
  const fetcher = async () => new Response('<script type="application/ld+json">{"@type":"JobPosting","description":"Software development"}</script>');
  const job = { title: 'Software Engineer', company: 'Example', jobUrl: 'https://example.test/job', location: 'Bengaluru, India' };
  assert.equal((await preflightJob(job, profile, { fetcher })).status, 'eligible');
  assert.equal((await preflightJob({ ...job, title: 'Account Executive' }, profile, { fetcher })).reason, 'ineligible_role');
  assert.equal((await preflightJob({ ...job, company: 'Brillio' }, profile, { fetcher })).reason, 'ineligible_service_company');
  assert.equal((await preflightJob({ ...job, location: 'Remote - Denmark' }, profile, { fetcher })).reason, 'ineligible_jd_location');
  assert.equal((await preflightJob({ ...job, location: 'Remote' }, profile, { fetcher })).reason, 'unconfirmed_india_remote');
  assert.equal((await preflightJob({ ...job, location: 'Remote - India' }, profile, { fetcher })).status, 'eligible');
  assert.equal((await preflightJob({ ...job, location: 'Remote - Worldwide' }, profile, { fetcher })).status, 'eligible');
  assert.equal((await preflightJob({ ...job, location: '' }, profile, { fetcher })).reason, 'ineligible_jd_location');
  assert.equal((await preflightJob({ ...job, minYears: 4 }, profile, { fetcher })).reason, 'ineligible_jd_experience');
});

test('preflight rejects observed minimum-experience wording and missing source descriptions', async () => {
  const profile = {} as CandidateExtendedProfile;
  const job = { title: 'Software Engineer', company: 'Example', jobUrl: 'https://api.example.test/job', location: 'Bengaluru, India' };
  const html = (description: string) => async () => new Response(`<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', description })}</script>`);
  assert.equal((await preflightJob(job, profile, { fetcher: html('Required Skills and Experience: 4 or more years of professional experience.') })).reason, 'ineligible_jd_experience');
  assert.equal((await preflightJob(job, profile, { fetcher: html('Required Skills and Experience: four or more years of professional experience.') })).reason, 'ineligible_jd_experience');
  assert.equal((await preflightJob(job, profile, { fetcher: html('Required: 2 or more years of software experience.') })).status, 'eligible');
  assert.equal((await preflightJob({ ...job, title: 'Data Engineer' }, profile, { fetcher: html('Join us as a Data Engineer. To be successful as a Senior Software Engineer, you should have experience with data pipelines.') })).reason, 'source_role_level_conflict');
  assert.equal((await preflightJob(job, profile, { fetcher: html('Collaborate with a senior software engineer on data pipelines.') })).status, 'eligible');
  const workday = { ...job, jobUrl: 'https://example.wd1.myworkdayjobs.com/en-US/careers/job/India/Software-Engineer_R123', externalJobId: 'workday:example:R123' };
  assert.equal((await preflightJob(workday, profile, { fetcher: async () => Response.json({ jobPostingInfo: { title: 'Software Engineer' } }) })).reason, 'source_description_missing');
});

test('adult declaration uses only the supplied positive age fact', () => {
  const profile = { adult: true, personal: {}, professional: {}, workAuthorization: {}, eeo: {}, education: [], experience: [] } as unknown as CandidateExtendedProfile;
  const answer = (question: string) => resolveCandidateAnswer('unknown', profile, { url: 'https://example.test/job', question }).value;
  assert.equal(answer('Are you at least 18 years of age?'), true);
  assert.equal(answer('Are you under 18 years old?'), undefined);
  assert.equal(answer('Are you 21 years old?'), undefined);
});
