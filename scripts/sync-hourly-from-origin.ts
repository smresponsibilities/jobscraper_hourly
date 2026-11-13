import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { isSupportedDirectAtsJobUrl } from '../src/autoapply/priority-scheduler.js';
import { unwrapDirectAtsApplicationUrl } from '../src/autoapply/url-unwrapper.js';
import { evaluateCandidateJobFit } from '../src/autoapply/candidate-fit-filter.js';

interface RawScrapedJob {
  title?: string;
  company?: string;
  location?: string;
  url?: string;
  applyUrl?: string;
  ats?: string;
}

function inferAtsProvider(url: string): string {
  if (/greenhouse\.io/i.test(url)) return 'greenhouse';
  if (/ashbyhq\.com/i.test(url)) return 'ashby';
  if (/lever\.co/i.test(url)) return 'lever';
  if (/smartrecruiters\.com/i.test(url)) return 'smartrecruiters';
  if (/myworkdayjobs\.com|myworkdaysite\.com/i.test(url)) return 'workday';
  return 'other';
}

function loadCandidateJobArrays(): RawScrapedJob[] {
  const results: RawScrapedJob[] = [];
  // 1. Fetch latest origin/main non-destructively
  try {
    execSync('git fetch origin +refs/heads/main:refs/remotes/origin/main +refs/heads/data:refs/remotes/origin/data --quiet', { stdio: 'ignore', timeout: 20000 });
  } catch {}

  const candidatePaths = [
    'data/jobs.json',
    'web/public/data/jobs.json',
    'jobs.json',
  ];

  for (const relPath of candidatePaths) {
    // Try git show origin/main:<path> first for freshest hourly GitHub Actions data
    try {
      const gitRaw = execSync(`git show ${relPath === 'data/jobs.json' ? 'origin/data:jobs.json' : 'origin/main:' + relPath}`, {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const parsed = JSON.parse(gitRaw);
      const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.jobs) ? parsed.jobs : [];
      if (arr.length > 0) {
        results.push(...arr);
        break;
      }
    } catch {}

    if (fs.existsSync(relPath)) {
      try {
        const localRaw = fs.readFileSync(relPath, 'utf8');
        const parsed = JSON.parse(localRaw);
        const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.jobs) ? parsed.jobs : [];
        if (arr.length > 0) {
          results.push(...arr);
          break;
        }
      } catch {}
    }
  }
  return results;
}

