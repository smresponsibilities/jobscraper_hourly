import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { InboxLifecycleEvent } from '../autoapply/inbox-lifecycle-tracker.js';
import { composeInterviewSchedulingReplyDraft } from './oa-interview-extractor.js';

export const INTERVIEW_DRAFTS_PATH = path.resolve('state/outreach/interview-drafts.json');

/** Create drafts once, preserving any prior human edits. Never sends mail. */
export function saveInterviewSchedulingDrafts(events: InboxLifecycleEvent[], filePath = INTERVIEW_DRAFTS_PATH): void {
  const candidates = events.filter(event => event.signalCategory === 'INTERVIEW_INVITE' && event.messageId && event.fromAddress);
  if (!candidates.length) return;
  let drafts: Array<{ messageId: string; [key: string]: unknown }> = [];
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lockPath = `${filePath}.lock`;
  const lockFd = fs.openSync(lockPath, 'wx', 0o600);
  try {
    if (fs.existsSync(filePath)) {
      const existing: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!Array.isArray(existing)) throw new Error('Interview drafts must be an array');
      drafts = existing;
    }
    const seen = new Set(drafts.map(draft => draft.messageId));
    let changed = false;
    for (const event of candidates) {
      if (seen.has(event.messageId)) continue;
      const draft = composeInterviewSchedulingReplyDraft({ companyName: event.company || '', jobTitle: '', extractedSchedulingUrl: event.actionUrls?.[0] });
      drafts.push({ messageId: event.messageId, recipient: event.fromAddress, createdAt: new Date().toISOString(), ...draft });
      seen.add(event.messageId);
      changed = true;
    }
    if (!changed) return;
    const temp = `${filePath}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(drafts, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      fs.renameSync(temp, filePath);
    } finally {
      try { fs.unlinkSync(temp); } catch { /* Already renamed or not created. */ }
    }
  } finally {
    fs.closeSync(lockFd);
    fs.unlinkSync(lockPath);
  }
}
