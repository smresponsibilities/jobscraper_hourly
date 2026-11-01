'use client';

import { useEffect, useMemo, useState } from 'react';
import { DATA_URL, REPO_URL, type Job } from '@/lib/types';
import { AddCompany } from './add-company';
import { YCPanel } from './yc';
import { JobMap } from './job-map';
import { WorkspaceShell, type WorkspaceView } from './workspace-shell';
import { Icon } from './ui-icon';
import { Modal } from './modal';
import { OutreachFrame } from './outreach-frame';
import { ResumeBuilderView } from './resume-builder';
import { JobTrackerView } from './job-tracker';
import { CareerJournalView } from './career-journal';
import { FitScoreView } from './fit-score-view';
import {
  loadResumes,
  saveResumes,
  loadApplications,
  saveApplications,
  loadJournal,
  saveJournal,
  exportAllDataAsJson,
  importAllDataFromJson
} from '@/lib/career-storage';
import type { TargetedResume, TrackedApplication, JournalEntry } from '@/lib/career-types';

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

const ms = (iso: string | undefined): number => new Date(iso ?? '').getTime();

/**
 * How old a posting really is: the OLDER of what the board claims and when we
 * first saw it, never the newer. Each date alone is defeatable — the board's
 * can be re-stamped, and ours only goes back as far as the catalogue does — but
 * a posting is at least as old as whichever says it is older.
 */
function effectiveAgeDays(job: Job): number | null {
  const ages = [ms(job.postedAt), ms(job.firstSeen)]
    .filter((t) => !Number.isNaN(t))
    .map((t) => (Date.now() - t) / 86_400_000);
  return ages.length ? Math.max(...ages) : null;
}

// A role still open a year on is very likely not a real vacancy: an evergreen
// "talent pool" post, a requisition nobody closed, or a listing kept up to
// collect applications. Fires on ~15% of open postings today.
const GHOST_DAYS = 365;

function isGhost(job: Job): boolean {
  if (job.closedAt) return false;
  const age = effectiveAgeDays(job);
  return age !== null && age > GHOST_DAYS;
}

// The posting claims to have been published well after the day we first saw it
// on the board, which is only possible if the date was re-stamped to look
// fresh. Our firstSeen cannot be forged by the employer, which is the whole
// reason this is detectable. The gap absorbs ordinary skew — timezones, or a
// board indexing a requisition a day or two after it was published.
const BUMP_DAYS = 7;

function isBumped(job: Job): boolean {
  const posted = ms(job.postedAt);
  const seen = ms(job.firstSeen);
  if (Number.isNaN(posted) || Number.isNaN(seen)) return false;
  return (posted - seen) / 86_400_000 > BUMP_DAYS;
}

