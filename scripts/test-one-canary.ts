import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AutoApplyRunner } from '../src/autoapply/runner.js';
import { loadProfile } from '../src/autoapply/profile.js';
import { AutoaplyQueueManager } from '../src/autoapply/autoaply.js';
import { canonicalRequisition } from '../src/autoapply/identity.js';
import { CredentialVault } from '../src/autoapply/vault.js';
import { mailboxFromEnvironment } from '../src/autoapply/mailbox.js';
import { verifyEvidenceBundle } from '../src/autoapply/evidence-verifier.js';

const root = path.resolve('state/autoapply/portal-review');
const profile = loadProfile(path.join(root, 'candidate.json'));
const candidateEmail = profile.personal.email;
const candidateId = createHash('sha256').update(candidateEmail.trim().toLowerCase()).digest('hex').slice(0, 20);
const queue = new AutoaplyQueueManager({
  statePath: path.join(root, 'queue.sqlite'),
  candidateId
});
const vault = new CredentialVault(path.join(root, 'vault'));
const mailbox = mailboxFromEnvironment();

const jobId = process.argv[2] || 'autoaply_1793386671634_6ixczn'; // default Moniepoint

async function run() {
  const job = queue.list().find(j => j.id === jobId);
  if (!job) {
    console.error('Job not found:', jobId);
    return;
  }
  console.log(`Testing Canary: [${job.company}] ${job.title} (${job.id})`);
  console.log(`URL: ${job.jobUrl}`);
  const sessionDir = path.join(root, 'applications', createHash('sha256').update(job.canonicalKey || job.jobUrl).digest('hex').slice(0, 20));
  mkdirSync(sessionDir, { recursive: true });

  const runner = new AutoApplyRunner();
  try {
    const report = await runner.run({
      url: job.jobUrl,
      profile,
      submit: true,
      resume: true,
      headless: true,
      mode: 'stealth',
      sessionDir,
      company: job.company,
      applicationCountry: 'India',
      applicationLocation: job.location,
      requisition: canonicalRequisition(job.jobUrl, job.externalJobId),
      vault,
      mailbox,
      timeoutMs: 45000
    });

    console.log(`Outcome Status: ${report.status}`);
    console.log(`Outcome Reason: ${report.reason}`);
    console.log(`Review Kind: ${report.reviewKind}`);
    console.log(`Submission Attempted: ${report.submissionAttempted}`);
    console.log(`Receipt:`, report.receipt ? JSON.stringify(report.receipt) : 'none');

    if (report.receipt) {
      queue.markApplied(job.id, report.receipt);
      const evidenceDir = report.receipt.domEvidenceDir || report.receipt.evidenceDir;
      console.log(`Evidence Dir: ${evidenceDir}`);
      if (evidenceDir && existsSync(evidenceDir)) {
        const proof = verifyEvidenceBundle(evidenceDir, {
          vault,
          candidateEmail,
          requisitionKey: canonicalRequisition(job.jobUrl, job.externalJobId)?.key
        });
        console.log(`Proof:`, JSON.stringify(proof));
      }
    }
  } finally {
    await runner.close();
    queue.close();
    await mailbox?.close();
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
