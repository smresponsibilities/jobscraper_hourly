import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { AutoaplyQueueManager } from './autoaply.js';
import { AutoApplyRunner, type AutoApplyOptions } from './runner.js';
import { CatalogueIntake, HOURLY_CATALOGUE_URL } from './intake.js';
import { preflightJob } from './preflight.js';
import { normalizeQuestion } from './answers.js';
import { canonicalRequisition, canonicalEmployerKey } from './identity.js';
import { loadProfile, validateProfile } from './profile.js';
import { ATS_MAIL_DOMAINS, mailboxFromEnvironment } from './mailbox.js';
import { startReviewDashboard } from './dashboard.js';
import { CredentialVault } from './vault.js';
import { MailClaims, mailNeedsRequisitionId, reconcileConfirmation } from './mail-evidence.js';
import { auditAcceptance, ACCEPTANCE_PROVIDERS } from './acceptance.js';
import { readApplicationStatus } from './status.js';
import { pruneReviewSnapshots } from './retention.js';
import type { AutoaplyJobItem, BotRunReport } from './types.js';

interface ParkedApplication {
  job: AutoaplyJobItem;
  runner?: AutoApplyRunner;
  report: BotRunReport;
  options: AutoApplyOptions;
  profileVersion: number;
  requested: boolean;
  reviewed?: boolean;
  stepOnly?: boolean;
}

