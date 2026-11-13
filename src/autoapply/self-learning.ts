import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CandidateExtendedProfile } from './types.js';
import { classifyAtsField } from './classifier.js';
import { normalizeQuestion, profileFactValue, resolveCandidateAnswer, selectGroundedOptionFromDropdown } from './answers.js';
import { randomUUID } from 'node:crypto';

/** Read-only resolution; unknown facts remain unresolved. */
export function resolveHistoricalLedgerEntryGrounded(entry: { questionText?: string; label?: string; fieldType?: string; options?: string[]; isRequired?: boolean }, profile: CandidateExtendedProfile): { status: 'resolved' | 'excluded_malformed_or_noise' | 'skipped_optional_blank' | 'unresolved'; value?: string | boolean; factKey?: string; reason?: string } {
  const question = (entry.questionText || entry.label || '').trim();
  if (!question || question.length < 2 || /^(?:field|unknown|input|select|text|button|search|option|value|\d+|\W+)$/i.test(question) || /^[0-9a-f-]{16,}$/i.test(question)) return { status: 'excluded_malformed_or_noise', reason: 'non_question_ui_or_malformed' };
  if (entry.isRequired === false && profile.applicationPreferences?.skipOptionalQuestions?.some(value => normalizeQuestion(value) === normalizeQuestion(question))) return { status: 'skipped_optional_blank' };
  const options = entry.options || [];
  if (options.length) {
    const choice = selectGroundedOptionFromDropdown(question, options.map(option => ({ label: option, value: option })), profile);
    if (choice) return { status: 'resolved', value: choice.label, factKey: choice.factKey };
    return { status: 'unresolved' };
  }
  const fieldType = entry.fieldType || 'text';
  const classification = classifyAtsField({ label: question, name: question, type: fieldType });
  const answer = resolveCandidateAnswer(classification.category, profile, { url: 'https://neutral.invalid', question, fieldType });
  if (answer.value === undefined || answer.value === '') return { status: 'unresolved' };
  const factKey = answer.sourceFactKeys.find(key => {
    const value = profileFactValue(profile, key);
    return value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);
  });
  return factKey ? { status: 'resolved', value: typeof answer.value === 'boolean' ? answer.value : String(answer.value), factKey } : { status: 'unresolved', reason: 'missing_fact' };
}

export interface LearnedSemanticRule {
  normalizedQuestion: string;
  sampleRawQuestion: string;
  linkedCategory: string;
  resolvedValue: string;
  confidence: number;
  successCount: number;
  failureCount: number;
  lastUsedAt: string;
  lastVerifiedAt: string;
  factKey: string;
}

export interface UnknownFieldEntry {
  signature: string;
  questionText: string;
  widgetKind: string;
  isRequired: boolean;
  options: string[] | null;
  validationError: string | null;
  sectionHeading: string;
  occurrences: number;
  sampleCompanies: string[];
  sampleUrls: string[];
  firstSeenAt: string;
  lastSeenAt: string;
}

export const DEFAULT_MEMORY_PATH = path.resolve('state/autoapply/portal-review/semantic-memory.json');
export const DEFAULT_LEDGER_PATH = path.resolve('state/autoapply/portal-review/unknown-fields-ledger.json');

