import type { Company, RawJob } from '../types.js';
import { getJson, toPlainText } from './util.js';

interface GhJob {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  updated_at?: string;
  first_published?: string;
  content?: string;
}

/**
 * Deliberately fetched WITHOUT `?content=true`. Descriptions roughly 20x the
 * payload, and we only need them for jobs that turn out to be new — see enrich().
 */
export async function list(company: Company): Promise<RawJob[]> {
  const data = await getJson<{ jobs?: GhJob[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${company.token}/jobs`,
  );
  return (data.jobs ?? []).map((j) => ({
    externalId: String(j.id),
    title: j.title,
    location: j.location?.name ?? '',
    url: j.absolute_url,
    // No `?? j.updated_at` fallback. `updated_at` is a mutation timestamp, not a
    // posting date: it moves on every trivial edit to the requisition. Measured
    // 2026-09-03 across 200 live hot boards / 10,402 postings — `first_published`
    // is present on 98.3%, and where both exist they sit a median 23 days apart
    // (p90 223, max 2,704). So the fallback only ever fired for 1.7% of postings,
    // and when it did it reported an edit as the posting date — inflating
    // freshness and, once date-bump detection lands, reading as a permanent bump
    // because the value keeps moving. An absent date already means "always
    // fresh" (see EMAIL_FRESHNESS_DAYS), which is the safe direction for 1.7%.
    postedAt: j.first_published,
  }));
}

export async function enrich(company: Company, job: RawJob): Promise<string | undefined> {
  const data = await getJson<GhJob>(
    `https://boards-api.greenhouse.io/v1/boards/${company.token}/jobs/${job.externalId}`,
  );
  return data.content ? toPlainText(data.content) : undefined;
}
