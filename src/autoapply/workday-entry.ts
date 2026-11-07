// src/autoapply/workday-entry.ts
import type { Page } from 'patchright';

export interface WorkdayEntryResult {
  enteredWizard: boolean;
  jobClosed: boolean;
  entryMethod:
    | 'already_in_wizard'
    | 'use_last_app'
    | 'apply_manually_btn'
    | 'autofill_resume_btn'
    | 'direct_url_fallback'
    | 'closed';
}

export async function ensureWorkdayApplicationStarted(page: Page): Promise<WorkdayEntryResult> {
  const currentUrl = page.url();
  if (!currentUrl.toLowerCase().includes('myworkdayjobs.com')) {
    return { enteredWizard: true, jobClosed: false, entryMethod: 'already_in_wizard' };
  }

  const checkJobClosed = async (): Promise<boolean> => {
    return await page
      .evaluate(() => {
        const txt = (document.body?.innerText || '').toLowerCase();
        return /job is no longer available|page you are looking for doesn't exist|position has been filled|no longer accepting applications|job requisition has been closed|this job has expired|requisition is closed/i.test(
          txt
        );
      })
      .catch(() => false);
  };

  // Ticket GEN-99: Dismiss "Are You Still With Us?" session timeout modal if present
  const isSessionModal = await page.evaluate(() => {
    const txt = (document.body?.innerText || '').toLowerCase();
    return /are you still with us\??|session is about to expire/i.test(txt);
  }).catch(() => false);
  if (isSessionModal) {
    const sessionBtn = page.locator(
      'button:has-text("Continue"), button:has-text("Yes"), button:has-text("I\'m still here"), [data-automation-id="sessionTimeoutContinueButton"], [data-automation-id="dialogKeepAliveButton"]'
    ).first();
    await sessionBtn.click({ timeout: 2000 }).catch(() => {});
  }

  // 1. Wait for Workday SPA client to mount controls, posting header, or closed banner (Ticket GEN-67)
  await page.locator?.(
      '[data-automation-id="adventureButton"], [data-automation-id="applyButton"], [data-automation-id="jobPostingHeader"], [data-automation-id="signInContent"], [data-automation-id="createAccountContent"], [data-automation-id="bottom-navigation-next-button"], [data-automation-id="legalNoticeAcceptButton"], button:has-text("Apply"), button:has-text("Accept Cookies")'
    )
    .first()
    .waitFor({ state: 'visible', timeout: 8000 })
    .catch(() => {});

  if (await checkJobClosed()) {
    return { enteredWizard: false, jobClosed: true, entryMethod: 'closed' };
  }

  // 2. Check if we are already on the auth screen or form wizard
  const hasWizardOrAuth = async (): Promise<boolean> => {
    // If on /apply page and utilityButtonSignIn is present but inputs not yet mounted (Barclays & Citi), click it!
    const isApplyRoute = /\/apply/i.test(page.url());
    const utilitySignIn = page.locator('[data-automation-id="utilityButtonSignIn"]').first();
    if (isApplyRoute && (await utilitySignIn.isVisible().catch(() => false))) {
      const existingInputs = await page.locator('input[type="email"], input[type="password"]').count().catch(() => 0);
      if (existingInputs === 0) {
        await utilitySignIn.click({ timeout: 2500 }).catch(() => {});
        await page.waitForTimeout(1500);
      }
    }

    const count = await page
      .locator(
        '[data-automation-id="signInContent"], [data-automation-id="createAccountContent"], [data-automation-id="SignInWithEmailButton"], [data-automation-id="bottom-navigation-next-button"], [data-automation-id^="formField-"], input[type="email"], input[type="password"]'
      )
      .count()
      .catch(() => 0);
    return count > 0;
  };

  if (await hasWizardOrAuth()) {
    return { enteredWizard: true, jobClosed: false, entryMethod: 'already_in_wizard' };
  }

  // 3. Dismiss any Workday cookie / legal notice banner first
  const cookieAccept = page
    .locator(
      'button[data-automation-id="legalNoticeAcceptButton"], button:has-text("Accept Cookies"), button:has-text("Accept All")'
    )
    .first();
  if (await cookieAccept.isVisible().catch(() => false)) {
    await cookieAccept.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(1200);
  }

  // 4. Click "Apply" button on Job Overview page
  const applyBtn = page
    .locator(
      '[data-automation-id="adventureButton"], [data-automation-id="applyButton"], a[data-automation-id="adventureButton"], button:has-text("Apply")'
    )
    .first();

  if (await applyBtn.isVisible().catch(() => false)) {
    await applyBtn.scrollIntoViewIfNeeded().catch(() => {});
    await applyBtn.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(1500);
  } else {
    // If no Apply button is visible on a Workday overview page, check again if closed
    if (await checkJobClosed()) {
      return { enteredWizard: false, jobClosed: true, entryMethod: 'closed' };
    }
  }

  // 5. Handle "Start Your Application" Modal (Use My Last Application -> Apply Manually -> Autofill with Resume)
  const modalOptions: Array<{ selector: string; method: WorkdayEntryResult['entryMethod'] }> = [
    {
      selector:
        '[data-automation-id="useMyLastApplication"], a:has-text("Use My Last Application"), button:has-text("Use My Last Application")',
      method: 'use_last_app',
    },
    {
      selector:
        '[data-automation-id="applyManually"], a:has-text("Apply Manually"), button:has-text("Apply Manually")',
      method: 'apply_manually_btn',
    },
    {
      selector:
        '[data-automation-id="autofillWithResume"], a:has-text("Autofill with Resume"), button:has-text("Autofill with Resume")',
      method: 'autofill_resume_btn',
    },
  ];

  for (const opt of modalOptions) {
    const loc = page.locator(opt.selector).first();
    if (await loc.isVisible().catch(() => false)) {
      await loc.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(2500);
      const wizardCookie = page
        .locator('button[data-automation-id="legalNoticeAcceptButton"], button:has-text("Accept Cookies")')
        .first();
      if (await wizardCookie.isVisible().catch(() => false)) {
        await wizardCookie.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(1500);
      }
      if (await hasWizardOrAuth()) {
        return { enteredWizard: true, jobClosed: false, entryMethod: opt.method };
      }
    }
  }

  // 6. Direct URL Fallback: navigate straight to <jobUrl>/apply/applyManually
  if (!(await hasWizardOrAuth())) {
    const cleanBase = currentUrl.split('?')[0]!.replace(/\/apply(?:\/.*)?$/i, '').replace(/\/+$/, '');
    if (/\/job\//i.test(cleanBase)) {
      const directManualUrl = `${cleanBase}/apply/applyManually`;
      await page.goto(directManualUrl, { waitUntil: 'load', timeout: 20_000 }).catch(async () => {
        await page.goto(directManualUrl, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
      });
      await page.waitForTimeout(2000);
      const directCookie = page
        .locator('button[data-automation-id="legalNoticeAcceptButton"], button:has-text("Accept Cookies")')
        .first();
      if (await directCookie.isVisible().catch(() => false)) {
        await directCookie.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(1500);
      }
      if (await checkJobClosed()) {
        return { enteredWizard: false, jobClosed: true, entryMethod: 'closed' };
      }
      if (await hasWizardOrAuth()) {
        return { enteredWizard: true, jobClosed: false, entryMethod: 'direct_url_fallback' };
      }
    }
  }

  if (await checkJobClosed()) {
    return { enteredWizard: false, jobClosed: true, entryMethod: 'closed' };
  }

  // GEN-109: If Workday landed on /applyManually or /apply without opening the Sign In modal,
  // click [data-automation-id="utilityButtonSignIn"] so the auth fields mount immediately.
  const utilitySignInVisible = await page
    .locator('[data-automation-id="utilityButtonSignIn"]')
    .first()
    .isVisible()
    .catch(() => false);
  const authOrFormMounted = await page
    .locator(
      '[data-automation-id="formField-email"] input, [data-automation-id="email"], input[type="password"], [data-automation-id="bottom-navigation-next-button"]'
    )
    .first()
    .isVisible()
    .catch(() => false);

  if (utilitySignInVisible && !authOrFormMounted) {
    await page
      .locator('[data-automation-id="utilityButtonSignIn"]')
      .first()
      .click({ timeout: 5000 })
      .catch(() => {});
    await page
      .locator(
        '[data-automation-id="formField-email"] input, [data-automation-id="email"], input[type="password"], [data-automation-id="createAccountLink"]'
      )
      .first()
      .waitFor({ state: 'visible', timeout: 7000 })
      .catch(() => {});
  }

  return { enteredWizard: await hasWizardOrAuth(), jobClosed: false, entryMethod: 'direct_url_fallback' };
}

