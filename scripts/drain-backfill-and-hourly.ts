import { stopFlagPath, waitForDaemonWake, hasObservedApplicationReceipt } from '../src/autoapply/daemon-control.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { AutoaplyQueueManager } from '../src/autoapply/autoaply.js';
import { AutoApplyRunner, type AutoApplyOptions } from '../src/autoapply/runner.js';
import { CatalogueIntake, HOURLY_CATALOGUE_URL } from '../src/autoapply/intake.js';
import { preflightJob, isAtsRootUrl, isSupportedDirectAtsJobUrl } from '../src/autoapply/preflight.js';
import { canonicalRequisition, canonicalEmployerKey } from '../src/autoapply/identity.js';
import { loadProfile } from '../src/autoapply/profile.js';
import { mailboxFromEnvironment } from '../src/autoapply/mailbox.js';
import { CredentialVault } from '../src/autoapply/vault.js';
import type { AutoaplyJobItem, BotRunReport } from '../src/autoapply/types.js';
import { fetchYcHiringCompanies, fetchHnWhoIsHiringLeads, probeStartupAts } from '../src/sources/yc-hn-discovery.js';
import { fetchLinkedInLastHourJobs, matchLinkedInJobToCompany, getCompanyAtsUrl, appendCompanyRegistry, enrichLinkedInGuestJobDetail } from '../src/sources/linkedin-guest.js';
import { resolveEmployerDomain, findFreeCompanyLeads, generateColdOutreachDraft, recordOutreachLead } from '../src/leads/free-email-finder.js';
import { isHostReadyForRequest, markHostOutcome, interleaveJobsByProvider, getRateLimitKey } from '../src/autoapply/session-pool.js';
import { fastApiPreflightCheck } from '../src/autoapply/tiered-fetcher.js';
import { getProviderTimeoutConfig } from '../src/autoapply/watchdog-timer.js';
import { generateParkIssuesScoreboard } from '../src/autoapply/park-telemetry.js';
import { buildTailoredResumePair } from '../src/resume/deterministic-builder.js';
import { appendJobRunHistory } from '../src/autoapply/run-history.js';
import {
  isStrictlyIsolatedTenant,
  isEligibleEngineeringRoleTitle,
  computeJobPriorityScore,
  normalizeCompanyRoleSignature,
  isAlreadyAppliedSameCompanyRoleWithin30Days,
} from '../src/autoapply/priority-scheduler.js';
import {
  cleanStaleChromiumProfileLocks,
  recoverPowerOffAndNetOffJobs,
  isOfflineDinoOrNetworkError,
  waitUntilNetworkOnline,
} from '../src/autoapply/power-net-recovery.js';
import { startDashboardServer } from './dashboard-server.js';
import { filterUnattemptedJobs, recordAttemptedJob } from '../src/autoapply/attempted-registry.js';
import { scrubBrowserProfileCaches } from '../src/autoapply/ram-and-pacing.js';
import { syncGitHubActionsPillars } from './sync-github-actions-pillars.js';
import { ContinuousRamAndHealthWatchdog, check30MinZeroFillDroughtAndAutoHeal, ActiveJobRegistry } from '../src/autoapply/health-and-ram-watchdog.js';
import { syncInboxLifecycleEvents } from '../src/autoapply/inbox-lifecycle-tracker.js';
import { selectDiversifiedMultiLaneChunk } from './run-overnight-marathon.js';
import { harvestFastAtsJobs } from './harvest-fast-ats-jobs.js';

const STOP_FLAG_PATH = path.resolve('state/autoapply/portal-review/STOP_AUTOAPPLY.flag');

// Global crash shields: Never allow a stray Playwright/network promise rejection to kill the infinite daemon!
process.on('uncaughtException', err => {
  console.error(`[INFINITE-DAEMON] Caught uncaughtException (continuing loop): ${(err as any)?.message || err}`);
});
process.on('unhandledRejection', reason => {
  console.error(`[INFINITE-DAEMON] Caught unhandledRejection (continuing loop): ${String(reason)}`);
});

export function partitionJobsIntoProviderLanes<T extends { url?: string; jobUrl?: string; provider?: string; externalJobId?: string }>(jobs: T[]): Record<string, T[]> {
  const lanes: Record<string, T[]> = {
    greenhouse: [],
    ashby: [],
    lever: [],
    workday: [],
    smartrecruiters: [],
    other: [],
  };
  for (const job of jobs) {
    const rawUrl = (job as any).jobUrl || (job as any).url || '';
    if (!rawUrl || !isSupportedDirectAtsJobUrl(rawUrl)) {
      continue; // Filter out generic/unknown non-direct ATS URLs completely!
    }
    const u = rawUrl.toLowerCase();
    const provider = (job as any).provider?.toLowerCase() || canonicalRequisition(rawUrl, (job as any).externalJobId)?.provider?.toLowerCase() || '';
    if (u.includes('greenhouse.io') || u.includes('gh_jid=') || provider === 'greenhouse') lanes.greenhouse!.push(job);
    else if (u.includes('ashbyhq.com') || provider === 'ashby') lanes.ashby!.push(job);
    else if (u.includes('lever.co') || provider === 'lever' || u.includes('workable.com') || provider === 'workable') lanes.lever!.push(job);
    else if (u.includes('smartrecruiters.com') || provider === 'smartrecruiters') lanes.smartrecruiters!.push(job);
    else if (u.includes('myworkdayjobs.com') || provider === 'workday') lanes.workday!.push(job);
    else lanes.other!.push(job);
  }
  return lanes;
}

// Ticket GEN-284: Hard timeout default capped at 95_000ms
export async function runWithHardTimeout<T>(promise: Promise<T>, timeoutMs = 95_000, label = 'Job'): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export { isHostReadyForRequest, markHostOutcome, interleaveJobsByProvider };

