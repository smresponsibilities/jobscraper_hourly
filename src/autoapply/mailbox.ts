import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

export interface ApplicationMail {
  id: string;
  from: string[];
  to: string[];
  receivedAt: string;
  subject: string;
  text: string;
  html?: string;
  authenticated: boolean;
}

export interface ApplicationMailbox {
  messagesSince(since: Date, senders: string[]): Promise<ApplicationMail[]>;
  close(): Promise<void>;
}

export class MailboxAuthenticationError extends Error {
  constructor() { super('Mailbox authentication failed; review IMAP credentials before retrying'); this.name = 'MailboxAuthenticationError'; }
}

export const ATS_MAIL_DOMAINS: Record<string, string[]> = {
  greenhouse: ['greenhouse.io', 'greenhouse-mail.io'],
  ashby: ['ashbyhq.com'],
  lever: ['hire.lever.co', 'lever.co'],
  workday: ['myworkday.com', 'myworkdaysite.com', 'myworkdayjobs.com', 'otp.workday.com'],
  icims: ['icims.com'],
};

function senderMatches(address: string, permitted: string[]): boolean {
  const normalized = address.toLowerCase();
  const domain = normalized.slice(normalized.lastIndexOf('@') + 1);
  return permitted.some(value => value.includes('@') ? normalized === value.toLowerCase() : domain === value.toLowerCase() || domain.endsWith(`.${value.toLowerCase()}`));
}

/** Read-only TLS IMAP. Logging is disabled so credentials and OTPs never enter logs. */
export class ImapMailbox implements ApplicationMailbox {
  private client: ImapFlow;
  private ready = false;
  private pending: Promise<unknown> = Promise.resolve();
  private authenticationFailed = false;

  constructor(config: { host: string; user: string; password: string; port?: number }) {
    if (!config.host || !config.user || !config.password) throw new Error('IMAP_HOST, IMAP_USER and IMAP_PASSWORD are required');
    this.client = new ImapFlow({ host: config.host, port: config.port || 993, secure: true, auth: { user: config.user, pass: config.password }, logger: false, connectionTimeout: 15000, greetingTimeout: 15000 });
    this.client.on('error', () => {
      this.ready = false;
    });
  }

  messagesSince(since: Date, senders: string[]): Promise<ApplicationMail[]> {
    const operation = this.pending.then(() => this.read(since, senders));
    this.pending = operation.catch(() => {});
    return operation;
  }

  private async read(since: Date, senders: string[]): Promise<ApplicationMail[]> {
    if (!senders.length || !Number.isFinite(since.getTime())) throw new Error('Mail search requires a valid start time and sender allowlist');
    if (this.authenticationFailed) throw new MailboxAuthenticationError();
    try {
      if (!this.ready) {
        await this.client.connect();
        this.ready = true;
      }
      const folders = await this.client.list();
      const paths = new Set(['INBOX', ...folders.filter(folder => ['\\All', '\\Junk'].includes(folder.specialUse || '') || ['[Gmail]/All Mail', '[Gmail]/Spam'].includes(folder.path)).map(folder => folder.path)]);
      const messages = new Map<string, ApplicationMail>();
      for (const folder of paths) {
        await this.client.mailboxOpen(folder, { readOnly: true });
        const found = await this.client.search({ since, or: senders.map(from => ({ from })) }, { uid: true });
        const ids = found || [];
        for (let offset = 0; offset < ids.length; offset += 50) {
          for await (const message of this.client.fetch(ids.slice(offset, offset + 50), { source: true, internalDate: true, envelope: true }, { uid: true })) {
            if (!message.source || !message.internalDate || new Date(message.internalDate).getTime() < since.getTime()) continue;
            const parsed = await simpleParser(message.source);
            const addresses = (entry: typeof parsed.to) => (Array.isArray(entry) ? entry.flatMap(value => value.value) : entry?.value || []).map(value => value.address || '').filter(Boolean);
            const from = addresses(parsed.from);
            if (!from.some(address => senderMatches(address, senders))) continue;
            const authentication = parsed.headerLines.find(line => line.key === 'authentication-results')?.line || '';
            const signer = /dkim=pass[\s\S]{0,600}?header\.(?:d|i)=@?([a-z0-9.-]+)/i.exec(authentication)?.[1];
            const authenticated = /^Authentication-Results:\s*mx\.google\.com;/i.test(authentication) && !!signer && senderMatches(`verified@${signer}`, senders);
            const id = parsed.messageId || `imap:${folder}:${message.uid}`;
            messages.set(id, { id, from, to: addresses(parsed.to), receivedAt: new Date(message.internalDate).toISOString(), subject: parsed.subject || '', text: parsed.text || '', html: typeof parsed.html === 'string' ? parsed.html : undefined, authenticated });
          }
        }
      }
      return [...messages.values()];
    } catch (error) {
      this.ready = false;
      if (error && typeof error === 'object' && 'authenticationFailed' in error && error.authenticationFailed === true) {
        this.authenticationFailed = true;
        throw new MailboxAuthenticationError();
      }
      // Server diagnostics may contain addresses, tokens or credentials.
      throw new Error('Read-only mailbox request failed');
    }
  }

