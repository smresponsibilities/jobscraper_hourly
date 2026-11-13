import type { Frame, Page } from 'patchright';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function localSolverSecret(): string | undefined {
  if (process.env.CAPTCHA_SOLVER_SECRET) return process.env.CAPTCHA_SOLVER_SECRET;
  try { return readFileSync(path.resolve('state/autoapply/portal-review/captcha-solver.secret'), 'utf8').trim() || undefined; }
  catch { return undefined; }
}

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
 * The widget kind decides the solver task type: Turnstile needs
 * AntiTurnstileTaskProxyLess, hCaptcha needs HCaptchaTaskProxyless.
 */
export function chooseCaptchaTaskType(isTurnstile: boolean): 'AntiTurnstileTaskProxyLess' | 'HCaptchaTaskProxyless' {
  return isTurnstile ? 'AntiTurnstileTaskProxyLess' : 'HCaptchaTaskProxyless';
}

interface CaptchaWidgetInfo {
  siteKey: string | null;
  turnstile: boolean;
  action?: string;
  cdata?: string;
  callback?: string;
}

async function readCaptchaWidget(page: Page): Promise<CaptchaWidgetInfo> {
  return await page.evaluate(() => {
    const turnstileEl = document.querySelector<HTMLElement>(
      '.cf-turnstile, [data-turnstile-sitekey], iframe[src*="challenges.cloudflare.com"]'
    );
    const siteKeyEl = document.querySelector<HTMLElement>('[data-sitekey], [data-turnstile-sitekey], .cf-turnstile');
    const siteKey =
      siteKeyEl?.getAttribute('data-sitekey') ||
      siteKeyEl?.getAttribute('data-turnstile-sitekey') ||
      null;
    return {
      siteKey,
      turnstile: Boolean(turnstileEl),
      action: turnstileEl?.getAttribute('data-action') || undefined,
      cdata: turnstileEl?.getAttribute('data-cdata') || undefined,
      callback: turnstileEl?.getAttribute('data-callback') || undefined,
    };
  }).catch(() => ({ siteKey: null, turnstile: false }) as CaptchaWidgetInfo);
}

/**
 * Writes a solved token into every response field the page exposes and fires the
 * widget's own success callback, which is what resumes a React submit handler.
 */
async function injectCaptchaToken(page: Page, token: string, callback?: string): Promise<boolean> {
  const injected = await page.evaluate(([value, cb]) => {
    const fields = document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>(
      '[name="cf-turnstile-response"], [name="h-captcha-response"], [name="g-recaptcha-response"]'
    );
    let count = 0;
    for (const field of Array.from(fields)) {
      const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(field, value);
      else field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      count++;
    }
    if (cb) {
      try {
        const handler = (window as unknown as Record<string, unknown>)[cb];
        if (typeof handler === 'function') (handler as (t: string) => void)(value);
      } catch {}
    }
    return count;
  }, [token, callback ?? ''] as const).catch(() => 0);
  return injected > 0;
}

/**
 * Optional token API solve (CapSolver). Returns a token, or null when no key,
 * no site key, or the solve fails.
 */
async function solveViaTokenApi(page: Page, apiKey: string): Promise<{ token: string; turnstile: boolean } | null> {
  const widget = await readCaptchaWidget(page);
  if (!widget.siteKey) return null;

  const task: Record<string, unknown> = {
    type: chooseCaptchaTaskType(widget.turnstile),
    websiteURL: page.url(),
    websiteKey: widget.siteKey,
  };
  if (widget.turnstile && (widget.action || widget.cdata)) {
    task.metadata = {
      ...(widget.action ? { action: widget.action } : {}),
      ...(widget.cdata ? { cdata: widget.cdata } : {}),
    };
  }

  const createRes = await fetch('https://api.capsolver.com/createTask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientKey: apiKey, task }),
  })
    .then(r => r.json() as Promise<{ taskId?: string; errorDescription?: string }>)
    .catch(() => ({}) as { taskId?: string });

  if (!createRes.taskId) return null;

  for (let poll = 0; poll < 15; poll++) {
    await page.waitForTimeout(2000);
    type TaskResult = { status?: string; solution?: { token?: string; gRecaptchaResponse?: string } };
    const res: TaskResult = await fetch('https://api.capsolver.com/getTaskResult', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: apiKey, taskId: createRes.taskId }),
    })
      .then(r => r.json() as Promise<TaskResult>)
      .catch(() => ({}) as TaskResult);

    if (res.status === 'ready') {
      const token = res.solution?.token || res.solution?.gRecaptchaResponse;
      if (token) return { token, turnstile: widget.turnstile };
    }
    if (res.status === 'failed') return null;
  }
  return null;
}

