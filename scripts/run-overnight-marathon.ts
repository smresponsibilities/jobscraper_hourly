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
  normalizeCompanyRoleSignature,
  isAlreadyAppliedSameCompanyRoleWithin30Days,
} from '../src/autoapply/priority-scheduler.js';
import { syncHourlyFreshJobsFromOriginMain } from './sync-hourly-from-origin.js';
import { runHourly100JobsHarvester } from './harvest-100-hourly-jobs.js';
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
import { ContinuousRamAndHealthWatchdog, check30MinZeroFillDroughtAndAutoHeal } from '../src/autoapply/health-and-ram-watchdog.js';
import { startDashboardServer } from './dashboard-server.js';
import { filterUnattemptedJobs, recordAttemptedJob, removeAttemptedJob } from '../src/autoapply/attempted-registry.js';
import { syncGitHubActionsPillars } from './sync-github-actions-pillars.js';

// Enforce unattended overnight execution environment
process.env.AUTOAPPLY_DISABLE_HITL_POPUP = '1';
process.env.AUTOAPPLY_NO_MODEL = '1';
export const MARATHON_BOOT_MS = Date.now();

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

export function reapStrayChromeForProfile(profileDir: string): number {
  if (process.platform !== 'win32') return 0;
  try {
    const normDir = path.basename(profileDir);
    const output = execSync(
      `powershell -NoProfile -Command "$c = 0; Get-CimInstance Win32_Process -Filter \\"Name = 'chrome.exe'\\" | Where-Object { \$_.CommandLine -like '*${normDir}*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue; \$c++ }; \$c"`,
      { encoding: 'utf8', timeout: 5000 }
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
 * Ticket GEN-282: Fast check of queued Tier-2 jobs. If >= 40, skip synchronous harvesting.
 */
export function countQueuedTier2Jobs(dbPath: string): number {
  try {
    if (!fs.existsSync(dbPath)) return 0;
    const db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 3000;');
    const hasApps = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='applications'").get();
    const hasJobs = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'").get();
    let count = 0;
    if (hasApps) {
      const row = db.prepare("SELECT COUNT(*) as cnt FROM applications WHERE status = 'queued' AND COALESCE(json_extract(payload, '$.is_hourly_fresh'), 0) >= 2").get() as { cnt?: number };
      count = row?.cnt ?? 0;
    } else if (hasJobs) {
      const row = db.prepare("SELECT COUNT(*) as cnt FROM jobs WHERE status = 'queued' AND COALESCE(is_hourly_fresh, 0) >= 2").get() as { cnt?: number };
      count = row?.cnt ?? 0;
    }
    db.close();
    return count;
  } catch {
    return 0;
  }
}

/**
 * Ticket GEN-97 & GEN-283: Multi-lane chunk selector that enforces:
 * 1) 100% chunk dedication to Fast-ATS (Greenhouse, Ashby, Lever) while available.
 * 2) Up to 8 jobs per company/tenant on Fast-ATS.
 * 3) Skip hosts currently in cooldown before building the chunk.
 * 4) Priority ordering by COALESCE(is_hourly_fresh, 0) DESC, priority_score DESC, candidate fit, id DESC.
 * 5) Exclude Stripe jobs.
 */
export function selectDiversifiedMultiLaneChunk(
  allSortedCandidates: AutoaplyJobItem[],
  chunkSize = 40,
  isReadyFn: (url: string) => boolean = () => true
): AutoaplyJobItem[] {
  const selected: AutoaplyJobItem[] = [];
  const tenantCounts = new Map<string, number>();
  const companyCounts = new Map<string, number>();

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

    // Ticket GEN-242, GEN-283 & GEN-304: Breadth-first pacing: max 1 job per company/tenant per chunk to eliminate intra-chunk host cooldown collisions
    const maxAllowed = 1;

    const currentKeyCount = tenantCounts.get(key) || 0;
    const currentCompCount = company ? (companyCounts.get(company) || 0) : 0;

    if (currentKeyCount >= maxAllowed || currentCompCount >= maxAllowed) {
      return false;
    }

    // Rule 2: Host must be ready (not in cooldown)
    if (!isReadyFn(job.jobUrl)) return false;

    return true;
  };

  const takeCandidate = (job: AutoaplyJobItem): boolean => {
    if (!isEligible(job)) return false;
    selected.push(job);
    const key = getKey(job.jobUrl);
    const company = getCompany(job.company);
    tenantCounts.set(key, (tenantCounts.get(key) || 0) + 1);
    if (company) {
      companyCounts.set(company, (companyCounts.get(company) || 0) + 1);
    }
    return true;
  };

  const fastAtsCandidates: AutoaplyJobItem[] = [];
  const slowAtsCandidates: AutoaplyJobItem[] = [];

  for (const job of allSortedCandidates) {
    if (!job || !job.jobUrl || !isSupportedDirectAtsJobUrl(job.jobUrl)) continue;
    if (/stripe/i.test(job.company) || /stripe/i.test(job.jobUrl)) continue;

    const u = job.jobUrl.toLowerCase();
    const ats = String((job as any).ats || '').toLowerCase();
    const isFast =
      u.includes('greenhouse.io') ||
      u.includes('gh_jid=') ||
      u.includes('ashbyhq.com') ||
      u.includes('lever.co') ||
      u.includes('workable.com') ||
      ats === 'greenhouse' ||
      ats === 'ashby' ||
      ats === 'lever' ||
      ats === 'workable';

    if (isFast) {
      fastAtsCandidates.push(job);
    } else {
      slowAtsCandidates.push(job);
    }
  }

  const sortByPriority = (a: AutoaplyJobItem, b: AutoaplyJobItem) => {
    const freshA = Number((a as any).is_hourly_fresh ?? (a as any).isHourlyFresh ?? (a as any).payload?.is_hourly_fresh ?? (a as any).payload?.isHourlyFresh ?? 0);
    const freshB = Number((b as any).is_hourly_fresh ?? (b as any).isHourlyFresh ?? (b as any).payload?.is_hourly_fresh ?? (b as any).payload?.isHourlyFresh ?? 0);
    if (freshB !== freshA) return freshB - freshA;

    const scoreA = Number((a as any).priority_score ?? (a as any).priorityScore ?? 0);
    const scoreB = Number((b as any).priority_score ?? (b as any).priorityScore ?? 0);
    if (scoreB !== scoreA) return scoreB - scoreA;

    const fitA = evaluateCandidateJobFit({ company: a.company, title: a.title, location: (a as any).location, url: a.jobUrl });
    const fitB = evaluateCandidateJobFit({ company: b.company, title: b.title, location: (b as any).location, url: b.jobUrl });
    if (fitB.priorityBonus !== fitA.priorityBonus) return fitB.priorityBonus - fitA.priorityBonus;

    const rowIdA = Number((a as any).rowId) || 0;
    const rowIdB = Number((b as any).rowId) || 0;
    if (rowIdB !== rowIdA) return rowIdB - rowIdA;

    return String(b.id || '').localeCompare(String(a.id || ''));
  };

  fastAtsCandidates.sort(sortByPriority);
  slowAtsCandidates.sort(sortByPriority);

  // Ticket GEN-283: 85% Fast-ATS (Greenhouse, Ashby, Lever) / 15% GCC (Workday, SmartRecruiters)
  const fastAtsSlots = Math.round(chunkSize * 0.85); // 34 slots for chunkSize = 40

  // 1. Fill up to 34 slots with Fast-ATS candidates
  for (const job of fastAtsCandidates) {
    takeCandidate(job);
    if (selected.length >= fastAtsSlots) break;
  }

  // 2. Fill up to 6 slots with GCC / Slow-ATS candidates (is_hourly_fresh >= 2 prioritized)
  for (const job of slowAtsCandidates) {
    takeCandidate(job);
    if (selected.length >= chunkSize) return selected;
  }

  // 3. If GCC candidates < 6, backfill remaining slots with any remaining Fast-ATS candidates
  if (selected.length < chunkSize) {
    for (const job of fastAtsCandidates) {
      if (!selected.includes(job)) {
        takeCandidate(job);
        if (selected.length >= chunkSize) return selected;
      }
    }
  }

  // 4. If still under chunkSize, backfill with any remaining Slow-ATS candidates
  if (selected.length < chunkSize) {
    for (const job of slowAtsCandidates) {
      if (!selected.includes(job)) {
        takeCandidate(job);
        if (selected.length >= chunkSize) return selected;
      }
    }
  }

  return selected;
}


/**
 * Ticket GEN-162: Fast HTTP 404/410 Pre-Flight Dead-Posting Filter (<250ms).
 * Bounded 2500ms HTTP GET (redirect: 'follow').
 * If 404 or 410, or redirected to ?error=true or /404, fails fast without launching browser.
 */
export async function checkJobPostingHttpAliveFast(rawUrl: string): Promise<{ alive: boolean; reason?: string }> {
  try {
    const u = new URL(rawUrl);
    const fetchFast = async (targetUrl: string, acceptJson = false): Promise<Response | null> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2800);
      try {
        return await fetch(targetUrl, {
          method: 'GET',
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0',
            Accept: acceptJson ? 'application/json' : 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          },
          signal: ctrl.signal,
        });
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    };

    // 1. Workday CXS JSON API check: https://{tenant}.wd5.myworkdayjobs.com/{site}/job/{rest} -> /wday/cxs/{tenant}/{site}/job/{rest}
    if (/\.myworkdayjobs\.com$/i.test(u.hostname)) {
      const tenant = u.hostname.split('.')[0];
      const cleanedPath = u.pathname.replace(/^\/[a-z]{2}-[A-Z]{2}\//, '/').replace(/\/apply(?:\/.*)?$/i, '');
      const siteMatch = cleanedPath.match(/^\/([^/]+)\/(job\/.+)$/i);
      if (tenant && siteMatch && siteMatch[1] && siteMatch[2]) {
        const site = siteMatch[1];
        const jobPath = siteMatch[2];
        const cxsUrl = `${u.origin}/wday/cxs/${tenant}/${site}/${jobPath}`;
        const cxsRes = await fetchFast(cxsUrl, true);
        if (cxsRes && (cxsRes.status === 404 || cxsRes.status === 410)) {
          return { alive: false, reason: `Workday CXS API ${cxsRes.status} (closed posting)` };
        }
      }
    }

    // 2. SmartRecruiters Public API check: https://jobs.smartrecruiters.com/{company}/{id}
    if (/smartrecruiters\.com$/i.test(u.hostname)) {
      const srMatch = u.pathname.match(/^\/([^/]+)\/(\d{8,22})/i);
      if (srMatch && srMatch[1] && srMatch[2]) {
        const co = srMatch[1];
        const numId = srMatch[2];
        const srApiRes = await fetchFast(
          `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(co)}/postings/${encodeURIComponent(numId)}`,
          true
        );
        if (srApiRes && (srApiRes.status === 404 || srApiRes.status === 410)) {
          return { alive: false, reason: `SmartRecruiters API ${srApiRes.status} (closed posting)` };
        }
      }
    }

    // 3. Standard HTTP GET check (catches Greenhouse/Ashby/Lever 404s and Lever root redirects)
    const res = await fetchFast(rawUrl, false);
    if (res) {
      if (res.status === 404 || res.status === 410) {
        return { alive: false, reason: `HTTP ${res.status} pre-flight (closed posting)` };
      }
      if (/jobs\.lever\.co$/i.test(u.hostname) && res.url) {
        const finalUrl = new URL(res.url);
        if (/^\/[^/]+\/?$/.test(finalUrl.pathname)) {
          return { alive: false, reason: 'Lever redirected to company root (closed posting)' };
        }
      }
    }
    return { alive: true };
  } catch {
    return { alive: true };
  }
}

/**
 * Ticket GEN-159 & GEN-284: Dynamic activity-aware timeout.
 * 95_000ms base timeout for Fast-ATS (160_000ms for Slow-ATS), dynamically extended by +30_000ms when checkpoint updates.
 */
export async function runWithDynamicActivityTimeout<T>(
  promise: Promise<T>,
  baseTimeoutMs = 95_000,
  label = 'Job',
  sessionDirOrJobId?: string
): Promise<T> {
  const maxTimeoutMs = Math.round(baseTimeoutMs * 1.5);
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

    if (sessionDirOrJobId) {
      const candidatePaths = [
        path.join(sessionDirOrJobId, 'checkpoint.json'),
        path.resolve('state/autoapply/portal-review/applications', sessionDirOrJobId, 'checkpoint.json'),
      ];
      checkInterval = setInterval(() => {
        try {
          for (const cpPath of candidatePaths) {
            if (fs.existsSync(cpPath)) {
              const stat = fs.statSync(cpPath);
              if (stat.mtimeMs > lastCheckedCheckpointMtime) {
                lastCheckedCheckpointMtime = stat.mtimeMs;
                if (currentDeadline - Date.now() < 30_000) {
                  const newDeadline = Math.min(startTime + maxTimeoutMs, currentDeadline + 30_000);
                  if (newDeadline > currentDeadline) {
                    currentDeadline = newDeadline;
                    arm();
                  }
                }
                break;
              }
            }
          }
        } catch {}
      }, 3_000);
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

  const ramWatchdog = new ContinuousRamAndHealthWatchdog(45_000);
  ramWatchdog.start();

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

  // GEN-237: Reset orphaned status = 'running' rows back to status = 'queued' across active SQLite databases
  for (const dbPath of [path.join(stateDir, 'queue.sqlite'), 'data/queue.sqlite']) {
    if (fs.existsSync(dbPath)) {
      try {
        const db = new DatabaseSync(dbPath);
        db.exec('PRAGMA busy_timeout = 15000;');
        const hasJobs = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'").get();
        if (hasJobs) {
          db.prepare("UPDATE jobs SET status = 'queued' WHERE status = 'running'").run();
        }
        const hasApps = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='applications'").get();
        if (hasApps) {
          db.prepare("UPDATE applications SET status = 'queued' WHERE status = 'running'").run();
        }
        db.close();
      } catch (err) {
        console.warn(`[MARATHON] GEN-237: Failed to reset orphaned running jobs in ${dbPath}:`, err);
      }
    }
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

  process.on('SIGHUP', () => {
    const stopFlag = path.join(stateDir, 'portal-review/STOP_AUTOAPPLY.flag');
    if (fs.existsSync(stopFlag)) {
      console.log('[MARATHON] SIGHUP received and STOP_AUTOAPPLY.flag set. Exiting cleanly.');
      process.exit(0);
    } else {
      console.log('[MARATHON] SIGHUP received without STOP_AUTOAPPLY.flag. Ignoring signal (sticky mode).');
    }
  });

  try {
    while (Date.now() - marathonStartMs < maxDurationMs && totalProcessedOverall < maxJobs) {
      cycleIndex++;

      const stopFlag = path.join(stateDir, 'portal-review/STOP_AUTOAPPLY.flag');
      if (fs.existsSync(stopFlag)) {
        console.log(`[MARATHON] STOP_AUTOAPPLY.flag detected at ${stopFlag}. Explicit operator stop requested. Exiting.`);
        break;
      }

      try {
        const docReport = check30MinZeroFillDroughtAndAutoHeal({ stateDir });
        if (docReport.healed) {
          console.log(`[MARATHON] Doctor self-healing applied: actions=[${docReport.actionsTaken.join(', ')}]`);
        }
      } catch {}

      const cycleStartMs = Date.now();
      console.log(`\n[MARATHON] [CYCLE #${cycleIndex}] Initializing chunk (Processed so far: ${totalProcessedOverall}/${maxJobs})...`);
      // Ticket GEN-90: Periodic 30-minute discovery sync
      const syncRecordPath = path.join(stateDir, 'last-discovery-sync.json');
      // Ticket GEN-282 & GEN-283: Fast-launch check (<0.5s startup):
      // If >= 40 Tier-2 jobs are already queued, skip both discovery sync and blocking harvester!
      const queueDbPath = path.join(stateDir, 'queue.sqlite');
      const tier2Count = countQueuedTier2Jobs(queueDbPath);
      if (tier2Count >= 40) {
        console.log(`[MARATHON] Fast-launch: ${tier2Count} Tier-2 jobs already queued. Skipping blocking harvest/sync (<0.5s startup)!`);
      } else {
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
            const syncRes = await syncGitHubActionsPillars(queueDbPath);
            console.log(`[MARATHON] Discovery sync complete: ingested ${syncRes.newJobsIngested} new jobs.`);
            fs.writeFileSync(syncRecordPath, JSON.stringify({ timestamp: new Date().toISOString(), result: syncRes }, null, 2), 'utf8');
          } catch (err) {
            console.warn('[MARATHON] Discovery sync error (non-fatal):', err);
          }
        }

        try {
          const harvestRes = await runHourly100JobsHarvester().catch(() => null);
          if (harvestRes && harvestRes.insertedOrBoosted > 0) {
            console.log(`[MARATHON] Hourly 100+ Harvester: +${harvestRes.insertedOrBoosted} jobs inserted/boosted (raw: ${harvestRes.rawHarvested}, fit: ${harvestRes.targetFitMatched}) across ${harvestRes.databasesUpdated.length} DBs`);
          }
        } catch (err) {
          console.warn('[MARATHON] Hourly harvester notice (non-fatal):', err);
        }
      }

      // 1. Fresh queue read for eligible jobs
      const profile = loadProfile(profilePath);
      const candidateId = createHash('sha256').update(profile.personal.email.trim().toLowerCase()).digest('hex').slice(0, 20);
      const queue = new AutoaplyQueueManager({
        statePath: path.join(stateDir, 'queue.sqlite'),
        candidateId,
        infiniteMode: true,
      });

      const allQueued = queue.list('queued');
      if (allQueued.length === 0) {
        console.log(`[MARATHON] No more queued jobs remaining in queue.sqlite. Marathon complete!`);
        queue.close();
        break;
      }

      // Filter isolated tenants and ineligible non-engineering / senior roles (Ticket GEN-48)
      const eligibleQueued: AutoaplyJobItem[] = [];
      for (const j of allQueued) {
        const targetUrl = j.jobUrl || (j as any).url || (j as any).normalized_url;
        if (!j.jobUrl && targetUrl) {
          j.jobUrl = targetUrl;
        }
        // Ticket GEN-91: Fast-fail non-direct ATS jobs
        if (!targetUrl || !isSupportedDirectAtsJobUrl(targetUrl)) {
          continue;
        }
        if (isStrictlyIsolatedTenant(j.company, targetUrl)) {
          continue;
        }
        const titleCheck = isEligibleEngineeringRoleTitle(j.title);
        if (!titleCheck.eligible) {
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
        const rawFresh = (job as any).is_hourly_fresh ?? (job as any).isHourlyFresh ?? (job as any).payload?.is_hourly_fresh ?? (job as any).payload?.isHourlyFresh;
        const score = computeJobPriorityScore({
          id: job.id,
          company: job.company,
          title: job.title,
          url: job.jobUrl,
          createdAtMs,
          rowId: (job as any).rowId || 0,
          isHourlyFresh: rawFresh,
          is_hourly_fresh: typeof rawFresh === 'number' ? rawFresh : undefined,
          discoveredAt: (job as any).discoveredAt || (job as any).payload?.discoveredAt,
          hourlySource: (job as any).hourlySource || (job as any).payload?.hourlySource,
          payload: (job as any).payload,
        }, nowMs);
        return { job, score };
      }).sort((a: { job: AutoaplyJobItem; score: number }, b: { job: AutoaplyJobItem; score: number }) => {
        if (b.score !== a.score) return b.score - a.score;
        return (Number((b.job as any).rowId) || 0) - (Number((a.job as any).rowId) || 0);
      });

      // Ticket GEN-90: Drain Priority #1 (Hourly Fresh Jobs) FIRST, Backfill Queue SECOND
      const hourlyCandidates: AutoaplyJobItem[] = [];
      const backfillCandidates: AutoaplyJobItem[] = [];

      for (const item of scoredCandidates) {
        const jobAny = item.job as any;
        const rawFresh = jobAny.is_hourly_fresh ?? jobAny.isHourlyFresh ?? jobAny.payload?.is_hourly_fresh ?? jobAny.payload?.isHourlyFresh;
        const isFresh = Boolean(
          rawFresh ||
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

      // Ticket GEN-97 & GEN-283: Select Diversified Multi-Lane Chunk (85% Fast-ATS / 15% GCC, max 2 per tenant)
      const chunkJobs = selectDiversifiedMultiLaneChunk(
        prioritizedCandidates,
        chunkSize,
        (url) => isHostReadyForRequest(url, 45000, hostHealthPath)
      );

      // Ticket GEN-283 & GEN-314: Up to 6-lane shared work-stealing queue with adaptive RAM scaling
      const laneKeys = ['lane-0', 'lane-1', 'lane-2', 'lane-3', 'lane-4', 'lane-5'];
      console.log(
        `[MARATHON] [CYCLE #${cycleIndex}] Selected ${chunkJobs.length} jobs for 4-lane shared work-stealing execution across ${laneKeys.join(', ')}`
      );

      let sharedCursor = 0;
      let chunkProcessedCount = 0;
      let chunkAppliedCount = 0;

      const processJobInLane = async (
        job: AutoaplyJobItem,
        laneRunner: AutoApplyRunner,
        laneProfileDir: string,
        laneKey: string
      ): Promise<void> => {
        if (totalProcessedOverall >= maxJobs || Date.now() - marathonStartMs >= maxDurationMs) return;

        // GEN-470: 30-Day Duplicate Role Dedup Guard (0ms check)
        const appliedList = queue.list('applied');
        if (isAlreadyAppliedSameCompanyRoleWithin30Days(job.company, job.title, appliedList)) {
          queue.skip(job.id, 'already_applied_same_company_role_30d');
          console.log(`[MARATHON] Dedup guard 0ms skipped ${job.company} - ${job.title}: already applied in last 30 days.`);
          chunkProcessedCount++;
          totalProcessedOverall++;
          return;
        }

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

        // Ticket GEN-162 & GEN-282: Fast HTTP 404/410 Pre-Flight Dead-Posting Filter (<250ms)
        // Skip for is_hourly_fresh >= 2 because Tier-2 jobs were already verified alive by API harvester
        const jobFreshLevel = Number(
          (job as any).is_hourly_fresh ??
          (job as any).isHourlyFresh ??
          (job as any).payload?.is_hourly_fresh ??
          (job as any).payload?.isHourlyFresh ??
          0
        );
        if (jobFreshLevel < 2) {
          const httpPreflight = await checkJobPostingHttpAliveFast(job.jobUrl);
          if (!httpPreflight.alive) {
            console.log(`[MARATHON] Fast preflight detected closed posting (${httpPreflight.reason}) for ${job.company}`);
            queue.markFailed(job.id, 'Job posting is closed or no longer available (HTTP 404/410 pre-flight)');
            markHostOutcome(job.jobUrl, 'error', hostHealthPath);
            chunkProcessedCount++;
            totalProcessedOverall++;
            return;
          }
        }

        markHostOutcome(job.jobUrl, 'request', hostHealthPath);

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
        timeoutConfig.maxTotalMs = /greenhouse\.io|ashbyhq\.com|lever\.co/i.test(job.jobUrl) ? 180_000 : 210_000;

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
        let report: BotRunReport | undefined;

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
          report = await runWithDynamicActivityTimeout(childRunner.run(options), timeoutConfig.maxTotalMs, `Job ${job.company}`, sessionDir);
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
          const cpPath = fs.existsSync(path.join(sessionDir, 'checkpoint.json'))
            ? path.join(sessionDir, 'checkpoint.json')
            : path.resolve('state/autoapply/portal-review/applications', job.id, 'checkpoint.json');
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
          if (/timed out/i.test(report?.reason || '') || /runner closed/i.test(report?.reason || '')) {
            console.log(`[MARATHON] Job timed out in ${laneKey}; tearing down lane browser to prevent zombie lockup.`);
            await laneRunner.close().catch(() => {});
            reapStrayChromeForProfile(laneProfileDir);
            for (const lockFile of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
              try { fs.unlinkSync(path.join(laneProfileDir, lockFile)); } catch {}
            }
          }
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
        const isConfirmedApplied =
          report.status === 'submitted' ||
          (report.status as any) === 'applied' ||
          /submission confirmation observed|application submitted|thank you for applying|received your application/i.test(report.reason || '');

        if (isConfirmedApplied) {
          report.status = 'submitted';
          report.receipt ||= {
            url: job.jobUrl,
            text: report.reason || 'Submission confirmation observed',
            verifiedAt: new Date().toISOString(),
          };
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

      // Ticket GEN-283: Launch 4 shared work-stealing lanes in parallel with staggered starts
      const lanePromises = laneKeys.map(async (laneKey, idx) => {
        if (idx > 0) {
          await new Promise(r => setTimeout(r, idx * 3500));
        }

        const laneProfileDir = path.resolve('state/autoapply', `browser-profile-lane-${idx}`);
        fs.mkdirSync(laneProfileDir, { recursive: true });
        reapStrayChromeForProfile(laneProfileDir);

        for (const lockFile of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
          try { fs.unlinkSync(path.join(laneProfileDir, lockFile)); } catch {}
        }

        let laneRunner = new AutoApplyRunner();
        try {
          await laneRunner.initBrowser(headless, undefined, laneProfileDir).catch(() => {});
          while (sharedCursor < chunkJobs.length) {
            if (totalProcessedOverall >= maxJobs || Date.now() - marathonStartMs >= maxDurationMs) break;
            while (idx >= ramWatchdog.getRecommendedLanes() && sharedCursor < chunkJobs.length) {
              if (totalProcessedOverall >= maxJobs || Date.now() - marathonStartMs >= maxDurationMs) break;
              await new Promise(r => setTimeout(r, 4000));
            }
            if (sharedCursor >= chunkJobs.length) break;
            const jobIndex = sharedCursor++;
            if (jobIndex >= chunkJobs.length) break;
            const job = chunkJobs[jobIndex];
            if (!job) continue;

            try {
              if (!laneRunner.isConnected()) {
                reapStrayChromeForProfile(laneProfileDir);
                for (const lockFile of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
                  try { fs.unlinkSync(path.join(laneProfileDir, lockFile)); } catch {}
                }
                laneRunner = new AutoApplyRunner();
                await laneRunner.initBrowser(headless, undefined, laneProfileDir).catch(() => {});
              }
              await processJobInLane(job, laneRunner, laneProfileDir, laneKey);
            } catch (err: any) {
              console.error(`[MARATHON] Error in ${laneKey} for ${job.company}:`, err?.message || err);
            }
          }
        } finally {
          await laneRunner.close().catch(() => {});
        }
      });

      await Promise.all(lanePromises);

      // Ticket GEN-314: Inter-chunk full cleanup to guarantee 0 leaked chrome.exe processes
      ramWatchdog.performInterChunkFullCleanup();

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

      // GEN-54 & GEN-288: Scrub bloated browser profile caches and stale Singleton locks across lane profile directories
      const freed = scrubBrowserProfileCaches(stateDir);
      console.log(`[MARATHON] [RAM DIET] Scrubbed ${freed} cache directories across browser profiles.`);

      const allLaneDirs = [
        ...['lane-0', 'lane-1', 'lane-2', 'lane-3'].map(l => path.resolve('state/autoapply', `browser-profile-${l}`)),
        ...['lane-0', 'lane-1', 'lane-2', 'lane-3'].map(l => path.resolve('state/autoapply', `browser-profile-lane-${l}`)),
      ];
      for (const pDir of allLaneDirs) {
        if (!fs.existsSync(pDir)) continue;
        for (const target of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'Code Cache', 'GPUCache']) {
          const fullPath = path.join(pDir, target);
          try {
            if (fs.existsSync(fullPath)) {
              fs.rmSync(fullPath, { recursive: true, force: true });
            }
          } catch {}
        }
      }

      // 2) Update scoreboard and morning improvement report
      try {
        generateParkIssuesScoreboard(path.join(stateDir, 'queue.sqlite'));
        const rep = compileMorningImprovementReport();
        console.log(`[MARATHON] [REPORT] Morning Improvement Report updated at out/MORNING-IMPROVEMENT-REPORT.md.`);
        syncAppliedJobsToOutreachTargets(path.join(stateDir, 'queue.sqlite'));
      } catch (err) {
        console.error('[MARATHON] Failed compiling improvement report:', err);
      }

      // Ticket GEN-283: Inter-chunk hot reload. If compiled runner has been rebuilt since boot, respawn cleanly.
      const runnerDistPath = path.resolve('out/dist/src/autoapply/runner.js');
      if (fs.existsSync(runnerDistPath)) {
        try {
          const runnerStat = fs.statSync(runnerDistPath);
          if (runnerStat.mtimeMs > MARATHON_BOOT_MS + 5000) {
            console.log(
              `[MARATHON] Hot-reload triggered: runner.js modified (${new Date(runnerStat.mtimeMs).toISOString()} > boot ${new Date(MARATHON_BOOT_MS).toISOString()}). Cleanly respawning process...`
            );
            process.exit(0);
          }
        } catch {}
      }

      // 3) Sleep 5 seconds before next chunk
      console.log(`[MARATHON] Sleeping 5s before next 40-job chunk...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  } finally {
    ramWatchdog.stop();
    await mailbox?.close().catch(() => {});
    releaseLock(lockPath);
    reapStrayChrome();
    ramWatchdog.performInterChunkFullCleanup();
    console.log(`[MARATHON] Run completed. Total processed: ${totalProcessedOverall}, Applied: ${totalAppliedOverall}.`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (['--submit', '--headless', '--dry-run', '--no-submit'].includes(key)) {
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
  // Ticket GEN-479.1: Default submit = true unless explicitly running dry-run or no-submit
  const shouldSubmit = !process.argv.includes('--dry-run') && !process.argv.includes('--no-submit');
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
