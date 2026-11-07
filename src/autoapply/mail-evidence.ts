import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ATS_MAIL_DOMAINS, type ApplicationMail, type ApplicationMailbox, type VerificationRequest } from './mailbox.js';
import { sha256 } from './submission.js';
import type { BotRunReport } from './types.js';
import type { AutoaplyJobItem } from './types.js';
import { canonicalEmployerKey } from './identity.js';
import { normalizeQuestion } from './answers.js';

export function mailNeedsRequisitionId(job: AutoaplyJobItem, jobs: readonly AutoaplyJobItem[]): boolean {
  return jobs.some(other => other.id !== job.id && canonicalEmployerKey(other.jobUrl, other.externalJobId) === canonicalEmployerKey(job.jobUrl, job.externalJobId)
    && normalizeQuestion(other.title) === normalizeQuestion(job.title) && !['skipped', 'failed'].includes(other.status));
}

/** Durable ownership prevents the same email being consumed by different jobs. */
export class MailClaims {
  private database: DatabaseSync;
  constructor(file: string) {
    this.database = new DatabaseSync(file);
    this.database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS mail_claims (message_id TEXT PRIMARY KEY, application_key TEXT NOT NULL)');
  }
  claim(messageId: string, applicationKey: string): boolean {
    this.database.prepare('INSERT OR IGNORE INTO mail_claims VALUES (?,?)').run(messageId, applicationKey);
    return (this.database.prepare('SELECT application_key FROM mail_claims WHERE message_id=?').get(messageId) as { application_key: string }).application_key === applicationKey;
  }
  close(): void { this.database.close(); }
}

export function confirmationFromMail(mail: ApplicationMail, request: VerificationRequest & { title: string; requisitionId?: string; requireRequisitionId?: boolean }): BotRunReport['receipt'] {
  const domains = ATS_MAIL_DOMAINS[request.provider] || [];
  const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const text = `${mail.subject}\n${mail.text}`;
  const plain = ` ${norm(text)} `;
  if (!mail.authenticated || !mail.to.some(email => email.toLowerCase() === request.recipient.toLowerCase()) || !Number.isFinite(Date.parse(mail.receivedAt)) || Date.parse(mail.receivedAt) < request.since.getTime()) return;
  if (!mail.from.some(email => domains.some(domain => email.toLowerCase().endsWith('@' + domain) || email.toLowerCase().split('@')[1]?.endsWith('.' + domain)))) return;
  if (!/thank you for (?:applying|your application)|(?:received|submitted) your application|application (?:has been |was )?(?:successfully )?(?:received|submitted)/i.test(text)) return;
  const company = norm(request.company || '');
  if (company.length < 2 || !plain.includes(` ${company} `)) return;
  const title = norm(request.title);
  const exactTitle = title.length >= 5 && plain.includes(` ${title} `);
  const id = request.requisitionId;
  const exactId = id && id.length >= 4 && new RegExp(`(?:^|[^a-z0-9-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9-])`, 'i').test(text);
  if (request.requireRequisitionId ? !exactId : !exactTitle && !exactId) return;
  if (request.claim && !request.claim(mail.id)) return;
  return { url: request.applicationUrl, text: 'Authenticated employer email confirms receipt for this role', verifiedAt: new Date().toISOString(), selector: 'email:authenticated-role-confirmation', emailConfirmationId: mail.id };
}

export async function reconcileConfirmation(mailbox: ApplicationMailbox, request: VerificationRequest & { title: string; requisitionId?: string; requireRequisitionId?: boolean }, sessionDir: string): Promise<BotRunReport['receipt']> {
  const domains = ATS_MAIL_DOMAINS[request.provider];
  if (!domains) return;
  const messages = await mailbox.messagesSince(request.since, domains);
  for (const mail of messages) {
    const receipt = confirmationFromMail(mail, request);
    if (!receipt) continue;
    const directory = path.join(sessionDir, 'receipts', `email_${Date.now()}_${randomUUID()}`);
    mkdirSync(directory, { recursive: true });
    const data = JSON.stringify({ proof: 'EMAIL_RECONCILED', receipt, candidateEmail: request.recipient, company: request.company, title: request.title, requisitionId: request.requisitionId, receivedAt: mail.receivedAt, messageHash: sha256(JSON.stringify(mail)) }, null, 2);
    writeFileSync(path.join(directory, 'receipt.json'), data, { flag: 'wx', mode: 0o600 });
    writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ algorithm: 'SHA-256', files: { 'receipt.json': sha256(data) } }), { flag: 'wx', mode: 0o600 });
    receipt.evidenceDir = directory;
    return receipt;
  }
}
