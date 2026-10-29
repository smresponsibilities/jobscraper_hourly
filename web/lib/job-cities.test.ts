import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Job } from './types';
import { jobsByCity } from './job-cities';

test('five city groups preserve multi-location jobs without guessing unknown or remote locations', () => {
  const jobs = ['Bangalore, India', 'Hyderabad / Pune', 'Navi Mumbai', 'Chennai', 'Remote', 'India', 'Delhi', 'Puneville']
    .map((location, id) => ({ id: String(id), location }) as Job);
  const groups = jobsByCity(jobs);
  assert.deepEqual(groups.map(c => c.name), ['Bengaluru', 'Hyderabad', 'Pune', 'Mumbai', 'Chennai']);
  assert.deepEqual(groups.map(c => c.jobs.map(j => j.id)), [['0'], ['1'], ['1'], ['2'], ['3']]);
  assert.equal(new Set(groups.flatMap(c => c.jobs.map(j => j.id))).size, 4);
  assert.equal(jobsByCity([]).every(c => c.jobs.length === 0), true);
});
