export interface SurvivalPriorityJob {
  provider: string;
  publishedAt?: string | number | null;
  discoveredAt?: string | number | null;
  title?: string;
  location?: string;
  isFastAts?: boolean;
}

/** Exponential freshness heuristic; its hazard rate is not empirically calibrated. */
export function computeJobSurvivalPriorityScore(job: SurvivalPriorityJob, nowMs = Date.now()): { totalScore: number; survivalProbability: number; freshnessBonus: number } {
  const raw = job.publishedAt;
  const timestamp = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Date.parse(raw) : NaN;
  const valid = Number.isFinite(nowMs) && Number.isFinite(timestamp) && timestamp > 0 && timestamp <= nowMs;
  const survivalProbability = valid ? Math.exp(-0.035 * ((nowMs - timestamp) / 3_600_000)) : 0.25;
  const freshnessBonus = valid ? Math.floor(15_000 * survivalProbability) : 0;
  const providerBonus = /^(?:greenhouse|ashby|lever|workable|recruitee|breezy)$/i.test(job.provider || '') ? 6_000 : 0;
  const location = job.location || '';
  const locationBonus = /\b(?:bengaluru|bangalore)\b/i.test(location) ? 4_000 : /\b(?:india|remote)\b/i.test(location) ? 2_500 : 0;
  return { totalScore: freshnessBonus + providerBonus + locationBonus, survivalProbability, freshnessBonus };
}
