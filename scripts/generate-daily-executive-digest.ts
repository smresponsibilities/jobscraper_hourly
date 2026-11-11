// scripts/generate-daily-executive-digest.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readJobRunHistory, type JobRunHistoryEntry } from '../src/autoapply/run-history.js';
import { loadInboxLifecycleEvents, type InboxLifecycleEvent } from '../src/autoapply/inbox-lifecycle-tracker.js';
import { loadSentLedger, type SentLedgerState, DEFAULT_SENT_LEDGER_PATH } from './send-outreach-batch.js';
import { getDoctorStatus } from '../src/autoapply/health-and-ram-watchdog.js';
import { isDay5FollowUpEligible } from '../src/outreach/follow-up-sequencer.js';

export interface AtsConversionMetric {
  attempts: number;
  submitted: number;
  conversionRatePct: number;
}

export interface ExecutiveDigestData {
  generatedAt: string;
  totalConfirmedApplications: number;
  throughput: {
    last1Hour: number;
    last24Hours: number;
    perAtsConversion: Record<string, AtsConversionMetric>;
  };
  inboxLifecycle: {
    totalEvents: number;
    interviewsAndOas: number;
    recruiterReplies: number;
    rejections: number;
    hardBounces: number;
  };
  outreach: {
    totalLeadsReady: number;
    day5FollowUpsQueued: number;
    totalSentTouch1: number;
    totalFollowUpsSent: number;
  };
  doctorHealth: {
    active: boolean;
    droughtDetected: boolean;
    appliedLast30m: number;
    processedLast30m: number;
    lastHealTime?: string;
    healed: boolean;
  };
  markdown: string;
}

