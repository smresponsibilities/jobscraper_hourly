import type { Page, Frame, Locator } from 'patchright';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ElementFingerprint {
  key: string;
  tag: string;
  typeAttr?: string;
  roleAttr?: string;
  text?: string;
  ariaLabel?: string;
  nameAttr?: string;
  automationId?: string;
  classTokens: string[];
  parentTag?: string;
  updatedAt?: string;
}

export function collectAllInteractiveShadowAware(
  root: Document | ShadowRoot,
  selector: string,
  acc: Element[] = []
): Element[] {
  for (const el of Array.from(root.querySelectorAll(selector))) {
    acc.push(el);
  }
  for (const node of Array.from(root.querySelectorAll('*'))) {
    if ((node as any).shadowRoot) {
      collectAllInteractiveShadowAware((node as any).shadowRoot, selector, acc);
    }
  }
  return acc;
}

const DEFAULT_FINGERPRINTS_PATH = path.resolve('state/autoapply/portal-review/adaptive-fingerprints.json');

const SEED_FINGERPRINTS: Record<string, Partial<ElementFingerprint>> = {
  flow_next_button: {
    key: 'flow_next_button',
    tag: 'button',
    roleAttr: 'button',
    text: 'Next',
    ariaLabel: 'Next',
  },
  flow_review_button: {
    key: 'flow_review_button',
    tag: 'button',
    roleAttr: 'button',
    text: 'Review Application',
    ariaLabel: 'Review',
  },
  flow_submit_button: {
    key: 'flow_submit_button',
    tag: 'button',
    typeAttr: 'submit',
    roleAttr: 'button',
    text: 'Submit Application',
    ariaLabel: 'Submit',
  },
  auth_sign_in_submit: {
    key: 'auth_sign_in_submit',
    tag: 'button',
    typeAttr: 'submit',
    roleAttr: 'button',
    text: 'Sign In',
  },
  auth_create_account_submit: {
    key: 'auth_create_account_submit',
    tag: 'button',
    typeAttr: 'submit',
    roleAttr: 'button',
    text: 'Create Account',
  },
  auth_create_account_trigger: {
    key: 'auth_create_account_trigger',
    tag: 'button',
    roleAttr: 'button',
    text: 'Create Account',
  },
  auth_create_account_fallback: {
    key: 'auth_create_account_fallback',
    tag: 'button',
    roleAttr: 'button',
    text: 'Create Account',
  },
};

export function loadAdaptiveFingerprints(storagePath?: string): Record<string, ElementFingerprint> {
  const filePath = storagePath || DEFAULT_FINGERPRINTS_PATH;
  let data: Record<string, ElementFingerprint> = {};
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      data = JSON.parse(raw);
    } catch {
      data = {};
    }
  }
  for (const [key, seed] of Object.entries(SEED_FINGERPRINTS)) {
    if (!data[key]) {
      data[key] = {
        key,
        tag: seed.tag || 'button',
        typeAttr: seed.typeAttr,
        roleAttr: seed.roleAttr,
        text: seed.text,
        ariaLabel: seed.ariaLabel,
        automationId: seed.automationId,
        classTokens: seed.classTokens || [],
        parentTag: seed.parentTag,
        updatedAt: seed.updatedAt,
      };
    }
  }
  return data;
}

