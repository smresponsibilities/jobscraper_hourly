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
  return Math.max(0, diffMs / (1000 * 60 * 60));
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

  constructor(customConfig: Partial<AutoaplyQueueConfig> = {}) {
    this.config = { ...DEFAULT_AUTOAPLY_CONFIG, ...customConfig };
  }

  /**
   * Adds a single job to the queue.
   */
  enqueue(
    job: Omit<AutoaplyJobItem, 'id' | 'status' | 'jobBoard'> & { id?: string; jobBoard?: AutoaplyJobBoard }
  ): AutoaplyJobItem {
    const id = job.id || `autoaply_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const board = job.jobBoard || classifyJobBoard(job.jobUrl);

    const item: AutoaplyJobItem = {
      id,
      externalJobId: job.externalJobId || id,
      title: job.title,
      company: job.company,
      jobUrl: job.jobUrl,
      jobBoard: board,
      location: job.location,
      postedAt: job.postedAt || new Date().toISOString(),
      status: 'queued',
      feedbackType: job.feedbackType,
    };

    this.queue.set(id, item);
    return item;
  }

  /**
   * Batch enqueues multiple job listings. Returns count of newly queued items.
   */
  enqueueBatch(
    jobs: Array<Omit<AutoaplyJobItem, 'id' | 'status' | 'jobBoard'> & { id?: string; jobBoard?: AutoaplyJobBoard }>
  ): number {
    let count = 0;
    for (const job of jobs) {
      this.enqueue(job);
      count++;
    }
    return count;
  }

  /**
   * Returns all pending queued jobs, sorted by freshness (<4h first).
   */
  getPendingQueue(filterFreshOnly = false, refDate = new Date()): AutoaplyJobItem[] {
    const pending = Array.from(this.queue.values()).filter(j => j.status === 'queued');

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
  recordFeedback(jobId: string, feedback: AutoaplyFeedbackType): boolean {
    const item = this.queue.get(jobId);
    if (!item) return false;

    item.feedbackType = feedback;
    if (feedback === 'thumbs_down') {
      item.status = 'skipped';
    }
    return true;
  }

  /**
   * Explicitly skips a job in the queue (no credit deducted).
   */
  skip(jobId: string): boolean {
    return this.recordFeedback(jobId, 'thumbs_down');
  }

  /**
   * Marks a job as actively applying.
   */
  markApplying(jobId: string): boolean {
    const item = this.queue.get(jobId);
    if (!item) return false;
    item.status = 'applying';
    return true;
  }

  /**
   * Marks a job as successfully applied, deducting 1 application credit if metered.
   */
  markApplied(jobId: string): boolean {
    const item = this.queue.get(jobId);
    if (!item) return false;

    item.status = 'applied';
    item.appliedAt = new Date().toISOString();
    if (!this.config.infiniteMode && typeof this.config.remainingCredits === 'number') {
      this.config.remainingCredits = Math.max(0, this.config.remainingCredits - 1);
    }
    return true;
  }

  /**
   * Marks a job application as failed with an error reason.
   */
  markFailed(jobId: string, error: string): boolean {
    const item = this.queue.get(jobId);
    if (!item) return false;

    item.status = 'failed';
    item.error = error;
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
    return this.config.remainingCredits;
  }

  /**
   * Summarizes queue performance and interview metrics.
   */
  getMetrics(): AutoaplyQueueMetrics {
    const items = Array.from(this.queue.values());
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
      }) => Promise<{ status: string; fieldsFilled: number; unmappedFields: number }>;
    },
    profile: CandidateExtendedProfile,
    mode: RunnerMode = 'stealth',
    dryRun = false
  ): Promise<{ processed: boolean; job?: AutoaplyJobItem; status?: string; message: string }> {
    if (!this.hasCredits()) {
      return {
        processed: false,
        message: 'Batch quota reached. Infinite mode is active by default for unlimited applications.',
      };
    }

    const nextJobs = this.getPendingQueue(false);
    const job = nextJobs[0];
    if (!job) {
      return { processed: false, message: 'Queue is empty.' };
    }

    this.markApplying(job.id);

    try {
      const result = await runner.run({
        url: job.jobUrl,
        profile,
        mode,
        dryRun,
        headless: true,
      });

      if (result.status === 'completed') {
        if (!dryRun) {
          this.markApplied(job.id);
        }
        return {
          processed: true,
          job,
          status: 'applied',
          message: `Successfully processed application for ${job.title} at ${job.company}`,
        };
      } else if (result.status === 'paused_for_review') {
        job.status = 'paused_for_review';
        return {
          processed: true,
          job,
          status: 'paused_for_review',
          message: `Application paused for human copilot review (${result.unmappedFields} unmapped fields).`,
        };
      } else {
        this.markFailed(job.id, 'Runner returned non-completed status');
        return {
          processed: false,
          job,
          status: 'failed',
          message: `Application failed for ${job.title} at ${job.company}`,
        };
      }
    } catch (err: any) {
      this.markFailed(job.id, err.message);
      return {
        processed: false,
        job,
        status: 'failed',
        message: `Execution error: ${err.message}`,
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
      }) => Promise<{ status: string; fieldsFilled: number; unmappedFields: number }>;
    },
    profile: CandidateExtendedProfile,
    options: {
      mode?: RunnerMode;
      dryRun?: boolean;
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
      const res = await this.processNext(runner, profile, mode, options.dryRun);
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
