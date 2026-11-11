import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CandidateExtendedProfile } from './types.js';

export interface LearnedSemanticRule {
  normalizedQuestion: string;
  sampleRawQuestion: string;
  linkedCategory: string;
  resolvedValue: string;
  confidence: number;
  successCount: number;
  lastUsedAt: string;
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
    lastUsedAt: new Date().toISOString(),
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
