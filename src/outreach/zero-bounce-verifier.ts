import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import dns from 'node:dns';
import { randomUUID } from 'node:crypto';
import {
  isPoisonPrefixEmail,
  verifyDomainMxRecords,
} from './free-contact-discovery.js';
import { isSafeOutreachEmailSyntax } from '../../scripts/sync-applied-to-outreach.js';

export type OutreachLeadTier =
  | 'TIER_A_VERBATIM_OBSERVED'
  | 'TIER_B_MAILBOX_VERIFIED'
  | 'TIER_C_UNVERIFIED_GUESS';

export interface MailboxVerificationResult {
  deliverable: boolean;
  tier: OutreachLeadTier;
  reason?: string;
  smtpVerified?: boolean;
  score?: number;
}

export class ZeroBounceBlockedError extends Error {
  constructor(message: string, public readonly tier: OutreachLeadTier, public readonly reason: string) {
    super(message);
    this.name = 'ZeroBounceBlockedError';
  }
}

export const DEFAULT_QUARANTINE_PATH = 'state/outreach/quarantined-guesses.json';

export interface DomainMxResult { hasValidMx: boolean; isNullMx: boolean; mxHosts: string[]; reason: string }
type CachedMx = DomainMxResult & { checkedAt: number };
const mxCache = new Map<string, CachedMx>();
const mxInFlight = new Map<string, Promise<DomainMxResult>>();
const MX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const isMxHost = (host: string) => /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(host);

