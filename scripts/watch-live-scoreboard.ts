import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { runAllSystemInvariantsAndAutoHeal } from '../src/contracts/system-invariants.js';

export function printLiveScoreboardSnapshot(): void {
  try {
    runAllSystemInvariantsAndAutoHeal();
  } catch (err: any) {
    console.warn('[INVARIANTS WARNING]', err?.message || err);
  }
  const dbPath = fs.existsSync('state/autoapply/portal-review/queue.sqlite')
    ? 'state/autoapply/portal-review/queue.sqlite'
    : 'data/queue.sqlite';
  if (!fs.existsSync(dbPath)) {
    console.log('No queue.sqlite found');
    return;
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 5000;');

  const hasJobs = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'").get();
  const hasApps = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='applications'").get();

  let counts: any[] = [];
  let freshCounts: any[] = [];
  let recentApplied: any[] = [];

  if (hasJobs) {
    counts = db
      .prepare('SELECT status, COUNT(*) as cnt FROM jobs GROUP BY status ORDER BY cnt DESC')
      .all();
    freshCounts = db
      .prepare(
        "SELECT COALESCE(is_hourly_fresh, 0) as tier, COUNT(*) as cnt FROM jobs WHERE status = 'queued' GROUP BY COALESCE(is_hourly_fresh, 0) ORDER BY tier DESC"
      )
      .all();
    recentApplied = db
      .prepare(
        "SELECT company, SUBSTR(title, 1, 48) as title, updated_at FROM jobs WHERE status = 'applied' ORDER BY id DESC LIMIT 12"
      )
      .all();
  } else if (hasApps) {
    counts = db
      .prepare('SELECT status, COUNT(*) as cnt FROM applications GROUP BY status ORDER BY cnt DESC')
      .all();
    freshCounts = db
      .prepare(
        "SELECT COALESCE(json_extract(payload, '$.is_hourly_fresh'), 0) as tier, COUNT(*) as cnt FROM applications WHERE status = 'queued' GROUP BY tier ORDER BY tier DESC"
      )
      .all();
    recentApplied = db
      .prepare(
        "SELECT json_extract(payload, '$.company') as company, SUBSTR(json_extract(payload, '$.title'), 1, 48) as title, id FROM applications WHERE status = 'applied' ORDER BY id DESC LIMIT 12"
      )
      .all();
  }

  db.close();

  console.log('=== LIVE SCOREBOARD (' + dbPath + ') ===');
  console.log('Status Counts:', counts);
  console.log('Queued Freshness Tiers (2 = Live API Verified, 1 = Fresh, 0 = Backfill):', freshCounts);
  console.log('Latest Confirmed Applied Jobs:', recentApplied);

  // Ticket GEN-285: Print last 10 completed runs from run-history.jsonl & velocity
  const historyPath = 'state/autoapply/portal-review/run-history.jsonl';
  if (fs.existsSync(historyPath)) {
    try {
      const content = fs.readFileSync(historyPath, 'utf8').trim();
      const lines = content ? content.split(/\r?\n/).filter(Boolean) : [];
      const recent = lines.slice(-10);
      console.log('=== LAST 10 RUNS (run-history.jsonl) ===');
      for (const line of recent) {
        try {
          const item = JSON.parse(line);
          const durSec = Math.round((item.durationMs || 0) / 1000);
          const comp = item.company || '?';
          const ats = item.provider || item.ats || item.lane || '?';
          const st = item.status || '?';
          const filled = item.fieldsFilled ?? 0;
          const rsn = String(item.reason || item.error || item.summary || '').slice(0, 60);
          console.log(`[${st.toUpperCase()}] ${comp} | ${ats} | ${durSec}s | filled:${filled} | ${rsn}`);
        } catch {}
      }

      const now = Date.now();
      const tenMinsAgo = now - 10 * 60 * 1000;
      let countLast10Mins = 0;
      let appliedLast10Mins = 0;
      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 100); i--) {
        try {
          const parsed = JSON.parse(lines[i]!);
          const finishedTime = parsed.finishedAt ? new Date(parsed.finishedAt).getTime() : 0;
          if (finishedTime >= tenMinsAgo) {
            countLast10Mins++;
            if (parsed.status === 'applied' || parsed.status === 'submitted') {
              appliedLast10Mins++;
            }
          }
        } catch {}
      }
      console.log(`Velocity (Last 10m): ${countLast10Mins} completed (${(countLast10Mins / 10).toFixed(1)}/min) | ${appliedLast10Mins} applied`);
    } catch (err: any) {
      console.warn('Failed to parse run-history.jsonl:', err?.message || err);
    }
  }
}

const isDirectRun = Boolean(
  process.argv[1] &&
    (path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase() ||
      process.argv[1].replace(/\\/g, '/').endsWith('watch-live-scoreboard.ts'))
);

if (isDirectRun) {
  printLiveScoreboardSnapshot();
}