/**
 * GEN-111: SmartRecruiters "I'm interested" / #st-apply entry gate handler with trusted CDP click and Referer.
 */
export async function ensureSmartRecruitersApplicationStarted(
  page: Page,
  originalEntryUrl?: string
): Promise<boolean> {
  const url = page.url();
  if (!/smartrecruiters\.com/i.test(url)) {
    return false;
  }

  const countShadowAndLightInputs = async (): Promise<number> => {
    return await page
      .evaluate(() => {
        const countInRoot = (root: Document | ShadowRoot | Element): number => {
          let total = root.querySelectorAll(
            'input:not([type="hidden"]), textarea, select, [role="combobox"], input[type="file"]'
          ).length;
          const all = root.querySelectorAll('*');
          for (const el of Array.from(all)) {
            const sr = (el as HTMLElement).shadowRoot;
            if (sr) total += countInRoot(sr);
          }
          return total;
        };
        return countInRoot(document);
      })
      .catch(() => 0);
  };

  const waitForOneClickInputs = async (timeoutMs = 10000): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await countShadowAndLightInputs()) >= 2) {
        return true;
      }
      await page.waitForTimeout(350).catch(() => {});
    }
    return false;
  };

  // If already on /oneclick-ui/ and inputs are mounted (no DataDome block), we are ready
  if (/\/oneclick-ui\//i.test(page.url())) {
    const hasDataDome = await page
      .locator('iframe[src*="captcha-delivery.com"], iframe[src*="datadome"]')
      .first()
      .isVisible()
      .catch(() => false);
    if (!hasDataDome && (await waitForOneClickInputs(4000))) {
      return true;
    }
    // If DataDome blocked a direct /oneclick-ui/ load and we have the public overview URL, go back to overview
    if (originalEntryUrl && !/\/oneclick-ui\//i.test(originalEntryUrl)) {
      await page.goto(originalEntryUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    }
  }

  // Dismiss cookie banner if present so it doesn't intercept the click on a#st-apply
  const cookieBtn = page.locator('#onetrust-accept-btn-handler, button:has-text("Accept All")').first();
  if (await cookieBtn.isVisible().catch(() => false)) {
    await cookieBtn.click({ timeout: 2500 }).catch(() => {});
  }

  // Ensure a#st-apply opens in the SAME tab to preserve Referer and cookies
  await page
    .evaluate(() => {
      const links = document.querySelectorAll(
        'a#st-apply, a[data-test="apply-button"], a[href*="/oneclick-ui/"]'
      );
      for (const a of Array.from(links)) {
        a.removeAttribute('target');
      }
    })
    .catch(() => {});

  // Click a#st-apply or "I'm interested" with native Playwright trusted click (isTrusted: true + Referer)
  const applySelectors = [
    'a#st-apply',
    '[data-test="apply-button"]',
    'a[href*="/oneclick-ui/"]',
    'a:has-text("I\'m interested")',
    'button:has-text("I\'m interested")',
    'oc-button:has-text("I\'m interested")',
  ];

  for (const sel of applySelectors) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) {
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      await loc.click({ timeout: 6000 }).catch(() => {});
      break;
    }
  }

  return await waitForOneClickInputs(10000);
}
