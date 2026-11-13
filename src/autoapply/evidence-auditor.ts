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

/** Verify the stored chain without rewriting it or asserting receipt authenticity. */
export function verifyStoredEvidenceMerkleLedger(ledgerPath = DEFAULT_MERKLE_LEDGER_PATH): boolean {
  try {
    const entries: unknown = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    if (!Array.isArray(entries) || entries.length === 0) return false;
    let previous = 'GENESIS_BLOCK_00000000000000000000000000000000000000000000000000000000';
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i] as Partial<MerkleLedgerEntry>;
      if (!entry || entry.index !== i + 1 || entry.prevHash !== previous || !entry.jobId || !entry.provider || !entry.url || !entry.appliedAt || typeof entry.entryHash !== 'string') return false;
      const hash = crypto.createHash('sha256').update(`${previous}||${entry.jobId}||${entry.provider}||${entry.url}||${entry.appliedAt}`).digest('hex');
      if (entry.entryHash !== hash) return false;
      previous = hash;
    }
    return true;
  } catch { return false; }
}

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
  let rows: Array<{ id: string; normalized_url: string; payload: string }>;
  try { rows = db.prepare('SELECT id, normalized_url, payload FROM applications WHERE status = ? ORDER BY id ASC').all('applied') as typeof rows; }
  finally { db.close(); }

  const entries: MerkleLedgerEntry[] = [];
  let prevHash = 'GENESIS_BLOCK_00000000000000000000000000000000000000000000000000000000';

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    let payloadObj: any = {};
    try {
      payloadObj = JSON.parse(row.payload);
    } catch { throw new Error(`Invalid payload for ${row.id}`); }

    const jobId = row.id;
    const company = payloadObj.company || 'Unknown Company';
    const url = payloadObj.jobUrl || row.normalized_url || '';
    const provider = inferProviderFromUrl(url, payloadObj.jobBoard || 'direct_ats');
    const appliedAt = payloadObj.appliedAt || payloadObj.receipt?.verifiedAt;
    if (typeof appliedAt !== 'string' || !Number.isFinite(Date.parse(appliedAt))) throw new Error(`Missing application timestamp for ${jobId}`);
    const evidenceDir = payloadObj.evidenceDir || payloadObj.receipt?.evidenceDir || '';
    const hasEvidenceDir = Boolean(evidenceDir && fs.existsSync(evidenceDir));

    const verificationSource = hasEvidenceDir
      ? 'evidence_directory_present_unverified'
      : 'queue_timestamp_unverified';

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
  let validChain = entries.length > 0;
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

  if (fs.existsSync(ledgerPath)) {
    const prior: unknown = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    if (!Array.isArray(prior) || prior.length > entries.length || prior.some((entry, index) => JSON.stringify(entry) !== JSON.stringify(entries[index]))) throw new Error('Existing evidence ledger cannot be rewritten');
    if (prior.length === entries.length) return { totalAudited: entries.length, validChain, ledgerPath, latestRootHash: prevHash, entries };
  }
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const temporary = `${ledgerPath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(entries, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, ledgerPath);
  } finally { try { fs.unlinkSync(temporary); } catch {} }

  return {
    totalAudited: entries.length,
    validChain,
    ledgerPath,
    latestRootHash: prevHash,
    entries,
  };
}
