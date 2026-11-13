// src/autoapply/overnight-error-logger.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface UnmappedFieldDiagnostic {
  questionText: string;
  widgetKind: string;
  isRequired: boolean;
  options: string[] | null;
  sectionHeading: string;
  domIdOrName: string;
}

export interface VisibleButtonDiagnostic {
  tag: string;
  text: string;
  ariaLabel: string;
  dataAutomationId: string;
  dataTest: string;
  className: string;
  inShadowDom: boolean;
}

export interface PageDiagnostics {
  stepHeading: string;
  validationErrorsOnPage: string[];
  visibleButtonsOnPage: VisibleButtonDiagnostic[];
  unmappedFields: UnmappedFieldDiagnostic[];
}

export interface OvernightErrorRecord {
  timestamp: string;
  jobId: string;
  company: string;
  title: string;
  provider: string;
  lane: string;
  url: string;
  durationMs: number;
  status: 'failed' | 'paused_for_review' | 'timeout' | 'captcha_deferred' | string;
  reasonCode: string;
  errorMessage: string;
  stepNumber: number;
  stepHeading: string;
  unmappedFields: UnmappedFieldDiagnostic[];
  validationErrorsOnPage: string[];
  visibleButtonsOnPage: VisibleButtonDiagnostic[];
}

export const DEFAULT_OVERNIGHT_ERRORS_PATH = path.resolve('state/autoapply/portal-review/overnight-errors.jsonl');
export const DEFAULT_REPORT_JSON_PATH = path.resolve('state/autoapply/portal-review/overnight-improvement-report.json');
export const DEFAULT_REPORT_MD_PATH = path.resolve('out/MORNING-IMPROVEMENT-REPORT.md');
export const DEFAULT_SCOREBOARD_PATH = path.resolve('state/autoapply/portal-review/park-issues-scoreboard.json');
export const DEFAULT_LEDGER_PATH = path.resolve('state/autoapply/portal-review/unknown-fields-ledger.json');
export const DEFAULT_RUN_HISTORY_PATH = path.resolve('state/autoapply/portal-review/run-history.jsonl');
export const DEFAULT_SQLITE_PATH = path.resolve('state/autoapply/portal-review/queue.sqlite');

export function normalizeReasonCode(reason: string, status?: string): string {
  const r = (reason || status || 'UNKNOWN').trim();
  if (/next did not change|unchanged_form_state/i.test(r)) return 'WIZARD_NEXT_STALLED';
  if (/submit control|missing submit|no supported submit/i.test(r)) return 'MISSING_SUBMIT_BUTTON';
  if (/missing_fact|unmapped|required answer/i.test(r)) return 'PARKED_MISSING_FACT';
  if (/captcha/i.test(r) || status === 'captcha_deferred') return 'CAPTCHA_VISUAL_CHALLENGE';
  if (/login|auth|credential/i.test(r)) return 'AUTH_OR_LOGIN_BLOCKER';
  if (/validation|field error/i.test(r)) return 'FORM_VALIDATION_ERROR';
  if (/time-?out|timed\s*out|watchdog/i.test(r) || status === 'timeout') return 'STEP_TIMEOUT';
  if (/browser operation failed|inspect the saved review/i.test(r)) return 'BROWSER_OPERATION_FAILED';
  if (/ambiguous_dispatch|previous submit may have reached/i.test(r)) return 'AMBIGUOUS_DISPATCH';
  if (/waiting for application requests|retained tab will resume/i.test(r)) return 'IN_FLIGHT_REQUESTS_WAIT';
  if (/ineligible_jd_experience/i.test(r)) return 'SKIPPED_INELIGIBLE_YOE';
  if (/board_root_not_requisition/i.test(r)) return 'SKIPPED_BOARD_ROOT';

  return r
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'UNKNOWN_ERROR';
}

