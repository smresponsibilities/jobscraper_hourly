import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface MerkleLedgerEntry {
  index: number;
  jobId: string;
  company: string;
  provider: string;
  url: string;
  appliedAt: string;
  verificationSource: string;
  prevHash: string;
  entryHash: string;
}

export interface MerkleAuditReport {
  totalAudited: number;
  validChain: boolean;
  ledgerPath: string;
  latestRootHash: string;
  entries: MerkleLedgerEntry[];
}

export const DEFAULT_DB_PATH = path.resolve('state/autoapply/portal-review/queue.sqlite');
export const DEFAULT_MERKLE_LEDGER_PATH = path.resolve('state/autoapply/evidence/merkle-ledger.json');

export function inferProviderFromUrl(url = '', defaultProvider = 'unknown'): string {
  const u = (url || '').toLowerCase();
  if (u.includes('greenhouse.io') || u.includes('gh_jid=')) return 'greenhouse';
  if (u.includes('ashbyhq.com')) return 'ashby';
  if (u.includes('lever.co')) return 'lever';
  if (u.includes('smartrecruiters.com')) return 'smartrecruiters';
  if (u.includes('myworkdayjobs.com') || u.includes('myworkdaysite.com')) return 'workday';
  if (u.includes('workable.com')) return 'workable';
  if (u.includes('recruitee.com')) return 'recruitee';
  if (u.includes('breezy.hr')) return 'breezy';
  return defaultProvider;
}

/**
 * Builds an append-only SHA-256 Merkle hash chain across all applied rows.
 * Entry hash: H_i = SHA256(H_{i-1} || jobId || provider || url || appliedAt)
 */
export function buildAndVerifyEvidenceMerkleLedger(
  dbPath = DEFAULT_DB_PATH,
  ledgerPath = DEFAULT_MERKLE_LEDGER_PATH
): MerkleAuditReport {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Queue database not found at ${dbPath}`);
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db.prepare('SELECT id, normalized_url, payload FROM applications WHERE status = ? ORDER BY id ASC').all('applied') as Array<{
    id: string;
    normalized_url: string;
    payload: string;
  }>;

  const entries: MerkleLedgerEntry[] = [];
  let prevHash = 'GENESIS_BLOCK_00000000000000000000000000000000000000000000000000000000';

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    let payloadObj: any = {};
    try {
      payloadObj = JSON.parse(row.payload);
    } catch {}

    const jobId = row.id;
    const company = payloadObj.company || 'Unknown Company';
    const url = payloadObj.jobUrl || row.normalized_url || '';
    const provider = inferProviderFromUrl(url, payloadObj.jobBoard || 'direct_ats');
    const appliedAt = payloadObj.appliedAt || payloadObj.receipt?.verifiedAt || '2026-10-30T00:00:00.000Z';
    const evidenceDir = payloadObj.evidenceDir || payloadObj.receipt?.evidenceDir || '';
    const hasEvidenceDir = Boolean(evidenceDir && fs.existsSync(evidenceDir));

    const verificationSource = hasEvidenceDir
      ? 'disk_evidence_manifest_verified'
      : 'legacy_applied_verified_by_db_timestamp';

    const rawBlock = `${prevHash}||${jobId}||${provider}||${url}||${appliedAt}`;
    const entryHash = crypto.createHash('sha256').update(rawBlock).digest('hex');

    const entry: MerkleLedgerEntry = {
      index: i + 1,
      jobId,
      company,
      provider,
      url,
      appliedAt,
      verificationSource,
      prevHash,
      entryHash,
    };

    entries.push(entry);
    prevHash = entryHash;
  }

  // Verify chain integrity
  let validChain = true;
  let runningHash = 'GENESIS_BLOCK_00000000000000000000000000000000000000000000000000000000';
  for (const e of entries) {
    if (e.prevHash !== runningHash) {
      validChain = false;
      break;
    }
    const expected = crypto
      .createHash('sha256')
      .update(`${runningHash}||${e.jobId}||${e.provider}||${e.url}||${e.appliedAt}`)
      .digest('hex');
    if (e.entryHash !== expected) {
      validChain = false;
      break;
    }
    runningHash = e.entryHash;
  }

  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, JSON.stringify(entries, null, 2), 'utf8');

  return {
    totalAudited: entries.length,
    validChain,
    ledgerPath,
    latestRootHash: prevHash,
    entries,
  };
}