export function saveAdaptiveFingerprint(fp: ElementFingerprint, storagePath?: string): void {
  const filePath = storagePath || DEFAULT_FINGERPRINTS_PATH;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const data = loadAdaptiveFingerprints(filePath);
    data[fp.key] = {
      ...fp,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch {
    // Non-fatal error on disk write
  }
}

export async function captureElementFingerprint(
  locator: Locator,
  key: string
): Promise<ElementFingerprint> {
  const fp = await locator.first().evaluate((el: Element, elementKey: string) => {
    const tag = el.tagName.toLowerCase();
    const typeAttr = el.getAttribute('type') || undefined;
    const roleAttr = el.getAttribute('role') || undefined;
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ') || undefined;
    const ariaLabel = el.getAttribute('aria-label') || undefined;
    const nameAttr = el.getAttribute('name') || undefined;
    const automationId =
      el.getAttribute('data-automation-id') ||
      el.getAttribute('data-qa') ||
      el.getAttribute('data-test-id') ||
      el.id ||
      undefined;
    const classTokens = Array.from(el.classList || []).filter(Boolean);
    const parentTag = el.parentElement ? el.parentElement.tagName.toLowerCase() : undefined;

    return {
      key: elementKey,
      tag,
      typeAttr,
      roleAttr,
      text,
      ariaLabel,
      nameAttr,
      automationId,
      classTokens,
      parentTag,
      updatedAt: new Date().toISOString(),
    };
  }, key);

  return fp;
}

export function computeFingerprintSimilarity(
  saved: ElementFingerprint,
  candidate: ElementFingerprint
): number {
  let score = 0;
  let maxScore = 0;

  // 1. Tag comparison (weight: 0.15)
  const tagWeight = 0.15;
  maxScore += tagWeight;
  const sTag = (saved.tag || '').toLowerCase().trim();
  const cTag = (candidate.tag || '').toLowerCase().trim();
  if (sTag && cTag) {
    if (sTag === cTag) {
      score += tagWeight;
    } else {
      const buttonLikeTags = new Set(['button', 'a', 'input', 'div', 'span']);
      const isSavedButtonLike = buttonLikeTags.has(sTag);
      const isCandButtonLike =
        buttonLikeTags.has(cTag) &&
        (candidate.roleAttr === 'button' ||
          candidate.typeAttr === 'button' ||
          candidate.typeAttr === 'submit' ||
          cTag === 'button' ||
          cTag === 'a');
      if (isSavedButtonLike && isCandButtonLike) {
        score += tagWeight * 0.7;
      }
    }
  }

  // 2. Type attribute (weight: 0.10)
  const typeWeight = 0.10;
  maxScore += typeWeight;
  const savedType = (saved.typeAttr || '').toLowerCase().trim();
  const candType = (candidate.typeAttr || '').toLowerCase().trim();
  if (savedType && candType) {
    if (savedType === candType) score += typeWeight;
  } else if (!savedType && !candType) {
    score += typeWeight;
  } else {
    score += typeWeight * 0.4;
  }

  // 3. Role attribute (weight: 0.10)
  const roleWeight = 0.10;
  maxScore += roleWeight;
  const savedRole = (saved.roleAttr || '').toLowerCase().trim();
  const candRole = (candidate.roleAttr || '').toLowerCase().trim();
  if (savedRole && candRole) {
    if (savedRole === candRole) score += roleWeight;
  } else if (!savedRole && !candRole) {
    score += roleWeight;
  } else {
    score += roleWeight * 0.5;
  }

  // 4. Text content (weight: 0.30)
  const textWeight = 0.30;
  maxScore += textWeight;
  const savedText = (saved.text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const candText = (candidate.text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (savedText && candText) {
    if (savedText === candText) {
      score += textWeight;
    } else if (savedText.includes(candText) || candText.includes(savedText)) {
      score += textWeight * 0.8;
    } else {
      const savedWords = new Set(savedText.split(' ').filter(Boolean));
      const candWords = new Set(candText.split(' ').filter(Boolean));
      let overlap = 0;
      for (const w of candWords) {
        if (savedWords.has(w)) overlap++;
      }
      const totalWords = new Set([...savedWords, ...candWords]).size;
      if (totalWords > 0) {
        score += textWeight * (overlap / totalWords);
      }
    }
  } else if (!savedText && !candText) {
    score += textWeight * 0.5;
  }

  // 5. Aria-label (weight: 0.15)
  const ariaWeight = 0.15;
  maxScore += ariaWeight;
  const savedAria = (saved.ariaLabel || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const candAria = (candidate.ariaLabel || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (savedAria && candAria) {
    if (savedAria === candAria) {
      score += ariaWeight;
    } else if (savedAria.includes(candAria) || candAria.includes(savedAria)) {
      score += ariaWeight * 0.8;
    }
  } else if (!savedAria && !candAria) {
    score += ariaWeight;
  } else {
    score += ariaWeight * 0.3;
  }

  // 6. Name attribute (weight: 0.05)
  const nameWeight = 0.05;
  maxScore += nameWeight;
  const savedName = (saved.nameAttr || '').toLowerCase().trim();
  const candName = (candidate.nameAttr || '').toLowerCase().trim();
  if (savedName && candName) {
    if (savedName === candName) score += nameWeight;
  } else if (!savedName && !candName) {
    score += nameWeight;
  }

  // 7. Automation ID / id (weight: 0.10)
  const autoWeight = 0.10;
  maxScore += autoWeight;
  const savedAuto = (saved.automationId || '').toLowerCase().trim();
  const candAuto = (candidate.automationId || '').toLowerCase().trim();
  if (savedAuto && candAuto) {
    if (savedAuto === candAuto) {
      score += autoWeight;
    } else if (savedAuto.includes(candAuto) || candAuto.includes(savedAuto)) {
      score += autoWeight * 0.7;
    }
  } else if (!savedAuto && !candAuto) {
    score += autoWeight;
  }

  // 8. Class tokens (weight: 0.05)
  const classWeight = 0.05;
  maxScore += classWeight;
  const savedClasses = new Set((saved.classTokens || []).map(c => c.toLowerCase()));
  const candClasses = new Set((candidate.classTokens || []).map(c => c.toLowerCase()));
  if (savedClasses.size === 0 && candClasses.size === 0) {
    score += classWeight;
  } else {
    let common = 0;
    for (const c of candClasses) {
      if (savedClasses.has(c)) common++;
    }
    const union = new Set([...savedClasses, ...candClasses]).size;
    if (union > 0) {
      score += classWeight * (common / union);
    }
  }

  // 9. Parent tag (weight: 0.05)
  const parentWeight = 0.05;
  maxScore += parentWeight;
  const savedParent = (saved.parentTag || '').toLowerCase().trim();
  const candParent = (candidate.parentTag || '').toLowerCase().trim();
  if (savedParent && candParent) {
    if (savedParent === candParent) score += parentWeight;
  } else if (!savedParent && !candParent) {
    score += parentWeight;
  }

  return maxScore > 0 ? score / maxScore : 0;
}

export interface SpatialIntent {
  kind?: 'button' | 'input';
  textPattern?: string | RegExp;
  labelSelector?: string;
  labelText?: string;
  minThreshold?: number;
  storagePath?: string;
  forceTier?: 1 | 2 | 3;
}

export async function locateBySpatialGeometryTier3(
  frame: Page | Frame,
  spatialIntent: SpatialIntent
): Promise<Locator | null> {
  const marker = `spatial_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const kind = spatialIntent.kind || 'button';
  const textPatternStr =
    typeof spatialIntent.textPattern === 'string'
      ? spatialIntent.textPattern
      : spatialIntent.textPattern instanceof RegExp
      ? spatialIntent.textPattern.source
      : '';
  const labelText = spatialIntent.labelText || '';

  const found = await frame.evaluate(
    ({ marker, kind, textPatternStr, labelText }) => {
      (globalThis as any).__name = (globalThis as any).__name || ((fn: any) => fn);
      const collectAllInteractiveShadowAware = (
        root: Document | ShadowRoot,
        sel: string,
        acc: Element[] = []
      ): Element[] => {
        for (const el of Array.from(root.querySelectorAll(sel))) {
          acc.push(el);
        }
        for (const node of Array.from(root.querySelectorAll('*'))) {
          if ((node as any).shadowRoot) {
            collectAllInteractiveShadowAware((node as any).shadowRoot, sel, acc);
          }
        }
        return acc;
      };

      if (kind === 'button') {

        const regex = textPatternStr
          ? new RegExp(textPatternStr, 'i')
          : /(?:submit|next|continue|sign\s*in|create\s*account|review|apply)/i;
        const selector =
          'button, [role="button"], input[type="submit"], input[type="button"], a[role="button"], a.btn, a.button, oc-button button, spl-button button';
        const candidates = collectAllInteractiveShadowAware(document, selector);

        let bestBtn: Element | null = null;
        let bestY = -Infinity;

        for (const el of candidates) {
          const html = el as HTMLElement;
          if (html.offsetParent === null && el.tagName.toLowerCase() !== 'body') {
            if (el.getClientRects().length === 0) continue;
          }
          if (el.getAttribute('aria-hidden') === 'true') continue;
          try {
            const style = window.getComputedStyle(el);
            if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
          } catch {}

          const text = (
            el.textContent ||
            el.getAttribute('value') ||
            el.getAttribute('aria-label') ||
            el.getAttribute('title') ||
            ''
          ).trim();
          if (!regex.test(text)) continue;

          const rect = el.getBoundingClientRect();
          if (rect.bottom > bestY) {
            bestY = rect.bottom;
            bestBtn = el;
          }
        }

        if (bestBtn) {
          bestBtn.setAttribute('data-spatial-relocated', marker);
          return true;
        }
        return false;
      }

      if (kind === 'input') {
        const query = labelText || textPatternStr;
        if (!query) return false;
        const regex = new RegExp(query, 'i');

        const allTextNodes = Array.from(
          document.querySelectorAll('label, legend, p, span, div, h1, h2, h3, h4, h5, h6, [role="heading"]')
        );

        // Find matching nodes, prioritizing actual <label>/<legend> or leaf elements with shortest text
        const matchingLabels: Element[] = [];
        for (const el of allTextNodes) {
          const html = el as HTMLElement;
          if (html.offsetParent === null && el.tagName.toLowerCase() !== 'body') {
            if (el.getClientRects().length === 0) continue;
          }
          if (el.getAttribute('aria-hidden') === 'true') continue;
          try {
            const style = window.getComputedStyle(el);
            if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
          } catch {}

          const text = (el.textContent || '').trim();
          if (regex.test(text) && text.length < 250) {
            matchingLabels.push(el);
          }
        }

        if (matchingLabels.length === 0) return false;

        // Sort: <label> / <legend> first, then by shortest text length (most specific leaf)
        matchingLabels.sort((a, b) => {
          const aTag = a.tagName.toLowerCase();
          const bTag = b.tagName.toLowerCase();
          const aIsLabel = aTag === 'label' || aTag === 'legend' ? 1 : 0;
          const bIsLabel = bTag === 'label' || bTag === 'legend' ? 1 : 0;
          if (aIsLabel !== bIsLabel) return bIsLabel - aIsLabel;
          return (a.textContent || '').trim().length - (b.textContent || '').trim().length;
        });

        const bestLabel = matchingLabels[0];
        if (!bestLabel) return false;

        // 1. Check if label has 'for' attribute pointing to an input id
        const forAttr = bestLabel.getAttribute('for');
        if (forAttr) {
          const linkedInput = document.getElementById(forAttr);
          if (linkedInput) {
            linkedInput.setAttribute('data-spatial-relocated', marker);
            return true;
          }
        }

        // 2. Check if input is directly nested inside the label
        const nestedInput = bestLabel.querySelector(
          'input:not([type="hidden"]), select, textarea, [role="combobox"], [role="textbox"]'
        );
        if (nestedInput) {
          nestedInput.setAttribute('data-spatial-relocated', marker);
          return true;
        }

        const labelRect = bestLabel.getBoundingClientRect();

        const collectAllInteractiveShadowAware = (
          root: Document | ShadowRoot,
          sel: string,
          acc: Element[] = []
        ): Element[] => {
          for (const el of Array.from(root.querySelectorAll(sel))) {
            acc.push(el);
          }
          for (const node of Array.from(root.querySelectorAll('*'))) {
            if ((node as any).shadowRoot) {
              collectAllInteractiveShadowAware((node as any).shadowRoot, sel, acc);
            }
          }
          return acc;
        };

        const inputSelector =
          'input:not([type="hidden"]), select, textarea, [role="combobox"], [role="textbox"]';
        const inputCandidates = collectAllInteractiveShadowAware(document, inputSelector);

        let bestInput: Element | null = null;
        let minDistance = Infinity;

        for (const input of inputCandidates) {
          const html = input as HTMLElement;
          if (html.offsetParent === null && input.tagName.toLowerCase() !== 'body') {
            if (input.getClientRects().length === 0) continue;
          }
          if (input.getAttribute('aria-hidden') === 'true') continue;
          try {
            const style = window.getComputedStyle(input);
            if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
          } catch {}

          const inputRect = input.getBoundingClientRect();
          const dx = inputRect.left - labelRect.left;
          const dy = inputRect.top - labelRect.bottom;

          const isBelow = dy >= -15;
          const isRight = dx >= 0 && Math.abs(inputRect.top - labelRect.top) < 60;

          if (isBelow || isRight) {
            const distance = Math.hypot(Math.max(0, dx), Math.max(0, dy));
            if (distance < minDistance) {
              minDistance = distance;
              bestInput = input;
            }
          }
        }

        if (bestInput) {
          bestInput.setAttribute('data-spatial-relocated', marker);
          return true;
        }
        return false;
      }

      return false;
    },
    { marker, kind, textPatternStr, labelText }
  ).catch(() => false);

  if (found) {
    return frame.locator(`[data-spatial-relocated="${marker}"]`).first();
  }
  return null;
}

export async function findAdaptiveLocator(
  frame: Page | Frame,
  primarySelector: string | Locator,
  fingerprintKey: string,
  spatialIntentOrThreshold?: number | SpatialIntent,
  storagePathArg?: string
): Promise<Locator> {
  let minThreshold = 0.68;
  let spatialIntent: SpatialIntent | undefined;
  let storagePath: string | undefined = storagePathArg;

  if (typeof spatialIntentOrThreshold === 'number') {
    minThreshold = spatialIntentOrThreshold;
  } else if (spatialIntentOrThreshold && typeof spatialIntentOrThreshold === 'object') {
    spatialIntent = spatialIntentOrThreshold;
    minThreshold = spatialIntent.minThreshold ?? 0.68;
    storagePath = spatialIntent.storagePath ?? storagePath;
  }

  const primaryLoc =
    typeof primarySelector === 'string' ? frame.locator(primarySelector) : primarySelector;

  const forceTier = spatialIntent?.forceTier;

  // --- TIER 1: Primary CSS / ARIA Selector ---
  if (!forceTier || forceTier === 1) {
    const count = await primaryLoc.count().catch(() => 0);
    if (count > 0) {
      let visibleLoc: Locator | null = null;
      for (let i = 0; i < count; i++) {
        const candidateLoc = primaryLoc.nth(i);
        if (await candidateLoc.isVisible().catch(() => false)) {
          visibleLoc = candidateLoc;
          break;
        }
      }
      if (visibleLoc) {
        captureElementFingerprint(visibleLoc, fingerprintKey)
          .then(fp => saveAdaptiveFingerprint(fp, storagePath))
          .catch(() => {});
        return visibleLoc;
      }
    }
    if (forceTier === 1) return primaryLoc;
  }

  // --- TIER 2: Scrapling-style Weighted DOM Fingerprint Similarity Scoring ---
  if (!forceTier || forceTier === 2) {
    const fingerprints = loadAdaptiveFingerprints(storagePath);
    const saved = fingerprints[fingerprintKey];
    if (saved) {
      const marker = `adaptive_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const textPatternStr = spatialIntent?.textPattern instanceof RegExp
        ? spatialIntent.textPattern.source
        : typeof spatialIntent?.textPattern === 'string'
        ? spatialIntent.textPattern
        : undefined;
      const textPatternFlags = spatialIntent?.textPattern instanceof RegExp
        ? spatialIntent.textPattern.flags
        : 'i';

      const relocated = await frame.evaluate(
        ({ saved, minThreshold, marker, textPatternStr, textPatternFlags }) => {
          (globalThis as any).__name = (globalThis as any).__name || ((fn: any) => fn);
          const collectAllInteractiveShadowAware = (
            root: Document | ShadowRoot,
            sel: string,
            acc: Element[] = []
          ): Element[] => {
            for (const el of Array.from(root.querySelectorAll(sel))) {
              acc.push(el);
            }
            for (const node of Array.from(root.querySelectorAll('*'))) {
              if ((node as any).shadowRoot) {
                collectAllInteractiveShadowAware((node as any).shadowRoot, sel, acc);
              }
            }
            return acc;
          };

          const selector = `button, [role="button"], input[type="button"], input[type="submit"], a, [role="link"], oc-button button, spl-button button${saved.tag ? `, ${saved.tag}` : ''}`;
          const elements = collectAllInteractiveShadowAware(document, selector);

          let bestEl: Element | null = null;
          let bestScore = -1;

          for (const el of elements) {
            const htmlEl = el as HTMLElement;
            if (htmlEl.offsetParent === null && el.tagName.toLowerCase() !== 'body') {
              if (el.getClientRects().length === 0) continue;
            }

            if (el.getAttribute('aria-hidden') === 'true') continue;
            try {
              if (window.getComputedStyle(el).visibility === 'hidden') continue;
            } catch {}

            const candTag = el.tagName.toLowerCase();
            const candType = (el.getAttribute('type') || '').toLowerCase().trim();
            const candRole = (el.getAttribute('role') || '').toLowerCase().trim();
            const candText = (el.textContent || '').toLowerCase().replace(/\s+/g, ' ').trim();
            const candAria = (el.getAttribute('aria-label') || '').toLowerCase().replace(/\s+/g, ' ').trim();

            if (textPatternStr) {
              try {
                const rx = new RegExp(textPatternStr, textPatternFlags);
                if (!rx.test(candText) && !rx.test(candAria)) {
                  continue;
                }
              } catch {}
            }
            if (saved.key === 'flow_next_button' && /\b(?:submit|apply)\b/i.test(candText)) {
              continue;
            }
            if (saved.key === 'flow_submit_button' && /\b(?:next|continue)\b/i.test(candText)) {
              continue;
            }

            const candName = (el.getAttribute('name') || '').toLowerCase().trim();
            const candAuto = (
              el.getAttribute('data-automation-id') ||
              el.getAttribute('data-qa') ||
              el.getAttribute('data-test-id') ||
              el.id ||
              ''
            ).toLowerCase().trim();
            const candClasses = Array.from(el.classList || []).map(c => c.toLowerCase());
            const candParent = (el.parentElement ? el.parentElement.tagName : '').toLowerCase().trim();

            let score = 0;
            let maxScore = 0;

            // 1. Tag
            maxScore += 0.15;
            if (candTag && saved.tag) {
              if (candTag === saved.tag.toLowerCase()) {
                score += 0.15;
              } else {
                const buttonLike = ['button', 'a', 'input', 'div', 'span'];
                const sTag = saved.tag.toLowerCase();
                if (buttonLike.includes(sTag) && buttonLike.includes(candTag)) {
                  if (
                    candRole === 'button' ||
                    candType === 'button' ||
                    candType === 'submit' ||
                    candTag === 'button' ||
                    candTag === 'a'
                  ) {
                    score += 0.15 * 0.7;
                  }
                }
              }
            }

            // 2. Type
            maxScore += 0.10;
            const sType = (saved.typeAttr || '').toLowerCase().trim();
            if (sType && candType) {
              if (sType === candType) score += 0.10;
            } else if (!sType && !candType) score += 0.10;
            else score += 0.04;

            // 3. Role
            maxScore += 0.10;
            const sRole = (saved.roleAttr || '').toLowerCase().trim();
            if (sRole && candRole) {
              if (sRole === candRole) score += 0.10;
            } else if (!sRole && !candRole) score += 0.10;
            else score += 0.05;

            // 4. Text
            maxScore += 0.30;
            const sText = (saved.text || '').toLowerCase().replace(/\s+/g, ' ').trim();
            if (sText && candText) {
              if (sText === candText) score += 0.30;
              else if (sText.includes(candText) || candText.includes(sText)) score += 0.24;
              else {
                const sWords = sText.split(' ').filter(Boolean);
                const cWords = candText.split(' ').filter(Boolean);
                let common = 0;
                for (const w of cWords) {
                  if (sWords.includes(w)) common++;
                }
                const total = new Set([...sWords, ...cWords]).size;
                if (total > 0) score += 0.30 * (common / total);
              }
            } else if (!sText && !candText) score += 0.15;

            // 5. Aria
            maxScore += 0.15;
            const sAria = (saved.ariaLabel || '').toLowerCase().replace(/\s+/g, ' ').trim();
            if (sAria && candAria) {
              if (sAria === candAria) score += 0.15;
              else if (sAria.includes(candAria) || candAria.includes(sAria)) score += 0.12;
            } else if (!sAria && !candAria) score += 0.15;
            else score += 0.045;

            // 6. Name
            maxScore += 0.05;
            const sName = (saved.nameAttr || '').toLowerCase().trim();
            if (sName && candName) {
              if (sName === candName) score += 0.05;
            } else if (!sName && !candName) score += 0.05;

            // 7. AutomationId
            maxScore += 0.10;
            const sAuto = (saved.automationId || '').toLowerCase().trim();
            if (sAuto && candAuto) {
              if (sAuto === candAuto) score += 0.10;
              else if (sAuto.includes(candAuto) || candAuto.includes(sAuto)) score += 0.07;
            } else if (!sAuto && !candAuto) score += 0.10;

            // 8. ClassTokens
            maxScore += 0.05;
            const sClasses = (saved.classTokens || []).map((c: string) => c.toLowerCase());
            if (sClasses.length === 0 && candClasses.length === 0) score += 0.05;
            else {
              let common = 0;
              for (const c of candClasses) {
                if (sClasses.includes(c)) common++;
              }
              const total = new Set([...sClasses, ...candClasses]).size;
              if (total > 0) score += 0.05 * (common / total);
            }

            // 9. Parent
            maxScore += 0.05;
            const sParent = (saved.parentTag || '').toLowerCase().trim();
            if (sParent && candParent) {
              if (sParent === candParent) score += 0.05;
            } else if (!sParent && !candParent) score += 0.05;

            let similarity = maxScore > 0 ? score / maxScore : 0;
            const isDisabled =
              (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true';
            if (isDisabled) {
              similarity *= 0.5;
            }

            if (similarity > bestScore) {
              bestScore = similarity;
              bestEl = el;
            }
          }

          if (bestEl && bestScore >= minThreshold) {
            bestEl.setAttribute('data-adaptive-relocated', marker);
            return { found: true, score: bestScore };
          }

          return { found: false, score: bestScore };
        },
        { saved, minThreshold, marker, textPatternStr, textPatternFlags }
      ).catch(() => ({ found: false, score: 0 }));

      if (relocated.found) {
        const relocatedLocator = frame.locator(`[data-adaptive-relocated="${marker}"]`).first();
        captureElementFingerprint(relocatedLocator, fingerprintKey)
          .then(fp => saveAdaptiveFingerprint(fp, storagePath))
          .catch(() => {});
        return relocatedLocator;
      }
    }
    if (forceTier === 2) return primaryLoc;
  }

  // --- TIER 3: 2D Euclidean Spatial Bounding-Box Geometry ---
  const defaultKind = /input|field|textbox|name|email|phone|city|postal|location/i.test(fingerprintKey) ? 'input' : 'button';
  let defaultText = fingerprintKey
    .replace(/^(?:flow_|auth_|candidate_|applicant_|user_|job_)/, '')
    .replace(/_(?:button|submit|trigger|fallback|input|field)$/g, '')
    .replace(/_/g, ' ');
  const coreWords = defaultText.split(' ').filter(w => !['candidate', 'applicant', 'user', 'the'].includes(w.toLowerCase())).join(' ');
  if (coreWords) defaultText = coreWords;

  const intent: SpatialIntent = {
    kind: spatialIntent?.kind || defaultKind,
    textPattern: spatialIntent?.textPattern || (spatialIntent?.labelText ? undefined : defaultText),
    labelText: spatialIntent?.labelText,
    storagePath,
    minThreshold,
  };

  const spatialLoc = await locateBySpatialGeometryTier3(frame, intent);
  if (spatialLoc && (await spatialLoc.count().catch(() => 0)) > 0) {
    captureElementFingerprint(spatialLoc, fingerprintKey)
      .then(fp => saveAdaptiveFingerprint(fp, storagePath))
      .catch(() => {});
    return spatialLoc;
  }

  return primaryLoc;
}
