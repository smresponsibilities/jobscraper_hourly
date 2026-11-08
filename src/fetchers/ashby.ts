import type { Company, RawJob } from '../types.js';
import { getJson } from './util.js';

interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  secondaryLocations?: Array<string | { location?: string }>;
  isRemote?: boolean;
  employmentType?: string;
  publishedAt?: string;
  jobUrl: string;
  descriptionPlain?: string;
  compensation?: {
    compensationTierSummary?: string;
    summaryComponents?: { summary?: string }[];
  };
}

/**
 * Ashby has no lightweight list mode — the board endpoint always ships full
 * descriptions (OpenAI's board is ~10 MB). Nothing to optimise, just accept it.
 */
export async function list(company: Company): Promise<RawJob[]> {
  const data = await getJson<{ jobs?: AshbyJob[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${company.token}?includeCompensation=true`,
  );
  return (data.jobs ?? []).map((j) => {
    const extra = (j.secondaryLocations ?? []).map((s) => typeof s === 'string' ? s : s?.location).filter(Boolean);
    const remote = j.isRemote ? 'Remote' : '';
    return {
      externalId: j.id,
      title: j.title,
      location: [j.location, ...extra, remote].filter(Boolean).join(', '),
      url: j.jobUrl,
      postedAt: j.publishedAt,
      salary:
        j.compensation?.compensationTierSummary ??
        j.compensation?.summaryComponents?.[0]?.summary,
      text: [j.employmentType, j.descriptionPlain].filter(Boolean).join(' '),
    };
  });
}
