// scripts/run-overnight-marathon.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { AutoaplyQueueManager } from '../src/autoapply/autoaply.js';
import { AutoApplyRunner, type AutoApplyOptions } from '../src/autoapply/runner.js';
import { preflightJob, isAtsRootUrl, isSupportedDirectAtsJobUrl } from '../src/autoapply/preflight.js';
import { canonicalRequisition } from '../src/autoapply/identity.js';
import { loadProfile } from '../src/autoapply/profile.js';
import { mailboxFromEnvironment } from '../src/autoapply/mailbox.js';
import { CredentialVault } from '../src/autoapply/vault.js';
import type { AutoaplyJobItem, BotRunReport } from '../src/autoapply/types.js';
import { resolveEmployerDomain, findFreeCompanyLeads, generateColdOutreachDraft, recordOutreachLead } from '../src/leads/free-email-finder.js';
import { isHostReadyForRequest, markHostOutcome, getRateLimitKey } from '../src/autoapply/session-pool.js';
import { fastApiPreflightCheck } from '../src/autoapply/tiered-fetcher.js';
import { getProviderTimeoutConfig } from '../src/autoapply/watchdog-timer.js';
import { generateParkIssuesScoreboard } from '../src/autoapply/park-telemetry.js';
import { buildTailoredResumePair } from '../src/resume/deterministic-builder.js';
import { appendJobRunHistory } from '../src/autoapply/run-history.js';
import {
  capturePageDiagnostics,
  recordOvernightError,
  normalizeReasonCode,
  compileMorningImprovementReport,
  DEFAULT_OVERNIGHT_ERRORS_PATH,
} from '../src/autoapply/overnight-error-logger.js';
import {
  partitionJobsIntoProviderLanes,
  runWithHardTimeout,
  acquireLock,
  releaseLock,
  isPidRunningNode,
} from './drain-backfill-and-hourly.js';
import {
  isStrictlyIsolatedTenant,
  isEligibleEngineeringRoleTitle,
  computeJobPriorityScore,
} from '../src/autoapply/priority-scheduler.js';
import { syncHourlyFreshJobsFromOriginMain } from './sync-hourly-from-origin.js';
import { syncAppliedJobsToOutreachTargets } from './sync-applied-to-outreach.js';
import { evaluateCandidateJobFit } from '../src/autoapply/candidate-fit-filter.js';
import {
  cleanStaleChromiumProfileLocks,
  recoverPowerOffAndNetOffJobs,
  markJobInFlightCheckpoint,
  clearJobInFlightCheckpoint,
  isOfflineDinoOrNetworkError,
  waitUntilNetworkOnline,
} from '../src/autoapply/power-net-recovery.js';
import {
  scrubBrowserProfileCaches,
  getRecommendedLaneConcurrency,
} from '../src/autoapply/ram-and-pacing.js';
import { startDashboardServer } from './dashboard-server.js';
import { filterUnattemptedJobs, recordAttemptedJob, removeAttemptedJob } from '../src/autoapply/attempted-registry.js';
import { syncGitHubActionsPillars } from './sync-github-actions-pillars.js';

// Enforce unattended overnight execution environment
process.env.AUTOAPPLY_DISABLE_HITL_POPUP = '1';
process.env.AUTOAPPLY_NO_MODEL = '1';

export function reapStrayChrome(): number {
  if (process.platform !== 'win32') return 0;
  try {
    const output = execSync(
      `powershell -NoProfile -Command "$c = 0; Get-CimInstance Win32_Process -Filter \\"Name = 'chrome.exe'\\" | Where-Object { \$_.CommandLine -match '--enable-automation|portal-review|browser-profile|playwright|patchright|--window-position=-2400' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue; \$c++ }; \$c"`,
      { encoding: 'utf8', timeout: 8000 }
    ).trim();
    return parseInt(output, 10) || 0;
  } catch {
    return 0;
  }
}

export function countAutomationChrome(): number {
  if (process.platform !== 'win32') return 0;
  try {
    const output = execSync(
      `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name = 'chrome.exe'\\" | Where-Object { \$_.CommandLine -match '--enable-automation|portal-review|browser-profile|playwright|patchright|--window-position=-2400' }).Count"`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    return parseInt(output, 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * Ticket GEN-97: Multi-lane chunk selector that enforces:
 * 1) Max 1 job per host/company per 40-job chunk (zero same-host monopolies).
 * 2) Skip hosts currently in cooldown before building the chunk.
 * 3) Priority #1 fresh hourly jobs first, followed by round-robin interleaving across Greenhouse, Ashby, Other, and Workday.
 * 4) Exclude Stripe jobs.
 */
