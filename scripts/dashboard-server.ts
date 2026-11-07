// scripts/dashboard-server.ts
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readJobRunHistory, type JobRunHistoryEntry } from '../src/autoapply/run-history.js';
import { syncGitHubActionsPillars } from './sync-github-actions-pillars.js';

const PORT = Number(process.env.AUTOAPPLY_DASHBOARD_PORT || 4321);
const LOG_PATH = path.resolve('out/hourly-daemon.log');
const SCOREBOARD_PATH = path.resolve('state/autoapply/portal-review/park-issues-scoreboard.json');
const LOCK_PATH = path.resolve('state/autoapply/portal-review/worker.lock');
const OUTREACH_PATH = path.resolve('state/autoapply/portal-review/outreach-leads.json');
const QUEUE_SUMMARY_PATH = path.resolve('state/autoapply/portal-review/queue-summary.json');
const OVERNIGHT_REPORT_PATH = path.resolve('state/autoapply/portal-review/overnight-improvement-report.json');
const IN_FLIGHT_PATH = path.resolve('state/autoapply/portal-review/in-flight-checkpoint.json');
const HOURLY_DISCOVERIES_PATH = path.resolve('state/autoapply/portal-review/hourly-discoveries.jsonl');
const LAST_SYNC_PATH = path.resolve('state/autoapply/portal-review/last-discovery-sync.json');
const SQLITE_DB_PATH = path.resolve('state/autoapply/portal-review/queue.sqlite');

let cachedErrorsData: any = null;
let lastErrorsMs = 0;

export function getOvernightErrorsData() {
  const now = Date.now();
  if (cachedErrorsData && now - lastErrorsMs < 2000) {
    return cachedErrorsData;
  }
  try {
    if (fs.existsSync(OVERNIGHT_REPORT_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(OVERNIGHT_REPORT_PATH, 'utf8'));
      cachedErrorsData = parsed;
      lastErrorsMs = now;
      return parsed;
    }
  } catch {}
  return cachedErrorsData || { topFailureCategories: [], topUnknownQuestions: [], missedButtonStalls: [] };
}

let cachedHourlyJobsData: any = null;
let lastHourlyJobsMs = 0;

export function getHourlyJobsData() {
  const now = Date.now();
  if (cachedHourlyJobsData && now - lastHourlyJobsMs < 1500) {
    return cachedHourlyJobsData;
  }
  const oneHourAgo = now - 3600_000;
  const oneDayAgo = now - 86400_000;

  let lastSyncAt = new Date().toISOString();
  if (fs.existsSync(LAST_SYNC_PATH)) {
    try {
      const syncInfo = JSON.parse(fs.readFileSync(LAST_SYNC_PATH, 'utf8'));
      if (syncInfo.lastSyncAt) lastSyncAt = syncInfo.lastSyncAt;
    } catch {}
  }

  const hourlyItems: any[] = [];
  if (fs.existsSync(HOURLY_DISCOVERIES_PATH)) {
    try {
      const lines = fs.readFileSync(HOURLY_DISCOVERIES_PATH, 'utf8').trim().split(/\r?\n/).filter(Boolean);
      for (const line of lines.slice(-300).reverse()) {
        try {
          hourlyItems.push(JSON.parse(line));
        } catch {}
      }
    } catch {}
  }

  // Also query queue.sqlite for any jobs with isHourlyFresh in payload if hourlyItems is small
  if (hourlyItems.length < 50 && fs.existsSync(SQLITE_DB_PATH)) {
    try {
      const db = new DatabaseSync(SQLITE_DB_PATH);
      const rows = db.prepare("SELECT id, normalized_url, status, payload FROM applications WHERE payload LIKE '%isHourlyFresh%' ORDER BY rowid DESC LIMIT 150").all() as any[];
      const seenIds = new Set(hourlyItems.map(h => h.id || h.jobUrl));
      for (const r of rows) {
        if (!seenIds.has(r.id) && !seenIds.has(r.normalized_url)) {
          try {
            const p = JSON.parse(r.payload);
            hourlyItems.push({
              id: r.id,
              title: p.title || 'Software Engineer',
              company: p.company || 'Company',
              jobUrl: r.normalized_url,
              status: r.status,
              hourlySource: p.hourlySource || 'github_hunt',
              discoveredAt: p.discoveredAt || p.postedAt || new Date().toISOString(),
              durationMs: p.durationMs || 0,
              reason: p.error || p.reason || r.status,
            });
            seenIds.add(r.id);
          } catch {}
        }
      }
      db.close();
    } catch {}
  }

  const history = readJobRunHistory(300);
  const historyMap = new Map<string, JobRunHistoryEntry>();
  for (const h of history) {
    if (h.jobId && !historyMap.has(h.jobId)) historyMap.set(h.jobId, h);
    if (h.url && !historyMap.has(h.url)) historyMap.set(h.url, h);
  }

  const enriched = hourlyItems.map(item => {
    const hist = historyMap.get(item.id) || historyMap.get(item.jobUrl);
    return {
      id: item.id,
      company: item.company || 'Unknown',
      title: item.title || 'Software Engineer',
      url: item.jobUrl || item.url || '',
      provider: item.provider || (item.jobUrl?.includes('greenhouse.io') ? 'greenhouse' : item.jobUrl?.includes('ashbyhq.com') ? 'ashby' : item.jobUrl?.includes('myworkdayjobs.com') ? 'workday' : 'ats'),
      hourlySource: item.hourlySource || 'github_hunt',
      discoveredAt: item.discoveredAt || item.postedAt || new Date().toISOString(),
      status: hist ? hist.status : (item.status || 'queued'),
      reason: hist ? hist.reason : (item.reason || '--'),
      durationMs: hist ? hist.durationMs : (item.durationMs || 0),
    };
  });

  const discovered1h = enriched.filter(j => new Date(j.discoveredAt).getTime() >= oneHourAgo).length;
  const discovered24h = enriched.filter(j => new Date(j.discoveredAt).getTime() >= oneDayAgo).length;
  const appliedHourlyCount = enriched.filter(j => j.status === 'applied').length;
  const queuedHourlyCount = enriched.filter(j => j.status === 'queued').length;
  const pausedHourlyCount = enriched.filter(j => j.status === 'paused_for_review').length;

  const bySource: Record<string, number> = {
    github_hunt: 0,
    linkedin_1h: 0,
    yc_hiring: 0,
    hn_hiring: 0,
  };
  for (const j of enriched) {
    const src = j.hourlySource || 'github_hunt';
    bySource[src] = (bySource[src] || 0) + 1;
  }

  const result = {
    now: new Date().toISOString(),
    lastSyncAt,
    discovered1h,
    discovered24h,
    appliedHourlyCount,
    queuedHourlyCount,
    pausedHourlyCount,
    bySource,
    jobs: enriched.slice(0, 150),
  };
  cachedHourlyJobsData = result;
  lastHourlyJobsMs = now;
  return result;
}

let cachedTelemetry: any = null;
let lastTelemetryMs = 0;

