import type { BotRunReport } from './types.js';
import { canonicalRequisition, canonicalEmployerKey } from './identity.js';
import { ApplicationStore } from './store.js';
import { applicationFit } from './fit.js';
/**
 * Autoaply (autoaply.co) Continuous Queue & Multi-Board Dispatch Engine.
 * Reverse-engineered from Autoaply's 4-hour fresh posting auto-application loop,
 * credit-managed queue, multi-board aggregation, and candidate feedback loop.
 */

import type {
  AutoaplyApplicationStatus,
  AutoaplyFeedbackType,
  AutoaplyJobBoard,
  AutoaplyJobItem,
  AutoaplyQueueConfig,
  AutoaplyQueueMetrics,
  CandidateExtendedProfile,
  RunnerMode,
} from './types.js';

export const DEFAULT_AUTOAPLY_CONFIG: AutoaplyQueueConfig = {
  maxAgeHours: 4, // Autoaply core 4-hour high-visibility application window
  infiniteMode: true, // Jobscraper-next runs unmetered infinite auto-apply by default
  maxDailyCredits: Infinity,
  remainingCredits: Infinity, // Infinite unmetered applications
  autoSkipOlderThanHours: false,
};

/**
 * Classifies the origin job board from URL.
 */
export function classifyJobBoard(url: string): AutoaplyJobBoard {
  const lower = url.toLowerCase();
  if (lower.includes('linkedin.com')) return 'linkedin';
  if (lower.includes('indeed.com')) return 'indeed';
  if (lower.includes('ziprecruiter.com')) return 'ziprecruiter';
  if (lower.includes('glassdoor.com')) return 'glassdoor';
  if (lower.includes('monster.com')) return 'monster';
  if (lower.includes('dice.com')) return 'dice';
  if (lower.includes('wellfound.com') || lower.includes('angel.co')) return 'wellfound';
  return 'direct_ats';
}

/**
 * Calculates the age of a posting in hours.
 */
export function getPostingAgeHours(
  postedAt: string | Date,
  referenceDate: Date = new Date()
): number {
  const postDate = typeof postedAt === 'string' ? new Date(postedAt) : postedAt;
  const diffMs = referenceDate.getTime() - postDate.getTime();
  return Number.isFinite(diffMs) && diffMs >= 0 ? diffMs / (1000 * 60 * 60) : Infinity;
}

/**
 * Checks whether a job posting falls within the target freshness window (default: 4 hours).
 */
export function isFreshPosting(
  postedAt: string | Date,
  maxAgeHours = 4,
  referenceDate: Date = new Date()
): boolean {
  const age = getPostingAgeHours(postedAt, referenceDate);
  return age <= maxAgeHours;
}

/**
 * Continuous Application Queue & Credit Manager.
 */
export class AutoaplyQueueManager {
  private config: AutoaplyQueueConfig;
  private queue: Map<string, AutoaplyJobItem> = new Map();
  private store?: ApplicationStore;
  private dryRunVisited = new Set<string>();
  private activeEmployer?: string;
  private lastProvider?: string;

  constructor(customConfig: Partial<AutoaplyQueueConfig> = {}) {
    this.config = { ...DEFAULT_AUTOAPLY_CONFIG, ...customConfig };
    if (this.config.statePath) {
      this.store = new ApplicationStore(this.config.statePath, this.config.candidateId || 'default');
      this.config.remainingCredits = this.store.getMetadata('remainingCredits') ?? this.config.remainingCredits;
      this.lastProvider = this.store.getLastProvider();
    }
  }

  close(): void {
    this.store?.close();
    this.store = undefined;
  }

  acquireWorkerLock(): boolean {
    if (!this.store) throw new Error('Worker lock requires durable storage');
    return this.store.acquireWorkerLock();
  }

  submissionCount(day: string): number {
    if (!this.store) throw new Error('Submission limit requires durable storage');
    return this.store.submissionCount(day);
  }

