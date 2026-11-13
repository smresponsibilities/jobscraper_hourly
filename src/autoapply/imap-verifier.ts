import { ImapFlow } from 'imapflow';
import type { Frame, Page } from 'patchright';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadDotEnvIntoProcess } from './env-credentials.js';
import { withSingleFlightImapLock } from './imap-multiplexer.js';

export interface ImapVerificationResult {
  found: boolean;
  otpCode?: string;
  verificationUrl?: string;
  subject?: string;
}

// Ticket GEN-192: Cross-lane IMAP OTP token isolation
export const CONSUMED_VERIFICATION_TOKENS = new Set<string>();

// Ticket GEN-480: Cross-job consumed OTP codes persistence & isolation
export const USED_OTP_CODES_FILE = path.resolve('state/autoapply/portal-review/used-otp-codes.json');
export const consumedOtpCodes = new Set<string>();

export function loadConsumedOtpCodes(): void {
  try {
    if (fs.existsSync(USED_OTP_CODES_FILE)) {
      const data = JSON.parse(fs.readFileSync(USED_OTP_CODES_FILE, 'utf8'));
      if (Array.isArray(data)) {
        for (const code of data) {
          if (typeof code === 'string' && code.trim()) {
            consumedOtpCodes.add(code.trim());
            CONSUMED_VERIFICATION_TOKENS.add(code.trim());
          }
        }
      }
    }
  } catch {}
}
loadConsumedOtpCodes();

