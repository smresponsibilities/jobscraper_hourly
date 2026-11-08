import { ImapFlow } from 'imapflow';
import type { Frame, Page } from 'patchright';
import { loadDotEnvIntoProcess } from './env-credentials.js';

export interface ImapVerificationResult {
  found: boolean;
  otpCode?: string;
  verificationUrl?: string;
  subject?: string;
}

// Ticket GEN-192: Cross-lane IMAP OTP token isolation
export const CONSUMED_VERIFICATION_TOKENS = new Set<string>();

export function hasConsumedVerificationToken(token: string): boolean {
  return CONSUMED_VERIFICATION_TOKENS.has(token);
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
    const host = new URL(tenantUrl).hostname.toLowerCase();
    tenantSlug = host.split('.')[0]?.replace(/[^a-z0-9]/g, '').slice(0, 10) || 'wd';
  } catch {}
  const cleanLocal = local.split('+')[0]!;
  return `${cleanLocal}+wd_${tenantSlug}@${domain}`;
}

export async function pollImapForVerificationCodeOrLink(params: {
  senderOrSubjectHint?: string;
  sinceMs?: number;
  maxWaitMs?: number;
  onActivity?: () => void;
}): Promise<ImapVerificationResult> {
  loadDotEnvIntoProcess();
  const host = process.env.IMAP_HOST || 'imap.gmail.com';
  const user = process.env.IMAP_USER || process.env.AUTOAPPLY_EMAIL || process.env.EMAIL || '';
  const pass = process.env.IMAP_PASSWORD || process.env.IMAP_PASS || process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS || '';

  if (!user || !pass) {
    return { found: false };
  }

  const maxWaitMs = params.maxWaitMs ?? 35_000;
  const sinceTime = (params.sinceMs ?? Date.now()) - 120_000; // Look back 2 minutes
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    params.onActivity?.();
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
          const startSeq = Math.max(1, total - 12);
          const messages: Array<{ seq: number; date: Date; subject: string; sourceText: string }> = [];
          for await (const msg of client.fetch(`${startSeq}:*`, { envelope: true, source: true })) {
            const msgDate = msg.envelope?.date ? new Date(msg.envelope.date) : new Date();
            if (msgDate.getTime() < sinceTime) continue;
            const subject = msg.envelope?.subject || '';
            const rawSource = msg.source ? msg.source.toString('utf8') : '';
            messages.push({ seq: msg.seq, date: msgDate, subject, sourceText: rawSource });
          }

          // Check newest messages first
          messages.sort((a, b) => b.date.getTime() - a.date.getTime());
          for (const m of messages) {
            if (
              !/verify|verification|security code|confirmation|confirm your email|activate|workday|greenhouse|smartrecruiters|lever|one-time|passcode/i.test(
                `${m.subject} ${m.sourceText.slice(0, 2000)}`
              )
            ) {
              continue;
            }

            // Decode quoted-printable soft line breaks
            const decoded = m.sourceText
              .replace(/=\r?\n/g, '')
              .replace(/=3D/gi, '=')
              .replace(/&amp;/gi, '&');

            // 1. Check for Workday / ATS Verification Link
            const linkMatch = decoded.match(
              /https?:\/\/[^\s"'<>]+(?:myworkdayjobs\.com|myworkday\.com|smartrecruiters\.com|greenhouse\.io)[^\s"'<>]*(?:verify|confirm|activate|token|code)[^\s"'<>]*/i
            );

            // 2. Check for 6-to-8 character OTP / Security Code
            const bodyWithoutHtml = decoded.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
            const codeMatch =
              bodyWithoutHtml.match(
                /(?:verification code|security code|confirmation code|passcode|code is|enter the code)[:\s]*([A-Za-z0-9]{6,8})\b/i
              ) || bodyWithoutHtml.match(/\b([0-9]{6})\b/);

            const candidateToken = codeMatch?.[1] || linkMatch?.[0] || '';
            if (candidateToken && CONSUMED_VERIFICATION_TOKENS.has(candidateToken)) {
              continue;
            }

            if (linkMatch?.[0] || codeMatch?.[1]) {
              if (candidateToken) {
                CONSUMED_VERIFICATION_TOKENS.add(candidateToken);
              }
              return {
                found: true,
                otpCode: codeMatch?.[1],
                verificationUrl: linkMatch?.[0],
                subject: m.subject,
              };
            }
          }
        }
      } finally {
        lock.release();
      }
      await client.logout().catch(() => {});
    } catch {
      try { client.close(); } catch {}
    }

    await new Promise(r => setTimeout(r, 4000));
  }

  return { found: false };
}

