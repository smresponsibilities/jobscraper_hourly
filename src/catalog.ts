import { mkdir, writeFile } from 'node:fs/promises';
import type { Job } from './types.js';
import { readJson } from './state.js';

const CATALOG_PATH = 'data/jobs.json';

/** Drop closed roles this long after they disappear from the board. */
const CLOSED_RETENTION_DAYS = 30;

export interface CatalogEntry extends Job {
  firstSeen: string;
  lastSeen: string;
  /** Set once the posting stops appearing on a board we polled successfully. */
  closedAt?: string;
}

export interface CatalogUpdate {
  /** Matches discovered this run. */
  fresh: Job[];
  /** Every job ID currently live, across boards that responded. */
  liveIds: Set<string>;
  /** `ats:token` of boards polled successfully — a failed board must not close its jobs. */
  polledBoards: Set<string>;
  now: string;
}

function boardKey(id: string): string {
  const [ats, token] = id.split(':');
  return `${ats}:${token}`;
}

/**
 * The catalogue is what the UI reads: every match currently open, plus recently
 * closed ones. Closure is inferred from absence — a posting that vanishes from a
 * board that answered normally has been taken down. Boards that errored are
 * skipped, otherwise one flaky response would mark a company's entire listing
 * as closed.
 */
export async function updateCatalog(update: CatalogUpdate): Promise<{
  open: number;
  closed: number;
  reopened: number;
  pruned: number;
}> {
  const existing = await readJson<CatalogEntry[]>(CATALOG_PATH, []);
  const byId = new Map(existing.map((entry) => [entry.id, entry]));

  let closed = 0;
  let reopened = 0;

  for (const entry of byId.values()) {
    if (!update.polledBoards.has(boardKey(entry.id))) continue;

    if (update.liveIds.has(entry.id)) {
      entry.lastSeen = update.now;
      if (entry.closedAt) {
        delete entry.closedAt;
        reopened++;
      }
    } else if (!entry.closedAt) {
      entry.closedAt = update.now;
      closed++;
    }
  }

  for (const job of update.fresh) {
    const previous = byId.get(job.id);
    byId.set(job.id, {
      ...job,
      firstSeen: previous?.firstSeen ?? update.now,
      lastSeen: update.now,
    });
  }

  const cutoff = Date.now() - CLOSED_RETENTION_DAYS * 86_400_000;
  const kept = [...byId.values()].filter(
    (entry) => !entry.closedAt || new Date(entry.closedAt).getTime() >= cutoff,
  );

  kept.sort((a, b) => b.firstSeen.localeCompare(a.firstSeen));

  await mkdir('data', { recursive: true });
  await writeFile(CATALOG_PATH, `${JSON.stringify(kept)}\n`, 'utf8');

  return {
    open: kept.filter((entry) => !entry.closedAt).length,
    closed,
    reopened,
    pruned: byId.size - kept.length,
  };
}
