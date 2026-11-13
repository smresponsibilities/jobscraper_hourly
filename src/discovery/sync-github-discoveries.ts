import { evaluateRoleEligibilityForCandidate } from './india-gcc-filter.js';
import { computeRoleDedupSignature, isDuplicateAppliedRoleWithinWindow } from '../autoapply/role-dedup-shield.js';
import { computeJobSurvivalPriorityScore } from '../autoapply/survival-priority-scorer.js';
import { identifyApplicationAts } from '../autoapply/wizard.js';
import { isSupportedDirectAtsJobUrl } from '../autoapply/preflight.js';

export function filterAndDeduplicateDiscoveredJobs(rawJobs: Array<{ title: string; company: string; location: string; url: string; publishedAt?: string; jdText?: string }>, existingAppliedSignatures: Map<string, number>): Array<{ url: string; company: string; title: string; location: string; provider: string; priorityScore: number }> {
  const candidates: Array<{ url: string; company: string; title: string; location: string; provider: string; priorityScore: number; signature: string; urlKey: string }> = [];
  for (const job of rawJobs || []) {
    if (!job || typeof job.title !== 'string' || !job.title.trim() || typeof job.company !== 'string' || !job.company.trim() || typeof job.location !== 'string' || typeof job.url !== 'string' || !URL.canParse(job.url)) continue;
    const url = new URL(job.url);
    if (url.protocol !== 'https:' || url.username || url.password || !isSupportedDirectAtsJobUrl(url.href)) continue;
    if (!evaluateRoleEligibilityForCandidate(job).eligible) continue;
    const signature = computeRoleDedupSignature(job.company, job.title, job.location);
    if (!signature || isDuplicateAppliedRoleWithinWindow(signature, existingAppliedSignatures)) continue;
    const provider = identifyApplicationAts(url.href);
    const priorityScore = computeJobSurvivalPriorityScore({ provider, location: job.location, publishedAt: job.publishedAt }).totalScore;
    const key = `${url.origin}${url.pathname}`.toLowerCase();
    candidates.push({ url: url.href, company: job.company, title: job.title, location: job.location, provider, priorityScore, signature, urlKey: key });
  }
  const seenUrls = new Set<string>(), seenRoles = new Set<string>();
  return candidates.sort((a, b) => b.priorityScore - a.priorityScore).filter(candidate => {
    if (seenUrls.has(candidate.urlKey) || seenRoles.has(candidate.signature)) return false;
    seenUrls.add(candidate.urlKey); seenRoles.add(candidate.signature);
    return true;
  }).map(({ signature: _signature, urlKey: _urlKey, ...job }) => job);
}