export function selectDiversifiedMultiLaneChunk(
  allSortedCandidates: AutoaplyJobItem[],
  chunkSize = 40,
  isReadyFn: (url: string) => boolean = () => true
): AutoaplyJobItem[] {
  const selected: AutoaplyJobItem[] = [];
  const selectedRateLimitKeys = new Set<string>();
  const selectedCompanies = new Set<string>();

  const getKey = (url: string): string => {
    try {
      return getRateLimitKey(url).toLowerCase();
    } catch {
      return 'unknown';
    }
  };

  const getCompany = (c: string): string => {
    return (c || '').toLowerCase().trim();
  };

  const isEligible = (job: AutoaplyJobItem): boolean => {
    if (!job || !job.jobUrl) return false;
    // Rule 4: Exclude Stripe
    if (/stripe/i.test(job.company) || /stripe/i.test(job.jobUrl)) return false;

    // Ticket GEN-175: Candidate precision fit check
    const fit = evaluateCandidateJobFit({
      company: job.company,
      title: job.title,
      location: (job as any).location,
      url: job.jobUrl,
    });
    if (!fit.allowed) return false;

    const key = getKey(job.jobUrl);
    const company = getCompany(job.company);

    // Rule 1: Max 1 job per rate-limit tenant / company per chunk
    if (selectedRateLimitKeys.has(key) || (company && selectedCompanies.has(company))) return false;

    // Rule 2: Host must be ready (not in cooldown)
    if (!isReadyFn(job.jobUrl)) return false;

    return true;
  };

  const takeCandidate = (job: AutoaplyJobItem): boolean => {
    if (!isEligible(job)) return false;
    selected.push(job);
    selectedRateLimitKeys.add(getKey(job.jobUrl));
    if (job.company) selectedCompanies.add(getCompany(job.company));
    return true;
  };

  // Rule 3: Priority #1 Fresh Hourly Candidates first
  const hourlyQueue: AutoaplyJobItem[] = [];
  const greenhouseQueue: AutoaplyJobItem[] = [];
  const ashbyQueue: AutoaplyJobItem[] = [];
  const otherQueue: AutoaplyJobItem[] = [];
  const workdayQueue: AutoaplyJobItem[] = [];

  for (const job of allSortedCandidates) {
    if (!job || !job.jobUrl) continue;
    if (/stripe/i.test(job.company) || /stripe/i.test(job.jobUrl)) continue;

    const isFresh = (job as any).isFresh || Boolean(
      job.postedAt &&
      !isNaN(new Date(job.postedAt).getTime()) &&
      Date.now() - new Date(job.postedAt).getTime() <= 24 * 60 * 60 * 1000
    );

    if (isFresh) {
      hourlyQueue.push(job);
    } else {
      const u = job.jobUrl.toLowerCase();
      if (u.includes('greenhouse.io')) {
        greenhouseQueue.push(job);
      } else if (u.includes('ashbyhq.com')) {
        ashbyQueue.push(job);
      } else if (u.includes('myworkdayjobs.com')) {
        workdayQueue.push(job);
      } else {
        otherQueue.push(job);
      }
    }
  }

  // Ticket GEN-175: Sort candidates within each lane by candidate-fit priority bonus (Bengaluru +5000, India +3500, Junior tech +3000)
  const sortByFit = (a: AutoaplyJobItem, b: AutoaplyJobItem) => {
    const fitA = evaluateCandidateJobFit({ company: a.company, title: a.title, location: (a as any).location, url: a.jobUrl });
    const fitB = evaluateCandidateJobFit({ company: b.company, title: b.title, location: (b as any).location, url: b.jobUrl });
    return fitB.priorityBonus - fitA.priorityBonus;
  };
  hourlyQueue.sort(sortByFit);
  workdayQueue.sort(sortByFit);
  greenhouseQueue.sort(sortByFit);
  ashbyQueue.sort(sortByFit);
  otherQueue.sort(sortByFit);

  // 1. Take 100% of eligible fresh hourly candidates up to chunkSize
  for (const job of hourlyQueue) {
    takeCandidate(job);
    if (selected.length >= chunkSize) return selected;
  }

  // 2. Round-Robin interleaving across [workday, greenhouse, ashby, other]
  const lanes = [workdayQueue, greenhouseQueue, ashbyQueue, otherQueue];
  let progressMade = true;

  while (selected.length < chunkSize && progressMade) {
    progressMade = false;
    for (const lane of lanes) {
      while (lane.length > 0) {
        const candidate = lane.shift()!;
        if (takeCandidate(candidate)) {
          progressMade = true;
          break; // move to next lane for round-robin
        }
      }
      if (selected.length >= chunkSize) break;
    }
  }

  return selected;
}


/**
 * Ticket GEN-162: Fast HTTP 404/410 Pre-Flight Dead-Posting Filter (<250ms).
 * Bounded 2500ms HTTP GET (redirect: 'follow').
 * If 404 or 410, or redirected to ?error=true or /404, fails fast without launching browser.
 */
export async function checkJobPostingHttpAliveFast(url: string): Promise<{ alive: boolean; reason?: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    clearTimeout(timeoutId);
    if (res.status === 404 || res.status === 410) {
      return { alive: false, reason: `HTTP ${res.status} Not Found` };
    }
    const finalUrl = res.url || '';
    if (/(\?error=true|\/404\b)/i.test(finalUrl)) {
      return { alive: false, reason: `Redirected to error page (${finalUrl})` };
    }
    return { alive: true };
  } catch {
    // Plain fetch failures, SSL cert differences, timeouts or 403 blocks pass through to Playwright
    return { alive: true };
  }
}

/**
 * Ticket GEN-159: Dynamic activity-aware timeout.
 * 360_000ms base timeout, dynamically extended by +60_000ms when checkpoint updates, up to 450_000ms.
 */
