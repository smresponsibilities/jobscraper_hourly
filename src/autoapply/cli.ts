import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { AutoApplyRunner } from './runner.js';
import { AutoaplyQueueManager } from './autoaply.js';
import { prepareApplication } from './prepare.js';
import { loadProfile } from './profile.js';
import type { Job } from '../types.js';
import type { RunnerMode } from './types.js';
import type { AutoApplyOptions } from './runner.js';

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(['--dry-run', '--headed', '--headless', '--submit', '--resume', '--run-queue', '--list-queue', '--fresh-only', '--help']);
  const values = new Set(['--url', '--mode', '--profile', '--session', '--queue', '--catalog', '--max-jobs', '--max-age-hours', '--retry-reviewed', '--init-profile', '--prepare', '--output']);
  const parsed = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (flags.has(key)) parsed.set(key, 'true');
    else if (values.has(key)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
      parsed.set(key, value);
    } else if (/^https?:\/\//.test(key)) parsed.set('--url', key);
    else throw new Error(`Unknown argument: ${key}`);
  }
  if (parsed.has('--init-profile')) {
    writeFileSync(parsed.get('--init-profile')!, JSON.stringify({ personal: { firstName: '', lastName: '', email: '', phone: '', country: '' }, education: [], experience: [], professional: {}, workAuthorization: {}, eeo: {}, qaBank: {}, documents: {} }, null, 2), { flag: 'wx', mode: 0o600 });
    console.log('Blank profile created. Fill only answers you know; omitted answers remain unknown.');
    return;
  }
  if (!args.length || parsed.has('--help')) {
    console.log(`Application autofill and submission
  --url <url> --profile <json>     Single application
  --catalog <jobs.json>           Import catalogue into a durable queue
  --run-queue                    Process pending jobs
  --list-queue                   Print saved queue and receipt metrics
  --queue <json>                 Queue snapshot path
  --retry-reviewed <id>          Requeue after checking employer receipt
  --submit                      Send application and wait for confirmation
  --mode <copilot|stealth>       Pause between steps or advance automatically
  --headed                      Open browser with interactive review/continue
  --resume                      Reopen saved browser session/checkpoint
  --session <directory>          Private browser/session directory
  --dry-run                     Inspect without filling or advancing
  --fresh-only --max-age-hours <n>  Skip old or undated queue entries
  --max-jobs <n>                 Batch limit (default 10)
  --prepare <job.json> --output <directory>  Draft resume PDF, cover letter and skill overlap
  --init-profile <json>          Create a blank candidate profile`);
    return;
  }
  const mode = parsed.get('--mode') || 'copilot';
  if (mode !== 'copilot' && mode !== 'stealth') throw new Error('Mode must be copilot or stealth');
  const number = (key: string, fallback: number) => {
    const n = Number(parsed.get(key) ?? fallback);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${key} must be a positive integer`);
    return n;
  };
  if (!parsed.has('--profile')) throw new Error('Provide --profile <candidate.json>');
  const profile = loadProfile(parsed.get('--profile')!);
  if (parsed.has('--prepare')) {
    console.log(JSON.stringify(await prepareApplication(profile, JSON.parse(readFileSync(parsed.get('--prepare')!, 'utf8')), parsed.get('--output') || path.join('state/autoapply/prepared', String(Date.now())))));
    return;
  }
  const candidateId = createHash('sha256').update(profile.personal.email.trim().toLowerCase()).digest('hex').slice(0, 20);
  const root = path.resolve(parsed.get('--session') || path.join('state', 'autoapply', candidateId));
  const sessionFor = (url: string) => path.join(root, createHash('sha256').update(url).digest('hex').slice(0, 20));
  const runner = new AutoApplyRunner();
  if (parsed.has('--headed') && parsed.has('--headless')) throw new Error('Choose either --headed or --headless');
  const common = { profile, browserProfileDir: path.join(root, 'browser'), mode: mode as RunnerMode, dryRun: parsed.has('--dry-run'), submit: parsed.has('--submit'), headless: parsed.has('--headless'), retryReviewed: parsed.get('--retry-reviewed') === 'single' };
  const currentProfile = () => {
    const updated = loadProfile(parsed.get('--profile')!);
    if (updated.personal.email.trim().toLowerCase() !== profile.personal.email.trim().toLowerCase()) throw new Error('Candidate email changed during review; start a separate candidate session');
    return updated;
  };
  const runWithReview = async (options: AutoApplyOptions) => {
    options = { ...options, profile: currentProfile() };
    let report = await runner.run(options);
    if (!common.headless && !common.dryRun) {
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      try {
        while (report.status === 'paused_for_review') {
          console.log(report.reason);
          const questions = [...new Set(report.actions.filter(action => action.status === 'failed' && action.error === 'Required answer is missing').map(action => action.question || action.selector))];
          if (questions.length) console.log(`Required answers:\n${questions.map(question => `- ${question}`).join('\n')}`);
          const prompt = report.submissionAttempted
            ? 'Complete any browser challenge. Enter to check receipt without resubmitting, q to save and close: '
            : 'Review in browser. Enter to continue, q to save and close: ';
          const controller = new AbortController();
          const input = terminal.question(prompt, { signal: controller.signal }).catch(() => 'q');
          const automatic = report.reviewKind && report.reviewKind !== 'answers'
            ? runner.waitForReviewChange(report, controller.signal, options).then(changed => changed ? '' : 'q')
            : undefined;
          let answer: string;
          try { answer = await (automatic ? Promise.race([input, automatic]) : input); }
          finally { controller.abort(); await Promise.allSettled(automatic ? [input, automatic] : [input]); }
          if (answer.trim().toLowerCase() === 'q') break;
          report = await runner.run({ ...options, profile: currentProfile(), resume: true, retryReviewed: false, advanceReviewedStep: !report.submissionAttempted });
        }
      } finally { terminal.close(); }
    }
    return report;
  };
  const url = parsed.get('--url');
  if (url) {
    const sessionDir = sessionFor(url);
    try {
      const report = await runWithReview({ ...common, url, sessionDir, resume: parsed.has('--resume') });
      console.log(JSON.stringify(report, null, 2));
      if (report.status === 'failed') process.exitCode = 1;
    } finally { await runner.close(); }
    return;
  }
  const queue = new AutoaplyQueueManager({ statePath: path.resolve(parsed.get('--queue') || path.join(root, 'queue.json')), candidateId, autoSkipOlderThanHours: parsed.has('--fresh-only'), maxAgeHours: number('--max-age-hours', 4) });
  try {
    if (parsed.has('--catalog')) {
      const catalogue: unknown = JSON.parse(readFileSync(parsed.get('--catalog')!, 'utf8'));
      if (!Array.isArray(catalogue)) throw new Error('Catalogue must be an array of jobs');
      const jobs = catalogue.map((value: Partial<Job>) => {
        if (!value || typeof value.url !== 'string' || typeof value.title !== 'string' || typeof value.company !== 'string') throw new Error('Catalogue jobs require url, title and company');
        return { externalJobId: value.id || value.externalId || value.url, title: value.title, company: value.company, jobUrl: value.url, postedAt: value.postedAt || '', location: value.location };
      });
      console.log(`Imported ${queue.enqueueBatch(jobs)} new jobs`);
    }
    if (parsed.has('--retry-reviewed')) queue.retryReviewed(parsed.get('--retry-reviewed')!);
    if (parsed.has('--run-queue')) {
      const results = await queue.runContinuousLoop({ run: options => runWithReview({ ...options, browserProfileDir: path.join(root, 'browser'), headless: common.headless, resume: parsed.has('--resume'), retryReviewed: options.url === queue.list().find(job => job.id === parsed.get('--retry-reviewed'))?.jobUrl, sessionDir: sessionFor(options.url) }) }, profile, { mode, submit: common.submit, dryRun: common.dryRun, maxJobs: number('--max-jobs', 10) });
      console.log(JSON.stringify(results));
    }
    console.log(JSON.stringify({ jobs: queue.list(), metrics: queue.getMetrics() }, null, 2));
  } finally { queue.close(); await runner.close(); }
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
