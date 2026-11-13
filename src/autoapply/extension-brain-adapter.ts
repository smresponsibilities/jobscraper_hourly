import path from 'node:path';
import type { CandidateExtendedProfile } from './types.js';
import { loadProfile } from './profile.js';
import { classifyAtsField } from './classifier.js';
import { resolveCandidateAnswer } from './answers.js';
import { recordExtensionHumanOverride, resolveExtensionFormFields } from './extension-answers.js';

export function resolveDomFieldsForExtensionBrain(fields: Array<{ id: string; name: string; label: string; type: string; options?: string[] }>, _jdText = '', options: { profile?: CandidateExtendedProfile; jobUrl?: string } = {}): Array<{ id: string; resolvedValue: string; factKey: string; confidence: number }> {
  let profile = options.profile;
  if (!profile) {
    try { profile = loadProfile(path.resolve('state/autoapply/portal-review/candidate.json')); }
    catch { return []; }
  }
  const url = options.jobUrl || 'https://extension.local/apply';
  const resolved = resolveExtensionFormFields(fields, profile, url);
  return resolved.flatMap(item => {
    const matches = fields.filter(field => (field.id || '') === item.id && (field.name || '') === item.name);
    if (matches.length !== 1) return [];
    const field = matches[0]!;
    const category = classifyAtsField(field).category;
    const answer = resolveCandidateAnswer(category, profile!, { url, question: field.label, aliases: [field.name || '', field.id || ''], fieldType: field.type, options: field.options });
    if (answer.value === undefined || String(answer.value) !== String(item.value) || !answer.sourceFactKeys.includes(item.factKey)) return [];
    return [{ id: item.id, resolvedValue: String(item.value), factKey: item.factKey, confidence: answer.confidence }];
  });
}

/** Store an owner correction for review; do not automatically promote it to a global fact. */
export function ingestHumanCorrectionFromExtension(correction: { questionLabel: string; humanValue: string; factKey: string }): { recorded: boolean } {
  if (!correction || typeof correction.questionLabel !== 'string' || typeof correction.humanValue !== 'string' || typeof correction.factKey !== 'string' || !correction.factKey.trim()) return { recorded: false };
  if (/\b(?:years?|yrs?)\b.*\bexperience\b|\bexperience\b.*\b(?:years?|yrs?)\b/i.test(correction.questionLabel)) {
    const years = /\b(\d+(?:\.\d+)?)\b/.exec(correction.humanValue);
    if (years && Number(years[1]) > 1) return { recorded: false };
  }
  return { recorded: recordExtensionHumanOverride(correction.questionLabel, correction.humanValue, correction.factKey).saved };
}