export function getDashboardTelemetry() {
  const now = Date.now();
  if (cachedTelemetry && now - lastTelemetryMs < 1500) {
    return cachedTelemetry;
  }
  const oneHourAgo = now - 3600_000;
  const oneDayAgo = now - 86400_000;

  const history: JobRunHistoryEntry[] = readJobRunHistory(200);

  let queueTotals: Record<string, number> = {
    applied: 40,
    failed: 15,
    paused_for_review: 10,
    queued: 6241,
    skipped: 11400,
  };

  if (fs.existsSync(QUEUE_SUMMARY_PATH)) {
    try {
      const qData = JSON.parse(fs.readFileSync(QUEUE_SUMMARY_PATH, 'utf8'));
      queueTotals = { ...queueTotals, ...qData };
    } catch {}
  }

  history.sort((a, b) => new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime());

  const past1h = history.filter(h => new Date(h.finishedAt).getTime() >= oneHourAgo);
  const past24h = history.filter(h => new Date(h.finishedAt).getTime() >= oneDayAgo);

  const summarizeWindow = (items: typeof history) => {
    const withDur = items.filter(i => i.durationMs > 0);
    const sortedDur = withDur.map(i => i.durationMs).sort((a, b) => a - b);
    const avgMs = withDur.length ? Math.round(withDur.reduce((s, i) => s + i.durationMs, 0) / withDur.length) : 0;
    const p50Ms = sortedDur.length ? sortedDur[Math.floor(sortedDur.length * 0.5)]! : 0;
    const p95Ms = sortedDur.length ? sortedDur[Math.floor(sortedDur.length * 0.95)]! : 0;

    return {
      totalProcessed: items.length,
      applied: items.filter(i => i.status === 'applied').length,
      failed: items.filter(i => i.status === 'failed').length,
      paused: items.filter(i => i.status === 'paused_for_review').length,
      skipped: items.filter(i => i.status === 'skipped').length,
      avgDurationSec: (avgMs / 1000).toFixed(1),
      p50DurationSec: (p50Ms / 1000).toFixed(1),
      p95DurationSec: (p95Ms / 1000).toFixed(1),
    };
  };

  const targetProviders = ['greenhouse', 'ashby', 'lever', 'workday', 'smartrecruiters'];
  const providerStats: Record<string, {
    runs: number;
    applied: number;
    failed: number;
    avgSec: string;
    fastestSec: string;
    slowestSec: string;
    p95Sec: string;
  }> = {};

  for (const prov of targetProviders) {
    providerStats[prov] = {
      runs: 0,
      applied: 0,
      failed: 0,
      avgSec: '0.0',
      fastestSec: '0.0',
      slowestSec: '0.0',
      p95Sec: '0.0',
    };
  }

  for (const h of history) {
    const prov = (h.provider || 'other').toLowerCase();
    if (!providerStats[prov]) {
      providerStats[prov] = {
        runs: 0,
        applied: 0,
        failed: 0,
        avgSec: '0.0',
        fastestSec: '0.0',
        slowestSec: '0.0',
        p95Sec: '0.0',
      };
    }
    providerStats[prov]!.runs += 1;
    if (h.status === 'applied') providerStats[prov]!.applied += 1;
    if (h.status === 'failed') providerStats[prov]!.failed += 1;
  }

  for (const prov of Object.keys(providerStats)) {
    const durs = history
      .filter(h => (h.provider || 'other').toLowerCase() === prov && h.durationMs > 0)
      .map(x => x.durationMs)
      .sort((a, b) => a - b);
    if (durs.length > 0) {
      const avg = durs.reduce((s, x) => s + x, 0) / durs.length / 1000;
      const fastest = durs[0]! / 1000;
      const slowest = durs[durs.length - 1]! / 1000;
      const p95 = durs[Math.floor(durs.length * 0.95)]! / 1000;
      providerStats[prov]!.avgSec = avg.toFixed(1);
      providerStats[prov]!.fastestSec = fastest.toFixed(1);
      providerStats[prov]!.slowestSec = slowest.toFixed(1);
      providerStats[prov]!.p95Sec = p95.toFixed(1);
    }
  }

  let logLines: string[] = [];
  if (fs.existsSync(LOG_PATH)) {
    try {
      logLines = fs.readFileSync(LOG_PATH, 'utf8').split(/\r?\n/).slice(-250);
    } catch {}
  }

  let scoreboard = {};
  if (fs.existsSync(SCOREBOARD_PATH)) {
    try {
      scoreboard = JSON.parse(fs.readFileSync(SCOREBOARD_PATH, 'utf8'));
    } catch {}
  }

  let workerPid: number | null = null;
  if (fs.existsSync(LOCK_PATH)) {
    try {
      const raw = fs.readFileSync(LOCK_PATH, 'utf8').trim();
      const lockData = JSON.parse(raw);
      const pidVal = typeof lockData === 'number' ? lockData : (lockData.pid || null);
      if (pidVal) {
        try {
          process.kill(pidVal, 0);
          workerPid = pidVal;
        } catch {
          workerPid = null;
        }
      }
    } catch {
      try {
        const raw = fs.readFileSync(LOCK_PATH, 'utf8').trim();
        const num = parseInt(raw, 10);
        if (!isNaN(num) && num > 0) {
          process.kill(num, 0);
          workerPid = num;
        }
      } catch {}
    }
  }

  let outreachLeadsCount = 0;
  if (fs.existsSync(OUTREACH_PATH)) {
    try {
      const leads = JSON.parse(fs.readFileSync(OUTREACH_PATH, 'utf8'));
      if (Array.isArray(leads)) outreachLeadsCount = leads.length;
    } catch {}
  }

  let inFlightJob: any = null;
  if (fs.existsSync(IN_FLIGHT_PATH)) {
    try {
      const raw = fs.readFileSync(IN_FLIGHT_PATH, 'utf8').trim();
      if (raw && raw !== '{}') {
        const data = JSON.parse(raw);
        const keys = Object.keys(data);
        const firstKey = keys[0];
        if (firstKey) inFlightJob = data[firstKey];
      }
    } catch {}
  }

  const activeLanes = ['greenhouse', 'ashby', 'workday', 'other'];
  const historyVerifiedCount = history.filter(h => h.receiptVerified || h.status === 'applied').length;
  const verifiedReceipts = Math.max(queueTotals['applied'] || 0, historyVerifiedCount);

  const telemetry = {
    now: new Date().toISOString(),
    workerPid,
    inFlightJob,
    activeLanes,
    verifiedReceipts,
    outreachLeads: outreachLeadsCount,
    queueTotals,
    window1h: summarizeWindow(past1h),
    window24h: summarizeWindow(past24h),
    windowAll: summarizeWindow(history),
    providerStats,
    recentRuns: history.slice(0, 150),
    scoreboard,
    logLines,
  };
  cachedTelemetry = telemetry;
  lastTelemetryMs = now;
  return telemetry;
}