export async function runWithDynamicActivityTimeout<T>(
  promise: Promise<T>,
  baseTimeoutMs = 360_000,
  label = 'Job',
  jobId?: string
): Promise<T> {
  const maxTimeoutMs = 450_000;
  const startTime = Date.now();
  let currentDeadline = startTime + baseTimeoutMs;
  let lastCheckedCheckpointMtime = 0;
  let timer: NodeJS.Timeout | null = null;
  let checkInterval: NodeJS.Timeout | null = null;

  const cleanup = () => {
    if (timer) clearTimeout(timer);
    if (checkInterval) clearInterval(checkInterval);
  };

  const timeoutPromise = new Promise<never>((_, reject) => {
    const arm = () => {
      const remainingMs = Math.max(0, currentDeadline - Date.now());
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        cleanup();
        const totalElapsedSec = Math.round((Date.now() - startTime) / 1000);
        reject(new Error(`${label} timed out after ${totalElapsedSec}s`));
      }, remainingMs);
    };

    arm();

    if (jobId) {
      const cpPath = path.resolve('state/autoapply/portal-review/applications', jobId, 'checkpoint.json');
      checkInterval = setInterval(() => {
        try {
          if (fs.existsSync(cpPath)) {
            const stat = fs.statSync(cpPath);
            if (stat.mtimeMs > lastCheckedCheckpointMtime) {
              lastCheckedCheckpointMtime = stat.mtimeMs;
              if (currentDeadline - Date.now() < 45_000) {
                const newDeadline = Math.min(startTime + maxTimeoutMs, currentDeadline + 60_000);
                if (newDeadline > currentDeadline) {
                  currentDeadline = newDeadline;
                  arm();
                }
              }
            }
          }
        } catch {}
      }, 10_000);
    }
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    cleanup();
  }
}