export async function capturePageDiagnostics(
  page: any,
  reason?: string
): Promise<PageDiagnostics> {
  const fallback: PageDiagnostics = {
    stepHeading: '',
    validationErrorsOnPage: [],
    visibleButtonsOnPage: [],
    unmappedFields: [],
  };

  if (!page || typeof page.evaluate !== 'function') return fallback;

  try {
    if (typeof page.isClosed === 'function' && page.isClosed()) return fallback;

    const diag = await page.evaluate((isStallOrSubmitMissing: boolean) => {
      // 1. Step Heading
      let stepHeading = '';
      const headingCandidate = document.querySelector(
        '[data-automation-id="progressBarActiveStep"], [aria-current="step"], .progress-step.active, .step-title, h1, h2, legend'
      );
      if (headingCandidate && headingCandidate.textContent) {
        stepHeading = headingCandidate.textContent.replace(/\s+/g, ' ').trim().slice(0, 100);
      }

      // 2. Validation errors (Ticket GEN-60 & GEN-61)
      const valSelectors = [
        '[data-automation-id="errorMessage"]',
        '[data-automation-id*="error" i]',
        '[role="alert"]',
        '.error',
        '.error-message',
        '.invalid-feedback',
        '[aria-invalid="true"]',
        ':invalid',
        '.field-error',
        '[id$="-error"]',
        '[class*="_error_"]',
        '.ashby-application-form-field-error',
      ];
      const valElements = Array.from(document.querySelectorAll(valSelectors.join(',')));
      const validationErrors: string[] = [];
      const seenVal = new Set<string>();

      for (const el of valElements) {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 && rect.height <= 0) continue;

        let msg = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!msg && (el as HTMLInputElement).validationMessage) {
          msg = (el as HTMLInputElement).validationMessage.trim();
        }
        if (msg && msg.length > 2 && msg.length < 250 && !seenVal.has(msg)) {
          seenVal.add(msg);
          validationErrors.push(msg);
        }
      }

      // 3. Unmapped fields (find invalid or missing required controls)
      const unmappedFields: Array<{
        questionText: string;
        widgetKind: string;
        isRequired: boolean;
        options: string[] | null;
        sectionHeading: string;
        domIdOrName: string;
      }> = [];
      const seenFields = new Set<string>();

      const inputEls = Array.from(
        document.querySelectorAll(
          'input:invalid, select:invalid, textarea:invalid, [aria-invalid="true"], .error input, .has-error input, .error select, .has-error select'
        )
      );

      for (const el of inputEls) {
        const input = el as HTMLInputElement | HTMLSelectElement;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        // react-select carries its HTML validation on an unnamed
        // `…-requiredInput` shadow input. It is not a field, so reporting it
        // produced label-less "required field" noise for Greenhouse dropdowns.
        const isShadowSelectInput =
          input.tagName === 'INPUT' &&
          ((input as HTMLInputElement).type === 'hidden' ||
            el.getAttribute('aria-hidden') === 'true' ||
            /\brequiredInput\b/.test(el.className || ''));
        if (isShadowSelectInput) {
          const host = el.closest('.select-shell, [class*="select__control"], [class*="select-container" i]');
          const hostLabel = host
            ?.closest('fieldset, .field, [class*="question" i], [class*="form-field" i]')
            ?.querySelector('label, legend')
            ?.textContent?.replace(/\s+/g, ' ').trim() || '';
          const key = `select::${hostLabel}`;
          if (hostLabel && !seenFields.has(key)) {
            seenFields.add(key);
            unmappedFields.push({
              questionText: hostLabel.slice(0, 200),
              widgetKind: 'SINGLE_SELECT',
              isRequired: true,
              options: null,
              sectionHeading: '',
              domIdOrName: '',
            });
          }
          continue;
        }

        const container =
          el.closest('fieldset, .application-question, .custom-question, [data-field-path], [data-automation-id*="form-field"], .form-group, .field, [role="group"]') ||
          el.parentElement;

        let prompt = '';
        if (container) {
          const explicitTitle = container.querySelector(
            'legend, .application-label, [data-automation-id*="formLabel"], .field-label, .question-title, .form-label'
          );
          if (explicitTitle?.textContent?.trim()) {
            prompt = explicitTitle.textContent.replace(/\s+/g, ' ').trim();
          } else {
            const singleLabel = Array.from(container.querySelectorAll('label')).find(
              l => !l.querySelector('input[type="radio"], input[type="checkbox"]')
            );
            if (singleLabel?.textContent?.trim()) prompt = singleLabel.textContent.replace(/\s+/g, ' ').trim();
          }
        }
        if (!prompt) {
          const labelledBy = el.getAttribute('aria-labelledby') || container?.getAttribute('aria-labelledby');
          if (labelledBy) {
            const parts = labelledBy
              .split(/\s+/)
              .map(id => document.getElementById(id)?.textContent?.trim())
              .filter(Boolean);
            if (parts.length) prompt = parts.join(' ');
          }
        }
        if (!prompt) {
          prompt =
            Array.from(input.labels || [])
              .map(l => l.textContent || '')
              .join(' ')
              .trim() ||
            el.getAttribute('aria-label') ||
            el.getAttribute('placeholder') ||
            el.getAttribute('name') ||
            el.getAttribute('id') ||
            '';
        }

        const domIdOrName = el.id || el.getAttribute('name') || el.getAttribute('data-automation-id') || '';
        const fieldKey = `${prompt}::${domIdOrName}`;
        if (seenFields.has(fieldKey)) continue;
        seenFields.add(fieldKey);

        let opts: string[] | null = null;
        if (el.tagName === 'SELECT') {
          opts = Array.from((el as HTMLSelectElement).options)
            .map(o => o.text.trim())
            .filter(Boolean);
        } else if (input.type === 'radio') {
          const radioName = input.name;
          const group = radioName
            ? Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(radioName)}"]`))
            : container ? Array.from(container.querySelectorAll('input[type="radio"]')) : [];
          if (group.length) {
            opts = group
              .map(r => {
                const rInp = r as HTMLInputElement;
                const lbl = Array.from(rInp.labels || []).map(l => l.textContent || '').join(' ').trim();
                return lbl || rInp.value;
              })
              .filter(Boolean);
          }
        }

        const sectionEl = el.closest('fieldset, section, [data-automation-id*="section" i]');
        const sectionHeading =
          sectionEl?.querySelector('legend, h2, h3, [data-automation-id*="heading" i]')?.textContent?.replace(/\s+/g, ' ').trim() || '';

        unmappedFields.push({
          questionText: prompt.slice(0, 200),
          widgetKind: el.tagName === 'SELECT' ? 'SELECT' : (input.type || 'TEXT').toUpperCase(),
          isRequired: input.required || el.getAttribute('aria-required') === 'true',
          options: opts && opts.length ? opts.slice(0, 25) : null,
          sectionHeading: sectionHeading.slice(0, 100),
          domIdOrName: domIdOrName.slice(0, 100),
        });
      }

      // 4. Visible buttons & links (Top 15)
      const visibleButtons: Array<{
        tag: string;
        text: string;
        ariaLabel: string;
        dataAutomationId: string;
        dataTest: string;
        className: string;
        inShadowDom: boolean;
      }> = [];

      function collectButtons(root: Document | ShadowRoot, inShadow: boolean) {
        const query =
          'button, [role="button"], a.btn, a[role="button"], input[type="submit"], input[type="button"], [data-automation-id*="button" i], [data-automation-id*="next" i], [data-automation-id*="submit" i]';
        const candidates = Array.from(root.querySelectorAll(query));

        for (const btn of candidates) {
          if (visibleButtons.length >= 15) return;
          const style = window.getComputedStyle(btn);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          const rect = btn.getBoundingClientRect();
          if (rect.width <= 0 && rect.height <= 0) continue;

          visibleButtons.push({
            tag: btn.tagName.toLowerCase(),
            text: (btn.textContent || (btn as HTMLInputElement).value || '').replace(/\s+/g, ' ').trim().slice(0, 60),
            ariaLabel: (btn.getAttribute('aria-label') || '').slice(0, 60),
            dataAutomationId: (btn.getAttribute('data-automation-id') || '').slice(0, 60),
            dataTest: (btn.getAttribute('data-testid') || btn.getAttribute('data-test') || '').slice(0, 60),
            className: (typeof btn.className === 'string' ? btn.className : '').slice(0, 80),
            inShadowDom: inShadow,
          });
        }

        const all = root.querySelectorAll('*');
        for (const el of Array.from(all)) {
          if (visibleButtons.length >= 15) return;
          if (el.shadowRoot) {
            collectButtons(el.shadowRoot, true);
          }
        }
      }

      collectButtons(document, false);

      return {
        stepHeading,
        validationErrorsOnPage: validationErrors.slice(0, 20),
        visibleButtonsOnPage: visibleButtons.slice(0, 15),
        unmappedFields: unmappedFields.slice(0, 25),
      };
    }, /submit control|next did not change/i.test(reason || ''));

    return {
      stepHeading: diag.stepHeading || '',
      validationErrorsOnPage: diag.validationErrorsOnPage || [],
      visibleButtonsOnPage: diag.visibleButtonsOnPage || [],
      unmappedFields: diag.unmappedFields || [],
    };
  } catch {
    return fallback;
  }
}