export function recordConsumedOtpCode(code: string): void {
  if (!code) return;
  const clean = code.trim();
  consumedOtpCodes.add(clean);
  CONSUMED_VERIFICATION_TOKENS.add(clean);
  try {
    const list = Array.from(consumedOtpCodes).slice(-50);
    fs.mkdirSync(path.dirname(USED_OTP_CODES_FILE), { recursive: true });
    fs.writeFileSync(USED_OTP_CODES_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch {}
}

export function hasConsumedVerificationToken(token: string): boolean {
  return CONSUMED_VERIFICATION_TOKENS.has(token) || consumedOtpCodes.has(token);
}

// Ticket GEN-225: Cross-lane IMAP Mutex ensuring serial IMAP mailbox access
export async function withImapMutex<T>(fn: () => Promise<T>): Promise<T> {
  return withSingleFlightImapLock('verification', fn);
}

/**
 * Ticket GEN-276: Decode RFC-2045 Quoted-Printable MIME soft line breaks (=\r\n)
 * and hex bytes (=3D, =20, etc.) before token/OTP parsing.
 */
export function decodeQuotedPrintableMime(raw: string): string {
  if (!raw) return '';
  const withoutSoftBreaks = raw.replace(/=(?:\r\n|\r|\n)/g, '');
  const decoded = withoutSoftBreaks.replace(/(?:=[0-9A-F]{2})+/g, (match) => {
    try {
      const bytes: number[] = [];
      for (let i = 0; i < match.length; i += 3) {
        bytes.push(parseInt(match.slice(i + 1, i + 3), 16));
      }
      return Buffer.from(bytes).toString('utf8');
    } catch {
      return match;
    }
  });
  return decoded.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&');
}

export const COMMON_8_LETTER_WORDS = /^(?:security|position|software|engineer|location|linkedin|question|required|optional|uploaded|attached|personal|graduate|bachelor|internal|external|complete|continue|verified|customer|platform|database|frontend|template|document|response|received|applying|greenhouse|dharmesh|mahajan|bengaluru)$/i;

export function extractOtpOrLinkFromMime(decoded: string): { otpCode?: string; verificationUrl?: string } {
  const cleanDecoded = (decoded || '').replace(/&nbsp;/gi, ' ');

  // 1. Check for Workday / ATS Verification Link
  let linkMatch = cleanDecoded.match(
    /https?:\/\/[^\s"'<>]+(?:myworkdayjobs\.com|myworkday\.com|smartrecruiters\.com|greenhouse\.io)[^\s"'<>]*(?:verify|confirm|activate|token|code)[^\s"'<>]*/i
  );

  // Ticket GEN-525: If no explicit verify/confirm/activate path, extract any Workday link in an activation context
  if (!linkMatch) {
    const isActivationEmail = /verify|activate|welcome|account|confirm|sign[- ]?in/i.test(cleanDecoded);
    if (isActivationEmail) {
      const generalWdLink = cleanDecoded.match(
        /https?:\/\/[^\s"'<>]+(?:myworkdayjobs\.com|myworkday\.com)\/[^\s"'<>]+/i
      );
      if (generalWdLink) {
        linkMatch = generalWdLink;
      }
    }
  }

  // Stage 1: Look for an isolated 6-to-8 char token inside HTML emphasis/table/heading tags
  const tagMatches = [...cleanDecoded.matchAll(/<(?:h1|h2|h3|h4|strong|b|code|td|p|div|span)[^>]*>\s*([A-Za-z0-9]{6,8})\s*<\/(?:h1|h2|h3|h4|strong|b|code|td|p|div|span)>/gi)];
  let extractedCode: string | undefined;
  for (const m of tagMatches) {
    const cand = m[1]!.trim();
    // Prefer tokens that contain at least 1 digit OR mixed case, and are not common English words
    if (!COMMON_8_LETTER_WORDS.test(cand) && (/\d/.test(cand) || (/[a-z]/.test(cand) && /[A-Z]/.test(cand)))) {
      extractedCode = cand;
      break;
    }
  }

  // Stage 2: Look after colon or explicit phrase ("application form: X7k9Pq2M" or "code is: 123456")
  const bodyWithoutHtml = cleanDecoded.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (!extractedCode) {
    const phraseMatch =
      bodyWithoutHtml.match(/(?:application form|paste this[^:]{0,40}|security code[^:]{0,40}|verification code[^:]{0,40}|code is)[:\s]+([A-Za-z0-9]{6,8})\b/i) ||
      bodyWithoutHtml.match(/\b([0-9]{6,8})\b/);
    if (phraseMatch?.[1] && !COMMON_8_LETTER_WORDS.test(phraseMatch[1])) {
      extractedCode = phraseMatch[1].trim();
    }
  }

  return {
    otpCode: extractedCode,
    verificationUrl: linkMatch?.[0],
  };
}

/**
 * Generates a deterministic Gmail +alias for a Workday tenant when the base email account
 * is locked or has a mismatched password from an older session.
 * All emails sent to user+wd_citi@gmail.com arrive in user@gmail.com's IMAP inbox!
 */
export function makeGmailTenantAlias(baseEmail: string, tenantUrl: string): string {
  const [local, domain] = baseEmail.trim().split('@');
  if (!local || !domain) return baseEmail;
  let tenantSlug = 'wd';
  try {
    const rawUrl = tenantUrl.includes('://') ? tenantUrl : `https://${tenantUrl}`;
    const host = new URL(rawUrl).hostname.toLowerCase();
    tenantSlug = host.split('.')[0]?.replace(/[^a-z0-9]/g, '').slice(0, 10) || 'wd';
  } catch {}
  const cleanLocal = local.split('+')[0]!;
  return `${cleanLocal}+wd_${tenantSlug}@${domain}`;
}

export async function pollImapForVerificationCodeOrLink(params: {
  senderOrSubjectHint?: string;
  companyHint?: string;
  sinceMs?: number;
  maxWaitMs?: number;
  onActivity?: () => void;
}): Promise<ImapVerificationResult> {
  loadDotEnvIntoProcess();
  loadConsumedOtpCodes();
  const host = process.env.IMAP_HOST || 'imap.gmail.com';
  const user = process.env.IMAP_USER || process.env.AUTOAPPLY_EMAIL || process.env.EMAIL || '';
  const pass = process.env.IMAP_PASSWORD || process.env.IMAP_PASS || process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS || '';

  if (!user || !pass) {
    return { found: false };
  }

  const maxWaitMs = params.maxWaitMs ?? 35_000;
  const sinceTime = params.sinceMs !== undefined ? params.sinceMs : Date.now() - 120_000; // Exact sinceMs or look back 2 minutes
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    params.onActivity?.();

    const iterationResult = await withImapMutex(async (): Promise<ImapVerificationResult | null> => {
      const client = new ImapFlow({
        host,
        port: Number(process.env.IMAP_PORT || 993),
        secure: true,
        auth: { user, pass },
        logger: false,
      });
      // Prevent unhandled socket reset crashes
      client.on('error', () => {});

      try {
        await client.connect();
        const lock = await client.getMailboxLock('INBOX');
        try {
          const total = client.mailbox ? client.mailbox.exists : 0;
          if (total > 0) {
            // Ticket GEN-225: Search all emails in last 20 mins regardless of \Seen status
            const searchSince = new Date(Date.now() - 20 * 60 * 1000);
            let uids: number[] = [];
            try {
              const res = await client.search({ since: searchSince }, { uid: true });
              if (Array.isArray(res)) uids = res;
            } catch {}

            const messages: Array<{ seq: number; date: Date; subject: string; sourceText: string }> = [];

            if (uids.length > 0) {
              const targetUids = uids.slice(-15).reverse();
              for (const uid of targetUids) {
                try {
                  const msg = await client.fetchOne(String(uid), { envelope: true, source: true }, { uid: true });
                  if (!msg) continue;
                  const msgDate = msg.envelope?.date ? new Date(msg.envelope.date) : new Date();
                  if (msgDate.getTime() < sinceTime) continue;
                  const subject = msg.envelope?.subject || '';
                  const rawSource = msg.source ? msg.source.toString('utf8') : '';
                  messages.push({ seq: msg.seq, date: msgDate, subject, sourceText: rawSource });
                } catch {}
              }
            } else {
              const startSeq = Math.max(1, total - 12);
              for await (const msg of client.fetch(`${startSeq}:*`, { envelope: true, source: true })) {
                const msgDate = msg.envelope?.date ? new Date(msg.envelope.date) : new Date();
                if (msgDate.getTime() < sinceTime) continue;
                const subject = msg.envelope?.subject || '';
                const rawSource = msg.source ? msg.source.toString('utf8') : '';
                messages.push({ seq: msg.seq, date: msgDate, subject, sourceText: rawSource });
              }
            }

            // Ticket GEN-480: Prioritize emails matching companyHint if provided, then newest first
            if (params.companyHint) {
              const hint = params.companyHint.toLowerCase();
              messages.sort((a, b) => {
                const aMatch = a.subject.toLowerCase().includes(hint) || a.sourceText.toLowerCase().includes(hint);
                const bMatch = b.subject.toLowerCase().includes(hint) || b.sourceText.toLowerCase().includes(hint);
                if (aMatch && !bMatch) return -1;
                if (!aMatch && bMatch) return 1;
                return b.date.getTime() - a.date.getTime();
              });
            } else {
              messages.sort((a, b) => b.date.getTime() - a.date.getTime());
            }

            for (const m of messages) {
              if (
                !/verify|verification|security code|confirmation|confirm your email|activate|workday|greenhouse|smartrecruiters|lever|one-time|passcode/i.test(
                  `${m.subject} ${m.sourceText.slice(0, 2000)}`
                )
              ) {
                continue;
              }

              // Ticket GEN-276: Decode quoted-printable soft line breaks and hex characters
              const decoded = decodeQuotedPrintableMime(m.sourceText);

              // Ticket GEN-276, GEN-473 & GEN-480: Multi-stage OTP extractor checking consumedOtpCodes
              const extracted = extractOtpOrLinkFromMime(decoded);
              if (extracted.otpCode && (consumedOtpCodes.has(extracted.otpCode) || CONSUMED_VERIFICATION_TOKENS.has(extracted.otpCode))) {
                continue;
              }
              const candidateToken = extracted.otpCode || extracted.verificationUrl || '';
              if (candidateToken && CONSUMED_VERIFICATION_TOKENS.has(candidateToken)) {
                continue;
              }

              if (extracted.verificationUrl || extracted.otpCode) {
                if (extracted.otpCode) {
                  recordConsumedOtpCode(extracted.otpCode);
                } else if (candidateToken) {
                  CONSUMED_VERIFICATION_TOKENS.add(candidateToken);
                }
                return {
                  found: true,
                  otpCode: extracted.otpCode,
                  verificationUrl: extracted.verificationUrl,
                  subject: m.subject,
                };
              }
            }
          }
        } finally {
          lock.release();
        }
      } catch {
        // Connection cleanup is shared by success, failure, and early return.
      } finally {
        await client.logout().catch(() => { try { client.close(); } catch {} });
      }
      return null;
    });

    if (iterationResult && iterationResult.found) {
      return iterationResult;
    }

    await new Promise(r => setTimeout(r, 4000));
  }

  return { found: false };
}

/**
 * Automatically completes in-page Email OTP or Activation Link verification on Workday, Greenhouse, and SmartRecruiters.
 */
export async function completeInPageEmailVerificationIfPrompted(
  page: Page,
  frame: Frame,
  onActivity?: () => void,
  options?: {
    sinceMs?: number;
    companyHint?: string;
    email?: string;
    password?: string;
    imapPoller?: (opts: any) => Promise<ImapVerificationResult>;
  }
): Promise<boolean> {
  const pageText = await frame.evaluate(() => (document.body?.innerText || '').slice(0, 3000)).catch(() => '');
  const hasSecurityInput = await frame
    .locator('input[id^="security-input-"], input[id^="security_code"], input[name*="security_code"], input[maxlength="1"], input[id*="security-code"], input[name*="security-code"], input[id*="verification_code"], input[name*="verification_code"], input[aria-label*="security code"], input[aria-label*="verification code"], input[placeholder*="security code"], input[placeholder*="verification code"], #security-code, #security_code, [class*="security-code"] input, [id*="security_code"] input, [data-automation-id*="securityCode"], [data-automation-id*="verificationCode"]')
    .filter({ visible: true })
    .count()
    .catch(() => 0);

  const hasExplicitOtpPrompt = /security code|verification code|enter the 8-character|enter the 6-digit|enter security code|resubmit your application with the code|one-time passcode|one-time password/i.test(
    pageText
  );

  const needsVerification =
    hasSecurityInput > 0 ||
    (hasExplicitOtpPrompt && /\b(?:email|code|sent|inbox|verification)\b/i.test(pageText));

  if (!needsVerification) return false;

  const poller = options?.imapPoller || pollImapForVerificationCodeOrLink;
  const res = await poller({
    sinceMs: options?.sinceMs ?? (Date.now() - 60_000),
    companyHint: options?.companyHint,
    maxWaitMs: 35_000,
    onActivity,
  });
  if (!res.found) return false;

  // Case 1: Activation URL clicked via background tab
  if (res.verificationUrl) {
    const verifyPage = await page.context().newPage();
    try {
      await verifyPage.goto(res.verificationUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {});
      await verifyPage.waitForTimeout(2500);
      const confirmBtn = verifyPage.locator('button:has-text("Verify"), button:has-text("Confirm"), button:has-text("Continue")').first();
      if (await confirmBtn.isVisible().catch(() => false)) {
        await confirmBtn.click({ timeout: 3000 }).catch(() => {});
        await verifyPage.waitForTimeout(2000);
      }
    } finally {
      await verifyPage.close().catch(() => {});
    }
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(2000);

    return true;
  }

  // Case 2: 6-to-8 Character OTP Code Input (Workday / Greenhouse security-input-0..7 / SmartRecruiters)
  if (res.otpCode) {
    const code = res.otpCode.trim();
    // Ticket GEN-473: Check if Greenhouse split 6-to-8 box security code inputs exist
    const splitBoxes = frame.locator('input[id^="security-input-"], input[id^="security-code-"], [class*="security-code"] input, fieldset input[maxlength="1"], input[maxlength="1"]').filter({ visible: true });
    const splitCount = await splitBoxes.count().catch(() => 0);
    if (splitCount >= 6) {
      await splitBoxes.first().click({ timeout: 2000 }).catch(() => {});
      // Dispatch synthetic ClipboardEvent('paste') with res.otpCode on splitBoxes.first()
      await splitBoxes.first().evaluate((el, otp) => {
        try {
          const dt = new DataTransfer();
          dt.setData('text/plain', otp);
          el.dispatchEvent(
            new ClipboardEvent('paste', {
              clipboardData: dt,
              bubbles: true,
              cancelable: true,
              composed: true,
            })
          );
        } catch {}
      }, code).catch(() => {});

      // AND loop i = 0 to code.length - 1: on splitBoxes.nth(i), set the single character code[i] using the native HTMLInputElement.prototype.value setter and dispatch input, change, and keyup events!
      for (let i = 0; i < code.length && i < splitCount; i++) {
        const char = code[i]!;
        const box = splitBoxes.nth(i);
        await box.evaluate((el: HTMLInputElement, ch: string) => {
          el.focus();
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value'
          )?.set;
          if (setter) {
            setter.call(el, ch);
          } else {
            el.value = ch;
          }
          el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, composed: true, key: ch }));
        }, char).catch(() => {});
      }
    } else {
      const codeInput = frame
        .locator(
          'input#security_code, input[name*="security_code" i], input[id*="security_code" i], input[id*="security-code" i], input[name*="security-code" i], input[id*="verification_code" i], input[name*="verification_code" i], input[aria-label*="security code" i], input[aria-label*="verification code" i], input[placeholder*="security code" i], input[placeholder*="verification code" i], #security-code, input[data-automation-id*="verificationCode" i], input[data-automation-id*="securityCode" i], input[name="otp" i], input[id="otp" i], input[id*="security" i], input[name*="security" i]'
        )
        .filter({ visible: true })
        .first();
      if (await codeInput.isVisible().catch(() => false)) {
        await codeInput.click({ timeout: 2000 }).catch(() => {});
        await codeInput.press('ControlOrMeta+A').catch(() => {});
        await codeInput.press('Backspace').catch(() => {});
        await codeInput.fill(code).catch(() => {});
        await codeInput.dispatchEvent('input').catch(() => {});
        await codeInput.dispatchEvent('change').catch(() => {});
      }
    }

    // A verification control is distinct from resubmitting an application.
    const verify = frame.getByRole('button', { name: /^(?:verify|verify code|confirm code|verify email)$/i }).filter({ visible: true });
    if (await verify.count() !== 1) return false;
    const html = frame.locator('html');
    if (await html.getAttribute('data-autoapply-otp-verify-attempted')) return false;
    await html.evaluate(el => el.setAttribute('data-autoapply-otp-verify-attempted', 'true'));
    await verify.click({ timeout: 3000 });

    return true;
  }

  return false;
}
