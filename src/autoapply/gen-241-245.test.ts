import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { selectDiversifiedMultiLaneChunk } from '../../scripts/run-overnight-marathon.js';
import type { AutoaplyJobItem } from './types.js';

test('GEN-242: selectDiversifiedMultiLaneChunk allows up to 6 jobs per tenant on Fast-ATS / tier 2', () => {
  const candidates: AutoaplyJobItem[] = [];
  const tracks = ['Backend', 'Frontend', 'Platform', 'Infra', 'Fullstack'];

  // 5 Supabase jobs (Ashby, same tenant)
  for (let i = 0; i < 5; i++) {
    candidates.push({
      id: `supabase_${i}`,
      company: 'Supabase',
      jobUrl: `https://jobs.ashbyhq.com/supabase/role-${i}`,
      title: `Software Engineer - ${tracks[i]}`,
      location: 'Bengaluru, India, Remote',
      is_hourly_fresh: 2,
    } as any);
  }

  // 5 Rubrik jobs (Greenhouse, same tenant)
  for (let i = 0; i < 5; i++) {
    candidates.push({
      id: `rubrik_${i}`,
      company: 'Rubrik',
      jobUrl: `https://boards.greenhouse.io/rubrik/jobs/${5000 + i}`,
      title: `Backend Engineer - ${tracks[i]}`,
      location: 'Bengaluru, India',
      is_hourly_fresh: 2,
    } as any);
  }

  // 5 Workday jobs for SAME company (Workday, should be limited to 1)
  for (let i = 0; i < 5; i++) {
    candidates.push({
      id: `citi_${i}`,
      company: 'Citi',
      jobUrl: `https://citi.wd5.myworkdayjobs.com/careers/job/CitiRole_${i}`,
      title: `Software Developer - ${tracks[i]}`,
      location: 'Bengaluru, India',
      is_hourly_fresh: 0,
    } as any);
  }

  const chunk = selectDiversifiedMultiLaneChunk(candidates, 40);

  const supabaseCount = chunk.filter(j => j.company.toLowerCase() === 'supabase').length;
  const rubrikCount = chunk.filter(j => j.company.toLowerCase() === 'rubrik').length;
  const citiCount = chunk.filter(j => j.company.toLowerCase() === 'citi').length;

  assert.equal(supabaseCount, 5, `Expected all 5 Supabase jobs to be selected, got ${supabaseCount}`);
  assert.equal(rubrikCount, 5, `Expected all 5 Rubrik jobs to be selected, got ${rubrikCount}`);
  assert.equal(citiCount, 1, `Expected exactly 1 Citi Workday job to be selected, got ${citiCount}`);
});

test('GEN-243: harvest-100-hourly-jobs.ts updates location and restores skipped jobs', () => {
  const harvesterCode = fs.readFileSync('scripts/harvest-100-hourly-jobs.ts', 'utf8');
  assert.ok(
    harvesterCode.includes("existing.status === 'queued' || existing.status === 'skipped'"),
    'harvester must match queued and skipped rows'
  );
  assert.ok(
    harvesterCode.includes("UPDATE applications SET status = 'queued' WHERE id = ?") ||
    harvesterCode.includes("resurrectAppStmt"),
    'harvester must resurrect skipped applications'
  );
  assert.ok(
    harvesterCode.includes("UPDATE jobs SET status = 'queued', is_hourly_fresh = 2, location = ?, last_error = NULL"),
    'harvester must resurrect and update location in jobs table'
  );
});

test('GEN-243: runner.ts checks candidateFit.allowed before skipping on JD YOE blurb', () => {
  const runnerCode = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  assert.ok(
    runnerCode.includes('evaluateCandidateJobFit'),
    'runner.ts must import and use evaluateCandidateJobFit'
  );
  assert.ok(
    runnerCode.includes('!candidateFit.allowed && descriptions.some'),
    'runner.ts must only skip for JD experience if job title is not allowed'
  );
});
