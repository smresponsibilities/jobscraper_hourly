// src/autoapply/hitl-popup.ts
import { chromium, type Page } from 'patchright';
import { recordLearnedSuccess } from './self-learning.js';

let activeHitlPopupOpen = false;

export interface HitlInterventionResult {
  intervened: boolean;
  captchaSolved: boolean;
  learnedFields: Array<{ question: string; value: string }>;
}

export async function runOnDemandHumanPopup(params: {
  url: string;
  storageStatePath?: string;
  reason: 'visual_captcha' | 'missing_required_fields';
  missingQuestions?: string[];
  timeoutMs?: number;
  pageToAssist?: Page;
}): Promise<HitlInterventionResult> {
  // Never allow more than 1 human popup window at a time!
  if (activeHitlPopupOpen || process.env.AUTOAPPLY_DISABLE_HITL_POPUP === '1') {
    return { intervened: false, captchaSolved: false, learnedFields: [] };
  }
  activeHitlPopupOpen = true;

  const timeoutMs = params.timeoutMs ?? 75_000; // Auto-closes in 75s if human is AFK
  let popupBrowser = null;
  try {
    // Launch a single compact visible intervention window
    popupBrowser = await chromium.launch({
      headless: false,
      args: ['--window-size=560,760', '--window-position=680,60', '--disable-blink-features=AutomationControlled'],
    });
    const context = await popupBrowser.newContext({
      viewport: { width: 540, height: 680 },
      ...(params.storageStatePath ? { storageState: params.storageStatePath } : {}),
    });
    const page = await context.newPage();
    await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 25_000 }).catch(() => {});

    // Inject floating yellow banner + DOM change spy so anything the human types is auto-learned!
    await page.evaluate(
      ({ reasonText, missingList, maxSec }) => {
        (window as any).__name = (window as any).__name || ((fn: any) => fn);
        (window as any).__humanLearnedInputs = {};
        const banner = document.createElement('div');
        banner.id = 'autoapply-hitl-banner';
        banner.style.cssText =
          'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#fef08a;color:#1e293b;padding:10px 14px;font-family:sans-serif;font-size:13px;font-weight:700;border-bottom:3px solid #f59e0b;box-shadow:0 4px 12px rgba(0,0,0,0.2);';
        banner.innerText =
          `🔔 AUTOAPPLY NEEDS 1 QUICK ACTION (${maxSec}s before auto-close): ` +
          (reasonText === 'visual_captcha'
            ? 'Please solve the CAPTCHA puzzle below.'
            : `Please fill: ${missingList.join(', ')} (Bot will auto-learn your answer!)`);
        document.body.prepend(banner);

        if (reasonText === 'visual_captcha') {
          const capTarget = document.querySelector('iframe[src*="captcha" i], iframe[src*="turnstile" i], iframe[src*="challenge" i], [class*="captcha" i], [id*="captcha" i]');
          if (capTarget) {
            (capTarget as HTMLElement).style.outline = '4px solid #f59e0b';
            (capTarget as HTMLElement).style.boxShadow = '0 0 15px rgba(245, 158, 11, 0.7)';
            capTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        } else if (missingList.length > 0) {
          const invalids = Array.from(document.querySelectorAll<HTMLElement>('input:invalid, select:invalid, textarea:invalid, [aria-invalid="true"]'));
          let firstScrolled = false;
          for (const inv of invalids) {
            inv.style.outline = '4px solid #f59e0b';
            inv.style.boxShadow = '0 0 15px rgba(245, 158, 11, 0.7)';
            if (!firstScrolled) {
              inv.scrollIntoView({ behavior: 'smooth', block: 'center' });
              firstScrolled = true;
            }
          }
        }

        document.addEventListener(
          'change',
          e => {
            const t = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
            if (!t || !t.value) return;
            const box = t.closest('[data-autoapply-cluster], fieldset, .field, div');
            const label =
              box?.querySelector('label, legend')?.textContent?.trim() ||
              t.getAttribute('aria-label') ||
              t.name ||
              t.id ||
              '';
            if (label && t.value.trim()) {
              (window as any).__humanLearnedInputs[label] = t.value.trim();
            }
          },
          true
        );
      },
      {
        reasonText: params.reason,
        missingList: params.missingQuestions || [],
        maxSec: Math.round(timeoutMs / 1000),
      }
    ).catch(() => {});

    // Poll every 1.5s for CAPTCHA token completion, confirmation receipt, or window close
    const start = Date.now();
    let solved = false;
    while (Date.now() - start < timeoutMs) {
      if (page.isClosed()) break;
      const status = await page
        .evaluate(() => {
          const cap = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(
            '[name="h-captcha-response"], [name="g-recaptcha-response"], [name="cf-turnstile-response"]'
          );
          const hasToken = Boolean(cap && cap.value && cap.value.trim().length > 20);
          const bodyTxt = (document.body?.innerText || '').toLowerCase();
          const isSubmitted =
            /\b(thank you for applying|application submitted|received your application|application has been sent)\b/i.test(
              bodyTxt
            );
          return {
            hasToken,
            isSubmitted,
            learned: (window as any).__humanLearnedInputs || {},
          };
        })
        .catch(() => ({ hasToken: false, isSubmitted: false, learned: {} }));

      // Persist any newly typed human answers into semantic-memory.json immediately!
      const learnedEntries = Object.entries((status.learned as Record<string, string>) || {});
      for (const [qText, val] of learnedEntries) {
        recordLearnedSuccess(qText, 'human_intervened_learned', val, 1.0);
      }

      if (status.hasToken || status.isSubmitted) {
        solved = true;
        return {
          intervened: true,
          captchaSolved: status.hasToken,
          learnedFields: learnedEntries.map(([question, value]) => ({ question, value })),
        };
      }
      await new Promise(r => setTimeout(r, 1500));
    }
    return { intervened: solved, captchaSolved: solved, learnedFields: [] };
  } catch {
    return { intervened: false, captchaSolved: false, learnedFields: [] };
  } finally {
    if (popupBrowser) {
      if (params.storageStatePath) {
        try {
          const contexts = (popupBrowser as any).contexts?.() || [];
          if (contexts.length > 0) {
            await contexts[0].storageState({ path: params.storageStatePath }).catch(() => {});
          }
        } catch {}
      }
      await (popupBrowser as any).close().catch(() => {});
    }
    activeHitlPopupOpen = false;
  }
}