interface WorkerLockInfo {
  pid: number;
  startedAt: string;
}

export function isPidRunningNode(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
  } catch (error: any) {
    return error?.code !== 'ESRCH';
  }
  if (process.platform === 'win32') {
    try {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toLowerCase();
      if (out.includes('node.exe') || out.includes('"node"')) return true;
      if (out.includes('no tasks are running')) return false;
    } catch {}
    try {
      const psOut = execSync(`powershell -NoProfile -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).ProcessName"`, {
        encoding: 'utf8',
        timeout: 4000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return psOut.toLowerCase() === 'node';
    } catch {
      return false;
    }
  } else {
    return true;
  }
}

export function acquireLock(lockPath: string): boolean {
  try {
    if (fs.existsSync(lockPath)) {
      const content = fs.readFileSync(lockPath, 'utf8');
      const info: WorkerLockInfo = JSON.parse(content);
      if (info.pid === process.pid) return true;
      if (info.pid && info.pid !== process.pid) {
        if (isPidRunningNode(info.pid)) {
          console.log(`[DRAIN] Another worker PID ${info.pid} is actively running node.exe. Exiting cleanly.`);
          return false;
        } else {
          console.log(`[DRAIN] Stale worker.lock detected (PID ${info.pid} not running node.exe). Clearing stale lock.`);
          try {
            fs.unlinkSync(lockPath);
          } catch {}
        }
      }
    }
  } catch {
    // An unreadable or partially published lock may belong to a live owner.
    return false;
  }

  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { encoding: 'utf8', flag: 'wx' });
    return true;
  } catch (err) {
    console.error('[DRAIN] Failed to write lock file:', err);
    return false;
  }
}

export function releaseLock(lockPath: string): void {
  try {
    if (fs.existsSync(lockPath)) {
      const content = fs.readFileSync(lockPath, 'utf8');
      const info: WorkerLockInfo = JSON.parse(content);
      if (info.pid === process.pid) {
        fs.unlinkSync(lockPath);
      }
    }
  } catch {}
}