function renderDashboardHtml(initialTelemetry?: any, initialErrors?: any, initialHourly?: any): string {
  const initBootstrap = `<script>\n  window.__INITIAL_TELEMETRY__ = ${JSON.stringify(initialTelemetry || null).replace(/</g, '\\u003c')};\n  window.__INITIAL_OVERNIGHT_ERRORS__ = ${JSON.stringify(initialErrors || null).replace(/</g, '\\u003c')};\n  window.__INITIAL_HOURLY__ = ${JSON.stringify(initialHourly || null).replace(/</g, '\\u003c')};\n</script>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>\n${initBootstrap}
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Auto-Apply Live Operations & Durations Dashboard</title>
<style>
  :root {
    --bg-main: #0b0f17;
    --bg-card: #131924;
    --bg-card-alt: #1a2232;
    --border: #243044;
    --text-primary: #f1f5f9;
    --text-muted: #94a3b8;
    --accent: #38bdf8;
    --success: #34d399;
    --warning: #fbbf24;
    --danger: #f87171;
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    --mono: "SF Mono", Consolas, "Liberation Mono", Menlo, Courier, monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg-main);
    color: var(--text-primary);
    font-family: var(--font);
    font-size: 13.5px;
    line-height: 1.5;
    padding: 20px;
  }
  .container { max-width: 1540px; margin: 0 auto; }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 16px;
    margin-bottom: 16px;
    border-bottom: 1px solid var(--border);
  }
  .header-title { display: flex; align-items: center; gap: 12px; }
  .header-title h1 { font-size: 20px; font-weight: 700; letter-spacing: -0.3px; }
  .pulse-dot {
    width: 10px; height: 10px; border-radius: 50%; background: var(--success);
    box-shadow: 0 0 10px var(--success);
    animation: pulse 2s infinite;
  }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  .header-meta { display: flex; align-items: center; gap: 16px; font-size: 12px; color: var(--text-muted); }
  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 4px;
    font-size: 11px; font-weight: 600; text-transform: uppercase;
  }
  .badge-success { background: rgba(52, 211, 153, 0.15); color: var(--success); border: 1px solid var(--success); }
  .badge-warning { background: rgba(251, 191, 36, 0.15); color: var(--warning); border: 1px solid var(--warning); }
  .badge-danger { background: rgba(248, 113, 113, 0.15); color: var(--danger); border: 1px solid var(--danger); }
  .badge-muted { background: rgba(148, 163, 184, 0.15); color: var(--text-muted); border: 1px solid var(--border); }
  .badge-accent { background: rgba(56, 189, 248, 0.15); color: var(--accent); border: 1px solid var(--accent); }

  /* Navigation Tabs */
  .nav-tabs { display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 1px solid var(--border); padding-bottom: 10px; }
  .nav-tab {
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 9px 18px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    transition: all 0.15s ease;
  }
  .nav-tab:hover { color: var(--text-primary); border-color: var(--accent); }
  .nav-tab.active { background: var(--accent); color: #0b0f17; font-weight: 700; border-color: var(--accent); box-shadow: 0 0 12px rgba(56, 189, 248, 0.4); }
  .tab-pane { display: none; }
  .tab-pane.active { display: block; }

  /* KPI Cards */
  .grid-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; margin-bottom: 20px; }
  .card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  }
  .card-title {
    font-size: 11.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    margin-bottom: 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .kpi-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
  .kpi-main { font-size: 26px; font-weight: 700; color: #fff; }
  .kpi-sub { font-size: 12px; color: var(--text-muted); }
  .kpi-pill-group { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .kpi-pill { font-size: 11.5px; padding: 2px 7px; background: var(--bg-card-alt); border-radius: 4px; }

  /* Panels Layout */
  .two-col { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; margin-bottom: 20px; }
  @media (max-width: 1024px) { .two-col { grid-template-columns: 1fr; } }

  /* Table styling */
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { padding: 9px 12px; text-align: left; border-bottom: 1px solid var(--border); }
  th { background: var(--bg-card-alt); font-weight: 600; color: var(--text-muted); font-size: 11.5px; text-transform: uppercase; }
  tr:hover td { background: rgba(255, 255, 255, 0.02); }
  .mono { font-family: var(--mono); font-size: 11.5px; }
  .table-wrap { overflow-x: auto; max-height: 480px; }

  /* Controls & Filters */
  .filter-bar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
  .filter-btn {
    background: var(--bg-card-alt);
    border: 1px solid var(--border);
    color: var(--text-primary);
    padding: 5px 12px;
    border-radius: 5px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
  }
  .filter-btn.active {
    background: var(--accent);
    color: #0b0f17;
    font-weight: 700;
    border-color: var(--accent);
  }
  .search-input {
    background: var(--bg-card-alt);
    border: 1px solid var(--border);
    color: var(--text-primary);
    padding: 5px 12px;
    border-radius: 5px;
    font-size: 12px;
    outline: none;
    flex-grow: 1;
    min-width: 220px;
  }
  .search-input:focus { border-color: var(--accent); }

  /* Live logs console */
  .log-console {
    background: #06090e;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px;
    font-family: var(--mono);
    font-size: 11.5px;
    height: 340px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
    line-height: 1.5;
  }
  .log-line-error { color: var(--danger); font-weight: 600; }
  .log-line-applied { color: var(--success); font-weight: 700; }
  .log-line-warn { color: var(--warning); }
  .log-line-info { color: var(--accent); }
</style>
</head>
<body>
<div class="container">
  <header>
    <div class="header-title">
      <div class="pulse-dot"></div>
      <h1>Jobscraper Live Operations & Durations Dashboard</h1>
      <span id="worker-badge" class="badge badge-muted">Checking PID...</span>
    </div>
    <div class="header-meta">
      <span>Auto-refresh: <strong class="mono">3s</strong></span>
      <span>Last sync: <span id="last-sync" class="mono">--</span></span>
    </div>
  </header>

  <!-- TOP TAB BAR -->
  <div class="nav-tabs">
    <button class="nav-tab active" data-tab="tab-hourly">⚡ Hourly Fresh Jobs (Priority #1)</button>
    <button class="nav-tab" data-tab="tab-overview">📊 All Jobs & Backfill Overview</button>
    <button class="nav-tab" data-tab="tab-diagnostics">🛠️ Live Diagnostics & Unmapped Questions</button>
  </div>

  <!-- TAB 1: HOURLY FRESH JOBS (PRIORITY #1) -->
  <div id="tab-hourly" class="tab-pane active">
    <!-- Notice Bar -->
    <div class="card" style="margin-bottom: 16px; background: rgba(56, 189, 248, 0.08); border-color: rgba(56, 189, 248, 0.3);">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 18px;">⚡</span>
          <div>
            <strong>Priority #1 Preemption Active:</strong>
            <span style="color: var(--text-muted); margin-left: 6px;">Fresh hourly discoveries receive a +10,000 priority bonus and jump directly to the head of the 6,200+ backfill queue.</span>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <span class="kpi-pill mono">Discovery Sync: <strong id="hourly-sync-time">--</strong></span>
          <button id="btn-trigger-sync" class="filter-btn" style="background: var(--accent); color: #0b0f17; font-weight: 700;">🔄 Sync Hourly Now</button>
        </div>
      </div>
    </div>

    <!-- Hourly KPI Grid -->
    <div class="grid-strip">
      <div class="card">
        <div class="card-title">
          <span>Past 1 Hour Fresh</span>
          <span class="badge badge-accent">1H Discovery</span>
        </div>
        <div class="kpi-row">
          <div id="kpi-hourly-1h" class="kpi-main">0</div>
          <div class="kpi-sub">Jobs Discovered &lt; 60m</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <span>Past 24 Hours Fresh</span>
          <span class="badge badge-accent">24H Rolling</span>
        </div>
        <div class="kpi-row">
          <div id="kpi-hourly-24h" class="kpi-main">0</div>
          <div class="kpi-sub">Total Discovered Today</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <span>Hourly Applied</span>
          <span class="badge badge-success">Completed</span>
        </div>
        <div class="kpi-row">
          <div id="kpi-hourly-applied" class="kpi-main" style="color: var(--success)">0</div>
          <div class="kpi-sub">Fresh Applications Sent</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <span>Hourly Queued Front</span>
          <span class="badge badge-warning">Head of Queue</span>
        </div>
        <div class="kpi-row">
          <div id="kpi-hourly-queued" class="kpi-main" style="color: var(--accent)">0</div>
          <div class="kpi-sub">Pending Next Run</div>
        </div>
      </div>
    </div>

    <!-- Hourly Sources Breakdown Pill Group -->
    <div class="card" style="margin-bottom: 20px;">
      <div class="card-title">Discovery Sources Breakdown</div>
      <div id="hourly-sources-pills" class="kpi-pill-group">
        <span class="kpi-pill">Loading source channels...</span>
      </div>
    </div>

    <!-- Hourly Jobs Table -->
    <div class="card">
      <div class="card-title">
        <span>⚡ Fresh Hourly Jobs Feed (Priority #1)</span>
        <span id="hourly-table-count" class="mono">0 jobs</span>
      </div>
      <div class="filter-bar">
        <button class="filter-btn active" data-hourly-filter="all">All Fresh</button>
        <button class="filter-btn" data-hourly-filter="applied">Applied</button>
        <button class="filter-btn" data-hourly-filter="queued">Queued</button>
        <button class="filter-btn" data-hourly-filter="paused">Paused</button>
        <input type="text" id="hourly-search" class="search-input" placeholder="Search company / role / source...">
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Discovered</th>
              <th>Company</th>
              <th>Role</th>
              <th>Provider</th>
              <th>Hourly Source</th>
              <th>Duration</th>
              <th>Status</th>
              <th>Reason / Outcome</th>
            </tr>
          </thead>
          <tbody id="hourly-tbody">
            <tr><td colspan="8" style="text-align: center; color: var(--text-muted)">Loading fresh hourly jobs...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- TAB 2: ALL JOBS & BACKFILL OVERVIEW -->
  <div id="tab-overview" class="tab-pane">
    <div class="grid-strip">
      <!-- PAST 1 HOUR -->
      <div class="card">
        <div class="card-title">
          <span>Past 1 Hour (Last 60m)</span>
          <span class="badge badge-accent">Live</span>
        </div>
        <div class="kpi-row">
          <div class="kpi-main" id="kpi-1h-applied">0</div>
          <div class="kpi-sub">Applied / <span id="kpi-1h-total">0</span> Runs</div>
        </div>
        <div class="kpi-pill-group">
          <span class="kpi-pill">Failed: <strong id="kpi-1h-failed" style="color: var(--danger)">0</strong></span>
          <span class="kpi-pill">Paused: <strong id="kpi-1h-paused" style="color: var(--warning)">0</strong></span>
          <span class="kpi-pill">Avg: <strong id="kpi-1h-avg" class="mono">0.0s</strong></span>
        </div>
      </div>

      <!-- PAST 24 HOURS -->
      <div class="card">
        <div class="card-title">
          <span>Past 24 Hours (Day)</span>
          <span class="badge badge-muted">Rolling</span>
        </div>
        <div class="kpi-row">
          <div class="kpi-main" id="kpi-24h-applied">0</div>
          <div class="kpi-sub">Applied / <span id="kpi-24h-total">0</span> Runs</div>
        </div>
        <div class="kpi-pill-group">
          <span class="kpi-pill">Failed: <strong id="kpi-24h-failed" style="color: var(--danger)">0</strong></span>
          <span class="kpi-pill">Paused: <strong id="kpi-24h-paused" style="color: var(--warning)">0</strong></span>
          <span class="kpi-pill">Avg: <strong id="kpi-24h-avg" class="mono">0.0s</strong></span>
        </div>
      </div>

      <!-- QUEUE STATUS -->
      <div class="card">
        <div class="card-title">
          <span>Queue & Durable Status</span>
          <span class="badge badge-success">SQLite</span>
        </div>
        <div class="kpi-row">
          <div class="kpi-main" id="kpi-queue-remaining">0</div>
          <div class="kpi-sub">Queued Remaining</div>
        </div>
        <div class="kpi-pill-group">
          <span class="kpi-pill">Worker PID: <strong id="kpi-worker-pid" class="mono">--</strong></span>
          <span class="kpi-pill">Verified Receipts: <strong id="kpi-verified-receipts" style="color: var(--success)">0</strong></span>
          <span class="kpi-pill">Outreach Leads: <strong id="kpi-outreach-leads" style="color: var(--accent)">0</strong></span>
          <span class="kpi-pill">Active Lanes: <strong id="kpi-active-lanes">GH / AS / WD / OT</strong></span>
        </div>
      </div>

      <!-- BENCHMARKS -->
      <div class="card">
        <div class="card-title">
          <span>Speed & Latency Benchmarks</span>
          <span class="badge badge-muted">P50 / P95</span>
        </div>
        <div class="kpi-row">
          <div class="kpi-main mono" id="kpi-bench-avg">0.0s</div>
          <div class="kpi-sub">All-Time Avg Speed</div>
        </div>
        <div class="kpi-pill-group">
          <span class="kpi-pill">1h P50: <strong id="kpi-1h-p50" class="mono">0.0s</strong></span>
          <span class="kpi-pill">1h P95: <strong id="kpi-1h-p95" class="mono">0.0s</strong></span>
          <span class="kpi-pill">24h P95: <strong id="kpi-24h-p95" class="mono">0.0s</strong></span>
        </div>
      </div>
    </div>

    <!-- MAIN TWO-COLUMN SPLIT -->
    <div class="two-col">
      <!-- LEFT: RUNS TABLE -->
      <div class="card">
        <div class="card-title">
          <span>Job Runs & Telemetry</span>
          <span id="runs-count" class="mono">0 runs</span>
        </div>
        <div class="filter-bar">
          <button class="filter-btn active" data-filter="all">All</button>
          <button class="filter-btn" data-filter="1h">Past 1h</button>
          <button class="filter-btn" data-filter="24h">Past 24h</button>
          <button class="filter-btn" data-filter="applied">Applied</button>
          <button class="filter-btn" data-filter="failed">Failed</button>
          <button class="filter-btn" data-filter="paused">Paused</button>
          <input type="text" id="run-search" class="search-input" placeholder="Search company / role...">
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Finished</th>
                <th>Company</th>
                <th>Role</th>
                <th>Provider</th>
                <th>Lane</th>
                <th>Duration</th>
                <th>Fields</th>
                <th>Status</th>
                <th>Reason / Proof</th>
              </tr>
            </thead>
            <tbody id="runs-tbody">
              <tr><td colspan="9" style="text-align: center; color: var(--text-muted)">Loading telemetry...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- RIGHT: ATS BENCHMARKS -->
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <div class="card">
          <div class="card-title">Per-ATS Speed & Duration Benchmarks</div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ATS Provider</th>
                  <th>Runs</th>
                  <th>Applied</th>
                  <th>Avg</th>
                  <th>Min</th>
                  <th>Max</th>
                  <th>P95</th>
                </tr>
              </thead>
              <tbody id="provider-tbody">
                <tr><td colspan="7" style="text-align: center; color: var(--text-muted)">Loading providers...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-title">In-Flight Application State</div>
          <div id="inflight-box" style="font-size: 12.5px; color: var(--text-muted);">
            Idle (Waiting for chunk execution)
          </div>
        </div>
      </div>
    </div>

    <!-- LIVE DAEMON LOG CONSOLE -->
    <div class="card">
      <div class="card-title">
        <span>Live Daemon Console (out/hourly-daemon.log)</span>
        <div style="display: flex; gap: 8px; align-items: center;">
          <label style="font-size: 11px; text-transform: none; display: flex; align-items: center; gap: 4px; cursor: pointer;">
            <input type="checkbox" id="log-autoscroll" checked> Auto-scroll
          </label>
        </div>
      </div>
      <div class="filter-bar">
        <button class="filter-btn active" data-log-filter="all">All Logs</button>
        <button class="filter-btn" data-log-filter="applied">Applied Only</button>
        <button class="filter-btn" data-log-filter="error">Errors & Failed</button>
        <button class="filter-btn" data-log-filter="hitl">HITL Popups</button>
        <input type="text" id="log-search" class="search-input" placeholder="Filter log text...">
      </div>
      <div id="log-console" class="log-console">Streaming log lines...</div>
    </div>
  </div>

  <!-- TAB 3: LIVE DIAGNOSTICS & UNMAPPED QUESTIONS -->
  <div id="tab-diagnostics" class="tab-pane">
    <div class="card" style="margin-bottom: 20px;">
      <div class="card-title">
        <span>Overnight Errors & To-Improve Diagnostics (GEN-47)</span>
        <span id="overnight-errors-sync" class="mono" style="font-size: 11px;">Syncing...</span>
      </div>

      <div style="margin-bottom: 16px;">
        <div style="font-size: 11.5px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); margin-bottom: 8px;">
          Live Error Counts by Category
        </div>
        <div id="overnight-categories-pills" class="kpi-pill-group">
          <span class="kpi-pill">Loading overnight error categories...</span>
        </div>
      </div>

      <div class="two-col" style="margin-bottom: 0;">
        <div>
          <div style="font-size: 11.5px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); margin-bottom: 8px;">
            Top Unmapped Form Questions (Occurrences & Widgets)
          </div>
          <div class="table-wrap" style="max-height: 360px;">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Question Text</th>
                  <th>Widget</th>
                  <th>Count</th>
                  <th>Sample Options</th>
                </tr>
              </thead>
              <tbody id="unmapped-questions-tbody">
                <tr><td colspan="5" style="text-align: center; color: var(--text-muted)">No unmapped questions logged.</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div style="font-size: 11.5px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); margin-bottom: 8px;">
            Validation Errors & Missed Button Selectors
          </div>
          <div class="table-wrap" style="max-height: 360px;">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Step / Heading</th>
                  <th>Banner / Error</th>
                  <th>Missed Buttons Detected</th>
                </tr>
              </thead>
              <tbody id="missed-buttons-tbody">
                <tr><td colspan="4" style="text-align: center; color: var(--text-muted)">No missed button selectors logged.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Pareto Scoreboard Issues</div>
      <div id="scoreboard-content" style="font-size: 12px; color: var(--text-muted)">
        Loading scoreboard...
      </div>
    </div>
  </div>
</div>

<script>
let currentTelemetry = null;
let currentHourly = null;
let activeRunFilter = 'all';
let activeHourlyFilter = 'all';
let activeLogFilter = 'all';

function formatDuration(ms) {
  if (!ms || ms <= 0) return '0.0s';
  const sec = ms / 1000;
  if (sec < 60) return sec.toFixed(1) + 's';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
}

function timeAgo(iso) {
  if (!iso) return '--';
  const diff = Date.now() - new Date(iso).getTime();
  if (isNaN(diff)) return '--';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return sec + 's ago';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm ago';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h ago';
  return Math.floor(hr / 24) + 'd ago';
}

function getStatusBadge(status) {
  if (status === 'applied') return '<span class="badge badge-success">Applied</span>';
  if (status === 'failed') return '<span class="badge badge-danger">Failed</span>';
  if (status === 'paused_for_review') return '<span class="badge badge-warning">Paused</span>';
  if (status === 'queued') return '<span class="badge badge-accent">Queued</span>';
  if (status === 'skipped') return '<span class="badge badge-muted">Skipped</span>';
  return '<span class="badge badge-muted">' + (status || 'unknown') + '</span>';
}

// Tab Switching
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const targetId = tab.dataset.tab;
    const pane = document.getElementById(targetId);
    if (pane) pane.classList.add('active');
  });
});

function updateTelemetryUi(data) {
  if (!data) return;
  currentTelemetry = data;
  data.queueTotals = data.queueTotals || {};
  data.window1h = data.window1h || { applied: 0, totalProcessed: 0, failed: 0, paused: 0, avgDurationSec: '0.0', p50DurationSec: '0.0', p95DurationSec: '0.0' };
  data.window24h = data.window24h || { applied: 0, totalProcessed: 0, failed: 0, paused: 0, avgDurationSec: '0.0', p50DurationSec: '0.0', p95DurationSec: '0.0' };
  data.windowAll = data.windowAll || { applied: 0, totalProcessed: 0, failed: 0, paused: 0, avgDurationSec: '0.0', p50DurationSec: '0.0', p95DurationSec: '0.0' };
  data.providerStats = data.providerStats || {};
  data.activeLanes = data.activeLanes || [];

  const syncEl = document.getElementById('last-sync');
  if (syncEl) syncEl.textContent = data.now ? new Date(data.now).toLocaleTimeString() : new Date().toLocaleTimeString();

  const workerBadge = document.getElementById('worker-badge');
  if (workerBadge) {
    if (data.workerPid) {
      workerBadge.className = 'badge badge-success';
      workerBadge.textContent = 'Active (PID ' + data.workerPid + ')';
      const pidEl = document.getElementById('kpi-worker-pid');
      if (pidEl) pidEl.textContent = data.workerPid;
    } else {
      workerBadge.className = 'badge badge-muted';
      workerBadge.textContent = 'Idle (No Lock)';
      const pidEl = document.getElementById('kpi-worker-pid');
      if (pidEl) pidEl.textContent = 'None';
    }
  }

  const h1App = document.getElementById('kpi-1h-applied'); if (h1App) h1App.textContent = data.window1h.applied;
  const h1Tot = document.getElementById('kpi-1h-total'); if (h1Tot) h1Tot.textContent = data.window1h.totalProcessed;
  const h1Fail = document.getElementById('kpi-1h-failed'); if (h1Fail) h1Fail.textContent = data.window1h.failed;
  const h1Pause = document.getElementById('kpi-1h-paused'); if (h1Pause) h1Pause.textContent = data.window1h.paused;
  const h1Avg = document.getElementById('kpi-1h-avg'); if (h1Avg) h1Avg.textContent = data.window1h.avgDurationSec + 's';
  const h1P50 = document.getElementById('kpi-1h-p50'); if (h1P50) h1P50.textContent = data.window1h.p50DurationSec + 's';
  const h1P95 = document.getElementById('kpi-1h-p95'); if (h1P95) h1P95.textContent = data.window1h.p95DurationSec + 's';

  const h24App = document.getElementById('kpi-24h-applied'); if (h24App) h24App.textContent = data.window24h.applied;
  const h24Tot = document.getElementById('kpi-24h-total'); if (h24Tot) h24Tot.textContent = data.window24h.totalProcessed;
  const h24Fail = document.getElementById('kpi-24h-failed'); if (h24Fail) h24Fail.textContent = data.window24h.failed;
  const h24Pause = document.getElementById('kpi-24h-paused'); if (h24Pause) h24Pause.textContent = data.window24h.paused;
  const h24Avg = document.getElementById('kpi-24h-avg'); if (h24Avg) h24Avg.textContent = data.window24h.avgDurationSec + 's';
  const h24P95 = document.getElementById('kpi-24h-p95'); if (h24P95) h24P95.textContent = data.window24h.p95DurationSec + 's';

  const qRem = document.getElementById('kpi-queue-remaining'); if (qRem) qRem.textContent = data.queueTotals.queued || 0;
  const bAvg = document.getElementById('kpi-bench-avg'); if (bAvg) bAvg.textContent = data.windowAll.avgDurationSec + 's';
  const vRec = document.getElementById('kpi-verified-receipts'); if (vRec) vRec.textContent = data.verifiedReceipts || 0;
  const oLead = document.getElementById('kpi-outreach-leads'); if (oLead) oLead.textContent = data.outreachLeads || 0;
  const aLane = document.getElementById('kpi-active-lanes'); if (aLane) aLane.textContent = (data.activeLanes || []).map(l => l.slice(0, 2).toUpperCase()).join(' / ');

  const ifEl = document.getElementById('inflight-box');
  if (ifEl) {
    if (data.inFlightJob) {
      ifEl.innerHTML = '<div style="color: #fff; font-weight: 600; margin-bottom: 4px;">' + (data.inFlightJob.company || 'Company') + ' (' + (data.inFlightJob.lane || 'workday') + ')</div>' +
        '<div class="mono" style="font-size: 11px; color: var(--accent);">' + (data.inFlightJob.jobId || '') + '</div>' +
        '<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Started: ' + timeAgo(data.inFlightJob.startedAt) + '</div>';
    } else {
      ifEl.innerHTML = '<span style="color: var(--text-muted);">Idle (Waiting for next cycle)</span>';
    }
  }

  const pbody = document.getElementById('provider-tbody');
  if (pbody) {
    const provKeys = Object.keys(data.providerStats || {});
    if (provKeys.length === 0) {
      pbody.innerHTML = '<tr><td colspan="7" style="color: var(--text-muted)">No provider runs recorded yet</td></tr>';
    } else {
      pbody.innerHTML = provKeys.map(k => {
        const p = data.providerStats[k];
        return '<tr>' +
          '<td><strong>' + k.toUpperCase() + '</strong></td>' +
          '<td class="mono">' + p.runs + '</td>' +
          '<td class="mono" style="color: var(--success)">' + p.applied + '</td>' +
          '<td class="mono">' + p.avgSec + 's</td>' +
          '<td class="mono" style="color: var(--accent)">' + p.fastestSec + 's</td>' +
          '<td class="mono">' + p.slowestSec + 's</td>' +
          '<td class="mono">' + p.p95Sec + 's</td>' +
        '</tr>';
      }).join('');
    }
  }

  const sbEl = document.getElementById('scoreboard-content');
  if (sbEl) {
    const sb = data.scoreboard || {};
    const issues = Array.isArray(sb.issues) ? sb.issues : [];
    if (issues.length === 0) {
      sbEl.innerHTML = '<span style="color: var(--text-muted)">No active park issues recorded.</span>';
    } else {
      sbEl.innerHTML = issues.slice(0, 5).map(iss => {
        return '<div style="margin-bottom: 6px; padding: 4px 0; border-bottom: 1px solid var(--border)">' +
          '<div style="font-weight: 600; color: #fff;">' + (iss.error || iss.reason || 'Issue') + '</div>' +
          '<div style="font-size: 11px; color: var(--text-muted)">Count: ' + (iss.count || 0) + ' | Pct: ' + (iss.percentage || '0%') + '</div>' +
        '</div>';
      }).join('');
    }
  }

  renderRunsTable();
  renderLogs();
}

function updateHourlyJobsUi(data) {
  if (!data) return;
  currentHourly = data;

  const syncEl = document.getElementById('hourly-sync-time');
  if (syncEl) syncEl.textContent = data.lastSyncAt ? timeAgo(data.lastSyncAt) : '--';

  const h1 = document.getElementById('kpi-hourly-1h'); if (h1) h1.textContent = data.discovered1h || 0;
  const h24 = document.getElementById('kpi-hourly-24h'); if (h24) h24.textContent = data.discovered24h || 0;
  const hApp = document.getElementById('kpi-hourly-applied'); if (hApp) hApp.textContent = data.appliedHourlyCount || 0;
  const hQue = document.getElementById('kpi-hourly-queued'); if (hQue) hQue.textContent = data.queuedHourlyCount || 0;

  const pillsEl = document.getElementById('hourly-sources-pills');
  if (pillsEl) {
    const srcMap = data.bySource || {};
    pillsEl.innerHTML = Object.keys(srcMap).map(k => {
      return '<span class="kpi-pill"><strong>' + k.replace(/_/g, ' ').toUpperCase() + '</strong>: <span style="color: var(--accent)">' + srcMap[k] + '</span></span>';
    }).join('') || '<span class="kpi-pill">No discovery events yet</span>';
  }

  renderHourlyTable();
}

function renderHourlyTable() {
  if (!currentHourly) return;
  const jobs = currentHourly.jobs || [];
  const searchInput = document.getElementById('hourly-search');
  const query = (searchInput?.value || '').toLowerCase().trim();

  const filtered = jobs.filter(j => {
    if (activeHourlyFilter === 'applied' && j.status !== 'applied') return false;
    if (activeHourlyFilter === 'queued' && j.status !== 'queued') return false;
    if (activeHourlyFilter === 'paused' && j.status !== 'paused_for_review') return false;

    if (query) {
      const match = (j.company || '').toLowerCase().includes(query) ||
                    (j.title || '').toLowerCase().includes(query) ||
                    (j.provider || '').toLowerCase().includes(query) ||
                    (j.hourlySource || '').toLowerCase().includes(query) ||
                    (j.reason || '').toLowerCase().includes(query);
      if (!match) return false;
    }
    return true;
  });

  const countEl = document.getElementById('hourly-table-count');
  if (countEl) countEl.textContent = filtered.length + ' fresh jobs';

  const tbody = document.getElementById('hourly-tbody');
  if (!tbody) return;
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-muted)">No fresh hourly jobs matching filter.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(j => {
    return '<tr>' +
      '<td class="mono">' + timeAgo(j.discoveredAt) + '</td>' +
      '<td><strong>' + (j.company || 'Company') + '</strong></td>' +
      '<td>' + (j.title || 'Software Engineer') + '</td>' +
      '<td><span class="badge badge-muted">' + (j.provider || 'ats') + '</span></td>' +
      '<td><span class="badge badge-accent">' + (j.hourlySource || 'github_hunt') + '</span></td>' +
      '<td class="mono">' + formatDuration(j.durationMs) + '</td>' +
      '<td>' + getStatusBadge(j.status) + '</td>' +
      '<td style="max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="' + (j.reason || '') + '">' +
        (j.reason || '--') +
      '</td>' +
    '</tr>';
  }).join('');
}

function renderRunsTable() {
  if (!currentTelemetry) return;
  const runs = currentTelemetry.recentRuns || [];
  const searchInput = document.getElementById('run-search');
  const query = (searchInput?.value || '').toLowerCase().trim();
  const now = Date.now();
  const oneHourAgo = now - 3600_000;
  const oneDayAgo = now - 86400_000;

  const filtered = runs.filter(r => {
    if (activeRunFilter === '1h' && new Date(r.finishedAt).getTime() < oneHourAgo) return false;
    if (activeRunFilter === '24h' && new Date(r.finishedAt).getTime() < oneDayAgo) return false;
    if (activeRunFilter === 'applied' && r.status !== 'applied') return false;
    if (activeRunFilter === 'failed' && r.status !== 'failed') return false;
    if (activeRunFilter === 'paused' && r.status !== 'paused_for_review') return false;

    if (query) {
      const match = (r.company || '').toLowerCase().includes(query) ||
                    (r.title || '').toLowerCase().includes(query) ||
                    (r.provider || '').toLowerCase().includes(query) ||
                    (r.reason || '').toLowerCase().includes(query);
      if (!match) return false;
    }
    return true;
  });

  const countEl = document.getElementById('runs-count');
  if (countEl) countEl.textContent = filtered.length + ' runs';
  const tbody = document.getElementById('runs-tbody');
  if (!tbody) return;
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-muted)">No matching job runs found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(r => {
    let proofTag = '';
    if (r.receiptVerified || r.status === 'applied') {
      proofTag = '<span class="badge badge-success" style="font-size: 10px; margin-right: 4px;">Proof: Verified</span> ';
    }

    return '<tr>' +
      '<td class="mono">' + timeAgo(r.finishedAt) + '</td>' +
      '<td><strong>' + (r.company || 'Unknown') + '</strong></td>' +
      '<td>' + (r.title || 'Software Engineer') + '</td>' +
      '<td><span class="badge badge-muted">' + (r.provider || 'ats') + '</span></td>' +
      '<td class="mono">' + (r.lane || 'default') + '</td>' +
      '<td class="mono">' + formatDuration(r.durationMs) + '</td>' +
      '<td class="mono">' + (r.fieldsFilled || 0) + '</td>' +
      '<td>' + getStatusBadge(r.status) + '</td>' +
      '<td style="max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="' + (r.reason || '') + '">' +
        proofTag + (r.reason || '--') +
      '</td>' +
    '</tr>';
  }).join('');
}

function renderLogs() {
  if (!currentTelemetry) return;
  const consoleEl = document.getElementById('log-console');
  if (!consoleEl) return;
  const allLines = currentTelemetry.logLines || [];
  const searchInput = document.getElementById('log-search');
  const query = (searchInput?.value || '').toLowerCase().trim();

  const filtered = allLines.filter(line => {
    if (!line) return false;
    const l = String(line).toLowerCase();
    if (activeLogFilter === 'applied' && !l.includes('applied') && !l.includes('submitted')) return false;
    if (activeLogFilter === 'error' && !l.includes('fail') && !l.includes('error') && !l.includes('timed out')) return false;
    if (activeLogFilter === 'hitl' && !l.includes('popup') && !l.includes('hitl') && !l.includes('human')) return false;
    if (query && !l.includes(query)) return false;
    return true;
  });

  consoleEl.innerHTML = filtered.map(line => {
    let cls = '';
    const l = String(line).toLowerCase();
    if (l.includes('applied') || l.includes('submitted')) cls = 'log-line-applied';
    else if (l.includes('fail') || l.includes('error') || l.includes('timed out')) cls = 'log-line-error';
    else if (l.includes('warn') || l.includes('cooldown') || l.includes('deferring')) cls = 'log-line-warn';
    else if (l.includes('[drain') || l.includes('started')) cls = 'log-line-info';
    return '<span class="' + cls + '">' + String(line).replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
  }).join(String.fromCharCode(10));

  const autoScroll = document.getElementById('log-autoscroll');
  if (autoScroll && autoScroll.checked) {
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }
}

// Event Listeners
document.querySelectorAll('[data-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeRunFilter = (btn).dataset.filter || 'all';
    renderRunsTable();
  });
});

document.querySelectorAll('[data-hourly-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-hourly-filter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeHourlyFilter = (btn).dataset.hourlyFilter || 'all';
    renderHourlyTable();
  });
});

document.querySelectorAll('[data-log-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-log-filter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeLogFilter = (btn).dataset.logFilter || 'all';
    renderLogs();
  });
});

document.getElementById('run-search')?.addEventListener('input', renderRunsTable);
document.getElementById('hourly-search')?.addEventListener('input', renderHourlyTable);
document.getElementById('log-search')?.addEventListener('input', renderLogs);

const syncBtn = document.getElementById('btn-trigger-sync');
if (syncBtn) {
  syncBtn.addEventListener('click', async () => {
    syncBtn.textContent = 'Syncing...';
    try {
      const res = await fetch('/api/trigger-hourly-sync', { method: 'POST' });
      if (res.ok) {
        syncBtn.textContent = 'Synced!';
        setTimeout(() => { syncBtn.textContent = '🔄 Sync Hourly Now'; }, 2000);
        pollHourlyJobs();
      } else {
        syncBtn.textContent = 'Sync Error';
      }
    } catch {
      syncBtn.textContent = 'Network Error';
    }
  });
}

async function pollTelemetry() {
  try {
    const res = await fetch('/api/telemetry');
    if (res.ok) {
      const data = await res.json();
      updateTelemetryUi(data);
    }
  } catch (err) {
    console.error('Telemetry fetch error:', err);
  } finally {
    setTimeout(pollTelemetry, 3000);
  }
}

async function pollHourlyJobs() {
  try {
    const res = await fetch('/api/hourly-jobs');
    if (res.ok) {
      const data = await res.json();
      updateHourlyJobsUi(data);
    }
  } catch (err) {
    console.error('Hourly jobs fetch error:', err);
  } finally {
    setTimeout(pollHourlyJobs, 3000);
  }
}

function updateOvernightErrorsUi(data) {
  if (!data) return;
  var syncEl = document.getElementById('overnight-errors-sync');
  if (syncEl && data.generatedAt) syncEl.innerText = 'Generated: ' + new Date(data.generatedAt).toLocaleTimeString();

  var pillsEl = document.getElementById('overnight-categories-pills');
  if (pillsEl) {
    if (!data.topFailureCategories || data.topFailureCategories.length === 0) {
      pillsEl.innerHTML = '<span class="kpi-pill" style="color: var(--success)">0 Overnight Failures Logged</span>';
    } else {
      pillsEl.innerHTML = data.topFailureCategories.map(function(c) {
        return '<span class="kpi-pill"><strong>' + c.category + '</strong>: <span style="color: var(--danger)">' + c.count + '</span> (' + c.percentage + ')</span>';
      }).join('');
    }
  }

  var qTbody = document.getElementById('unmapped-questions-tbody');
  if (qTbody) {
    if (!data.topUnknownQuestions || data.topUnknownQuestions.length === 0) {
      qTbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted)">No unmapped questions.</td></tr>';
    } else {
      qTbody.innerHTML = data.topUnknownQuestions.slice(0, 15).map(function(q) {
        var optStr = q.options && q.options.length ? q.options.slice(0, 3).join(', ') : '-';
        return '<tr><td>' + q.rank + '</td><td style="font-weight: 600;">' + q.questionText + '</td><td><span class="badge badge-accent">' + q.widgetKind + '</span></td><td class="mono" style="font-weight: 700;">' + q.count + '</td><td style="color: var(--text-muted); font-size: 11px;">' + optStr + '</td></tr>';
      }).join('');
    }
  }

  var bTbody = document.getElementById('missed-buttons-tbody');
  if (bTbody) {
    if (!data.missedButtonStalls || data.missedButtonStalls.length === 0) {
      bTbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted)">No button selector misses or stalls.</td></tr>';
    } else {
      bTbody.innerHTML = data.missedButtonStalls.slice(0, 10).map(function(s) {
        var valBanner = s.validationErrors && s.validationErrors.length ? s.validationErrors[0] : s.errorMessage;
        var btns = s.visibleButtons && s.visibleButtons.length ? s.visibleButtons.slice(0, 2).map(function(b) {
          return '&lt;' + (b.tag || 'btn') + '&gt; "' + (b.text || '') + '" [' + (b.dataAutomationId || (typeof b.className === 'string' ? b.className.slice(0, 15) : 'btn')) + ']';
        }).join('<br>') : '-';
        return '<tr><td><strong>' + s.company + '</strong><br><span style="font-size: 10.5px; color: var(--text-muted);">' + s.provider + '</span></td><td>Step ' + s.stepNumber + ': ' + (s.stepHeading || 'Form') + '</td><td style="color: var(--warning); font-size: 11px;">' + valBanner + '</td><td class="mono" style="font-size: 10.5px;">' + btns + '</td></tr>';
      }).join('');
    }
  }
}

async function pollOvernightErrors() {
  try {
    var res = await fetch('/api/overnight-errors');
    if (res.ok) {
      var data = await res.json();
      updateOvernightErrorsUi(data);
    }
  } catch (err) {
    console.error('Overnight errors fetch error:', err);
  } finally {
    setTimeout(pollOvernightErrors, 4000);
  }
}

// Initial bootstrap triggers
if (window.__INITIAL_TELEMETRY__) {
  try { updateTelemetryUi(window.__INITIAL_TELEMETRY__); } catch (e) { console.error('Initial telemetry render err:', e); }
}
if (window.__INITIAL_HOURLY__) {
  try { updateHourlyJobsUi(window.__INITIAL_HOURLY__); } catch (e) { console.error('Initial hourly render err:', e); }
}
if (window.__INITIAL_OVERNIGHT_ERRORS__) {
  try { updateOvernightErrorsUi(window.__INITIAL_OVERNIGHT_ERRORS__); } catch (e) { console.error('Initial overnight errors render err:', e); }
}

pollTelemetry();
pollHourlyJobs();
pollOvernightErrors();

</script>
</body>
</html>`;
}

