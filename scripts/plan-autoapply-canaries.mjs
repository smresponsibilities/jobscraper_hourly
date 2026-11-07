import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { canonicalRequisition } from '../out/dist/src/autoapply/identity.js';
import { preflightJob } from '../out/dist/src/autoapply/preflight.js';
import { loadProfile } from '../out/dist/src/autoapply/profile.js';

// Public endpoint checks only. Candidate facts stay local and out of the report.
const profile = loadProfile('state/autoapply/portal-review/candidate.json');
const db = new DatabaseSync('state/autoapply/portal-review/queue.sqlite', { readOnly: true });
const jobs = db.prepare('SELECT payload FROM applications').all().map(row => JSON.parse(row.payload));
db.close();
const report = { checkedAt: new Date().toISOString(), checks: [], jobs: [] };
const abb = JSON.parse(readFileSync('out/sequential-abb.json', 'utf8')).jobs[0];
const abbResult = await preflightJob(abb, profile);
report.checks.push({ provider: 'workday', id: abb.id, status: abbResult.status, reason: abbResult.reason });
if (abbResult.status === 'eligible') report.jobs.push(abb);
for (const provider of ['greenhouse', 'lever', 'ashby']) {
  const candidates = jobs.filter(job => job.status === 'queued'
    && canonicalRequisition(job.jobUrl, job.externalJobId)?.provider === provider
    && /\bsoftware|\bdeveloper|\bbackend|\bfull.?stack|\bdata engineer|\bmachine learning/i.test(job.title))
    .sort((a, b) => (Date.parse(b.postedAt) || 0) - (Date.parse(a.postedAt) || 0));
  for (const job of candidates.slice(0, 12)) {
    const result = await preflightJob(job, profile);
    report.checks.push({ provider, id: job.externalJobId, status: result.status, reason: result.reason });
    if (result.status !== 'eligible') continue;
    report.jobs.push({ id: job.externalJobId, company: job.company, title: job.title, location: job.location, url: job.jobUrl });
    break;
  }
}
writeFileSync('out/autoapply-canary-plan.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ checked: report.checks.length, eligible: report.jobs.length, decisions: report.checks }));
