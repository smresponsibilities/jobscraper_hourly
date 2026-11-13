import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyAtsField } from '../src/autoapply/classifier.js';
import { normalizeQuestion, resolveCandidateAnswer } from '../src/autoapply/answers.js';
import { loadProfile } from '../src/autoapply/profile.js';
import { lookupPortfolioProjectFact } from '../src/autoapply/narrative-composer.js';
import type { CandidateExtendedProfile } from '../src/autoapply/types.js';

export interface ReplaySummary {
  total: number;
  resolved: number;
  skipped: number;
  excluded: number;
  unresolved: number;
  missingFactReferences: number;
  malformed: number;
  independentlyVerified: number;
}

/** Accept both keyed ledgers and their legacy array form without counting metadata as questions. */
export function historicalLedgerEntries(ledger: unknown): unknown[] {
  if (Array.isArray(ledger)) return ledger;
  if (!ledger || typeof ledger !== 'object') throw new Error('Ledger must be an array or object');
  const entries: unknown[] = [];
  for (const [key, value] of Object.entries(ledger)) {
    if (key === 'version') continue;
    if (key === 'unmappedQuestions' && Array.isArray(value)) entries.push(...value);
    else entries.push(value);
  }
  return entries;
}

function presentFact(profile: CandidateExtendedProfile, key: string): boolean {
  if (key.startsWith('projectCatalog.')) {
    const name = profile.personal.fullName || [profile.personal.firstName, profile.personal.lastName].filter(Boolean).join(' ');
    return /^shivam\s+mahajan$/i.test(name.trim()) && !!lookupPortfolioProjectFact(key);
  }
  let value: unknown = profile;
  for (const part of key.split('.')) {
    if (!value || typeof value !== 'object' || !(part in value)) return false;
    value = (value as Record<string, unknown>)[part];
  }
  return value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);
}

/** Read-only replay: no rule synthesis, inferred facts, or mutation of memory. */
export function replayHistoricalQuestions(entries: unknown[], profile: CandidateExtendedProfile): ReplaySummary {
  const summary: ReplaySummary = { total: entries.length, resolved: 0, skipped: 0, excluded: 0, unresolved: 0, missingFactReferences: 0, malformed: 0, independentlyVerified: 0 };
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { summary.malformed++; summary.unresolved++; continue; }
    const item = entry as Record<string, unknown>;
    const question = [item.questionText, item.label, item.name].find(value => typeof value === 'string' && value.trim()) as string | undefined;
    if (!question || (item.options != null && (!Array.isArray(item.options) || item.options.some(option => typeof option !== 'string')))) {
      summary.malformed++; summary.unresolved++; continue;
    }
    if (normalizeQuestion(question) === 'yes' && !String(item.sectionHeading || '').trim()) {
      summary.excluded++;
      continue;
    }
    if (item.isRequired === false && profile.applicationPreferences?.skipOptionalQuestions?.some(value => normalizeQuestion(value) === normalizeQuestion(question))) {
      summary.skipped++;
      continue;
    }
    const options = (item.options || []) as string[];
    const recordedWidget = typeof item.widgetKind === 'string' ? item.widgetKind : '';
    const fieldType = typeof item.type === 'string' ? item.type : /^(?:text|number|textarea|checkbox|radio|select|file)$/i.test(recordedWidget) ? recordedWidget.toLowerCase() : 'text';
    const urls = Array.isArray(item.sampleUrls) ? [...new Set(item.sampleUrls.filter((url): url is string => typeof url === 'string' && URL.canParse(url)))] : [];
    const url = urls.length === 1 ? urls[0]! : 'https://neutral.invalid';
    try {
      const classification = classifyAtsField({ label: question, name: question, type: fieldType, widgetKind: recordedWidget || undefined, options });
      const answer = resolveCandidateAnswer(classification.category, profile, { url, question, options, fieldType });
      if (answer.value === undefined || answer.value === null || answer.value === '') { summary.unresolved++; continue; }
      if (!answer.sourceFactKeys.length || !answer.sourceFactKeys.every(key => presentFact(profile, key))) {
        summary.missingFactReferences++; summary.unresolved++; continue;
      }
      if (options.length) {
        const acceptable = typeof answer.value === 'boolean' ? answer.value ? ['yes', 'true'] : ['no', 'false'] : [String(answer.value).trim().toLowerCase()];
        if (!options.some(option => acceptable.includes(option.trim().toLowerCase()))) { summary.unresolved++; continue; }
      }
      if (item.reviewedByOwner === true) {
        if (!['string', 'number', 'boolean'].includes(typeof item.verifiedExpectedValue)
          || String(item.verifiedExpectedValue).trim().toLowerCase() !== String(answer.value).trim().toLowerCase()) {
          summary.unresolved++;
          continue;
        }
        summary.independentlyVerified++;
      }
      summary.resolved++;
    } catch { summary.unresolved++; }
  }
  return summary;
}

export function historicalReplayMeetsGate(summary: ReplaySummary, expectedTotal = summary.total): boolean {
  return expectedTotal > 0 && summary.resolved > 0 && summary.total === expectedTotal && summary.resolved + summary.skipped + summary.excluded === expectedTotal && summary.unresolved === 0 && summary.missingFactReferences === 0 && summary.malformed === 0;
}

function main(): void {
  try {
    const profile = loadProfile('state/autoapply/portal-review/candidate.json');
    const ledgerPath = path.resolve('state/autoapply/portal-review/unknown-fields-ledger.json');
    const ledger: unknown = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    const entries = historicalLedgerEntries(ledger);
    const summary = replayHistoricalQuestions(entries, profile);
    console.log(JSON.stringify(summary, null, 2));
    if (!historicalReplayMeetsGate(summary)) {
      console.error(`[TEST-GEN-550 FAIL] Replay requires all ${summary.total} questions to be grounded or explicitly skipped when optional.`);
      process.exitCode = 1;
      return;
    }
    console.log(`[TEST-GEN-550 PASS] ${summary.resolved} answers have present fact references; ${summary.skipped} optional questions were skipped and ${summary.excluded} malformed entries excluded by request; ${summary.independentlyVerified} match owner-reviewed values.`);
  } catch {
    console.error('[TEST-GEN-550 FAIL] Candidate profile or historical ledger is unavailable or invalid.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
