import { buildAndVerifyEvidenceMerkleLedger } from '../src/autoapply/evidence-auditor.js';

function runAudit() {
  console.log('[EVIDENCE-AUDITOR] Starting Cryptographic Merkle Evidence Audit...');
  const report = buildAndVerifyEvidenceMerkleLedger();

  console.log(`[EVIDENCE-AUDITOR] Audited ${report.totalAudited} applied rows.`);
  console.log(`[EVIDENCE-AUDITOR] Ledger Path: ${report.ledgerPath}`);
  console.log(`[EVIDENCE-AUDITOR] Root Hash: ${report.latestRootHash}`);
  console.log(`[EVIDENCE-AUDITOR] Chain Integrity: ${report.validChain ? 'VALID ✔' : 'CORRUPTED ✖'}`);

  if (!report.validChain) {
    console.error('[EVIDENCE-AUDITOR FAIL] Merkle hash chain integrity check failed!');
    process.exit(1);
  }

  if (report.totalAudited < 250) {
    console.error(`[EVIDENCE-AUDITOR FAIL] Expected >= 250 applied jobs, found ${report.totalAudited}`);
    process.exit(1);
  }

  console.log('[TEST-GEN-539 PASS] Cryptographic Merkle Evidence Ledger built and verified.');
}

runAudit();
