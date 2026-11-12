import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { isSupportedDirectAtsJobUrl } from '../src/autoapply/preflight.js';
import { isStrictTechRole, isStrictIndiaLocation } from './harvest-fast-ats-jobs.js';

export function inferAtsProviderFromUrl(rawUrl: string): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();

  if (host.includes('.myworkdayjobs.com') || host.includes('.myworkdaysite.com')) return 'workday';
  if (host.includes('greenhouse.io') || Boolean(parsed.searchParams.get('gh_jid')) || parsed.pathname.includes('/greenhouse/')) return 'greenhouse';
  if (host.includes('ashbyhq.com')) return 'ashby';
  if (host.includes('lever.co')) return 'lever';
  if (host.includes('smartrecruiters.com') || host.includes('smartr.me')) return 'smartrecruiters';
  if (host.includes('workable.com')) return 'workable';
  if (host.includes('recruitee.com')) return 'recruitee';
  if (host.includes('breezy.hr')) return 'breezy';
  return null;
}

export function reclassifyQueuedJobs(dbPath = 'state/autoapply/portal-review/queue.sqlite'): {
  totalProcessed: number;
  reclassified: number;
  skippedUnsupported: number;
  skippedIneligibleRole: number;
  skippedIneligibleLocation: number;
  remainingUnknown: number;
} {
  const resolved = path.resolve(dbPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Database not found at ${resolved}`);
  }

  const db = new DatabaseSync(resolved);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 15000;');

  const rows = db.prepare(`SELECT id, normalized_url, payload FROM applications WHERE status = 'queued'`).all() as Array<{
    id: string;
    normalized_url: string;
    payload: string;
  }>;

  const updatePayloadStmt = db.prepare(`UPDATE applications SET payload = ?, last_error = NULL WHERE id = ?`);
  const skipStmt = db.prepare(`UPDATE applications SET status = 'skipped', last_error = ? WHERE id = ?`);

  let reclassified = 0;
  let skippedUnsupported = 0;
  let skippedIneligibleRole = 0;
  let skippedIneligibleLocation = 0;
  let remainingUnknown = 0;

  for (const row of rows) {
    let payload: any = {};
    try {
      payload = JSON.parse(row.payload);
    } catch {
      skipStmt.run('invalid_payload_json', row.id);
      skippedUnsupported++;
      continue;
    }

    const url = row.normalized_url || payload.jobUrl || '';
    const title = payload.title || '';
    const location = payload.location || '';

    // Gate 1: Check if URL is supported direct ATS
    if (!isSupportedDirectAtsJobUrl(url)) {
      skipStmt.run('unsupported_direct_ats', row.id);
      skippedUnsupported++;
      continue;
    }

    // Gate 2: GEN-511 role & seniority filter
    if (title && !isStrictTechRole(title)) {
      skipStmt.run('ineligible_role_or_seniority', row.id);
      skippedIneligibleRole++;
      continue;
    }

    // Gate 3: GEN-511 location filter
    if (location && !isStrictIndiaLocation(location, title)) {
      skipStmt.run('ineligible_location', row.id);
      skippedIneligibleLocation++;
      continue;
    }

    // Gate 4: Provider inference & update
    const inferred = inferAtsProviderFromUrl(url);
    if (!inferred) {
      skipStmt.run('unrecognized_provider', row.id);
      skippedUnsupported++;
      continue;
    }

    if (payload.provider !== inferred || !payload.provider || payload.provider === 'unknown' || payload.provider === 'generic') {
      payload.provider = inferred;
      payload.lane = inferred;
      updatePayloadStmt.run(JSON.stringify(payload), row.id);
      reclassified++;
    }
  }

  // Double check remaining unknown
  const checkRows = db.prepare(`SELECT payload FROM applications WHERE status = 'queued'`).all() as Array<{ payload: string }>;
  for (const r of checkRows) {
    try {
      const p = JSON.parse(r.payload);
      if (!p.provider || p.provider === 'unknown' || p.provider === 'generic') {
        remainingUnknown++;
      }
    } catch {}
  }

  db.close();

  return {
    totalProcessed: rows.length,
    reclassified,
    skippedUnsupported,
    skippedIneligibleRole,
    skippedIneligibleLocation,
    remainingUnknown,
  };
}

if (process.argv[1] && (process.argv[1].endsWith('reclassify-unknown-queued-jobs.ts') || process.argv[1].endsWith('reclassify-unknown-queued-jobs.js'))) {
  const dbPath = process.argv[2] || 'state/autoapply/portal-review/queue.sqlite';
  console.log(`[RECLASSIFY] Running queued job reclassification on ${dbPath}...`);
  const res = reclassifyQueuedJobs(dbPath);
  console.log(`[RECLASSIFY COMPLETE]`, res);
}
