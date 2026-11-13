import { normalizeCompanyRoleSignature } from './priority-scheduler.js';

export function computeRoleDedupSignature(company: string, jobTitle: string, _location?: string): string {
  if (!company?.trim() || !jobTitle?.trim()) return '';
  const signature = normalizeCompanyRoleSignature(company, jobTitle);
  return signature.startsWith('::') || signature.endsWith('::') ? '' : signature;
}

export function isDuplicateAppliedRoleWithinWindow(signature: string, appliedSignaturesMap: Map<string, number>, windowDays = 30, nowMs = Date.now()): boolean {
  if (!signature || !appliedSignaturesMap.has(signature)) return false;
  const appliedAt = appliedSignaturesMap.get(signature)!;
  if (!Number.isFinite(appliedAt) || !Number.isFinite(nowMs) || !Number.isFinite(windowDays) || windowDays < 0) return true;
  return nowMs - appliedAt <= windowDays * 86_400_000;
}