export async function runOvernightMarathon(config: {
  profilePath: string;
  stateDir: string;
  chunkSize?: number;
  maxHours?: number;
  maxJobs?: number;
  submit?: boolean;
  headless?: boolean;
}): Promise<void> {
  const stateDir = path.resolve(config.stateDir);
  const profilePath = path.resolve(config.profilePath);
  const chunkSize = config.chunkSize ?? 40;
  const maxHours = config.maxHours ?? 10;
  const maxJobs = config.maxJobs ?? 1200;
  const shouldSubmit = config.submit ?? true;
  const headless = config.headless ?? true;

  try { startDashboardServer(4321); } catch {}
  const lockPath = path.join(stateDir, 'worker.lock');
  if (!acquireLock(lockPath)) {
    console.error(`[MARATHON] Could not acquire worker lock at ${lockPath}. Another worker is active.`);
    return;
  }

  // GEN-53: Clean stale Chromium profile locks and recover power-off / net-off jobs
  const cleanedLocks = cleanStaleChromiumProfileLocks(stateDir);
  const recovery = recoverPowerOffAndNetOffJobs(path.join(stateDir, 'queue.sqlite'));
  if (cleanedLocks > 0 || recovery.recoveredInFlight > 0 || recovery.recoveredNetOffDino > 0) {
    console.log(
      `[MARATHON] Startup recovery: cleaned ${cleanedLocks} profile locks, ` +
        `recovered ${recovery.recoveredInFlight} in-flight and ${recovery.recoveredNetOffDino} net-off dino jobs.`
    );
  }

  console.log(`[MARATHON] ===============================================================`);
  console.log(`[MARATHON] UNATTENDED OVERNIGHT MARATHON RUNNER INITIALIZING`);
  console.log(`[MARATHON] Target: Up to ${maxJobs} jobs over ${maxHours} hours`);
  console.log(`[MARATHON] Chunk Size: ${chunkSize} jobs per cycle across 4 isolated lanes`);
  console.log(`[MARATHON] Disable HITL Popups: ${process.env.AUTOAPPLY_DISABLE_HITL_POPUP === '1'}`);
  console.log(`[MARATHON] ===============================================================`);

  // Ensure initial empty overnight-errors.jsonl exists if missing
  if (!fs.existsSync(DEFAULT_OVERNIGHT_ERRORS_PATH)) {
    fs.mkdirSync(path.dirname(DEFAULT_OVERNIGHT_ERRORS_PATH), { recursive: true });
    fs.writeFileSync(DEFAULT_OVERNIGHT_ERRORS_PATH, '', 'utf8');
  }

  // Generate initial morning improvement report
  try {
    generateParkIssuesScoreboard(path.join(stateDir, 'queue.sqlite'));
    compileMorningImprovementReport();
    syncAppliedJobsToOutreachTargets(path.join(stateDir, 'queue.sqlite'));
  } catch {}

  const marathonStartMs = Date.now();
  const maxDurationMs = maxHours * 60 * 60 * 1000;
  let totalProcessedOverall = 0;
  let totalAppliedOverall = 0;
  let cycleIndex = 0;

  const mailbox = mailboxFromEnvironment();
  const vault = new CredentialVault(path.join(stateDir, 'vault'));
  const hostHealthPath = path.join(stateDir, 'host-health.json');

  try {
    while (Date.now() - marathonStartMs < maxDurationMs && totalProcessedOverall < maxJobs) {
      cycleIndex++;
      const cycleStartMs = Date.now();
      console.log(`\n[MARATHON] [CYCLE #${cycleIndex}] Initializing chunk (Processed so far: ${totalProcessedOverall}/${maxJobs})...`);
      // Ticket GEN-90: Periodic 30-minute discovery sync
      const syncRecordPath = path.join(stateDir, 'last-discovery-sync.json');
      let shouldSyncDiscovery = true;
      try {
        if (fs.existsSync(syncRecordPath)) {
          const syncMeta = JSON.parse(fs.readFileSync(syncRecordPath, 'utf8'));
          if (syncMeta.timestamp && (Date.now() - Date.parse(syncMeta.timestamp)) < 30 * 60 * 1000) {
            shouldSyncDiscovery = false;
          }
        }
      } catch {}

      if (shouldSyncDiscovery) {
        console.log('[MARATHON] Running 30-min discovery sync (syncGitHubActionsPillars)...');
        try {
          const syncRes = await syncGitHubActionsPillars(path.join(stateDir, 'queue.sqlite'));
          console.log(`[MARATHON] Discovery sync complete: ingested ${syncRes.newJobsIngested} new jobs.`);
          fs.writeFileSync(syncRecordPath, JSON.stringify({ timestamp: new Date().toISOString(), result: syncRes }, null, 2), 'utf8');
        } catch (err) {
          console.warn('[MARATHON] Discovery sync error (non-fatal):', err);
        }
      }


      // Ticket GEN-173: Sync fresh 1-hour jobs from origin/main Git objects before each chunk
      try {
        const syncHourly = syncHourlyFreshJobsFromOriginMain(path.join(stateDir, 'queue.sqlite'));
        if (syncHourly.insertedFresh > 0 || syncHourly.boostedExisting > 0) {
          console.log(`[MARATHON] Hourly origin sync: +${syncHourly.insertedFresh} fresh jobs, ${syncHourly.boostedExisting} boosted`);
        }
      } catch (err) {
        console.warn('[MARATHON] Hourly origin sync notice (non-fatal):', err);
      }

      // 1. Fresh queue read for eligible jobs
      const profile = loadProfile(profilePath);
      const candidateId = createHash('sha256').update(profile.personal.email.trim().toLowerCase()).digest('hex').slice(0, 20);
      const queue = new AutoaplyQueueManager({
        statePath: path.join(stateDir, 'queue.sqlite'),
        candidateId,
        infiniteMode: true,
      });

      const allQueued = queue.list().filter(j => j.status === 'queued');
      if (allQueued.length === 0) {
        console.log(`[MARATHON] No more queued jobs remaining in queue.sqlite. Marathon complete!`);
        queue.close();
        break;
      }

      // Filter isolated tenants and ineligible non-engineering / senior roles (Ticket GEN-48)
      const eligibleQueued: AutoaplyJobItem[] = [];
      for (const j of allQueued) {
        // Ticket GEN-91: Fast-fail non-direct ATS jobs
        if (!isSupportedDirectAtsJobUrl(j.jobUrl)) {
          queue.skip(j.id, 'unsupported_non_direct_ats_url');
          continue;
        }
        if (isStrictlyIsolatedTenant(j.company, j.jobUrl)) {
          queue.skip(j.id, 'strictly_isolated_tenant');
          continue;
        }
        const titleCheck = isEligibleEngineeringRoleTitle(j.title);
        if (!titleCheck.eligible) {
          queue.skip(j.id, titleCheck.reason || 'ineligible_role_title');
          continue;
        }
        eligibleQueued.push(j);
      }

      if (eligibleQueued.length === 0) {
        console.log(`[MARATHON] No eligible engineering jobs remaining in queue.sqlite. Marathon complete!`);
        queue.close();
        break;
      }

      // Ticket GEN-57: Filter out previously attempted jobs (MAX_ATTEMPTS = 1)
      const freshQueued = filterUnattemptedJobs(eligibleQueued, path.join(stateDir, 'queue.sqlite'));
      if (freshQueued.length === 0) {
        console.log(`[MARATHON] All ${eligibleQueued.length} eligible jobs have already been attempted. Marathon complete!`);
        queue.close();
        break;
      }

      // DSA Max-Heap Priority Score: highest value / newest SWE roles popped first
      const nowMs = Date.now();
      const scoredCandidates = freshQueued.map((job: AutoaplyJobItem) => {
        const createdAtMs = Date.parse((job as any).createdAt || job.postedAt || '0') || 0;
        const score = computeJobPriorityScore({
          id: job.id,
          company: job.company,
          title: job.title,
          url: job.jobUrl,
          createdAtMs,
          rowId: (job as any).rowId || 0,
          isHourlyFresh: (job as any).isHourlyFresh,
          discoveredAt: (job as any).discoveredAt,
          hourlySource: (job as any).hourlySource,
          payload: (job as any).payload,
        }, nowMs);
        return { job, score };
      }).sort((a: { job: AutoaplyJobItem; score: number }, b: { job: AutoaplyJobItem; score: number }) => b.score - a.score);

      // Ticket GEN-90: Drain Priority #1 (Hourly Fresh Jobs) FIRST, Backfill Queue SECOND
      const hourlyCandidates: AutoaplyJobItem[] = [];
      const backfillCandidates: AutoaplyJobItem[] = [];

      for (const item of scoredCandidates) {
        const jobAny = item.job as any;
        const isFresh = Boolean(
          jobAny.isHourlyFresh ||
          jobAny.payload?.isHourlyFresh ||
          (jobAny.discoveredAt && (nowMs - new Date(jobAny.discoveredAt).getTime()) <= 86400_000) ||
          (jobAny.payload?.discoveredAt && (nowMs - new Date(jobAny.payload.discoveredAt).getTime()) <= 86400_000)
        );
        if (isFresh) {
          hourlyCandidates.push(item.job);
        } else {
          backfillCandidates.push(item.job);
        }
      }

      const prioritizedCandidates = [...hourlyCandidates, ...backfillCandidates];

      // Ticket GEN-97: Select Diversified Multi-Lane Chunk (Max 1 Job Per Host/Company, Ready Hosts First, Round-Robin across Lanes)
      const chunkJobs = selectDiversifiedMultiLaneChunk(
        prioritizedCandidates,
        chunkSize,
        (url) => isHostReadyForRequest(url, 45000, hostHealthPath)
      );
      const lanes = partitionJobsIntoProviderLanes(chunkJobs);
      const activeLanes = (Object.keys(lanes) as Array<keyof typeof lanes>).filter(
        k => (lanes[k]?.length ?? 0) > 0
      );

      console.log(
        `[MARATHON] [CYCLE #${cycleIndex}] Selected ${chunkJobs.length} jobs across active lanes: ` +
          activeLanes.map(k => `${k}(${lanes[k]?.length ?? 0})`).join(', ')
      );

      let chunkProcessedCount = 0;
      let chunkAppliedCount = 0;

      const processJobInLane = async (
        job: AutoaplyJobItem,
        laneRunner: AutoApplyRunner,
        laneProfileDir: string,
        laneKey: string
      ): Promise<void> => {
        if (totalProcessedOverall >= maxJobs || Date.now() - marathonStartMs >= maxDurationMs) return;

        // Host cooldown check (45s cooldown per host)
        if (!isHostReadyForRequest(job.jobUrl, 45000, hostHealthPath)) {
          console.log(`[MARATHON] Host cooldown active for ${job.jobUrl}, deferring.`);
          return;
        }

        // Fast API Preflight Check
        const fastApi = await fastApiPreflightCheck(job.jobUrl).catch(() => ({ status: 'eligible' as const }));
        if (fastApi.status === 'skipped') {
          queue.skip(job.id, fastApi.reason || 'fast_api_preflight_skipped');
          return;
        }

        markHostOutcome(job.jobUrl, 'request', hostHealthPath);

        // Preflight validation
        const preflight = await preflightJob(
          {
            externalJobId: job.externalJobId,
            title: job.title,
            company: job.company,
            jobUrl: job.jobUrl,
            location: job.location,
          },
          profile,
          { signal: AbortSignal.timeout(15000) }
        ).catch(() => ({ status: 'eligible' as const, reason: '', checkedAt: new Date().toISOString(), description: undefined as string | undefined }));

        if (preflight.status === 'skipped') {
          queue.skip(job.id, preflight.reason || 'preflight_ineligible');
          return;
        }

        // Ticket GEN-162: Fast HTTP 404/410 Pre-Flight Dead-Posting Filter (<250ms)
        const httpPreflight = await checkJobPostingHttpAliveFast(job.jobUrl);
        if (!httpPreflight.alive) {
          console.log(`[MARATHON] Fast preflight detected closed posting (${httpPreflight.reason}) for ${job.company}`);
          queue.markFailed(job.id, 'Job posting is closed or no longer available (HTTP 404/410 pre-flight)');
          markHostOutcome(job.jobUrl, 'error', hostHealthPath);
          chunkProcessedCount++;
          totalProcessedOverall++;
          return;
        }

        const sessionDir = path.join(
          stateDir,
          'applications',
          createHash('sha256').update(job.canonicalKey || job.jobUrl).digest('hex').slice(0, 20)
        );

        if (!laneRunner.isConnected()) {
          await laneRunner.initBrowser(headless, undefined, laneProfileDir).catch(() => {});
        }

        let childRunner: AutoApplyRunner;
        try {
          childRunner = await laneRunner.forkApplicationContext(path.join(sessionDir, 'storage-state.json'));
        } catch {
          if (!laneRunner.isConnected()) {
            await laneRunner.initBrowser(headless, undefined, laneProfileDir).catch(() => {});
          }
          childRunner = await laneRunner.forkApplication(laneProfileDir, headless);
        }

        const timeoutConfig = getProviderTimeoutConfig(job.jobUrl);

        // Tailored resume for archetype
        let jobProfile = profile;
        try {
          const tailored = await buildTailoredResumePair(
            { title: job.title, description: preflight.description, company: job.company },
            profile,
            path.join(sessionDir, 'resume')
          );
          if (tailored && tailored.pdfPath && fs.existsSync(tailored.pdfPath)) {
            jobProfile = {
              ...profile,
              documents: {
                ...profile.documents,
                resume: tailored.pdfPath,
              },
            };
          }
        } catch {}

        const options: AutoApplyOptions = {
          url: job.jobUrl,
          jobId: job.id,
          lane: laneKey,
          profile: jobProfile,
          mode: 'stealth',
          headless,
          submit: shouldSubmit,
          resume: true,
          retryReviewed: true,
          preserveReviewedValues: false,
          keepOpen: false,
          sessionDir,
          browserProfileDir: laneProfileDir,
          company: job.company,
          applicationCountry: 'India',
          applicationLocation: job.location,
          applicationBrief: preflight.description ? { title: job.title, company: job.company, text: preflight.description } : undefined,
          mailbox,
          vault,
          requisition: canonicalRequisition(job.jobUrl, job.externalJobId),
          timeoutMs: timeoutConfig.maxTotalMs,
        };

        const jobStartedAt = new Date().toISOString();
        const jobStartMs = Date.now();
        let report: BotRunReport;

        markJobInFlightCheckpoint({
          jobId: job.id,
          company: job.company,
          url: job.jobUrl,
          lane: laneKey,
          startedAt: jobStartedAt,
          lastStep: 1,
        });

        // Ticket GEN-102: Wait until network online BEFORE starting hard timeout clock
        await waitUntilNetworkOnline();

        try {
          report = await runWithDynamicActivityTimeout(childRunner.run(options), timeoutConfig.maxTotalMs, `Job ${job.company}`, job.id);
        } catch (err: any) {
          const measuredDurationMs = Date.now() - jobStartMs;
          const isNetDrop = isOfflineDinoOrNetworkError(err?.message || '') ||
            /\b(Wi-Fi \/ DNS drop|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_CONNECTION_TIMED_OUT|network.*offline)\b/i.test(err?.message || '');

          // Ticket GEN-159: Preserve fieldsFilled and check for confirmation in checkpoint
          let cpFieldsFilled = 0;
          let cpFieldsFound = 0;
          let cpStepNumber = 1;
          let cpCurrentUrl = '';
          let cpReceipt: any = undefined;
          const cpPath = path.resolve('state/autoapply/portal-review/applications', job.id, 'checkpoint.json');
          if (fs.existsSync(cpPath)) {
            try {
              const cp = JSON.parse(fs.readFileSync(cpPath, 'utf8'));
              cpFieldsFilled = cp.report?.fieldsFilled ?? cp.fieldsFilled ?? 0;
              cpFieldsFound = cp.report?.fieldsFound ?? cp.fieldsFound ?? 0;
              cpStepNumber = cp.stepNumber || cp.lastStep || 1;
              cpCurrentUrl = cp.currentUrl || '';
              cpReceipt = cp.report?.receipt;
            } catch {}
          }

          const CONF_RE = /(?:\/confirmation|\/thank(?:s|[-_]?you)|\/application[-_]?submitted|\/submitted)(?:\/|$|\?|#)|[?&](?:submitted|applied|confirmation)=(?:true|1)\b/i;
          const isConfirmedFromCp = CONF_RE.test(cpCurrentUrl) || Boolean(cpReceipt);

          report = {
            mode: 'stealth',
            url: job.jobUrl,
            ats: canonicalRequisition(job.jobUrl, job.externalJobId)?.provider || 'unknown',
            startTime: jobStartedAt,
            endTime: new Date().toISOString(),
            durationMs: measuredDurationMs,
            fieldsFound: cpFieldsFound,
            fieldsFilled: cpFieldsFilled,
            unmappedFields: 0,
            stepsTraversed: cpStepNumber,
            status: isConfirmedFromCp ? 'submitted' : (isNetDrop ? 'queued' : 'failed'),
            reason: isConfirmedFromCp ? 'Submitted (checkpoint verified)' : (isNetDrop ? 'wifi_drop_requeued' : (err?.message || 'Execution failed')),
            receipt: isConfirmedFromCp ? (cpReceipt || {
              url: cpCurrentUrl,
              text: 'Application Submitted',
              verifiedAt: new Date().toISOString(),
              selector: 'checkpoint_confirmation_catch_guard'
            }) : undefined,
            actions: [],
            logs: [],
          };

          if (isNetDrop) {
            console.log(`[MARATHON] Wi-Fi / DNS drop detected during ${job.company}; kept queued for retry.`);
            await waitUntilNetworkOnline();
          } else {
            // Record timeout diagnostic error
            recordOvernightError({
              timestamp: new Date().toISOString(),
              jobId: job.id,
              company: job.company,
              title: job.title,
              provider: report.ats,
              lane: laneKey,
              url: job.jobUrl,
              durationMs: measuredDurationMs,
              status: /timed out/i.test(err?.message || '') ? 'timeout' : 'failed',
              reasonCode: normalizeReasonCode(err?.message || '', 'timeout'),
              errorMessage: err?.message || 'Execution timeout',
              stepNumber: 1,
              stepHeading: '',
              unmappedFields: [],
              validationErrorsOnPage: [],
              visibleButtonsOnPage: [],
            });
          }
        } finally {
          clearJobInFlightCheckpoint(job.id);
          await childRunner.close().catch(() => {});
        }

        if (isOfflineDinoOrNetworkError(report.reason || '')) {
          console.log(`[MARATHON] Network/Dino error observed. Waiting for network online...`);
          await waitUntilNetworkOnline(5000, 300_000);
        }

        const durationMs = report.durationMs || (Date.now() - jobStartMs);
        const jobFinishedAt = report.endTime || new Date().toISOString();
        chunkProcessedCount++;
        totalProcessedOverall++;

        // Host health updates
        if (report.status === 'submitted') {
          markHostOutcome(job.jobUrl, 'success', hostHealthPath);
        } else if (report.status === 'failed') {
          markHostOutcome(job.jobUrl, 'error', hostHealthPath);
        } else {
          markHostOutcome(job.jobUrl, 'success', hostHealthPath);
        }

        // Ticket GEN-122: Post-job /confirmation checkpoint audit guard
        if (report.status !== 'submitted') {
          const cpPath = path.resolve('state/autoapply/portal-review/applications', job.id, 'checkpoint.json');
          if (fs.existsSync(cpPath)) {
            try {
              const cp = JSON.parse(fs.readFileSync(cpPath, 'utf8'));
              const currUrl = cp.currentUrl || '';
              const CONF_RE = /(?:\/confirmation|\/thank(?:s|[-_]?you)|\/application[-_]?submitted|\/submitted)(?:\/|$|\?|#)|[?&](?:submitted|applied|confirmation)=(?:true|1)\b/i;
              if (CONF_RE.test(currUrl) || Boolean(cp.report?.receipt)) {
                report.status = 'submitted';
                report.receipt = cp.report?.receipt || {
                  url: currUrl,
                  text: 'Application Submitted',
                  verifiedAt: new Date().toISOString(),
                  selector: 'checkpoint_confirmation_audit'
                };
                console.log(`🏆 [MARATHON AUDIT] Recovered verified confirmation URL from checkpoint for ${job.company}`);
              }
            } catch {}
          }
        }

        // Handle outcomes in queue
        if (report.status === 'submitted' && report.receipt) {
          chunkAppliedCount++;
          totalAppliedOverall++;
          queue.markApplied(job.id, report.receipt);
          try {
            const domain = await resolveEmployerDomain(job.company, job.jobUrl);
            const lead = await findFreeCompanyLeads({ company: job.company, domain });
            const draft = generateColdOutreachDraft(job.company, job.title, lead, profile);
            recordOutreachLead(draft);
          } catch {}
          try {
            await syncAppliedJobsToOutreachTargets(path.join(stateDir, 'queue.sqlite'));
          } catch {}
        } else if (report.status === 'paused_for_review') {
          queue.pauseForReview(job.id, report.reason);
        } else if (report.status === 'skipped') {
          if (report.reason === 'wifi_drop_requeued') {
            console.log(`[MARATHON] Wi-Fi drop on ${job.company}; kept queued for retry.`);
          } else {
            queue.skip(job.id, report.reason);
          }
        } else if (report.status === 'queued' || report.reason === 'service_temporarily_unavailable' || report.reason === 'wifi_drop_requeued') {
          // Ticket GEN-99 / GEN-102: Workday maintenance & Wi-Fi drop retry guard
          if (report.reason === 'service_temporarily_unavailable') {
            markHostOutcome(job.jobUrl, 'rate_limited', hostHealthPath);
          }
          removeAttemptedJob(job.id, job.jobUrl);
          console.log(`[MARATHON] ${job.company} kept queued for retry (${report.reason}); 0 attempt recorded.`);
        } else {
          queue.markFailed(job.id, report.reason || 'Unknown error');
        }

        const finalStatus =
          report.status === 'submitted' || report.status === 'completed'
            ? 'applied'
            : report.status === 'paused_for_review'
            ? 'paused_for_review'
            : report.status === 'skipped'
            ? 'skipped'
            : report.status === 'queued' || report.reason === 'service_temporarily_unavailable' || report.reason === 'wifi_drop_requeued'
            ? 'queued'
            : 'failed';

        const provider = canonicalRequisition(job.jobUrl, job.externalJobId)?.provider || report.ats || 'ats';

        appendJobRunHistory({
          jobId: job.id,
          company: job.company,
          title: job.title,
          provider,
          lane: laneKey,
          url: job.jobUrl,
          status: finalStatus,
          reason: report.reason || finalStatus,
          fieldsFilled: report.fieldsFilled || 0,
          startedAt: jobStartedAt,
          finishedAt: jobFinishedAt,
          durationMs,
          receiptVerified: report.status === 'submitted' || !!report.receipt,
        });

        // Ticket GEN-57: Record attempted job to persistent registry (skip if kept queued for maintenance/network retry)
        if (report.status !== 'queued' && report.reason !== 'service_temporarily_unavailable' && report.reason !== 'wifi_drop_requeued') {
          recordAttemptedJob({
            jobId: job.id,
            url: job.jobUrl,
            company: job.company,
            status: finalStatus,
          });
        }

        // Update database payload
        try {
          (queue as any).store?.db?.prepare(`
            UPDATE applications
            SET payload = json_set(payload,
              '$.lastRunStartedAt', ?,
              '$.lastRunFinishedAt', ?,
              '$.durationMs', ?,
              '$.fieldsFilled', ?,
              '$.lane', ?,
              '$.provider', ?
            )
            WHERE id = ?
          `).run(jobStartedAt, jobFinishedAt, durationMs, report.fieldsFilled || 0, laneKey, provider, job.id);
        } catch {}

        console.log(
          `[MARATHON #${totalProcessedOverall}] ${report.status === 'submitted' ? 'Applied' : 'Processed'}: ${job.company} (${report.status}${report.reason ? ': ' + report.reason : ''}) | ${(durationMs / 1000).toFixed(1)}s [${laneKey}]`
        );
      };

      // Launch lanes in parallel with staggered starts
      const lanePromises = activeLanes.map(async (laneKey, idx) => {
        if (idx > 0) {
          await new Promise(r => setTimeout(r, idx * 3500));
        }
        const jobs = lanes[laneKey] || [];
        if (jobs.length === 0) return;

        const laneProfileDir = path.resolve('state/autoapply', `browser-profile-lane-${laneKey}`);
        fs.mkdirSync(laneProfileDir, { recursive: true });

        for (const lockFile of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
          try { fs.unlinkSync(path.join(laneProfileDir, lockFile)); } catch {}
        }

        const laneRunner = new AutoApplyRunner();
        try {
          await laneRunner.initBrowser(headless, undefined, laneProfileDir).catch(() => {});
          for (const job of jobs) {
            if (totalProcessedOverall >= maxJobs || Date.now() - marathonStartMs >= maxDurationMs) break;
            try {
              if (!laneRunner.isConnected()) {
                await laneRunner.initBrowser(headless, undefined, laneProfileDir).catch(() => {});
              }
              await processJobInLane(job, laneRunner, laneProfileDir, laneKey);
            } catch (err: any) {
              console.error(`[MARATHON] Error in lane ${laneKey} for ${job.company}:`, err?.message || err);
            }
          }
        } finally {
          await laneRunner.close().catch(() => {});
        }
      });

      await Promise.all(lanePromises);

      // Close SQLite queue manager connection cleanly before recycling
      queue.close();

      // 40-JOB BROWSER RECYCLING & LEAK PREVENTION:
      // 1) Cleanly reap any stray --enable-automation Chrome processes
      const reaped = reapStrayChrome();
      const leakedAfterReap = countAutomationChrome();
      const cycleElapsed = ((Date.now() - cycleStartMs) / 1000).toFixed(1);

      console.log(
        `[MARATHON] [CYCLE #${cycleIndex} COMPLETED] Processed ${chunkProcessedCount} jobs (${chunkAppliedCount} applied) in ${cycleElapsed}s.`
      );
      console.log(
        `[MARATHON] [RECYCLE] Stray Chrome processes reaped: ${reaped} (Active leaked automation Chrome: ${leakedAfterReap})`
      );

      // GEN-54: Scrub bloated browser profile caches (Cache, Code Cache, GPUCache) while preserving Cookies
      const freed = scrubBrowserProfileCaches(stateDir);
      console.log(`[MARATHON] [RAM DIET] Scrubbed ${freed} cache directories across browser profiles.`);

      // 2) Update scoreboard and morning improvement report
      try {
        generateParkIssuesScoreboard(path.join(stateDir, 'queue.sqlite'));
        const rep = compileMorningImprovementReport();
        console.log(`[MARATHON] [REPORT] Morning Improvement Report updated at out/MORNING-IMPROVEMENT-REPORT.md.`);
        syncAppliedJobsToOutreachTargets(path.join(stateDir, 'queue.sqlite'));
      } catch (err) {
        console.error('[MARATHON] Failed compiling improvement report:', err);
      }

      // 3) Sleep 5 seconds before next chunk
      console.log(`[MARATHON] Sleeping 5s before next 40-job chunk...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  } finally {
    await mailbox?.close().catch(() => {});
    releaseLock(lockPath);
    reapStrayChrome();
    console.log(`[MARATHON] Run completed. Total processed: ${totalProcessedOverall}, Applied: ${totalAppliedOverall}.`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (['--submit', '--headless'].includes(key)) {
      flags.add(key);
    } else if (
      ['--profile', '--state', '--chunk-size', '--max-hours', '--max-jobs'].includes(key) &&
      args[i + 1] &&
      !args[i + 1]!.startsWith('--')
    ) {
      values.set(key, args[++i]!);
    }
  }

  const profilePath = values.get('--profile') || 'state/autoapply/portal-review/candidate.json';
  const stateDir = values.get('--state') || 'state/autoapply/portal-review';
  const chunkSize = values.has('--chunk-size') ? Number(values.get('--chunk-size')) : 40;
  const maxHours = values.has('--max-hours') ? Number(values.get('--max-hours')) : 48;
  const maxJobs = values.has('--max-jobs') ? Number(values.get('--max-jobs')) : 99999;
  const shouldSubmit = flags.has('--submit');
  const headless = !args.includes('--no-headless');

  await runOvernightMarathon({
    profilePath,
    stateDir,
    chunkSize,
    maxHours,
    maxJobs,
    submit: shouldSubmit,
    headless,
  });
}

if (process.argv[1] && (process.argv[1].endsWith('run-overnight-marathon.ts') || process.argv[1].endsWith('run-overnight-marathon.js'))) {
  main().catch(err => {
    console.error('[MARATHON] Fatal error:', err);
    process.exit(1);
  });
}
