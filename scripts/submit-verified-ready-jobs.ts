import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { AutoApplyRunner, type AutoApplyOptions } from '../src/autoapply/runner.js';
import { loadProfile } from '../src/autoapply/profile.js';
import { AutoaplyQueueManager } from '../src/autoapply/autoaply.js';
import { removeAttemptedJob } from '../src/autoapply/attempted-registry.js';
import { canonicalRequisition } from '../src/autoapply/identity.js';
import { evaluateSystemHealthAndAdaptiveLanes } from '../src/autoapply/health-and-ram-watchdog.js';

interface ReadyJob {
  jobId: string;
  company: string;
  title: string;
  url: string;
  ats: string;
  source: 'dryrun_ready' | 'fresh_queue';
}

function getConfirmedAppliedCount(sqlitePath: string): number {
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    const row = db.prepare("SELECT COUNT(*) as cnt FROM applications WHERE status = 'applied'").get() as { cnt: number };
    return row?.cnt ?? 0;
  } finally {
    db.close();
  }
}

async function main() {
  const sqlitePath = path.resolve('state/autoapply/portal-review/queue.sqlite');
  const profilePath = path.resolve('state/autoapply/portal-review/candidate.json');
  const dryrunPath = path.resolve('state/autoapply/dryrun-100-results.json');
  const stateDir = path.resolve('state/autoapply/portal-review');

  const profile = loadProfile(profilePath);
  const candidateId = createHash('sha256').update(profile.personal.email.trim().toLowerCase()).digest('hex').slice(0, 20);
  const queue = new AutoaplyQueueManager({
    statePath: sqlitePath,
    candidateId,
    infiniteMode: true,
  });

  let currentApplied = getConfirmedAppliedCount(sqlitePath);
  const TARGET_APPLIED = 140;

  console.log('===============================================================');
  console.log(`[LIVE-SUBMIT] Starting Live Submission Loop (GEN-328)`);
  console.log(`[LIVE-SUBMIT] Current confirmed applied: ${currentApplied}`);
  console.log(`[LIVE-SUBMIT] Target confirmed applied: >= ${TARGET_APPLIED}`);
  console.log('===============================================================');

  if (currentApplied >= TARGET_APPLIED) {
    console.log(`[LIVE-SUBMIT] Already reached target: ${currentApplied} >= ${TARGET_APPLIED}`);
    return;
  }

  // 1. Gather all READY_TO_SUBMIT jobs from dry-run dataset
  const readyPool: ReadyJob[] = [];
  if (fs.existsSync(dryrunPath)) {
    const raw = JSON.parse(fs.readFileSync(dryrunPath, 'utf8'));
    const results = Array.isArray(raw) ? raw : raw.results || [];
    const verifiedReady = results.filter((r: any) => r.status === 'READY_TO_SUBMIT');
    console.log(`[LIVE-SUBMIT] Loaded ${verifiedReady.length} verified READY_TO_SUBMIT jobs from ${dryrunPath}`);

    for (const r of verifiedReady) {
      // Clear attempted locks
      removeAttemptedJob(r.jobId, r.url);

      readyPool.push({
        jobId: r.jobId,
        company: r.company,
        title: r.title,
        url: r.url,
        ats: r.ats,
        source: 'dryrun_ready',
      });
    }
  }

  // 2. Prioritize: Ashby first, then Lever, then Greenhouse
  const priorityOrder: Record<string, number> = { ashby: 1, lever: 2, greenhouse: 3 };
  readyPool.sort((a, b) => (priorityOrder[a.ats] || 9) - (priorityOrder[b.ats] || 9));

  // 3. Fallback: Pull top is_hourly_fresh >= 2 Ashby, Lever, Greenhouse jobs from queue.sqlite
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    const freshRows = db.prepare(`
      SELECT id, normalized_url, json_extract(payload, '$.company') as company, json_extract(payload, '$.title') as title
      FROM applications
      WHERE status = 'queued'
        AND (normalized_url LIKE '%ashbyhq.com%' OR normalized_url LIKE '%lever.co%' OR normalized_url LIKE '%greenhouse.io%')
      ORDER BY COALESCE(json_extract(payload, '$.is_hourly_fresh'), 0) DESC, id DESC
      LIMIT 60
    `).all() as Array<{ id: string; normalized_url: string; company: string; title: string }>;

    for (const row of freshRows) {
      if (!readyPool.some((p) => p.url === row.normalized_url || p.jobId === row.id)) {
        const ats = row.normalized_url.includes('ashbyhq.com') ? 'ashby' : row.normalized_url.includes('lever.co') ? 'lever' : 'greenhouse';
        readyPool.push({
          jobId: row.id,
          company: row.company || 'Unknown',
          title: row.title || 'Software Engineer',
          url: row.normalized_url,
          ats,
          source: 'fresh_queue',
        });
      }
    }
  } finally {
    db.close();
  }

  console.log(`[LIVE-SUBMIT] Total candidate submission pool: ${readyPool.length} jobs.`);

  // 4. Adaptive Concurrency: 2 to 3 workers
  const CONCURRENCY = 2;
  let jobIndex = 0;
  let stopRequested = false;

  const runWorker = async (workerId: number) => {
    const workerTag = `[LANE-${workerId}]`;
    const tempProfileDir = path.resolve(stateDir, 'submit-profiles', `worker-${workerId}`);
    fs.mkdirSync(tempProfileDir, { recursive: true });

    while (!stopRequested && jobIndex < readyPool.length) {
      currentApplied = getConfirmedAppliedCount(sqlitePath);
      if (currentApplied >= TARGET_APPLIED) {
        console.log(`${workerTag} Target reached (${currentApplied} >= ${TARGET_APPLIED}). Halting lane.`);
        stopRequested = true;
        break;
      }

      const curIdx = jobIndex++;
      const candidate = readyPool[curIdx];
      if (!candidate) break;

      // Check if candidate already applied in DB
      const checkDb = new DatabaseSync(sqlitePath, { readOnly: true });
      let isAlreadyDone = false;
      try {
        const row = checkDb.prepare("SELECT status FROM applications WHERE id = ? OR normalized_url = ?").get(candidate.jobId, candidate.url) as { status: string } | undefined;
        if (row && row.status === 'applied') {
          isAlreadyDone = true;
        }
      } finally {
        checkDb.close();
      }

      if (isAlreadyDone) {
        console.log(`${workerTag} [SKIP] ${candidate.company} already marked applied in queue.`);
        continue;
      }

      console.log(`\n${workerTag} (#${curIdx + 1}/${readyPool.length}) Submitting ${candidate.company} (${candidate.ats.toUpperCase()}) -> ${candidate.url}`);

      const sessionDir = path.resolve(stateDir, 'submit-sessions', `submit-${candidate.ats}-${candidate.jobId}`);
      fs.mkdirSync(sessionDir, { recursive: true });

      const runner = new AutoApplyRunner();
      const t0 = Date.now();

      try {
        await runner.initBrowser(true, sessionDir, tempProfileDir);
        const report = await runner.run({
          url: candidate.url,
          jobId: candidate.jobId,
          lane: `lane-${workerId}`,
          profile,
          mode: 'stealth',
          headless: true,
          submit: true, // LIVE SUBMISSION
          timeoutMs: 120_000,
          sessionDir,
          company: candidate.company,
          applicationCountry: 'India',
          requisition: canonicalRequisition(candidate.url),
        });

        const durSec = ((Date.now() - t0) / 1000).toFixed(1);
        const receipt = report.receipt;

        if (report.status === 'submitted' || receipt) {
          const appliedReceipt = receipt || {
            url: report.url,
            text: 'Application Submitted',
            verifiedAt: new Date().toISOString(),
          };
          const marked = queue.markApplied(candidate.jobId, appliedReceipt);
          if (!marked) {
            // Direct SQLite fallback guarantee
            try {
              const writeDb = new DatabaseSync(sqlitePath);
              writeDb.prepare(`
                UPDATE applications
                SET status = 'applied',
                    payload = json_set(payload, '$.status', 'applied', '$.appliedAt', ?, '$.receipt', json(?))
                WHERE id = ? OR normalized_url = ?
              `).run(new Date().toISOString(), JSON.stringify(appliedReceipt), candidate.jobId, candidate.url);
              writeDb.close();
            } catch (err: any) {
              console.warn(`${workerTag} Direct SQLite update error: ${err?.message || err}`);
            }
          }
          currentApplied = getConfirmedAppliedCount(sqlitePath);
          console.log(`${workerTag} ✅ SUCCESS! Confirmed applied: ${currentApplied}/${TARGET_APPLIED} | ${candidate.company} (${candidate.ats}) in ${durSec}s | receipt: ${appliedReceipt.url || 'confirmed'}`);
        } else {
          console.log(`${workerTag} ⚠️ Outcome: ${report.status} (${report.reason || 'no receipt'}) | ${candidate.company} in ${durSec}s`);
        }
      } catch (err: any) {
        const durSec = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`${workerTag} ❌ Error submitting ${candidate.company} in ${durSec}s: ${err?.message || err}`);
      } finally {
        try {
          await runner.forceKillBrowser();
        } catch {}
      }

      // Check after each submission
      currentApplied = getConfirmedAppliedCount(sqlitePath);
      if (currentApplied >= TARGET_APPLIED) {
        console.log(`[LIVE-SUBMIT] TARGET ACHIEVED! Current applied: ${currentApplied} >= ${TARGET_APPLIED}`);
        stopRequested = true;
        break;
      }
    }
  };

  const workers = Array.from({ length: CONCURRENCY }, (_, i) => runWorker(i));
  await Promise.all(workers);

  const finalApplied = getConfirmedAppliedCount(sqlitePath);
  console.log('===============================================================');
  console.log(`[LIVE-SUBMIT] Final confirmed applied in queue.sqlite: ${finalApplied}`);
  console.log('===============================================================');
}

main().catch((err) => {
  console.error('[LIVE-SUBMIT] Fatal error:', err);
  process.exit(1);
});