export function syncHourlyFreshJobsFromOriginMain(dbPath?: string): {
  inspected: number;
  insertedFresh: number;
  boostedExisting: number;
} {
  if (!dbPath) {
    const defaultPaths = ['state/autoapply/portal-review/queue.sqlite', 'data/queue.sqlite'].filter(p => fs.existsSync(p));
    let totalInspected = 0;
    let totalInserted = 0;
    let totalBoosted = 0;
    for (const p of defaultPaths) {
      const res = syncHourlyFreshJobsFromOriginMain(p);
      totalInspected = Math.max(totalInspected, res.inspected);
      totalInserted += res.insertedFresh;
      totalBoosted += res.boostedExisting;
    }
    return { inspected: totalInspected, insertedFresh: totalInserted, boostedExisting: totalBoosted };
  }

  const targetDbPath = dbPath;

  if (!fs.existsSync(targetDbPath)) {
    return { inspected: 0, insertedFresh: 0, boostedExisting: 0 };
  }
  const rawJobs = loadCandidateJobArrays();
  if (rawJobs.length === 0) {
    return { inspected: 0, insertedFresh: 0, boostedExisting: 0 };
  }

  const db = new DatabaseSync(targetDbPath);
  db.exec('PRAGMA busy_timeout = 15000; PRAGMA journal_mode = WAL;');

  try {
    const hasAppsTable = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='applications'").all() as any[]).length > 0;
  const hasJobsTable = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'").all() as any[]).length > 0;

  let insertedFresh = 0;
  let boostedExisting = 0;

  if (hasAppsTable) {
    const existingRows = db.prepare("SELECT id, normalized_url, status, payload FROM applications").all() as any[];
    const existingByUrl = new Map<string, { id: string; status: string; payload: any }>();
    for (const row of existingRows) {
      if (row.normalized_url) {
        let p: any = {};
        try { p = JSON.parse(row.payload); } catch {}
        existingByUrl.set(String(row.normalized_url).trim(), { id: row.id, status: row.status, payload: p });
      }
    }

    const candidateId = (() => { try { const c = JSON.parse(fs.readFileSync('state/autoapply/portal-review/candidate.json', 'utf8')); return require('node:crypto').createHash('sha256').update(String(c.personal?.email || '').trim().toLowerCase()).digest('hex').slice(0, 20); } catch { return '2e533f7f49798b955338'; } })();
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO applications (candidate_id, id, canonical_key, normalized_url, status, payload, owner, expires)
      VALUES (?, ?, ?, ?, 'queued', ?, NULL, NULL)
    `);
    db.exec('BEGIN TRANSACTION');
    for (const raw of rawJobs) {
      const rawUrl = String(raw.applyUrl || raw.url || '').trim();
      if (!rawUrl) continue;
      const unwrappedUrl = unwrapDirectAtsApplicationUrl(rawUrl);
      if (!isSupportedDirectAtsJobUrl(unwrappedUrl)) continue;

      const fit = evaluateCandidateJobFit({
        company: raw.company,
        title: raw.title,
        location: raw.location,
        url: unwrappedUrl,
      });
      if (!fit.allowed) continue;

      const existing = existingByUrl.get(unwrappedUrl) || existingByUrl.get(rawUrl);
      if (existing) {
        continue;
      }

      const jobId = 'autoaply_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const ats = raw.ats || inferAtsProvider(unwrappedUrl);
      const payload = {
        id: jobId,
        externalJobId: '',
        title: String(raw.title || 'Software Engineer').trim(),
        company: String(raw.company || 'Unknown').trim(),
        jobUrl: unwrappedUrl,
        url: unwrappedUrl,
        jobBoard: 'direct_ats',
        location: String(raw.location || 'India').trim(),
        postedAt: String((raw as any).postedAt || (raw as any).firstSeen || ''),
        status: 'queued',
        isHourlyFresh: true,
        is_hourly_fresh: 2,
        priorityBonus: fit.priorityBonus,
        ats,
      };

      try {
        insertStmt.run(candidateId, jobId, `${ats}:${payload.company}:${jobId}`, unwrappedUrl, JSON.stringify(payload));
        existingByUrl.set(unwrappedUrl, { id: jobId, status: 'queued', payload });
        insertedFresh++;
      } catch {}
    }
    db.exec('COMMIT');
  }

  if (hasJobsTable) {
    const cols = new Set(
      (db.prepare('PRAGMA table_info(jobs)').all() as Array<{ name: string }>).map((c) => c.name)
    );
    const existingRows = db.prepare("SELECT id, url, status, is_hourly_fresh FROM jobs").all() as any[];
    const existingByUrl = new Map<string, { id: number; status: string; is_hourly_fresh?: number }>();
    for (const row of existingRows) {
      if (row.url) existingByUrl.set(String(row.url).trim(), row);
    }

    const hasLocationCol = cols.has('location');
    const hasAtsCol = cols.has('ats');
    const hasHourlyFreshCol = cols.has('is_hourly_fresh');

    db.exec('BEGIN TRANSACTION');
    for (const raw of rawJobs) {
      const rawUrl = String(raw.applyUrl || raw.url || '').trim();
      if (!rawUrl) continue;
      const unwrappedUrl = unwrapDirectAtsApplicationUrl(rawUrl);
      if (!isSupportedDirectAtsJobUrl(unwrappedUrl)) continue;

      const fit = evaluateCandidateJobFit({
        company: raw.company,
        title: raw.title,
        location: raw.location,
        url: unwrappedUrl,
      });
      if (!fit.allowed) continue;

      const existing = existingByUrl.get(unwrappedUrl) || existingByUrl.get(rawUrl);
      if (existing) {
        continue;
      }

      try {
        const insertCols = ['company', 'title', 'url', 'status'];
        const insertVals: any[] = [
          String(raw.company || 'Unknown').trim(),
          String(raw.title || 'Software Engineer').trim(),
          unwrappedUrl,
          'queued',
        ];
        if (hasLocationCol) {
          insertCols.push('location');
          insertVals.push(String(raw.location || 'India').trim());
        }
        if (hasAtsCol) {
          insertCols.push('ats');
          insertVals.push(raw.ats || inferAtsProvider(unwrappedUrl));
        }
        if (hasHourlyFreshCol) {
          insertCols.push('is_hourly_fresh');
          insertVals.push(0);
        }
        const placeholders = insertCols.map(() => '?').join(', ');
        db.prepare(`INSERT OR IGNORE INTO jobs (${insertCols.join(', ')}) VALUES (${placeholders})`).run(...insertVals);
        existingByUrl.set(unwrappedUrl, { id: -1, status: 'queued', is_hourly_fresh: 0 });
        insertedFresh++;
      } catch {}
    }
    db.exec('COMMIT');
  }

  return { inspected: rawJobs.length, insertedFresh, boostedExisting };
  } finally {
    try { db.close(); } catch {}
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()) {
  console.log('Hourly origin/main sync result:', syncHourlyFreshJobsFromOriginMain());
}