  reserveSubmission(day: string, limit: number): boolean {
    if (!this.store) throw new Error('Submission limit requires durable storage');
    return this.store.reserveSubmission(day, limit);
  }

  tenantSubmissionCount(tenantHash: string, since: number): number {
    if (!this.store) throw new Error('Tenant limit requires durable storage');
    return this.store.tenantSubmissionCount(tenantHash, since);
  }

  limitedTenants(since: number, limit: number): Set<string> {
    if (!this.store) throw new Error('Tenant limit requires durable storage');
    return this.store.limitedTenants(since, limit);
  }

  coolTenant(tenantHash: string, until: number): void {
    if (!this.store) throw new Error('Tenant cooldown requires durable storage');
    this.store.coolTenant(tenantHash, until);
  }

  coolingTenants(now: number): Set<string> {
    if (!this.store) throw new Error('Tenant cooldown requires durable storage');
    return this.store.coolingTenants(now);
  }

  reserveTenantSubmission(day: string, dailyLimit: number, tenantHash: string, now: number, tenantLimit: number): 'ok' | 'daily' | 'tenant' {
    if (!this.store) throw new Error('Tenant limit requires durable storage');
    return this.store.reserveTenantSubmission(day, dailyLimit, tenantHash, now, tenantLimit);
  }

  recordEvent(jobId: string, phase: string, stepIndex?: number): void {
    this.store?.recordEvent(jobId, phase, undefined, stepIndex);
  }

  submissionClickAt(jobId: string): string | undefined {
    return this.store?.submissionClickAt(jobId);
  }

  recordFitProbe(jobId: string, checkedAt: string, description?: string, skipReason?: string): boolean {
    if (this.store) return this.store.recordFitProbe(jobId, checkedAt, description, skipReason);
    const job = this.queue.get(jobId);
    if (job?.status !== 'queued' || job.description?.trim()) return false;
    job.fitCheckedAt = checkedAt;
    if (description?.trim()) job.description = description;
    if (skipReason) { job.status = 'skipped'; job.error = skipReason; }
    return true;
  }

  private persist(job?: AutoaplyJobItem): void {
    if (job) {
      const reason = job.error || '';
      if (job.status === 'applied') job.reasonCode = job.receipt && !job.receipt.existing ? 'SUBMITTED_VERIFIED' : 'UNKNOWN';
      else if (job.status === 'skipped') job.reasonCode = /closed/i.test(reason) ? 'SKIPPED_CLOSED' : /ineligible_jd_experience/.test(reason) ? 'SKIPPED_YOE' : 'UNKNOWN';
      else if (job.status === 'paused_for_review') job.reasonCode = /captcha|challenge/i.test(reason) ? 'PARKED_CAPTCHA' : /auth|login|sign.in|verification/i.test(reason) ? 'PARKED_AUTH' : /submit clicked|previous submit|receipt|dispatch/i.test(reason) ? 'AMBIGUOUS_DISPATCH' : /answer|field|validation/i.test(reason) ? 'PARKED_MISSING_FACT' : 'UNKNOWN';
      else if (job.status === 'queued' && job.nextAttemptAt) job.reasonCode = 'TRANSIENT_RETRY';
      else if (job.status === 'failed') job.reasonCode = 'UNKNOWN';
      else delete job.reasonCode;
      this.store?.save(job);
    }
    if (Number.isFinite(this.config.remainingCredits)) this.store?.setMetadata('remainingCredits', this.config.remainingCredits!);
  }

  list(status?: AutoaplyJobItem['status']): AutoaplyJobItem[] {
    if (this.store) for (const row of this.store.list(status)) {
      const cached = this.queue.get(row.id);
      this.queue.set(row.id, cached ? Object.assign(cached, row) : row);
    }
    const all = Array.from(this.queue.values());
    return status ? all.filter(j => j.status === status) : all;
  }

