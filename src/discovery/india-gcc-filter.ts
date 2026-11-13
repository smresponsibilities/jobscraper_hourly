import { extractYears } from '../classify.js';
import { exceedsExperienceGate } from '../autoapply/preflight.js';
import { evaluateCandidateJobFit, NON_TECH_TITLE_REGEX } from '../autoapply/candidate-fit-filter.js';
import { isStrictlyIsolatedTenant } from '../autoapply/priority-scheduler.js';

export type LocationTier = 'BENGALURU_LOCAL' | 'INDIA_HUB' | 'GLOBAL_REMOTE' | 'INELIGIBLE_GEO';

/** Discovery filter only; live eligibility still requires source preflight. */
export function evaluateRoleEligibilityForCandidate(job: { title: string; location: string; jdText?: string; company?: string; url?: string }): { eligible: boolean; locationTier: LocationTier; maxYoeDetected: number | null; reason: string } {
  const title = String(job.title || '').trim();
  const location = String(job.location || '').trim();
  const description = String(job.jdText || '');
  const minimum = extractYears(`${title}\n${description}`).min;
  const local = /\b(?:bengaluru|bangalore|karnataka)\b/i.test(location);
  const india = /\b(?:india|hyderabad|pune|mumbai|gurgaon|gurugram|noida|chennai|delhi)\b/i.test(location);
  const restricted = /\b(?:us only|u\.s\. only|united states only|europe only|eu only|uk only|must (?:be|reside|work) (?:in|within) (?:the )?(?:us|united states|eu|europe|uk))\b/i.test(`${location} ${description}`);
  const global = /\b(?:worldwide|anywhere|global(?:ly)?(?: remote)?|remote worldwide)\b/i.test(location) && !restricted;
  const locationTier: LocationTier = local ? 'BENGALURU_LOCAL' : india ? 'INDIA_HUB' : global ? 'GLOBAL_REMOTE' : 'INELIGIBLE_GEO';
  const result = (eligible: boolean, reason: string) => ({ eligible, locationTier, maxYoeDetected: minimum, reason });
  if (isStrictlyIsolatedTenant(job.company || '', job.url || '')) return result(false, 'ISOLATED_TENANT');
  if (!title || NON_TECH_TITLE_REGEX.test(title) || /\b(?:driver|sales representative|account executive|nurse)\b/i.test(title) || !/\b(?:software|engineer|developer|programmer|sde|swe|data|machine learning|devops|platform|backend|frontend|full.stack|security|cloud|android|technical|technology apprentice)\b/i.test(title)) return result(false, 'NON_TECH_TITLE');
  if (/\b(?:senior|sr\.?|staff|principal|director|lead|manager|architect)\b/i.test(title) || (minimum !== null && minimum > 3) || exceedsExperienceGate(description, title)) return result(false, 'EXCEEDS_3_YOE');
  if (locationTier === 'INELIGIBLE_GEO' || restricted || !evaluateCandidateJobFit({ title, location, company: job.company, url: job.url }).allowed) return result(false, 'INELIGIBLE_GEO');
  return result(true, 'ELIGIBLE_REQUIRES_SOURCE_PREFLIGHT');
}
