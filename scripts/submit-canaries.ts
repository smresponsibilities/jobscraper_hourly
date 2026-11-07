import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AutoApplyRunner } from '../src/autoapply/runner.js';
import { loadProfile } from '../src/autoapply/profile.js';
import { AutoaplyQueueManager } from '../src/autoapply/autoaply.js';
import { canonicalRequisition, canonicalEmployerKey } from '../src/autoapply/identity.js';
import { verifyEvidenceBundle } from '../src/autoapply/evidence-verifier.js';
import { CredentialVault } from '../src/autoapply/vault.js';
import { mailboxFromEnvironment } from '../src/autoapply/mailbox.js';
import { auditAcceptance, ACCEPTANCE_PROVIDERS } from '../src/autoapply/acceptance.js';
import { preflightJob } from '../src/autoapply/preflight.js';

const root = path.resolve('state/autoapply/portal-review');
const profile = loadProfile(path.join(root, 'candidate.json'));
const candidateEmail = profile.personal.email;
const candidateId = createHash('sha256').update(candidateEmail.trim().toLowerCase()).digest('hex').slice(0, 20);
const queue = new AutoaplyQueueManager({
  statePath: path.join(root, 'queue.sqlite'),
  candidateId
});
const vaultDir = path.join(root, 'vault');
const vault = new CredentialVault(vaultDir);
const mailbox = mailboxFromEnvironment();

function getProvider(url: string, externalJobId?: string): string {
  const req = canonicalRequisition(url, externalJobId);
  if (req?.provider) return req.provider;
  if (/greenhouse\.io/i.test(url)) return 'greenhouse';
  if (/ashbyhq\.com/i.test(url)) return 'ashby';
  if (/myworkdayjobs\.com/i.test(url)) return 'workday';
  if (/smartrecruiters\.com/i.test(url)) return 'smartrecruiters';
  if (/lever\.co/i.test(url)) return 'lever';
  return 'other';
}

