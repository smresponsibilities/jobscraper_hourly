import type { BoardState, Company } from './types.js';
import { BOARDS_PER_RUN } from './config.js';
import { boardKey } from './board-url.js';

/**
 * Chooses which boards this run polls.
 *
 * Every board that has ever returned an India/remote role is "hot" and polled
 * every run — those are the ones that can actually alert, and latency on them
 * is the whole product. The rest are "cold": real, live boards at companies
 * that simply have nothing in India right now. Dropping them would mean never
 * noticing the day that changes, but polling all ~17,000 every hour would put
 * the run past two hours.
 *
 * So cold boards rotate, oldest-polled first. A board that has never been
 * polled sorts first, so a fresh import is swept promptly rather than
 * languishing behind boards that were already checked.
 *
 * Deliberately NOT random: random selection gives no bound on how long a
 * board can go unchecked, while oldest-first guarantees a full sweep every
 * ceil(cold / slots) runs.
 */
export interface Selection {
  polling: Company[];
  hot: number;
  cold: number;
  skipped: number;
}

export function selectBoards(
  companies: readonly Company[],
  boardState: BoardState = {},
  limit: number = BOARDS_PER_RUN,
): Selection {
  const hot = companies.filter((c) => c.lastIndiaAt);
  const cold = companies.filter((c) => !c.lastIndiaAt);

  // Hot boards are never skipped. If they alone exceed the ceiling, the
  // ceiling yields — a board that can alert must not wait on rotation.
  const slots = Math.max(0, limit - hot.length);

  // Poll times come from the board state now, not the Company row. A board the
  // state has never heard of reads as never-polled and sorts first, which is
  // also what makes an evicted cache degrade into a clean full sweep.
  const polledAt = (c: Company) => boardState[boardKey(c)]?.lastPolledAt ?? '';

  const rotated = [...cold]
    .sort((a, b) => polledAt(a).localeCompare(polledAt(b)))
    .slice(0, slots);

  return {
    polling: [...hot, ...rotated],
    hot: hot.length,
    cold: rotated.length,
    skipped: cold.length - rotated.length,
  };
}
