import type { Frame } from 'patchright';
import { createHash } from 'node:crypto';

export type WidgetKind = 'TEXT' | 'NUMBER' | 'TEXTAREA' | 'BOOLEAN_TOGGLE' | 'SINGLE_SELECT' | 'MULTI_SELECT' | 'DATE_SPLIT' | 'DATE_NATIVE' | 'FILE_UPLOAD';

export interface DistilledField {
  refKey: string;
  widgetKind: WidgetKind;
  questionText: string;
  sectionHeading: string;
  isRequired: boolean;
  isFilled: boolean;
  currentValue: string;
  options: string[];
  validationError: string | null;
  containerSelector: string;
  controlSelector: string;
}

export interface GreenhouseQuestionSchemaItem {
  fieldName: string;
  label: string;
  required: boolean;
  options: string[];
}

const greenhouseSchemaCache = new Map<string, { data: Map<string, GreenhouseQuestionSchemaItem>; expiresAt: number }>();

export async function fetchGreenhouseQuestionSchema(jobUrl: string): Promise<Map<string, GreenhouseQuestionSchemaItem>> {
  const map = new Map<string, GreenhouseQuestionSchemaItem>();
  try {
    const u = new URL(jobUrl);
    const cached = greenhouseSchemaCache.get(jobUrl);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }

    const parts = u.pathname.split('/').filter(Boolean);
    const board = u.searchParams.get('for') || (parts[0] !== 'embed' ? parts[0] : null);
    const jobId =
      u.pathname.match(/\/jobs\/(\d+)/)?.[1] ||
      u.searchParams.get('token') ||
      u.searchParams.get('gh_jid');

    if (!board || !jobId) return map;
    const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${encodeURIComponent(jobId)}?questions=true`;
    const res = await fetch(apiUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return map;

    const data = (await res.json()) as {
      questions?: Array<{
        label?: string;
        required?: boolean;
        fields?: Array<{ name?: string; values?: Array<{ label?: string }> }>;
      }>;
    };

    for (const q of data.questions || []) {
      const label = (q.label || '').trim();
      if (!label) continue;
      for (const f of q.fields || []) {
        if (!f.name) continue;
        const opts = (f.values || []).map(v => (v.label || '').trim()).filter(Boolean);
        map.set(f.name.replace(/\[\]$/, ''), {
          fieldName: f.name,
          label,
          required: Boolean(q.required),
          options: opts,
        });
      }
    }
    greenhouseSchemaCache.set(jobUrl, { data: map, expiresAt: Date.now() + 600_000 });
  } catch {}
  return map;
}

export function isInteractiveChoiceReadOnly(el: Element): boolean {
  const role = el.getAttribute('role');
  const uxi = el.getAttribute('data-uxi-widget-type');
  const hasPopup = el.getAttribute('aria-haspopup');
  const controls = el.getAttribute('aria-controls');
  const owns = el.getAttribute('aria-owns');
  return role === 'combobox' || role === 'listbox' || uxi === 'selectinput' || !!hasPopup || !!controls || !!owns;
}

export function getParentOrShadowHost(node: Element | null): HTMLElement | null {
  if (!node) return null;
  if (node.parentElement) return node.parentElement;
  const root = node.getRootNode?.();
  if (root && (root as ShadowRoot).host) {
    return (root as ShadowRoot).host as HTMLElement;
  }
  return null;
}

const BARE_OPTION_REGEX = /^(?:yes|no|true|false|male|female|other|none|i agree|select\.\.\.|month\.\.\.|year\.\.\.)$/i;

function isCleanQuestionCandidate(txt: string | null | undefined): boolean {
  if (!txt) return false;
  const clean = txt.replace(/\s+/g, ' ').trim();
  if (!clean || clean.length < 2) return false;
  if (BARE_OPTION_REGEX.test(clean)) return false;
  return true;
}

export function appendSectionContextIfAmbiguous(text: string, el: Element | null): string {
  if (!el || !text) return text;
  const clean = text.replace(/\s+/g, ' ').trim();
  if (/^(?:from|to|start\s*date|end\s*date|start\s*year|end\s*year|start\s*month|end\s*month|month|year|date|location|city|description|role\s*description)\s*\*?$/i.test(clean)) {
    if (el.closest('[data-automation-id="educationSection"], [class*="education" i], [id*="education" i]')) {
      return `${clean} (Education)`;
    }
    if (el.closest('[data-automation-id="workExperienceSection"], [class*="experience" i], [id*="experience" i], [class*="employment" i]')) {
      return `${clean} (Work Experience)`;
    }
  }
  return clean;
}

export function extractCleanQuestionText(box: Element, els: Element[] = []): string {
  const rawText = _extractRawCleanQuestionText(box, els);
  const first = els[0] || (box.matches?.('input,select,textarea,[role="combobox"]') ? box : box.querySelector?.('input,select,textarea,[role="combobox"]'));
  let finalQ = appendSectionContextIfAmbiguous(rawText, first || box);

  // GEN-263: aria-describedby format hint appender
  const target = first || box;
  const describedBy = target?.getAttribute?.('aria-describedby');
  if (describedBy) {
    const root = target.getRootNode() as Document | ShadowRoot;
    const findById = (id: string): Element | null => {
      if (!id) return null;
      if (typeof (root as Document).getElementById === 'function') return (root as Document).getElementById(id);
      try { return root.querySelector(`[id="${id.replace(/"/g, '\\\"')}"]`); } catch { return null; }
    };
    for (const id of describedBy.split(/\s+/).filter(Boolean)) {
      const hintEl = findById(id);
      const hintText = hintEl?.textContent?.replace(/\s+/g, ' ').trim() || '';
      if (
        hintText.length > 0 &&
        hintText.length <= 90 &&
        !/required|invalid|error/i.test(hintText) &&
        /\b(?:lpa|lakhs?|inr|months|days|out\s+of\s+(?:10|4)|scale|yyyy-mm-dd|mm\/dd\/yyyy)\b/i.test(hintText)
      ) {
        if (!finalQ.includes(hintText)) {
          finalQ = `${finalQ} (${hintText})`;
        }
        break;
      }
    }
  }

  // GEN-440: SmartRecruiters Shadow-Root Host Label Unwrapper
  if (!isCleanQuestionCandidate(finalQ) || finalQ === 'Field') {
    const elTarget = first || box;
    const elRoot = typeof elTarget?.getRootNode === 'function' ? elTarget.getRootNode() : null;
    if (elRoot && typeof ShadowRoot !== 'undefined' && elRoot instanceof ShadowRoot) {
      let host: Element | null = elRoot.host;
      for (let level = 0; level < 3 && host; level++) {
        const hostLabel =
          host.getAttribute('label') ||
          host.getAttribute('aria-label') ||
          host.querySelector('oc-field-label, label, .label')?.textContent?.trim();
        if (hostLabel && isCleanQuestionCandidate(hostLabel)) {
          finalQ = appendSectionContextIfAmbiguous(hostLabel.trim(), host);
          break;
        }
        const parentRoot: any = typeof host.getRootNode === 'function' ? host.getRootNode() : null;
        host = parentRoot && typeof ShadowRoot !== 'undefined' && parentRoot instanceof ShadowRoot ? parentRoot.host : null;
      }
    }
  }

  return finalQ;
}