export async function generateDailyExecutiveDigest(options: {
  dbPath?: string;
  leadsPath?: string;
  ledgerPath?: string;
  outMdPath?: string;
} = {}): Promise<ExecutiveDigestData> {
  const dbPath = options.dbPath || path.resolve('state/autoapply/portal-review/queue.sqlite');
  const leadsPath = options.leadsPath || path.resolve('state/autoapply/portal-review/outreach-leads.json');
  const ledgerPath = options.ledgerPath || DEFAULT_SENT_LEDGER_PATH;
  const outMdPath = options.outMdPath || path.resolve('out/DAILY-EXECUTIVE-DIGEST.md');

  const now = Date.now();
  const oneHourAgo = now - 3600_000;
  const oneDayAgo = now - 86400_000;

  // 1. Confirmed Applications (queue.sqlite + run-history)
  let dbAppliedCount = 0;
  if (fs.existsSync(dbPath)) {
    try {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const row = db.prepare("SELECT count(1) as c FROM applications WHERE status = 'applied'").get() as any;
      dbAppliedCount = row ? Number(row.c) : 0;
      db.close();
    } catch {}
  }

  const runHistoryPath = path.resolve('state/autoapply/portal-review/run-history.jsonl');
  let historyAppliedCount = 0;
  if (fs.existsSync(runHistoryPath)) {
    try {
      const content = fs.readFileSync(runHistoryPath, 'utf8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        if (line.includes('"status":"applied"') || line.includes('"status":"submitted"')) {
          historyAppliedCount++;
        }
      }
    } catch {}
  }

  const totalConfirmedApplications = Math.max(dbAppliedCount, historyAppliedCount);

  // 2. Throughput & Per-ATS Conversion
  let last1Hour = 0;
  let last24Hours = 0;
  const atsStats: Record<string, { attempts: number; submitted: number }> = {};
  const history = readJobRunHistory();

  for (const entry of history) {
    const t = entry.finishedAt ? Date.parse(entry.finishedAt) : (entry.startedAt ? Date.parse(entry.startedAt) : 0);
    const isSubmitted = entry.status === 'applied' || (entry.status as string) === 'submitted';

    if (t >= oneHourAgo && isSubmitted) last1Hour++;
    if (t >= oneDayAgo && isSubmitted) last24Hours++;

    const ats = (entry.provider || (entry as any).ats || 'unknown').toLowerCase().trim();
    if (!atsStats[ats]) {
      atsStats[ats] = { attempts: 0, submitted: 0 };
    }
    atsStats[ats].attempts++;
    if (isSubmitted) {
      atsStats[ats].submitted++;
    }
  }

  const perAtsConversion: Record<string, AtsConversionMetric> = {};
  for (const [ats, stat] of Object.entries(atsStats)) {
    perAtsConversion[ats] = {
      attempts: stat.attempts,
      submitted: stat.submitted,
      conversionRatePct: stat.attempts > 0 ? Math.round((stat.submitted / stat.attempts) * 1000) / 10 : 0,
    };
  }

  // 3. Inbox Lifecycle Events (GEN-455)
  const lifecycleEvents: InboxLifecycleEvent[] = loadInboxLifecycleEvents();
  const interviewsAndOas = lifecycleEvents.filter(e => e.stage === 'INTERVIEW_OR_OA_INVITE').length;
  const recruiterReplies = lifecycleEvents.filter(e => e.stage === 'RECRUITER_DIRECT_REPLY').length;
  const rejections = lifecycleEvents.filter(e => e.stage === 'APPLICATION_REJECTED').length;
  const hardBounces = lifecycleEvents.filter(e => e.stage === 'HARD_BOUNCE_550').length;

  // 4. Outreach Pipeline & Day-5 Follow-Ups (GEN-463 & GEN-464)
  let totalLeadsReady = 0;
  if (fs.existsSync(leadsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(leadsPath, 'utf8'));
      if (Array.isArray(parsed)) totalLeadsReady = parsed.length;
    } catch {}
  }

  const ledger: SentLedgerState = loadSentLedger(ledgerPath);
  let totalSentTouch1 = 0;
  let totalFollowUpsSent = 0;
  let day5FollowUpsQueued = 0;

  for (const r of ledger.records) {
    if (r.isFollowUp) {
      totalFollowUpsSent++;
    } else {
      totalSentTouch1++;
      const check = isDay5FollowUpEligible(r, lifecycleEvents, now);
      if (check.eligible) {
        day5FollowUpsQueued++;
      }
    }
  }

  // 5. Doctor Self-Heal Status (GEN-451)
  const doctorStatus = getDoctorStatus();
  const doctorHealth = {
    active: doctorStatus !== null,
    droughtDetected: Boolean(doctorStatus && doctorStatus.appliedLast30m === 0 && doctorStatus.processedLast30m > 0),
    appliedLast30m: doctorStatus?.appliedLast30m ?? 0,
    processedLast30m: doctorStatus?.processedLast30m ?? 0,
    lastHealTime: doctorStatus?.timestamp,
    healed: doctorStatus?.healed ?? false,
  };

  // Build Markdown Digest
  const generatedAt = new Date().toISOString();
  const lines: string[] = [
    `# Daily Executive Digest — Antigravity Continuous Auto-Apply`,
    `Generated at: **${generatedAt}**\n`,
    `## 1. Executive Summary & Core Milestones`,
    `- **Total Confirmed Applications**: **${totalConfirmedApplications}** (Target: 243+ verified submissions)`,
    `- **Past 1 Hour Throughput**: **${last1Hour}** successful submissions`,
    `- **Past 24 Hours Throughput**: **${last24Hours}** successful submissions`,
    `- **Live Lead Outreach Pool**: **${totalLeadsReady}** verified tech leads ready (Target: 301+)`,
    `- **Day-5 Follow-Ups Queued**: **${day5FollowUpsQueued}** second-touch candidates with new proof\n`,
    `## 2. Inbound Lifecycle & Candidate Traction (GEN-455)`,
    `- **Interviews / Online Assessments (OAs)**: **${interviewsAndOas}**`,
    `- **Recruiter Direct Replies**: **${recruiterReplies}**`,
    `- **Rejections Tracked & Suppressed**: **${rejections}**`,
    `- **Hard Bounces Suppressed**: **${hardBounces}**`,
    `- **Total Inbound Lifecycle Events**: **${lifecycleEvents.length}**\n`,
    `## 3. Per-ATS Conversion Rate & Pipeline Performance`,
    `| ATS Provider | Total Attempts | Confirmed Submitted | Conversion Rate |`,
    `| :--- | :--- | :--- | :--- |`,
  ];

  const sortedAts = Object.entries(perAtsConversion).sort((a, b) => b[1].submitted - a[1].submitted);
  if (sortedAts.length === 0) {
    lines.push(`| N/A | 0 | 0 | 0% |`);
  } else {
    for (const [ats, stat] of sortedAts) {
      lines.push(`| **${ats}** | ${stat.attempts} | ${stat.submitted} | **${stat.conversionRatePct}%** |`);
    }
  }

  lines.push('');
  lines.push(`## 4. Cold Outreach & Day-5 Second-Touch Engine (GEN-463 & GEN-464)`);
  lines.push(`- **Touch #1 Emails Sent**: **${totalSentTouch1}**`);
  lines.push(`- **Day-5 Follow-Ups Sent**: **${totalFollowUpsSent}**`);
  lines.push(`- **Pending Day-5 Follow-Up Queue**: **${day5FollowUpsQueued}** eligible for dispatch`);
  lines.push(`- **Available Curated Leads**: **${totalLeadsReady}**\n`);

  lines.push(`## 5. Doctor 30-Minute Self-Heal Status (GEN-451)`);
  lines.push(`- **Doctor Active**: ${doctorHealth.active ? 'YES' : 'STANDBY'}`);
  lines.push(`- **Zero-Fill Drought Detected**: ${doctorHealth.droughtDetected ? 'YES (Triggered Auto-Heal)' : 'NO (Normal Operation)'}`);
  lines.push(`- **Applied (Last 30m)**: ${doctorHealth.appliedLast30m}`);
  lines.push(`- **Processed (Last 30m)**: ${doctorHealth.processedLast30m}`);
  if (doctorHealth.lastHealTime) {
    lines.push(`- **Last Auto-Heal Event**: ${doctorHealth.lastHealTime} (Status: ${doctorHealth.healed ? 'Success' : 'In Flight'})`);
  }
  lines.push('');

  const markdown = lines.join('\n');

  try {
    fs.mkdirSync(path.dirname(outMdPath), { recursive: true });
    fs.writeFileSync(outMdPath, markdown, 'utf8');
  } catch (err) {
    console.warn('[EXECUTIVE_DIGEST] Could not write markdown file:', err);
  }

  return {
    generatedAt,
    totalConfirmedApplications,
    throughput: {
      last1Hour,
      last24Hours,
      perAtsConversion,
    },
    inboxLifecycle: {
      totalEvents: lifecycleEvents.length,
      interviewsAndOas,
      recruiterReplies,
      rejections,
      hardBounces,
    },
    outreach: {
      totalLeadsReady,
      day5FollowUpsQueued,
      totalSentTouch1,
      totalFollowUpsSent,
    },
    doctorHealth,
    markdown,
  };
}

async function main(): Promise<void> {
  const digest = await generateDailyExecutiveDigest();
  console.log(digest.markdown);
}

if (process.argv[1] && (process.argv[1].endsWith('generate-daily-executive-digest.ts') || process.argv[1].endsWith('generate-daily-executive-digest.js'))) {
  main().catch(console.error);
}
