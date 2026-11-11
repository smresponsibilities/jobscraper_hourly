import type { Page, Locator } from 'patchright';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CredentialVault } from './vault.js';
import { completeEmailVerification, type BrowserInteractions } from './verification.js';
import { findVerification, type ApplicationMailbox, type VerificationRequest } from './mailbox.js';
import { isRecruitmentPrivacyAcknowledgement } from './answers.js';
import { reserveStateAction } from './state-guard.js';
import { resolveEnvPortalCredentials, ensureWorkdayCompliantPassword, WORKDAY_COMPLEXITY_FALLBACK_PASSWORD } from './env-credentials.js';
export { ensureWorkdayCompliantPassword, WORKDAY_COMPLEXITY_FALLBACK_PASSWORD } from './env-credentials.js';
import { findAdaptiveLocator } from './adaptive-relocator.js';
import { saveHostSessionState } from './session-pool.js';
import { makeGmailTenantAlias, completeInPageEmailVerificationIfPrompted } from './imap-verifier.js';
import { getActiveFormFrame } from './widgets.js';

export async function hasEmailAuthenticationGate(page: Page): Promise<boolean> {
  return await page.getByRole('heading', { name: /check (?:your )?email|verify (?:your )?email|email verification|activate (?:your )?account/i }).filter({ visible: true }).count() > 0
    || await page.getByText(/^Verify your account before you sign in or request a verification email\.?$/i).filter({ visible: true }).count() > 0
    || (await page.getByText(/^An email has been sent to you\.?$/i).filter({ visible: true }).count() > 0
      && await page.getByRole('button', { name: /^Resend Account Verification$/i }).or(page.getByRole('link', { name: /^Resend Account Verification$/i })).filter({ visible: true }).count() > 0);
}

