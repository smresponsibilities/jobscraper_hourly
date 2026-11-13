import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CandidateExtendedProfile } from './types.js';
import { isStrictlyIsolatedTenant } from './priority-scheduler.js';
import { classifyAtsField } from './classifier.js';
import { normalizeQuestion, resolveCandidateAnswer } from './answers.js';
import { computeFormSchemaHash, lookupCachedFieldResolution } from './template-fingerprint-cache.js';
import { lookupQuestionIn1000Bank } from './portal-question-bank-1000.js';

export { resolveCandidateAnswer } from './answers.js';
export { classifyAtsField } from './classifier.js';

type ExtensionField = { id?: string; name?: string; label: string; type?: string; placeholder?: string; options?: string[] };
export function resolveExtensionFormFields(fields: ExtensionField[], profile?: CandidateExtendedProfile, jobUrl = 'https://extension.local/apply'): Array<{ id: string; name: string; value: string | boolean; source: string; factKey: string }> {
  if (!profile || isStrictlyIsolatedTenant('', jobUrl)) return [];
  const schemaHash = computeFormSchemaHash('extension', fields.map(f => ({ ...f, type: f.type || 'text' })));
  return fields.flatMap(field => {
    if (/^(?:password|file|hidden)$/i.test(field.type || '')) return [];
    const classification = classifyAtsField(field);
    const answer = resolveCandidateAnswer(classification.category, profile, { url: jobUrl, question: field.label, aliases: [field.name || '', field.id || '', field.placeholder || ''], fieldType: field.type, options: field.options });
    if (answer.value === undefined || answer.value === '' || !answer.sourceFactKeys.length) return [];
    const value = typeof answer.value === 'boolean' ? answer.value : String(answer.value);
    const cached = lookupCachedFieldResolution(schemaHash, field.name || field.id || field.label);
    const bank = lookupQuestionIn1000Bank(field.label, field.type);
    const source = cached && cached.factKey === answer.sourceFactKeys[0] && cached.resolvedValue === String(value) ? 'verified_schema_cache' : bank === String(value) ? 'profile_and_question_bank' : answer.reason;
    return [{ id: field.id || '', name: field.name || '', value, source, factKey: answer.sourceFactKeys[0]! }];
  });
}

/** Human overrides are stored for review; they do not become global facts automatically. */
export function recordExtensionHumanOverride(question: string, value: string, factKey = 'qaBank.extensionOverride'): { saved: boolean; normalizedKey: string } {
  const normalizedKey = normalizeQuestion(question);
  if (!normalizedKey || !value.trim() || !factKey.trim()) return { saved: false, normalizedKey };
  const file = path.resolve('state/autoapply/portal-review/extension-overrides.json');
  const lock = `${file}.lock`;
  let temporary = '';
  let lockFd: number | undefined;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    lockFd = fs.openSync(lock, 'wx', 0o600);
    const entries: unknown = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
    if (!Array.isArray(entries)) return { saved: false, normalizedKey };
    entries.push({ question, value, factKey, recordedAt: new Date().toISOString() });
    temporary = `${file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(entries, null, 2), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
    return { saved: true, normalizedKey };
  } catch { return { saved: false, normalizedKey }; }
  finally {
    if (temporary) try { fs.unlinkSync(temporary); } catch {}
    if (lockFd !== undefined) {
      try { fs.closeSync(lockFd); } catch {}
      try { fs.unlinkSync(lock); } catch {}
    }
  }
}
