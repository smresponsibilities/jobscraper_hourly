import { createHmac } from 'node:crypto';
import type { Page, Locator } from 'patchright';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CredentialVault } from './vault.js';
import { completeEmailVerification, type BrowserInteractions } from './verification.js';
import { findVerification, type ApplicationMailbox, type VerificationRequest } from './mailbox.js';
import { isAuthorizedConsentCheckbox } from './answers.js';
import { reserveStateAction } from './state-guard.js';
import { resolveEnvPortalCredentials, ensureWorkdayCompliantPassword } from './env-credentials.js';
export { ensureWorkdayCompliantPassword } from './env-credentials.js';
import { findAdaptiveLocator } from './adaptive-relocator.js';
import { saveHostSessionState } from './session-pool.js';
import { completeInPageEmailVerificationIfPrompted } from './imap-verifier.js';
import { getActiveFormFrame } from './widgets.js';

export async function hasEmailAuthenticationGate(page: Page): Promise<boolean> {
  return await page.getByRole('heading', { name: /check (?:your )?email|verify (?:your )?email|email verification|activate (?:your )?account/i }).filter({ visible: true }).count() > 0
    || await page.getByText(/^Verify your account before you sign in or request a verification email\.?$/i).filter({ visible: true }).count() > 0
    || (await page.getByText(/^An email has been sent to you\.?$/i).filter({ visible: true }).count() > 0
      && await page.getByRole('button', { name: /^Resend Account Verification$/i }).or(page.getByRole('link', { name: /^Resend Account Verification$/i })).filter({ visible: true }).count() > 0);
}

