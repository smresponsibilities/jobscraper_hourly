import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { loadProfile } from '../src/autoapply/profile.js';
import { CredentialVault } from '../src/autoapply/vault.js';
import { auditAcceptance } from '../src/autoapply/acceptance.js';
import type { AutoaplyJobItem } from '../src/autoapply/types.js';

try { process.loadEnvFile(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const args = process.argv.slice(2); const values = new Map<string, string>();
for (let index = 0; index < args.length; index += 2) {
  if (!['--state', '--profile', '--target'].includes(args[index]!) || !args[index + 1] || args[index + 1]!.startsWith('--')) throw new Error('Usage: --state <directory> --profile <candidate.json> [--target 50]');
  values.set(args[index]!, args[index + 1]!);
}
if (!values.has('--state') || !values.has('--profile')) throw new Error('--state and --profile are required');
const root = path.resolve(values.get('--state')!);
const profile = loadProfile(values.get('--profile')!);
const candidateId = createHash('sha256').update(profile.personal.email.trim().toLowerCase()).digest('hex').slice(0, 20);
const database = new DatabaseSync(path.join(root, 'queue.sqlite'), { readOnly: true });
let jobs: AutoaplyJobItem[];
try {
  const metadata = database.prepare('SELECT value FROM metadata WHERE key=?').get('candidate') as { value: string } | undefined;
  if (metadata?.value !== candidateId) throw new Error('Queue belongs to another candidate');
  jobs = database.prepare('SELECT payload FROM applications WHERE candidate_id=?').all(candidateId).map(row => JSON.parse(String(row.payload)));
} finally { database.close(); }
const directory = path.join(root, 'vault');
const vault = existsSync(path.join(directory, 'master.dpapi')) || process.env.AUTOAPPLY_VAULT_KEY ? new CredentialVault(directory) : undefined;
const report = auditAcceptance(jobs, profile.personal.email, vault, Number(values.get('--target') || 50));
const target = path.join(root, 'production-acceptance.json');
const temporary = target + '.' + process.pid + '.tmp';
writeFileSync(temporary, JSON.stringify({ auditedAt: new Date().toISOString(), candidateId, ...report }, null, 2), { mode: 0o600 }); renameSync(temporary, target);
console.log(JSON.stringify({ target: report.target, verifiedCount: report.verifiedCount, byProvider: report.byProvider, complete: report.complete, excluded: report.excluded.length }));
