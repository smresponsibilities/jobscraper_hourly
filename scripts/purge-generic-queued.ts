import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { isSupportedDirectAtsJobUrl } from '../src/autoapply/preflight.js';

const dbPaths = [
  path.resolve('state/autoapply/portal-review/queue.sqlite'),
  path.resolve('state/autoapply/queue.sqlite'),
];

for (const dbPath of dbPaths) {
  if (!fs.existsSync(dbPath)) continue;
  const db = new DatabaseSync(dbPath);
  try {
    const hasApps = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='applications'").get();
    if (hasApps) {
      const rows = db.prepare("SELECT id, normalized_url, payload FROM applications WHERE status = 'queued'").all() as Array<{ id: string; normalized_url: string; payload: string }>;
      let purged = 0;
      for (const r of rows) {
        let url = r.normalized_url || '';
        try {
          const p = JSON.parse(r.payload);
          url = p.jobUrl || p.url || url;
        } catch {}

        if (!isSupportedDirectAtsJobUrl(url)) {
          db.prepare(`
            UPDATE applications
            SET status = 'skipped',
                payload = json_set(payload, '$.status', 'skipped', '$.skipReason', 'unsupported_generic_portal', '$.reason', 'unsupported_generic_portal')
            WHERE id = ?
          `).run(r.id);
          purged++;
        }
      }
      console.log(`[${dbPath}] Purged generic/unsupported queued jobs: ${purged}`);
    }
  } catch (err: any) {
    console.error(`[${dbPath}] Error purging:`, err.message);
  }
  db.close();
}
