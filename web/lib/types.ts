export type Industry = 'tech' | 'fintech' | 'quant' | 'banking' | 'consulting';

export interface Job {
  id: string;
  title: string;
  company: string;
  industry: Industry;
  location: string;
  url: string;
  postedAt?: string;
  salary?: string;
  minYears: number | null;
  maxYears: number | null;
  isIntern: boolean;
  firstSeen: string;
  lastSeen: string;
  closedAt?: string;
}

export interface Company {
  name: string;
  ats: string;
  token: string;
  industry: Industry;
  host?: string;
  site?: string;
}

/**
 * Where the site reads its data. Set NEXT_PUBLIC_REPO in Vercel to
 * "yourname/jobscraper-next" — everything else follows from that.
 */
const REPO = process.env.NEXT_PUBLIC_REPO ?? '';
const BRANCH = process.env.NEXT_PUBLIC_BRANCH ?? 'main';

/**
 * With NEXT_PUBLIC_REPO set, data is read live from GitHub, so the hourly
 * workflow's commit updates the site with no redeploy. Without it, the page
 * falls back to same-origin files — copy data/jobs.json into web/public/data/
 * to preview locally before the repo exists.
 */
export const DATA_BASE = REPO ? `https://raw.githubusercontent.com/${REPO}/${BRANCH}` : '';
export const REPO_URL = REPO ? `https://github.com/${REPO}` : '#';