/**
 * Free, self-hosted solver support. `CAPTCHA_SOLVER_URL` points at a local
 * sidecar such as Theyka/Turnstile-Solver (`GET /turnstile?url=&sitekey=`) or
 * odell0111/turnstile_solver (`GET /solve?url=&sitekey=`), both of which drive
 * their own patched Chromium and return a token. Tried before any paid key.
 */
function pickSolverToken(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, any>;
  const candidates = [
    record.token,
    record.solution?.token,
    record.solution?.gRecaptchaResponse,
    record.data?.token,
    record.gRecaptchaResponse,
    typeof record.value === 'string' && !record.value.startsWith('CAPTCHA_') ? record.value : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 20) return candidate.trim();
  }
  return undefined;
}

export async function solveViaLocalSolver(
  page: Page,
  baseUrl: string
): Promise<{ token: string; turnstile: boolean } | null> {
  try {
    const endpoint = new URL(baseUrl);
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) return null;
  } catch { return null; }
  const widget = await readCaptchaWidget(page);
  if (!widget.siteKey || !widget.turnstile) return null;
  const base = baseUrl.replace(/\/+$/, '');
  const params = new URLSearchParams({ url: page.url(), sitekey: widget.siteKey });
  if (widget.action) params.set('action', widget.action);
  if (widget.cdata) params.set('cdata', widget.cdata);

  for (const route of ['/turnstile', '/solve']) {
    try {
      const response = await fetch(`${base}${route}?${params.toString()}`, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) continue;
      const created = (await response.json().catch(() => null)) as Record<string, any> | null;
      const immediate = pickSolverToken(created);
      if (immediate) return { token: immediate, turnstile: widget.turnstile };

      // Theyka's solver answers `{task_id}` and publishes `{value}` at /result;
      // odell0111 answers in place. Support both without guessing.
      const taskId = created?.task_id || created?.taskId || created?.id;
      if (typeof taskId !== 'string' || !taskId) continue;
      for (let attempt = 0; attempt < 45; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const poll = await fetch(`${base}/result?id=${encodeURIComponent(taskId)}`, { signal: AbortSignal.timeout(15_000) });
        if (!poll.ok) continue;
        const payload = (await poll.json().catch(() => null)) as Record<string, any> | null;
        const token = pickSolverToken(payload);
        if (token) return { token, turnstile: widget.turnstile };
        if (payload?.value === 'CAPTCHA_FAIL') break;
      }
    } catch {}
  }
  // The local helper accepts a JSON body on GET /solve and a secret header.
  const secret = localSolverSecret();
  if (secret) {
    try {
      const endpoint = new URL('/solve', baseUrl);
      const transport = endpoint.protocol === 'https:' ? await import('node:https') : await import('node:http');
      const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => undefined);
      const body = JSON.stringify({ site_url: page.url(), site_key: widget.siteKey, action: widget.action, cdata: widget.cdata, user_agent: userAgent });
      const payload = await new Promise<unknown>((resolve, reject) => {
        const req = transport.request(endpoint, { method: 'GET', headers: { secret, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 60_000 }, res => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', chunk => { data += chunk; if (data.length > 65_536) req.destroy(new Error('Solver response too large')); });
          res.on('end', () => { try { resolve(res.statusCode === 200 ? JSON.parse(data) : null); } catch { resolve(null); } });
        });
        req.on('timeout', () => req.destroy(new Error('Solver timeout')));
        req.on('error', reject);
        req.end(body);
      });
      const token = pickSolverToken(payload);
      if (token) return { token, turnstile: true };
    } catch { /* Leave the challenge for review. */ }
  }
  return null;
}

/**
 * Autonomous 4-Layer Zero-Human CAPTCHA Solver:
 * Layer 1: Check if passive token already populated.
 * Layer 2: Locate visible hCaptcha / Turnstile / reCAPTCHA checkbox iframe and perform a humanized click.
 * Layer 3: Use a configured free local solver for Turnstile.
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

  // Layer 3a: Free self-hosted solver sidecar (CAPTCHA_SOLVER_URL).
  const localSolverUrl = process.env.CAPTCHA_SOLVER_URL || (localSolverSecret() ? 'http://127.0.0.1:8088' : undefined);
  if (localSolverUrl) {
    const solved = await solveViaLocalSolver(page, localSolverUrl);
    if (solved) {
      const widget = await readCaptchaWidget(page);
      await injectCaptchaToken(page, solved.token, widget.callback);
      await page.waitForTimeout(600);
      if (await hasPopulatedCaptchaToken(page)) {
        return { detected: true, solved: true, method: 'api_solver' };
      }
    }
  }

  // Layer 4: Unsolved visual grid challenge — do not hang; signal fast rotation to next queued job
  return { detected: true, solved: false, method: 'unsolved_visual_challenge' };
}
