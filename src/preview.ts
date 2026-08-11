import { readFileSync, writeFileSync } from 'node:fs';
import type { Job } from './types.js';
import { renderEmail, subject } from './email.js';

/** Renders the last dry run's matches to out/preview.html so you can eyeball it. */
const matches = JSON.parse(readFileSync('out/matches.json', 'utf8')) as Job[];
writeFileSync('out/preview.html', renderEmail(matches));

console.log(`subject: [jobs] ${subject(matches)}`);
console.log(`${matches.length} matches, ${matches.filter((j) => j.postedAt).length} with a posted date`);
console.log('open out/preview.html');
