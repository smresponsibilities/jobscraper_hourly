'use client';

import { useEffect, useMemo, useState } from 'react';
import { DATA_URL, REPO_URL, type Job } from '@/lib/types';
import { AddCompany } from './add-company';

const INDUSTRIES = ['tech', 'fintech', 'quant', 'banking', 'consulting'] as const;

function ago(iso?: string): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso.replace(/^posted\s*/i, '') || null;
  const hours = Math.floor((Date.now() - then) / 3_600_000);
  if (hours < 1) return 'just posted';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

// Grouped/sorted by firstSeen (when our hourly crawl first found the posting),
// not postedAt — ATS-reported dates are often relative ("2 days ago") and get
// bumped on repost, so crawl time is the only reliable "how new is this" signal.
function crawledTime(job: Job): number {
  const t = new Date(job.firstSeen).getTime();
  return Number.isNaN(t) ? 0 : t;
}

// Same threshold and "no date = benefit of the doubt" rule as EMAIL_FRESHNESS_DAYS
// / isFreshEnough in src/config.ts + src/filter.ts. Without this, a newly-added
// company dumps its whole (real, but old) backlog into the "past hour" bucket
// just because our crawl found it an hour ago — same bug the email digest hit
// first, fixed there by demoting backlog to its own section instead of hiding
// or mis-labeling it.
const BACKLOG_DAYS = 21;

function isBacklog(job: Job): boolean {
  if (!job.postedAt) return false;
  const posted = new Date(job.postedAt).getTime();
  if (Number.isNaN(posted)) return false;
  return (Date.now() - posted) / 86_400_000 > BACKLOG_DAYS;
}

// 2-hour bins for the first 24 hours (12 groups), so a group actually holds
// enough roles to be worth a header — hourly bins were mostly empty since
// firstSeen depends on when a board happened to be polled, not a steady drip.
function bucketLabel(job: Job): string {
  const then = crawledTime(job);
  if (then === 0) return 'Date unknown';
  const hours = Math.floor((Date.now() - then) / 3_600_000);
  if (hours < 24) {
    const binStart = Math.floor(hours / 2) * 2;
    return binStart === 0 ? 'Past 2 hours' : `${binStart}–${binStart + 2} hours ago`;
  }
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return 'Over a week ago';
}

function experience(job: Job): string {
  if (job.isIntern) return 'Internship';
  if (job.minYears === null) return 'Not stated';
  if (job.maxYears !== null) return `${job.minYears}–${job.maxYears} yrs`;
  return `${job.minYears}+ yrs`;
}

function JobRow({ job }: { job: Job }) {
  const posted = ago(job.postedAt ?? job.firstSeen);
  return (
    <li className="job" data-closed={Boolean(job.closedAt)}>
      <a className="title" href={job.url} target="_blank" rel="noreferrer">
        {job.title}
      </a>
      <div className="company">{job.company}</div>
      <div className="meta">
        <span>{job.location}</span>
        <span className={`tag${job.isIntern ? ' intern' : ''}`}>{experience(job)}</span>
        {posted && <span>{posted}</span>}
        {job.salary && <span>{job.salary}</span>}
        {job.closedAt && <span className="tag closed">closed</span>}
      </div>
    </li>
  );
}

