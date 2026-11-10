import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const HISTORY_PATH = path.resolve('state/autoapply/portal-review/run-history.jsonl');
const DB_PATH = path.resolve('state/autoapply/portal-review/queue.sqlite');
const ATTEMPTED_PATH = path.resolve('state/autoapply/portal-review/attempted-job-ids.json');
const ATTEMPTS_PATH = path.resolve('state/autoapply/portal-review/job-attempts.json');

export function requeueKilledRuns(): { requeuedCount: number; jobIds: string[] } {
  if (!fs.existsSync(HISTORY_PATH) || !fs.existsSync(DB_PATH)) {
    return { requeuedCount: 0, jobIds: [] };
  }

  const lines = fs.readFileSync(HISTORY_PATH, 'utf8').trim().split('\n').filter(Boolean);
  const last40 = lines.slice(-40).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);

  const targetJobIds = new Set<string>();
  const targetUrls = new Set<string>();

  for (const r of last40) {
    const reason = String(r.reason || r.error || '');
    const isKilled = /job timed out or runner closed|timed out|runner closed/i.test(reason);
    const prov = String(r.provider || r.lane || r.url || '').toLowerCase();
    const isTargetAts = /greenhouse|smartrecruiters|workday|ashby|lever/i.test(prov);

    if (r.status === 'failed' && isKilled && isTargetAts && r.jobId) {
      targetJobIds.add(r.jobId);
      if (r.url) targetUrls.add(r.url);
    }
  }

  const jobIdsList = Array.from(targetJobIds);
  if (jobIdsList.length === 0) {
    console.log('[REQUEUE_KILLED] No killed runs found matching criteria in the last 40 runs.');
    return { requeuedCount: 0, jobIds: [] };
  }

  // 1. Update queue.sqlite back to 'queued'
  const db = new DatabaseSync(DB_PATH);
  let dbRequeued = 0;
  for (const id of jobIdsList) {
    try {
      const row = db.prepare('SELECT payload FROM applications WHERE id = ?').get(id) as { payload?: string } | undefined;
      let p: any = {};
      try { p = JSON.parse(row?.payload || '{}'); } catch {}
      p.status = 'queued';
      p.retryCount = 0;
      delete p.error;
      delete p.reason;
      const res = db.prepare(`
        UPDATE applications
        SET status = 'queued',
            payload = ?
        WHERE id = ?
      `).run(JSON.stringify(p), id);
      if (res.changes > 0) dbRequeued++;
    } catch {}
  }
  db.close();

  // 2. Remove from attempted-job-ids.json
  if (fs.existsSync(ATTEMPTED_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(ATTEMPTED_PATH, 'utf8'));
      if (Array.isArray(data)) {
        const filtered = data.filter((item: any) => {
          const id = typeof item === 'string' ? item : item?.jobId;
          const url = typeof item === 'object' ? item?.url : '';
          if (id && targetJobIds.has(id)) return false;
          if (url && targetUrls.has(url)) return false;
          return true;
        });
        fs.writeFileSync(ATTEMPTED_PATH, JSON.stringify(filtered, null, 2), 'utf8');
      } else if (typeof data === 'object' && data !== null) {
        for (const id of jobIdsList) {
          delete data[id];
        }
        fs.writeFileSync(ATTEMPTED_PATH, JSON.stringify(data, null, 2), 'utf8');
      }
    } catch {}
  }

  // 3. Remove from job-attempts.json
  if (fs.existsSync(ATTEMPTS_PATH)) {
    try {
      const attempts = JSON.parse(fs.readFileSync(ATTEMPTS_PATH, 'utf8'));
      if (typeof attempts === 'object' && attempts !== null) {
        for (const id of jobIdsList) {
          delete attempts[id];
        }
        fs.writeFileSync(ATTEMPTS_PATH, JSON.stringify(attempts, null, 2), 'utf8');
      }
    } catch {}
  }

  console.log(`[REQUEUE_KILLED] Requeued ${dbRequeued} killed jobs back to status = 'queued' and cleared attempt locks.`);
  return { requeuedCount: dbRequeued, jobIds: jobIdsList };
}

if (process.argv[1] && process.argv[1].endsWith('requeue-killed-runs.ts')) {
  requeueKilledRuns();
}