/**
 * Automatically completes in-page Email OTP or Activation Link verification on Workday, Greenhouse, and SmartRecruiters.
 */
export async function completeInPageEmailVerificationIfPrompted(page: Page, frame: Frame, onActivity?: () => void): Promise<boolean> {
  const pageText = await frame.evaluate(() => (document.body?.innerText || '').slice(0, 3000)).catch(() => '');
  const hasSecurityInput = await frame
    .locator('input[id^="security-input-"], input[id^="security-code"], #security-code, .security-code-input input, input[name*="security_code" i], input[aria-label*="security code" i], input[aria-label*="verification code" i]')
    .filter({ visible: true })
    .count()
    .catch(() => 0);

  const needsVerification =
    hasSecurityInput > 0 ||
    /\b(check your email|verify your email|verification code|security code sent to|enter the 8-character|confirm your email address to continue)\b/i.test(
      pageText
    );

  if (!needsVerification) return false;

  const res = await pollImapForVerificationCodeOrLink({ sinceMs: Date.now() - 60_000, maxWaitMs: 35_000, onActivity });
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
    await page.waitForTimeout(2500);
    return true;
  }

  // Case 2: 6-to-8 Character OTP Code Input (Workday / Greenhouse security-input-0..7 / SmartRecruiters)
  if (res.otpCode) {
    const code = res.otpCode.trim();
    // Check if Greenhouse split 6-to-8 box security code inputs exist
    const splitBoxes = frame.locator('input[id^="security-input-"], input[id^="security-code-"], .security-code-input input, input[aria-label*="Character" i], fieldset input[maxlength="1"]').filter({ visible: true });
    if ((await splitBoxes.count().catch(() => 0)) >= 6) {
      await frame.evaluate((otpCode: string) => {
        const boxes = Array.from(
          document.querySelectorAll<HTMLInputElement>(
            'input[id^="security-input-"], input[id^="security-code-"], .security-code-input input, fieldset input[maxlength="1"]'
          )
        );
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set;
        if (boxes.length >= 6) {
          const chars = otpCode.trim().split('');
          boxes.forEach((box, idx) => {
            const ch = chars[idx] ?? '';
            box.focus();
            if (nativeSetter) {
              nativeSetter.call(box, ch);
            } else {
              box.value = ch;
            }
            box.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            box.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          });
          // Also dispatch synthetic paste event on first box for React paste handlers
          try {
            const dt = new DataTransfer();
            dt.setData('text/plain', otpCode.trim());
            boxes[0]?.dispatchEvent(
              new ClipboardEvent('paste', {
                clipboardData: dt,
                bubbles: true,
                cancelable: true,
                composed: true,
              })
            );
          } catch {}
        }
      }, code).catch(() => {});

      await splitBoxes.first().click({ timeout: 2000 }).catch(() => {});
      await page.keyboard.type(code, { delay: 40 }).catch(() => {});
    } else {
      const codeInput = frame
        .locator(
          'input[id^="security-input-"], input[id^="security-code"], #security-code, input[data-automation-id*="verification" i], input[name*="code" i], input[id*="code" i], input[aria-label*="code" i], input[type="text"], input[type="number"]'
        )
        .filter({ visible: true })
        .first();
      if (await codeInput.isVisible().catch(() => false)) {
        await codeInput.fill(code).catch(() => {});
      }
    }

    const submitVerifyBtn = frame
      .locator(
        'button[data-automation-id*="verify" i], button:has-text("Verify"), button:has-text("Submit"), button:has-text("Continue"), [data-automation-id="click_filter"]'
      )
      .filter({ visible: true })
      .first();
    if (await submitVerifyBtn.isVisible().catch(() => false)) {
      await submitVerifyBtn.click({ force: true, timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }

    // Ticket GEN-118: Click post-OTP final Submit Application button on Greenhouse
    const finalSubmit = frame
      .locator(
        'button[type="submit"], input[type="submit"], button:has-text("Submit Application"), button:has-text("Submit"), button:has-text("Verify and Submit")'
      )
      .filter({ visible: true })
      .first();
    if (await finalSubmit.isVisible().catch(() => false)) {
      await finalSubmit.click({ force: true, timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(3000);
    }
    return true;
  }

  return false;
}
