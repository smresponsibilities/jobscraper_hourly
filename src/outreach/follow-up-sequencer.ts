// src/outreach/follow-up-sequencer.ts
import {
  composeDay5FollowUpWithNewProof,
  composeTechnicalOpenerHook,
  type HookInput,
} from './personalized-hook-composer.js';
import {
  loadInboxLifecycleEvents,
  type InboxLifecycleEvent,
} from '../autoapply/inbox-lifecycle-tracker.js';

export { composeDay5FollowUpWithNewProof, composeTechnicalOpenerHook, type HookInput };

export interface Day5FollowUpDraft {
  eligible: boolean;
  reason?: string;
  subject?: string;
  body?: string;
  lead?: any;
}

export function isDay5FollowUpEligible(
  sentEntry: { company: string; domain?: string; sentAt?: string; followUpCount?: number },
  lifecycleEvents: InboxLifecycleEvent[] = loadInboxLifecycleEvents(),
  now = Date.now()
): { eligible: boolean; reason?: string } {
  if (!sentEntry.sentAt) {
    return { eligible: false, reason: 'missing_sent_at' };
  }
  const sentMs = Date.parse(sentEntry.sentAt);
  if (isNaN(sentMs)) {
    return { eligible: false, reason: 'invalid_sent_at' };
  }
  const ageMs = now - sentMs;
  const fiveDaysMs = 5 * 86_400_000;
  if (ageMs < fiveDaysMs) {
    return { eligible: false, reason: 'under_5_days_since_touch_1' };
  }
  if ((sentEntry.followUpCount ?? 0) > 0) {
    return { eligible: false, reason: 'already_followed_up' };
  }

  const cleanComp = (sentEntry.company || '').toLowerCase().trim();
  const cleanDom = (sentEntry.domain || '').toLowerCase().trim();

  for (const ev of lifecycleEvents) {
    if (
      ev.stage === 'APPLICATION_REJECTED' ||
      ev.stage === 'INTERVIEW_OR_OA_INVITE' ||
      ev.stage === 'RECRUITER_DIRECT_REPLY' ||
      ev.stage === 'HARD_BOUNCE_550'
    ) {
      const evDom = (ev.fromDomain || '').toLowerCase().trim();
      const evComp = (ev.company || '').toLowerCase().trim();
      const evSub = (ev.subject || '').toLowerCase().trim();
      if (
        (cleanDom && evDom && (evDom === cleanDom || evDom.endsWith('.' + cleanDom) || cleanDom.endsWith('.' + evDom))) ||
        (cleanComp && evComp && (evComp === cleanComp || evComp.includes(cleanComp) || cleanComp.includes(evComp))) ||
        (cleanComp && cleanComp.length >= 3 && evSub.includes(cleanComp))
      ) {
        return {
          eligible: false,
          reason: `suppressed_by_inbox_lifecycle (${ev.stage})`,
        };
      }
    }
  }

  return { eligible: true };
}

export function buildDay5FollowUpDraft(
  originalLead: HookInput & { domain?: string; followUpCount?: number },
  sentAtIso: string,
  lifecycleEvents: InboxLifecycleEvent[] = loadInboxLifecycleEvents(),
  now = Date.now()
): Day5FollowUpDraft {
  const check = isDay5FollowUpEligible(
    {
      company: originalLead.company,
      domain: originalLead.domain,
      sentAt: sentAtIso,
      followUpCount: originalLead.followUpCount,
    },
    lifecycleEvents,
    now
  );

  if (!check.eligible) {
    return {
      eligible: false,
      reason: check.reason,
      lead: originalLead,
    };
  }

  const draft = composeDay5FollowUpWithNewProof(originalLead);
  return {
    eligible: true,
    subject: draft.subject,
    body: draft.body,
    lead: originalLead,
  };
}
