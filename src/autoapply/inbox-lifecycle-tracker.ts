// src/autoapply/inbox-lifecycle-tracker.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { loadDotEnvIntoProcess } from './env-credentials.js';
import { withSingleFlightImapLock } from './imap-multiplexer.js';
import { extractOaAndInterviewSignalsFromEmail, type InboxSignalCategory } from '../outreach/oa-interview-extractor.js';
import { saveInterviewSchedulingDrafts } from '../outreach/interview-drafts.js';

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
  signalCategory?: InboxSignalCategory;
  actionUrls?: string[];
  platform?: string | null;
  deadlineHint?: string | null;
}

export const DEFAULT_LIFECYCLE_PATH = path.resolve('state/autoapply/portal-review/inbox-lifecycle-events.json');
export const DEFAULT_QUEUE_DB_PATH = path.resolve('state/autoapply/portal-review/queue.sqlite');

export function classifyEmailLifecycleStage(params: {
  fromAddress: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  inReplyTo?: string;
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

  const signal = extractOaAndInterviewSignalsFromEmail({ subject: params.subject, from: params.fromAddress, bodyText: params.bodyText, bodyHtml: params.bodyHtml });
  if (signal.category === 'OA_ASSESSMENT' || signal.category === 'INTERVIEW_INVITE') return { stage: 'INTERVIEW_OR_OA_INVITE' };

  // 2. Direct Reply to Cold Outreach ("Re: Applied for..." or In-Reply-To header)
  if (
    (Boolean(params.inReplyTo) || /^re:\s*applied for/i.test(params.subject.trim())) &&
    !/no-?reply|mailer-daemon|notifications?/i.test(from)
  ) {
    return { stage: 'RECRUITER_DIRECT_REPLY' };
  }

  // 3. Interview or Online Assessment (HackerRank / CodeSignal / Calendly)
  if (
    /\b(hackerrank|codesignal|codility|testgorilla|hirevue|karat|online assessment|coding assessment|coding challenge|technical assessment|invitation to interview|schedule an interview|interview availability|calendly\.com|goodtime\.io|next steps in our hiring process)\b/i.test(
      combined
    ) &&
    !/\b(unfortunately|not moving forward|will not be proceeding|other candidates|pursue other candidates)\b/i.test(combined)
  ) {
    return { stage: 'INTERVIEW_OR_OA_INVITE' };
  }

  // 4. Rejection Email
  if (
    /\b(unfortunately|not moving forward|decided not to proceed|will not be proceeding|other candidates|pursue other candidates|not selected for|unable to offer you|position has been filled)\b/i.test(
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

export function crossMatchLifecycleEventsWithQueue(
  events: InboxLifecycleEvent[],
  dbPath = DEFAULT_QUEUE_DB_PATH
): InboxLifecycleEvent[] {
  if (!fs.existsSync(dbPath)) return events;

  interface AppliedEmployer {
    company: string;
    domain: string;
    slug: string;
  }
  const employers: AppliedEmployer[] = [];

  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      db.exec('PRAGMA busy_timeout = 5000;');
      const rows = db.prepare("SELECT normalized_url, payload FROM applications WHERE status = 'applied'").all() as Array<{
        normalized_url: string;
        payload: string;
      }>;
      const seenComp = new Set<string>();
      for (const r of rows) {
        let comp = '';
        try {
          const p = JSON.parse(r.payload || '{}');
          comp = (p.company || '').trim();
        } catch {}
        let domain = '';
        let slug = '';
        try {
          const u = new URL(r.normalized_url);
          const host = u.hostname.toLowerCase();
          if (!/(?:greenhouse\.io|ashbyhq\.com|lever\.co|myworkdayjobs\.com|smartrecruiters\.com|workable\.com)$/i.test(host)) {
            domain = host.replace(/^www\./, '');
          }
          const parts = u.pathname.split('/').filter(Boolean);
          slug = (parts[0] || '').toLowerCase();
        } catch {}

        if (comp && !seenComp.has(comp.toLowerCase())) {
          seenComp.add(comp.toLowerCase());
          employers.push({
            company: comp,
            domain,
            slug,
          });
        }
      }
    } finally {
      try { db.close(); } catch {}
    }
  } catch {}

  if (employers.length === 0) return events;

  return events.map((ev) => {
    if (ev.company && ev.company.trim()) return ev;

    const fromDom = (ev.fromDomain || '').toLowerCase();
    const fromAddr = (ev.fromAddress || '').toLowerCase();
    const sub = (ev.subject || '').toLowerCase();
    const snip = (ev.snippet || '').toLowerCase();

    for (const emp of employers) {
      const cLower = emp.company.toLowerCase();
      // Match 1: direct employer domain match
      if (emp.domain && fromDom && (fromDom === emp.domain || fromDom.endsWith('.' + emp.domain))) {
        return { ...ev, company: emp.company };
      }
      // Match 2: company slug in fromDomain or fromAddress
      if (emp.slug && emp.slug.length >= 3 && (fromDom.includes(emp.slug) || fromAddr.includes(emp.slug))) {
        return { ...ev, company: emp.company };
      }
      // Match 3: Company name in subject or snippet
      if (cLower.length >= 3) {
        const wordBoundary = new RegExp(`\\b${cLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (wordBoundary.test(sub) || wordBoundary.test(snip)) {
          return { ...ev, company: emp.company };
        }
      }
    }

    return ev;
  });
}

export function loadInboxLifecycleEvents(filePath = DEFAULT_LIFECYCLE_PATH, autoEnrich = true): InboxLifecycleEvent[] {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed: InboxLifecycleEvent[] = JSON.parse(content);
      if (Array.isArray(parsed)) {
        if (autoEnrich && parsed.some((e) => !e.company)) {
          const enriched = crossMatchLifecycleEventsWithQueue(parsed);
          saveInboxLifecycleEvents(enriched, filePath);
          return enriched;
        }
        return parsed;
      }
    }
  } catch {}
  return [];
}

export function saveInboxLifecycleEvents(events: InboxLifecycleEvent[], filePath = DEFAULT_LIFECYCLE_PATH): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(events.slice(0, 500), null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch {}
}

export async function syncInboxLifecycleEvents(maxMessages = 50, filePath = DEFAULT_LIFECYCLE_PATH): Promise<InboxLifecycleEvent[]> {
  return withSingleFlightImapLock('inbox-lifecycle', () => syncInboxLifecycleEventsUnlocked(maxMessages, filePath));
}

async function syncInboxLifecycleEventsUnlocked(maxMessages: number, filePath: string): Promise<InboxLifecycleEvent[]> {
  loadDotEnvIntoProcess();
  const host = process.env.IMAP_HOST || 'imap.gmail.com';
  const user = process.env.IMAP_USER || process.env.AUTOAPPLY_EMAIL || '';
  const pass = process.env.IMAP_PASSWORD || process.env.GMAIL_APP_PASSWORD || '';
  if (!user || !pass) return loadInboxLifecycleEvents(filePath);

  const existing = loadInboxLifecycleEvents(filePath, false);
  const seenIds = new Set(existing.map((e) => e.messageId));
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

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
          if (dateObj < sevenDaysAgo) continue;

          const dateIso = dateObj.toISOString();
          const msgId = msg.envelope?.messageId || `seq_${msg.seq}_${dateIso}`;
          if (seenIds.has(msgId)) continue;

          const fromAddr = (msg.envelope?.from?.[0]?.address || '').toLowerCase();
          const fromDomain = fromAddr.includes('@') ? fromAddr.split('@')[1] || '' : '';
          const subject = msg.envelope?.subject || '';
          const inReplyTo = (msg.envelope as any)?.inReplyTo || undefined;
          const rawMime = msg.source ? msg.source.toString('utf8') : '';
          const headerSplit = rawMime.indexOf('\r\n\r\n') > -1 ? rawMime.indexOf('\r\n\r\n') + 4 : rawMime.indexOf('\n\n') > -1 ? rawMime.indexOf('\n\n') + 2 : 0;
          const bodyOnly = rawMime.slice(headerSplit) || rawMime;
          const fallbackText = bodyOnly
            .replace(/=\r?\n/g, '')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ');
          const parsed = await simpleParser(rawMime).catch(() => null);
          const rawText = parsed?.text || fallbackText;
          const html = typeof parsed?.html === 'string' ? parsed.html : undefined;
          const signal = extractOaAndInterviewSignalsFromEmail({ subject, from: fromAddr, bodyText: rawText, bodyHtml: html });

          const classified = classifyEmailLifecycleStage({
            fromAddress: fromAddr,
            subject,
            bodyText: rawText,
            bodyHtml: html,
            inReplyTo,
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
              signalCategory: signal.category,
              actionUrls: signal.actionUrls,
              platform: signal.platform,
              deadlineHint: signal.deadlineHint,
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

  const enriched = crossMatchLifecycleEventsWithQueue(existing.slice(0, 500));
  saveInboxLifecycleEvents(enriched, filePath);
  saveInterviewSchedulingDrafts(enriched);
  return enriched;
}
