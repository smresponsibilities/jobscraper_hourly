import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ApplicationStore } from '../src/autoapply/store.js';
import { loadProfile } from '../src/autoapply/profile.js';
import { canonicalEmployerKey, canonicalRequisition } from '../src/autoapply/identity.js';
import { preflightJob } from '../src/autoapply/preflight.js';
import { AutoApplyRunner } from '../src/autoapply/runner.js';
import { CredentialVault } from '../src/autoapply/vault.js';
import { mailboxFromEnvironment } from '../src/autoapply/mailbox.js';

try { process.loadEnvFile(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }

const root = path.resolve('state/autoapply/portal-review');
const profile = loadProfile(path.join(root, 'candidate.json'));
const candidateId = createHash('sha256').update(profile.personal.email.trim().toLowerCase()).digest('hex').slice(0, 20);
const store = new ApplicationStore(path.join(root, 'queue.sqlite'), candidateId);
const mailbox = mailboxFromEnvironment();
const report: {
  generatedAt: string;
  submit: false;
  checks: unknown[];
  results: Array<{ company: string; provider: string; id: string; passed: boolean; ready: boolean; reason: string; unmappedFields: string[]; emptyChoiceFields: number; submissionAttempted: boolean; attempted: boolean; fieldsFilled: number }>;
  tenants: Array<{ company: string; provider: string; id: string; passed: boolean; ready: boolean; reason: string; unmappedFields: string[]; emptyChoiceFields: number; submissionAttempted: boolean; attempted: boolean; fieldsFilled: number }>;
  passed: boolean;
} = { generatedAt: new Date().toISOString(), submit: false, checks: [], results: [], tenants: [], passed: false };
try {
  if (!store.acquireWorkerLock()) throw new Error('Another application worker is active');
  const jobs = store.list();
  const vault = new CredentialVault(path.join(root, 'vault'));
  const blocked = new Set(['greenhouse:stripe', 'ashby:avoca', 'workday:ssctech', 'workday:paypal']);
  if (existsSync('out/dryrun-canary-report.json')) {
    const prior = JSON.parse(readFileSync('out/dryrun-canary-report.json', 'utf8'));
    writeFileSync(`out/dryrun-canary-report-${Date.now()}.json`, JSON.stringify(prior, null, 2));
  }
  for (const filename of readdirSync('out').filter(name => /^dryrun-canary-report(?:-\d+)?\.json$/.test(name))) {
    const prior = JSON.parse(readFileSync(path.join('out', filename), 'utf8'));
    for (const result of (prior.results || prior.tenants || [])) {
      if (result.submissionAttempted) {
        const job = jobs.find(job => job.id === result.id);
        if (job) blocked.add(canonicalEmployerKey(job.jobUrl, job.externalJobId));
      }
    }
  }
  for (const job of jobs) {
    const tenant = canonicalEmployerKey(job.jobUrl, job.externalJobId);
    if (store.submissionClickAt(job.id)) blocked.add(tenant);
    const checkpoint = path.join(root, 'applications', createHash('sha256').update(job.canonicalKey || job.jobUrl).digest('hex').slice(0, 20), 'checkpoint.json');
    if (existsSync(checkpoint)) {
      try { const saved = JSON.parse(readFileSync(checkpoint, 'utf8')).report; if (saved?.submissionAttempted || saved?.credentialAttempts?.length || ['clicked', 'dispatched', 'confirmed'].includes(saved?.submission?.phase)) blocked.add(tenant); }
      catch { blocked.add(tenant); }
    }
    if (/^(?:stripe|avoca|ss&c|paypal)\b/i.test(job.company)) blocked.add(tenant);
  }
  const visited = new Set<string>();
  const passedTenants = new Set<string>();
  const activeProviders = ['lever', 'greenhouse', 'ashby', 'smartrecruiters', 'eightfold', 'workday'];
  while (passedTenants.size < 5) {
    let candidateCheckedInRound = false;
    for (const provider of activeProviders) {
      if (passedTenants.size >= 5) break;
      const candidates = jobs.filter(job => {
        const reqKey = canonicalRequisition(job.jobUrl, job.externalJobId)?.key || canonicalEmployerKey(job.jobUrl, job.externalJobId);
        return (
          job.status === 'queued' &&
          canonicalRequisition(job.jobUrl, job.externalJobId)?.provider === provider &&
          !blocked.has(canonicalEmployerKey(job.jobUrl, job.externalJobId)) &&
          !passedTenants.has(reqKey) &&
          !visited.has(reqKey)
        );
      }).sort((a, b) => (/india|bengaluru|bangalore|pune|mumbai|hyderabad|delhi|noida|gurgaon|chennai/i.test(b.location || '') ? 1 : 0) - (/india|bengaluru|bangalore|pune|mumbai|hyderabad|delhi|noida|gurgaon|chennai/i.test(a.location || '') ? 1 : 0));

      for (const job of candidates) {
        if (passedTenants.size >= 5) break;
        const tenant = canonicalRequisition(job.jobUrl, job.externalJobId)?.key || canonicalEmployerKey(job.jobUrl, job.externalJobId);
        if (visited.has(tenant) || passedTenants.has(tenant)) continue;
        visited.add(tenant);
        candidateCheckedInRound = true;

        const preflight = await preflightJob({ ...job, url: job.jobUrl }, profile, { signal: AbortSignal.timeout(20000) });
        report.checks.push({ id: job.id, company: job.company, provider, status: preflight.status, reason: preflight.reason });
        if (preflight.status !== 'eligible') continue;

        const runner = new AutoApplyRunner();
        const sessionDir = path.join(root, 'gen-dryrun', job.id);
        const timer = setTimeout(() => { void runner.close(); }, 90000);
        try {
          const result = await runner.run({
            url: job.jobUrl,
            profile,
            submit: false,
            headless: true,
            mode: 'copilot',
            sessionDir,
            company: job.company,
            applicationCountry: 'India',
            applicationLocation: job.location,
            vault,
            mailbox,
            requisition: canonicalRequisition(job.jobUrl, job.externalJobId),
            applicationBrief: { title: job.title, company: job.company, text: preflight.description! },
            timeoutMs: 15000
          });
          const emptyChoiceList = (result.choiceFields || []).filter(field => !field.options.length);
          const emptyChoiceFields = emptyChoiceList.length;
          const failedActions = (result.actions || []).filter(a => a.status === 'failed');
          const unmappedList = failedActions.map(a => a.question || a.controlKey || a.category || 'unknown');
          const isReady =
            !result.submissionAttempted &&
            result.unmappedFields === 0 &&
            failedActions.length === 0 &&
            emptyChoiceFields === 0 &&
            result.fieldsFilled > 0 &&
            (/^Ready for submission review/i.test(result.reason || '') ||
             result.reason === 'Review before advancing');

          const entry = {
            company: job.company,
            provider,
            id: job.id,
            passed: isReady,
            ready: isReady,
            reason: result.reason || result.status,
            unmappedFields: isReady ? [] : (unmappedList.length ? unmappedList : [result.reason || 'unready']),
            emptyChoiceFields,
            submissionAttempted: !!result.submissionAttempted,
            attempted: false,
            fieldsFilled: result.fieldsFilled || 0
          };
          report.results.push(entry);
          report.tenants.push(entry);

          if (isReady) {
            passedTenants.add(tenant);
            console.log(`[CANARY PASS ${passedTenants.size}/5] Provider: ${provider}, Company: ${job.company}, ID: ${job.id}`);
            break; // rotate to next provider
          } else {
            console.log(`[CANARY UNREADY] Provider: ${provider}, Company: ${job.company}, Reason: ${result.reason || result.status}`);
          }
        } finally { clearTimeout(timer); await runner.close(); }
      }
    }
    if (!candidateCheckedInRound) break;
  }
  report.passed = passedTenants.size >= 5;
} finally {
  store.close();
  await mailbox?.close();
  mkdirSync('out', { recursive: true });
  writeFileSync('out/dryrun-canary-report.json.tmp', JSON.stringify(report, null, 2));
  renameSync('out/dryrun-canary-report.json.tmp', 'out/dryrun-canary-report.json');
}
console.log(JSON.stringify({ passed: report.passed, sourceChecks: report.checks.length, tenants: report.tenants }));
if (!report.passed) process.exitCode = 1;
