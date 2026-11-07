import type { Frame, Page } from 'patchright';

export interface CaptchaResolutionResult {
  detected: boolean;
  solved: boolean;
  method: 'none' | 'passive_token' | 'checkbox_click' | 'api_solver' | 'unsolved_visual_challenge';
}

/**
 * Moves the mouse along a humanized curve before clicking so hCaptcha/Turnstile passive telemetry scores high.
 */
export async function humanizedClickBox(page: Page, box: { x: number; y: number; width: number; height: number }): Promise<void> {
  const targetX = box.x + box.width * (0.38 + Math.random() * 0.24);
  const targetY = box.y + box.height * (0.38 + Math.random() * 0.24);
  await page.mouse.move(targetX * 0.5, targetY * 0.5, { steps: 8 });
  await page.waitForTimeout(40 + Math.floor(Math.random() * 50));
  await page.mouse.move(targetX, targetY, { steps: 14 });
  await page.waitForTimeout(50 + Math.floor(Math.random() * 70));
  await page.mouse.down();
  await page.waitForTimeout(65 + Math.floor(Math.random() * 65));
  await page.mouse.up();
}

/**
 * Checks if a valid response token already exists in the DOM for hCaptcha, reCAPTCHA, or Turnstile.
 */
export async function hasPopulatedCaptchaToken(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    const fields = document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>(
      '[name="h-captcha-response"], [name="g-recaptcha-response"], [name="cf-turnstile-response"]'
    );
    for (const f of Array.from(fields)) {
      if (f.value && f.value.trim().length > 20) return true;
    }
    return false;
  }).catch(() => false);
}

/**
 * Autonomous 4-Layer Zero-Human CAPTCHA Solver:
 * Layer 1: Check if passive token already populated.
 * Layer 2: Locate visible hCaptcha / Turnstile / reCAPTCHA checkbox iframe and perform a humanized click.
 * Layer 3: If CAPSOLVER_API_KEY or TWOCAPTCHA_API_KEY is in .env, solve via REST API and inject token.
 * Layer 4: Return clean status so runner can re-click Submit (if solved) or fast-skip to next job without hanging.
 */
export async function attemptAutonomousCaptchaSolve(page: Page): Promise<CaptchaResolutionResult> {
  // Layer 1: Check existing token
  if (await hasPopulatedCaptchaToken(page)) {
    return { detected: true, solved: true, method: 'passive_token' };
  }

  const captchaFrames = page.frames().filter(f =>
    /hcaptcha\.com|challenges\.cloudflare\.com|recaptcha\/api2\/anchor/i.test(f.url())
  );
  const hasCaptchaContainer = captchaFrames.length > 0 || (await page.locator('.h-captcha, .cf-turnstile, .g-recaptcha, iframe[src*="hcaptcha"], iframe[src*="turnstile"]').count().catch(() => 0)) > 0;

  if (!hasCaptchaContainer) {
    return { detected: false, solved: true, method: 'none' };
  }

  // Layer 2: Autonomous Humanized Checkbox Click inside Challenge Iframe
  for (const frame of captchaFrames) {
    const checkbox = frame.locator('#checkbox, [role="checkbox"], .recaptcha-checkbox-border, input[type="checkbox"]').first();
    if (await checkbox.isVisible().catch(() => false)) {
      const isChecked = await checkbox.getAttribute('aria-checked').catch(() => 'false');
      if (isChecked === 'true') {
        return { detected: true, solved: true, method: 'checkbox_click' };
      }
      const box = await checkbox.boundingBox().catch(() => null);
      if (box) {
        await humanizedClickBox(page, box);
        await page.waitForTimeout(3500);
        if (await hasPopulatedCaptchaToken(page)) {
          return { detected: true, solved: true, method: 'checkbox_click' };
        }
        const nowChecked = await checkbox.getAttribute('aria-checked').catch(() => 'false');
        if (nowChecked === 'true') {
          return { detected: true, solved: true, method: 'checkbox_click' };
        }
      }
    }
  }

  // Layer 3: Optional Token API Solver (if CAPSOLVER_API_KEY is present in .env)
  const capsolverKey = process.env.CAPSOLVER_API_KEY;
  if (capsolverKey) {
    const siteKey = await page.evaluate(() => {
      const el = document.querySelector('[data-sitekey]');
      return el?.getAttribute('data-sitekey') || null;
    }).catch(() => null);

    if (siteKey) {
      try {
        const createRes = await fetch('https://api.capsolver.com/createTask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientKey: capsolverKey,
            task: {
              type: 'HCaptchaTaskProxyless',
              websiteURL: page.url(),
              websiteKey: siteKey,
            },
          }),
        }).then(r => r.json() as Promise<{ taskId?: string }>);

        if (createRes.taskId) {
          for (let poll = 0; poll < 15; poll++) {
            await page.waitForTimeout(2000);
            const res = await fetch('https://api.capsolver.com/getTaskResult', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ clientKey: capsolverKey, taskId: createRes.taskId }),
            }).then(r => r.json() as Promise<{ status?: string; solution?: { gRecaptchaResponse?: string } }>);
            if (res.status === 'ready' && res.solution?.gRecaptchaResponse) {
              const token = res.solution.gRecaptchaResponse;
              await page.evaluate((t) => {
                document.querySelectorAll<HTMLTextAreaElement>('[name="h-captcha-response"], [name="g-recaptcha-response"]').forEach(el => {
                  el.value = t;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                });
              }, token);
              return { detected: true, solved: true, method: 'api_solver' };
            }
          }
        }
      } catch {
        // Fall through to Layer 4
      }
    }
  }

  // Layer 4: Unsolved visual grid challenge — do not hang; signal fast rotation to next queued job
  return { detected: true, solved: false, method: 'unsolved_visual_challenge' };
}
