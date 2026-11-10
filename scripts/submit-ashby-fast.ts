import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { AutoApplyRunner } from '../src/autoapply/runner.js';
import { loadProfile } from '../src/autoapply/profile.js';
import { AutoaplyQueueManager } from '../src/autoapply/autoaply.js';
import { removeAttemptedJob } from '../src/autoapply/attempted-registry.js';
import { canonicalRequisition } from '../src/autoapply/identity.js';
import { evaluateCandidateJobFit } from '../src/autoapply/candidate-fit-filter.js';

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
  const stateDir = path.resolve('state/autoapply/portal-review');

  const profile = loadProfile(profilePath);
  const candidateId = createHash('sha256').update(profile.personal.email.trim().toLowerCase()).digest('hex').slice(0, 20);
  const queue = new AutoaplyQueueManager({
    statePath: sqlitePath,
    candidateId,
    infiniteMode: true,
  });

  const TARGET_APPLIED = 172;
  let currentApplied = getConfirmedAppliedCount(sqlitePath);

  console.log(`[ASHBY-FAST] Starting targeted Ashby submitter. Current: ${currentApplied}, Target: >= ${TARGET_APPLIED}`);
  if (currentApplied >= TARGET_APPLIED) {
    console.log(`[ASHBY-FAST] Target already reached: ${currentApplied}`);
    return;
  }

  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  const ashbyJobs: Array<{ id: string; url: string; company: string; title: string }> = [];
  try {
    const rows = db.prepare(`
      SELECT id, normalized_url, json_extract(payload, '$.company') as company, json_extract(payload, '$.title') as title, json_extract(payload, '$.location') as location
      FROM applications
      WHERE status = 'queued'
        AND normalized_url LIKE '%ashbyhq.com%'
      ORDER BY COALESCE(json_extract(payload, '$.is_hourly_fresh'), 0) DESC, id DESC
      LIMIT 100
    `).all() as Array<{ id: string; normalized_url: string; company: string; title: string; location: string }>;

    for (const r of rows) {
      const fit = evaluateCandidateJobFit({
        title: r.title,
        company: r.company,
        location: r.location,
        url: r.normalized_url,
      });
      if (!fit.allowed) continue;

      removeAttemptedJob(r.id, r.normalized_url);
      ashbyJobs.push({
        id: r.id,
        url: r.normalized_url,
        company: r.company || 'Unknown',
        title: r.title || 'Software Engineer',
      });
    }
  } finally {
    db.close();
  }

  console.log(`[ASHBY-FAST] Eligible candidate pool: ${ashbyJobs.length} Ashby jobs.`);

  const CONCURRENCY = 2;
  let jobIdx = 0;
  let stop = false;

  const runWorker = async (workerId: number) => {
    const workerTag = `[ASHBY-LANE-${workerId}]`;
    const tempProfileDir = path.resolve(stateDir, 'submit-profiles', `ashby-worker-${workerId}`);
    fs.mkdirSync(tempProfileDir, { recursive: true });

    while (!stop && jobIdx < ashbyJobs.length) {
      currentApplied = getConfirmedAppliedCount(sqlitePath);
      if (currentApplied >= TARGET_APPLIED) {
        console.log(`${workerTag} Target reached: ${currentApplied} >= ${TARGET_APPLIED}. Halting.`);
        stop = true;
        break;
      }

      const cur = jobIdx++;
      const job = ashbyJobs[cur];
      if (!job) break;

      const checkDb = new DatabaseSync(sqlitePath, { readOnly: true });
      let alreadyDone = false;
      try {
        const row = checkDb.prepare("SELECT status FROM applications WHERE id = ? OR normalized_url = ?").get(job.id, job.url) as { status: string } | undefined;
        if (row && row.status === 'applied') alreadyDone = true;
      } finally {
        checkDb.close();
      }
      if (alreadyDone) continue;

      console.log(`\n${workerTag} (#${cur + 1}/${ashbyJobs.length}) Submitting ${job.company} -> ${job.url}`);
      const sessionDir = path.resolve(stateDir, 'submit-sessions', `submit-ashby-${job.id}`);
      fs.mkdirSync(sessionDir, { recursive: true });

      const runner = new AutoApplyRunner();
      const t0 = Date.now();
      try {
        await runner.initBrowser(true, sessionDir, tempProfileDir);
        const report = await runner.run({
          url: job.url,
          jobId: job.id,
          lane: `ashby-${workerId}`,
          profile,
          mode: 'stealth',
          headless: true,
          submit: true,
          timeoutMs: 90_000,
          sessionDir,
          company: job.company,
          applicationCountry: 'India',
          requisition: canonicalRequisition(job.url),
        });

        const durSec = ((Date.now() - t0) / 1000).toFixed(1);
        const receipt = report.receipt;
        if (report.status === 'submitted' || receipt) {
          const appliedReceipt = receipt || {
            url: report.url,
            text: 'Application Submitted',
            verifiedAt: new Date().toISOString(),
          };
          const marked = queue.markApplied(job.id, appliedReceipt);
          if (!marked) {
            try {
              const writeDb = new DatabaseSync(sqlitePath);
              writeDb.prepare(`
                UPDATE applications
                SET status = 'applied',
                    payload = json_set(payload, '$.status', 'applied', '$.appliedAt', ?, '$.receipt', json(?))
                WHERE id = ? OR normalized_url = ?
              `).run(new Date().toISOString(), JSON.stringify(appliedReceipt), job.id, job.url);
              writeDb.close();
            } catch {}
          }
          currentApplied = getConfirmedAppliedCount(sqlitePath);
          console.log(`${workerTag} ✅ SUCCESS! Confirmed applied: ${currentApplied}/${TARGET_APPLIED} | ${job.company} in ${durSec}s`);
        } else {
          console.log(`${workerTag} ⚠️ Outcome: ${report.status} (${report.reason || 'no receipt'}) | ${job.company} in ${durSec}s`);
        }
      } catch (err: any) {
        const durSec = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`${workerTag} ❌ Error: ${err?.message || err} on ${job.company} in ${durSec}s`);
      } finally {
        await runner.forceKillBrowser().catch(() => {});
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => runWorker(i)));
  const finalApplied = getConfirmedAppliedCount(sqlitePath);
  console.log(`[ASHBY-FAST] Finished. Final confirmed applied: ${finalApplied}`);
}

main().catch(console.error);
