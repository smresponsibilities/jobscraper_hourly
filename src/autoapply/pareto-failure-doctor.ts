import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import path from 'node:path';

export interface FailureParetoBucket {
  category: string;
  count: number;
  percentage: number;
  sampleUrls: string[];
  recommendedFixTicket: string;
}

type Category = 'AMBIGUOUS_DISPATCH' | 'UNRESOLVED_CUSTOM_QUESTION' | 'OTP_OR_EMAIL_VERIFICATION_TIMEOUT' | 'CAPTCHA_OR_BOT_BLOCK' | 'SERVER_400_422_VALIDATION' | 'WORKDAY_AUTH_OR_LOCALE' | 'CLOSED_OR_404_POSTING' | 'OTHER_TRANSIENT_ERROR';

const recommendations: Record<Category, string> = {
  AMBIGUOUS_DISPATCH: 'Verify the employer receipt before any retry',
  UNRESOLVED_CUSTOM_QUESTION: 'GEN-533 / GEN-550',
  OTP_OR_EMAIL_VERIFICATION_TIMEOUT: 'GEN-566',
  CAPTCHA_OR_BOT_BLOCK: 'GEN-573',
  SERVER_400_422_VALIDATION: 'GEN-536',
  WORKDAY_AUTH_OR_LOCALE: 'GEN-545 / GEN-567',
  CLOSED_OR_404_POSTING: 'Review closed posting before skipping',
  OTHER_TRANSIENT_ERROR: 'Inspect the saved diagnostic',
};

function classify(reason: string): Category {
  if (/ambiguous.dispatch|previous submit|submit(?:ted)? (?:may|possibly|already)|receipt.*(?:missing|pending|unconfirmed)|submission.*(?:unknown|ambiguous)/i.test(reason)) return 'AMBIGUOUS_DISPATCH';
  if (/captcha|recaptcha|turnstile|bot.block|bot detection|challenge/i.test(reason)) return 'CAPTCHA_OR_BOT_BLOCK';
  if (/\b(?:otp|one.time|verification code|email verification|verify.*email)\b/i.test(reason)) return 'OTP_OR_EMAIL_VERIFICATION_TIMEOUT';
  if (/\b(?:404|410|posting closed|position (?:is )?closed|job (?:is )?(?:closed|expired|unavailable))\b/i.test(reason)) return 'CLOSED_OR_404_POSTING';
  if (/\b(?:400|422|validation|invalid field|field error)\b/i.test(reason)) return 'SERVER_400_422_VALIDATION';
  if (/\b(?:auth|authentication|login|sign.in|credential|password|locale|language selector)\b/i.test(reason)) return 'WORKDAY_AUTH_OR_LOCALE';
  if (/missing.fact|unmapped|required (?:answer|field|question)|unresolved.*(?:question|answer)|custom question/i.test(reason)) return 'UNRESOLVED_CUSTOM_QUESTION';
  return 'OTHER_TRANSIENT_ERROR';
}

function safeSampleUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
    url.search = ''; url.hash = '';
    return url.href;
  } catch { return; }
}

/** Read diagnostics without modifying queue entries or retrying applications. */
export function analyzeQueueFailurePareto(dbPath = path.resolve('state/autoapply/portal-review/queue.sqlite')): { totalFailedOrPaused: number; buckets: FailureParetoBucket[] } {
  if (!existsSync(dbPath)) throw new Error('Queue database does not exist');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    const rows = db.prepare("SELECT normalized_url, payload FROM applications WHERE status IN ('paused_for_review', 'failed')").all() as Array<{ normalized_url: string; payload: string }>;
    const grouped = new Map<Category, { count: number; samples: Set<string> }>();
    for (const row of rows) {
      let payload: Record<string, unknown> = {};
      try { const parsed: unknown = JSON.parse(row.payload); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>; } catch { /* Count invalid payloads as unknown. */ }
      const reason = [payload.reasonCode, payload.error, payload.reason, payload.failureReason, payload.reviewKind].filter(value => typeof value === 'string').join(' ');
      const category = classify(reason);
      const bucket = grouped.get(category) || { count: 0, samples: new Set<string>() };
      bucket.count++;
      const sample = safeSampleUrl(payload.jobUrl) || safeSampleUrl(row.normalized_url);
      if (sample && bucket.samples.size < 5) bucket.samples.add(sample);
      grouped.set(category, bucket);
    }
    return {
      totalFailedOrPaused: rows.length,
      buckets: [...grouped.entries()].map(([category, value]) => ({ category, count: value.count, percentage: value.count * 100 / rows.length, sampleUrls: [...value.samples], recommendedFixTicket: recommendations[category] })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
    };
  } finally { db.close(); }
}