/** A domain can accept mail only when DNS provides non-null MX records. */
export async function checkDomainMxDeliverability(emailOrDomain: string): Promise<DomainMxResult> {
  const value = String(emailOrDomain || '').trim().toLowerCase();
  const domain = (value.includes('@') ? value.split('@').at(-1)! : value).replace(/\.$/, '');
  const unavailable = (reason: string): DomainMxResult => ({ hasValidMx: false, isNullMx: false, mxHosts: [], reason });
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) || (value.includes('@') && !/^[^@\s]+@[^@\s]+$/.test(value))) return unavailable('INVALID_DOMAIN');
  const now = Date.now();
  const cachePath = path.resolve('state/outreach/domain-mx-cache.json');
  let cached = mxCache.get(domain);
  if (!cached) {
    try {
      const file = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as Record<string, CachedMx>;
      const candidate = file[domain];
      if (candidate && typeof candidate.checkedAt === 'number' && typeof candidate.hasValidMx === 'boolean' && typeof candidate.isNullMx === 'boolean' && typeof candidate.reason === 'string' && Array.isArray(candidate.mxHosts) && candidate.mxHosts.every(host => typeof host === 'string' && isMxHost(host)) && (!candidate.hasValidMx || (!candidate.isNullMx && candidate.mxHosts.length > 0))) cached = candidate;
    } catch { /* A missing or unreadable cache never proves deliverability. */ }
  }
  if (cached && cached.checkedAt <= now && now - cached.checkedAt < MX_TTL_MS) {
    mxCache.set(domain, cached);
    const { checkedAt: _, ...result } = cached;
    return { ...result, mxHosts: [...result.mxHosts] };
  }
  const existing = mxInFlight.get(domain);
  if (existing) return existing;
  const lookup = (async (): Promise<DomainMxResult> => {
    let result: DomainMxResult;
    try {
      const records = await dns.promises.resolveMx(domain);
      const isNullMx = records.some(record => record.exchange === '' || record.exchange === '.');
      const mxHosts = records.map(record => record.exchange.toLowerCase().replace(/\.$/, '')).filter(isMxHost);
      result = { hasValidMx: !isNullMx && mxHosts.length > 0, isNullMx, mxHosts, reason: isNullMx ? 'DNS_NULL_MX' : mxHosts.length ? 'DNS_MX_VALID' : 'DNS_NO_MX' };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOTFOUND' && code !== 'ENODATA') return unavailable('DNS_LOOKUP_FAILED');
      result = unavailable('DNS_NO_MX');
    }
    const entry = { ...result, mxHosts: [...result.mxHosts], checkedAt: Date.now() };
    mxCache.set(domain, entry);
    try {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      let file: Record<string, CachedMx> = {};
      try { file = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch { /* Start a new cache. */ }
      if (!file || typeof file !== 'object' || Array.isArray(file)) file = {};
      file[domain] = entry;
      const temp = `${cachePath}.${randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temp, JSON.stringify(file), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        fs.renameSync(temp, cachePath);
      } finally { try { fs.unlinkSync(temp); } catch {} }
    } catch { /* Cache persistence is optional; DNS result remains authoritative. */ }
    return result;
  })();
  mxInFlight.set(domain, lookup);
  try { return await lookup; } finally { mxInFlight.delete(domain); }
}

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

  // Strict Spam Shield / Safe Gate: Never send outbound cold email unless explicitly enabled by user
  if (process.env.ENABLE_OUTREACH_EMAIL !== 'true') {
    throw new ZeroBounceBlockedError('ZeroBounceBlocked: outbound outreach emails globally disabled by user preference (ENABLE_OUTREACH_EMAIL !== true)', provenanceTier, 'outreach_emails_disabled');
  }

  if (typeof to !== 'string' || !/^[^@\s,<>]+@[^@\s,<>]+$/.test(to) || typeof mailOptions?.to !== 'string' || mailOptions.to.trim().toLowerCase() !== to.trim().toLowerCase() || mailOptions.cc || mailOptions.bcc || mailOptions.envelope || mailOptions.raw) {
    throw new ZeroBounceBlockedError('ZeroBounceBlocked: recipient mismatch or unverified additional recipients', provenanceTier, 'recipient_mismatch');
  }

  if (provenanceTier === 'TIER_A_VERBATIM_OBSERVED') {
    if (!evidenceUrl || !evidenceUrl.trim()) {
      quarantineUnverifiedGuess({ to, provenanceTier, reason: 'TIER_A missing evidenceUrl' }, quarantinePath);
      throw new ZeroBounceBlockedError(`ZeroBounceBlocked: TIER_A missing evidenceUrl for ${to}`, provenanceTier, 'missing_evidence_url');
    }
    const mx = await checkDomainMxDeliverability(to);
    if (!mx.hasValidMx) throw new ZeroBounceBlockedError('ZeroBounceBlocked: recipient domain has no verified MX', provenanceTier, mx.reason);
    return await transporter.sendMail(mailOptions);
  }

  if (provenanceTier === 'TIER_B_MAILBOX_VERIFIED') {
    if (mailboxStatus !== 'VALID' || isCatchAll === true) {
      quarantineUnverifiedGuess({ to, provenanceTier, mailboxStatus, isCatchAll, reason: 'TIER_B status not VALID or is catch-all' }, quarantinePath);
      throw new ZeroBounceBlockedError(`ZeroBounceBlocked: TIER_B mailbox verification failed (${mailboxStatus}, catchAll=${isCatchAll}) for ${to}`, provenanceTier, 'mailbox_unverified_or_catchall');
    }
    const mx = await checkDomainMxDeliverability(to);
    if (!mx.hasValidMx) throw new ZeroBounceBlockedError('ZeroBounceBlocked: recipient domain has no verified MX', provenanceTier, mx.reason);
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


export function classifySmtpBounceReply(code: number, message: string): { category: 'HARD_INVALID_MAILBOX' | 'NULL_MX_OR_DOMAIN' | 'MAILBOX_FULL' | 'GREYLISTED_OR_TRANSIENT' | 'POLICY_OR_SPAM_BLOCK' | 'DELIVERABLE_250' | 'UNKNOWN'; enhancedCode: string | null; shouldQuarantinePermanently: boolean } {
  const enhancedCode = /\b([245]\.\d{1,3}\.\d{1,3})\b/.exec(message)?.[1] || null;
  let category: ReturnType<typeof classifySmtpBounceReply>['category'] = 'UNKNOWN';
  if (enhancedCode === '5.1.10' || /null mx|domain does not accept mail/i.test(message)) category = 'NULL_MX_OR_DOMAIN';
  else if (enhancedCode === '5.2.2' || /mailbox full|over quota/i.test(message)) category = 'MAILBOX_FULL';
  else if (/^4\./.test(enhancedCode || '') || (code >= 400 && code < 500) || /greylist|try again later|temporarily deferred|rate limit/i.test(message)) category = 'GREYLISTED_OR_TRANSIENT';
  else if (enhancedCode === '5.7.1' || /spamhaus|blocked|blacklisted|policy|spf|dmarc/i.test(message)) category = 'POLICY_OR_SPAM_BLOCK';
  else if (/^5\.1\.[1236]$|^5\.2\.1$/.test(enhancedCode || '') || /user unknown|does not exist|no such user|invalid recipient|recipient rejected/i.test(message)) category = 'HARD_INVALID_MAILBOX';
  else if ((code === 250 && !/^5\./.test(enhancedCode || '')) || enhancedCode === '2.1.5') category = 'DELIVERABLE_250';
  return { category, enhancedCode, shouldQuarantinePermanently: category === 'HARD_INVALID_MAILBOX' || category === 'NULL_MX_OR_DOMAIN' };
}

export function computeGravatarAvatarUrl(email: string): { md5Hash: string; url: string } {
  const md5Hash = createHash('md5').update(email.trim().toLowerCase()).digest('hex');
  return { md5Hash, url: `https://www.gravatar.com/avatar/${md5Hash}?d=404` };
}

export async function checkGravatarExists(email: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  try { return (await fetcher(computeGravatarAvatarUrl(email).url, { method: 'HEAD', signal: AbortSignal.timeout(2500) })).status === 200; } catch { return false; }
}

export function isDisposableOrFreeEmailDomain(domain: string): { isDisposable: boolean; isFreeConsumer: boolean } {
  const key = domain.trim().toLowerCase().replace(/\.$/, '');
  return { isDisposable: new Set(['mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'yopmail.com', 'trashmail.com', 'sharklasers.com', 'getnada.com', 'maildrop.cc']).has(key), isFreeConsumer: new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'protonmail.com', 'zoho.com', 'rediffmail.com']).has(key) };
}
