// src/autoapply/park-telemetry.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface ParkIssueBucket {
  reasonCategory: string;
  count: number;
  percentageOfParked: string;
  sampleCompanies: string[];
  sampleQuestionsOrErrors: string[];
  autoFixRecommendation: string;
}

const SCOREBOARD_PATH = path.resolve('state/autoapply/portal-review/park-issues-scoreboard.json');

export function generateParkIssuesScoreboard(
  sqlitePath = 'state/autoapply/portal-review/queue.sqlite'
): { generatedAt: string; statusTotals: Record<string, number>; paretoIssues: ParkIssueBucket[] } {
  if (!fs.existsSync(sqlitePath)) {
    return { generatedAt: new Date().toISOString(), statusTotals: {}, paretoIssues: [] };
  }

  const db = new DatabaseSync(sqlitePath);
  try {
    const totalsRows = db.prepare('SELECT status, COUNT(*) as cnt FROM applications GROUP BY status').all() as Array<{
      status: string;
      cnt: number;
    }>;
    const statusTotals: Record<string, number> = {};
    for (const r of totalsRows) statusTotals[r.status] = Number(r.cnt);

    const parkedRows = db
      .prepare(
        `SELECT status, payload FROM applications WHERE status IN ('paused_for_review', 'failed')`
      )
      .all() as Array<{ status: string; payload: string }>;

    const buckets = new Map<string, { count: number; companies: Set<string>; samples: Set<string> }>();

    for (const row of parkedRows) {
      let reason = 'UNKNOWN_PARK_REASON';
      let detail = '';
      let company = '';

      try {
        const p = JSON.parse(row.payload || '{}');
        company = p.company || '';
        reason = (p.reasonCode && p.reasonCode !== 'UNKNOWN') ? p.reasonCode : (p.error || p.reason || row.status);
        if (Array.isArray(p.unmappedFields) && p.unmappedFields.length > 0) {
          detail = p.unmappedFields.slice(0, 3).join(' | ');
        } else if (p.error) {
          detail = String(p.error).slice(0, 120);
        }
      } catch {}

      // Normalize into clean Pareto categories
      let cat = reason;
      if (/next did not change|unchanged_form_state/i.test(reason)) cat = 'WIZARD_NEXT_STALLED';
      else if (/missing_fact|unmapped|required answer/i.test(reason)) cat = 'PARKED_MISSING_FACT';
      else if (/captcha/i.test(reason)) cat = 'CAPTCHA_VISUAL_CHALLENGE';
      else if (/login|auth|credential/i.test(reason)) cat = 'AUTH_OR_LOGIN_BLOCKER';
      else if (/submit control|missing submit/i.test(reason)) cat = 'MISSING_SUBMIT_BUTTON';
      else if (/validation|field error/i.test(reason)) cat = 'FORM_VALIDATION_ERROR';
      else if (/time-?out|timed\s*out|watchdog/i.test(reason)) cat = 'STEP_TIMEOUT';
      else if (/browser operation failed|inspect the saved review/i.test(reason)) cat = 'BROWSER_OPERATION_FAILED';
      else if (/ambiguous_dispatch|previous submit may have reached/i.test(reason)) cat = 'AMBIGUOUS_DISPATCH';
      else if (/waiting for application requests|retained tab will resume/i.test(reason)) cat = 'IN_FLIGHT_REQUESTS_WAIT';

      if (!buckets.has(cat)) {
        buckets.set(cat, { count: 0, companies: new Set(), samples: new Set() });
      }

      const b = buckets.get(cat)!;
      b.count += 1;
      if (company && b.companies.size < 8) b.companies.add(company);
      if (detail && b.samples.size < 8) b.samples.add(detail);
    }

    const totalParked = Math.max(1, parkedRows.length);
    const recommendations: Record<string, string> = {
      PARKED_MISSING_FACT: 'Add question pattern to self-learning.ts conceptRules or narrative-composer.ts',
      WIZARD_NEXT_STALLED: 'Check ensureStepReadyBeforeNext (required checkboxes, file upload completion, address cascade)',
      MISSING_SUBMIT_BUTTON: 'Add shadow-root button selector to adaptive-relocator.ts and wizard.ts',
      FORM_VALIDATION_ERROR: 'Add format healer in self-learning.ts validation error branch',
      AUTH_OR_LOGIN_BLOCKER: 'Check Workday SignInWithEmailButton or .env credential rules',
      CAPTCHA_VISUAL_CHALLENGE: 'Trigger GEN-40 single-slot HITL popup or rotate host cooldown',
      STEP_TIMEOUT: 'Increase provider budget in GEN-38 watchdog-timer.ts',
      BROWSER_OPERATION_FAILED: 'Inspect saved review.html via distiller.ts',
      AMBIGUOUS_DISPATCH: 'Verify previous receipt before retrying dispatch',
      IN_FLIGHT_REQUESTS_WAIT: 'Wait for background network requests or retained tab completion',
    };

    const paretoIssues: ParkIssueBucket[] = Array.from(buckets.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([cat, data]) => ({
        reasonCategory: cat,
        count: data.count,
        percentageOfParked: `${((data.count / totalParked) * 100).toFixed(1)}%`,
        sampleCompanies: [...data.companies],
        sampleQuestionsOrErrors: [...data.samples],
        autoFixRecommendation: recommendations[cat] || 'Inspect saved review.html via distiller.ts',
      }));

    const report = {
      generatedAt: new Date().toISOString(),
      statusTotals,
      paretoIssues,
    };

    fs.mkdirSync(path.dirname(SCOREBOARD_PATH), { recursive: true });
    fs.writeFileSync(SCOREBOARD_PATH, JSON.stringify(report, null, 2), 'utf8');
    return report;
  } finally {
    db.close();
  }
}