  retryReviewed(id: string): void {
    this.list();
    const job = this.queue.get(id);
    if (!job || !['paused_for_review', 'failed'].includes(job.status)) throw new Error('Only failed or reviewed jobs can be retried');
    job.status = 'queued';
    delete job.error;
    this.persist(job);
  }

  private identity(url: string): string {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Queue jobs require an HTTP(S) URL');
    for (const key of [...parsed.searchParams.keys()]) if (/^utm_|^(source|ref|referrer|gh_src)$/i.test(key)) parsed.searchParams.delete(key);
    const host = parsed.hostname.toLowerCase();
    if (host === 'jobs.ashbyhq.com') parsed.pathname = parsed.pathname.replace(/\/application\/?$/, '');
    if (host === 'jobs.lever.co') parsed.pathname = parsed.pathname.replace(/\/apply\/?$/, '');
    if (host.endsWith('.myworkdayjobs.com') && parsed.pathname.includes('/job/')) parsed.pathname = parsed.pathname.replace(/\/apply(?:\/.*)?$/, '');
    if (host === 'apply.workable.com') {
      const id = /\/j\/([a-f0-9]+)(?:\/apply)?\/?$/i.exec(parsed.pathname)?.[1];
      if (id) parsed.pathname = `/j/${id.toUpperCase()}`;
    }
    if (host.endsWith('.greenhouse.io')) {
      const id = /\/jobs\/(\d+)\/?$/.exec(parsed.pathname)?.[1];
      if (id && parsed.searchParams.get('gh_jid') === id) parsed.searchParams.delete('gh_jid');
    }
    parsed.hash = '';
    parsed.searchParams.sort();
    return parsed.href;
  }