/** Normal account controls only; unknown consent and challenges remain review gates. */
export async function authenticateApplication(page: Page, options: { vault?: CredentialVault; tenant: string; email: string; candidateNames?: string[]; mailbox?: ApplicationMailbox; verification: VerificationRequest; since: Date; interaction?: BrowserInteractions; recruitmentPrivacyConsent?: boolean; submittedCredentials?: Set<'signup' | 'signin'>; beforeCredentialSubmit?: (action: 'signup' | 'signin') => Promise<void>; onDiagnostic?: (code: string) => void }): Promise<'progress' | 'review'> {
  const envCreds = resolveEnvPortalCredentials(options.email);
  const hasEnvCreds = !!(envCreds && (envCreds.email.toLowerCase() === (options.email || '').toLowerCase() || !options.email));
  let saved = options.vault?.get ? options.vault.get(options.tenant) : undefined;
  if (!saved) {
    // Accounts created before the vault existed are recorded by host in
    // workday-accounts.json. Reusing that password keeps the sign-in on the
    // account we already made, instead of deriving a new one the site rejects.
    let hostHint = '';
    try {
      hostHint = new URL(options.verification?.applicationUrl || '').hostname;
    } catch {}
    const legacy = readLegacyWorkdayAccount(hostHint) || (/[.:]/.test(options.tenant) ? readLegacyWorkdayAccount(options.tenant) : undefined);
    // The pre-vault flow created most of these accounts under a plus-addressed
    // email (name+wd_mdlz@gmail.com). That still delivers to the candidate, and
    // it is the only address that can sign in to that account.
    if (legacy && isDeliverableAlias(legacy.email, options.email)) {
      saved = legacy;
      options.vault?.adopt(options.tenant, legacy);
      options.onDiagnostic?.('legacy_account_adopted');
    }
  }
  const credential = saved || (hasEnvCreds ? envCreds! : (options.vault?.ensure ? options.vault.ensure(options.tenant, options.email, options.candidateNames)?.credential : undefined));

  // Dismiss cookie consent if present on Workday / portal screens
  const cookieConsent = page.locator('button:has-text("Accept Cookies")').filter({ visible: true }).first();
  if (await cookieConsent.isVisible().catch(() => false)) {
    await cookieConsent.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  // On Workday auth screens, click SignInWithEmailButton if present before locating email/password
  const signInWithEmail = page.locator('button[data-automation-id="SignInWithEmailButton"]').filter({ visible: true }).first();
  if (await signInWithEmail.isVisible().catch(() => false)) {
    await signInWithEmail.click().catch(() => {});
    await page.waitForTimeout(1000);
  }

  const ready = page.locator('input[type=password]:not([data-automation-id="beecatcher"]),input[type=email]:not([data-automation-id="beecatcher"]),input[autocomplete=username]:not([data-automation-id="beecatcher"]),input[autocomplete=one-time-code]:not([data-automation-id="beecatcher"]),button[data-automation-id="SignInWithEmailButton"]')
    .or(page.getByRole('heading', { name: /check (?:your )?email|verify (?:your )?email|email verification|activate (?:your )?account|forgot (?:your )?password|reset (?:your )?password|password.*(?:reset|changed|updated)/i })).filter({ visible: true });
  try { await ready.first().waitFor({ state: 'visible', timeout: 10000 }); }
  catch { options.onDiagnostic?.('no_ready_control'); return 'review'; }

  if (await signInWithEmail.isVisible().catch(() => false)) {
    await signInWithEmail.click().catch(() => {});
    await page.waitForTimeout(1000);
  }

  const click = async (control: Locator) => {
    if (!await reserveStateAction(page.mainFrame(), control, 'authentication')) throw new Error('Authentication action already dispatched on this form state');
    if (options.interaction) await options.interaction.click(control); else await control.click();
  };
  const type = async (control: Locator, value: string) => {
    const isHoneypot = await control.evaluate((el: Element) => {
      return el.getAttribute('data-automation-id') === 'beecatcher' || /beecatcher|honey-?pot/i.test([el.id, el.getAttribute('name'), el.getAttribute('data-automation-id')].join(' '));
    }).catch(() => false);
    if (isHoneypot) return;
    if (options.interaction) await options.interaction.type(control, value); else await control.fill(value);
  };
  const activate = async (url: string): Promise<'progress'> => {
    const activation = await page.context().newPage();
    try {
      await activation.goto(url, { waitUntil: 'domcontentloaded' });
      // Activation can require a client-side request after DOM readiness.
      await activation.waitForLoadState('networkidle', { timeout: 10000 });
    } finally { await activation.close(); }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await saveHostSessionState(page.context(), page.url()).catch(() => {});
    return 'progress';
  };
  const applyPrivacyConsent = async () => {
    for (const checkbox of await page.locator('input[type=checkbox]').filter({ visible: true }).all()) {
      if (await checkbox.isChecked()) continue;
      const label = await checkbox.evaluate(element => Array.from((element as HTMLInputElement).labels || []).map(label => label.textContent || '').join(' ') || element.getAttribute('aria-label') || '');
      if (!isAuthorizedConsentCheckbox(label)) continue;
      // A consent box that detaches mid-click must not abort the sign-in; the
      // required-consent check below still reports an unresolved gate.
      try { await click(checkbox); } catch {}
    }
  };
  const passwords = page.locator('input[type=password]:not([data-automation-id="beecatcher"])').filter({ visible: true });
  if (await hasEmailAuthenticationGate(page) && await passwords.count()) {
    if (!options.mailbox) return 'review';
    const mail = await findVerification(options.mailbox, options.verification);
    if (mail?.activationUrl) {
      return activate(mail.activationUrl);
    }
    if (!await page.locator('html[data-autoapply-activation-requested]').count()) {
      const resend = page.getByRole('button', { name: /^Resend Account Verification$/i }).or(page.getByRole('link', { name: /^Resend Account Verification$/i })).filter({ visible: true });
      if (await resend.count() === 1) {
        await page.locator('html').evaluate(element => element.setAttribute('data-autoapply-activation-requested', 'true'));
        await click(resend);
      }
    }
    return 'review';
  }
  const headings = (await page.getByRole('heading').allTextContents()).join(' ');
  const recovery = options.vault?.recovery ? options.vault.recovery(options.tenant) : undefined;
  const resetForm = /reset (?:your )?password|set (?:a )?new password|change password/i.test(headings);
  const recoverySuccess = page.locator('h1,h2,[role=status],[role=alert]').filter({ hasText: /^(?:your )?password (?:has been |was )?(?:successfully )?(?:reset|changed|updated)[.!\s]*$/i }).filter({ visible: true });
  if (recovery?.recovery && !recovery.recovery.confirmed && await recoverySuccess.count()) {
    options.vault?.confirmRecovery?.(options.tenant);
    await page.goto(options.verification.applicationUrl, { waitUntil: 'domcontentloaded' });
    await saveHostSessionState(page.context(), page.url()).catch(() => {});
    return 'progress';
  }
  if (resetForm && await passwords.count() >= 2 && recovery?.recovery && !recovery.recovery.confirmed) {
    for (const password of await passwords.all()) await type(password, recovery.password);
    await applyPrivacyConsent();
    if (await page.locator('input[type=checkbox]:required:not(:checked)').filter({ visible: true }).count()) return 'review';
    const submit = page.getByRole('button', { name: /^(?:reset|change|save|set(?: new)?) password$/i }).filter({ visible: true });
    if (await submit.count() !== 1 || !await submit.isEnabled()) return 'review';
    await click(submit);
    return 'progress';
  }
  if (!await passwords.count()) {
    if (!options.mailbox) return 'review';
    const sendReset = page.getByRole('button', { name: /^(?:reset password|send (?:password )?reset (?:link|email)|request (?:password )?reset)$/i }).filter({ visible: true });
    if (/forgot (?:your )?password|reset (?:your )?password/i.test(headings) && await sendReset.count() === 1) {
      const email = page.locator('input[type=email]:not([data-automation-id="beecatcher"]),input[autocomplete=username]:not([data-automation-id="beecatcher"])').filter({ visible: true });
      if (await email.count() !== 1 || !await sendReset.isEnabled()) return 'review';
      if (!options.vault?.requestRecovery || !options.vault.requestRecovery(options.tenant, options.email, options.candidateNames)) return 'review';
      await type(email, options.email);
      await click(sendReset);
      return 'progress';
    }
    if (recovery?.recovery && !recovery.recovery.confirmed && /check (?:your )?email|reset link|email.*password/i.test(await page.locator('body').innerText())) {
      const mail = await findVerification(options.mailbox, { ...options.verification, since: new Date(recovery.recovery.requestedAt), purpose: 'password_reset' });
      if (!mail?.activationUrl) return 'review';
      await page.goto(mail.activationUrl, { waitUntil: 'domcontentloaded' });
      return 'progress';
    }
    const otp = await completeEmailVerification(page, options.mailbox, options.verification, options.interaction);
    if (otp.status === 'completed') {
      await saveHostSessionState(page.context(), page.url()).catch(() => {});
      return 'progress';
    }
    const text = await page.locator('body').innerText();
    if (/check (?:your )?email|activation link|verify (?:your )?email/i.test(text)) {
      const mail = await findVerification(options.mailbox, options.verification);
      if (mail?.activationUrl) {
        return activate(mail.activationUrl);
      }
    }
    return 'review';
  }
  if (!credential?.email || !credential.password) return 'review';
  if (credential.email && options.email && credential.email.toLowerCase() !== options.email.toLowerCase()
    && !isDeliverableAlias(credential.email, options.email)) {
    options.onDiagnostic?.('credential_email_mismatch');
    return 'review';
  }

  let currentHost = '';
  try {
    currentHost = new URL(page.url()).hostname;
  } catch {}
  if (!currentHost && options.tenant) {
    try {
      currentHost = options.tenant.includes('://') ? new URL(options.tenant).hostname : options.tenant;
    } catch {}
  }
  if (!currentHost && options.verification?.applicationUrl) {
    try {
      currentHost = new URL(options.verification.applicationUrl).hostname;
    } catch {}
  }
  const errors = (await page.locator('[role=alert],.error,.error-message,[data-automation-id=errorMessage]').allTextContents()).join(' ');
  if (/account already exists|email.*already (?:registered|in use)/i.test(errors)) {
    if (saved && !options.submittedCredentials?.has('signin')) {
      const signIn = page.getByRole('link', { name: /^sign in$/i }).or(page.getByRole('button', { name: /^sign in$/i })).filter({ visible: true });
      if (await signIn.count() === 1) { await click(signIn); return 'progress'; }
    }
    if (!options.mailbox) return 'review';
    const forgot = page.getByRole('link', { name: /^forgot (?:your )?password\??$|^reset password$/i }).or(page.getByRole('button', { name: /^forgot (?:your )?password\??$|^reset password$/i })).filter({ visible: true });
    if (await forgot.count() !== 1) return 'review';
    if (recovery?.recovery && recovery.recovery.attempts >= 2 && Date.now() - Date.parse(recovery.recovery.requestedAt) < 30 * 60 * 1000) return 'review';
    await click(forgot);
    return 'progress';
  }

  const executeSignupFlow = async (cred: { email: string; password: string }): Promise<'progress' | 'review'> => {
    const emailToUse = cred.email;
    const compliantPw = cred.password;

    const fillAndSubmitSignup = async (targetEmail: string): Promise<boolean> => {
      const emailInput = page.locator(
        '[data-automation-id="formField-email"] input, [data-automation-id="email"] input, input[data-automation-id="email"]:not([data-automation-id="beecatcher"]), input[type="email"]:not([data-automation-id="beecatcher"]), input[autocomplete="username"]:not([data-automation-id="beecatcher"]), input[aria-label*="Email" i]:not([data-automation-id="beecatcher"]), input[id="input-4"]:not([type="password"]), input[id^="input-"]:not([type="password"])'
      ).filter({ visible: true });

      const hasChangeEmail = await page.locator('button:has-text("Change Email"), a:has-text("Change Email")').filter({ visible: true }).count() > 0;
      if (await emailInput.count() > 0) {
        await type(emailInput.first(), targetEmail);
      } else if (!hasChangeEmail) {
        options.onDiagnostic?.('email_control_missing');
        return false;
      }

      const pwInputs = page.locator('input[type="password"]:not([data-automation-id="beecatcher"])').filter({ visible: true });
      for (const p of await pwInputs.all()) {
        await type(p, compliantPw);
      }

      await applyPrivacyConsent();

      if (await page.locator('input[type=checkbox]:required:not(:checked)').filter({ visible: true }).count()) {
        options.onDiagnostic?.('required_consent_unresolved');
        return false;
      }

      const rawCreateSubmit = page.locator(
        '[data-automation-id="createAccountSubmitButton"], [data-automation-id="click_filter"], [data-automation-id="signInSubmitButton"], button[type="submit"]'
      ).or(page.getByRole('button', { name: /^create (?:an? )?account$|^register$|^sign in$|^continue$/i })).filter({ visible: true });
      const submit = (await findAdaptiveLocator(page, rawCreateSubmit, 'auth_create_account_submit')).first();
      if (!await submit.isVisible().catch(() => false) || !await submit.isEnabled().catch(() => false)) {
        options.onDiagnostic?.('submit_control_unavailable');
        return false;
      }

      if (!options.submittedCredentials || !options.beforeCredentialSubmit) return false;
      options.submittedCredentials.add('signup');
      await options.beforeCredentialSubmit('signup');
      await click(submit);
      options.onDiagnostic?.('signup_submitted');
      await page.waitForTimeout(3000);
      return true;
    };

    const submitted = await fillAndSubmitSignup(emailToUse);
    if (!submitted) return 'review';

    // Call completeInPageEmailVerificationIfPrompted if Workday asks to verify email
    try {
      await completeInPageEmailVerificationIfPrompted(page, getActiveFormFrame(page), undefined, {
        sinceMs: options.since.getTime() - 10_000,
        companyHint: options.tenant || currentHost,
      });
    } catch {}

    await saveHostSessionState(page.context(), page.url()).catch(() => {});
    return 'progress';
  };

  const looksLikeSignup = (await passwords.count()) > 1 || /create (?:an? )?account|register/i.test(headings);
  const signup = looksLikeSignup && !saved;
  options.onDiagnostic?.(signup ? 'signup_form' : 'signin_form');

  // We already hold this account, so a registration screen means the tenant
  // wants us to sign in instead. Registering again only produces
  // "account already exists" and a recovery round trip.
  if (looksLikeSignup && saved && !await page.locator('html[data-autoapply-signin-switch]').count()) {
    const signInSwitch = page.getByRole('link', { name: /^sign in$/i }).or(page.getByRole('button', { name: /^sign in$/i })).filter({ visible: true });
    if (await signInSwitch.count() === 1) {
      await page.locator('html').evaluate(element => element.setAttribute('data-autoapply-signin-switch', 'true'));
      await click(signInSwitch);
      options.onDiagnostic?.('switched_to_signin');
      return 'progress';
    }
  }

  if (signup) {
    if (options.submittedCredentials?.has('signup')) {
      options.onDiagnostic?.('credential_submit_already_attempted');
      return 'review';
    }
    return await executeSignupFlow(credential);
  }

  // Not signup form: check if we should first switch to Create Account
  if (!signup && (!saved && !hasEnvCreds)) {
    const rawCreate = page.getByRole('button', { name: /^create (?:an? )?account$|^register$/i }).or(page.getByRole('link', { name: /^create (?:an? )?account$|^register$/i })).or(page.locator('[data-automation-id="createAccountLink"]')).filter({ visible: true });
    const create = await findAdaptiveLocator(page, rawCreate, 'auth_create_account_trigger');
    if (await create.count() === 1) {
      await click(create.first());
      return 'progress';
    }
  }

  if (!signup) {
    if (!options.submittedCredentials?.has('signin')) {
      const email = page.locator('[data-automation-id="formField-email"] input, [data-automation-id="email"] input, input[data-automation-id="email"]:not([data-automation-id="beecatcher"]), input[type="email"]:not([data-automation-id="beecatcher"]), input[autocomplete="username"]:not([data-automation-id="beecatcher"]), input[aria-label*="Email" i]:not([data-automation-id="beecatcher"]), input[id="input-4"]:not([type="password"])').filter({ visible: true }).first();
      const password = page.locator('input[data-automation-id="password"]:not([data-automation-id="beecatcher"]), input[type="password"]:not([data-automation-id="beecatcher"]), input[id="input-6"]').filter({ visible: true }).first();
      let rawSubmit = page.locator('[data-automation-id="signInSubmitButton"]').or(page.getByRole('button', { name: /^sign in$|^log in$/i })).filter({ visible: true });
      if (await rawSubmit.count() > 1) rawSubmit = rawSubmit.and(page.locator('[data-automation-id="signInSubmitButton"]'));
      const submit = await findAdaptiveLocator(page, rawSubmit, 'auth_sign_in_submit');
      const submitBtn = submit.first();
      if (!await email.isVisible().catch(() => false) || !await password.isVisible().catch(() => false) || !await submitBtn.isVisible().catch(() => false) || !await submitBtn.isEnabled().catch(() => false)) {
        options.onDiagnostic?.('submit_control_unavailable');
        return 'review';
      }
      await type(email, credential.email);
      await type(password, credential.password);
      await applyPrivacyConsent();
      if (await page.locator('input[type=checkbox]:required:not(:checked)').filter({ visible: true }).count()) { options.onDiagnostic?.('required_consent_unresolved'); return 'review'; }
      if (!options.submittedCredentials || !options.beforeCredentialSubmit) return 'review';
      options.submittedCredentials.add('signin');
      await options.beforeCredentialSubmit('signin');

      const passwordVisible = async () => (await page.locator('input[type="password"]:not([data-automation-id="beecatcher"])').filter({ visible: true }).count()) > 0;
      let submitted = false;
      try {
        await submitBtn.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await click(submitBtn);
        submitted = true;
      } catch {}

      if (!submitted) {
        // Workday frequently paints an overlay across the Sign In button, so
        // pointer hit-testing fails even though the control is enabled. Press
        // Enter in the password field, then dispatch the form submit in page
        // code, which performs the same mutation without a pointer click.
        options.onDiagnostic?.('signin_submit_via_keyboard');
        await password.press('Enter').catch(() => {});
        await page.waitForTimeout(1500);
        if (await passwordVisible()) {
          const dispatched = await page.evaluate(() => {
            const button = document.querySelector<HTMLElement>('[data-automation-id="signInSubmitButton"]');
            const form = button?.closest('form') as HTMLFormElement | null;
            if (form) {
              if (typeof form.requestSubmit === 'function') form.requestSubmit();
              else form.submit();
              return true;
            }
            button?.click();
            return Boolean(button);
          }).catch(() => false);
          if (!dispatched) {
            options.onDiagnostic?.('signin_submit_unclickable');
            return 'review';
          }
          await page.waitForTimeout(2500);
        }
      }

      options.onDiagnostic?.('signin_submitted');
      await page.waitForTimeout(1000);

      const stillSignIn = await passwordVisible();
      if (!stillSignIn) {
        if (currentHost) markWorkdayHostVerified(currentHost);
        await saveHostSessionState(page.context(), page.url()).catch(() => {});
        return 'progress';
      }

      return 'review';
    }

    options.onDiagnostic?.('credential_submit_already_attempted');
    return 'review';
  }

  return 'review';
}

export const WORKDAY_ACCOUNTS_FILE = path.resolve('state/autoapply/portal-review/workday-accounts.json');

/** Candidates only; callers must not automatically retry passwords against an account. */
export function resolveCandidatePortalPasswordChain(hostOrTenant: string, targetEmail: string, vault?: CredentialVault): string[] {
  const legacy = readLegacyWorkdayAccount(hostOrTenant);
  const saved = vault?.get(hostOrTenant);
  const env = resolveEnvPortalCredentials(targetEmail);
  const candidates = [legacy, saved, env].filter(item => item && isDeliverableAlias(item.email, targetEmail)).map(item => item!.password).filter(Boolean);
  const base = candidates[0];
  if (base) candidates.push(ensureWorkdayCompliantPassword(base));
  return [...new Set(candidates)];
}

/**
 * `name+tag@domain` delivers to `name@domain`, so a per-employer account created
 * under a plus address is still the candidate's own account.
 */
export function isDeliverableAlias(candidate: string, target: string): boolean {
  if (!candidate || !target) return false;
  const normalize = (value: string) => {
    const [local = '', domain = ''] = value.trim().toLowerCase().split('@');
    return `${local.split('+')[0]}@${domain}`;
  };
  return normalize(candidate) === normalize(target);
}

/** Reads a credential saved by the pre-vault account creation flow, keyed by host. */
export function readLegacyWorkdayAccount(host: string): { email: string; password: string } | undefined {
  if (!host) return undefined;
  try {
    if (!fs.existsSync(WORKDAY_ACCOUNTS_FILE)) return undefined;
    const accounts = JSON.parse(fs.readFileSync(WORKDAY_ACCOUNTS_FILE, 'utf8')) as Record<string, { email?: unknown; password?: unknown }>;
    const entry = accounts[host] || accounts[host.toLowerCase()];
    if (entry && typeof entry.email === 'string' && typeof entry.password === 'string' && entry.password.length > 0) {
      return { email: entry.email, password: entry.password };
    }
  } catch {}
  return undefined;
}
export const VERIFIED_WORKDAY_HOSTS_FILE = path.resolve('state/autoapply/portal-review/verified-workday-hosts.json');

export function isWorkdayHostVerified(host: string): boolean {
  try {
    if (fs.existsSync(VERIFIED_WORKDAY_HOSTS_FILE)) {
      const list = JSON.parse(fs.readFileSync(VERIFIED_WORKDAY_HOSTS_FILE, 'utf8'));
      if (Array.isArray(list) && list.includes(host)) return true;
    }
    if (fs.existsSync(WORKDAY_ACCOUNTS_FILE)) {
      const accounts = JSON.parse(fs.readFileSync(WORKDAY_ACCOUNTS_FILE, 'utf8'));
      if (accounts && accounts[host]) return true;
    }
  } catch {}
  return false;
}

export function markWorkdayHostVerified(host: string): void {
  try {
    let list: string[] = [];
    if (fs.existsSync(VERIFIED_WORKDAY_HOSTS_FILE)) {
      list = JSON.parse(fs.readFileSync(VERIFIED_WORKDAY_HOSTS_FILE, 'utf8'));
    }
    if (!list.includes(host)) {
      list.push(host);
      fs.mkdirSync(path.dirname(VERIFIED_WORKDAY_HOSTS_FILE), { recursive: true });
      fs.writeFileSync(VERIFIED_WORKDAY_HOSTS_FILE, JSON.stringify(list, null, 2), 'utf8');
    }
  } catch {}
}

/** Legacy entry point cannot safely checkpoint credential submissions. */
export async function authenticateWorkdayPortal(_page: Page, _email: string, _rawPassword: string): Promise<{ authenticated: boolean; actionTaken: string }> {
  return { authenticated: false, actionTaken: 'review_required' };
}


export function generateRfc6238TotpCode(base32Seed: string, nowMs = Date.now(), stepSeconds = 30, digits = 6): string {
  if (!Number.isFinite(nowMs) || nowMs < 0 || !Number.isInteger(stepSeconds) || stepSeconds < 1 || !Number.isInteger(digits) || digits < 6 || digits > 8) throw new Error('Invalid TOTP parameters');
  const seed = base32Seed.toUpperCase().replace(/\s/g, '');
  if (!/^[A-Z2-7]+={0,6}$/.test(seed)) throw new Error('Invalid Base32 seed');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, buffer = 0; const bytes: number[] = [];
  for (const char of seed.replace(/=+$/, '')) { buffer = (buffer << 5) | alphabet.indexOf(char); bits += 5; if (bits >= 8) { bits -= 8; bytes.push((buffer >>> bits) & 255); buffer &= (1 << bits) - 1; } }
  if (!bytes.length || buffer !== 0) throw new Error('Invalid Base32 seed');
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(nowMs / 1000 / stepSeconds)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest(); const offset = digest[19]! & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits)).padStart(digits, '0');
}
