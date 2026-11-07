import { matchingProfileSkills } from './prepare.js';
import type { AutoaplyJobItem, CandidateExtendedProfile } from './types.js';

/** Ranking only. This score never establishes eligibility or changes candidate facts. */
export function applicationFit(job: Pick<AutoaplyJobItem, 'title' | 'description' | 'postedAt'>, profile: CandidateExtendedProfile, now = Date.now()): number {
  const skills = [...new Set((profile.skills || []).filter(skill => skill.trim()).map(skill => skill.toLowerCase()))];
  const overlap = skills.length ? matchingProfileSkills(skills, `${job.title}\n${job.description || ''}`).length / skills.length : 0;
  const title = /\b(?:software engineer|sde\s*1|swe|backend|back[- ]end|full[- ]stack|data|machine learning|ml|developer)\b/i.test(job.title) ? 30 : 0;
  const age = now - Date.parse(job.postedAt);
  const freshness = Number.isFinite(age) && age >= 0 ? Math.max(0, 10 * (1 - age / (30 * 86400000))) : 0;
  return Math.round(60 * overlap + title + freshness);
}
