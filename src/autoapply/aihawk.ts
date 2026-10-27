/**
 * AIHawk Autonomous Question Answering & Validation Recovery Engine.
 * Reverse-engineered from AIHawk (Auto_Jobs_Applier_AIHawk) open-source Playwright runner.
 */

import type { CandidateExtendedProfile } from './types.js';

export interface DynamicAnswerResult {
  value: string | boolean | number;
  confidence: number;
  reason: string;
}

/**
 * Resolves arbitrary ATS questions using AIHawk's heuristic rule engine.
 */
export function resolveDynamicQuestion(
  questionText: string,
  profile: CandidateExtendedProfile
): DynamicAnswerResult {
  const q = questionText.toLowerCase();

  // Check custom QA bank first
  if (profile.qaBank) {
    for (const [key, answer] of Object.entries(profile.qaBank)) {
      if (q.includes(key.toLowerCase())) {
        return { value: answer, confidence: 0.99, reason: 'qa_bank_match' };
      }
    }
  }

  // 1. Years of experience with a technology or skill
  const yoeMatch = q.match(/(?:how\s+many\s+)?years\s+of\s+(?:work\s+)?experience/i);
  if (yoeMatch) {
    const yoe = profile.professional.totalYearsExperience || 1;
    return { value: yoe, confidence: 0.88, reason: 'yoe_heuristic' };
  }

  // 2. Age confirmation (18+ or legal working age)
  if (/18\s+years\s+of\s+age|legal\s+working\s+age/i.test(q)) {
    return { value: true, confidence: 0.95, reason: 'age_confirmation' };
  }

  // 3. Background check / Drug test consent
  if (/background\s+(?:check|investigation)|drug\s+(?:screen|test)/i.test(q)) {
    return { value: true, confidence: 0.95, reason: 'background_consent' };
  }

  // 4. Essential job functions with/without accommodation
  if (/essential\s+functions|with\s+or\s+without\s+(?:reasonable\s+)?accommodation/i.test(q)) {
    return { value: true, confidence: 0.95, reason: 'essential_functions' };
  }

  // 5. Non-compete or restrictive covenants
  if (/non[_\-\s]?compete|restrictive\s+covenant|conflict\s+of\s+interest/i.test(q)) {
    const ans = profile.workAuthorization.hasNonCompete ? 'Yes' : 'No';
    return { value: ans, confidence: 0.92, reason: 'non_compete_check' };
  }

  // 6. Former employee / Intern
  if (/previously\s+(?:worked|employed)|former\s+employee|previous\s+intern/i.test(q)) {
    const ans = profile.workAuthorization.formerEmployee ? 'Yes' : 'No';
    return { value: ans, confidence: 0.92, reason: 'former_employee_check' };
  }

  // 7. Felony / Criminal history
  if (/convicted\s+of\s+a\s+felony|criminal\s+record|guilty\s+plea/i.test(q)) {
    return { value: 'No', confidence: 0.95, reason: 'criminal_history_negative' };
  }

  // 8. Work authorization in specific jurisdiction
  if (/authorized\s+to\s+work|eligible\s+for\s+employment/i.test(q)) {
    const ans = profile.workAuthorization.authorizedInCountry ? 'Yes' : 'No';
    return { value: ans, confidence: 0.95, reason: 'auth_jurisdiction' };
  }

  // 9. Visa sponsorship requirements
  if (/visa\s+sponsorship|require\s+sponsorship/i.test(q)) {
    const ans = profile.workAuthorization.requiresSponsorshipNowOrFuture ? 'Yes' : 'No';
    return { value: ans, confidence: 0.95, reason: 'sponsorship_check' };
  }

  // 10. Relocation willingness
  if (/relocate|open\s+to\s+relocation/i.test(q)) {
    const ans = profile.professional.willingToRelocate ? 'Yes' : 'No';
    return { value: ans, confidence: 0.90, reason: 'relocation_preference' };
  }

  // 11. Notice period / Availability
  if (/notice\s+period|how\s+soon\s+can\s+you\s+start|earliest\s+start/i.test(q)) {
    const days = profile.professional.noticePeriodDays;
    const text = days === 0 ? 'Immediately' : `${days} days`;
    return { value: text, confidence: 0.90, reason: 'notice_period' };
  }

  // 12. Salary / Compensation expectations
  if (/expected\s+(?:ctc|salary)|compensation\s+expectation|desired\s+pay/i.test(q)) {
    const sal = profile.professional.expectedSalary || 1200000;
    return { value: sal, confidence: 0.85, reason: 'salary_expectation' };
  }

  // 13. Discharged or asked to resign
  if (/discharged\s+or|asked\s+to\s+resign|terminated\s+for\s+cause/i.test(q)) {
    return { value: 'No', confidence: 0.95, reason: 'discharge_negative' };
  }

  // 14. Relatives or family members employed
  if (/relative[s]?\s+(?:currently\s+)?employed|family\s+member[s]?\s+working/i.test(q)) {
    return { value: 'No', confidence: 0.95, reason: 'relatives_employed_negative' };
  }

  // 15. Driver's license / reliable transportation
  if (/driver'?s?\s+licen[sc]e|reliable\s+transportation/i.test(q)) {
    return { value: 'Yes', confidence: 0.92, reason: 'transportation_affirmative' };
  }

  // 16. Travel willingness
  if (/willing\s+to\s+travel|travel\s+percentage/i.test(q)) {
    return { value: 'Yes', confidence: 0.90, reason: 'travel_willingness' };
  }

  // 17. Shifts or overtime availability
  if (/overtime|weekend\s+work|flexible\s+hours|shift[_\-\s]?work|\bshifts?\b/i.test(q)) {
    return { value: 'Yes', confidence: 0.90, reason: 'schedule_flexibility' };
  }

  // Default fallback
  return { value: 'Yes', confidence: 0.50, reason: 'default_affirmative_fallback' };
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

  // 1. Exact value or label match
  const exact = options.find(
    o => o.value.trim().toLowerCase() === targetStr || o.label.trim().toLowerCase() === targetStr
  );
  if (exact) return exact;

  // 2. Boolean mapping (yes/no, true/false)
  if (targetValue === true || targetStr === 'yes' || targetStr === 'true') {
    const yesOpt = options.find(o => /\byes\b|\btrue\b|\bauthorized\b/i.test(o.label || o.value));
    if (yesOpt) return yesOpt;
  }
  if (targetValue === false || targetStr === 'no' || targetStr === 'false') {
    const noOpt = options.find(o => /\bno\b|\bfalse\b|\bnot\b/i.test(o.label || o.value));
    if (noOpt) return noOpt;
  }

  // 3. Substring containment
  const sub = options.find(
    o => o.label.toLowerCase().includes(targetStr) || o.value.toLowerCase().includes(targetStr)
  );
  if (sub) return sub;

  // 4. Token overlap scoring
  const targetTokens = targetStr.split(/\s+/).filter(Boolean);
  let bestScore = 0;
  let bestOption: { value: string; label: string } | null = null;

  for (const opt of options) {
    const text = `${opt.label} ${opt.value}`.toLowerCase();
    let score = 0;
    for (const t of targetTokens) {
      if (text.includes(t)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestOption = opt;
    }
  }

  if (bestScore > 0 && bestOption) {
    return bestOption;
  }

  // Fallback to first non-empty option
  return options.find(o => Boolean(o.value)) || options[0] || null;
}
