import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { classifyAtsField } from './classifier.js';
import { resolveCandidateAnswer } from './answers.js';
import type { CandidateExtendedProfile } from './types.js';
import { loadProfile } from './profile.js';

function hasChallenge(value: unknown, seen = new Set<object>()): boolean {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return true;
  seen.add(value);
  for (const [key, entry] of Object.entries(value)) {
    if (/captcha|turnstile|challenge/i.test(key) && entry !== false && entry !== null && entry !== undefined && entry !== '') return true;
    if (typeof entry === 'object' && hasChallenge(entry, seen)) return true;
  }
  return false;
}

function factExists(profile: CandidateExtendedProfile, key: string): boolean {
  let current: unknown = profile;
  for (const part of key.split('.')) {
    if (!current || typeof current !== 'object' || !(part in current)) return false;
    current = (current as Record<string, unknown>)[part];
  }
  return current !== undefined && current !== null && current !== '';
}

/** Eligibility only. Submission still needs a verified provider-specific endpoint and receipt. */
export function canAttemptDirectHttpSubmit(url: string, schemaPayload: unknown, profile?: CandidateExtendedProfile): { eligible: boolean; provider: string; reason: string } {
  let provider = 'unknown';
  const fallback = () => ({ eligible: false, provider, reason: 'FALLBACK_TO_BROWSER_LANE' });
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || /^(?:stripe|avoca|ssctech|paypal)(?:[._-]|$)/i.test(host) || /^(?:stripe|avoca|ssctech|paypal)(?:[._-]|$)/i.test(parts[0] || '')) return fallback();
    if (/^[a-z0-9-]+\.recruitee\.com$/.test(host) && parts[0] === 'o' && parts[1]) provider = 'recruitee';
    else if (/^[a-z0-9-]+\.breezy\.hr$/.test(host) && parts[0] === 'p' && parts[1]) provider = 'breezy';
    else if (host === 'jobs.ashbyhq.com' && parts.length >= 2) provider = 'ashby';
    else return fallback();
    if (!schemaPayload || typeof schemaPayload !== 'object' || hasChallenge(schemaPayload)) return fallback();
    const questions = (schemaPayload as { questions?: unknown }).questions;
    if (!Array.isArray(questions)) return fallback();
    for (const question of questions) {
      if (!question || typeof question !== 'object' || typeof question.required !== 'boolean') return fallback();
      if (!question.required) continue;
      profile ||= loadProfile(path.resolve('state/autoapply/portal-review/candidate.json'));
      if (!profile || typeof question.label !== 'string' || !question.label.trim() || typeof question.name !== 'string' || !question.name.trim()) return fallback();
      const candidate = profile;
      const type = typeof question.type === 'string' ? question.type.toLowerCase() : 'text';
      // Selection values and uploads require provider-specific mappings, not labels alone.
      if (!['text', 'email', 'tel', 'url', 'number', 'textarea'].includes(type) || question.options != null) return fallback();
      const classification = classifyAtsField({ label: question.label, name: question.name, type });
      if (classification.category === 'unknown') return fallback();
      const answer = resolveCandidateAnswer(classification.category, candidate, { url, question: question.label, fieldType: type, country: candidate.personal.country });
      if (answer.value === undefined || answer.value === '' || !answer.sourceFactKeys.length || !answer.sourceFactKeys.every(key => factExists(candidate, key))) return fallback();
      if (type === 'number' && !/^-?\d+(?:\.\d+)?$/.test(String(answer.value))) return fallback();
    }
    return { eligible: true, provider, reason: 'ALL_REQUIRED_QUESTIONS_GROUNDED' };
  } catch { return fallback(); }
}

/** Construct a multipart body without allowing field names to inject headers. */
export function buildMultipartFormPayload(fields: Record<string, string>, resumePdfPath: string): { body: Buffer; contentTypeHeader: string } {
  const pdf = readFileSync(resumePdfPath);
  if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('Resume must be a PDF');
  const entries = Object.entries(fields);
  for (const [name, value] of entries) {
    if (!name || /[\x00-\x1f\x7f]/.test(name) || name === 'resume' || typeof value !== 'string') throw new Error('Invalid multipart field');
  }
  let boundary: string;
  do { boundary = `----autoapply-${randomBytes(18).toString('hex')}`; }
  while (pdf.includes(boundary) || entries.some(([name, value]) => name.includes(boundary) || value.includes(boundary)));
  const chunks: Buffer[] = [];
  for (const [name, value] of entries) {
    const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${escaped}"\r\n\r\n${value}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="resume"; filename="Shivam_Mahajan_Resume.pdf"\r\nContent-Type: application/pdf\r\n\r\n`), pdf, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentTypeHeader: `multipart/form-data; boundary=${boundary}` };
}