export function recordOvernightError(
  record: OvernightErrorRecord,
  errorsPath = DEFAULT_OVERNIGHT_ERRORS_PATH
): void {
  try {
    fs.mkdirSync(path.dirname(errorsPath), { recursive: true });
    const line = JSON.stringify(record) + '\n';
    fs.appendFileSync(errorsPath, line, 'utf8');
  } catch (err) {
    console.error('[OVERNIGHT_LOGGER] Failed to write overnight error record:', err);
  }
}

export interface MorningImprovementReport {
  generatedAt: string;
  summary: {
    totalProcessed: number;
    applied: number;
    receiptFlagsRecorded: number;
    paused: number;
    failed: number;
    skipped: number;
    durationByAts: Record<
      string,
      { count: number; avgMs: number; p50Ms: number; p95Ms: number; avgSec: string; p50Sec: string; p95Sec: string }
    >;
  };
  topFailureCategories: Array<{
    rank: number;
    category: string;
    count: number;
    percentage: string;
    sampleCompanies: string[];
    sampleErrors: string[];
  }>;
  topUnknownQuestions: Array<{
    rank: number;
    questionText: string;
    widgetKind: string;
    options: string[] | null;
    count: number;
    sampleCompanies: string[];
  }>;
  missedButtonStalls: Array<{
    company: string;
    title: string;
    provider: string;
    url: string;
    stepNumber: number;
    stepHeading: string;
    reasonCode: string;
    errorMessage: string;
    validationErrors: string[];
    visibleButtons: VisibleButtonDiagnostic[];
  }>;
}