  async close(): Promise<void> {
    await this.pending;
    await this.client.logout().catch(() => {});
    this.ready = false;
  }
}

/** Mailpit is the local SMTP/HTTP integration fixture, never a public inbox proxy. */
export class MailpitMailbox implements ApplicationMailbox {
  constructor(private base: string) {
    const url = new URL(base);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Mailpit must use a loopback HTTP address');
  }
  async messagesSince(since: Date, senders: string[]): Promise<ApplicationMail[]> {
    const response = await fetch(new URL('/api/v1/messages', this.base), { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Local Mailpit list failed');
    const list = await response.json() as { messages?: Array<{ ID: string; Created: string }> };
    const messages: ApplicationMail[] = [];
    for (const entry of (list.messages || []).filter(entry => Date.parse(entry.Created) >= since.getTime()).slice(0, 50)) {
      const detail = await fetch(new URL(`/api/v1/message/${encodeURIComponent(entry.ID)}`, this.base), { signal: AbortSignal.timeout(5000) });
      if (!detail.ok) continue;
      const mail = await detail.json() as { MessageID?: string; From?: { Address?: string }; To?: Array<{ Address?: string }>; Created?: string; Subject?: string; Text?: string; HTML?: string };
      const from = [mail.From?.Address || ''];
      if (!from.some(address => senderMatches(address, senders))) continue;
      messages.push({ id: mail.MessageID || entry.ID, from, to: (mail.To || []).map(value => value.Address || ''), receivedAt: mail.Created || entry.Created, subject: mail.Subject || '', text: mail.Text || '', html: mail.HTML, authenticated: true });
    }
    return messages;
  }
  async close(): Promise<void> {}
}

export interface VerificationRequest {
  provider: string;
  recipient: string;
  since: Date;
  applicationUrl: string;
  company?: string;
  claim?: (messageId: string) => boolean;
  purpose?: 'verification' | 'password_reset';
}

export function verificationFromMail(mail: ApplicationMail, request: VerificationRequest): { messageId: string; code?: string; activationUrl?: string } | undefined {
  const allowed = ATS_MAIL_DOMAINS[request.provider] || [];
  if (!mail.authenticated || !mail.from.some(address => senderMatches(address, allowed)) || !mail.to.some(address => address.toLowerCase() === request.recipient.toLowerCase()) || !Number.isFinite(Date.parse(mail.receivedAt)) || Date.parse(mail.receivedAt) < request.since.getTime()) return undefined;
  const text = `${mail.subject}\n${mail.text}`;
  const reset = /reset[\s\S]{0,40}password|password[\s\S]{0,40}reset/i.test(text);
  if (request.purpose === 'password_reset' ? !reset : reset || !/verif|security code|one.time|activate|confirmation code/i.test(text)) return undefined;
  let companyMatches = true;
  if (request.company) {
    const company = request.company.toLowerCase().replace(/[^a-z0-9]/g, '');
    companyMatches = company.length >= 3 && text.toLowerCase().replace(/[^a-z0-9]/g, '').includes(company);
  }
  const code = /\b(?:code(?:\s+is)?|otp)\s*[:=\-]?\s*([A-Z0-9]{6,8})\b/i.exec(text)?.[1];
  if (companyMatches && code && (/\d/.test(code) || code === code.toUpperCase())) return { messageId: mail.id, code };
  const origin = new URL(request.applicationUrl);
  for (const match of `${mail.text}\n${mail.html || ''}`.matchAll(/https:\/\/[^\s<>"']+/g)) {
    try {
      const url = new URL(match[0].replace(/&amp;/g, '&'));
      const permittedPath = request.purpose === 'password_reset' ? /reset|forgot|password/i.test(url.pathname) : /verif|activat|confirm|authenticate/i.test(url.pathname);
      const tenantBoundWorkday = request.provider === 'workday' && /\.myworkdayjobs\.com$/i.test(origin.hostname);
      if (url.hostname === origin.hostname && permittedPath && (companyMatches || tenantBoundWorkday)) return { messageId: mail.id, activationUrl: url.href };
    } catch { /* An invalid link is not an activation authority. */ }
  }
  return undefined;
}

export async function findVerification(mailbox: ApplicationMailbox, request: VerificationRequest): Promise<ReturnType<typeof verificationFromMail>> {
  const senders = ATS_MAIL_DOMAINS[request.provider];
  if (!senders) return undefined;
  const messages = await mailbox.messagesSince(request.since, senders);
  return messages.sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt)).map(mail => verificationFromMail(mail, request)).find(result => !!result && (!request.claim || request.claim(result.messageId)));
}

export function mailboxFromEnvironment(): ApplicationMailbox | undefined {
  if (process.env.AUTOAPPLY_MAILPIT_URL) return new MailpitMailbox(process.env.AUTOAPPLY_MAILPIT_URL);
  if (!process.env.IMAP_HOST || !process.env.IMAP_USER || !process.env.IMAP_PASSWORD) return undefined;
  return new ImapMailbox({ host: process.env.IMAP_HOST, port: Number(process.env.IMAP_PORT || 993), user: process.env.IMAP_USER, password: process.env.IMAP_PASSWORD });
}