export default function Page() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [maxYears, setMaxYears] = useState(3);
  const [includeUnstated, setIncludeUnstated] = useState(true);
  const [industries, setIndustries] = useState<string[]>([]);
  const [internsOnly, setInternsOnly] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [company, setCompany] = useState('');

  useEffect(() => {
    fetch(DATA_URL, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`catalogue returned ${res.status}`);
        return res.json();
      })
      .then(setJobs)
      .catch((e: Error) => setError(e.message));
  }, []);

  const companies = useMemo(
    () => [...new Set((jobs ?? []).map((j) => j.company))].sort(),
    [jobs],
  );

  const shown = useMemo(() => {
    if (!jobs) return [];
    const needle = query.trim().toLowerCase();

    return jobs.filter((job) => {
      if (!showClosed && job.closedAt) return false;
      if (internsOnly && !job.isIntern) return false;
      if (company && job.company !== company) return false;
      if (industries.length && !industries.includes(job.industry)) return false;

      // Interns are entry-level by definition, so the years gate doesn't apply.
      if (!job.isIntern) {
        if (job.minYears === null) {
          if (!includeUnstated) return false;
        } else if (job.minYears > maxYears) return false;
      }

      if (needle) {
        const haystack = `${job.title} ${job.company} ${job.location}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    }).sort((a, b) => crawledTime(b) - crawledTime(a));
  }, [jobs, query, maxYears, includeUnstated, industries, internsOnly, showClosed, company]);

  const freshJobs = useMemo(() => shown.filter((j) => !isBacklog(j)), [shown]);
  const backlogJobs = useMemo(() => shown.filter(isBacklog), [shown]);

  const groups = useMemo(() => {
    const byLabel = new Map<string, Job[]>();
    for (const job of freshJobs) {
      const label = bucketLabel(job);
      const list = byLabel.get(label);
      if (list) list.push(job);
      else byLabel.set(label, [job]);
    }
    return [...byLabel.entries()];
  }, [freshJobs]);

  const toggleIndustry = (value: string) =>
    setIndustries((current) =>
      current.includes(value) ? current.filter((i) => i !== value) : [...current, value],
    );

  return (
    <main className="wrap">
      <header>
        <h1>Job Radar</h1>
        <p>
          Fresher and entry-level roles in India and remote, read straight from company ATS
          boards. Updated hourly.
        </p>
      </header>

      <section className="controls panel">
        <div className="row">
          <input
            type="search"
            placeholder="Search title, company or location…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="field">
            Company
            <select value={company} onChange={(e) => setCompany(e.target.value)}>
              <option value="">All companies</option>
              {companies.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="row">
          <div className="slider">
            <span>Max experience</span>
            <input
              type="range"
              min={0}
              max={3}
              step={1}
              value={maxYears}
              onChange={(e) => setMaxYears(Number(e.target.value))}
            />
            <strong>
              {maxYears} {maxYears === 1 ? 'year' : 'years'}
            </strong>
          </div>
          <button
            className="chip"
            data-on={includeUnstated}
            onClick={() => setIncludeUnstated((v) => !v)}
          >
            Include unstated
          </button>
          <button className="chip" data-on={internsOnly} onClick={() => setInternsOnly((v) => !v)}>
            Internships only
          </button>
          <button className="chip" data-on={showClosed} onClick={() => setShowClosed((v) => !v)}>
            Show closed
          </button>
        </div>

        <div className="row">
          {INDUSTRIES.map((value) => (
            <button
              key={value}
              className="chip"
              data-on={industries.includes(value)}
              onClick={() => toggleIndustry(value)}
            >
              {value}
            </button>
          ))}
        </div>
      </section>

      {error && (
        <div className="result err">
          Couldn&apos;t load job data: {error}. Check that <code>NEXT_PUBLIC_REPO</code> is set and
          that the repository is public.
        </div>
      )}

      {!jobs && !error && <p className="empty">Loading roles…</p>}

      {jobs && (
        <>
          <p className="count">
            {shown.length} of {jobs.filter((j) => !j.closedAt).length} open roles
          </p>

          {shown.length === 0 ? (
            <p className="empty">Nothing matches those filters.</p>
          ) : (
            <>
              {groups.map(([label, jobsInGroup], index) => (
                <details key={label} className="time-group" open={index < 2}>
                  <summary className="time-heading">
                    {label} ({jobsInGroup.length})
                  </summary>
                  <ul className="jobs">
                    {jobsInGroup.map((job) => (
                      <JobRow job={job} key={job.id} />
                    ))}
                  </ul>
                </details>
              ))}

              {backlogJobs.length > 0 && (
                <details className="time-group backlog">
                  <summary className="time-heading">
                    Backlog — {backlogJobs.length} role{backlogJobs.length === 1 ? '' : 's'} posted
                    over {BACKLOG_DAYS} days ago
                  </summary>
                  <ul className="jobs">
                    {backlogJobs.map((job) => (
                      <JobRow job={job} key={job.id} />
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </>
      )}

      <AddCompany />

      <footer>
        Data and source on <a href={REPO_URL}>GitHub</a>. Apply on the company link — direct
        applications convert far better than aggregators.
      </footer>
    </main>
  );
}
