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

  // Poll times come from board state.
  // 1. Healthy boards (no failingSince streak) before failing boards
  // 2. Oldest polled first (unpolled sorts first among healthy boards)
  const rotated = [...cold]
    .sort((a, b) => {
      const stateA = boardState[boardKey(a)];
      const stateB = boardState[boardKey(b)];
      const failA = stateA?.failingSince ? 1 : 0;
      const failB = stateB?.failingSince ? 1 : 0;
      if (failA !== failB) return failA - failB;
      return (stateA?.lastPolledAt ?? '').localeCompare(stateB?.lastPolledAt ?? '');
    })
    .slice(0, slots);

  return {
    polling: [...hot, ...rotated],
    hot: hot.length,
    cold: rotated.length,
    skipped: cold.length - rotated.length,
  };
}
