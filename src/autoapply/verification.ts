import type { Page, Locator } from 'patchright';
import { findVerification, type ApplicationMailbox, type VerificationRequest } from './mailbox.js';

export interface VerificationProgress {
  status: 'not_present' | 'waiting' | 'completed';
  messageId?: string;
}

export interface BrowserInteractions {
  click(control: Locator): Promise<void>;
  type(control: Locator, value: string): Promise<void>;
}

/** Completes email verification through normal portal controls, never CAPTCHA. */
export async function completeEmailVerification(page: Page, mailbox: ApplicationMailbox, request: VerificationRequest, interaction?: BrowserInteractions): Promise<VerificationProgress> {
  try {
  let inputs = page.locator('input[autocomplete="one-time-code"]').filter({ visible: true });
  const text = await page.locator('body').innerText();
  const emailGate = /(?:security|verification|confirmation|one.time) code|code (?:we |has been )?sent|verify (?:your )?email/i.test(text);
  if (!await inputs.count() && emailGate) inputs = page.locator('input[maxlength="1"][inputmode="numeric"],input[maxlength="1"][aria-label*="code" i]').filter({ visible: true });
  if (!await inputs.count() && emailGate) inputs = page.getByRole('textbox', { name: /(?:verification|security|confirmation|email|one.time) code/i }).filter({ visible: true });
  const count = await inputs.count();
  if (!count) return { status: 'not_present' };
  if (![1, 6, 8].includes(count)) return { status: 'waiting' };
  const verification = await findVerification(mailbox, request);
  if (!verification?.code || (count > 1 && verification.code.length !== count)) return { status: 'waiting' };
  for (let index = 0; index < count; index++) {
    const input = inputs.nth(index);
    const value = count === 1 ? verification.code : verification.code[index]!;
    const numeric = await input.getAttribute('inputmode') === 'numeric' || await input.getAttribute('type') === 'number';
    if (numeric && !/^\d+$/.test(value)) return { status: 'waiting' };
  }
  for (let index = 0; index < count; index++) {
    const input = inputs.nth(index); const value = count === 1 ? verification.code : verification.code[index]!;
    if (interaction) await interaction.type(input, value); else await input.fill(value);
  }
  const verify = page.getByRole('button', { name: /^(?:verify(?: (?:email|code))?(?: and (?:continue|submit))?|confirm(?: code)?|continue|activate account)$/i }).filter({ visible: true });
  if (await verify.count() !== 1 || !await verify.isEnabled()) return { status: 'waiting', messageId: verification.messageId };
  if (interaction) await interaction.click(verify); else await verify.click();
  return { status: 'completed', messageId: verification.messageId };
  } catch {
    // Browser error call logs can contain the entered OTP. Never propagate them.
    return { status: 'waiting' };
  }
}