// 2-hour bins for the first day. The first six are labeled "Last N hours"
// (Last 2, Last 4, ... Last 12); after that the same bins read as ranges
// ("12–14 hours ago") since "Last 14 hours" stops meaning anything.
function bucketLabel(job: Job): string {
  const then = crawledTime(job);
  if (then === 0) return 'Date unknown';
  const hours = Math.floor((Date.now() - then) / 3_600_000);
  const binStart = Math.floor(hours / 2) * 2;
  if (hours < 12) return `Last ${binStart + 2} hours`;
  if (hours < 24) return `${binStart}–${binStart + 2} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  // Past the first week, keep splitting rather than dumping everything into
  // one "over a week" pile — with ~2,500 open matches that single group held
  // thousands of roles and made the page read as "last 2 hours vs everything".
  if (days < 7) return `${days} days ago`;
  if (days < 14) return '1–2 weeks ago';
  if (days < 21) return '2–3 weeks ago';
  if (days < 28) return '3–4 weeks ago';
  const months = Math.min(Math.floor(days / 30), 3);
  return months <= 1 ? 'Over a month ago' : `${months}+ months ago`;
}

// Calendar-day key of firstSeen (the UTC date of the ISO stamp). The site's
// "how new" buckets are relative and scroll away as time passes; these keys
// give every posting a stable home tab, so days you didn't check stay browsable.
function dayKey(job: Job): string {
  return job.firstSeen.slice(0, 10);
}

// UTC-stable labels: comparing ISO date strings, not local midnights, so a
// job never shifts tab depending on which timezone you open the page from.
function dayLabel(key: string): string {
  if (key === new Date().toISOString().slice(0, 10)) return 'Today';
  if (key === new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)) return 'Yesterday';
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  });
}

function experience(job: Job): string {
  if (job.isIntern) return 'Internship';
  if (job.minYears === null) return 'Not stated';
  if (job.maxYears !== null) return `${job.minYears}–${job.maxYears} yrs`;
  return `${job.minYears}+ yrs`;
}

const OPENED_KEY = 'jobradar-opened';
const SAVED_KEY = 'jobradar-saved';
const APPLIED_KEY = 'jobradar-applied';
const EXCLUDE_KEY = 'jobradar-exclude';

function loadIdSet(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? '[]'));
  } catch {
    return new Set();
  }
}

function loadOpened(): Set<string> {
  return loadIdSet(OPENED_KEY);
}

function JobRow({
  job,
  opened,
  saved,
  applied,
  onOpen,
  onMark,
  onTailor,
}: {
  job: Job;
  opened: boolean;
  saved: boolean;
  applied: boolean;
  onOpen: () => void;
  onMark: (kind: 'saved' | 'applied') => void;
  onTailor: (job: Job) => void;
}) {
  const posted = ago(job.postedAt ?? job.firstSeen);
  const band =
    job.salaryMin && job.salaryMax
      ? `₹${Number.isInteger(job.salaryMin) ? job.salaryMin : job.salaryMin.toFixed(1)}–${Number.isInteger(job.salaryMax) ? job.salaryMax : job.salaryMax.toFixed(1)} LPA`
      : undefined;
  return (
    <li className="job" data-closed={Boolean(job.closedAt)} data-opened={opened} data-applied={applied}>
      <span className={'company-mark mark-tone-' + (job.company.charCodeAt(0) % 6)} aria-hidden="true">{job.company.replace(/[^a-zA-Z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase()}</span>
      <div className="job-main">
        <div className="job-eyebrow"><span className="company">{job.company}</span><span className="job-type">{job.isIntern ? 'Internship' : 'Opportunity'}</span>{opened && <span className="viewed-label">Viewed</span>}</div>
        <a className="title" href={job.url} target="_blank" rel="noreferrer" onClick={onOpen}>{job.title}<Icon name="arrow" size={16} /></a>
        <div className="meta">
          <span className="job-location" title={job.location}><Icon name="pin" size={13} />{job.location}</span>
          <span className={'tag' + (job.isIntern ? ' intern' : '')}>{experience(job)}</span>
          {band ? <span className="salary-label">{band}</span> : job.salary ? <span className="salary-label">{job.salary}</span> : null}
          {job.workMode && <span className="tag work-mode">{job.workMode}</span>}
          {job.visa && <span className="tag">Visa sponsorship</span>}
          {isBumped(job) && <span className="tag stale" title="The employer moved the posting date after we first discovered this role.">Date bumped</span>}
          {isGhost(job) && <span className="tag stale" title="This listing has been open for over a year. Confirm that the role is actively hiring.">Older listing</span>}
          {job.closedAt && <span className="tag closed">Closed</span>}
        </div>
      </div>
      <div className="job-side"><span className="posted-time">{posted || 'Date not listed'}</span><div className="job-actions">
        <button type="button" className={'mark' + (saved ? ' on' : '')} title={saved ? 'Remove from saved' : 'Save for later'} aria-label={saved ? 'Remove from saved' : 'Save for later'} aria-pressed={saved} onClick={() => onMark('saved')}><Icon name="bookmark" size={17} /></button>
        <button type="button" className={'mark' + (applied ? ' on' : '')} title={applied ? 'Unmark applied' : 'Mark applied'} aria-label={applied ? 'Unmark applied' : 'Mark applied'} aria-pressed={applied} onClick={() => onMark('applied')}><Icon name="check" size={17} /></button>
        <button type="button" className="tailor-button" title="Tailor resume & track application" onClick={() => onTailor(job)}>Tailor résumé<Icon name="arrow" size={15} /></button>
      </div></div>
    </li>
  );
}

export default function Page() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Top-level Jobs/Outreach switch — not to be confused with the per-day
  // browsing tabs below, which live entirely inside the Jobs view.
  const [view, setView] = useState<WorkspaceView>('jobs');
  const [jobDisplay, setJobDisplay] = useState<'list' | 'map'>('list');
  const [collection, setCollection] = useState<'all' | 'saved' | 'applied'>('all');
  const [sortOrder, setSortOrder] = useState('newest');
  const [jobLimit, setJobLimit] = useState(60);
  const [backlogLimit, setBacklogLimit] = useState(30);
  const [resumes, setResumes] = useState<TargetedResume[]>([]);
  const [activeResumeId, setActiveResumeId] = useState<string>('');
  const [applications, setApplications] = useState<TrackedApplication[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [outreachKey, setOutreachKey] = useState<string | null>(null);
  const [accessDialog, setAccessDialog] = useState<'outreach' | 'connect' | null>(null);
  const [keyDraft, setKeyDraft] = useState('');

  const [query, setQuery] = useState('');
  const [maxYears, setMaxYears] = useState(3);
  const [includeUnstated, setIncludeUnstated] = useState(true);
  const [industries, setIndustries] = useState<string[]>([]);
  const [internsOnly, setInternsOnly] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [company, setCompany] = useState('');
  // Facets over the Phase A fields (src/salary.ts + classify.ts).
  const [workMode, setWorkMode] = useState<'' | 'remote' | 'hybrid' | 'onsite'>('');
  const [minSalary, setMinSalary] = useState(0);
  const [visaOnly, setVisaOnly] = useState(false);
  // Personal, localStorage-only: excluded keywords and saved/applied marks.
  const [exclude, setExclude] = useState('');
  // Per-day browsing: '' is the All tab, otherwise a firstSeen YYYY-MM-DD key.
  const [day, setDay] = useState('');
  const [hideApplied, setHideApplied] = useState(false);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setJobLimit(60);
    setBacklogLimit(30);
  }, [query, maxYears, includeUnstated, industries, internsOnly, showClosed, company, workMode, minSalary, visaOnly, hideApplied, exclude, day, collection, sortOrder]);

  /**
   * URL is the shareable source of truth for the filter state. Read once on
   * mount (not in the lazy initializers — the page is statically exported, so
   * initializers also run at build time where `location` doesn't exist), and
   * written back with replaceState so every filtered view has a bookmarkable
   * URL without polluting history on each keystroke.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialView = params.get('view');
    if (initialView && ['jobs', 'resume', 'tracker', 'journal', 'audit', 'outreach', 'connect', 'yc'].includes(initialView)) setView(initialView as WorkspaceView);
    if (params.get('display') === 'map') setJobDisplay('map');
    if (/^#(?:office|map-city)=/.test(window.location.hash)) setJobDisplay('map');
    if (params.get('q')) setQuery(params.get('q')!);
    if (params.get('company')) setCompany(params.get('company')!);
    if (params.get('maxYears')) setMaxYears(Number(params.get('maxYears')));
    if (params.get('industries')) setIndustries(params.get('industries')!.split(','));
    if (params.get('mode')) setWorkMode(params.get('mode') as typeof workMode);
    if (params.get('minSalary')) setMinSalary(Number(params.get('minSalary')));
    if (params.get('interns') === '1') setInternsOnly(true);
    if (params.get('visa') === '1') setVisaOnly(true);
    if (params.get('closed') === '1') setShowClosed(true);
    if (params.get('unstated') === '0') setIncludeUnstated(false);
    if (params.get('hideApplied') === '1') setHideApplied(true);
    if (params.get('exclude')) setExclude(params.get('exclude')!);
    if (params.get('day')) setDay(params.get('day')!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (view !== 'jobs') params.set('view', view);
    if (jobDisplay === 'map') params.set('display', 'map');
    if (query) params.set('q', query);
    if (company) params.set('company', company);
    if (maxYears !== 3) params.set('maxYears', String(maxYears));
    if (industries.length) params.set('industries', industries.join(','));
    if (workMode) params.set('mode', workMode);
    if (minSalary) params.set('minSalary', String(minSalary));
    if (internsOnly) params.set('interns', '1');
    if (visaOnly) params.set('visa', '1');
    if (showClosed) params.set('closed', '1');
    if (!includeUnstated) params.set('unstated', '0');
    if (hideApplied) params.set('hideApplied', '1');
    if (exclude) params.set('exclude', exclude);
    if (day) params.set('day', day);
    const qs = params.toString();
    window.history.replaceState(null, '', (qs ? `?${qs}` : window.location.pathname) + window.location.hash);
  }, [query, company, maxYears, industries, workMode, minSalary, internsOnly, visaOnly, showClosed, includeUnstated, hideApplied, exclude, day, view, jobDisplay]);

  useEffect(() => {
    fetch(DATA_URL, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`catalogue returned ${res.status}`);
        return res.json();
      })
      .then(setJobs)
      .catch((e: Error) => setError(e.message));
    setOpened(loadOpened());
    setSavedIds(loadIdSet(SAVED_KEY));
    setAppliedIds(loadIdSet(APPLIED_KEY));
    setExclude(localStorage.getItem(EXCLUDE_KEY) ?? '');
    setOutreachKey(localStorage.getItem('outreachKey'));
    const loadedResumes = loadResumes();
    setResumes(loadedResumes);
    if (loadedResumes.length > 0) setActiveResumeId(loadedResumes[0].id);
    setApplications(loadApplications());
    setJournal(loadJournal());
  }, []);

  const markOpened = (id: string) =>
    setOpened((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev).add(id);
      localStorage.setItem(OPENED_KEY, JSON.stringify([...next]));
      return next;
    });

  /** Saved/applied are the same pattern as opened: one id-set per kind. */
  const toggleMark = (kind: 'saved' | 'applied', id: string) => {
    const setter = kind === 'saved' ? setSavedIds : setAppliedIds;
    const key = kind === 'saved' ? SAVED_KEY : APPLIED_KEY;
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem(key, JSON.stringify([...next]));
      return next;
    });
  };

  const setExcludeBoth = (value: string) => {
    setExclude(value);
    localStorage.setItem(EXCLUDE_KEY, value);
  };

  const handleUpdateResume = (updated: TargetedResume) => {
    setResumes((prev) => {
      const next = prev.map((r) => (r.id === updated.id ? updated : r));
      saveResumes(next);
      return next;
    });
  };

  const handleCreateTargetedResume = (name: string, targetRole: string, targetCompany: string, jd: string) => {
    const baseline = resumes.find((r) => r.isDefaultBaseline) || resumes[0];
    const newResume: TargetedResume = {
      id: `resume-${Date.now()}`,
      name,
      isTargeted: true,
      targetRole,
      targetCompany,
      targetJobDescription: jd,
      profile: JSON.parse(JSON.stringify(baseline.profile)),
      settings: JSON.parse(JSON.stringify(baseline.settings)),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const next = [...resumes, newResume];
    setResumes(next);
    saveResumes(next);
    setActiveResumeId(newResume.id);
  };

  const handleDeleteResume = (id: string) => {
    const next = resumes.filter((r) => r.id !== id);
    setResumes(next);
    saveResumes(next);
    if (activeResumeId === id && next.length > 0) {
      setActiveResumeId(next[0].id);
    }
  };

  const handleUpdateApp = (updated: TrackedApplication) => {
    setApplications((prev) => {
      const next = prev.map((a) => (a.id === updated.id ? updated : a));
      saveApplications(next);
      return next;
    });
  };

  const handleAddApp = (newApp: TrackedApplication) => {
    setApplications((prev) => {
      const next = [newApp, ...prev];
      saveApplications(next);
      return next;
    });
  };

  const handleDeleteApp = (id: string) => {
    setApplications((prev) => {
      const next = prev.filter((a) => a.id !== id);
      saveApplications(next);
      return next;
    });
  };

  const handleAddJournal = (entry: JournalEntry) => {
    setJournal((prev) => {
      const next = [entry, ...prev];
      saveJournal(next);
      return next;
    });
  };

  const handleDeleteJournal = (id: string) => {
    setJournal((prev) => {
      const next = prev.filter((j) => j.id !== id);
      saveJournal(next);
      return next;
    });
  };

  const handlePromoteJournal = (entry: JournalEntry, targetResumeId: string, targetExpId: string) => {
    // Double-promotion guard: prevent duplicate bullets from the same journal entry
    if (entry.promotedToAchievement) return;

    setJournal((prev) => {
      const next = prev.map((j) => (j.id === entry.id ? { ...j, promotedToAchievement: true, promotedResumeId: targetResumeId } : j));
      saveJournal(next);
      return next;
    });

    setResumes((prev) => {
      const next = prev.map((r) => {
        if (r.id !== targetResumeId) return r;
        return {
          ...r,
          profile: {
            ...r.profile,
            experiences: r.profile.experiences.map((exp) => {
              if (exp.id !== targetExpId) return exp;
              if (exp.achievements.some((a) => a.text === entry.impactSummary)) return exp;
              return {
                ...exp,
                achievements: [
                  ...exp.achievements,
                  {
                    id: `ach-${Date.now()}`,
                    text: entry.impactSummary,
                    sourceType: 'JOURNAL' as const
                  }
                ]
              };
            })
          },
          updatedAt: new Date().toISOString()
        };
      });
      saveResumes(next);
      return next;
    });
  };

  const handleTailorJob = (job: Job) => {
    let targetResume = resumes.find((r) => r.targetCompany === job.company && r.targetRole === job.title);
    if (!targetResume) {
      const baseline = resumes.find((r) => r.isDefaultBaseline) || resumes[0];
      targetResume = {
        id: `resume-${Date.now()}`,
        name: `${job.company} - ${job.title}`,
        isTargeted: true,
        targetRole: job.title,
        targetCompany: job.company,
        targetJobDescription: `${job.title} at ${job.company} in ${job.location}`,
        profile: JSON.parse(JSON.stringify(baseline.profile)),
        settings: JSON.parse(JSON.stringify(baseline.settings)),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const nextRes = [...resumes, targetResume];
      setResumes(nextRes);
      saveResumes(nextRes);
    }
    setActiveResumeId(targetResume.id);

    const existingApp = applications.find((a) => a.jobId === job.id || (a.company === job.company && a.role === job.title));
    if (!existingApp) {
      const newApp: TrackedApplication = {
        id: `app-${Date.now()}`,
        jobId: job.id,
        company: job.company,
        role: job.title,
        location: job.location,
        url: job.url,
        salary: job.salaryMin && job.salaryMax ? `₹${job.salaryMin}–${job.salaryMax} LPA` : job.salary || '',
        stage: 'saved',
        dateAdded: new Date().toISOString(),
        resumeId: targetResume.id,
        notes: `Discovered on Job Radar. Role posted: ${job.postedAt || job.firstSeen}`,
        timeline: [
          {
            id: `t-${Date.now()}`,
            date: new Date().toISOString(),
            type: 'status_change',
            note: 'Saved from Hourly Job Radar'
          }
        ]
      };
      const nextApps = [newApp, ...applications];
      setApplications(nextApps);
      saveApplications(nextApps);
    }

    setView('resume');
  };

  const handleExportBackup = () => {
    const json = exportAllDataAsJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `JobRadar_Soor_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportBackup = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        if (importAllDataFromJson(text)) {
          setResumes(loadResumes());
          setApplications(loadApplications());
          setJournal(loadJournal());
          alert('Backup restored successfully!');
        } else {
          alert('Failed to parse backup JSON.');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const companies = useMemo(
    () => [...new Set((jobs ?? []).map((j) => j.company))].sort(),
    [jobs],
  );

  const shown = useMemo(() => {
    if (!jobs) return [];
    const needle = query.trim().toLowerCase();
    const excludeWords = exclude
      .split(',')
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);

    return jobs.filter((job) => {
      if (!showClosed && job.closedAt) return false;
      if (collection === 'saved' && !savedIds.has(job.id)) return false;
      if (collection === 'applied' && !appliedIds.has(job.id)) return false;
      if (internsOnly && !job.isIntern) return false;
      if (company && job.company !== company) return false;
      if (industries.length && !industries.includes(job.industry)) return false;
      if (workMode && job.workMode !== workMode) return false;
      // "Pays at least X" reads off the top of the band — a 10–14 LPA posting
      // clears a 12 LPA floor even though its min doesn't.
      if (minSalary && (job.salaryMax ?? 0) < minSalary) return false;
      if (visaOnly && !job.visa) return false;
      if (hideApplied && appliedIds.has(job.id)) return false;

      // Interns are entry-level by definition, so the years gate doesn't apply.
      if (!job.isIntern) {
        if (job.minYears === null) {
          if (!includeUnstated) return false;
        } else if (job.minYears > maxYears) return false;
      }

      const haystack = `${job.title} ${job.company} ${job.location}`.toLowerCase();
      if (jobDisplay !== 'map' && needle && !haystack.includes(needle)) return false;
      // Excluded keywords are personal junk words — same carve-out philosophy
      // as HARD_EXCLUDE in src/classify.ts, but yours, and client-side only.
      if (excludeWords.some((word) => haystack.includes(word))) return false;
      return true;
    }).sort((a, b) => sortOrder === 'company' ? a.company.localeCompare(b.company) || crawledTime(b) - crawledTime(a) : sortOrder === 'oldest' ? crawledTime(a) - crawledTime(b) : crawledTime(b) - crawledTime(a));
  }, [jobs, query, maxYears, includeUnstated, industries, internsOnly, showClosed, company, workMode, minSalary, visaOnly, hideApplied, appliedIds, exclude, jobDisplay, collection, savedIds, sortOrder]);

  // Tab counts come off `shown` (all other filters applied), the view comes
  // off `dayShown` — filtering in two steps keeps each tab's count meaningful
  // while one is selected.
  const dayCounts = useMemo(() => {
    const tally = new Map<string, number>();
    for (const job of shown) {
      const key = dayKey(job);
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    return [...tally.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [shown]);
  const dayShown = useMemo(
    () => (day ? shown.filter((j) => dayKey(j) === day) : shown),
    [shown, day],
  );

  const freshJobs = useMemo(() => dayShown.filter((j) => !isBacklog(j)), [dayShown]);
  const backlogJobs = useMemo(() => dayShown.filter(isBacklog), [dayShown]);

  const groups = useMemo(() => {
    if (sortOrder === 'company') return freshJobs.length ? [['Companies A–Z', freshJobs.slice(0, jobLimit)] as [string, Job[]]] : [];
    const byLabel = new Map<string, Job[]>();
    for (const job of freshJobs.slice(0, jobLimit)) {
      const label = bucketLabel(job);
      const list = byLabel.get(label);
      if (list) list.push(job);
      else byLabel.set(label, [job]);
    }
    return [...byLabel.entries()];
  }, [freshJobs, sortOrder, jobLimit]);

  const toggleIndustry = (value: string) =>
    setIndustries((current) =>
      current.includes(value) ? current.filter((i) => i !== value) : [...current, value],
    );

  return (
    <WorkspaceShell view={view} display={jobDisplay} onNavigate={(next, display) => {
      if (next === 'outreach' || next === 'connect') {
        if (!outreachKey) { setKeyDraft(''); setAccessDialog(next); }
      }
      setView(next);
      if (display) setJobDisplay(display);
      if (display === 'list') window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }} onBackup={handleExportBackup} onRestore={handleImportBackup} counts={{
      open: jobs ? jobs.filter(job => !job.closedAt).length : null,
      matching: dayShown.length,
      saved: jobs ? jobs.filter(job => !job.closedAt && savedIds.has(job.id)).length : 0,
      applications: applications.length, resumes: resumes.length, journal: journal.length,
    }}>
      {view === 'jobs' && (
      <>
      <section className="controls panel" aria-label="Filter opportunities">
        <div className="search-row"><label className="search-field"><Icon name="search" size={21} /><span className="sr-only">Search jobs</span><input type="search" placeholder="A role, a company, a new beginning…" value={query} onChange={e => setQuery(e.target.value)} /></label><label className="field company-field"><span className="sr-only">Company</span><select aria-label="Company" value={company} onChange={e => setCompany(e.target.value)}><option value="">All companies</option>{companies.map(name => <option key={name} value={name}>{name}</option>)}</select></label></div>
        <div className="filter-quick-row"><div className="slider"><label htmlFor="experience-range">Experience</label><input id="experience-range" aria-label="Maximum experience" type="range" min={0} max={3} step={1} value={maxYears} onChange={e => setMaxYears(Number(e.target.value))} /><strong>{maxYears === 0 ? 'Fresher' : 'Up to ' + maxYears + (maxYears === 1 ? ' year' : ' years')}</strong></div><button type="button" className="chip" data-on={includeUnstated} aria-pressed={includeUnstated} onClick={() => setIncludeUnstated(!includeUnstated)}>Include unstated</button><button type="button" className="chip" data-on={internsOnly} aria-pressed={internsOnly} onClick={() => setInternsOnly(!internsOnly)}>Internships only</button></div>
        <details className="advanced-filters"><summary><Icon name="filter" size={16} />Refine your search<Icon name="chevron" size={15} /></summary><div className="advanced-filter-content">
          <div className="filter-line"><span className="facet-label">Industry</span><div className="row">{INDUSTRIES.map(value => <button type="button" className="chip industry-chip" key={value} data-on={industries.includes(value)} aria-pressed={industries.includes(value)} onClick={() => toggleIndustry(value)}>{value}</button>)}</div></div>
          <div className="filter-line"><span className="facet-label">Work mode</span><div className="row">{(['', 'remote', 'hybrid', 'onsite'] as const).map(value => <button type="button" className="chip" key={value || 'any'} data-on={workMode === value} aria-pressed={workMode === value} onClick={() => setWorkMode(value)}>{value || 'any'}</button>)}</div></div>
          <div className="row"><label className="field">Min salary<select value={minSalary} onChange={e => setMinSalary(Number(e.target.value))}>{[0,4,6,8,10,12,15,20].map(value => <option key={value} value={value}>{value === 0 ? 'Any salary' : '₹' + value + '+ LPA'}</option>)}</select></label><button type="button" className="chip" data-on={visaOnly} aria-pressed={visaOnly} onClick={() => setVisaOnly(!visaOnly)}>Visa sponsorship</button><button type="button" className="chip" data-on={hideApplied} aria-pressed={hideApplied} onClick={() => setHideApplied(!hideApplied)}>Hide applied</button><button type="button" className="chip" data-on={showClosed} aria-pressed={showClosed} onClick={() => setShowClosed(!showClosed)}>Show closed</button></div>
          <label className="field exclusion-field">Leave these out<input type="text" placeholder="Exclude keywords, separated by commas" value={exclude} onChange={e => setExcludeBoth(e.target.value)} /></label>
        </div></details>
      </section>

      {error && (
        <div className="result err">
          Couldn&apos;t load job data: {error}. Check that <code>NEXT_PUBLIC_REPO</code> is set and
          that the repository is public.
        </div>
      )}

      {!jobs && !error && <div className="loading-state" role="status"><span className="loading-orbit" />Finding your next possibility…</div>}

      {jobs && (
        <>
          <p className="count">
            {dayShown.length} of {jobs.filter((j) => !j.closedAt).length} open roles
            {company && (() => {
              // Lightweight company view (PHASES.md #69): a static-export site
              // can't cheaply generate a page per company, but the same data
              // answers the interesting question right here — is this employer
              // actively hiring, and how much of it is new this month?
              const all = jobs.filter((j) => j.company === company);
              const open = all.filter((j) => !j.closedAt).length;
              const month = all.filter(
                (j) => Date.now() - new Date(j.firstSeen).getTime() < 30 * 86_400_000,
              ).length;
              return ` · ${company}: ${open} open, ${month} first seen in the last 30 days`;
            })()}
          </p>

          <div className="results-toolbar">
            <div className="collection-tabs" role="group" aria-label="Job collection">{(['all', 'saved', 'applied'] as const).map(value => <button type="button" key={value} data-active={collection === value} aria-pressed={collection === value} onClick={() => setCollection(value)}>{value === 'all' ? 'All opportunities' : value === 'saved' ? 'Saved' : 'Applied'}{value === 'saved' && <span>{savedIds.size}</span>}</button>)}</div>
            <label className="sort-control"><span>Sort by</span><select aria-label="Sort opportunities" value={sortOrder} onChange={e => setSortOrder(e.target.value)}><option value="newest">Newest discovered</option><option value="oldest">Oldest discovered</option><option value="company">Company A–Z</option></select></label>
          </div>
          <div className="date-toolbar"><div className="date-shortcuts"><Icon name="clock" size={15} /><button type="button" className="date-button" data-active={!day} aria-pressed={!day} onClick={() => setDay('')}>Any time</button>{dayCounts.slice(0, 2).map(([key, n]) => <button type="button" className="date-button" key={key} data-active={day === key} aria-pressed={day === key} onClick={() => setDay(key)}>{dayLabel(key)}<span>{n}</span></button>)}</div><label className="date-select"><span className="sr-only">Discovery date</span><select aria-label="Discovery date" value={day} onChange={e => setDay(e.target.value)}><option value="">Browse by date</option>{dayCounts.map(([key,n]) => <option key={key} value={key}>{dayLabel(key)} · {n} roles</option>)}</select></label></div>

          {shown.length === 0 ? (
            <p className="empty">No opportunities found. Try a different search or relax your filters.</p>
          ) : (
            <>
              <div className="row job-display-switch" aria-label="Job display">
                <button className="chip" aria-pressed={jobDisplay === 'list'} data-on={jobDisplay === 'list'} onClick={() => { setJobDisplay('list'); window.history.replaceState(null, '', window.location.pathname + window.location.search); }}>List</button>
                <button className="chip" aria-pressed={jobDisplay === 'map'} data-on={jobDisplay === 'map'} onClick={() => setJobDisplay('map')}>Map · 5 cities</button>
              </div>
              {jobDisplay === 'map' ? <JobMap jobs={dayShown} query={query} onOpen={markOpened} /> : <>
              {groups.map(([label, jobsInGroup], index) => (
                <details key={label} className="time-group" open={index < 2}>
                  <summary className="time-heading">
                    {label} ({jobsInGroup.length})
                  </summary>
                  <ul className="jobs">
                    {jobsInGroup.map((job) => (
                      <JobRow
                        job={job}
                        key={job.id}
                        opened={opened.has(job.id)}
                        saved={savedIds.has(job.id)}
                        applied={appliedIds.has(job.id)}
                        onOpen={() => markOpened(job.id)}
                        onMark={(kind) => toggleMark(kind, job.id)}
                        onTailor={handleTailorJob}
                      />
                    ))}
                  </ul>
                </details>
              ))}

              {freshJobs.length > jobLimit && <div className="load-more"><span>Showing {jobLimit} of {freshJobs.length.toLocaleString('en-IN')} recent matches</span><button type="button" onClick={() => setJobLimit(limit => limit + 60)}>Show more opportunities<Icon name="chevron" size={16} /></button></div>}

              {backlogJobs.length > 0 && (
                <details className="time-group backlog">
                  <summary className="time-heading">
                    Backlog — {backlogJobs.length} role{backlogJobs.length === 1 ? '' : 's'} posted
                    over {BACKLOG_DAYS} days ago
                  </summary>
                  <ul className="jobs">
                    {backlogJobs.slice(0, backlogLimit).map((job) => (
                      <JobRow
                        job={job}
                        key={job.id}
                        opened={opened.has(job.id)}
                        saved={savedIds.has(job.id)}
                        applied={appliedIds.has(job.id)}
                        onOpen={() => markOpened(job.id)}
                        onMark={(kind) => toggleMark(kind, job.id)}
                        onTailor={handleTailorJob}
                      />
                    ))}
                  </ul>
                  {backlogJobs.length > backlogLimit && <div className="load-more"><span>Showing {backlogLimit} of {backlogJobs.length.toLocaleString('en-IN')} older listings</span><button type="button" onClick={() => setBacklogLimit(limit => limit + 30)}>Show more older listings<Icon name="chevron" size={16} /></button></div>}
                </details>
              )}
              </>}
            </>
          )}
        </>
      )}

      <AddCompany />
      </>
      )}

      {view === 'outreach' && (
        <section className="panel outreach-panel">
          {outreachKey ? (
            <>
              <div className="outreach-topbar">
                <span className="outreach-topbar-title">Cold Email Outreach Batch</span>
                <div className="outreach-topbar-actions">
                  <a
                    href={`/api/outreach/page?k=${encodeURIComponent(outreachKey)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="chip"
                    title="Open batch in dedicated browser tab"
                  >
                    Open full page ↗
                  </a>
                  <button
                    className="chip"
                    onClick={() => {
                      setKeyDraft(outreachKey); setAccessDialog(view);
                    }}
                  >
                    Key
                  </button>
                </div>
              </div>
              <OutreachFrame accessKey={outreachKey} kind="page" title="Outreach batch" />
            </>
          ) : (
            <div className="outreach-locked">
              <p>Outreach key needed to load today&rsquo;s batch.</p>
              <button
                className="chip"
                onClick={() => {
                  setKeyDraft(''); setAccessDialog(view);
                }}
              >
                Enter key
              </button>
            </div>
          )}
        </section>
      )}

      {view === 'connect' && (
        <section className="panel outreach-panel">
          {outreachKey ? (
            <>
              <div className="outreach-topbar">
                <span className="outreach-topbar-title">LinkedIn Connection Queue</span>
                <div className="outreach-topbar-actions">
                  <a
                    href={`/api/outreach/connects?k=${encodeURIComponent(outreachKey)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="chip"
                    title="Open list in dedicated browser tab"
                  >
                    Open full page ↗
                  </a>
                  <button
                    className="chip"
                    onClick={() => {
                      setKeyDraft(outreachKey); setAccessDialog(view);
                    }}
                  >
                    Key
                  </button>
                </div>
              </div>
              <OutreachFrame accessKey={outreachKey} kind="connects" title="Weekly LinkedIn connections" />
            </>
          ) : (
            <div className="outreach-locked">
              <p>Outreach key needed to load this week&rsquo;s list.</p>
              <button
                className="chip"
                onClick={() => {
                  setKeyDraft(''); setAccessDialog(view);
                }}
              >
                Enter key
              </button>
            </div>
          )}
        </section>
      )}

      {view === 'yc' && <YCPanel jobs={jobs ?? []} />}

      {view === 'tracker' && (
        <section className="panel" style={{ marginTop: '22px' }}>
          <JobTrackerView
            applications={applications}
            resumes={resumes}
            onUpdateApplication={handleUpdateApp}
            onAddApplication={handleAddApp}
            onDeleteApplication={handleDeleteApp}
          />
        </section>
      )}

      {view === 'resume' && (
        <section className="panel" style={{ marginTop: '22px' }}>
          <ResumeBuilderView
            resumes={resumes}
            activeResumeId={activeResumeId}
            onSelectResume={setActiveResumeId}
            onUpdateResume={handleUpdateResume}
            onCreateTargetedResume={handleCreateTargetedResume}
            onDeleteResume={handleDeleteResume}
          />
        </section>
      )}

      {view === 'journal' && (
        <section className="panel" style={{ marginTop: '22px' }}>
          <CareerJournalView
            entries={journal}
            resumes={resumes}
            onAddEntry={handleAddJournal}
            onDeleteEntry={handleDeleteJournal}
            onPromoteToResume={handlePromoteJournal}
          />
        </section>
      )}

      {view === 'audit' && (
        <section className="panel" style={{ marginTop: '22px' }}>
          <FitScoreView
            resume={resumes.find(r => r.id === activeResumeId) || resumes[0]}
            onUpdateResume={handleUpdateResume}
          />
        </section>
      )}

      {accessDialog && <Modal label="Unlock private workspace" onClose={() => setAccessDialog(null)}><form className="access-form" onSubmit={event => {
        event.preventDefault(); const key = keyDraft.trim(); if (!key) return;
        try { localStorage.setItem('outreachKey', key); } catch { /* This visit still works without persistent browser storage. */ }
        setOutreachKey(key); setView(accessDialog); setAccessDialog(null);
      }}><div className="access-form-heading"><span className="private-empty-icon"><Icon name="lock" size={25} /></span><button type="button" className="icon-button" aria-label="Close dialog" onClick={() => setAccessDialog(null)}><Icon name="close" size={17} /></button></div><span className="eyebrow">Just for your circle</span><h2>Your conversations.<br />Your private space.</h2><p>Enter your outreach access key to open contact batches and connection lists. It is remembered only in this browser.</p><label className="field">Access key<input type="password" required autoComplete="off" placeholder="Enter your access key" value={keyDraft} onChange={event => setKeyDraft(event.target.value)} /></label><button type="submit" className="access-submit" disabled={!keyDraft.trim()}>Open private workspace<Icon name="arrow" size={17} /></button></form></Modal>}
    </WorkspaceShell>
  );
}
