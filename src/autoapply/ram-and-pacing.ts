// src/autoapply/ram-and-pacing.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { BrowserContext, Page } from 'patchright';

const BLOCKED_TRACKER_DOMAINS =
  /(?:google-analytics\.com|googletagmanager\.com|doubleclick\.net|hotjar\.com|fullstory\.com|clarity\.ms|segment\.io|connect\.facebook\.net|bat\.bing\.com|tiktok\.com|muse\.ai|vimeo\.com|youtube\.com\/embed)/i;

const PROTECTED_ATS_AND_SECURITY_DOMAINS =
  /(?:greenhouse\.io|ashbyhq\.com|lever\.co|myworkdayjobs\.com|workday\.com|smartrecruiters\.com|hcaptcha\.com|cloudflare\.com|recaptcha\.net|gstatic\.com|arkoselabs\.com)/i;

/**
 * 1. Blocks heavy video streams and 3rd-party marketing trackers
 * while strictly allowing all ATS scripts, styles, and CAPTCHA/security challenges.
 */
export async function installRamDietRouteFilter(context: BrowserContext): Promise<void> {
  await context.route('**/*', route => {
    const req = route.request();
    const type = req.resourceType();
    const url = req.url();

    // Never block core ATS or security/CAPTCHA domains
    if (PROTECTED_ATS_AND_SECURITY_DOMAINS.test(url)) {
      return route.continue();
    }

    // Preserve fonts used by page rendering and challenge widgets.
    if (type === 'media' || BLOCKED_TRACKER_DOMAINS.test(url)) {
      return route.abort();
    }

    // Block huge decorative videos/animations on corporate wrapper pages
    if (type === 'image' && /\.(?:mp4|webm|gif|avi|mov)(?:\?|$)/i.test(url)) {
      return route.abort();
    }

    return route.continue();
  });
}

/**
 * 2. Low-Memory Chromium Launch Flags: Caps V8 renderer heap and disk cache bloat.
 */
export const LOW_RAM_CHROMIUM_ARGS = [
  '--headless=new',
  '--window-size=1280,900',
  '--disable-blink-features=AutomationControlled',
  '--webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--force-webrtc-ip-handling-policy',
  '--js-flags=--max-old-space-size=384',
  '--disk-cache-size=16777216', // 16 MB max disk cache
  '--media-cache-size=1048576', // 1 MB max media cache
  '--disable-dev-shm-usage',
  '--disable-background-networking',
  '--disable-component-update',
  '--no-first-run',
  '--no-default-browser-check',
];

/**
 * 3. Scrubs bloated Chromium Cache / GPUCache / Code Cache directories between chunks
 * while strictly preserving Cookies, Local Storage, and Session Storage!
 */
export function scrubBrowserProfileCaches(stateRoot = 'state/autoapply'): number {
  let bytesFreed = 0;
  const resolvedRoot = path.resolve(stateRoot);
  const cacheSubdirs = [
    'Cache',
    'Code Cache',
    'GPUCache',
    'DawnCache',
    'GrShaderCache',
    'ShaderCache',
    path.join('Default', 'Cache'),
    path.join('Default', 'Code Cache'),
    path.join('Default', 'GPUCache'),
    path.join('Default', 'Service Worker', 'CacheStorage'),
  ];

  if (fs.existsSync(resolvedRoot)) {
    for (const entry of fs.readdirSync(resolvedRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('browser-profile')) continue;
      const base = path.join(resolvedRoot, entry.name);
      for (const sub of cacheSubdirs) {
        const target = path.join(base, sub);
        if (fs.existsSync(target)) {
          try {
            fs.rmSync(target, { recursive: true, force: true });
            bytesFreed += 1;
          } catch {}
        }
      }
    }
  }

  // Trigger Node V8 garbage collection if exposed via --expose-gc
  if (typeof (global as any).gc === 'function') {
    try {
      (global as any).gc();
    } catch {}
  }

  return bytesFreed;
}

/**
 * 4. Dynamic Lane Concurrency Based on Available Free System RAM:
 * Prevents Windows swap-thrashing when system memory is tight.
 */
export function getRecommendedLaneConcurrency(maxDesiredLanes = 4): number {
  const freeMemGb = os.freemem() / (1024 * 1024 * 1024);
  if (freeMemGb < 1.2) return 1;
  if (freeMemGb < 2.2) return 2;
  if (freeMemGb < 3.2) return 3;
  return maxDesiredLanes;
}

/**
 * 5. Anti-Bot "Human Submission Pacing Floor":
 * Ensures we NEVER submit a form unrealistically fast (e.g. < 18 seconds after page load),
 * simulating natural human proofreading (scrolling up/down + mouse micro-movement) before clicking Submit.
 */
export async function enforceHumanSubmissionPacingFloor(
  page: Page,
  formOpenedAtMs: number,
  fieldsFilled: number,
  maxTotalDwellMs?: number
): Promise<number> {
  // Base 15s + 1.2s per filled field + random 3–8s jitter (typically 19s to 32s total form dwell)
  let targetDwellMs =
    15_000 + Math.min(14_000, Math.max(2, fieldsFilled) * 1_200) + 3_000 + Math.floor(Math.random() * 5_000);
  if (typeof maxTotalDwellMs === 'number' && maxTotalDwellMs > 0) {
    targetDwellMs = Math.min(targetDwellMs, maxTotalDwellMs);
  }
  const elapsedMs = Date.now() - formOpenedAtMs;
  // Ticket GEN-104: If we have already spent >= 18 seconds filling fields on the form, zero extra dwell
  if (elapsedMs >= 4000) return 0;
  const remainingMs = targetDwellMs - elapsedMs;
  if (remainingMs <= 0) return 0;

  // Simulate natural human proofreading during the remaining wait window
  const stepMs = Math.min(remainingMs, 4000);
  const third = Math.floor(stepMs / 3);

  await page.evaluate(() => window.scrollTo({ top: 120, behavior: 'smooth' })).catch(() => {});
  await page.waitForTimeout(third);

  await page.mouse.move(280 + Math.floor(Math.random() * 200), 320 + Math.floor(Math.random() * 180), { steps: 6 }).catch(() => {});
  await page.waitForTimeout(third);

  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })).catch(() => {});
  await page.waitForTimeout(stepMs - third * 2);

  return stepMs;
}