async function main() {
  const verifiedReceipts: any[] = [];
  try {
    const initialAcceptance = auditAcceptance(queue.list(), candidateEmail, vault, 50);
    console.log(`Current verified acceptance count on disk: ${initialAcceptance.verifiedCount}`);
    if (initialAcceptance.verifiedCount >= 5) {
      console.log(`Target >= 5 verified receipts already satisfied!`);
      return;
    }

    const allJobs = queue.list();
    const byProv: Record<string, typeof allJobs> = {};
    for (const p of ACCEPTANCE_PROVIDERS) byProv[p] = [];

    for (const j of allJobs) {
      if (['applied', 'rejected'].includes(j.status)) continue;
      const tenant = canonicalEmployerKey(j.jobUrl, j.externalJobId);
      if (/(?:^|:)(?:stripe|avoca|ss&c|ssctech|paypal)\b/i.test(tenant) || /^(?:stripe|avoca|ss&c|ssctech|paypal)\b/i.test(j.company)) continue;
      const provider = getProvider(j.jobUrl, j.externalJobId);
      if (ACCEPTANCE_PROVIDERS.includes(provider as any)) {
        byProv[provider]!.push(j);
      }
    }

    for (const p of ACCEPTANCE_PROVIDERS) {
      byProv[p]!.sort((a, b) => (a.status === 'queued' ? 0 : 1) - (b.status === 'queued' ? 0 : 1));
    }

    const blockedTenants = new Set(['stripe', 'avoca', 'ss&c', 'ssctech', 'paypal']);
    for (const job of allJobs) {
      if (job.status === 'applied' && job.receipt) {
        const tenant = canonicalEmployerKey(job.jobUrl, job.externalJobId);
        blockedTenants.add(tenant);
      }
      const checkpoint = path.join(root, 'applications', createHash('sha256').update(job.canonicalKey || job.jobUrl).digest('hex').slice(0, 20), 'checkpoint.json');
      if (existsSync(checkpoint)) {
        try {
          const saved = JSON.parse(readFileSync(checkpoint, 'utf8')).report;
          if (saved?.receipt && (saved?.status === 'submitted' || saved?.submission?.phase === 'confirmed')) {
            const tenant = canonicalEmployerKey(job.jobUrl, job.externalJobId);
            blockedTenants.add(tenant);
          }
        } catch {}
      }
    }

    const candidateJobs: typeof allJobs = [];
    const maxLen = Math.max(...ACCEPTANCE_PROVIDERS.map(p => byProv[p]?.length || 0));
    for (let i = 0; i < maxLen; i++) {
      for (const p of ['greenhouse', 'ashby', 'workday', 'lever'] as const) {
        if (byProv[p] && i < byProv[p]!.length) {
          const j = byProv[p]![i]!;
          const tenant = canonicalEmployerKey(j.jobUrl, j.externalJobId);
          if (!candidateJobs.some(c => c.id === j.id) && !blockedTenants.has(tenant)) {
            candidateJobs.push(j);
          }
        }
      }
    }

    console.log(`Eligible candidates found: ${candidateJobs.length}`);

    for (const job of candidateJobs) {
      const currentAcceptance = auditAcceptance(queue.list(), candidateEmail, vault, 50);
      if (currentAcceptance.verifiedCount >= 5) {
        console.log(`Reached ${currentAcceptance.verifiedCount} verified receipts! Ending canary loop.`);
        break;
      }

      const tenant = canonicalEmployerKey(job.jobUrl, job.externalJobId);
      if (/(?:^|:)(?:stripe|avoca|ss&c|ssctech|paypal)\b/i.test(tenant) || /^(?:stripe|avoca|ss&c|ssctech|paypal)\b/i.test(job.company)) {
        console.log(`Tenant ${tenant} (${job.company}) is isolated, skipping`);
        continue;
      }

      const provider = getProvider(job.jobUrl, job.externalJobId);
      console.log(`\nChecking preflight for [${job.company}] [${provider}] ${job.title}...`);
      try {
        const pre = await preflightJob(job, profile);
        if (pre.status !== 'eligible') {
          console.log(`Preflight skipped (${pre.reason}) for ${job.company}`);
          if (pre.status === 'skipped') queue.skip(job.id, pre.reason);
          continue;
        }
      } catch (err: any) {
        console.log(`Preflight error for ${job.company}: ${err.message}`);
        continue;
      }

      console.log(`Submitting [${job.company}] [${provider}] ${job.title} (${job.id})...`);
      const sessionDir = path.join(root, 'applications', createHash('sha256').update(job.canonicalKey || job.jobUrl).digest('hex').slice(0, 20));
      mkdirSync(sessionDir, { recursive: true });

      const runner = new AutoApplyRunner();
      try {
        const report = await runner.run({
          url: job.jobUrl,
          profile,
          submit: true,
          resume: true,
          retryReviewed: true,
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

        console.log(`Outcome: ${report.status} | Reason: ${report.reason} | Attempted: ${report.submissionAttempted}`);

        if (report.status !== 'submitted') {
          blockedTenants.add(tenant);
        }

        if (report.reason === 'captcha_deferred') {
          console.log(`CAPTCHA deferred for ${job.company} — advancing to next job`);
          queue.skip(job.id, 'captcha_deferred');
          continue;
        }

        if (report.receipt) {
          queue.markApplied(job.id, report.receipt);
          const evidenceDir = report.receipt.domEvidenceDir || report.receipt.evidenceDir;
          console.log(`Receipt observed: ${report.receipt.text || 'Confirmed'} | Evidence: ${evidenceDir}`);
          if (evidenceDir && existsSync(evidenceDir)) {
            try {
              const proof = verifyEvidenceBundle(evidenceDir, {
                vault,
                candidateEmail,
                requisitionKey: canonicalRequisition(job.jobUrl, job.externalJobId)?.key
              });
              console.log(`Bundle verification: integrity=${proof.integrity}, authenticated=${proof.authenticated}, autonomous=${proof.autonomous}, networkVerified=${proof.networkVerified}`);
              if (proof.integrity && proof.authenticated && proof.autonomous) {
                verifiedReceipts.push({ id: job.id, company: job.company, evidenceDir, proof });
              }
            } catch (err: any) {
              console.log(`Verification error: ${err.message}`);
            }
          }
        }
      } catch (err: any) {
        console.log(`Runner error on ${job.company}: ${err.message}`);
      } finally {
        await runner.close();
      }
    }
  } finally {
    queue.close();
    await mailbox?.close();
  }

  console.log(`\n=== Live Submission Canary Summary ===`);
  console.log(`Total verified receipts recorded in this pass: ${verifiedReceipts.length}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