export async function runApplicationWorker(config: {
  profileFile: string;
  stateDir: string;
  catalogueUrl?: string;
  pollSeconds?: number;
  dashboardPort?: number;
  submit?: boolean;
  once?: boolean;
  intakeOnly?: boolean;
  headless?: boolean;
  targetSuccesses?: number;
  approvedUrls?: string[];
  reviewSteps?: boolean;
  maxDailySubmissions?: number;
  signal: AbortSignal;
}): Promise<void> {
  if (config.targetSuccesses !== undefined && (!Number.isInteger(config.targetSuccesses) || config.targetSuccesses < 1 || !config.submit || config.intakeOnly)) throw new Error('A live acceptance target requires --submit and a positive target');
  if (config.maxDailySubmissions !== undefined && (!Number.isInteger(config.maxDailySubmissions) || config.maxDailySubmissions < 1)) throw new Error('Daily submission limit must be a positive integer');
  const dailyLimit = config.maxDailySubmissions ?? 50;
  const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const initialProfile = loadProfile(config.profileFile);
  if (config.approvedUrls && (!config.approvedUrls.length || config.approvedUrls.some(url => typeof url !== 'string' || !URL.canParse(url) || new URL(url).protocol !== 'https:'))) throw new Error('Approved roles require nonempty HTTPS URLs');
  const approved = config.approvedUrls ? new Set(config.approvedUrls) : undefined;
  const authorized = (job: AutoaplyJobItem) => !approved || approved.has(job.jobUrl);
  const candidateId = createHash('sha256').update(initialProfile.personal.email.trim().toLowerCase()).digest('hex').slice(0, 20);
  const readProfile = () => {
    const profile = loadProfile(config.profileFile);
    if (profile.personal.email.trim().toLowerCase() !== initialProfile.personal.email.trim().toLowerCase()) throw new Error('Worker profile belongs to a different candidate');
    return profile;
  };
  const root = path.resolve(config.stateDir);
  mkdirSync(root, { recursive: true });
  const legacy = path.join(root, 'queue.json');
  const queue = new AutoaplyQueueManager({ statePath: existsSync(legacy) ? legacy : path.join(root, 'queue.sqlite'), candidateId });
  if (!queue.acquireWorkerLock()) { queue.close(); throw new Error('Another application worker is active'); }
  try {
  const intake = new CatalogueIntake({ source: config.catalogueUrl || HOURLY_CATALOGUE_URL, stateDir: root, queue, profile: readProfile, approvedUrls: config.approvedUrls });
  const browsers = new Map<string, AutoApplyRunner>();
  const mailbox = mailboxFromEnvironment();
  const mailClaims = new MailClaims(path.join(root, 'mail-claims.sqlite'));
  const lastMailCheck = new Map<string, number>();
  const vault = config.intakeOnly ? undefined : new CredentialVault(path.join(root, 'vault'));
  const parked = new Map<string, ParkedApplication>();
  const tenantFor = (item: AutoaplyJobItem) => canonicalEmployerKey(item.jobUrl, item.externalJobId);
  const titleNeedsRequisition = (job: AutoaplyJobItem) => mailNeedsRequisitionId(job, queue.list());
  const tenantHash = (tenant: string) => createHash('sha256').update(tenant).digest('hex');
  const browserProfileFor = (job: AutoaplyJobItem) => path.join(root, 'browsers', createHash('sha256').update(tenantFor(job)).digest('hex').slice(0, 20));
  const forkFor = async (job: AutoaplyJobItem) => {
    const tenant = tenantFor(job);
    let browser = browsers.get(tenant);
    if (!browser) { browser = new AutoApplyRunner(); browsers.set(tenant, browser); }
    return browser.forkApplication(browserProfileFor(job), !!config.headless);
  };
  const claimVerification = (job: AutoaplyJobItem, messageId: string): boolean => {
    // Company-only OTP mail cannot distinguish two pending jobs at one tenant.
    if ([...parked.values()].some(entry => entry.job.id !== job.id && entry.report.submissionAttempted && tenantFor(entry.job) === tenantFor(job))) return false;
    return mailClaims.claim(messageId, job.canonicalKey || job.jobUrl);
  };
  const sessionFor = (job: AutoaplyJobItem) => path.join(root, 'applications', createHash('sha256').update(job.canonicalKey || job.jobUrl).digest('hex').slice(0, 20));
  try { pruneReviewSnapshots(root, queue.list(), sessionFor); } catch { console.error('Review retention cleanup failed'); }
  const optionsFor = (job: AutoaplyJobItem, description?: string): AutoApplyOptions => ({ jobId: job.id, url: job.jobUrl, profile: readProfile(), mode: 'stealth', headless: !!config.headless, keepOpen: !config.headless, submit: config.reviewSteps ? false : !!config.submit, maxSteps: config.reviewSteps ? 1 : undefined, advanceReviewedStep: !!config.reviewSteps, sessionDir: sessionFor(job), browserProfileDir: browserProfileFor(job), company: job.company, applicationCountry: 'India', applicationLocation: job.location, applicationBrief: description?.trim() ? { title: job.title, company: job.company, text: description } : undefined, mailbox, vault, reserveSubmission: () => queue.reserveTenantSubmission(day(), dailyLimit, tenantHash(tenantFor(job)), Date.now(), 5), onPhase: (phase, step) => queue.recordEvent(job.id, phase, step), claimMail: id => claimVerification(job, id), resume: true, preserveReviewedValues: false, reuseCompanyApplication: queue.list().some(previous => previous.id !== job.id && previous.status === 'applied' && !!previous.receipt && tenantFor(previous) === tenantFor(job)), requisition: canonicalRequisition(job.jobUrl, job.externalJobId) });
  const park = async (job: AutoaplyJobItem, runner: AutoApplyRunner, options: AutoApplyOptions, report: BotRunReport) => {
    await runner.parkReview(options, report);
    if (report.reviewKind === 'challenge' || report.logs?.includes('workday_reconcile:challenge')) queue.coolTenant(tenantHash(tenantFor(job)), Date.now() + 60 * 60 * 1000);
    queue.pauseForReview(job.id, report.reason);
    if (config.headless) {
      await runner.close().catch(() => {});
      parked.set(job.id, { job, runner: undefined, options, report, profileVersion: statSync(config.profileFile).mtimeMs, requested: false });
    } else {
      parked.set(job.id, { job, runner, options, report, profileVersion: statSync(config.profileFile).mtimeMs, requested: false });
      // Persisted reviews remain reopenable; bound browser memory during large intake.
      const live = [...parked.values()].filter(entry => entry.runner).sort((left, right) => Number(!!right.report.humanInterventionRequired) - Number(!!left.report.humanInterventionRequired));
      for (const entry of live.slice(0, Math.max(0, live.length - 3))) { await entry.runner!.close(); entry.runner = undefined; }
    }
  };
  // Recover durable review state without requeueing any ambiguous submission.
  for (const job of queue.list().filter(job => authorized(job) && job.status === 'paused_for_review')) {
    const options = optionsFor(job);
    const checkpoint = path.join(options.sessionDir!, 'checkpoint.json');
    const clickedAt = queue.submissionClickAt(job.id);
    if (!existsSync(checkpoint) && clickedAt) {
      mkdirSync(options.sessionDir!, { recursive: true });
      const report: BotRunReport = { mode: 'stealth', url: job.jobUrl, ats: canonicalRequisition(job.jobUrl, job.externalJobId)?.provider || 'unknown', startTime: clickedAt, fieldsFound: 0, fieldsFilled: 0, unmappedFields: 0, stepsTraversed: 0, status: 'paused_for_review', reason: 'A previous submit may have reached the employer. Verify its receipt before retrying.', reviewKind: 'receipt', submissionAttempted: true, humanInterventionRequired: true, submission: { phase: 'clicked', clickedAt, requests: [] }, actions: [], logs: [] };
      writeFileSync(checkpoint, JSON.stringify({ applicationUrl: job.jobUrl, currentUrl: job.jobUrl, report }, null, 2), { flag: 'wx', mode: 0o600 });
    }
    if (existsSync(checkpoint)) {
      const saved = JSON.parse(readFileSync(checkpoint, 'utf8')) as { report: BotRunReport };
      const submitted = saved.report.submissionAttempted || ['clicked', 'dispatched', 'confirmed'].includes(saved.report.submission?.phase || '') || !!clickedAt;
      if (submitted && !saved.report.receipt) {
        saved.report.submissionAttempted = true;
        const phase = saved.report.submission?.phase;
        saved.report.submission = { ...saved.report.submission, phase: phase && ['clicked', 'dispatched', 'confirmed'].includes(phase) ? phase : 'clicked', requests: saved.report.submission?.requests || [] };
        saved.report.reviewKind = 'receipt';
        saved.report.humanInterventionRequired = true;
        saved.report.automaticVerificationPending = false;
        const temporary = `${checkpoint}.${randomUUID()}.tmp`;
        writeFileSync(temporary, JSON.stringify(saved, null, 2), { mode: 0o600 });
        renameSync(temporary, checkpoint);
      }
      if (!submitted) saved.report.pendingFormRequests = false;
      const nextReconciliation = Date.parse(saved.report.reconcileAfter || '');
      const due = !Number.isFinite(nextReconciliation) || nextReconciliation <= Date.now();
      const nextPreflight = Date.parse(saved.report.preflightAfter || '');
      const preflightDue = !Number.isFinite(nextPreflight) || nextPreflight <= Date.now();
      parked.set(job.id, { job, report: saved.report, options, profileVersion: statSync(config.profileFile).mtimeMs, requested: !submitted && preflightDue || !saved.report.receipt && submitted && due && canonicalRequisition(job.jobUrl, job.externalJobId)?.provider === 'workday' });
    }
  }
  const dashboard = config.intakeOnly ? undefined : await startReviewDashboard({
    port: config.dashboardPort,
    cards: () => [...parked.values()].map(entry => ({ id: entry.job.id, employerKey: tenantFor(entry.job), company: entry.job.company, title: entry.job.title, reason: entry.report.reason, questions: [...new Set(entry.report.actions.filter(action => action.status === 'failed').map(action => action.question || action.selector))] })),
    jobs: () => queue.list().map(job => ({ id: job.id, employerKey: tenantFor(job), company: job.company, title: job.title, status: job.status })),
    open: async id => { const entry = parked.get(id)!; if (entry.runner) await entry.runner.openReview(); else entry.requested = true; },
    resume: id => { parked.get(id)!.requested = true; parked.get(id)!.reviewed = true; parked.get(id)!.stepOnly = false; },
    step: id => { parked.get(id)!.requested = true; parked.get(id)!.reviewed = true; parked.get(id)!.stepOnly = true; },
    answer: (id, question, value, scope = 'role') => {
      const entry = parked.get(id)!;
      const profile = readProfile();
      const identity = canonicalRequisition(entry.job.jobUrl, entry.job.externalJobId);
      const key = tenantFor(entry.job);
      const requisitionKey = scope === 'role' ? identity?.key || entry.job.jobUrl : undefined;
      profile.answers ||= [];
      const existing = profile.answers.find(answer => answer.scope === 'EMPLOYER_SCOPED' && answer.employerKey === key && answer.requisitionKey === requisitionKey && normalizeQuestion(answer.question) === normalizeQuestion(question));
      if (existing) existing.value = value;
      else profile.answers.push({ scope: 'EMPLOYER_SCOPED', employerKey: key, requisitionKey, question, value });
      validateProfile(profile);
      const temporary = `${config.profileFile}.${randomUUID()}.tmp`;
      writeFileSync(temporary, JSON.stringify(profile, null, 2), { mode: 0o600 });
      renameSync(temporary, config.profileFile);
      for (const review of parked.values()) if (review.job.id === id || scope === 'company' && tenantFor(review.job) === key && review.report.actions.some(action => normalizeQuestion(action.question || action.selector) === normalizeQuestion(question))) review.requested = true;
    },
  });
  if (dashboard) console.log(`Application review: ${dashboard.url}`);
  const workerState = path.join(root, 'worker.json');
  const startedAt = new Date().toISOString();
  const processStartedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
  let currentStatus = 'starting';
  let mailboxStatus: 'not_configured' | 'unchecked' | 'ok' | 'error' = mailbox ? 'unchecked' : 'not_configured';
  let mailboxCheckedAt: string | undefined;
  const checkConfirmation = async (...args: Parameters<typeof reconcileConfirmation>) => {
    if (!ATS_MAIL_DOMAINS[args[1].provider]) return undefined;
    try { const receipt = await reconcileConfirmation(...args); mailboxStatus = 'ok'; return receipt; }
    catch { mailboxStatus = 'error'; return undefined; }
    finally { mailboxCheckedAt = new Date().toISOString(); }
  };
  const writeState = (status: string) => {
    currentStatus = status;
    const temporary = `${workerState}.${randomUUID()}.tmp`;
    const heartbeatAt = new Date().toISOString();
    writeFileSync(temporary, JSON.stringify({ pid: process.pid, candidateId, dashboardUrl: dashboard?.url, startedAt, processStartedAt, heartbeatAt, observedAt: heartbeatAt, status, mailboxStatus, mailboxCheckedAt, model: 'disabled', metrics: queue.getMetrics(), parked: [...parked.keys()] }, null, 2), { mode: 0o600 });
    renameSync(temporary, workerState);
  };
  let intakeTask: Promise<void> | undefined;
  let polled = false;
  let nextPoll = 0;
  let finalStatus = 'stopped';
  const automaticReview = (entry: ParkedApplication) => entry.report.reviewKind === 'network' || ['authentication', 'receipt'].includes(entry.report.reviewKind || '') && (entry.report.humanInterventionRequired === false || entry.report.automaticVerificationPending === true);
  const blocksTenant = (entry: ParkedApplication) => !entry.report.receipt && (!!entry.report.submissionAttempted || ['clicked', 'dispatched', 'confirmed'].includes(entry.report.submission?.phase || '') || !!entry.report.automaticVerificationPending && Date.now() - Date.parse(entry.report.startTime) < 15 * 60 * 1000);
  // A restricted run must still honor ambiguous submissions outside its job list.
  const outsideScopeBlockedTenants = new Set<string>();
  for (const job of queue.list().filter(job => !authorized(job) && job.status === 'paused_for_review')) {
    if (queue.submissionClickAt(job.id)) { outsideScopeBlockedTenants.add(tenantFor(job)); continue; }
    const checkpoint = path.join(sessionFor(job), 'checkpoint.json');
    if (!existsSync(checkpoint)) continue;
    try {
      const report = (JSON.parse(readFileSync(checkpoint, 'utf8')) as { report: BotRunReport }).report;
      if (!report.receipt && (report.submissionAttempted || ['clicked', 'dispatched', 'confirmed'].includes(report.submission?.phase || '') || report.automaticVerificationPending && Date.now() - Date.parse(report.startTime) < 15 * 60 * 1000)) outsideScopeBlockedTenants.add(tenantFor(job));
    } catch { outsideScopeBlockedTenants.add(tenantFor(job)); }
  }
  writeState(currentStatus);
  const heartbeat = setInterval(() => {
    try { writeState(currentStatus); }
    catch { console.error('Worker heartbeat failed'); }
  }, 15000);
  heartbeat.unref();
  try {
    while (!config.signal.aborted) {
      if (!intakeTask && Date.now() >= nextPoll && (!config.once || !polled)) {
        intakeTask = intake.poll(config.signal).then(result => { polled = true; console.log(JSON.stringify({ event: 'catalogue_intake', ...result })); }).catch(() => { if (!config.signal.aborted) console.error('Catalogue intake failed; retry scheduled'); }).finally(() => { polled = true; intakeTask = undefined; nextPoll = Date.now() + (config.pollSeconds || 900) * 1000; });
      }
      if (config.intakeOnly) {
        await intakeTask;
        writeState('intake_complete');
        if (config.once) break;
        await delay(1000, undefined, { signal: config.signal }).catch(() => {});
        continue;
      }
      const coolingTenants = queue.coolingTenants(Date.now());
      if (mailbox && ![...parked.values()].some(entry => entry.requested)) for (const job of queue.list().filter(job => job.status === 'applied' && !job.receipt?.existing && !job.receipt?.emailConfirmationId && Date.now() - (lastMailCheck.get(job.id) || 0) > 30000).slice(0, 3)) {
        lastMailCheck.set(job.id, Date.now());
        const checkpoint = path.join(sessionFor(job), 'checkpoint.json');
        if (!existsSync(checkpoint)) continue;
        const saved = JSON.parse(readFileSync(checkpoint, 'utf8')) as { report: BotRunReport };
        const identity = canonicalRequisition(job.jobUrl, job.externalJobId);
        const receipt = await checkConfirmation(mailbox, { provider: identity?.provider || saved.report.ats, recipient: initialProfile.personal.email, applicationUrl: job.jobUrl, since: new Date(saved.report.startTime), title: job.title, company: job.company, requisitionId: identity?.jobId, requireRequisitionId: titleNeedsRequisition(job), claim: id => mailClaims.claim(id, job.canonicalKey || job.jobUrl) }, sessionFor(job));
        if (receipt) queue.markApplied(job.id, { ...receipt, domEvidenceDir: job.receipt?.evidenceDir });
      }
      for (const entry of [...parked.values()]) {
        if (outsideScopeBlockedTenants.has(tenantFor(entry.job))) continue;
        if (automaticReview(entry) && Date.now() - Date.parse(entry.report.startTime) > 15 * 60 * 1000) {
          entry.report.humanInterventionRequired = true;
          const network = entry.report.reviewKind === 'network';
          if (network) entry.report.reviewKind = 'answers';
          entry.report.reason = `Automatic ${network ? 'request wait' : 'verification'} timed out; saved for review without retrying Submit`;
          if (entry.runner) await entry.runner.parkReview(entry.options, entry.report);
        }
        if (mailbox && entry.report.submissionAttempted && !entry.report.receipt && Date.now() - (lastMailCheck.get(entry.job.id) || 0) > 30000) {
          lastMailCheck.set(entry.job.id, Date.now());
          const identity = canonicalRequisition(entry.job.jobUrl, entry.job.externalJobId);
          const receipt = await checkConfirmation(mailbox, { provider: identity?.provider || entry.report.ats, applicationUrl: entry.job.jobUrl, recipient: initialProfile.personal.email, since: new Date(entry.report.startTime), company: entry.job.company, title: entry.job.title, requisitionId: identity?.jobId, requireRequisitionId: titleNeedsRequisition(entry.job), claim: id => mailClaims.claim(id, entry.job.canonicalKey || entry.job.jobUrl) }, entry.options.sessionDir!);
          if (receipt) { queue.markApplied(entry.job.id, receipt); parked.delete(entry.job.id); await entry.runner?.close(); continue; }
        }
        if (!entry.reviewed && coolingTenants.has(tenantHash(tenantFor(entry.job)))) continue;
        const profileChanged = statSync(config.profileFile).mtimeMs > entry.profileVersion;
        const nextPreflight = Date.parse(entry.report.preflightAfter || '');
        const preflightWaiting = Number.isFinite(nextPreflight) && nextPreflight > Date.now();
        const preflightDue = Number.isFinite(nextPreflight) && !preflightWaiting;
        if (!blocksTenant(entry) && preflightWaiting) continue;
        const nextReconciliation = Date.parse(entry.report.reconcileAfter || '');
        const reconciliationDue = Number.isFinite(nextReconciliation) && nextReconciliation <= Date.now();
        const reconcileWorkday = (entry.requested || reconciliationDue) && blocksTenant(entry) && canonicalRequisition(entry.job.jobUrl, entry.job.externalJobId)?.provider === 'workday';
        if (!entry.runner && !entry.reviewed && blocksTenant(entry) && !reconcileWorkday) continue;
        const ready = entry.requested || reconcileWorkday || preflightDue || (entry.report.reason === 'Daily submission limit reached' && queue.submissionCount(day()) < dailyLimit) || (entry.report.reason === 'Company hourly submission limit reached' && queue.tenantSubmissionCount(tenantHash(tenantFor(entry.job)), Date.now() - 3600000) < 5) || (entry.report.reviewKind === 'answers' && profileChanged) || (entry.runner && !blocksTenant(entry) && await entry.runner.reviewReady(entry.report, entry.options).catch(() => false));
        if (!ready) continue;
        const companyOwner = [...parked.values()].filter(other => tenantFor(other.job) === tenantFor(entry.job) && blocksTenant(other)).sort((a, b) => Number(!!b.report.submissionAttempted) - Number(!!a.report.submissionAttempted))[0];
        if (companyOwner && companyOwner.job.id !== entry.job.id) continue;
        if (!entry.runner && automaticReview(entry) && [...parked.values()].filter(other => other.runner && automaticReview(other)).length >= 3) continue;
        if (!blocksTenant(entry)) {
          const preflight = await preflightJob({ externalJobId: entry.job.externalJobId, title: entry.job.title, company: entry.job.company, jobUrl: entry.job.jobUrl, location: entry.job.location }, readProfile(), { signal: config.signal });
          if (preflight.status === 'skipped') {
            queue.skip(entry.job.id, preflight.reason);
            parked.delete(entry.job.id);
            await entry.runner?.close();
            continue;
          }
          if (preflight.status === 'retry') {
            entry.requested = false;
            entry.profileVersion = statSync(config.profileFile).mtimeMs;
            entry.report.reviewKind = 'answers';
            entry.report.reason = 'Source verification unavailable; retry scheduled';
            entry.report.preflightAfter = new Date(Date.now() + 5 * 60 * 1000).toISOString();
            const checkpoint = path.join(entry.options.sessionDir!, 'checkpoint.json');
            const saved = JSON.parse(readFileSync(checkpoint, 'utf8'));
            saved.report = entry.report;
            const temporary = `${checkpoint}.${randomUUID()}.tmp`;
            writeFileSync(temporary, JSON.stringify(saved, null, 2), { mode: 0o600 });
            renameSync(temporary, checkpoint);
            queue.pauseForReview(entry.job.id, entry.report.reason);
            continue;
          }
          delete entry.report.preflightAfter;
          if (preflight.description?.trim()) entry.options.applicationBrief = { title: entry.job.title, company: entry.job.company, text: preflight.description };
        }
        if (reconcileWorkday && !entry.reviewed) {
          entry.report.reconcileAfter = new Date(Date.now() + 60 * 60 * 1000).toISOString();
          const checkpoint = path.join(entry.options.sessionDir!, 'checkpoint.json');
          const saved = JSON.parse(readFileSync(checkpoint, 'utf8'));
          saved.report = entry.report;
          const temporary = `${checkpoint}.${randomUUID()}.tmp`;
          writeFileSync(temporary, JSON.stringify(saved, null, 2), { mode: 0o600 });
          renameSync(temporary, checkpoint);
        }
        entry.requested = false;
        if (!entry.runner) entry.runner = await forkFor(entry.job);
        const stepOnly = entry.stepOnly ?? !!config.reviewSteps;
        entry.stepOnly = undefined;
        entry.options = { ...entry.options, profile: readProfile(), retryReviewed: false, resume: true, preserveReviewedValues: !!entry.reviewed, maxSteps: stepOnly ? 1 : undefined, advanceReviewedStep: stepOnly, submit: stepOnly ? false : !!config.submit };
        if (entry.reviewed) entry.report.humanInterventionRequired = true;
        const report = await entry.runner.run(entry.options);
        if (report.status === 'submitted' && report.receipt) {
          queue.markApplied(entry.job.id, report.receipt);
          parked.delete(entry.job.id);
          await entry.runner.close();
        } else await park(entry.job, entry.runner, entry.options, report);
      }
      let acceptance: ReturnType<typeof auditAcceptance> | undefined;
      if (config.targetSuccesses) {
        acceptance = auditAcceptance(queue.list(), initialProfile.personal.email, vault, config.targetSuccesses);
        const target = path.join(root, 'production-acceptance.json');
        const temporary = `${target}.${randomUUID()}.tmp`;
        writeFileSync(temporary, JSON.stringify({ auditedAt: new Date().toISOString(), candidateId, ...acceptance }, null, 2), { mode: 0o600 }); renameSync(temporary, target);
        if (acceptance.complete) { finalStatus = 'acceptance_complete'; break; }
      }
      const supported = (job: AutoaplyJobItem) => authorized(job) && ACCEPTANCE_PROVIDERS.includes(canonicalRequisition(job.jobUrl, job.externalJobId)?.provider as typeof ACCEPTANCE_PROVIDERS[number]);
      const blockedTenants = new Set([...outsideScopeBlockedTenants, ...[...parked.values()].filter(blocksTenant).map(entry => tenantFor(entry.job))]);
      for (const job of queue.getPendingQueue()) if (coolingTenants.has(tenantHash(tenantFor(job)))) blockedTenants.add(tenantFor(job));
      if (config.submit && !config.reviewSteps) {
        const limited = queue.limitedTenants(Date.now() - 3600000, 5);
        for (const job of queue.getPendingQueue()) if (limited.has(tenantHash(tenantFor(job)))) blockedTenants.add(tenantFor(job));
      }
      const missingAvailable = acceptance ? new Set(queue.getPendingQueue().filter(job => supported(job) && !blockedTenants.has(tenantFor(job))).map(job => canonicalRequisition(job.jobUrl, job.externalJobId)!.provider).filter(provider => !acceptance!.byProvider[provider])) : undefined;
      if (config.submit && !config.reviewSteps && queue.submissionCount(day()) >= dailyLimit) {
        writeState('daily_limit_reached');
        if (config.once && polled && !intakeTask) break;
        await delay(1000, undefined, { signal: config.signal }).catch(() => {});
        continue;
      }
      if ([...parked.values()].filter(entry => entry.runner && automaticReview(entry)).length >= 3) { writeState('waiting_for_verification'); await delay(500, undefined, { signal: config.signal }).catch(() => {}); continue; }
      writeState('running');
      const result = await queue.processNext({ run: async options => {
        const job = queue.list().find(job => job.status === 'applying' && job.jobUrl === options.url);
        if (!job) throw new Error('Claimed application disappeared');
        const preflight = await preflightJob({ externalJobId: job.externalJobId, title: job.title, company: job.company, jobUrl: job.jobUrl, location: job.location }, readProfile(), { signal: config.signal });
        if (preflight.status !== 'eligible') return { status: preflight.status === 'skipped' ? 'skipped' : 'retry', reason: preflight.reason, fieldsFilled: 0, unmappedFields: 0 };
        const runner = await forkFor(job);
        const runOptions = optionsFor(job, preflight.description);
        const report = await runner.run(runOptions);
        if (report.status === 'paused_for_review') await park(job, runner, runOptions, report);
        else await runner.close();
        return report;
      } }, readProfile(), 'stealth', false, !!config.submit, job => authorized(job) && !blockedTenants.has(tenantFor(job)) && (!acceptance || supported(job) && (!missingAvailable?.size || missingAvailable.has(canonicalRequisition(job.jobUrl, job.externalJobId)!.provider))));
      writeState('running');
      const pendingTenants = new Set(queue.getPendingQueue().filter(authorized).map(tenantFor));
      for (const [tenant, browser] of browsers) {
        if (!pendingTenants.has(tenant) && ![...parked.values()].some(entry => entry.runner && tenantFor(entry.job) === tenant)) { await browser.close(); browsers.delete(tenant); }
      }
      if (config.submit && result.processed && ['applied', 'paused_for_review'].includes(result.status || '')) await delay(15000 + Math.floor(Math.random() * 30001), undefined, { signal: config.signal }).catch(() => {});
      if (config.once && polled && !intakeTask && !result.processed && ![...parked.values()].some(entry => automaticReview(entry) && !outsideScopeBlockedTenants.has(tenantFor(entry.job))) && !queue.getPendingQueue().some(job => authorized(job) && !blockedTenants.has(tenantFor(job)) && (!acceptance || supported(job)))) break;
      if (!result.processed) await delay(500, undefined, { signal: config.signal }).catch(() => {});
    }
  } finally {
    clearInterval(heartbeat);
    if (intakeTask) await intakeTask;
    for (const entry of parked.values()) if (entry.runner) await entry.runner.parkReview(entry.options, entry.report).catch(() => {});
    writeState(finalStatus);
    await dashboard?.close();
    await mailbox?.close();
    mailClaims.close();
    for (const browser of browsers.values()) await browser.close();
  }
  } finally { queue.close(); }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const key = args[index]!;
    if (['--once', '--intake-only', '--submit', '--headless', '--review-steps', '--status'].includes(key)) flags.add(key);
    else if (['--profile', '--state', '--catalog-url', '--poll-seconds', '--dashboard-port', '--target-successes', '--approved-jobs', '--max-daily-submissions', '--explain'].includes(key) && args[index + 1] && !args[index + 1]!.startsWith('--')) values.set(key, args[++index]!);
    else throw new Error(`Invalid worker argument: ${key}`);
  }
  if (flags.has('--status') || values.has('--explain')) {
    const root = path.resolve(values.get('--state') || (values.get('--profile') ? path.dirname(path.resolve(values.get('--profile')!)) : 'state/autoapply/portal-review'));
    console.log(JSON.stringify(readApplicationStatus(root, values.get('--explain')), null, 2));
    return;
  }
  try { process.loadEnvFile(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (!values.get('--profile')) throw new Error('Worker requires --profile <candidate.json>');
  const numeric = (key: string, fallback?: number) => {
    if (!values.has(key)) return fallback;
    const value = Number(values.get(key));
    if (!Number.isInteger(value) || value < 1 || (key === '--dashboard-port' && value > 65535)) throw new Error(`Invalid ${key}`);
    return value;
  };
  const controller = new AbortController();
  const proposal = values.has('--approved-jobs') ? JSON.parse(readFileSync(values.get('--approved-jobs')!, 'utf8')) : undefined;
  if (proposal && (!Array.isArray(proposal.jobs) || !proposal.jobs.length)) throw new Error('Approved proposal requires roles');
  const approvedUrls = proposal?.jobs.map((job: { url?: unknown }) => job?.url) as string[] | undefined;
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  await runApplicationWorker({ profileFile: path.resolve(values.get('--profile')!), stateDir: path.resolve(values.get('--state') || path.dirname(path.resolve(values.get('--profile')!))), catalogueUrl: values.get('--catalog-url'), pollSeconds: numeric('--poll-seconds', 900), dashboardPort: numeric('--dashboard-port'), once: flags.has('--once'), intakeOnly: flags.has('--intake-only'), submit: flags.has('--submit'), headless: flags.has('--headless'), targetSuccesses: numeric('--target-successes'), maxDailySubmissions: numeric('--max-daily-submissions', 50), approvedUrls, reviewSteps: flags.has('--review-steps'), signal: controller.signal });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(() => { console.error('Application worker failed; check its configuration and state'); process.exitCode = 1; });








