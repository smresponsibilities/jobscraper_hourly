/** Employer timestamps only. Discovery time never establishes publication freshness. */
export function employerPublishedAt(job: Record<string, unknown>): string | undefined {
  for (const key of ['updated_at', 'updatedAt', 'first_published', 'publishedAt', 'createdAt', 'releasedDate', 'published_on', 'published_at', 'published_date', 'created_at', 'postedAt']) {
    const value = job[key];
    const numeric = typeof value === 'number' ? value : typeof value === 'string' && /^\d{10,13}$/.test(value.trim()) ? Number(value) : NaN;
    const ms = Number.isFinite(numeric) ? (numeric < 1e12 ? numeric * 1000 : numeric)
      : typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
    if (Number.isFinite(ms) && ms > 0 && ms <= 8.64e15) return new Date(ms).toISOString();
  }
  return undefined;
}

export function isEmployerHourlyFresh(publishedAt: string | undefined, now = Date.now()): boolean {
  const age = publishedAt ? now - Date.parse(publishedAt) : NaN;
  return age >= 0 && age <= 24 * 3_600_000;
}