const STRIP_OPTION_VALUES_REGEX = /\b(yes|no|male|female|decline to state|i agree|agree|disagree|decline|prefer not to say|other|i accept|accept)\b/gi;

export function stripOptionLabels(text: string): string {
  return String(text || '')
    .replace(STRIP_OPTION_VALUES_REGEX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizePrompt(raw: string): string {
  return raw
    .replace(/\s*\*+\s*$/, '') // remove trailing asterisks
    .replace(/\s+/g, ' ')
    .trim();
}

function _extractRawCleanQuestionText(box: Element, els: Element[] = []): string {
  const root = (typeof box.getRootNode === 'function' ? box.getRootNode() : null) as Document | ShadowRoot | null;
  const findById = (id: string): Element | null => {
    if (!id || !root) return null;
    if (typeof (root as Document).getElementById === 'function') return (root as Document).getElementById(id);
    try { return root.querySelector(`[id="${id.replace(/"/g, '\\\"')}"]`); } catch { return null; }
  };
  const first = els[0] || (box.matches?.('input,select,textarea,[role="combobox"]') ? box : box.querySelector?.('input,select,textarea,[role="combobox"]'));
  
  const isChoiceInput = (target: any): boolean => {
    if (!target) return false;
    const tagName = (target.tagName || '').toLowerCase();
    const inputType = (target.getAttribute?.('type') || target.type || '').toLowerCase();
    return (tagName === 'input' || target.type !== undefined) && (inputType === 'radio' || inputType === 'checkbox');
  };

  const isRadioOrCheckbox = Boolean(isChoiceInput(first) || isChoiceInput(box));
  const choiceEl = isChoiceInput(first) ? first : isChoiceInput(box) ? box : null;

  // GEN-129 & GEN-428: W3C AccName tree walk for radio/checkbox groups
  if (choiceEl) {
    // 1. Check for W3C aria-labelledby on the input or its role="radiogroup" container
    const groupContainer = choiceEl.closest?.('[role="radiogroup"], fieldset, .application-question, .field');
    if (groupContainer) {
      // Check for legend or main-label first
      const legend = groupContainer.querySelector?.('legend, .legend, .application-label, label.main-label, [id$="-label"]');
      if (legend && legend.textContent?.trim()) {
        return sanitizePrompt(legend.textContent);
      }

      // Check for aria-labelledby on container
      const labelledBy = groupContainer.getAttribute?.('aria-labelledby') || choiceEl.getAttribute?.('aria-labelledby');
      if (labelledBy) {
        const parts = labelledBy.split(/\s+/).map((id: string) => findById(id)?.textContent?.trim()).filter(Boolean);
        if (parts.length > 0) {
          return sanitizePrompt(parts.join(' '));
        }
      }
    }

    // 2. Climb up to 4 levels looking for prompt wrappers while avoiding option text
    let curr: Element | null = choiceEl.parentElement;
    let depth = 0;
    while (curr && depth < 4) {
      const cls = curr.className || '';
      const tag = (curr.tagName || '').toLowerCase();
      if (
        (typeof cls === 'string' && (cls.includes('field') || cls.includes('application-question'))) ||
        tag === 'fieldset'
      ) {
        let promptEl: Element | null = null;
        try {
          const rawId = (choiceEl as any).id || '';
          const escapedId = rawId ? rawId.replace(/["\\]/g, '\\$&') : '';
          const selector = escapedId
            ? `.text, label:not([for="${escapedId}"]), .prompt, h3, h4`
            : '.text, label, .prompt, h3, h4';
          promptEl = curr.querySelector?.(selector);
        } catch {
          promptEl = null;
        }
        if (promptEl && promptEl.textContent?.trim()) {
          const text = promptEl.textContent.trim();
          // Ignore if the text is just an option label
          if (!/^(yes|no|male|female|decline|i agree|true|false)$/i.test(text)) {
            return sanitizePrompt(text);
          }
        }
      }
      curr = curr.parentElement;
      depth++;
    }
  }

  if (isRadioOrCheckbox && first) {
    // 1. Legend of closest fieldset
    const legend = first.closest?.('fieldset')?.querySelector?.('legend')?.textContent?.trim();
    if (legend) {
      const cleanLegend = stripOptionLabels(legend);
      if (isCleanQuestionCandidate(cleanLegend)) return cleanLegend.slice(0, 1500);
    }

    // 2. Container check: .field, .application-question, fieldset, or parent container
    const container = first.closest?.('.field, .application-question, [class*="question"], fieldset, [data-automation-id^="formField-"], [class*="_fieldEntry_"]');
    if (container) {
      // Check explicit label.main-label or .question-label or legend first
      const mainLabel = container.querySelector?.('label.main-label, .main-label, legend, label.question-label, [class*="question-title"], [class*="prompt"]')?.textContent?.trim();
      if (mainLabel) {
        const cleanMain = stripOptionLabels(mainLabel);
        if (isCleanQuestionCandidate(cleanMain)) return cleanMain.slice(0, 1500);
      }

      // Preceding sibling elements with class names containing question, label, or title
      let sibling = (first.closest('.field, .application-question, label, .radio, .checkbox') || first).previousElementSibling;
      while (sibling) {
        const cls = (sibling.className || '').toLowerCase();
        const tag = sibling.tagName.toLowerCase();
        if (cls.includes('question') || cls.includes('label') || cls.includes('title') || tag === 'label' || tag === 'legend' || tag === 'p' || tag === 'h3' || tag === 'h4') {
          const sibText = stripOptionLabels(sibling.textContent || '');
          if (isCleanQuestionCandidate(sibText)) return sibText.slice(0, 1500);
        }
        sibling = sibling.previousElementSibling;
      }

      // Lever/Workday/Ashby direct question label
      const leverQuestion = container.querySelector('.text, .application-label, label:not([class*="option"])')?.textContent?.trim();
      if (leverQuestion) {
        const cleanLever = stripOptionLabels(leverQuestion);
        if (isCleanQuestionCandidate(cleanLever)) return cleanLever.slice(0, 1500);
      }

      // W3C composite container text minus option labels
      const composite = stripOptionLabels(container.textContent || '');
      if (isCleanQuestionCandidate(composite)) {
        return composite.slice(0, 1500);
      }
    }

    const rg = first.closest('[role="radiogroup"], [role="group"]');
    if (rg) {
      const rgAria = stripOptionLabels((rg.getAttribute('aria-label') || '').trim());
      if (isCleanQuestionCandidate(rgAria)) return rgAria.slice(0, 1500);
      const rgLinked = stripOptionLabels((rg.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => findById(id)?.textContent || '').join(' ').trim());
      if (isCleanQuestionCandidate(rgLinked)) return rgLinked.slice(0, 1500);
    }
  }

  // 1. Explicit label for ID (skip for radio/checkbox to prevent option label poisoning)
  if (first?.id && !isRadioOrCheckbox) {
    const escapedId = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(first.id) : first.id.replace(/"/g, "\\\"");
    const explicitFor = (root as Document).querySelector?.(`label[for="${escapedId}"]`);
    if (isCleanQuestionCandidate(explicitFor?.textContent)) {
      return explicitFor!.textContent!.replace(/\s+/g, ' ').trim().slice(0, 1500);
    }
  }

  // 2. Wrapper label (skip if radio/checkbox)
  if (!isRadioOrCheckbox) {
    const wrapperLabel = first?.closest?.('.select-shell, .input-wrapper, .field, [class*="field"], .application-question')?.querySelector('label');
    if (isCleanQuestionCandidate(wrapperLabel?.textContent) && !wrapperLabel!.querySelector('input[type="radio"], input[type="checkbox"]')) {
      return wrapperLabel!.textContent!.replace(/\s+/g, ' ').trim().slice(0, 1500);
    }
  }

  // 3. Linked aria-labelledby (W3C AccName-AAM multi-ID traversal - GEN-321)
  const resolveAriaLabelledBy = (el: Element | null): string => {
    if (!el || typeof el.getAttribute !== 'function') return '';
    const attr = el.getAttribute('aria-labelledby');
    if (!attr) return '';
    return attr
      .split(/\s+/)
      .map(id => findById(id)?.textContent?.trim() || '')
      .filter(Boolean)
      .join(' ')
      .trim();
  };
  const elLinked = resolveAriaLabelledBy(first);
  const boxLinked = resolveAriaLabelledBy(box);
  const linked = elLinked || boxLinked;
  if (isCleanQuestionCandidate(linked)) return linked.replace(/\s+/g, ' ').trim().slice(0, 1500);

  // 3b. Table cell / Definition list label lookup (browser-use - GEN-326 & GEN-327)
  const td = (first || box)?.closest?.('td');
  if (td) {
    const prevTdText = td.previousElementSibling?.textContent?.replace(/\s+/g, ' ').trim();
    if (prevTdText && isCleanQuestionCandidate(prevTdText)) {
      return prevTdText.slice(0, 1500);
    }
  }
  const dd = (first || box)?.closest?.('dd');
  if (dd) {
    const prevDtText = dd.previousElementSibling?.textContent?.replace(/\s+/g, ' ').trim();
    if (prevDtText && isCleanQuestionCandidate(prevDtText)) {
      return prevDtText.slice(0, 1500);
    }
  }

  // 4. Explicit legends / Ashby titles / single question labels
  const explicitTitle = box?.querySelector?.(
    'legend, .ashby-application-form-question-title, [data-automation-id$="-legend"], label[data-automation-id*="formLabel"], .field-label, .application-label'
  )?.textContent?.trim();
  if (isCleanQuestionCandidate(explicitTitle)) return explicitTitle!.replace(/\s+/g, ' ').trim().slice(0, 1500);

  // 5. Single label in box that doesn't wrap radio/checkbox
  const singleLabels = box?.querySelectorAll
    ? Array.from(box.querySelectorAll('label')).filter(l => !l.querySelector('input[type="radio"], input[type="checkbox"]'))
    : [];
  if (singleLabels.length === 1 && isCleanQuestionCandidate(singleLabels[0]?.textContent)) {
    return singleLabels[0]!.textContent!.replace(/\s+/g, ' ').trim().slice(0, 1500);
  }

  const labels = first ? Array.from((first as HTMLInputElement).labels || []).map(label => label.textContent || '').join(' ').trim() : '';
  if (isCleanQuestionCandidate(labels)) return labels.replace(/\s+/g, ' ').trim().slice(0, 1500);

  // 6. Ancestor Climbing (up to 5 levels) with Shadow Root boundary crossing
  let currentParent: HTMLElement | null = getParentOrShadowHost(first || box);
  for (let depth = 0; depth < 5 && currentParent && (!currentParent.matches || !currentParent.matches('body, form')); depth++) {
    // GEN-272: Single-Control LCA Ceiling — avoid merging labels across 2-column sibling grid cells
    const distinctInputsInAncestor = currentParent.querySelectorAll
      ? currentParent.querySelectorAll(
          'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), select, textarea'
        ).length
      : 0;
    if (distinctInputsInAncestor > 1) {
      break;
    }

    // Check custom Web Component host attributes (<spl-input label="First name *">, <oc-form-field label="City">)
    const hostLabel = currentParent.getAttribute?.('label') || currentParent.getAttribute?.('data-label') || currentParent.getAttribute?.('aria-label');
    if (isCleanQuestionCandidate(hostLabel)) {
      return hostLabel!.replace(/\s+/g, ' ').trim().slice(0, 1500);
    }

    const legend = currentParent.querySelector?.('legend, .ashby-application-form-question-title, [data-automation-id$="-legend"], label[data-automation-id*="formLabel"], .field-label, .application-label');
    if (isCleanQuestionCandidate(legend?.textContent)) {
      return legend!.textContent!.replace(/\s+/g, ' ').trim().slice(0, 1500);
    }
    if (typeof currentParent.cloneNode === 'function') {
      const pClone = currentParent.cloneNode(true) as Element;
      pClone.querySelectorAll?.('select, option, textarea, input, button, [role="listbox"], [role="option"], .error, [role="alert"], [class*="placeholder"], script, style')?.forEach(n => n.remove());
      pClone.querySelectorAll?.('label')?.forEach(l => {
        if (!isCleanQuestionCandidate(l.textContent)) l.remove();
      });
      const pText = pClone.textContent?.replace(/\s+/g, ' ').trim() || '';
      if (isCleanQuestionCandidate(pText)) {
        return pText.slice(0, 1500);
      }
    }
    currentParent = getParentOrShadowHost(currentParent);
  }

  // 7. Box clone text
  if (box && typeof box.cloneNode === 'function') {
    const clone = box.cloneNode(true) as Element;
    clone.querySelectorAll?.('select, option, textarea, input, button, [role="listbox"], [role="option"], .error, [role="alert"], [class*="placeholder"], script, style')?.forEach((node: any) => node.remove());
    if (els.length > 1 && els.some(e => (e as HTMLInputElement).type === 'radio' || e.getAttribute('role') === 'radio')) {
      clone.querySelectorAll?.('label')?.forEach((label: any) => label.remove());
    }
    const text = clone.textContent?.replace(/\s+/g, ' ').trim() || '';
    if (isCleanQuestionCandidate(text) && !/^(?:select|choose)\b|\.{3}/i.test(text)) return text.slice(0, 1500);
  }

  if (first) {
    const fallback = labels || first.getAttribute('aria-label') || first.getAttribute('placeholder') || first.getAttribute('name') || first.id || 'Field';
    if (isCleanQuestionCandidate(fallback)) return fallback.replace(/\s+/g, ' ').trim().slice(0, 1500);
  }
  return 'Field';
}

export function groupKeyFor(el: Element): string | null {
  const input = el as HTMLInputElement;
  const workdayDate = el.closest('[data-automation-id^="formField-"]');
  if (workdayDate && workdayDate.querySelector('[data-automation-id="dateSectionMonth-input"]')) {
    return `workday-split-date:${workdayDate.getAttribute('data-automation-id')}`;
  }
  const ashbyField = el.closest('.ashby-application-form-field-entry');
  if (ashbyField && ashbyField.querySelector('.ashby-application-form-input-yesno, [role="radiogroup"]')) {
    return `ashby-field:${ashbyField.getAttribute('data-field-path') || ashbyField.className}`;
  }
  if (input.type === 'radio' && input.name) {
    return `radio:${input.name}`;
  }
  if (el.getAttribute('role') === 'radio' && el.closest('[role="radiogroup"]')) {
    const rg = el.closest('[role="radiogroup"]');
    return `radiogroup:${rg?.id || rg?.getAttribute('aria-labelledby') || rg?.getAttribute('name') || 'group'}`;
  }
  return null;
}

export function isBotTrapOrHoneypot(el: Element): boolean {
  const meta = [
    el.id,
    el.getAttribute('name'),
    el.getAttribute('class'),
    el.getAttribute('data-automation-id'),
    el.getAttribute('autocomplete'),
  ].filter(Boolean).join(' ');

  if (/beecatcher|honey-?pot|bot[-_]?trap|website_url_confirm|fax_number|b_name/i.test(meta)) return true;
  if (el.getAttribute('aria-hidden') === 'true' || el.closest('[aria-hidden="true"], [hidden]')) return true;

  const input = el as HTMLInputElement;
  const isCombobox = el.getAttribute('role') === 'combobox' || el.getAttribute('data-uxi-widget-type') === 'selectinput';
  if (input.tabIndex === -1 && !isCombobox && (input.type === 'text' || input.type === 'email' || input.type === 'url')) {
    return true;
  }
  return false;
}

export function isDisabledControl(el: Element): boolean {
  const input = el as HTMLInputElement;
  if (input.disabled === true || el.getAttribute('aria-disabled') === 'true') return true;
  if (el.closest('fieldset[disabled]')) return true;
  return false;
}

export function collectControls(elements: Element[]): Element[] {
  return elements.filter(el => {
    if (isBotTrapOrHoneypot(el)) return false;
    if (isDisabledControl(el)) return false;
    // Ticket GEN-93.3: Exclude elements inside navigation, header, footer, cookies
    if (el.closest('header, nav, footer, [role="navigation"], [role="banner"], [role="contentinfo"], [id*="cookie" i], [class*="cookie" i]')) {
      return false;
    }
    if (el.classList.contains('select__input') && !!el.closest('.select__control')?.querySelector('.select__single-value, .select__multi-value')) {
      return false;
    }
    const input = el as HTMLInputElement;
    if (input.readOnly && !isInteractiveChoiceReadOnly(el)) return false;
    return true;
  });
}

/** Runs inside each frame; Playwright locators already pierce open shadow roots. */
export function annotateQuestionClusters(elements: Element[]): void {
  var __name = (globalThis as any).__name || function(fn: any) { return fn; };
  if (typeof (globalThis as any).__name !== 'function') (globalThis as any).__name = __name;

  const controls = elements.filter(el => {
    const meta = [
      el.id,
      el.getAttribute('name'),
      el.getAttribute('class'),
      el.getAttribute('data-automation-id'),
      el.getAttribute('autocomplete'),
    ].filter(Boolean).join(' ');
    if (/beecatcher|honey-?pot|bot[-_]?trap|website_url_confirm|fax_number|b_name/i.test(meta)) return false;
    if (el.getAttribute('aria-hidden') === 'true' || el.closest('[aria-hidden="true"], [hidden]')) return false;
    const input = el as HTMLInputElement;
    const isCombobox = el.getAttribute('role') === 'combobox' || el.getAttribute('data-uxi-widget-type') === 'selectinput';
    if (input.tabIndex === -1 && !isCombobox && (input.type === 'text' || input.type === 'email' || input.type === 'url')) {
      return false;
    }
    if (input.disabled === true || el.getAttribute('aria-disabled') === 'true') return false;
    if (el.closest('fieldset[disabled]')) return false;
    // Ticket GEN-93.3: Exclude elements inside navigation, header, footer, cookies
    if (el.closest('header, nav, footer, [role="navigation"], [role="banner"], [role="contentinfo"], [id*="cookie" i], [class*="cookie" i]')) {
      return false;
    }
    const isChoice = el.getAttribute('role') === 'combobox' || el.getAttribute('role') === 'listbox' || el.getAttribute('data-uxi-widget-type') === 'selectinput' || !!el.getAttribute('aria-haspopup') || !!el.getAttribute('aria-controls') || !!el.getAttribute('aria-owns');
    if (input.readOnly && !isChoice) return false;
    return true;
  });

  for (const el of controls) {
    const input = el as HTMLInputElement;
    const structural = el.closest('[data-automation-id^="formField-"],[data-field-path],.ashby-application-form-field-entry,li.application-question,fieldset,[role="radiogroup"]');
    let box: Element = structural || el;
    if (!structural) {
      while (box.parentElement && !box.parentElement.matches('body,form')) {
        const parent: Element = box.parentElement;
        const peers = controls.filter(other => parent.contains(other));
        if (peers.some(other => other !== el && !(input.name && (other as HTMLInputElement).name === input.name && ['radio', 'checkbox'].includes(input.type)))) break;
        box = parent;
      }
    }
    const root = el.getRootNode() as Document | ShadowRoot;
    let elLinked = '';
    const elAttr = el.getAttribute('aria-labelledby');
    if (elAttr) {
      const parts = elAttr.split(/\s+/);
      const texts: string[] = [];
      for (const id of parts) {
        if (!id) continue;
        const n = (root as Document).getElementById ? (root as Document).getElementById(id) : root.querySelector(`[id="${id.replace(/"/g, '\\\"')}"]`);
        const txt = n?.textContent?.trim();
        if (txt) texts.push(txt);
      }
      elLinked = texts.join(' ').trim();
    }
    let boxLinked = '';
    const boxAttr = box.getAttribute('aria-labelledby');
    if (boxAttr) {
      const parts = boxAttr.split(/\s+/);
      const texts: string[] = [];
      for (const id of parts) {
        if (!id) continue;
        const n = (root as Document).getElementById ? (root as Document).getElementById(id) : root.querySelector(`[id="${id.replace(/"/g, '\\\"')}"]`);
        const txt = n?.textContent?.trim();
        if (txt) texts.push(txt);
      }
      boxLinked = texts.join(' ').trim();
    }
    const linked = elLinked || boxLinked;
    const isRadioOrCheckbox = ['radio', 'checkbox'].includes(input.type) || el.getAttribute('role') === 'radio';
    const groupPrompt = isRadioOrCheckbox
      ? el.closest('.application-question')?.querySelector('.text, .application-label, legend')?.textContent?.trim() ||
        el.closest('fieldset')?.querySelector('legend')?.textContent?.trim() ||
        el.closest('[data-automation-id^="formField-"]')?.querySelector('label[data-automation-id*="formLabel"], legend')?.textContent?.trim() ||
        el.closest('.ashby-application-form-field-entry, [class*="_fieldEntry_"]')?.querySelector('.ashby-application-form-question-title, label')?.textContent?.trim() ||
        ''
      : '';
    const explicitTitle = box.querySelector('legend,.ashby-application-form-question-title,[data-automation-id$="-legend"],.application-label,.field-label')?.textContent?.trim();
    const labels = isRadioOrCheckbox ? '' : Array.from((el as HTMLInputElement).labels || []).map(label => label.textContent || '').join(' ').trim();
    const clone = box.cloneNode(true) as Element;
    clone.querySelectorAll('select, option, textarea, input, button, [role="listbox"], [role="option"], .error, [role="alert"], [class*="placeholder"], script, style').forEach(node => node.remove());
    if (isRadioOrCheckbox) {
      clone.querySelectorAll('label').forEach(label => label.remove());
    }
    let candidateText = clone.textContent?.replace(/\s+/g, ' ').trim() || '';
    if (/^(?:select|choose)\b|\.{3}/i.test(candidateText)) candidateText = '';
    let question = groupPrompt || linked || explicitTitle || labels || candidateText;
    if (!question || question === 'Field' || /^cards\[[0-9a-f-]+\]\[[^\]]+\]$/i.test(question)) {
      if (el.id) {
        const explicitFor = (root as Document).querySelector?.(`label[for="${CSS.escape(el.id)}"]`);
        if (explicitFor?.textContent?.trim()) question = explicitFor.textContent.trim();
      }
      if (!question || question === 'Field') {
        const wrapperLabel = el.closest('.select-shell, .input-wrapper, .field, [class*="field"], .application-question')?.querySelector('label');
        if (wrapperLabel?.textContent?.trim() && !wrapperLabel.querySelector('input[type="radio"], input[type="checkbox"]')) {
          question = wrapperLabel.textContent.trim();
        }
      }
      if (!question || question === 'Field') {
        const parentLabel = el.closest('.application-question,.custom-question,[class*="application-question"]')?.querySelector('.application-label,.field-label,.text,legend')?.textContent?.trim();
        const fallback = parentLabel || labels || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.id || 'Field';
        question = fallback.replace(/\s+/g, ' ').trim();
      }
    }
    const cleanQ = question.replace(/\s+/g, ' ').trim();
    if (/^(?:from|to|start\s*date|end\s*date|start\s*year|end\s*year|start\s*month|end\s*month|month|year|date|location|city|description|role\s*description)\s*\*?$/i.test(cleanQ)) {
      if (el.closest('[data-automation-id="educationSection"], [class*="education" i], [id*="education" i]')) {
        question = `${cleanQ} (Education)`;
      } else if (el.closest('[data-automation-id="workExperienceSection"], [class*="experience" i], [id*="experience" i], [class*="employment" i]')) {
        question = `${cleanQ} (Work Experience)`;
      }
    }

    // GEN-438: Use Ashby schema title when DOM label is empty or ambiguous
    const ashbySchemaTitle = el.getAttribute('data-ashby-schema-title') ||
      el.closest('[data-field-path], .ashby-application-form-field-entry')?.getAttribute('data-ashby-schema-title');
    if (ashbySchemaTitle && (!question || question === 'Field' || question.length < 3)) {
      question = ashbySchemaTitle;
    }

    // GEN-440: SmartRecruiters shadow-host label unwrapper — climb up to 3 shadow host levels
    if (!question || question === 'Field' || question.length < 3) {
      const elRoot = el.getRootNode();
      if (elRoot instanceof ShadowRoot) {
        let host: Element | null = elRoot.host;
        for (let level = 0; level < 3 && host; level++) {
          const hostLabel =
            host.getAttribute('label') ||
            host.getAttribute('aria-label') ||
            host.querySelector('oc-field-label, label, .label')?.textContent?.trim();
          if (hostLabel && hostLabel.length > 2) {
            question = hostLabel;
            break;
          }
          const parentRoot = host.getRootNode();
          host = parentRoot instanceof ShadowRoot ? parentRoot.host : null;
        }
      }
    }

    // Ticket GEN-323, GEN-324, GEN-325: Cluster Sub-Control Disambiguation
    const siblingsInBox = controls.filter(other => box.contains(other));
    if (siblingsInBox.length > 1) {
      const boxText = (box.textContent || '').replace(/\s+/g, ' ').trim();

      // 1. Composite Phone Splitter (GEN-323)
      const isPhoneCluster = /\b(?:phone|mobile|telephone|contact\s*number)\b/i.test(cleanQ) || /\b(?:phone|mobile|telephone|contact\s*number)\b/i.test(boxText);
      if (isPhoneCluster) {
        const hasDialSelect = siblingsInBox.some(s => s.tagName === 'SELECT' || s.getAttribute('role') === 'combobox' || /country[-_]?code|dial[-_]?code|calling[-_]?code|isd|prefix/i.test([s.id, (s as HTMLInputElement).name, s.getAttribute('aria-label') || ''].join(' ')));
        const hasPhoneInput = siblingsInBox.some(s => s.tagName === 'INPUT' && ['tel', 'text', 'number'].includes((s as HTMLInputElement).type) && !/country[-_]?code|dial[-_]?code|calling[-_]?code/i.test([s.id, (s as HTMLInputElement).name].join(' ')));
        if (hasDialSelect && hasPhoneInput) {
          const isDial = el.tagName === 'SELECT' || el.getAttribute('role') === 'combobox' || /country[-_]?code|dial[-_]?code|calling[-_]?code|isd|prefix/i.test([el.id, input.name, el.getAttribute('aria-label') || ''].join(' '));
          if (isDial) {
            question = 'Phone Country Code';
          } else {
            question = 'Mobile Phone Number';
          }
        }
      }

      // 2. Compensation Currency + Amount Pair (GEN-324)
      const isCompCluster = /\b(?:salary|compensation|ctc|pay|remuneration)\b/i.test(cleanQ) || /\b(?:salary|compensation|ctc|pay|remuneration)\b/i.test(boxText);
      if (isCompCluster) {
        const hasCurrencySelect = siblingsInBox.some(s => s.tagName === 'SELECT' || s.getAttribute('role') === 'combobox' || /currency/i.test([s.id, (s as HTMLInputElement).name, s.getAttribute('aria-label') || ''].join(' ')));
        const hasAmountInput = siblingsInBox.some(s => s.tagName === 'INPUT' && ['text', 'number'].includes((s as HTMLInputElement).type) && !/currency/i.test([s.id, (s as HTMLInputElement).name].join(' ')));
        if (hasCurrencySelect && hasAmountInput) {
          const isCurrency = el.tagName === 'SELECT' || el.getAttribute('role') === 'combobox' || /currency/i.test([el.id, input.name, el.getAttribute('aria-label') || ''].join(' '));
          if (isCurrency) {
            question = 'Salary Currency';
          } else {
            question = 'Expected CTC';
          }
        }
      }

      // 3. Split Date Field Grouping (GEN-325)
      const isDateCluster = /\b(?:date|graduation|completion|attendance|start|end|from|to|birth)\b/i.test(cleanQ) || /\b(?:graduation|attendance|start\s*date|end\s*date|date\s*of\s*birth)\b/i.test(boxText);
      if (isDateCluster) {
        const metaStr = [el.id, input.name, el.getAttribute('aria-label') || '', el.getAttribute('placeholder') || ''].join(' ');
        const hasMonthSibling = siblingsInBox.some(s => /month/i.test([s.id, (s as HTMLInputElement).name, s.getAttribute('aria-label') || '', s.getAttribute('placeholder') || ''].join(' ')));
        const hasYearSibling = siblingsInBox.some(s => /year/i.test([s.id, (s as HTMLInputElement).name, s.getAttribute('aria-label') || '', s.getAttribute('placeholder') || ''].join(' ')));
        if (hasMonthSibling || hasYearSibling) {
          const scope = el.closest('[data-automation-id="educationSection"], [class*="education" i], [id*="education" i]')
            ? ' (Education)'
            : el.closest('[data-automation-id="workExperienceSection"], [class*="experience" i], [id*="experience" i], [class*="employment" i]')
            ? ' (Work Experience)'
            : '';
          const isStart = /\b(?:start|from|begin)\b/i.test(cleanQ);
          const isEnd = /\b(?:end|to|graduation|completion)\b/i.test(cleanQ);
          if (/month/i.test(metaStr)) {
            question = (isStart ? 'Start Month' : isEnd ? 'End Month' : 'Month') + scope;
          } else if (/day/i.test(metaStr)) {
            question = (isStart ? 'Start Day' : isEnd ? 'End Day' : 'Day') + scope;
          } else if (/year/i.test(metaStr)) {
            question = (isStart ? 'Start Year' : isEnd ? 'End Year' : 'Year') + scope;
          }
        }
      }
    }

    // GEN-263: aria-describedby format hint appender
    const describedBy = el.getAttribute('aria-describedby');
    if (describedBy) {
      for (const id of describedBy.split(/\s+/).filter(Boolean)) {
        const hintEl = (root as Document).getElementById ? (root as Document).getElementById(id) : root.querySelector(`[id="${id.replace(/"/g, '\\\"')}"]`);
        const hintText = hintEl?.textContent?.replace(/\s+/g, ' ').trim() || '';
        if (
          hintText.length > 0 &&
          hintText.length <= 90 &&
          !/required|invalid|error/i.test(hintText) &&
          /\b(?:lpa|lakhs?|inr|months|days|out\s+of\s+(?:10|4)|scale|yyyy-mm-dd|mm\/dd\/yyyy)\b/i.test(hintText)
        ) {
          if (!question.includes(hintText)) {
            question = `${question} (${hintText})`;
          }
          break;
        }
      }
    }
    el.setAttribute('data-autoapply-question', question.slice(0, 1500));
    el.setAttribute('data-autoapply-target', String(controls.indexOf(el)));
    box.setAttribute('data-autoapply-cluster', String(controls.indexOf(el)));
  }
}

export async function distillFormStep(frame: Frame): Promise<DistilledField[]> {
  // GEN-438: Pre-hydrate Ashby field titles from window.__appData.posting.applicationForm.sections
  await frame.evaluate(() => {
    try {
      const appData = (window as any).__appData;
      const sections: any[] =
        appData?.posting?.applicationForm?.sections ||
        appData?.applicationForm?.sections ||
        [];
      if (!sections.length) return;
      const ashbySchemaMap = new Map<string, { title: string; isRequired: boolean }>();
      for (const sec of sections) {
        for (const entry of sec.fieldEntries || []) {
          const pathKey = entry.field?.path || entry.field?.id || entry.id;
          const title = entry.field?.title || entry.title;
          if (pathKey && title) {
            ashbySchemaMap.set(String(pathKey), { title: String(title).trim(), isRequired: Boolean(entry.isRequired) });
          }
        }
      }
      if (!ashbySchemaMap.size) return;
      // Stamp matched controls with data-ashby-schema-title so annotateQuestionClusters can use it
      const controls = document.querySelectorAll<HTMLElement>(
        'input, select, textarea, [role="combobox"], button[data-autoapply-btngroup-option]'
      );
      for (const el of Array.from(controls)) {
        const keys = [
          el.getAttribute('data-field-path'),
          el.id,
          (el as HTMLInputElement).name,
        ].filter(Boolean) as string[];
        for (const key of keys) {
          const info = ashbySchemaMap.get(key);
          if (info) {
            el.setAttribute('data-ashby-schema-title', info.title);
            if (info.isRequired) el.setAttribute('aria-required', 'true');
            // Also stamp ancestor .ashby-application-form-field-entry
            const entry = el.closest('[data-field-path], .ashby-application-form-field-entry');
            if (entry) {
              entry.setAttribute('data-ashby-schema-title', info.title);
              if (info.isRequired) entry.setAttribute('aria-required', 'true');
            }
            break;
          }
        }
      }
    } catch {}
  }).catch(() => {});
  await frame.evaluate(() => {
    // GEN-124: Discover Ashby / modern React <button type="button">Yes</button><button type="button">No</button> toggle groups
    const allTypeButtons = Array.from(
      document.querySelectorAll('button[type="button"], [role="button"]')
    ) as HTMLElement[];
    const visitedBtnParents = new Set<HTMLElement>();
    for (const btn of allTypeButtons) {
      const txt = (btn.textContent || '').trim();
      if (!/^(yes|no)$/i.test(txt)) continue;
      const parent = btn.parentElement;
      if (!parent || visitedBtnParents.has(parent)) continue;
      const siblingBtns = Array.from(
        parent.querySelectorAll(':scope > button[type="button"], :scope > [role="button"]')
      ) as HTMLElement[];
      if (siblingBtns.length >= 2 && siblingBtns.length <= 4) {
        const labels = siblingBtns.map((b) => (b.textContent || '').trim());
        const hasYesAndNo =
          labels.some((l) => /^yes$/i.test(l)) && labels.some((l) => /^no$/i.test(l));
        if (hasYesAndNo) {
          visitedBtnParents.add(parent);
          // Mark sibling buttons with data-autoapply-btngroup-option so distiller & widgets treat them as radio options
          siblingBtns.forEach((b) => b.setAttribute('data-autoapply-btngroup-option', (b.textContent || '').trim()));
          parent.setAttribute('role', parent.getAttribute('role') || 'radiogroup');
        }
      }
    }

    // GEN-124: Filter out Ashby's duplicate "Autofill from resume" dropzone when a real "Resume" file input exists
    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
    if (fileInputs.length >= 2) {
      const hasAutofill = fileInputs.some((el) => {
        const text = (el.closest('fieldset, .ashby-application-form-field-entry, label, div')?.textContent || '').toLowerCase();
        return /autofill\s+from\s+resume/i.test(text);
      });
      const hasDirectResume = fileInputs.some((el) => {
        const text = (el.closest('fieldset, .ashby-application-form-field-entry, label, div')?.textContent || '').toLowerCase();
        return /^(?:resume|cv|resume\s*\/?\s*cv)\b/i.test(text) && !/autofill/i.test(text);
      });
      if (hasAutofill && hasDirectResume) {
        fileInputs.forEach((el) => {
          const text = (el.closest('fieldset, .ashby-application-form-field-entry, label, div')?.textContent || '').toLowerCase();
          if (/autofill\s+from\s+resume/i.test(text)) {
            el.setAttribute('data-autoapply-skip-file', 'true');
          }
        });
      }
    }
  }).catch(() => {});

  const controls = frame.locator('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([data-autoapply-skip-file="true"]),select,textarea,[role=combobox],[role=slider],button[aria-haspopup=listbox],button.ashby-application-form-input-yesno-option,button[data-autoapply-btngroup-option],[contenteditable="true"],.ql-editor[contenteditable="true"]');
  await controls.evaluateAll(annotateQuestionClusters);
  const fields = await controls.evaluateAll(elements => {
    const splitDates = new Set<Element>();
    const radioGroups = new Set<string>();
    const ashbyGroups = new Set<Element>();
    return elements.filter(el => {
      const meta = [
        el.id,
        el.getAttribute('name'),
        el.getAttribute('class'),
        el.getAttribute('data-automation-id'),
        el.getAttribute('autocomplete'),
      ].filter(Boolean).join(' ');
      if (/beecatcher|honey-?pot|bot[-_]?trap|website_url_confirm|fax_number|b_name/i.test(meta)) return false;
      if (el.getAttribute('data-autoapply-skip-file') === 'true') return false;
      const input = el as HTMLInputElement;
      if (input.disabled === true || el.getAttribute('aria-disabled') === 'true' || el.closest('fieldset[disabled]')) return false;
      const isButtonToggle = el.hasAttribute('data-autoapply-btngroup-option');
      const isChoice = el.getAttribute('role') === 'combobox' || el.getAttribute('role') === 'listbox' || el.getAttribute('data-uxi-widget-type') === 'selectinput' || !!el.getAttribute('aria-haspopup') || !!el.getAttribute('aria-controls') || !!el.getAttribute('aria-owns') || el.classList.contains('ashby-application-form-input-yesno-option') || isButtonToggle;
      if (input.readOnly && !isChoice) return false;
      if (input.tabIndex === -1 && !isChoice && (input.type === 'text' || input.type === 'email' || input.type === 'url')) return false;
      if (input.type !== 'file' && (!el.getClientRects().length || el.closest('[hidden],[aria-hidden=true]'))) return false;
      const rect = el.getBoundingClientRect();
      if (rect.right < -1000 || rect.bottom < -1000 || rect.left < -5000) return false;
      const radio = el as HTMLInputElement;
      if (radio.type === 'radio' && radio.name) {
        const key = `${elements.findIndex(peer => peer.getRootNode() === el.getRootNode() && (peer as HTMLInputElement).form === radio.form)}:${radio.name}`;
        if (radioGroups.has(key)) return false;
        radioGroups.add(key);
      }
      const ashbyBox = el.closest('.ashby-application-form-input-yesno, [role="radiogroup"]') || (isButtonToggle ? el.parentElement : null);
      if (ashbyBox && (el.classList.contains('ashby-application-form-input-yesno-option') || isButtonToggle)) {
        if (ashbyGroups.has(ashbyBox)) return false;
        ashbyGroups.add(ashbyBox);
      }
      const date = el.closest('[data-automation-id^="formField-"]');
      if (date?.querySelector('[data-automation-id="dateSectionMonth-input"]')) {
        if (splitDates.has(date)) return false;
        splitDates.add(date);
      }
      return true;
    }).map(el => {
      const input = el as HTMLInputElement;
      const isAshbyBtn = el.classList.contains('ashby-application-form-input-yesno-option') || el.hasAttribute('data-autoapply-btngroup-option');
      const isGreenhouseSelect = el.classList.contains('select__input') ||
        el.getAttribute('role') === 'combobox' ||
        !!el.closest('.select-shell, .select__control')?.querySelector('button[aria-label="Toggle flyout"]') ||
        !!el.parentElement?.querySelector('button[aria-label="Toggle flyout"]');
      const isRichText = (el as HTMLElement).isContentEditable || el.getAttribute('contenteditable') === 'true' || el.classList.contains('ql-editor');

      const widgetKind: WidgetKind = isAshbyBtn
        ? 'BOOLEAN_TOGGLE'
        : input.type === 'file'
        ? 'FILE_UPLOAD'
        : el.tagName === 'TEXTAREA' || isRichText
        ? 'TEXTAREA'
        : el.closest('[data-automation-id^="formField-"]')?.querySelector('[data-automation-id="dateSectionMonth-input"]')
        ? 'DATE_SPLIT'
        : ['radio', 'checkbox'].includes(input.type)
        ? 'BOOLEAN_TOGGLE'
        : el.tagName === 'SELECT' || el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox' || el.getAttribute('data-uxi-widget-type') === 'selectinput' || isGreenhouseSelect
        ? ((el as HTMLSelectElement).multiple ? 'MULTI_SELECT' : 'SINGLE_SELECT')
        : input.type === 'number' || input.type === 'range' || el.getAttribute('role') === 'slider'
        ? 'NUMBER'
        : input.type === 'date'
        ? 'DATE_NATIVE'
        : 'TEXT';
      const root = el.getRootNode() as Document | ShadowRoot;
      const choices = input.type === 'radio' ? elements.filter(peer => (peer as HTMLInputElement).type === 'radio' && (peer === el || input.name && (peer as HTMLInputElement).name === input.name && peer.getRootNode() === root && (peer as HTMLInputElement).form === input.form)) : [];
      const box = el.closest('[data-autoapply-cluster]') || el.parentElement;
      const options = isAshbyBtn
        ? (box?.querySelectorAll('button[data-autoapply-btngroup-option]').length
            ? Array.from(box.querySelectorAll('button[data-autoapply-btngroup-option]')).map(b => (b.textContent || '').trim())
            : ['Yes', 'No'])
        : el.tagName === 'SELECT'
        ? Array.from((el as HTMLSelectElement).options).map(option => option.textContent || '')
        : choices.map(peer => Array.from((peer as HTMLInputElement).labels || []).map(label => label.textContent || '').join(' ') || (peer as HTMLInputElement).value);

      // Ticket GEN-322: Combobox pattern - inspect aria-controls / aria-owns for pre-rendered options
      if (options.length === 0 && (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox')) {
        const listboxId = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
        if (listboxId) {
          const listboxEl = (root as Document).getElementById ? (root as Document).getElementById(listboxId) : root.querySelector(`[id="${listboxId.replace(/"/g, '\\\"')}"]`);
          if (listboxEl) {
            const preOpts = Array.from(listboxEl.querySelectorAll('[role="option"], li')).map(o => (o.textContent || '').trim()).filter(Boolean);
            if (preOpts.length > 0) options.push(...preOpts);
          }
        }
      }
      const target = el.getAttribute('data-autoapply-target');
      let question = el.getAttribute('data-autoapply-question') || el.getAttribute('aria-label') || Array.from(input.labels || []).map(label => label.textContent).join(' ') || input.name || el.id || 'Field';
      const cleanQ = question.replace(/\s+/g, ' ').trim();
      if (/^(?:from|to|start\s*date|end\s*date|start\s*year|end\s*year|start\s*month|end\s*month|month|year|date|location|city|description|role\s*description)\s*\*?$/i.test(cleanQ)) {
        if (el.closest('[data-automation-id="educationSection"], [class*="education" i], [id*="education" i]')) {
          question = `${cleanQ} (Education)`;
        } else if (el.closest('[data-automation-id="workExperienceSection"], [class*="experience" i], [id*="experience" i], [class*="employment" i]')) {
          question = `${cleanQ} (Work Experience)`;
        }
      }
      return {
        refKey: [el.id, input.name, target, question].join('|'),
        questionText: question.trim(),
        widgetKind,
        isRequired: isAshbyBtn
          ? true
          : (input.required ||
             el.getAttribute('aria-required') === 'true' ||
             /\*\s*$|\brequired\b/i.test(question.trim()) ||
             Boolean(el.closest('.field, [class*="_fieldEntry_"], .application-question, fieldset')?.querySelector('.required, .asterisk, [aria-required="true"]'))),
        sectionHeading: el.closest('fieldset')?.querySelector('legend')?.textContent || '',
        isFilled: (() => {
          if (isAshbyBtn) {
            return !!box?.querySelector('.ashby-application-form-input-yesno button[aria-pressed="true"], .ashby-application-form-input-yesno button[class*="selected"], .ashby-application-form-input-yesno button[class*="active"], button[data-autoapply-btngroup-option][aria-pressed="true"], button[data-autoapply-btngroup-option][data-state="checked"], button[data-autoapply-btngroup-option][class*="selected"], button[data-autoapply-btngroup-option][class*="active"]');
          }
          if (isRichText) {
            return (el.textContent || '').trim().length > 0;
          }
          const singleVal = box?.querySelector('.select__single-value, [data-automation-id="selectedItem"], [class*="singleValue"]');
          if (singleVal && (singleVal.textContent || '').trim().length > 0) return true;
          return choices.length ? choices.some(peer => (peer as HTMLInputElement).checked) : input.type === 'checkbox' ? input.checked : !!input.value;
        })(),
        currentValue: (() => {
          if (isAshbyBtn) {
            return (box?.querySelector('.ashby-application-form-input-yesno button[aria-pressed="true"], .ashby-application-form-input-yesno button[class*="selected"], .ashby-application-form-input-yesno button[class*="active"], button[data-autoapply-btngroup-option][aria-pressed="true"], button[data-autoapply-btngroup-option][data-state="checked"], button[data-autoapply-btngroup-option][class*="selected"], button[data-autoapply-btngroup-option][class*="active"]')?.textContent?.trim() || '');
          }
          if (isRichText) {
            return (el.textContent || '').trim();
          }
          const singleVal = box?.querySelector('.select__single-value, [data-automation-id="selectedItem"], [class*="singleValue"]');
          if (singleVal && (singleVal.textContent || '').trim().length > 0) return (singleVal.textContent || '').trim();
          return input.value || '';
        })(),
        options,
        validationError: root.getElementById(el.getAttribute('aria-errormessage') || '')?.textContent || null,
        controlSelector: `[data-autoapply-target=${JSON.stringify(target)}]`,
        containerSelector: `[data-autoapply-cluster=${JSON.stringify(box?.getAttribute('data-autoapply-cluster'))}]`
      };
    });
  });

  // Ticket GEN-457: Hydrate Greenhouse question labels and options from ?questions=true schema API
  if (frame.url().includes('greenhouse.io')) {
    try {
      const ghSchema = await fetchGreenhouseQuestionSchema(frame.url());
      if (ghSchema.size > 0) {
        for (const f of fields) {
          for (const [key, item] of ghSchema.entries()) {
            const keyClean = key.toLowerCase();
            const matchesKey =
              f.refKey.toLowerCase().includes(keyClean) ||
              (f.controlSelector && f.controlSelector.toLowerCase().includes(keyClean));
            if (matchesKey) {
              const hasGenericLabel =
                !f.questionText || /^(?:field|question_\d+|input_\d+|select_\d+|custom_fields_\d+)$/i.test(f.questionText.trim());
              if (hasGenericLabel && item.label) {
                f.questionText = item.label;
              }
              if (item.required) {
                f.isRequired = true;
              }
              if ((!f.options || f.options.length === 0) && item.options && item.options.length > 0) {
                f.options = [...item.options];
                if (f.widgetKind === 'TEXT') {
                  f.widgetKind = 'SINGLE_SELECT';
                }
              }
              break;
            }
          }
        }
      }
    } catch {}
  }

  return fields.map(field => ({ ...field, refKey: createHash('sha256').update(`${frame.url()}|${field.refKey}`).digest('hex') }));
}