export function compileMorningImprovementReport(options?: {
  errorsPath?: string;
  ledgerPath?: string;
  scoreboardPath?: string;
  outMdPath?: string;
  outJsonPath?: string;
  queueDbPath?: string;
  runHistoryPath?: string;
}): { reportMarkdown: string; reportJson: MorningImprovementReport } {
  const errorsPath = options?.errorsPath || DEFAULT_OVERNIGHT_ERRORS_PATH;
  const ledgerPath = options?.ledgerPath || DEFAULT_LEDGER_PATH;
  const outMdPath = options?.outMdPath || DEFAULT_REPORT_MD_PATH;
  const outJsonPath = options?.outJsonPath || DEFAULT_REPORT_JSON_PATH;
  const queueDbPath = options?.queueDbPath || DEFAULT_SQLITE_PATH;
  const runHistoryPath = options?.runHistoryPath || DEFAULT_RUN_HISTORY_PATH;

  // 1. Read overnight-errors.jsonl
  const errorRecords: OvernightErrorRecord[] = [];
  if (fs.existsSync(errorsPath)) {
    try {
      const lines = fs.readFileSync(errorsPath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          errorRecords.push(JSON.parse(trimmed));
        } catch {}
      }
    } catch {}
  }

  // 2. Read queue status totals from SQLite if available
  const queueStatusTotals: Record<string, number> = {};
  if (fs.existsSync(queueDbPath)) {
    try {
      const db = new DatabaseSync(queueDbPath, { readOnly: true });
      db.exec('PRAGMA busy_timeout = 15000;');
      const rows = db.prepare('SELECT status, COUNT(*) as cnt FROM applications GROUP BY status').all() as Array<{
        status: string;
        cnt: number;
      }>;
      for (const r of rows) queueStatusTotals[r.status] = Number(r.cnt);
      db.close();
    } catch {}
  }

  // 3. Read run-history.jsonl for duration statistics & overall counts
  const runHistory: Array<{
    provider: string;
    durationMs: number;
    status: string;
    receiptVerified?: boolean;
  }> = [];

  if (fs.existsSync(runHistoryPath)) {
    try {
      const lines = fs.readFileSync(runHistoryPath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const item = JSON.parse(trimmed);
          runHistory.push({
            provider: (item.provider || 'other').toLowerCase(),
            durationMs: Number(item.durationMs || 0),
            status: item.status || 'failed',
            receiptVerified: !!item.receiptVerified,
          });
        } catch {}
      }
    } catch {}
  }

  // Overall counts
  const totalAppliedFromHistory = runHistory.filter(r => r.status === 'applied' || r.status === 'submitted').length;
  const receiptFlagsRecorded = runHistory.filter(r => r.receiptVerified).length;
  const totalFailedFromHistory = runHistory.filter(r => r.status === 'failed').length;
  const totalPausedFromHistory = runHistory.filter(r => r.status === 'paused_for_review').length;
  const totalSkippedFromHistory = runHistory.filter(r => r.status === 'skipped').length;

  const appliedCount = Math.max(queueStatusTotals['applied'] || 0, totalAppliedFromHistory);
  const pausedCount = Math.max(queueStatusTotals['paused_for_review'] || 0, totalPausedFromHistory);
  const failedCount = Math.max(queueStatusTotals['failed'] || 0, totalFailedFromHistory, errorRecords.length);
  const skippedCount = Math.max(queueStatusTotals['skipped'] || 0, totalSkippedFromHistory);
  const totalProcessed = appliedCount + pausedCount + failedCount + skippedCount;

  // Latency metrics by ATS
  const durationByAtsMap = new Map<string, number[]>();
  for (const r of runHistory) {
    if (r.durationMs > 0) {
      const prov = r.provider || 'other';
      if (!durationByAtsMap.has(prov)) durationByAtsMap.set(prov, []);
      durationByAtsMap.get(prov)!.push(r.durationMs);
    }
  }
  // Also incorporate real durations from errorRecords
  for (const err of errorRecords) {
    if (err.durationMs > 0) {
      const prov = (err.provider || 'other').toLowerCase();
      if (!durationByAtsMap.has(prov)) durationByAtsMap.set(prov, []);
      durationByAtsMap.get(prov)!.push(err.durationMs);
    }
  }

  const durationByAts: MorningImprovementReport['summary']['durationByAts'] = {};
  for (const [ats, durations] of durationByAtsMap.entries()) {
    durations.sort((a, b) => a - b);
    const count = durations.length;
    const avgMs = Math.round(durations.reduce((s, v) => s + v, 0) / count);
    const p50Ms = durations[Math.floor(count * 0.5)] || 0;
    const p95Ms = durations[Math.floor(count * 0.95)] || 0;
    durationByAts[ats] = {
      count,
      avgMs,
      p50Ms,
      p95Ms,
      avgSec: `${(avgMs / 1000).toFixed(1)}s`,
      p50Sec: `${(p50Ms / 1000).toFixed(1)}s`,
      p95Sec: `${(p95Ms / 1000).toFixed(1)}s`,
    };
  }

  // Section 2: Top 15 Failure Categories
  const categoryMap = new Map<string, { count: number; companies: Set<string>; errors: Set<string> }>();
  for (const r of errorRecords) {
    const code = r.reasonCode || normalizeReasonCode(r.errorMessage, r.status);
    if (!categoryMap.has(code)) {
      categoryMap.set(code, { count: 0, companies: new Set(), errors: new Set() });
    }
    const cat = categoryMap.get(code)!;
    cat.count++;
    if (r.company && cat.companies.size < 6) cat.companies.add(r.company);
    if (r.errorMessage && cat.errors.size < 4) cat.errors.add(r.errorMessage.slice(0, 120));
  }

  const totalNonApplied = Math.max(1, errorRecords.length);
  const sortedCategories = Array.from(categoryMap.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 15);

  const topFailureCategories: MorningImprovementReport['topFailureCategories'] = sortedCategories.map(
    ([category, data], idx) => ({
      rank: idx + 1,
      category,
      count: data.count,
      percentage: `${((data.count / totalNonApplied) * 100).toFixed(1)}%`,
      sampleCompanies: Array.from(data.companies),
      sampleErrors: Array.from(data.errors),
    })
  );

  // Section 3: Top 25 Unknown / Unmapped Questions
  const unknownQuestionsMap = new Map<
    string,
    { questionText: string; widgetKind: string; options: string[] | null; count: number; companies: Set<string> }
  >();

  // Incorporate from unknown-fields-ledger.json
  if (fs.existsSync(ledgerPath)) {
    try {
      const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
      for (const key of Object.keys(ledger)) {
        const item = ledger[key];
        const qText = item.questionText || key;
        const norm = qText.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
        if (!unknownQuestionsMap.has(norm)) {
          unknownQuestionsMap.set(norm, {
            questionText: qText,
            widgetKind: item.widgetKind || 'TEXT',
            options: item.options || null,
            count: 0,
            companies: new Set(item.sampleCompanies || []),
          });
        }
        const entry = unknownQuestionsMap.get(norm)!;
        entry.count += Number(item.occurrences || 1);
        for (const c of item.sampleCompanies || []) entry.companies.add(c);
      }
    } catch {}
  }

  // Incorporate unmappedFields from overnight error records
  for (const r of errorRecords) {
    for (const f of r.unmappedFields || []) {
      const norm = (f.questionText || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
      if (!norm || norm.length < 3) continue;
      if (!unknownQuestionsMap.has(norm)) {
        unknownQuestionsMap.set(norm, {
          questionText: f.questionText,
          widgetKind: f.widgetKind || 'TEXT',
          options: f.options || null,
          count: 0,
          companies: new Set(),
        });
      }
      const entry = unknownQuestionsMap.get(norm)!;
      entry.count++;
      if (r.company && entry.companies.size < 5) entry.companies.add(r.company);
      if (f.options && (!entry.options || !entry.options.length)) entry.options = f.options;
    }
  }

  const topUnknownQuestions: MorningImprovementReport['topUnknownQuestions'] = Array.from(
    unknownQuestionsMap.values()
  )
    .sort((a, b) => b.count - a.count)
    .slice(0, 25)
    .map((item, idx) => ({
      rank: idx + 1,
      questionText: item.questionText,
      widgetKind: item.widgetKind,
      options: item.options,
      count: item.count,
      sampleCompanies: Array.from(item.companies).slice(0, 5),
    }));

  // Section 4: Top Missed Button Selectors & Wizard Stalls
  const buttonStallRecords = errorRecords.filter(
    r =>
      r.reasonCode === 'MISSING_SUBMIT_BUTTON' ||
      r.reasonCode === 'WIZARD_NEXT_STALLED' ||
      /submit control|missing submit|next did not change/i.test(r.errorMessage) ||
      (r.visibleButtonsOnPage && r.visibleButtonsOnPage.length > 0)
  );

  const missedButtonStalls: MorningImprovementReport['missedButtonStalls'] = buttonStallRecords.slice(0, 15).map(r => ({
    company: r.company,
    title: r.title,
    provider: r.provider,
    url: r.url,
    stepNumber: r.stepNumber,
    stepHeading: r.stepHeading,
    reasonCode: r.reasonCode,
    errorMessage: r.errorMessage,
    validationErrors: r.validationErrorsOnPage || [],
    visibleButtons: r.visibleButtonsOnPage || [],
  }));

  const reportJson: MorningImprovementReport = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalProcessed,
      applied: appliedCount,
      receiptFlagsRecorded,
      paused: pausedCount,
      failed: failedCount,
      skipped: skippedCount,
      durationByAts,
    },
    topFailureCategories,
    topUnknownQuestions,
    missedButtonStalls,
  };

  // Compile Markdown Document
  let md = `# Overnight Auto-Apply Diagnostics & Improvement Report\n\n`;
  md += `*Generated: ${reportJson.generatedAt}*\n\n`;
  md += `> [!NOTE]\n`;
  md += `> This report aggregates diagnostics from all non-applied outcomes (\`failed\`, \`paused_for_review\`, \`timeout\`, \`captcha_deferred\`) across overnight backfill batches, detailing missed field classifications, validation errors, and undetected form buttons.\n\n`;

  // SECTION 1
  md += `## Section 1: Overnight Summary\n\n`;
  md += `| Metric | Count |\n`;
  md += `| :--- | :--- |\n`;
  md += `| **Total Processed** | **${totalProcessed}** |\n`;
  md += `| Applied (Submitted) | ${appliedCount} |\n`;
  md += `| Receipt flags recorded (not independently verified) | ${receiptFlagsRecorded} |\n`;
  md += `| Paused for Review | ${pausedCount} |\n`;
  md += `| Failed | ${failedCount} |\n`;
  md += `| Skipped (Preflight / Duplicates) | ${skippedCount} |\n\n`;

  md += `### Per-ATS Latency & Durations (Real Measured Duration)\n\n`;
  md += `| ATS Provider | Jobs Measured | Avg Duration | P50 Duration | P95 Duration |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- |\n`;
  const atsList = Object.keys(durationByAts).sort();
  if (atsList.length === 0) {
    md += `| *All Lanes* | 0 | 0.0s | 0.0s | 0.0s |\n`;
  } else {
    for (const ats of atsList) {
      const d = durationByAts[ats]!;
      md += `| **${ats.toUpperCase()}** | ${d.count} | ${d.avgSec} | ${d.p50Sec} | ${d.p95Sec} |\n`;
    }
  }
  md += `\n`;

  // SECTION 2
  md += `## Section 2: Top 15 Failure & Pause Categories\n\n`;
  if (topFailureCategories.length === 0) {
    md += `*No overnight failures recorded yet.*\n\n`;
  } else {
    md += `| Rank | Category Code | Failures | % of Non-Applied | Sample Companies | Exact Error Sample |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
    for (const cat of topFailureCategories) {
      const companiesStr = cat.sampleCompanies.length ? cat.sampleCompanies.join(', ') : 'N/A';
      const errorSample = cat.sampleErrors[0] ? `\`${cat.sampleErrors[0].replace(/\|/g, '/')}\`` : 'N/A';
      md += `| ${cat.rank} | **\`${cat.category}\`** | ${cat.count} | ${cat.percentage} | ${companiesStr} | ${errorSample} |\n`;
    }
    md += `\n`;
  }

  // SECTION 3
  md += `## Section 3: Top 25 Unknown / Unmapped Questions Encountered\n\n`;
  if (topUnknownQuestions.length === 0) {
    md += `*No unmapped questions recorded.*\n\n`;
  } else {
    md += `| Rank | Question Text | Widget | Occurrences | Options (Choice/Radio/Select) | Sample Companies |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
    for (const q of topUnknownQuestions) {
      const optsStr = q.options && q.options.length ? `[${q.options.slice(0, 4).join(', ')}${q.options.length > 4 ? '...' : ''}]` : '-';
      const companiesStr = q.sampleCompanies.length ? q.sampleCompanies.join(', ') : 'N/A';
      md += `| ${q.rank} | **${q.questionText.replace(/\|/g, '/')}** | \`${q.widgetKind}\` | ${q.count} | ${optsStr} | ${companiesStr} |\n`;
    }
    md += `\n`;
  }

  // SECTION 4
  md += `## Section 4: Top Missed Button Selectors & Wizard Stalls\n\n`;
  if (missedButtonStalls.length === 0) {
    md += `*No button selector misses or wizard stalls detected overnight.*\n\n`;
  } else {
    for (let i = 0; i < missedButtonStalls.length; i++) {
      const stall = missedButtonStalls[i]!;
      md += `### ${i + 1}. ${stall.company} (${stall.provider}) — \`${stall.reasonCode}\`\n`;
      md += `- **URL:** [${stall.company} Requisition](${stall.url})\n`;
      md += `- **Step ${stall.stepNumber}:** ${stall.stepHeading || 'Main Form'}\n`;
      md += `- **Error:** \`${stall.errorMessage}\`\n`;

      if (stall.validationErrors.length > 0) {
        md += `- **Validation Banners on Page:**\n`;
        for (const ve of stall.validationErrors) {
          md += `  - ⚠️ \`${ve}\`\n`;
        }
      }

      if (stall.visibleButtons.length > 0) {
        md += `- **Top Visible Buttons Detected on Page at Stall Time:**\n`;
        md += `  | Tag | Text | aria-label | data-automation-id | Class Name | inShadowDom |\n`;
        md += `  | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
        for (const btn of stall.visibleButtons) {
          md += `  | \`<${btn.tag}>\` | "${btn.text}" | "${btn.ariaLabel}" | \`${btn.dataAutomationId || '-'}\` | \`${btn.className.slice(0, 30) || '-'}\` | ${btn.inShadowDom ? 'Yes' : 'No'} |\n`;
        }
      }
      md += `\n`;
    }
  }

  // Save report files
  try {
    fs.mkdirSync(path.dirname(outMdPath), { recursive: true });
    fs.writeFileSync(outMdPath, md, 'utf8');

    fs.mkdirSync(path.dirname(outJsonPath), { recursive: true });
    fs.writeFileSync(outJsonPath, JSON.stringify(reportJson, null, 2), 'utf8');
  } catch (err) {
    console.error('[OVERNIGHT_LOGGER] Failed to save improvement reports:', err);
  }

  return { reportMarkdown: md, reportJson };
}