export function normalizeQuestionKey(q: string): string {
  return q
    .toLowerCase()
    .replace(/\*|\(required\)|required/gi, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function loadSemanticMemory(memoryPath = DEFAULT_MEMORY_PATH): Record<string, LearnedSemanticRule> {
  try {
    if (fs.existsSync(memoryPath)) {
      return JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
    }
  } catch {
    // Ignore corrupt file
  }
  return {};
}

export function computeUcb1RuleConfidence(
  rule: LearnedSemanticRule,
  totalTrials = 10,
  hasValidationError = false
): number {
  const S = Math.max(0, rule.successCount || 0);
  const F = Math.max(0, rule.failureCount || 0);
  const N = S + F;
  if (N === 0) return rule.confidence ?? 0.85;

  const exploitation = S / N;
  const exploration = 0.5 * Math.sqrt(Math.log(Math.max(2, totalTrials)) / N);
  const penalty = hasValidationError ? 0.4 : 0;

  const ucbScore = Math.max(0, Math.min(1.0, exploitation + exploration - penalty));
  return Math.round(ucbScore * 100) / 100;
}

export function recordRuleOutcome(
  questionText: string,
  success: boolean,
  factKey = '',
  isValidationError = false,
  memoryPath = DEFAULT_MEMORY_PATH
): void {
  const key = normalizeQuestionKey(questionText);
  if (!key || key.length < 3) return;
  const mem = loadSemanticMemory(memoryPath);
  const existing = mem[key];

  const now = new Date().toISOString();
  const S = (existing?.successCount ?? 0) + (success ? 1 : 0);
  const F = (existing?.failureCount ?? 0) + (!success || isValidationError ? 1 : 0);
  const total = Object.values(mem).reduce((acc, r) => acc + (r.successCount || 0) + (r.failureCount || 0), 0) + 1;

  const updated: LearnedSemanticRule = {
    normalizedQuestion: key,
    sampleRawQuestion: questionText.slice(0, 200),
    linkedCategory: existing?.linkedCategory || 'custom',
    resolvedValue: existing?.resolvedValue || '',
    successCount: S,
    failureCount: F,
    lastUsedAt: now,
    lastVerifiedAt: success ? now : (existing?.lastVerifiedAt || now),
    factKey: factKey || existing?.factKey || 'inferred.custom',
    confidence: 0.85,
  };

  updated.confidence = computeUcb1RuleConfidence(updated, total, isValidationError);

  if (!success || isValidationError || updated.confidence < 0.50) {
    updated.confidence = Math.min(0.49, updated.confidence);
  }

  mem[key] = updated;
  fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
  fs.writeFileSync(memoryPath, JSON.stringify(mem, null, 2), 'utf8');
}

export function synthesizeNewDeterministicRule(
  questionText: string,
  profile?: CandidateExtendedProfile,
  memoryPath = DEFAULT_MEMORY_PATH
): LearnedSemanticRule | null {
  const key = normalizeQuestionKey(questionText);
  if (!profile || key.length < 3) return null;
  try {
    const classification = classifyAtsField({ label: questionText });
    const answer = resolveCandidateAnswer(classification.category, profile, { url: 'https://neutral.invalid', question: questionText, fieldType: 'text' });
    if (classification.category === 'unknown' ? answer.reason !== 'explicit_profile' || answer.canonicalIntent !== 'total_experience' : classification.confidence < 0.9) return null;
    if (answer.value === undefined || answer.value === '' || answer.isEmployerSpecific || answer.sourceFactKeys.length !== 1) return null;
    const factKey = answer.sourceFactKeys[0]!;
    // Never persist identity, contact details, documents or context-scoped answers.
    if (/^(?:personal|documents|answers)(?:\.|$)/.test(factKey)) return null;
    let fact: unknown = profile;
    for (const part of factKey.split('.')) {
      if (!fact || typeof fact !== 'object' || !(part in fact)) return null;
      fact = (fact as Record<string, unknown>)[part];
    }
    if (!['string', 'number', 'boolean'].includes(typeof fact) || String(fact) !== String(answer.value)) return null;
    const now = new Date().toISOString();
    const rule: LearnedSemanticRule = {
      normalizedQuestion: key, sampleRawQuestion: questionText.slice(0, 200), linkedCategory: answer.canonicalIntent,
      resolvedValue: String(answer.value), confidence: answer.confidence, successCount: 0, failureCount: 0,
      lastUsedAt: now, lastVerifiedAt: '', factKey,
    };
    let memory: Record<string, LearnedSemanticRule> = {};
    if (fs.existsSync(memoryPath)) {
      const parsed: unknown = JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      memory = parsed as Record<string, LearnedSemanticRule>;
    }
    memory[key] = rule;
    fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
    const temporary = `${memoryPath}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(memory, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, memoryPath);
    } finally { try { fs.unlinkSync(temporary); } catch {} }
    return rule;
  } catch { return null; }
}

export function recordLearnedSuccess(
  questionText: string,
  linkedCategory: string,
  resolvedValue: string,
  confidence = 0.85,
  memoryPath = DEFAULT_MEMORY_PATH
): void {
  const key = normalizeQuestionKey(questionText);
  if (!key || key.length < 3) return;
  const mem = loadSemanticMemory(memoryPath);
  const existing = mem[key];
  mem[key] = {
    normalizedQuestion: key,
    sampleRawQuestion: questionText.slice(0, 200),
    linkedCategory,
    resolvedValue,
    confidence: Math.min(1.0, (existing?.confidence ?? confidence) + 0.05),
    successCount: (existing?.successCount ?? 0) + 1,
    failureCount: existing?.failureCount ?? 0,
    lastUsedAt: new Date().toISOString(),
    lastVerifiedAt: new Date().toISOString(),
    factKey: existing?.factKey || 'inferred.success',
  };
  fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
  fs.writeFileSync(memoryPath, JSON.stringify(mem, null, 2), 'utf8');
}

/**
 * Ticket GEN-462: Self-Pruning Confidence Decay on Validation Failure.
 * Decrements confidence by 0.25 when a learned field fails validation (:invalid / aria-invalid).
 * Deletes rule completely if confidence drops below 0.50.
 */
export function penalizeLearnedRuleOnValidationFailure(
  questionText: string,
  memoryPath = DEFAULT_MEMORY_PATH
): { key: string; action: 'decayed' | 'pruned' | 'not_found'; confidence?: number } {
  const targetKey = normalizeQuestionKey(questionText);
  if (!targetKey) return { key: targetKey, action: 'not_found' };

  const mem = loadSemanticMemory(memoryPath);
  let matchedKey = targetKey;
  if (!mem[matchedKey]) {
    const foundKey = Object.keys(mem).find(
      k => k === targetKey || normalizeQuestionKey(mem[k]?.sampleRawQuestion || '') === targetKey
    );
    if (foundKey) matchedKey = foundKey;
  }

  const existing = mem[matchedKey];
  if (!existing) return { key: targetKey, action: 'not_found' };

  const newConfidence = Math.round((existing.confidence - 0.25) * 100) / 100;
  if (newConfidence < 0.50) {
    delete mem[matchedKey];
    fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
    fs.writeFileSync(memoryPath, JSON.stringify(mem, null, 2), 'utf8');
    return { key: matchedKey, action: 'pruned', confidence: newConfidence };
  } else {
    existing.confidence = newConfidence;
    existing.lastUsedAt = new Date().toISOString();
    mem[matchedKey] = existing;
    fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
    fs.writeFileSync(memoryPath, JSON.stringify(mem, null, 2), 'utf8');
    return { key: matchedKey, action: 'decayed', confidence: newConfidence };
  }
}

export function logUnknownFieldForLearning(
  entry: {
    questionText: string;
    widgetKind: string;
    isRequired: boolean;
    options?: string[] | null;
    validationError?: string | null;
    sectionHeading?: string;
    company: string;
    url: string;
  },
  ledgerPath = DEFAULT_LEDGER_PATH
): void {
  const normKey = normalizeQuestionKey(entry.questionText);
  if (!normKey || normKey.length < 2) return;
  const key = `${normKey}::${entry.widgetKind}`;
  let ledger: Record<string, UnknownFieldEntry> = {};
  try {
    if (fs.existsSync(ledgerPath)) {
      ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    }
  } catch {
    ledger = {};
  }
  const now = new Date().toISOString();
  const existing = ledger[key];
  if (existing) {
    existing.occurrences += 1;
    existing.lastSeenAt = now;
    if (entry.validationError && !existing.validationError) {
      existing.validationError = entry.validationError;
    }
    if (entry.options?.length && !existing.options?.length) {
      existing.options = entry.options.slice(0, 25);
    }
    if (!existing.sampleCompanies.includes(entry.company) && existing.sampleCompanies.length < 10) {
      existing.sampleCompanies.push(entry.company);
    }
    if (!existing.sampleUrls.includes(entry.url) && existing.sampleUrls.length < 5) {
      existing.sampleUrls.push(entry.url);
    }
  } else {
    ledger[key] = {
      signature: key,
      questionText: entry.questionText.slice(0, 300),
      widgetKind: entry.widgetKind,
      isRequired: entry.isRequired,
      options: entry.options ? entry.options.slice(0, 25) : null,
      validationError: entry.validationError || null,
      sectionHeading: entry.sectionHeading || '',
      occurrences: 1,
      sampleCompanies: [entry.company],
      sampleUrls: [entry.url],
      firstSeenAt: now,
      lastSeenAt: now,
    };
  }
  // Sort ledger by occurrences descending so highest-impact gaps are always at the top
  const sorted = Object.fromEntries(
    Object.entries(ledger).sort((a, b) => b[1].occurrences - a[1].occurrences)
  );
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, JSON.stringify(sorted, null, 2), 'utf8');
}

/**
 * 1. Bottom-Up Option-Signature Inference:
 * Identifies what a dropdown/radio question is asking purely from the shape of its options[]!
 */
export function inferAnswerFromOptionSignature(
  questionText: string,
  options: string[]
): { category: string; value: string } | null {
  // Option labels alone do not establish a candidate fact.
  return null;
}

/**
 * 2. Top-Down Semantic Concept Linker & Validation Error Self-Healer:
 * Links custom question phrasings (like Onit, Brevo, custom Workday prompts) to verified candidate facts.
 */
export function resolveBySemanticSelfLearning(
  questionText: string,
  widgetKind: string,
  options: string[] | null,
  validationError: string | null,
  profile: CandidateExtendedProfile,
  memoryPath = DEFAULT_MEMORY_PATH
): { category: string; value: string; confidence: number } | null {
  // Legacy memory has no employer/requisition provenance and may invent facts.
  return null;
}

export function resolveOvernightLearnedQuestions(
  rawQuestion: string,
  widgetKind: string,
  options: string[] | null,
  profile: any
): string | null {
  // Legacy overnight rules contain unverified candidate-specific defaults.
  return null;
}

export interface VerifiedAcceptedAnswer {
  jobUrl: string;
  questionText: string;
  answer: string;
  widgetKind?: string;
  sectionHeading?: string;
  recordedAt: string;
}

export const VERIFIED_ACCEPTED_ANSWERS_PATH = path.resolve('state/autoapply/verified-accepted-answers.json');

export function lookupVerifiedAcceptedAnswer(
  questionText: string,
  filePath = VERIFIED_ACCEPTED_ANSWERS_PATH
): string | null {
  if (!questionText) return null;
  try {
    if (!fs.existsSync(filePath)) return null;
    const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const key = normalizeQuestionKey(questionText);
    if (key && existing[key]?.answer !== undefined && existing[key]?.answer !== null) {
      return String(existing[key].answer);
    }
  } catch {}
  return null;
}

export function recordVerifiedAcceptedApplicationAnswers(
  jobUrl: string,
  entries: Array<{ questionText: string; answer: string; widgetKind?: string; sectionHeading?: string }>,
  filePath = VERIFIED_ACCEPTED_ANSWERS_PATH
): void {
  if (!entries || entries.length === 0) return;
  try {
    let existing: Record<string, VerifiedAcceptedAnswer> = {};
    if (fs.existsSync(filePath)) {
      try {
        existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch {
        existing = {};
      }
    }
    const now = new Date().toISOString();
    for (const entry of entries) {
      if (!entry.questionText || entry.answer === undefined || entry.answer === null) continue;
      const key = normalizeQuestionKey(entry.questionText);
      if (!key || key.length < 2) continue;
      existing[key] = {
        jobUrl,
        questionText: entry.questionText.slice(0, 300),
        answer: String(entry.answer).slice(0, 500),
        widgetKind: entry.widgetKind,
        sectionHeading: entry.sectionHeading,
        recordedAt: now,
      };
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf8');
  } catch {
    // Non-fatal recording error
  }
}