/** Normal account controls only; unknown consent and challenges remain review gates. */
export async function authenticateApplication(page: Page, options: { vault?: CredentialVault; tenant: string; email: string; candidateNames?: string[]; mailbox?: ApplicationMailbox; verification: VerificationRequest; since: Date; interaction?: BrowserInteractions; recruitmentPrivacyConsent?: boolean; submittedCredentials?: Set<'signup' | 'signin'>; beforeCredentialSubmit?: (action: 'signup' | 'signin') => Promise<void>; onDiagnostic?: (code: string) => void }): Promise<'progress' | 'review'> {
  // Ticket GEN-478.2 Step A: Always Auto-Provision .env Credentials Inside authenticateApplication
  let envCreds = resolveEnvPortalCredentials(options.email);
  if (envCreds?.password) {
    envCreds.password = ensureWorkdayCompliantPassword(envCreds.password);
  }
  const hasEnvCreds = !!(envCreds && (envCreds.email.toLowerCase() === (options.email || '').toLowerCase() || !options.email));
  const saved = options.vault?.get ? options.vault.get(options.tenant) : undefined;
  let credential: { email: string; password: string } | undefined = hasEnvCreds
    ? envCreds!
    : (saved || (options.vault?.ensure ? options.vault.ensure(options.tenant, options.email, options.candidateNames)?.credential : undefined));

  if (!credential || !credential.email || !credential.password) {
    const fallbackEnv = resolveEnvPortalCredentials(options.email);
    const email = fallbackEnv?.email || options.email || process.env.AUTOAPPLY_EMAIL || 'shivam2314.be22@chitkara.edu.in';
    const rawPw = fallbackEnv?.password || process.env.AUTOAPPLY_WORKDAY_PASSWORD || process.env.AUTOAPPLY_PASSWORD || WORKDAY_COMPLEXITY_FALLBACK_PASSWORD;
    const password = ensureWorkdayCompliantPassword(rawPw);
    credential = { email, password };
  }

  // Dismiss cookie consent if present on Workday / portal screens
  const cookieConsent = page.locator('button:has-text("Accept Cookies"), button:has-text("Accept"), [data-automation-id="legalNoticeAcceptButton"]').filter({ visible: true }).first();
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
    if (options.recruitmentPrivacyConsent !== true) return;
    for (const checkbox of await page.locator('input[type=checkbox]').filter({ visible: true }).all()) {
      if (await checkbox.isChecked()) continue;
      const label = await checkbox.evaluate(element => Array.from((element as HTMLInputElement).labels || []).map(label => label.textContent || '').join(' ') || element.getAttribute('aria-label') || '');
      if (isRecruitmentPrivacyAcknowledgement(label)) await click(checkbox);
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
  if (!credential) throw new Error('Tenant credential could not be resolved');
  if (credential.email && options.email && credential.email.toLowerCase() !== options.email.toLowerCase()) {
    credential.email = options.email;
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
  const isWorkday = currentHost.includes('myworkdayjobs.com') ||
    page.url().includes('myworkdayjobs.com') ||
    (options.tenant && options.tenant.includes('myworkdayjobs.com')) ||
    options.verification?.provider === 'workday';
  const isVerifiedHost = currentHost ? isWorkdayHostVerified(currentHost) : false;

  const body = await page.locator('body').innerText();
  const errors = (await page.locator('[role=alert],.error,.error-message,[data-automation-id=errorMessage]').allTextContents()).join(' ');
  if (/account already exists|email.*already (?:registered|in use)/i.test(errors)) {
    if (!options.mailbox) return 'review';
    const forgot = page.getByRole('link', { name: /^forgot (?:your )?password\??$|^reset password$/i }).or(page.getByRole('button', { name: /^forgot (?:your )?password\??$|^reset password$/i })).filter({ visible: true });
    if (await forgot.count() !== 1) return 'review';
    if (recovery?.recovery && recovery.recovery.attempts >= 2 && Date.now() - Date.parse(recovery.recovery.requestedAt) < 30 * 60 * 1000) return 'review';
    await click(forgot);
    return 'progress';
  }

  const executeSignupFlow = async (cred: { email: string; password: string }): Promise<'progress' | 'review'> => {
    let emailToUse = cred.email;
    const compliantPw = ensureWorkdayCompliantPassword(cred.password);

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

      // Ticket GEN-478.2 Step C: Check all visible checkboxes ([data-automation-id="createAccountCheckbox"], input[type="checkbox"])
      const checkboxes = page.locator('[data-automation-id="createAccountCheckbox"], input[type="checkbox"]').filter({ visible: true });
      for (const cb of await checkboxes.all()) {
        try {
          if (!await cb.isChecked()) {
            await click(cb);
          }
        } catch {}
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

      options.submittedCredentials?.add('signup');
      await options.beforeCredentialSubmit?.('signup');
      try {
        await click(submit);
      } catch {
        await submit.click({ force: true }).catch(() => {});
      }
      options.onDiagnostic?.('signup_submitted');
      await page.waitForTimeout(3000);
      return true;
    };

    const submitted = await fillAndSubmitSignup(emailToUse);
    if (!submitted) return 'review';

    // Step C: If Workday shows "already exists" / "already registered", switch email to makeGmailTenantAlias and submit Create Account again
    const alertTexts = (await page.locator('[role=alert],.error,.error-message,[data-automation-id=errorMessage]').allTextContents().catch(() => [])).join(' ');
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const accountExists = /already exists|already registered|account with this email|email.*already (?:registered|in use)/i.test(alertTexts) ||
      /already exists|already registered/i.test(bodyText);

    if (accountExists) {
      options.onDiagnostic?.('account_already_exists_collision');
      let aliasEmail = makeGmailTenantAlias(cred.email, page.url() || currentHost);
      if (aliasEmail === cred.email && cred.email.includes('@')) {
        const [l, d] = cred.email.split('@');
        aliasEmail = `${l}+wd${Date.now().toString().slice(-4)}@${d}`;
      }
      emailToUse = aliasEmail;
      await fillAndSubmitSignup(emailToUse);
    }

    // Call completeInPageEmailVerificationIfPrompted if Workday asks to verify email
    try {
      await completeInPageEmailVerificationIfPrompted(page, getActiveFormFrame(page), undefined, {
        sinceMs: options.since.getTime() - 10_000,
        companyHint: options.tenant || currentHost,
      });
    } catch {}

    if (currentHost) {
      markWorkdayHostVerified(currentHost);
    }
    await saveHostSessionState(page.context(), page.url()).catch(() => {});
    return 'progress';
  };

  const signup = (await passwords.count()) > 1 || /create (?:an? )?account|register/i.test(headings);
  options.onDiagnostic?.(signup ? 'signup_form' : 'signin_form');

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
    // Ticket GEN-478.2 Step B: Transition from Failed Sign In to Create Account Instead of Returning 'review'
    const shouldGoToCreateAccount = Boolean(
      options.submittedCredentials?.has('signin') || (isWorkday && !isVerifiedHost)
    );

    const rawCreateLink = page.locator(
      '[data-automation-id="createAccountLink"], button:has-text("Create Account"), a:has-text("Create Account"), [data-automation-id="noAccountLink"]'
    ).filter({ visible: true });

    if (shouldGoToCreateAccount) {
      const createLink = (await findAdaptiveLocator(page, rawCreateLink, 'auth_create_account_fallback')).first();
      if (await createLink.isVisible().catch(() => false)) {
        options.onDiagnostic?.('signin_fallback_create_account');
        await createLink.click({ force: true }).catch(() => {});
        await page.waitForTimeout(1500);
        return await executeSignupFlow(credential);
      }
    }

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
      options.submittedCredentials?.add('signin');
      await options.beforeCredentialSubmit?.('signin');
      await click(submitBtn);
      options.onDiagnostic?.('signin_submitted');
      await page.waitForTimeout(1000);

      const stillSignIn = (await page.locator('input[type="password"]:not([data-automation-id="beecatcher"])').filter({ visible: true }).count()) > 0;
      if (!stillSignIn) {
        if (currentHost) markWorkdayHostVerified(currentHost);
        await saveHostSessionState(page.context(), page.url()).catch(() => {});
        return 'progress';
      }

      // Sign In failed and password still visible! Transition to Create Account
      const createFallback = (await findAdaptiveLocator(page, rawCreateLink, 'auth_create_account_fallback')).first();
      if (await createFallback.isVisible().catch(() => false)) {
        options.onDiagnostic?.('signin_fallback_create_account');
        await createFallback.click({ force: true }).catch(() => {});
        await page.waitForTimeout(1500);
        return await executeSignupFlow(credential);
      }

      return 'progress';
    }

    const createLink = (await findAdaptiveLocator(page, rawCreateLink, 'auth_create_account_fallback')).first();
    if (await createLink.isVisible().catch(() => false)) {
      options.onDiagnostic?.('signin_fallback_create_account');
      await createLink.click({ force: true }).catch(() => {});
      await page.waitForTimeout(1500);
      return await executeSignupFlow(credential);
    }

    options.onDiagnostic?.('credential_submit_already_attempted');
    return isWorkday ? 'progress' : 'review';
  }

  return 'review';
}

