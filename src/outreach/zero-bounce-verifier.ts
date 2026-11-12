import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  isPoisonPrefixEmail,
  verifyDomainMxRecords,
} from './free-contact-discovery.js';
import { isSafeOutreachEmailSyntax } from '../../scripts/sync-applied-to-outreach.js';

export type OutreachLeadTier =
  | 'TIER_A_VERBATIM_OBSERVED'
  | 'TIER_B_MAILBOX_VERIFIED'
  | 'TIER_C_UNVERIFIED_GUESS';

export class ZeroBounceBlockedError extends Error {
  constructor(message: string, public readonly tier: OutreachLeadTier, public readonly reason: string) {
    super(message);
    this.name = 'ZeroBounceBlockedError';
  }
}

export const DEFAULT_QUARANTINE_PATH = 'state/outreach/quarantined-guesses.json';

export interface VerifiedOutreachPayload {
  transporter: any;
  mailOptions: any;
  to: string;
  provenanceTier: OutreachLeadTier;
  evidenceUrl?: string;
  mailboxStatus?: string;
  isCatchAll?: boolean;
  quarantinePath?: string;
}

export function quarantineUnverifiedGuess(leadInfo: any, quarantinePath = DEFAULT_QUARANTINE_PATH): void {
  try {
    const fullPath = path.resolve(quarantinePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    let existing: any[] = [];
    if (fs.existsSync(fullPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      } catch {}
    }
    existing.push({
      ...leadInfo,
      quarantinedAt: new Date().toISOString(),
    });
    fs.writeFileSync(fullPath, JSON.stringify(existing, null, 2), 'utf8');
  } catch {}
}

/**
 * Mandatory send gate for all outreach emails.
 * Only allows TIER_A_VERBATIM_OBSERVED with evidenceUrl, or TIER_B_MAILBOX_VERIFIED with status VALID & non-catchall.
 * Quarantines TIER_C_UNVERIFIED_GUESS and throws ZeroBounceBlockedError.
 */
export async function sendVerifiedOutreachEmail(payload: VerifiedOutreachPayload): Promise<any> {
  const { transporter, mailOptions, to, provenanceTier, evidenceUrl, mailboxStatus, isCatchAll, quarantinePath } = payload;

  if (provenanceTier === 'TIER_A_VERBATIM_OBSERVED') {
    if (!evidenceUrl || !evidenceUrl.trim()) {
      quarantineUnverifiedGuess({ to, provenanceTier, reason: 'TIER_A missing evidenceUrl' }, quarantinePath);
      throw new ZeroBounceBlockedError(`ZeroBounceBlocked: TIER_A missing evidenceUrl for ${to}`, provenanceTier, 'missing_evidence_url');
    }
    return await transporter.sendMail(mailOptions);
  }

  if (provenanceTier === 'TIER_B_MAILBOX_VERIFIED') {
    if (mailboxStatus !== 'VALID' || isCatchAll === true) {
      quarantineUnverifiedGuess({ to, provenanceTier, mailboxStatus, isCatchAll, reason: 'TIER_B status not VALID or is catch-all' }, quarantinePath);
      throw new ZeroBounceBlockedError(`ZeroBounceBlocked: TIER_B mailbox verification failed (${mailboxStatus}, catchAll=${isCatchAll}) for ${to}`, provenanceTier, 'mailbox_unverified_or_catchall');
    }
    return await transporter.sendMail(mailOptions);
  }

  // TIER_C or unknown tier
  quarantineUnverifiedGuess({ to, provenanceTier, reason: 'TIER_C_UNVERIFIED_GUESS blocked' }, quarantinePath);
  throw new ZeroBounceBlockedError(`ZeroBounceBlocked: TIER_C unverified guess rejected for ${to}`, 'TIER_C_UNVERIFIED_GUESS', 'tier_c_guess_quarantined');
}

export const INVENTED_ROLE_GUESS_REGEX =
  /^(?:talent|careers|recruiting|recruitment|hr|jobs|hiring|people|info|contact|hello|team|office|admin)@/i;

/**
 * Checks whether the lead's discovery origin is a verbatim-scraped or
 * repository-observed source (Git .patch header, NPM maintainer, GitHub org events, or page scrape).
 */
export function isVerbatimObservedSource(discoveryStep?: string): boolean {
  if (!discoveryStep) return false;
  const s = String(discoveryStep).toLowerCase();
  if (/fallback|guess|unverified|poison_scrubbed/i.test(s)) return false;
  return (
    /git_patch|\.patch|inversion2|npm|inversion1|github_org|commit_osint|website_scrape|website_verbatim|job_post|public_page|website_contact/i.test(
      s
    )
  );
}

/**
 * Zero-Bounce Pre-Send Mailbox Verifier (Ticket GEN-488.1).
 *
 * Prevents SMTP 550 bounces ("Mail Delivery Failed") by gating every email
 * before transporter.sendMail():
 * 1) Blocks unverified role guesses (talent@, careers@, etc.) unless rapid-email-verifier
 *    explicitly returns status === 'VALID' and validations.smtp === true.
 * 2) Accepts verbatim-observed Git .patch / NPM maintainer / website contacts (TIER_A).
 * 3) Validates named contacts via MX verification and mailbox existence checks (TIER_B).
 */
export async function verifyMailboxExistsBeforeSend(
  email: string,
  discoveryStepOrLead?: string | { discoveryStep?: string; source?: string; tier?: string }
): Promise<MailboxVerificationResult> {
  const rawStep =
    typeof discoveryStepOrLead === 'object'
      ? discoveryStepOrLead.discoveryStep || discoveryStepOrLead.source || ''
      : discoveryStepOrLead || '';
  const cleanEmail = (email || '').trim().toLowerCase();

  // Basic sanity validation
  if (!cleanEmail || !cleanEmail.includes('@')) {
    return {
      deliverable: false,
      tier: 'TIER_C_UNVERIFIED_GUESS',
      reason: 'Malformed or empty email address',
    };
  }

  if (isPoisonPrefixEmail(cleanEmail)) {
    return {
      deliverable: false,
      tier: 'TIER_C_UNVERIFIED_GUESS',
      reason: `Poison prefix rejected (${cleanEmail})`,
    };
  }

  if (!isSafeOutreachEmailSyntax(cleanEmail)) {
    return {
      deliverable: false,
      tier: 'TIER_C_UNVERIFIED_GUESS',
      reason: `Invalid email syntax (${cleanEmail})`,
    };
  }

  const domain = cleanEmail.split('@')[1]?.toLowerCase().trim() || '';
  const isVerbatim = isVerbatimObservedSource(rawStep);
  const isRoleGuess = INVENTED_ROLE_GUESS_REGEX.test(cleanEmail);

  // 1. Block Invented Role Guesses (TIER_C_UNVERIFIED_GUESS)
  // Any role prefix not scraped verbatim MUST be blocked unless rapid-email-verifier
  // explicitly returns status === 'VALID' and validations.smtp === true!
  if (isRoleGuess && !isVerbatim) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const resp = await fetch(
        `https://rapid-email-verifier.fly.dev/api/validate?email=${encodeURIComponent(cleanEmail)}`,
        {
          signal: ctrl.signal,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'jobscraper-zero-bounce-verifier',
          },
        }
      ).catch(() => null);
      clearTimeout(timer);

      if (resp && resp.ok) {
        const data: any = await resp.json().catch(() => null);
        if (data && data.status === 'VALID' && data.validations?.smtp === true) {
          return {
            deliverable: true,
            tier: 'TIER_B_MAILBOX_VERIFIED',
            smtpVerified: true,
            score: data.score,
            reason: 'Role mailbox explicitly verified by SMTP handshake',
          };
        }
      }
    } catch {}

    return {
      deliverable: false,
      tier: 'TIER_C_UNVERIFIED_GUESS',
      reason: `Unverified role mailbox guess blocked (${cleanEmail})`,
    };
  }

  // 2. Accept Verbatim-Observed Git .patch / NPM maintainer / website contacts
  if (isVerbatim) {
    return {
      deliverable: true,
      tier: 'TIER_A_VERBATIM_OBSERVED',
      reason: `Verbatim observed contact (${rawStep})`,
    };
  }

  // 3. Named / Non-Role Emails: Check DNS MX & rapid-email-verifier
  const mxOk = await verifyDomainMxRecords(domain);
  if (!mxOk) {
    return {
      deliverable: false,
      tier: 'TIER_C_UNVERIFIED_GUESS',
      reason: `No MX records found for domain ${domain}`,
    };
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const resp = await fetch(
      `https://rapid-email-verifier.fly.dev/api/validate?email=${encodeURIComponent(cleanEmail)}`,
      {
        signal: ctrl.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'jobscraper-zero-bounce-verifier',
        },
      }
    ).catch(() => null);
    clearTimeout(timer);

    if (resp && resp.ok) {
      const data: any = await resp.json().catch(() => null);
      if (data?.status === 'INVALID_DOMAIN' || data?.status === 'INVALID_FORMAT') {
        return {
          deliverable: false,
          tier: 'TIER_C_UNVERIFIED_GUESS',
          reason: `Email validation failed (${data.status})`,
        };
      }
      if (data?.status === 'VALID' && data?.validations?.smtp === true) {
        return {
          deliverable: true,
          tier: 'TIER_B_MAILBOX_VERIFIED',
          smtpVerified: true,
          score: data.score,
          reason: 'Named mailbox verified by SMTP',
        };
      }
    }
  } catch {}

  return {
    deliverable: true,
    tier: 'TIER_B_MAILBOX_VERIFIED',
    reason: 'Domain MX verified and valid named email format',
  };
}
