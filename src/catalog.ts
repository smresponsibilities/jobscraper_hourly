import { mkdir, writeFile } from 'node:fs/promises';
import type { Job } from './types.js';
import { readJson } from './state.js';

const CATALOG_PATH = 'data/jobs.json';

/** Drop closed roles this long after they disappear from the board. */
const CLOSED_RETENTION_DAYS = 30;

/**
 * Deliberately NOT `extends Job` — `Job` carries `text`, the full job
 * description. At ~2,500 open roles that inflated this file to 4.3 MB, and it is
 * committed every hour, so git would gain tens of gigabytes a year storing a
 * fresh copy each time. Nothing downstream reads the description: the years are
 * already extracted into `minYears`, and the email and UI show neither.
 *
 * Mirrored by hand as `Job` in `web/lib/types.ts` — the web app is a separate
 * package and cannot import from here. Any field added below has to be added
 * there in the same commit or the UI silently cannot see it.
 */
export interface CatalogEntry {
  id: string;
  title: string;
  company: string;
  industry: Job['industry'];
  location: string;
  url: string;
  postedAt?: string;
  salary?: string;
  /** Normalized ₹ LPA band from src/salary.ts — drives the UI's salary facet. */
  salaryMin?: number;
  salaryMax?: number;
  workMode?: 'remote' | 'hybrid' | 'onsite';
  visa?: boolean;
  minYears: number | null;
  maxYears: number | null;
  isIntern: boolean;
  firstSeen: string;
  lastSeen: string;
  /** Set once the posting stops appearing on a board we polled successfully. */
  closedAt?: string;
  /** Requisition creator's name, when the ATS exposes it (SmartRecruiters
   *  today). A few bytes, unlike `text` — worth keeping unconditionally. */
  postedBy?: string;
}

function slim(job: Job): Omit<CatalogEntry, 'firstSeen' | 'lastSeen'> {
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    industry: job.industry,
    location: job.location,
    url: job.url,
    postedAt: job.postedAt,
    salary: job.salary,
    // A few bytes per entry; the web UI facets on all three. `isRepost` is
    // deliberately excluded — it is an alert-time judgment, not a property of
    // the posting, and it would go stale in the catalogue.
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    workMode: job.workMode ?? undefined,
    visa: job.visa || undefined,
    minYears: job.minYears,
    maxYears: job.maxYears,
    isIntern: job.isIntern,
    postedBy: job.postedBy,
  };
}

export interface CatalogUpdate {
  /** Matches discovered this run. */
  fresh: Job[];
  /**
   * Every job ID currently live, across boards that responded, mapped to the
   * posting date the board reports *right now*. The date matters because an
   * entry's `postedAt` is otherwise written once and frozen: a posting already
   * in `seen` never reaches `fresh` again, so a board re-stamping an old
   * requisition with today's date would be invisible.
   */
  liveIds: Map<string, string | undefined>;
  /** `ats:token` of boards polled successfully — a failed board must not close its jobs. */
  polledBoards: Set<string>;
  now: string;
}

/**
 * Tenant identity, parsed back out of a job id. Deliberately site-blind and
 * deliberately NOT `boardKey` from board-url.ts, which identifies a roster row
 * and includes the site. A job id carries no site, so this is the only shape
 * available here — and closure has to be decided per tenant anyway, since a
 * tenant's sites share one id space.
 */
function tenantKey(id: string): string {
  const [ats, token] = id.split(':');
  return `${ats}:${token}`;
}

const time = (iso: string | undefined): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * Should a live posting's stored `postedAt` be replaced by what the board says
 * now? Only when the board moved the date *forward*.
 *
 * Dates normally never move: Greenhouse's `first_published` is fixed, and a
 * Workday relative label only ever ages ("5 Days Ago" becomes "6 Days Ago"), so
 * this is quiet in the ordinary case. It fires when an employer re-stamps a
 * stale requisition to make it look new — which is the whole signal. Comparing
 * the refreshed date against our own `firstSeen` is what exposes it, because
 * `firstSeen` is our own observation and cannot be re-stamped by anyone.
 *
 * Backwards moves are ignored on purpose. They mean a board corrected itself or
 * changed date semantics, and taking the older value would manufacture a bump
 * on the next run when it moved forward again.
 */
export function refreshedPostedAt(stored: string | undefined, incoming: string | undefined): boolean {
  const next = time(incoming);
  if (next === null) return false;
  const current = time(stored);
  return current === null || next > current;
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
  bumped: number;
}> {
  const existing = await readJson<CatalogEntry[]>(CATALOG_PATH, []);
  const byId = new Map(existing.map((entry) => [entry.id, entry]));

  let closed = 0;
  let reopened = 0;
  let bumped = 0;

  for (const entry of byId.values()) {
    if (!update.polledBoards.has(tenantKey(entry.id))) continue;

    if (update.liveIds.has(entry.id)) {
      entry.lastSeen = update.now;
      if (refreshedPostedAt(entry.postedAt, update.liveIds.get(entry.id))) {
        entry.postedAt = update.liveIds.get(entry.id);
        bumped++;
      }
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
      ...slim(job),
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
    bumped,
  };
}