export function resetEligiblePausedJobs(dbPath: string): number {
  if (!fs.existsSync(dbPath)) return 0;
  const db = new DatabaseSync(dbPath);
  try {
    // Reviews and unknown submission outcomes require reconciliation, never a company-name reset.
    const result = db.prepare(`
      UPDATE applications
      SET status = 'queued', payload = json_set(payload, '$.status', 'queued',
        '$.retryCount', COALESCE(json_extract(payload, '$.retryCount'), json_extract(payload, '$.retry_count'), 0) + 1)
      WHERE status = 'failed'
        AND COALESCE(json_extract(payload, '$.retryCount'), json_extract(payload, '$.retry_count'), 0) < 3
        AND json_extract(payload, '$.receipt') IS NULL
        AND COALESCE(json_extract(payload, '$.submissionAttempted'), 0) = 0
        AND COALESCE(json_extract(payload, '$.submission.phase'), '') NOT IN ('clicked', 'dispatched', 'confirmed')
        AND COALESCE(json_extract(payload, '$.reasonCode'), '') <> 'AMBIGUOUS_DISPATCH'
        AND (json_extract(payload, '$.error') LIKE '%browserType.launch%'
          OR json_extract(payload, '$.error') LIKE '%launchPersistentContext%'
          OR json_extract(payload, '$.reason') LIKE '%browserType.launch%'
          OR json_extract(payload, '$.reason') LIKE '%launchPersistentContext%')
    `).run();
    return Number(result.changes);
  } finally { db.close(); }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (['--submit', '--headless', '--skip-sync', '--force-sync', '--once', '--dry-run', '--no-submit'].includes(key)) {
      flags.add(key);
    } else if (
      ['--profile', '--state', '--max-jobs', '--max-cycles', '--time-budget', '--time-budget-minutes', '--catalog-url'].includes(key) &&
      args[i + 1] &&
      !args[i + 1]!.startsWith('--')
    ) {
      values.set(key, args[++i]!);
    }
  }

  const rawProfileArg = values.get('--profile');
  const profilePath = path.resolve(
    !rawProfileArg || rawProfileArg === 'autoapply'
      ? 'state/autoapply/portal-review/candidate.json'
      : rawProfileArg
  );
  const stateDir = path.resolve(values.get('--state') || 'state/autoapply/portal-review');
  // Ticket GEN-479.1: Default submit = true unless explicitly running dry-run or no-submit
  const shouldSubmit = !process.argv.includes('--dry-run') && !process.argv.includes('--no-submit');
  const headless = true;
  const maxJobs = values.has('--max-jobs') ? parseInt(values.get('--max-jobs')!, 10) : 60;
  const maxCycles = values.has('--max-cycles') ? parseInt(values.get('--max-cycles')!, 10) : Infinity;
  const timeBudgetMinutes = values.has('--time-budget-minutes')
    ? parseInt(values.get('--time-budget-minutes')!, 10)
    : values.has('--time-budget')
      ? parseInt(values.get('--time-budget')!, 10)
      : 50;
  const skipSync = flags.has('--skip-sync');
  const forceSync = flags.has('--force-sync');
  const discoveryCachePath = path.join(stateDir, 'last-discovery-sync.json');

  if (!Number.isInteger(maxJobs) || maxJobs < 1 || !Number.isFinite(timeBudgetMinutes) || timeBudgetMinutes <= 0) {
    throw new Error('Job count and time budget must be positive numbers');
  }
  if (fs.existsSync(stopFlagPath(stateDir))) return;
  const lockPath = path.join(stateDir, 'worker.lock');
  if (!acquireLock(lockPath)) return;
  process.once('exit', () => releaseLock(lockPath));
  const ramWatchdog = new ContinuousRamAndHealthWatchdog(45_000);
  ramWatchdog.start();
  const dashboard = startDashboardServer(4321);
  (dashboard as any)?.unref?.();
  let stopRequested = false;
  const stopping = () => stopRequested || fs.existsSync(stopFlagPath(stateDir));
  const requestStop = () => { stopRequested = true; };
  const onHangup = () => { if (fs.existsSync(stopFlagPath(stateDir))) requestStop(); };
  process.on('SIGINT', requestStop);
  process.on('SIGTERM', requestStop);
  process.on('SIGHUP', onHangup);

  const runnerDistPath = path.resolve('out/dist/src/autoapply/runner.js');
  const bootTimeMs = fs.existsSync(runnerDistPath) ? fs.statSync(runnerDistPath).mtimeMs : Date.now();

  if (process.platform === 'win32') {
    const dTemp = path.resolve('out/test-temp');
    try { fs.mkdirSync(dTemp, { recursive: true }); } catch {}
    process.env.TEMP = dTemp;
    process.env.TMP = dTemp;
  }

  try {
    process.loadEnvFile();
  } catch {}

  const profile = loadProfile(profilePath);
  const candidateId = createHash('sha256').update(profile.personal.email.trim().toLowerCase()).digest('hex').slice(0, 20);
  const dbPath = path.join(stateDir, 'queue.sqlite');

  // GEN-53: Clean stale Chromium profile locks and recover power-off / net-off jobs
  const cleanedLocks = cleanStaleChromiumProfileLocks(stateDir);
  const recovery = recoverPowerOffAndNetOffJobs(dbPath);
  if (cleanedLocks > 0 || recovery.recoveredInFlight > 0 || recovery.recoveredNetOffDino > 0) {
    console.log(
      `[DRAIN] Startup recovery: cleaned ${cleanedLocks} profile locks, ` +
        `recovered ${recovery.recoveredInFlight} in-flight and ${recovery.recoveredNetOffDino} net-off dino jobs.`
    );
  }

  // Step 1: Re-queue eligible paused jobs
  const resetCount = resetEligiblePausedJobs(dbPath);
  if (resetCount > 0) {
    console.log(`[DRAIN] Reset ${resetCount} previously paused jobs back to queued for GEN-15 self-learning retry.`);
  }

  const queue = new AutoaplyQueueManager({
    statePath: dbPath,
    candidateId,
    infiniteMode: true,
  });

  const mailbox = mailboxFromEnvironment();
  const vault = new CredentialVault(path.join(stateDir, 'vault'));

  try {
    let discoveryHasRun = false;
    const syncDiscovery = async () => {
      if (skipSync) return;
      // Ingest fast-ATS jobs from companies.json
      try {
        await harvestFastAtsJobs(dbPath, 30);
      } catch (err: any) {
        console.warn(`[DRAIN] Fast-ATS harvest warning: ${err?.message || err}`);
      }

    // Phase A: Hourly Fresh Sync (fetch fresh postings from catalogue + YC/HN/LinkedIn)
    let shouldRunPhaseA = !skipSync;
    if (shouldRunPhaseA && !(forceSync && !discoveryHasRun) && fs.existsSync(discoveryCachePath)) {
      try {
        const cache = JSON.parse(fs.readFileSync(discoveryCachePath, 'utf8'));
        if (cache?.lastSyncAt) {
          const ageMs = Date.now() - new Date(cache.lastSyncAt).getTime();
          const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
          if (ageMs < FIFTEEN_MINUTES_MS) {
            shouldRunPhaseA = false;
          }
        }
      } catch {}
    }

    if (shouldRunPhaseA) {
      discoveryHasRun = true;
      let ingestedCount = 0;
      try {
        const intake = new CatalogueIntake({
          source: values.get('--catalog-url') || HOURLY_CATALOGUE_URL,
          stateDir,
          queue,
          profile: () => profile,
        });
        const syncResult = await intake.poll(AbortSignal.timeout(30000));
        console.log(`[DRAIN] Fresh Sync: ${JSON.stringify(syncResult)}`);
        ingestedCount += (syncResult?.imported || 0);
      } catch (err: any) {
        console.warn(`[DRAIN] Fresh sync warning (continuing drain): ${err?.message || err}`);
      }

      // GEN-17 & GEN-18: Ingest fresh postings from YC, HN Who Is Hiring & LinkedIn Guest API
      try {
        const [ycLeads, hnLeads, linkedInJobs] = await Promise.allSettled([
          fetchYcHiringCompanies(),
          fetchHnWhoIsHiringLeads(),
          fetchLinkedInLastHourJobs(),
        ]);
        let freshDiscoveredCount = 0;
        const EXCLUDED_DISCOVERY = /stripe|avoca|ssctech|paypal/i;

        const allStartupLeads = [
          ...(ycLeads.status === 'fulfilled' ? ycLeads.value : []),
          ...(hnLeads.status === 'fulfilled' ? hnLeads.value : []),
        ];

        let probedCount = 0;
        for (const lead of allStartupLeads) {
          if (!lead.company || EXCLUDED_DISCOVERY.test(lead.company) || (lead.applyUrl && EXCLUDED_DISCOVERY.test(lead.applyUrl))) continue;
          let directAtsUrl = lead.applyUrl;
          const matched = matchLinkedInJobToCompany(lead.company);
          if (!matched && !directAtsUrl) {
            if (probedCount < 15) {
              const slug = (lead.domain ? lead.domain.split('.')[0] : lead.company.toLowerCase().replace(/[^a-z0-9-]/g, '')) || '';
              if (slug && slug.length >= 2) {
                probedCount++;
                const probe = await probeStartupAts(slug).catch(() => null);
                if (probe) {
                  appendCompanyRegistry({
                    name: lead.company,
                    ats: probe.ats,
                    industry: 'tech',
                    source: 'discovered',
                    token: slug,
                  });
                  directAtsUrl = probe.sampleJobUrl || probe.boardUrl;
                }
              }
            }
          } else if (matched) {
            const atsUrl = getCompanyAtsUrl(matched);
            if (atsUrl) directAtsUrl = atsUrl;
          }

          if (directAtsUrl && URL.canParse(directAtsUrl) && !EXCLUDED_DISCOVERY.test(directAtsUrl)) {
            try {
              const nowIso = new Date().toISOString();
              const hourlySrc = lead.source === 'yc_hiring_api' ? ('yc_hiring' as const) : ('hn_hiring' as const);
              const queuedItem = queue.enqueue({
                externalJobId: `${lead.source === 'yc_hiring_api' ? 'yc' : 'hn'}_${createHash('sha256').update(directAtsUrl).digest('hex').slice(0, 16)}`,
                title: lead.roleTitle,
                company: lead.company,
                jobUrl: directAtsUrl,
                location: lead.location,
                postedAt: '',
              });
              (queuedItem as any).isHourlyFresh = false;
              (queuedItem as any).discoveredAt = nowIso;
              (queuedItem as any).hourlySource = hourlySrc;
              try {
                const hourlyFile = path.resolve('state/autoapply/portal-review/hourly-discoveries.jsonl');
                fs.mkdirSync(path.dirname(hourlyFile), { recursive: true });
                fs.appendFileSync(hourlyFile, JSON.stringify({
                  id: queuedItem.id,
                  title: lead.roleTitle,
                  company: lead.company,
                  jobUrl: directAtsUrl,
                  location: lead.location,
                  status: 'queued',
                  postedAt: '',
                  isHourlyFresh: false,
                  discoveredAt: nowIso,
                  hourlySource: hourlySrc,
                }) + '\n', 'utf8');
              } catch {}
              freshDiscoveredCount++;
            } catch {}
          }
        }

        if (linkedInJobs.status === 'fulfilled') {
          for (const rawJob of linkedInJobs.value) {
            if (EXCLUDED_DISCOVERY.test(rawJob.company)) continue;
            const matched = matchLinkedInJobToCompany(rawJob.company);
            if (matched) {
              const directAtsUrl = getCompanyAtsUrl(matched);
              if (directAtsUrl && URL.canParse(directAtsUrl) && !EXCLUDED_DISCOVERY.test(directAtsUrl)) {
                try {
                  const job = await enrichLinkedInGuestJobDetail(rawJob).catch(() => rawJob);
                  const nowIso = new Date().toISOString();
                  const queuedItem = queue.enqueue({
                    externalJobId: `li_${job.jobId}`,
                    title: job.title,
                    company: job.company,
                    jobUrl: directAtsUrl,
                    location: job.location,
                    postedAt: '',
                  });
                  (queuedItem as any).isHourlyFresh = false;
                  (queuedItem as any).discoveredAt = nowIso;
                  (queuedItem as any).hourlySource = 'linkedin_1h';
                  try {
                    const hourlyFile = path.resolve('state/autoapply/portal-review/hourly-discoveries.jsonl');
                    fs.mkdirSync(path.dirname(hourlyFile), { recursive: true });
                    fs.appendFileSync(hourlyFile, JSON.stringify({
                      id: queuedItem.id,
                      title: job.title,
                      company: job.company,
                      jobUrl: directAtsUrl,
                      location: job.location,
                      status: 'queued',
                      postedAt: '',
                      sourceListedAt: job.listedAt,
                      isHourlyFresh: false,
                      discoveredAt: nowIso,
                      hourlySource: 'linkedin_1h',
                    }) + '\n', 'utf8');
                  } catch {}
                  freshDiscoveredCount++;

                  if (job.recruiterName || job.recruiterProfileUrl) {
                    const domain = await resolveEmployerDomain(job.company, directAtsUrl);
                    findFreeCompanyLeads({
                      company: job.company,
                      domain,
                      personName: job.recruiterName,
                      personTitle: job.recruiterTitle,
                      linkedinUrl: job.recruiterProfileUrl,
                    }).then(lead => {
                      const draft = generateColdOutreachDraft(job.company, job.title, lead, profile);
                      recordOutreachLead(draft);
                    }).catch(() => {});
                  }
                } catch {}
              }
            }
          }
        }
        ingestedCount += freshDiscoveredCount;
        console.log(`[DRAIN] YC/HN/LinkedIn Discovery Ingestion: processed ${freshDiscoveredCount} postings.`);
      } catch (err: any) {
        console.warn(`[DRAIN] Discovery ingestion warning: ${err?.message || err}`);
      }

      // GEN-55: Sync all 7 GitHub Actions workflows safely from origin/main
      try {
        const pillarSync = await syncGitHubActionsPillars(dbPath);
        if (pillarSync.fetched) {
          console.log(`[DRAIN] GitHub Actions sync: offices=${pillarSync.officesSynced}, companies=${pillarSync.companiesSynced}, newJobs=${pillarSync.newJobsIngested}`);
        }
      } catch {}

      try {
        fs.writeFileSync(
          discoveryCachePath,
          JSON.stringify({ lastSyncAt: new Date().toISOString(), ingestedCount }, null, 2),
          'utf8'
        );
      } catch (err: any) {
        console.warn(`[DRAIN] Failed to write discovery cache: ${err?.message || err}`);
      }
    }

    };

    // Phase B: Continuous Autonomous Drain Loop (Step 421 / GEN-421)
    // Ticket GEN-506 & GEN-526: Continuous runner runs indefinitely unless STOP_AUTOAPPLY.flag is present
    const isContinuousSubmit = shouldSubmit;
    let batchNumber = 0;

    while (!stopping() && batchNumber < maxCycles) {
      batchNumber++;
      const cycleStartMs = Date.now();
      const cycleBudgetMs = Math.min(timeBudgetMinutes * 60 * 1000, 25 * 60 * 1000);
      const cycleDeadline = cycleStartMs + cycleBudgetMs;
      const targetChunkSize = Math.min(maxJobs, 20);
      const idleWaitMs = maxCycles < Infinity ? 200 : 30_000;
      let processedCount = 0;
      let startedJobs = 0;
      let appliedCount = 0;
      let runningLanes = 0;
      const loggedDeferredHosts = new Set<string>();

      console.log(`\n================================================================`);
      console.log(`[INFINITE-DAEMON] 🚀 STARTING CYCLE #${batchNumber} at ${new Date(cycleStartMs).toISOString()}`);
      console.log(`================================================================`);

      try {
        const stopFlag = stopFlagPath(stateDir);
        if (stopping()) {
          console.log(`[DRAIN] STOP_AUTOAPPLY.flag detected at ${stopFlag}. Explicit operator stop requested. Exiting loop.`);
          break;
        }

        await syncDiscovery();
        if (stopping()) break;

        try {
          const docReport = check30MinZeroFillDroughtAndAutoHeal({ stateDir });
          if (docReport.healed) {
            console.log(`[DRAIN] Doctor self-healing applied: actions=[${docReport.actionsTaken.join(', ')}]`);
          }
        } catch {}

        if (!skipSync) {
          try {
            syncInboxLifecycleEvents(25).catch(() => {});
          } catch {}
        }

        const allJobs = queue.list();
        const eligible: AutoaplyJobItem[] = [];
        for (const job of allJobs) {
          if (job.status !== 'queued') continue;
          // Ticket GEN-91: Fast-fail non-direct ATS jobs (filter in-memory without blocking disk writes)
          if (!isSupportedDirectAtsJobUrl(job.jobUrl)) continue;
          if (isStrictlyIsolatedTenant(job.company, job.jobUrl)) continue;
          const titleCheck = isEligibleEngineeringRoleTitle(job.title);
          if (!titleCheck.eligible) continue;
          eligible.push(job);
        }

        if (eligible.length === 0) {
          if ((!isContinuousSubmit && maxCycles === Infinity) || batchNumber >= maxCycles) break;
          console.log('[DRAIN] Queue idle; waiting for new work.');
          await waitForDaemonWake(stateDir, idleWaitMs, stopping);
          continue;
        }

        // Ticket GEN-524: Auto-refill fast-ATS pool if queued fast-ATS jobs are low
        const queuedFastAtsCount = eligible.filter(j =>
          /(?:greenhouse\.io|gh_jid=|ashbyhq\.com|lever\.co|workable\.com|recruitee\.com|breezy\.hr)/i.test(j.jobUrl)
        ).length;
        if (queuedFastAtsCount < 40 && !skipSync) {
          console.log(`[DRAIN] Queued fast-ATS count (${queuedFastAtsCount}) below 40. Auto-harvesting next 800 boards...`);
          try {
            await harvestFastAtsJobs(dbPath, 120);
          } catch (err: any) {
            console.warn(`[DRAIN] Auto-harvest warning: ${err?.message || err}`);
          }
        }

        // Ticket GEN-474: Filter out previously attempted jobs while treating SQLite status = 'queued' as authoritative
        const freshQueued = filterUnattemptedJobs(eligible);
        if (freshQueued.length === 0) {
          if ((!isContinuousSubmit && maxCycles === Infinity) || batchNumber >= maxCycles) break;
          await waitForDaemonWake(stateDir, idleWaitMs, stopping);
          continue;
        }

      // Schwartzian transform: compute priority scores once in O(N) rather than O(N log N) inside .sort()
      const now = Date.now();
      const scoredCandidates = freshQueued.map((job) => {
        const aDateStr = (job as any).createdAt || job.postedAt;
        const aTime = Date.parse(aDateStr || '0') || 0;
        const score = computeJobPriorityScore({
          id: job.id,
          company: job.company,
          title: job.title,
          url: job.jobUrl || (job as any).url,
          createdAtMs: aTime,
          rowId: (job as any).rowId || 0,
          isHourlyFresh: Boolean((job as any).isHourlyFresh || (job as any).payload?.isHourlyFresh || (job as any).hourlySource),
          discoveredAt: (job as any).discoveredAt || (job as any).payload?.discoveredAt,
          payload: { ...(job as any).payload, postedAt: (job as any).payload?.postedAt ?? job.postedAt },
        }, now);
        return { job, score };
      });
      scoredCandidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (Number((b.job as any).rowId) || 0) - (Number((a.job as any).rowId) || 0);
      });
      const sortedEligible = scoredCandidates.map((s) => s.job);

      const hostHealthPath = path.join(stateDir, 'host-health.json');
      // Ticket GEN-513, GEN-520 & GEN-524: Multi-lane chunk selection capping Workday <= 2 and SR <= 2
      const chunkCandidates = selectDiversifiedMultiLaneChunk(
        sortedEligible,
        targetChunkSize * 2,
        (url) => isHostReadyForRequest(url, 45000, hostHealthPath)
      );
      const verifiedChunkJobs: AutoaplyJobItem[] = [];
      let workdayInChunk = 0;
      let srInChunk = 0;

      for (const cand of chunkCandidates) {
        if (verifiedChunkJobs.length >= targetChunkSize) break;
        const isWd = /myworkdayjobs\.com|myworkdaysite\.com/i.test(cand.jobUrl);
        const isSr = /smartrecruiters\.com|smartr\.me/i.test(cand.jobUrl);
        if (isWd && workdayInChunk >= 2) continue;
        if (isSr && srInChunk >= 2) continue;

        const preflight = await fastApiPreflightCheck(cand.jobUrl).catch(() => ({ status: 'eligible' as const }));
        if (preflight.status === 'skipped') {
          try {
            queue.skip(cand.id, preflight.reason || 'fast_api_preflight_skipped');
            const dbFast = new DatabaseSync(dbPath);
            dbFast.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 15000;');
            dbFast.prepare(`UPDATE applications SET status = 'skipped', last_error = ? WHERE id = ?`).run(`preflight_${preflight.reason || 'skipped'}`, cand.id);
            dbFast.close();
          } catch {}
          continue;
        }
        if (isWd) workdayInChunk++;
        if (isSr) srInChunk++;
        verifiedChunkJobs.push(cand);
      }

      if (verifiedChunkJobs.length === 0) {
        if ((!isContinuousSubmit && maxCycles === Infinity) || batchNumber >= maxCycles) break;
        await waitForDaemonWake(stateDir, idleWaitMs, stopping);
        continue;
      }
      const candidatePool = verifiedChunkJobs;
      const lanes = partitionJobsIntoProviderLanes(candidatePool);
      const activeLanes = (Object.keys(lanes) as Array<keyof typeof lanes>).filter(k => (lanes[k]?.length ?? 0) > 0);
      console.log(
        `[DRAIN] Selected ${candidatePool.length} diversified multi-lane chunk jobs (out of ${eligible.length} queued) partitioned into: ${activeLanes.map(k => `${k}(${lanes[k]?.length ?? 0})`).join(', ')}. Running drain (budget: ${(cycleBudgetMs / 60000).toFixed(0)}m, max: ${targetChunkSize})...`
      );

    const startTime = Date.now();
    const maxDurationMs = timeBudgetMinutes * 60 * 1000;
    let processedCount = 0;
    let startedJobs = 0;
    let runningLanes = 0;
    let appliedCount = 0;
    const loggedDeferredHosts = new Set<string>();

    const processSingleJob = async (
      job: AutoaplyJobItem,
      laneRunner: AutoApplyRunner,
      laneProfileDir: string,
      laneKey = 'default'
    ): Promise<void> => {
      if (stopping() || startedJobs >= maxJobs || Date.now() - startTime >= maxDurationMs) return;

      // GEN-470: 30-Day Duplicate Role Dedup Guard (0ms check)
      const appliedList = queue.list('applied');
      if (isAlreadyAppliedSameCompanyRoleWithin30Days(job.company, job.title, appliedList)) {
        queue.skip(job.id, 'already_applied_same_company_role_30d');
        console.log(`[DRAIN] Dedup guard 0ms skipped ${job.company} - ${job.title}: already applied in last 30 days.`);
        return;
      }

      // Host cooldown check (GEN-28: 45s cooldown per host, 15-60m backoff on rate limit/challenge)
      if (!isHostReadyForRequest(job.jobUrl, 45000, hostHealthPath)) {
        const hostKey = getRateLimitKey(job.jobUrl);
        if (!loggedDeferredHosts.has(hostKey)) {
          loggedDeferredHosts.add(hostKey);
          console.log(`[DRAIN] Host cooldown/backoff active for ${hostKey}, deferring job.`);
        }
        return;
      }

      // Fast JSON API Preflight Check (GEN-29: Greenhouse / Lever fast check before browser launch)
      const fastApi = await fastApiPreflightCheck(job.jobUrl).catch(() => ({ status: 'eligible' as const }));
      if (fastApi.status === 'skipped') {
        queue.skip(job.id, fastApi.reason || 'fast_api_preflight_skipped');
        console.log(`[DRAIN] Fast API preflight skipped ${job.company}: ${fastApi.reason}`);
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

      startedJobs++;

      const sessionDir = path.join(
        stateDir,
        'applications',
        createHash('sha256').update(job.canonicalKey || job.jobUrl).digest('hex').slice(0, 20)
      );

      if (!laneRunner.isConnected()) {
        await laneRunner.close().catch(() => {});
        await laneRunner.initBrowser(headless, undefined, laneProfileDir).catch(() => {});
      }

      let childRunner: AutoApplyRunner;
      try {
        childRunner = await laneRunner.forkApplicationContext(path.join(sessionDir, 'storage-state.json'));
      } catch {
        await laneRunner.close().catch(() => {});
        await laneRunner.initBrowser(headless, undefined, laneProfileDir).catch(() => {});
        try {
          childRunner = await laneRunner.forkApplicationContext(path.join(sessionDir, 'storage-state.json'));
        } catch {
          childRunner = await laneRunner.forkApplication(laneProfileDir, headless);
        }
      }

      const timeoutConfig = getProviderTimeoutConfig(job.jobUrl);

      // Generate tailored resume for the job archetype (GEN-42)
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
        lane: String(laneKey),
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
      // Ticket GEN-102: Wait until network online BEFORE starting hard timeout clock
      await waitUntilNetworkOnline();

      try {
        report = await runWithHardTimeout(childRunner.run(options), timeoutConfig.maxTotalMs, `Job ${job.company}`);
      } catch (err: any) {
        const isNetDrop = isOfflineDinoOrNetworkError(err?.message || '') ||
          /\b(Wi-Fi \/ DNS drop|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_CONNECTION_TIMED_OUT|network.*offline)\b/i.test(err?.message || '');

        report = {
          mode: 'stealth',
          url: job.jobUrl,
          ats: 'unknown',
          startTime: jobStartedAt,
          endTime: new Date().toISOString(),
          durationMs: Date.now() - jobStartMs,
          fieldsFound: 0,
          fieldsFilled: 0,
          unmappedFields: 0,
          stepsTraversed: 0,
          status: isNetDrop ? 'queued' : 'failed',
          reason: isNetDrop ? 'wifi_drop_requeued' : (err?.message || 'Execution failed'),
          actions: [],
          logs: [],
        };
        if (isNetDrop) {
          console.log(`[DRAIN] Wi-Fi / DNS drop detected during ${job.company}; kept queued for retry.`);
          await waitUntilNetworkOnline();
        }
      } finally {
        await childRunner.close().catch(() => {});
        if (/timed out/i.test(report?.reason || '') || /runner closed/i.test(report?.reason || '')) {
          await laneRunner.close().catch(() => {});
          for (const lockFile of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
            try { fs.unlinkSync(path.join(laneProfileDir, lockFile)); } catch {}
          }
        }
      }

      const jobFinishedAt = report.endTime || new Date().toISOString();
      const durationMs = report.durationMs || (Date.now() - jobStartMs);

      processedCount++;
      const isRateLimited = report.logs.some(l => /rate[- ]limit|429/i.test(l)) || /rate[- ]limit|too many requests/i.test(report.reason || '');
      const isChallenge = report.logs.some(l => /challenge|captcha|cloudflare/i.test(l)) || /challenge|captcha/i.test(report.reason || '') || report.reason === 'captcha_deferred';

      if (isRateLimited) {
        markHostOutcome(job.jobUrl, 'rate_limited', hostHealthPath);
      } else if (isChallenge) {
        markHostOutcome(job.jobUrl, 'challenge', hostHealthPath);
      } else if (report.status === 'submitted') {
        markHostOutcome(job.jobUrl, 'success', hostHealthPath);
      } else if (report.status === 'failed') {
        markHostOutcome(job.jobUrl, 'error', hostHealthPath);
      } else {
        markHostOutcome(job.jobUrl, 'success', hostHealthPath);
      }

      const isConfirmedApplied = hasObservedApplicationReceipt(report);
      if ((report.status === 'submitted' || (report.status as string) === 'applied') && !isConfirmedApplied) {
        report.status = 'paused_for_review';
        report.reason = 'Submission lacks observed receipt; reconcile before retrying';
      }
      if (isConfirmedApplied) {
        report.status = 'submitted';
        appliedCount++;
        queue.markApplied(job.id, report.receipt!);
        try {
          const domain = await resolveEmployerDomain(job.company, job.jobUrl);
          const lead = await findFreeCompanyLeads({
            company: job.company,
            domain,
          });
          const draft = generateColdOutreachDraft(job.company, job.title, lead, profile);
          recordOutreachLead(draft);
        } catch {}
      } else if (report.status === 'paused_for_review') {
        queue.pauseForReview(job.id, report.reason);
        if (job.retryCount) {
          const pausedItem = (queue as any).queue?.get(job.id);
          if (pausedItem) {
            pausedItem.retryCount = job.retryCount;
            (queue as any).persist(pausedItem);
          }
        }
      } else if (report.status === 'skipped') {
        queue.skip(job.id, report.reason);
      } else if (report.status === 'queued' || report.reason === 'service_temporarily_unavailable' || report.reason === 'wifi_drop_requeued') {
        if (report.reason === 'service_temporarily_unavailable') {
          markHostOutcome(job.jobUrl, 'rate_limited', hostHealthPath);
        }
        console.log(`[DRAIN] Maintenance/network retry on ${job.company}; kept queued with 0 attempt penalty.`);
      } else {
        queue.markFailed(job.id, report.reason || 'Unknown error');
      }

      const statusMap: Record<string, 'applied' | 'failed' | 'paused_for_review' | 'skipped' | 'queued'> = {
        submitted: 'applied',
        applied: 'applied',
        queued: 'queued',
        failed: 'failed',
        paused_for_review: 'paused_for_review',
        skipped: 'skipped',
      };
      const finalStatus = statusMap[report.status] || 'failed';
      const provider = (job as any).provider || canonicalRequisition(job.jobUrl, job.externalJobId)?.provider || report.ats || 'ats';

      if (!report.endTime || report.endTime === jobStartedAt) {
        appendJobRunHistory({
          jobId: job.id,
          company: job.company,
          title: job.title,
          provider,
          lane: String(laneKey),
          url: job.jobUrl,
          status: finalStatus,
          reason: report.reason || finalStatus,
          fieldsFilled: report.fieldsFilled || 0,
          startedAt: jobStartedAt,
          finishedAt: jobFinishedAt,
          durationMs,
          receiptVerified: isConfirmedApplied,
        });
      }

      // Ticket GEN-474: Record attempted job to persistent registry
      if (report.status !== 'queued' && report.reason !== 'service_temporarily_unavailable' && report.reason !== 'wifi_drop_requeued') {
        recordAttemptedJob({
          jobId: job.id,
          url: job.jobUrl,
          company: job.company,
          status: finalStatus,
        });
      }

      const qItem = (queue as any).queue?.get(job.id);
      if (qItem) {
        qItem.lastRunStartedAt = jobStartedAt;
        qItem.lastRunFinishedAt = jobFinishedAt;
        qItem.durationMs = durationMs;
        qItem.fieldsFilled = report.fieldsFilled || 0;
        qItem.lane = String(laneKey);
        qItem.provider = provider;
        try { (queue as any).persist(qItem); } catch {}
      }

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
        `).run(jobStartedAt, jobFinishedAt, durationMs, report.fieldsFilled || 0, String(laneKey), provider, job.id);
      } catch {}

      const remainingBackfill = queue.list().filter(j => j.status === 'queued').length;
      console.log(
        `[DRAIN ${processedCount}/${maxJobs}] ${report.status === 'submitted' ? 'Applied' : 'Processed'}: ${job.company} (${report.status}${report.reason ? ': ' + report.reason : ''}) | Duration: ${(durationMs / 1000).toFixed(1)}s | Remaining Backfill: ${remainingBackfill}`
      );
    };

    const runLane = async (laneKey: keyof typeof lanes): Promise<void> => {
      const jobs = lanes[laneKey] || [];
      if (jobs.length === 0) return;
      while (!stopping() && runningLanes >= ramWatchdog.getRecommendedLanes() && Date.now() - startTime < maxDurationMs) {
        await waitForDaemonWake(stateDir, 1000, stopping);
      }
      if (stopping() || startedJobs >= maxJobs || Date.now() - startTime >= maxDurationMs) return;
      runningLanes++;
      ActiveJobRegistry.add(`drain-lane:${laneKey}`);
      const laneProfileDir = path.resolve('state/autoapply', `browser-profile-lane-${laneKey}`);
      const laneRunner = new AutoApplyRunner();
      try {
        fs.mkdirSync(laneProfileDir, { recursive: true });
        let initialized = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await laneRunner.initBrowser(headless, undefined, laneProfileDir);
            initialized = true;
            break;
          } catch (initErr: any) {
            console.warn(`[DRAIN] Lane ${laneKey} launch attempt ${attempt} failed: ${initErr?.message || initErr}. Retrying in ${attempt * 3}s...`);
            await new Promise(r => setTimeout(r, attempt * 3000));
          }
        }
        if (!initialized) {
          console.error(`[DRAIN] Lane ${laneKey} failed to initialize after 3 attempts.`);
          return;
        }

        for (const job of jobs) {
          if (stopping() || startedJobs >= targetChunkSize || Date.now() >= cycleDeadline) break;
          try {
            if (!laneRunner.isConnected()) {
              await laneRunner.close().catch(() => {});
              await laneRunner.initBrowser(headless, undefined, laneProfileDir).catch(() => {});
            }
            await processSingleJob(job, laneRunner, laneProfileDir, String(laneKey));
          } catch (err: any) {
            console.error(`[DRAIN] Unhandled error processing job ${job.company} in lane ${laneKey}:`, err?.message || err);
            await laneRunner.close().catch(() => {});
          }
        }
      } catch (err: any) {
        console.error(`[DRAIN] Lane ${laneKey} error:`, err?.message || err);
      } finally {
        await laneRunner.close().catch(() => {});
        runningLanes--;
        ActiveJobRegistry.delete(`drain-lane:${laneKey}`);
      }
    };

    // Stagger lane launches by 3.5s to prevent concurrent browser initialization spikes
    await Promise.all(
      activeLanes.map(async (k, idx) => {
        if (idx > 0) {
          await new Promise(r => setTimeout(r, idx * 3500));
        }
        return runLane(k);
      })
    );

    console.log(`[DRAIN] [Batch #${batchNumber}] Completed batch execution (${processedCount} processed, ${appliedCount} applied).`);
      } catch (cycleErr: any) {
        console.error(`[INFINITE-DAEMON] ⚠️ Cycle #${batchNumber} error (recovering in 8s): ${cycleErr?.message || cycleErr}`);
      }

      if (stopping() || batchNumber >= maxCycles) {
        break;
      }

      if (processedCount === 0) await waitForDaemonWake(stateDir, idleWaitMs, stopping);
      if (stopping() || batchNumber >= maxCycles) break;

      // Step 421 (GEN-421): Inter-chunk cleanup between batches
      console.log(`[DRAIN] Performing inter-batch full cleanup and checking hot-respawn...`);
      ramWatchdog.performInterChunkFullCleanup();
      const freed = scrubBrowserProfileCaches(stateDir);
      if (freed > 0) {
        console.log(`[DRAIN] [RAM DIET] Scrubbed ${freed} cache directories across browser profiles.`);
      }

      // Hot-respawn check if out/dist/src/autoapply/runner.js was recompiled
      if (fs.existsSync(runnerDistPath)) {
        const currentMtime = fs.statSync(runnerDistPath).mtimeMs;
        if (currentMtime > bootTimeMs) {
          console.log(`[DRAIN] Recompiled runner.js detected (${new Date(currentMtime).toISOString()} > ${new Date(bootTimeMs).toISOString()}). Hot-respawning continuous daemon...`);
          ramWatchdog.stop();
          await mailbox?.close().catch(() => {});
          queue.close();
          releaseLock(lockPath);
          const { spawn } = await import('node:child_process');
          const child = spawn(process.execPath, process.argv.slice(1), {
            detached: true,
            stdio: 'ignore',
          });
          (child as any)?.unref?.();
          process.exit(0);
        }
      }

      // Breather between cycles to flush OS sockets and GC
      const breatherMs = maxCycles < Infinity ? 200 : 8000;
      console.log(`[INFINITE-DAEMON] Breather ${breatherMs}ms before Cycle #${batchNumber + 1}...`);
      await new Promise(r => setTimeout(r, breatherMs));
    }
} finally {
    ramWatchdog.stop();
    process.off('SIGINT', requestStop);
    process.off('SIGTERM', requestStop);
    process.off('SIGHUP', onHangup);
    dashboard.close();
    await mailbox?.close().catch(() => {});
    try {
      generateParkIssuesScoreboard(path.join(stateDir, 'queue.sqlite'));
    } catch (e) {
      console.error('[DRAIN] Failed to generate park scoreboard:', e);
    }
    queue.close();
    releaseLock(lockPath);
    ramWatchdog.performInterChunkFullCleanup();
    const freed = scrubBrowserProfileCaches(stateDir);
    if (freed > 0) {
      console.log(`[DRAIN] [RAM DIET] Scrubbed ${freed} cache directories across browser profiles.`);
    }
  }
}

export { main as runInfiniteDrainDaemon };

if (process.argv[1] && (process.argv[1].endsWith('drain-backfill-and-hourly.ts') || process.argv[1].endsWith('drain-backfill-and-hourly.js'))) {
  main()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[DRAIN] Fatal error:', err);
      process.exit(1);
    });
}
