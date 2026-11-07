import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { manifestPayload } from './evidence.js';
import { sha256 } from './submission.js';
import { submissionConfirmation, type SubmissionExchange } from './network-proof.js';
import type { CredentialVault } from './vault.js';
import type { BotRunReport } from './types.js';

/** Independently decrypt and re-parse captured responses; never trust a proof label. */
export function verifyEvidenceBundle(directory: string, options: { vault?: CredentialVault; candidateEmail?: string; requisitionKey?: string } = {}): { integrity: true; authenticated: boolean; autonomous: boolean; networkVerified: boolean; publicEndpoint: boolean; provider?: string; applicationId?: string; existing?: boolean } {
  const root = realpathSync(directory);
  const manifestStat = lstatSync(path.join(root, 'manifest.json'));
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 1024 * 1024) throw new Error('Invalid evidence manifest file');
  const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest.algorithm !== 'SHA-256' || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) throw new Error('Invalid evidence manifest');
  const names = Object.keys(manifest.files);
  if (names.length > 128) throw new Error('Evidence manifest exceeds supported file count');
  for (const name of names) {
    if (!name || name !== path.basename(name) || /[\\/:]/.test(name) || name === 'manifest.json' || !/^[a-f0-9]{64}$/.test(manifest.files[name])) throw new Error('Unsafe evidence manifest entry');
    const file = path.join(root, name);
    const stat = lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 64 * 1024 * 1024 || path.dirname(realpathSync(file)) !== root || sha256(readFileSync(file)) !== manifest.files[name]) throw new Error('Evidence file hash mismatch');
  }
  if (readdirSync(root).some(name => name !== 'manifest.json' && !names.includes(name))) throw new Error('Unmanifested evidence file');
  if (!names.includes('receipt.json') || !names.includes('submitted_payload.json')) throw new Error('Incomplete application evidence');
  const authenticated = !!options.vault && manifest.signature?.algorithm === 'HMAC-SHA256' && options.vault.verifyEvidence(manifestPayload(manifest.files), manifest.signature.value);
  if (manifest.signature && !authenticated) throw new Error('Evidence signature could not be verified');
  const receipt = JSON.parse(readFileSync(path.join(root, 'receipt.json'), 'utf8')) as { autonomous?: boolean; applicationUrl: string; candidateEmail: string; requisition?: { key: string; provider: string }; submission?: BotRunReport['submission']; receipt: BotRunReport['receipt'] };
  const autonomous = receipt.autonomous === true;
  if (options.candidateEmail && receipt.candidateEmail.toLowerCase() !== options.candidateEmail.toLowerCase()) throw new Error('Evidence candidate mismatch');
  if (options.requisitionKey && receipt.requisition?.key !== options.requisitionKey) throw new Error('Evidence requisition mismatch');
  const encrypted = names.includes('network.json.encrypted');
  if (!encrypted && !names.includes('network.json')) return { integrity: true, authenticated, autonomous, networkVerified: false, publicEndpoint: false };
  if (encrypted && !options.vault) throw new Error('Encrypted network evidence requires its local vault');
  const raw = readFileSync(path.join(root, encrypted ? 'network.json.encrypted' : 'network.json'), 'utf8');
  const exchanges: SubmissionExchange[] = JSON.parse(encrypted ? options.vault!.openEvidence(receipt.requisition?.key || receipt.applicationUrl, raw) : raw);
  if (!Array.isArray(exchanges)) throw new Error('Invalid network evidence');
  for (const exchange of exchanges) {
    const confirmation = submissionConfirmation(exchange);
    if (!confirmation) continue;
    if (typeof exchange.request.payloadBase64 !== 'string' || sha256(Buffer.from(exchange.request.payloadBase64, 'base64')) !== exchange.request.payloadHash) throw new Error('Captured request payload hash mismatch');
    const bodyHash = exchange.response.bodyAvailable ? sha256(Buffer.from(exchange.response.bodyBase64, 'base64')) : undefined;
    const record = receipt.submission?.requests.find(request => request.url === exchange.request.url && request.method === 'POST' && request.payloadHash === exchange.request.payloadHash && request.status === exchange.response.status && request.headersHash === sha256(JSON.stringify(exchange.response.headers)) && request.responseHash === bodyHash);
    if (!record || receipt.requisition && receipt.requisition.provider !== confirmation.provider || receipt.receipt?.applicationId && confirmation.applicationId && receipt.receipt.applicationId !== confirmation.applicationId) continue;
    if (!names.includes('confirmation.html') || !names.includes('confirmation.png')) throw new Error('Network receipt lacks visual evidence');
    return { integrity: true, authenticated, autonomous, networkVerified: true, publicEndpoint: new URL(exchange.request.url).protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(exchange.request.url).hostname), ...confirmation };
  }
  return { integrity: true, authenticated, autonomous, networkVerified: false, publicEndpoint: false };
}

