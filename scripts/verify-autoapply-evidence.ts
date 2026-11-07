import path from 'node:path';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { verifyEvidenceBundle } from '../src/autoapply/evidence-verifier.js';
import { CredentialVault } from '../src/autoapply/vault.js';
import { loadProfile } from '../src/autoapply/profile.js';

const args = process.argv.slice(2);
const values = new Map<string, string>();
for (let index = 0; index < args.length; index += 2) {
  if (!['--receipt', '--vault', '--profile', '--requisition', '--state'].includes(args[index]!) || !args[index + 1] || args[index + 1]!.startsWith('--')) {
    throw new Error('Usage: --receipt <directory> [--vault <directory>] [--profile <candidate.json>] [--requisition <canonical-key>]');
  }
  values.set(args[index]!, args[index + 1]!);
}

if (values.has('--receipt')) {
  const result = verifyEvidenceBundle(path.resolve(values.get('--receipt')!), {
    vault: values.has('--vault') ? new CredentialVault(path.resolve(values.get('--vault')!)) : undefined,
    candidateEmail: values.has('--profile') ? loadProfile(values.get('--profile')!).personal.email : undefined,
    requisitionKey: values.get('--requisition')
  });
  console.log(JSON.stringify(result));
} else {
  const stateDir = path.resolve(values.get('--state') || 'state/autoapply/portal-review');
  const profileFile = path.resolve(values.get('--profile') || path.join(stateDir, 'candidate.json'));
  const profile = existsSync(profileFile) ? loadProfile(profileFile) : undefined;
  const vaultDir = path.join(stateDir, 'vault');
  const vault = existsSync(path.join(vaultDir, 'master.dpapi')) || process.env.AUTOAPPLY_VAULT_KEY ? new CredentialVault(vaultDir) : undefined;

  const dbPath = path.join(stateDir, 'queue.sqlite');
  const verifiedList: Array<{ jobId: string; company: string; proof?: any; error?: string }> = [];
  if (existsSync(dbPath)) {
    const database = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const rows = database.prepare("SELECT payload FROM applications WHERE status='applied'").all() as { payload: string }[];
      for (const row of rows) {
        const job = JSON.parse(String(row.payload));
        const evidenceDir = job.receipt?.domEvidenceDir || job.receipt?.evidenceDir;
        if (evidenceDir && existsSync(evidenceDir)) {
          try {
            const proof = verifyEvidenceBundle(evidenceDir, { vault, candidateEmail: profile?.personal.email });
            verifiedList.push({ jobId: job.id, company: job.company, proof });
          } catch (err: any) {
            verifiedList.push({ jobId: job.id, company: job.company, error: err.message });
          }
        }
      }
    } finally {
      database.close();
    }
  }
  console.log(JSON.stringify({ verifiedCount: verifiedList.filter(x => x.proof?.integrity).length, verifiedList }));
}