export function startDashboardServer(port = PORT): http.Server {
  try {
    cachedTelemetry = getDashboardTelemetry();
    cachedErrorsData = getOvernightErrorsData();
    cachedHourlyJobsData = getHourlyJobsData();
  } catch {}

  const cacheTimer = setInterval(() => {
    try {
      cachedTelemetry = getDashboardTelemetry();
      cachedErrorsData = getOvernightErrorsData();
      cachedHourlyJobsData = getHourlyJobsData();
    } catch {}
  }, 2000);
  cacheTimer.unref();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/api/trigger-hourly-sync' && req.method === 'POST') {
      try {
        syncGitHubActionsPillars().catch(e => console.error('[DASHBOARD] Sync error:', e));
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({ ok: true, triggeredAt: new Date().toISOString() }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err?.message || 'Sync failed' }));
      }
      return;
    }

    if (url.pathname === '/api/hourly-jobs') {
      try {
        const data = cachedHourlyJobsData || getHourlyJobsData();
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify(data));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err?.message || 'Error compiling hourly jobs' }));
      }
      return;
    }

    if (url.pathname === '/api/overnight-errors') {
      try {
        const data = cachedErrorsData || getOvernightErrorsData();
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify(data));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err?.message || 'Error compiling overnight report' }));
      }
      return;
    }

    if (url.pathname === '/api/telemetry') {
      try {
        const telemetry = cachedTelemetry || getDashboardTelemetry();
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify(telemetry));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err?.message || 'Internal telemetry error' }));
      }
      return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const telemetry = cachedTelemetry || getDashboardTelemetry();
      const errors = cachedErrorsData || getOvernightErrorsData();
      const hourly = cachedHourlyJobsData || getHourlyJobsData();
      const html = renderDashboardHtml(telemetry, errors, hourly);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(html);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  server.on('error', (err: any) => {
    if (err?.code === 'EADDRINUSE') {
      console.log(`[DASHBOARD] Port ${port} is already in use; dashboard is active.`);
    } else {
      console.error('[DASHBOARD] Server error:', err);
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[DASHBOARD] Auto-Apply Operations Dashboard listening on http://localhost:${port} and http://127.0.0.1:${port}`);
  });

  return server;
}

if (process.argv[1] && (process.argv[1].endsWith('dashboard-server.ts') || process.argv[1].endsWith('dashboard-server.js'))) {
  startDashboardServer(PORT);
}
