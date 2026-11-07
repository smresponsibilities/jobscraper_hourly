import type { AutoaplyJobItem } from './types.js';
import { canonicalRequisition } from './identity.js';
import { verifyEvidenceBundle } from './evidence-verifier.js';
import type { CredentialVault } from './vault.js';

export const ACCEPTANCE_PROVIDERS = ['workday', 'greenhouse', 'lever', 'ashby'] as const;

/** Live-production counts require signed, raw-network-verifiable, zero-handoff proof. */
export function auditAcceptance(jobs: AutoaplyJobItem[], candidateEmail: string, vault?: CredentialVault, target = 50) {
  if (!Number.isInteger(target) || target < 1) throw new Error('Acceptance target must be a positive integer');
  const seen = new Set<string>(); const applications = new Set<string>();
  const byProvider: Record<string, number> = Object.fromEntries(ACCEPTANCE_PROVIDERS.map(provider => [provider, 0]));
  const excluded: Array<{ jobId: string; reason: string }> = [];
  const verified: Array<{ jobId: string; requisitionKey: string; provider: string; evidenceDir: string }> = [];
  for (const job of jobs.filter(job => job.status === 'applied')) {
    const identity = canonicalRequisition(job.jobUrl, job.externalJobId);
    if (!identity || !ACCEPTANCE_PROVIDERS.includes(identity.provider as typeof ACCEPTANCE_PROVIDERS[number]) || !job.receipt?.evidenceDir || job.receipt.existing) { excluded.push({ jobId: job.id, reason: 'no_new_supported_application_proof' }); continue; }
    if (seen.has(identity.key)) { excluded.push({ jobId: job.id, reason: 'duplicate_requisition' }); continue; }
    try {
      const proof = verifyEvidenceBundle(job.receipt.domEvidenceDir || job.receipt.evidenceDir, { vault, candidateEmail, requisitionKey: identity.key });
      if (!proof.authenticated || !proof.autonomous || !proof.networkVerified || !proof.publicEndpoint || proof.existing || proof.provider !== identity.provider) { excluded.push({ jobId: job.id, reason: 'not_signed_autonomous_live_network_proof' }); continue; }
      const application = proof.applicationId ? `${proof.provider}:${proof.applicationId}` : undefined;
      if (application && applications.has(application)) { excluded.push({ jobId: job.id, reason: 'duplicate_employer_application' }); continue; }
      seen.add(identity.key); if (application) applications.add(application);
      byProvider[identity.provider]!++;
      verified.push({ jobId: job.id, requisitionKey: identity.key, provider: identity.provider, evidenceDir: job.receipt.domEvidenceDir || job.receipt.evidenceDir });
    } catch { excluded.push({ jobId: job.id, reason: 'evidence_verification_failed' }); }
  }
  return { target, verifiedCount: verified.length, byProvider, complete: verified.length >= target && ACCEPTANCE_PROVIDERS.every(provider => byProvider[provider]! > 0), verified, excluded };
}
