// scripts/apply-gen90.ts
import * as fs from 'node:fs';

let marathon = fs.readFileSync('scripts/run-overnight-marathon.ts', 'utf8');

// 1. Add import
if (!marathon.includes("import { syncGitHubActionsPillars }")) {
  marathon = marathon.replace(
    "import { filterUnattemptedJobs, recordAttemptedJob } from '../src/autoapply/attempted-registry.js';",
    "import { filterUnattemptedJobs, recordAttemptedJob } from '../src/autoapply/attempted-registry.js';\nimport { syncGitHubActionsPillars } from './sync-github-actions-pillars.js';"
  );
  console.log('Added syncGitHubActionsPillars import');
}

// 2. Add periodic discovery sync at top of while loop
const whileTarget = "      console.log(`\\n[MARATHON] [CYCLE #${cycleIndex}] Initializing chunk (Processed so far: ${totalProcessedOverall}/${maxJobs})...`);";
const discoverySyncAddition = `
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
          console.log(\`[MARATHON] Discovery sync complete: ingested \${syncRes.newJobsIngested} new jobs.\`);
          fs.writeFileSync(syncRecordPath, JSON.stringify({ timestamp: new Date().toISOString(), result: syncRes }, null, 2), 'utf8');
        } catch (err) {
          console.warn('[MARATHON] Discovery sync error (non-fatal):', err);
        }
      }
`;

if (!marathon.includes('Ticket GEN-90: Periodic 30-minute discovery sync')) {
  marathon = marathon.replace(whileTarget, whileTarget + discoverySyncAddition);
  console.log('Added discovery sync loop block');
}

// 3. Priority #1 Hourly-First, Priority #2 Backfill-Second
const selectTarget = `      // Select ready jobs first (avoid stalling the chunk when a host is cooling down)
      const readyCandidates: AutoaplyJobItem[] = [];
      const deferredCandidates: AutoaplyJobItem[] = [];
      for (const item of scoredCandidates) {`;

const priorityReplacement = `      // Ticket GEN-90: Drain Priority #1 (Hourly Fresh Jobs) FIRST, Backfill Queue SECOND
      const hourlyCandidates: AutoaplyJobItem[] = [];
      const backfillCandidates: AutoaplyJobItem[] = [];

      for (const item of scoredCandidates) {
        const isFresh = Boolean(
          item.job.isHourlyFresh ||
          (item.job as any).payload?.isHourlyFresh ||
          (item.job.discoveredAt && (nowMs - new Date(item.job.discoveredAt).getTime()) <= 86400_000) ||
          ((item.job as any).payload?.discoveredAt && (nowMs - new Date((item.job as any).payload.discoveredAt).getTime()) <= 86400_000)
        );
        if (isFresh) {
          hourlyCandidates.push(item.job);
        } else {
          backfillCandidates.push(item.job);
        }
      }

      const prioritizedCandidates = [...hourlyCandidates, ...backfillCandidates];

      // Select ready jobs first (avoid stalling the chunk when a host is cooling down)
      const readyCandidates: AutoaplyJobItem[] = [];
      const deferredCandidates: AutoaplyJobItem[] = [];
      for (const job of prioritizedCandidates) {`;

if (!marathon.includes('Ticket GEN-90: Drain Priority #1')) {
  marathon = marathon.replace(selectTarget, priorityReplacement);
  // Also adjust property references inside loop: item.job -> job
  marathon = marathon.replace("if (isHostReadyForRequest(item.job.jobUrl, 45000, hostHealthPath)) {", "if (isHostReadyForRequest(job.jobUrl, 45000, hostHealthPath)) {");
  marathon = marathon.replace("readyCandidates.push(item.job);", "readyCandidates.push(job);");
  marathon = marathon.replace("deferredCandidates.push(item.job);", "deferredCandidates.push(job);");
  console.log('Added Hourly-First / Backfill-Second priority sorting');
}

// 4. Update default maxHours to 48 and maxJobs to 99999
marathon = marathon.replace(
  "const maxHours = values.has('--max-hours') ? Number(values.get('--max-hours')) : 10;",
  "const maxHours = values.has('--max-hours') ? Number(values.get('--max-hours')) : 48;"
);
marathon = marathon.replace(
  "const maxJobs = values.has('--max-jobs') ? Number(values.get('--max-jobs')) : 1200;",
  "const maxJobs = values.has('--max-jobs') ? Number(values.get('--max-jobs')) : 99999;"
);

fs.writeFileSync('scripts/run-overnight-marathon.ts', marathon, 'utf8');
console.log('Updated scripts/run-overnight-marathon.ts for GEN-90.');
