import { existsSync, lstatSync, realpathSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type { AutoaplyJobItem } from './types.js';

/** Remove old review HTML only for applied roles with a receipt; evidence bundles stay intact. */
export function pruneReviewSnapshots(root: string, jobs: AutoaplyJobItem[], sessionFor: (job: AutoaplyJobItem) => string, now = Date.now()): number {
  const applications = path.join(root, 'applications');
  if (!existsSync(applications) || lstatSync(applications).isSymbolicLink()) return 0;
  const base = realpathSync(applications);
  if (path.dirname(base) !== realpathSync(root)) return 0;
  let removed = 0;
  for (const job of jobs) {
    if (job.status !== 'applied' || !job.receipt) continue;
    const session = sessionFor(job);
    if (!existsSync(session) || lstatSync(session).isSymbolicLink()) continue;
    const resolved = realpathSync(session);
    if (path.dirname(resolved) !== base) continue;
    const file = path.join(resolved, 'review.html');
    if (!existsSync(file)) continue;
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || now - stat.mtimeMs < 14 * 86400000) continue;
    unlinkSync(file);
    removed++;
  }
  return removed;
}
