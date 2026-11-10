// src/autoapply/inbox-lifecycle-tracker.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ImapFlow } from 'imapflow';
import { loadDotEnvIntoProcess } from './env-credentials.js';

export type LifecycleStage =
  | 'INTERVIEW_OR_OA_INVITE'
  | 'RECRUITER_DIRECT_REPLY'
  | 'APPLICATION_REJECTED'
  | 'HARD_BOUNCE_550'
  | 'APPLICATION_CONFIRMATION';

export interface InboxLifecycleEvent {
  messageId: string;
  date: string;
  fromAddress: string;
  fromDomain: string;
  subject: string;
  stage: LifecycleStage;
  bouncedRecipient?: string;
  company?: string;
  snippet: string;
}

export const DEFAULT_LIFECYCLE_PATH = path.resolve('state/autoapply/portal-review/inbox-lifecycle-events.json');

export function classifyEmailLifecycleStage(params: {
  fromAddress: string;
  subject: string;
  bodyText: string;
}): { stage: LifecycleStage; bouncedRecipient?: string } | null {
  const from = (params.fromAddress || '').toLowerCase();
  const sub = (params.subject || '').toLowerCase();
  const rawBody = params.bodyText || '';
  const combined = `${sub} ${rawBody.slice(0, 3000).toLowerCase()}`;

  // 1. Hard Bounce (550 / Mailer-Daemon)
  if (/mailer-daemon|postmaster|delivery status notification|undeliverable/i.test(from + ' ' + sub)) {
    if (/550 |address not found|user unknown|does not exist|delivery incomplete|undeliverable|mailbox unavailable|recipient address rejected/i.test(combined)) {
      // Find recipient address mentioned as recipient/destination
      const recipientMatch = rawBody.match(/(?:for|to|recipient|diagnostic-code)[:\s]+<?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/i)
        || rawBody.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      return { stage: 'HARD_BOUNCE_550', bouncedRecipient: recipientMatch?.[1]?.toLowerCase() };
    }
  }

  // 2. Direct Reply to Cold Outreach ("Re: Applied for...")
  if (/^re:\s*applied for/i.test(params.subject.trim()) && !/no-?reply|mailer-daemon|notifications?/i.test(from)) {
    return { stage: 'RECRUITER_DIRECT_REPLY' };
  }

  // 3. Interview or Online Assessment (HackerRank / CodeSignal / Calendly)
  if (
    /\b(hackerrank|codesignal|codility|testgorilla|hirevue|karat|online assessment|coding assessment|coding challenge|technical assessment|invitation to interview|schedule an interview|interview availability|calendly\.com|goodtime\.io|next steps in our hiring process)\b/i.test(
      combined
    ) &&
    !/\b(unfortunately|not moving forward|will not be proceeding|pursue other candidates)\b/i.test(combined)
  ) {
    return { stage: 'INTERVIEW_OR_OA_INVITE' };
  }

  // 4. Rejection Email
  if (
    /\b(unfortunately|not moving forward|decided not to proceed|will not be proceeding|pursue other candidates|not selected for|unable to offer you|position has been filled)\b/i.test(
      combined
    )
  ) {
    return { stage: 'APPLICATION_REJECTED' };
  }

  // 5. Application Confirmation Receipt
  if (/\b(thank you for applying|thanks for applying|application received|received your application|application confirmation|we have received your resume)\b/i.test(combined)) {
    return { stage: 'APPLICATION_CONFIRMATION' };
  }

  return null;
}

export function loadInboxLifecycleEvents(filePath = DEFAULT_LIFECYCLE_PATH): InboxLifecycleEvent[] {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {}
  return [];
}

export function saveInboxLifecycleEvents(events: InboxLifecycleEvent[], filePath = DEFAULT_LIFECYCLE_PATH): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(events.slice(0, 500), null, 2), 'utf8');
  } catch {}
}

export async function syncInboxLifecycleEvents(maxMessages = 40, filePath = DEFAULT_LIFECYCLE_PATH): Promise<InboxLifecycleEvent[]> {
  loadDotEnvIntoProcess();
  const host = process.env.IMAP_HOST || 'imap.gmail.com';
  const user = process.env.IMAP_USER || process.env.AUTOAPPLY_EMAIL || '';
  const pass = process.env.IMAP_PASSWORD || process.env.GMAIL_APP_PASSWORD || '';
  if (!user || !pass) return loadInboxLifecycleEvents(filePath);

  const existing = loadInboxLifecycleEvents(filePath);
  const seenIds = new Set(existing.map((e) => e.messageId));

  const client = new ImapFlow({
    host,
    port: Number(process.env.IMAP_PORT || 993),
    secure: true,
    auth: { user, pass },
    logger: false,
  });
  client.on('error', () => {});

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const total = client.mailbox ? client.mailbox.exists : 0;
      if (total > 0) {
        const startSeq = Math.max(1, total - maxMessages);
        for await (const msg of client.fetch(`${startSeq}:*`, { envelope: true, source: true })) {
          const dateObj = msg.envelope?.date ? new Date(msg.envelope.date) : new Date();
          const dateIso = dateObj.toISOString();
          const msgId = msg.envelope?.messageId || `seq_${msg.seq}_${dateIso}`;
          if (seenIds.has(msgId)) continue;

          const fromAddr = (msg.envelope?.from?.[0]?.address || '').toLowerCase();
          const fromDomain = fromAddr.includes('@') ? fromAddr.split('@')[1] || '' : '';
          const subject = msg.envelope?.subject || '';
          const rawText = (msg.source ? msg.source.toString('utf8') : '')
            .replace(/=\r?\n/g, '')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ');

          const classified = classifyEmailLifecycleStage({
            fromAddress: fromAddr,
            subject,
            bodyText: rawText,
          });

          if (classified) {
            existing.unshift({
              messageId: msgId,
              date: dateIso,
              fromAddress: fromAddr,
              fromDomain,
              subject: subject.slice(0, 180),
              stage: classified.stage,
              bouncedRecipient: classified.bouncedRecipient,
              snippet: rawText.slice(0, 240).trim(),
            });
            seenIds.add(msgId);
          }
        }
      }
    } finally {
      lock.release();
    }
    await client.logout().catch(() => {});
  } catch {
    try {
      client.close();
    } catch {}
  }

  const trimmed = existing.slice(0, 500);
  saveInboxLifecycleEvents(trimmed, filePath);
  return trimmed;
}