export const WORKDAY_ACCOUNTS_FILE = path.resolve('state/autoapply/portal-review/workday-accounts.json');
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

// ensureWorkdayCompliantPassword imported and re-exported from env-credentials.js above

export async function authenticateWorkdayPortal(
  page: Page,
  email: string,
  rawPassword: string
): Promise<{ authenticated: boolean; actionTaken: string }> {
  const password = ensureWorkdayCompliantPassword(rawPassword);

  // 1. Dismiss cookie banner if blocking pointer events
  const cookieBtn = page
    .locator('button[data-automation-id="legalNoticeAcceptButton"], button:has-text("Accept Cookies")')
    .first();
  if (await cookieBtn.isVisible().catch(() => false)) {
    await cookieBtn.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }

  // 2. Click "Sign in with email" accordion button if present
  const emailAccordion = page
    .locator('[data-automation-id="SignInWithEmailButton"], button:has-text("Sign in with email")')
    .first();
  if (await emailAccordion.isVisible().catch(() => false)) {
    await emailAccordion.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }

  // GEN-109: Open Sign In modal via utilityButtonSignIn if Workday rendered the unauthenticated shell
  const hasAuthInputs = await page
    .locator('[data-automation-id="formField-email"] input, [data-automation-id="email"], input[type="password"]')
    .first()
    .isVisible()
    .catch(() => false);
  if (!hasAuthInputs) {
    const utilityBtn = page.locator('[data-automation-id="utilityButtonSignIn"]').first();
    if (await utilityBtn.isVisible().catch(() => false)) {
      await utilityBtn.click({ timeout: 5000 }).catch(() => {});
      await page
        .locator(
          '[data-automation-id="formField-email"] input, [data-automation-id="email"], input[type="password"], [data-automation-id="createAccountLink"]'
        )
        .first()
        .waitFor({ state: 'visible', timeout: 7000 })
        .catch(() => {});
    }
  }

  // Wait briefly for auth inputs to mount
  await page
    .locator('input[type="password"]:not([data-automation-id="beecatcher"]), input[type="email"], [data-automation-id="SignInWithEmailButton"]')
    .first()
    .waitFor({ state: 'visible', timeout: 4000 })
    .catch(() => {});

  const getVisiblePasswordInputs = () =>
    page
      .locator('input[type="password"]:not([data-automation-id="beecatcher"]):not([name*="honeypot"])')
      .filter({ visible: true });

  const pwCount = await getVisiblePasswordInputs().count().catch(() => 0);
  if (pwCount === 0) {
    return { authenticated: true, actionTaken: 'no_auth_form_present' };
  }

  const recordWorkdayAccount = (accountEmail: string, usedPw: string) => {
    try {
      let accounts: Record<string, any> = {};
      if (fs.existsSync(WORKDAY_ACCOUNTS_FILE)) {
        accounts = JSON.parse(fs.readFileSync(WORKDAY_ACCOUNTS_FILE, 'utf8'));
      }
      const host = new URL(page.url()).hostname;
      accounts[host] = {
        email: accountEmail,
        password: usedPw,
        updatedAt: new Date().toISOString(),
      };
      fs.mkdirSync(path.dirname(WORKDAY_ACCOUNTS_FILE), { recursive: true });
      fs.writeFileSync(WORKDAY_ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf8');
    } catch {}
  };

  const WORKDAY_EMAIL_SELECTOR =
    '[data-automation-id="formField-email"] input, [data-automation-id="email"] input, input[data-automation-id="email"], input[type="email"], input[aria-label*="Email" i], input[id="input-4"], input[id^="input-"]:not([type="password"])';

  const fillAndSubmitCreateAccount = async (targetEmail: string, pwToUse: string) => {
    const emailInput = page
      .locator(WORKDAY_EMAIL_SELECTOR)
      .filter({ visible: true })
      .first();
    if (await emailInput.isVisible().catch(() => false)) {
      await emailInput.fill(targetEmail).catch(() => {});
      await emailInput.evaluate((el: HTMLInputElement, val: string) => {
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      }, targetEmail).catch(() => {});
    }

    const pws = getVisiblePasswordInputs();
    const count = await pws.count();
    for (let i = 0; i < count; i++) {
      await pws.nth(i).fill(pwToUse).catch(() => {});
    }

    // Ticket GEN-161: Workday Enterprise createAccountCheckbox & Auth Modal Consent Auto-Check
    const checkWorkdayCreateAccountConsentIfPresent = async (): Promise<void> => {
      await page
        .evaluate(() => {
          const boxes = Array.from(
            document.querySelectorAll<HTMLInputElement>(
              '[data-automation-id="createAccountCheckbox"], [data-automation-id*="checkbox" i] input[type="checkbox"], form input[type="checkbox"], [role="dialog"] input[type="checkbox"]'
            )
          );
          for (const box of boxes) {
            if (!box.checked) {
              box.click();
              if (!box.checked) {
                box.checked = true;
                box.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
              }
            }
          }
          const ariaBoxes = Array.from(
            document.querySelectorAll<HTMLElement>(
              '[data-automation-id="createAccountCheckbox"][role="checkbox"], [role="checkbox"][aria-checked="false"]'
            )
          );
          for (const ab of ariaBoxes) {
            if (ab.getAttribute('aria-checked') !== 'true') {
              ab.click();
            }
          }
        })
        .catch(() => {});
    };

    await checkWorkdayCreateAccountConsentIfPresent();

    // Click Workday click_filter overlay OR submit button + press Enter
    const submitTarget = page
      .locator(
        '[data-automation-id="createAccountSubmitButton"], [data-automation-id="click_filter"][aria-label*="Create Account"], button:has-text("Create Account")'
      )
      .filter({ visible: true })
      .first();

    if (await submitTarget.isVisible().catch(() => false)) {
      await submitTarget.click({ force: true, timeout: 5000 }).catch(() => {});
    }
    const filter = page.locator('[data-automation-id="click_filter"]').filter({ visible: true }).first();
    if (await filter.isVisible().catch(() => false)) {
      await filter.click({ force: true, timeout: 3000 }).catch(() => {});
    }
    if (count > 0) {
      await pws.last().press('Enter').catch(() => {});
    }
    await page.waitForTimeout(3500);
    recordWorkdayAccount(targetEmail, pwToUse);
  };

  const fillAndSubmitSignIn = async (targetEmail: string, pwToUse: string) => {
    const emailInput = page
      .locator(WORKDAY_EMAIL_SELECTOR)
      .filter({ visible: true })
      .first();
    if (await emailInput.isVisible().catch(() => false)) {
      await emailInput.fill(targetEmail).catch(() => {});
      await emailInput.evaluate((el: HTMLInputElement, val: string) => {
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      }, targetEmail).catch(() => {});
    }

    const pws = getVisiblePasswordInputs();
    if ((await pws.count()) > 0) {
      await pws.first().fill(pwToUse).catch(() => {});
    }

    const signInTarget = page
      .locator(
        '[data-automation-id="signInSubmitButton"], [data-automation-id="click_filter"][aria-label*="Sign In"], button[type="submit"]:has-text("Sign In")'
      )
      .filter({ visible: true })
      .first();

    if (await signInTarget.isVisible().catch(() => false)) {
      await signInTarget.click({ force: true, timeout: 5000 }).catch(() => {});
    }
    const filter = page.locator('[data-automation-id="click_filter"]').filter({ visible: true }).first();
    if (await filter.isVisible().catch(() => false)) {
      await filter.click({ force: true, timeout: 3000 }).catch(() => {});
    }
    if ((await pws.count()) > 0) {
      await pws.first().press('Enter').catch(() => {});
    }
    await page.waitForTimeout(3500);
    recordWorkdayAccount(targetEmail, pwToUse);
  };

  const currentHost = new URL(page.url()).hostname;
  const isVerifiedHost = isWorkdayHostVerified(currentHost);

  // Ticket GEN-93.2: Jobops-style Create Account First on unverified hosts
  if (!isVerifiedHost && pwCount === 1) {
    const createLink = page
      .locator(
        '[data-automation-id="createAccountLink"], button:has-text("Create Account"), a:has-text("Create Account"), [data-automation-id="noAccountLink"]'
      )
      .filter({ visible: true })
      .first();
    if (await createLink.isVisible().catch(() => false)) {
      await createLink.click({ force: true, timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1200);
    }
  }

  const postVerifyWorkdaySignIn = async () => {
    const signInLink = page.locator('[data-automation-id="signInLink"], a:has-text("Sign In")').filter({ visible: true }).first();
    if (await signInLink.isVisible().catch(() => false)) {
      await signInLink.click({ force: true, timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1000);
      await fillAndSubmitSignIn(email, password);
    }
  };

  const updatedPwCount = await getVisiblePasswordInputs().count().catch(() => 0);

  const authOpts = {
    email,
    password,
    sinceMs: Date.now() - 60_000,
    companyHint: currentHost,
  };

  // Case A: On Create Account form (>= 2 password fields or switched from Sign In)
  if (updatedPwCount >= 2) {
    await fillAndSubmitCreateAccount(email, password);
    const verified = await completeInPageEmailVerificationIfPrompted(page, getActiveFormFrame(page), undefined, authOpts);
    if (verified) await postVerifyWorkdaySignIn();
    const errText = await page.locator('[role="alert"], [data-automation-id="errorMessage"], .error').allTextContents().catch(() => []);
    const pwComplexityErr = errText.some(t => /password.*(?:match|complexity|requirements|criteria|must contain|characters|invalid)|does not meet/i.test(t));
    if (pwComplexityErr) {
      console.log('[AUTH] Workday password complexity error detected; retrying with 16-char fallback');
      await fillAndSubmitCreateAccount(email, WORKDAY_COMPLEXITY_FALLBACK_PASSWORD);
      await completeInPageEmailVerificationIfPrompted(page, getActiveFormFrame(page), undefined, {
        ...authOpts,
        password: WORKDAY_COMPLEXITY_FALLBACK_PASSWORD,
      });
    }
    const accountExists = errText.some(t => /already exists|already registered/i.test(t));
    if (accountExists) {
      markWorkdayHostVerified(currentHost);
      const signInLink = page.locator('[data-automation-id="signInLink"], a:has-text("Sign In")').filter({ visible: true }).first();
      if (await signInLink.isVisible().catch(() => false)) {
        await signInLink.click({ force: true, timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1000);
        if (rawPassword) await fillAndSubmitSignIn(email, rawPassword);
        if ((await getVisiblePasswordInputs().count().catch(() => 0)) > 0 && rawPassword !== password) {
          await fillAndSubmitSignIn(email, password);
        }
        await completeInPageEmailVerificationIfPrompted(page, getActiveFormFrame(page), undefined, authOpts);

        // Ticket GEN-185: If Sign In failed on existing account, fall back to +alias Create Account immediately
        if ((await getVisiblePasswordInputs().count().catch(() => 0)) > 0) {
          let aliasEmail = makeGmailTenantAlias(email, page.url());
          if (aliasEmail === email && email.includes('@')) {
            const [l, d] = email.split('@');
            aliasEmail = `${l}+wd${Date.now().toString().slice(-4)}@${d}`;
          }
          const createLink = page
            .locator(
              '[data-automation-id="createAccountLink"], button:has-text("Create Account"), a:has-text("Create Account"), [data-automation-id="noAccountLink"]'
            )
            .filter({ visible: true })
            .first();
          if (await createLink.isVisible().catch(() => false)) {
            await createLink.click({ force: true, timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(1000);
            await fillAndSubmitCreateAccount(aliasEmail, password);
            await completeInPageEmailVerificationIfPrompted(page, getActiveFormFrame(page), undefined, {
              ...authOpts,
              email: aliasEmail,
            });
          }
        }
      }
    } else if ((await getVisiblePasswordInputs().count().catch(() => 0)) === 0) {
      markWorkdayHostVerified(currentHost);
    }
  } else {
    // Case B: Sign In form
    if (rawPassword) {
      await fillAndSubmitSignIn(email, rawPassword);
    }
    if ((await getVisiblePasswordInputs().count().catch(() => 0)) > 0 && rawPassword !== password) {
      await fillAndSubmitSignIn(email, password);
    }
    await completeInPageEmailVerificationIfPrompted(page, getActiveFormFrame(page), undefined, authOpts);

    if ((await getVisiblePasswordInputs().count().catch(() => 0)) === 0) {
      markWorkdayHostVerified(currentHost);
    } else {
      // If Sign In failed, click Create Account
      const createLink = page
        .locator(
        '[data-automation-id="createAccountLink"], button:has-text("Create Account"), a:has-text("Create Account"), [data-automation-id="noAccountLink"]'
      )
        .filter({ visible: true })
        .first();
      if (await createLink.isVisible().catch(() => false)) {
        await createLink.click({ force: true, timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1000);
        await fillAndSubmitCreateAccount(email, password);
        const verified = await completeInPageEmailVerificationIfPrompted(page, getActiveFormFrame(page), undefined, authOpts);
        if (verified) await postVerifyWorkdaySignIn();
        if ((await getVisiblePasswordInputs().count().catch(() => 0)) === 0) {
          markWorkdayHostVerified(currentHost);
        }
      }
    }
  }

  // TICKET GEN-74 & GEN-185: Gmail +alias bypass if both Sign In and Create Account failed with base email
  if ((await getVisiblePasswordInputs().count().catch(() => 0)) > 0) {
    let aliasEmail = makeGmailTenantAlias(email, page.url());
    if (aliasEmail === email && email.includes('@')) {
      const [l, d] = email.split('@');
      aliasEmail = `${l}+wd${Date.now().toString().slice(-4)}@${d}`;
    }
    const createLink = page
      .locator(
        '[data-automation-id="createAccountLink"], button:has-text("Create Account"), a:has-text("Create Account"), [data-automation-id="noAccountLink"]'
      )
      .filter({ visible: true })
      .first();
    if (await createLink.isVisible().catch(() => false)) {
      await createLink.click({ force: true, timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1000);
    }
    await fillAndSubmitCreateAccount(aliasEmail, password);
    const verified = await completeInPageEmailVerificationIfPrompted(page, getActiveFormFrame(page));
    if (verified) await postVerifyWorkdaySignIn();
  }

  const finalPwCount = await getVisiblePasswordInputs().count().catch(() => 0);
  if (finalPwCount === 0) {
    await saveHostSessionState(page.context(), page.url()).catch(() => {});
  }
  return {
    authenticated: finalPwCount === 0,
    actionTaken: finalPwCount === 0 ? 'workday_auth_succeeded' : 'workday_auth_still_visible',
  };
}
