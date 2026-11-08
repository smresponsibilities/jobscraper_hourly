import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export function extractCanonicalJobPostingKey(rawUrl: string): string {
  const u = String(rawUrl || '').trim();
  if (!u) return '';
  const ghJob =
    u.match(/greenhouse\.io\/[^/?#]+\/jobs\/(\d+)/i)?.[1] ||
    u.match(/[?&](?:token|gh_jid)=(\d+)/i)?.[1];
  if (ghJob) return `gh:${ghJob}`;

  const ashby = u.match(/jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-fA-F-]{36})/i);
  if (ashby && ashby[1] && ashby[2]) return `ashby:${ashby[1].toLowerCase()}:${ashby[2].toLowerCase()}`;

  const lever = u.match(/jobs\.lever\.co\/([^/?#]+)\/([0-9a-fA-F-]{36})/i);
  if (lever && lever[1] && lever[2]) return `lever:${lever[1].toLowerCase()}:${lever[2].toLowerCase()}`;

  const sr = u.match(/smartrecruiters\.com\/(?:oneclick-ui\/company\/)?([^/?#]+)\/(?:publication\/)?([a-zA-Z0-9-]{8,36})/i);
  if (sr && sr[1] && sr[2]) return `sr:${sr[1].toLowerCase()}:${sr[2].toLowerCase()}`;

  return u.toLowerCase().replace(/\/(?:apply|application)(?:\/.*)?$/i, '');
}

export function enforceQueueDatabaseInvariants(targetDbPath?: string): {
  checkedDatabases: string[];
  duplicatesSkipped: number;
} {
  const dbPaths = targetDbPath
    ? [targetDbPath]
    : [
        'state/autoapply/portal-review/queue.sqlite',
        'data/queue.sqlite',
      ].filter((p) => fs.existsSync(p));

  let totalDuplicatesSkipped = 0;

  for (const dbPath of dbPaths) {
    if (!fs.existsSync(dbPath)) continue;
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA busy_timeout = 15000; PRAGMA journal_mode = WAL;');

    try {
      const hasApps = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='applications'").all() as any[]).length > 0;
      const hasJobs = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'").all() as any[]).length > 0;

      if (hasApps) {
        const rows = db.prepare('SELECT id, normalized_url, status, payload FROM applications').all() as any[];
        const appliedCanonicalKeys = new Set<string>();

        for (const row of rows) {
          if (row.status === 'applied') {
            let u = row.normalized_url || '';
            try {
              const p = JSON.parse(row.payload);
              u = p.url || u;
            } catch {}
            const k = extractCanonicalJobPostingKey(u);
            if (k) appliedCanonicalKeys.add(k);
          }
        }

        const skipAppStmt = db.prepare(`
          UPDATE applications SET status = 'skipped', payload = ? WHERE id = ?
        `);

        for (const row of rows) {
          if (row.status === 'queued') {
            let u = row.normalized_url || '';
            let p: any = {};
            try {
              p = JSON.parse(row.payload);
              u = p.url || u;
            } catch {}
            const k = extractCanonicalJobPostingKey(u);
            if (k && appliedCanonicalKeys.has(k)) {
              p.last_error = 'duplicate_of_already_applied_posting';
              skipAppStmt.run(JSON.stringify(p), row.id);
              totalDuplicatesSkipped++;
            }
          }
        }
      }

      if (hasJobs) {
        const rows = db.prepare('SELECT id, url, status FROM jobs').all() as any[];
        const appliedCanonicalKeys = new Set<string>();

        for (const row of rows) {
          if (row.status === 'applied' && row.url) {
            const k = extractCanonicalJobPostingKey(row.url);
            if (k) appliedCanonicalKeys.add(k);
          }
        }

        const skipJobStmt = db.prepare(`
          UPDATE jobs SET status = 'skipped', last_error = 'duplicate_of_already_applied_posting' WHERE id = ?
        `);

        for (const row of rows) {
          if (row.status === 'queued' && row.url) {
            const k = extractCanonicalJobPostingKey(row.url);
            if (k && appliedCanonicalKeys.has(k)) {
              skipJobStmt.run(row.id);
              totalDuplicatesSkipped++;
            }
          }
        }
      }
    } finally {
      db.close();
    }
  }

  return {
    checkedDatabases: dbPaths,
    duplicatesSkipped: totalDuplicatesSkipped,
  };
}

const isDirectRun = Boolean(
  process.argv[1] &&
    (path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase() ||
      process.argv[1].replace(/\\/g, '/').endsWith('system-invariants.ts'))
);

if (isDirectRun) {
  const result = enforceQueueDatabaseInvariants();
  console.log('[SYSTEM INVARIANTS] Enforced successfully:', result);
}
