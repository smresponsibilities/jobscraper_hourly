import { AutoaplyQueueManager } from '../src/autoapply/autoaply.js';
import { canonicalRequisition, canonicalEmployerKey } from '../src/autoapply/identity.js';
import { loadProfile } from '../src/autoapply/profile.js';
import { preflightJob } from '../src/autoapply/preflight.js';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve('state/autoapply/portal-review');
const profile = loadProfile(path.join(root, 'candidate.json'));
const candidateEmail = profile.personal.email;
const candidateId = createHash('sha256').update(candidateEmail.trim().toLowerCase()).digest('hex').slice(0, 20);
const queue = new AutoaplyQueueManager({
  statePath: path.join(root, 'queue.sqlite'),
  candidateId
});

const allJobs = queue.list();
const candidateJobs = allJobs
  .filter(j => !['applied', 'rejected'].includes(j.status))
  .filter(j => {
    const tenant = canonicalEmployerKey(j.jobUrl, j.externalJobId);
    if (/^(?:stripe|avoca|ss&c|ssctech|paypal)\b/i.test(tenant)) return false;
    return true;
  });

console.log('Total candidates:', candidateJobs.length);
const providers = ['ashby', 'greenhouse', 'workday', 'lever'];
const eligibleJobs: any[] = [];

for (const p of providers) {
  const pJobs = candidateJobs.filter(j => {
    const req = canonicalRequisition(j.jobUrl, j.externalJobId);
    return req?.provider === p;
  });
  console.log(`Checking ${p} jobs (pool: ${pJobs.length})...`);
  let count = 0;
  for (const j of pJobs) {
    if (count >= 5) break;
    try {
      const res = await preflightJob(j, profile);
      if (res.status === 'eligible') {
        eligibleJobs.push({ id: j.id, company: j.company, title: j.title, url: j.jobUrl, provider: p });
        count++;
        console.log(`  [ELIGIBLE ${p}] ${j.company} | ${j.title} | ${j.jobUrl}`);
      }
    } catch (e: any) {
      // ignore
    }
  }
}

console.log(`\nFound ${eligibleJobs.length} eligible live jobs ready for autoapply:`);
console.log(JSON.stringify(eligibleJobs, null, 2));
