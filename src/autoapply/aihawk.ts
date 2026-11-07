/**
 * AIHawk Autonomous Question Answering & Validation Recovery Engine.
 * Reverse-engineered from AIHawk (Auto_Jobs_Applier_AIHawk) open-source Playwright runner.
 */

import type { CandidateExtendedProfile } from './types.js';
import { classifyAtsField } from './classifier.js';
import { resolveCandidateAnswer, type AnswerContext } from './answers.js';

export interface DynamicAnswerResult {
  value: string | boolean | number | undefined;
  confidence: number;
  reason: string;
}

/**
 * Resolves arbitrary ATS questions using AIHawk's heuristic rule engine.
 */
export function resolveDynamicQuestion(
  questionText: string,
  profile: CandidateExtendedProfile,
  context?: AnswerContext
): DynamicAnswerResult {
  return resolveCandidateAnswer(classifyAtsField({ label: questionText }).category, profile,
    context || { url: 'https://local.invalid/', country: profile.personal.country, question: questionText });
}

/**
 * Multiple-choice fuzzy answer selector.
 * Finds the closest matching option given candidate preference.
 */
export function matchBestOption(
  targetValue: string | boolean | number,
  options: Array<{ value: string; label: string }>
): { value: string; label: string } | null {
  if (!options.length) return null;

  const targetStr = String(targetValue).trim().toLowerCase();

  const exactLabels = options.filter(option => option.label.trim().toLowerCase() === targetStr);
  if (exactLabels.length === 1) return exactLabels[0]!;
  if (exactLabels.length > 1) return null;

  if (typeof targetValue === 'number' && Number.isFinite(targetValue)) {
    let hasRange = false;
    const matches = options.filter(option => {
      const label = option.label.toLowerCase().replace(/,/g, '').trim();
      const range = /^(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)(?:\s*(?:years?|yrs?|lpa|lakhs?))?$/.exec(label);
      if (range) { hasRange = true; return targetValue >= Number(range[1]) && targetValue <= Number(range[2]); }
      const plus = /^(\d+(?:\.\d+)?)\s*\+(?:\s*(?:years?|yrs?|lpa|lakhs?))?$/.exec(label);
      if (plus) { hasRange = true; return targetValue >= Number(plus[1]); }
      const less = /^(?:less than|under|below)\s+(\d+(?:\.\d+)?)(?:\s*(?:years?|yrs?|lpa|lakhs?))?$/.exec(label);
      if (less) { hasRange = true; return targetValue < Number(less[1]); }
      const upTo = /^(?:up to|at most)\s+(\d+(?:\.\d+)?)(?:\s*(?:years?|yrs?|lpa|lakhs?))?$/.exec(label);
      if (upTo) hasRange = true;
      return !!upTo && targetValue <= Number(upTo[1]);
    });
    if (matches.length === 1) return matches[0]!;
    if (hasRange) return null;
  }
  // Exact labels and values are used only when range labels are absent.
  const exact = options.find(o => o.value.trim().toLowerCase() === targetStr || o.label.trim().toLowerCase() === targetStr);
  if (exact) return exact;
  if (/^\+\d{1,4}$/.test(targetStr)) {
    const dialingCodes = options.filter(option => /\(\s*(\+\d{1,4})\s*\)$/.exec(option.label.trim())?.[1] === targetStr);
    return dialingCodes.length === 1 ? dialingCodes[0]! : null;
  }
  const normalized = (text: string) => text.toLowerCase().replace(/[.'’]/g, '').replace(/\s+/g, ' ').trim();
  const aliases = [
    ['mr'], ['mobile', 'cell', 'cellular', 'cell phone'],
    ['bengaluru', 'bangalore'], ['karnataka', 'ka'],
    ['be', 'bachelor of engineering', 'bachelor of engineering (be)'],
    ['immediate', 'immediately', 'available immediately', '0 days'],
    ['not disclosed', 'prefer not to say', 'decline to self-identify', 'decline to self identify'],
  ].find(group => group.includes(normalized(targetStr)));
  if (aliases) {
    const equivalent = options.filter(option => aliases.includes(normalized(option.label)) || aliases.includes(normalized(option.value)));
    if (equivalent.length === 1) return equivalent[0]!;
  }

  // 2. Boolean mapping (yes/no, true/false)
  if (targetValue === true || targetStr === 'yes' || targetStr === 'true') {
    const yesOpt = options.find(o => /^(?:yes|true)\b/i.test(o.label.trim()) || /^(?:yes|true)$/i.test(o.value.trim()));
    if (yesOpt) return yesOpt;
  }
  if (targetValue === false || targetStr === 'no' || targetStr === 'false') {
    const noOpt = options.find(o => /^(?:no|false)\b/i.test(o.label.trim()) || /^(?:no|false)$/i.test(o.value.trim()));
    if (noOpt) return noOpt;
  }

  // Unmatched options require review rather than selecting an arbitrary answer.
  return null;
}
