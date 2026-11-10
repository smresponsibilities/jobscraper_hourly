import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const dbPaths = [
  path.resolve('state/autoapply/portal-review/queue.sqlite'),
  path.resolve('state/autoapply/queue.sqlite'),
  path.resolve('data/queue.sqlite'),
];

for (const dbPath of dbPaths) {
  if (fs.existsSync(dbPath)) {
    const db = new DatabaseSync(dbPath);
    try {
      const hasApps = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='applications'").get();
      if (hasApps) {
        const rows = db.prepare("SELECT id, payload FROM applications WHERE status IN ('failed', 'paused_for_review')").all() as Array<{ id: string; payload: string }>;
        let updated = 0;
        for (const r of rows) {
          try {
            const p = JSON.parse(r.payload);
            const text = `${p.reason || ''} ${p.error || ''} ${p.status || ''}`;
            if (/submission confirmation observed|application submitted|thank you for applying|received your application/i.test(text)) {
              p.status = 'applied';
              p.appliedAt = p.appliedAt || new Date().toISOString();
              db.prepare("UPDATE applications SET status = 'applied', payload = ? WHERE id = ?").run(JSON.stringify(p), r.id);
              updated++;
            }
          } catch {}
        }
        console.log(`[${dbPath}] [applications] Promoted to applied: ${updated}`);
      }

      const hasJobs = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'").get();
      if (hasJobs) {
        const rows = db.prepare("SELECT id, status, COALESCE(last_error, '') as err FROM jobs WHERE status IN ('failed', 'paused_for_review')").all() as Array<{ id: string; status: string; err: string }>;
        let updated = 0;
        for (const r of rows) {
          if (/submission confirmation observed|application submitted|thank you for applying|received your application/i.test(r.err)) {
            db.prepare("UPDATE jobs SET status = 'applied' WHERE id = ?").run(r.id);
            updated++;
          }
        }
        console.log(`[${dbPath}] [jobs] Promoted to applied: ${updated}`);
      }
    } catch (err: any) {
      console.log(`[${dbPath}] Error: ${err.message}`);
    }
    db.close();
  }
}
