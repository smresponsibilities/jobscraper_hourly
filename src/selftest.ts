import { classify } from './classify.js';
import { locationMatches, roleFamily } from './filter.js';
import type { Industry, RawJob } from './types.js';

/**
 * Regression tests for the two regex layers that decide everything.
 *
 *   npm test
 *
 * Every case here is a bug that actually shipped. "Indiana" matching `india`
 * leaked 62 US roles into a real alert email before it was caught by eye — the
 * kind of thing a typecheck can never find.
 */
let failures = 0;

function check(label: string, got: unknown, want: unknown): void {
  if (got !== want) {
    failures++;
    console.log(`  FAIL  ${label}\n        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

console.log('locations');
const locations: [string, boolean][] = [
  // Substring traps — these all leaked at some point.
  ['United States - Indiana - Westfield', false],
  ['US-IN-Indianapolis', false],
  ['Indianapolis, Indiana, United States', false],
  ['Goal setting, Texas', false],
  // Genuine India.
  ['India - Mumbai', true],
  ['Bangalore, India', true],
  ['IN, KA, Bengaluru', true],
  ['Goa, India', true],
  ['Hyderabad, Telangana, India', true],
  // Remote handling: bare remote counts, region-locked remote does not.
  ['Remote', true],
  ['Remote - India', true],
  ['Remote, Denmark', false],
  ['Remote - Ireland', false],
  ['Remote - US', false],
  ['', false],
];
for (const [location, want] of locations) check(`location ${JSON.stringify(location)}`, locationMatches(location), want);

console.log('seniority');
const job = (title: string, text = ''): RawJob => ({ externalId: 'x', title, location: 'Bengaluru', url: '', text });
const senior: [string, Industry][] = [
  ['Head - Advanced Analytics', 'tech'],
  ['Sr. Business Analyst', 'banking'],
  ['Software Dev Engineer II', 'tech'],
  ['Site Reliability Engineer - 2', 'tech'],
  ['Forward Deployed Engineer - II', 'tech'],
  ['Distinguished AI Engineer', 'banking'],
  ['Principal Software Engineer', 'tech'],
  ['Senior Software Engineer', 'tech'],
  ['Engineering Manager, Looker', 'tech'],
];
for (const [title, industry] of senior) {
  check(`senior: ${title}`, classify(job(title), industry).isJunior, false);
}

const junior: [string, Industry][] = [
  ['Software Engineer, University Graduate', 'tech'],
  ['SDE-1, Payments', 'tech'],
  ['Associate Application Engineer', 'tech'],
  ['Analyst - Asset Servicing', 'banking'],
  ['Business Analyst', 'consulting'],
];
for (const [title, industry] of junior) {
  check(`junior: ${title}`, classify(job(title), industry).isJunior, true);
}

console.log('years');
check('0-2 years', classify(job('Engineer', 'requires 0-2 years experience'), 'tech').minYears, 0);
check('8+ years', classify(job('Engineer', 'needs 8+ years of experience'), 'tech').minYears, 8);
check('lowest wins', classify(job('Engineer', '2 years required, 7+ years preferred'), 'tech').minYears, 2);
check('unstated', classify(job('Engineer', 'no numbers here'), 'tech').minYears, null);

console.log('excluded role types');
for (const title of ['Part Time Associate Banker', 'Cloud Data Platform Sales', 'Data Center Technician', 'IT Support Associate']) {
  check(`excluded: ${title}`, classify(job(title), 'tech').excluded, true);
}

console.log('role families');
check('finance family off at tech firms', roleFamily('Associate, Operations', 'tech'), null);
check('finance family on at banks', roleFamily('Asset Servicing Analyst', 'banking'), 'finance');
check('swe family', roleFamily('Backend Engineer', 'tech'), 'swe');

console.log(failures === 0 ? '\nall checks pass' : `\n${failures} failing check(s)`);
process.exit(failures === 0 ? 0 : 1);