  /**
   * Adds a single job to the queue.
   */
  enqueue(
    job: Omit<AutoaplyJobItem, 'id' | 'status' | 'jobBoard'> & { id?: string; jobBoard?: AutoaplyJobBoard }
  ): AutoaplyJobItem {
    const identity = this.identity(job.jobUrl);
    const canonicalKey = canonicalRequisition(job.jobUrl, job.externalJobId)?.key;
    const existing = this.list().find(item => this.identity(item.jobUrl) === identity || (canonicalKey && (item.canonicalKey || canonicalRequisition(item.jobUrl, item.externalJobId)?.key) === canonicalKey));
    if (existing) return existing;
    const id = job.id || `autoaply_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const board = job.jobBoard || classifyJobBoard(job.jobUrl);

    const item: AutoaplyJobItem = {
      canonicalKey,
      id,
      externalJobId: job.externalJobId || id,
      title: job.title,
      description: job.description,
      company: job.company,
      jobUrl: job.jobUrl,
      jobBoard: board,
      location: job.location,
      postedAt: job.postedAt,
      status: 'queued',
      feedbackType: job.feedbackType,
    };

    if (this.queue.has(id)) throw new Error(`Duplicate queue ID: ${id}`);
    const stored = this.store?.insert(item, identity) || item;
    this.queue.set(stored.id, stored);
    return stored;
  }

  /**
   * Batch enqueues multiple job listings. Returns count of newly queued items.
   */
  enqueueBatch(
    jobs: Array<Omit<AutoaplyJobItem, 'id' | 'status' | 'jobBoard'> & { id?: string; jobBoard?: AutoaplyJobBoard }>
  ): number {
    let count = 0;
    for (const job of jobs) {
      const before = this.queue.size;
      this.enqueue(job);
      count += this.queue.size - before;
    }
    return count;
  }

  /**
   * Returns all pending queued jobs, sorted by freshness (<4h first).
   */
  getPendingQueue(filterFreshOnly = false, refDate = new Date()): AutoaplyJobItem[] {
    const pending = this.list().filter(j => j.status === 'queued' && (!j.nextAttemptAt || Date.parse(j.nextAttemptAt) <= refDate.getTime()));

    const filtered = filterFreshOnly
      ? pending.filter(j => isFreshPosting(j.postedAt, this.config.maxAgeHours, refDate))
      : pending;

    // Sort freshest first
    return filtered.sort((a, b) => {
      const timeA = new Date(a.postedAt).getTime();
      const timeB = new Date(b.postedAt).getTime();
      return timeB - timeA;
    });
  }

  /**
   * Records candidate feedback (e.g. thumbs up/down, interview requested).
   */
  private getItem(jobId: string): AutoaplyJobItem | undefined {
    let item = this.queue.get(jobId);
    if (!item && this.store) {
      item = (this.store as any).get?.(jobId);
      if (item) this.queue.set(jobId, item);
    }
    return item;
  }

  /**
   * Records candidate feedback (e.g. thumbs up/down, interview requested).
   */
  recordFeedback(jobId: string, feedback: AutoaplyFeedbackType): boolean {
    const item = this.getItem(jobId);
    if (!item) return false;

    item.feedbackType = feedback;
    if (feedback === 'thumbs_down') {
      item.status = 'skipped';
    }
    this.persist(item);
    return true;
  }

  /**
   * Explicitly skips a job in the queue (no credit deducted).
   */
  skip(jobId: string, reason?: string): boolean {
    if (reason) {
      const item = this.getItem(jobId);
      if (!item || item.status === 'applied') return false;
      item.status = 'skipped';
      item.error = reason;
      this.persist(item);
      return true;
    }
    return this.recordFeedback(jobId, 'thumbs_down');
  }

  reopenAtSource(jobId: string): boolean {
    const item = this.getItem(jobId);
    if (!item || item.status !== 'skipped' || item.receipt || !['closed_in_catalogue', 'closed_at_source', 'stale_catalogue_entry', 'experience_recheck_pending', 'unconfirmed_india_remote', 'requisition_identity_mismatch'].includes(item.error || '')) return false;
    item.status = 'queued';
    delete item.error;
    this.persist(item);
    return true;
  }

  /**
   * Marks a job as actively applying.
   */
  markApplying(jobId: string): boolean {
    const item = this.getItem(jobId);
    if (!item || item.status !== 'queued') return false;
    if (this.store && !this.store.claim(jobId)) return false;
    item.status = 'applying';
    this.persist(item);
    return true;
  }

  /**
   * Marks a job as successfully applied, deducting 1 application credit if metered.
   */
  markApplied(jobId: string, receipt?: BotRunReport['receipt']): boolean {
    const item = this.getItem(jobId);
    if (!item) return false;
    if (item.status === 'applied') {
      if (receipt?.emailConfirmationId) { item.receipt = { ...item.receipt, ...receipt }; this.persist(item); }
      return true;
    }

    if (receipt) item.receipt = receipt;
    item.status = 'applied';
    item.appliedAt = new Date().toISOString();
    if (!this.config.infiniteMode && typeof this.config.remainingCredits === 'number') {
      this.config.remainingCredits = Math.max(0, this.config.remainingCredits - 1);
    }
    this.persist(item);
    return true;
  }

  /**
   * Marks a job application as failed with an error reason.
   */
  markFailed(jobId: string, error: string): boolean {
    const item = this.getItem(jobId);
    if (!item || item.status === 'applied') return false;

    item.status = 'failed';
    item.error = error;
    this.persist(item);
    return true;
  }

  pauseForReview(jobId: string, reason?: string): boolean {
    const item = this.getItem(jobId);
    if (!item || item.status === 'applied') return false;
    item.status = 'paused_for_review';
    if (reason) item.error = reason;
    this.persist(item);
    return true;
  }

  /**
   * Returns true if candidate has credits remaining to apply or is in infinite mode.
   */
  hasCredits(): boolean {
    if (this.config.infiniteMode) return true;
    return (this.config.remainingCredits ?? Infinity) > 0;
  }

  /**
   * Returns current credits remaining (Infinity in unmetered mode).
   */
  getRemainingCredits(): number {
    return this.config.infiniteMode ? Infinity : (this.config.remainingCredits ?? Infinity);
  }

  /**
   * Adds credits to the account (e.g. on plan upgrade).
   */
  addCredits(credits: number): number {
    if (this.config.infiniteMode) return Infinity;
    this.config.remainingCredits = (this.config.remainingCredits ?? 0) + credits;
    this.persist();
    return this.config.remainingCredits;
  }

  /**
   * Summarizes queue performance and interview metrics.
   */
  getMetrics(): AutoaplyQueueMetrics {
    const items = this.list();
    return {
      totalQueued: items.filter(i => i.status === 'queued').length,
      totalApplied: items.filter(i => i.status === 'applied').length,
      totalSkipped: items.filter(i => i.status === 'skipped').length,
      totalFailed: items.filter(i => i.status === 'failed').length,
      interviewsRequested: items.filter(i => i.feedbackType === 'interview_requested').length,
      creditsRemaining: this.config.infiniteMode ? Infinity : (this.config.remainingCredits ?? Infinity),
      infiniteMode: Boolean(this.config.infiniteMode),
    };
  }

  /**
   * Processes the next available job in the queue using the provided runner.
   */
  async processNext(
    runner: {
      run: (options: {
        url: string;
        profile: CandidateExtendedProfile;
        mode?: RunnerMode;
        dryRun?: boolean;
        headless?: boolean;
        submit?: boolean;
      }) => Promise<{ status: string; fieldsFilled: number; unmappedFields: number; receipt?: BotRunReport['receipt']; reason?: string }>;
    },
    profile: CandidateExtendedProfile,
    mode: RunnerMode = 'stealth',
    dryRun = false,
    submit = false,
    eligible: (job: AutoaplyJobItem) => boolean = () => true
  ): Promise<{ processed: boolean; job?: AutoaplyJobItem; status?: string; message: string }> {
    if (!this.hasCredits()) {
      return {
        processed: false,
        message: 'Batch quota reached. Infinite mode is active by default for unlimited applications.',
      };
    }

    if (this.config.autoSkipOlderThanHours && !dryRun) {
      for (const job of this.getPendingQueue()) if (!isFreshPosting(job.postedAt, this.config.maxAgeHours)) this.skip(job.id);
    }
    const nextJobs = this.getPendingQueue(!!this.config.autoSkipOlderThanHours).filter(job => eligible(job) && (!dryRun || !this.dryRunVisited.has(job.id)));
    const provider = (job: AutoaplyJobItem) => canonicalRequisition(job.jobUrl, job.externalJobId)?.provider || 'unknown';
    const providers = [...new Set(['greenhouse', 'lever', 'ashby', 'workable', ...nextJobs.map(provider).sort()])];
    const after = this.lastProvider ? providers.indexOf(this.lastProvider) + 1 : 0;
    const rotation = [...providers.slice(after), ...providers.slice(0, after)];
    const now = Date.now();
    const scores = new Map(nextJobs.map(job => [job.id, applicationFit(job, profile, now)]));
    nextJobs.sort((a, b) => rotation.indexOf(provider(a)) - rotation.indexOf(provider(b)) || scores.get(b.id)! - scores.get(a.id)!);
    // Preserve the warm company batch; rotate providers when the batch ends.
    if (this.activeEmployer) nextJobs.sort((a, b) => Number(canonicalEmployerKey(b.jobUrl, b.externalJobId) === this.activeEmployer) - Number(canonicalEmployerKey(a.jobUrl, a.externalJobId) === this.activeEmployer));
    const job = dryRun ? nextJobs[0] : nextJobs.find(item => this.markApplying(item.id));
    if (!job) {
      return { processed: false, message: 'Queue is empty.' };
    }
    this.activeEmployer = canonicalEmployerKey(job.jobUrl, job.externalJobId);
    this.lastProvider = provider(job);
    if (!dryRun) this.store?.setLastProvider(this.lastProvider);

    if (dryRun) {
      this.dryRunVisited.add(job.id);
      const result = await runner.run({ url: job.jobUrl, profile, mode, dryRun: true, headless: true, submit: false });
      return { processed: true, job, status: result.status === 'failed' ? 'failed' : 'inspected', message: 'Inspection only; queue unchanged.' };
    }
    try {
      const result = await runner.run({
        url: job.jobUrl,
        profile,
        mode,
        dryRun,
        headless: true,
        submit,
      });

      if (result.status === 'submitted' && result.receipt) {
        this.markApplied(job.id, result.receipt);
        return {
          processed: true,
          job,
          status: 'applied',
          message: `Successfully processed application for ${job.title} at ${job.company}`,
        };
      } else if (result.status === 'skipped') {
        this.skip(job.id, result.reason || 'preflight_rejected');
        return { processed: true, job, status: 'skipped', message: result.reason || 'Preflight rejected application' };
      } else if (result.status === 'retry') {
        job.status = 'queued';
        job.error = result.reason || 'Source verification unavailable';
        job.nextAttemptAt = new Date(Date.now() + 300000).toISOString();
        this.persist(job);
        return { processed: true, job, status: 'retry', message: job.error };
      } else if (result.status === 'paused_for_review' || result.status === 'completed') {
        job.status = 'paused_for_review';
        job.error = result.reason;
        this.persist(job);
        return {
          processed: true,
          job,
          status: 'paused_for_review',
          message: `Application paused for human copilot review (${result.unmappedFields} unmapped fields).`,
        };
      } else {
        this.markFailed(job.id, result.reason || 'Runner returned non-completed status');
        return {
          processed: false,
          job,
          status: 'failed',
          message: `Application failed for ${job.title} at ${job.company}`,
        };
      }
    } catch {
      this.markFailed(job.id, 'Application execution failed; inspect the saved review');
      return {
        processed: false,
        job,
        status: 'failed',
        message: 'Application execution failed; inspect the saved review',
      };
    }
  }

  /**
   * Continuous infinite auto-apply worker loop.
   * Processes all pending queued jobs consecutively without artificial quota limits.
   */
  async runContinuousLoop(
    runner: {
      run: (options: {
        url: string;
        profile: CandidateExtendedProfile;
        mode?: RunnerMode;
        dryRun?: boolean;
        headless?: boolean;
        submit?: boolean;
      }) => Promise<{ status: string; fieldsFilled: number; unmappedFields: number; receipt?: BotRunReport['receipt'] }>;
    },
    profile: CandidateExtendedProfile,
    options: {
      mode?: RunnerMode;
      dryRun?: boolean;
      submit?: boolean;
      maxJobs?: number;
      interJobDelayMs?: number;
      onJobComplete?: (job: AutoaplyJobItem, status: string) => void;
    } = {}
  ): Promise<{
    processedCount: number;
    appliedCount: number;
    failedCount: number;
    pausedCount: number;
  }> {
    const maxJobs = options.maxJobs ?? Infinity;
    const mode = options.mode ?? 'stealth';
    const interJobDelayMs = options.interJobDelayMs ?? 2000;

    let processedCount = 0;
    let appliedCount = 0;
    let failedCount = 0;
    let pausedCount = 0;

    while (processedCount < maxJobs) {
      const res = await this.processNext(runner, profile, mode, options.dryRun, options.submit);
      if (!res.processed && res.message === 'Queue is empty.') {
        break;
      }
      if (!res.processed && !res.job) {
        break;
      }

      processedCount++;
      if (res.status === 'applied') appliedCount++;
      else if (res.status === 'failed') failedCount++;
      else if (res.status === 'paused_for_review') pausedCount++;

      if (res.job && options.onJobComplete) {
        options.onJobComplete(res.job, res.status || 'unknown');
      }

      if (interJobDelayMs > 0 && processedCount < maxJobs) {
        await new Promise(r => setTimeout(r, interJobDelayMs));
      }
    }

    return { processedCount, appliedCount, failedCount, pausedCount };
  }
}
