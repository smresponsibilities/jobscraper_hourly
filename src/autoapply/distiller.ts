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

export function extractCleanQuestionText(box: Element, els: Element[] = []): string {
  const root = box.getRootNode() as Document | ShadowRoot;
  const findById = (id: string): Element | null => {
    if (!id) return null;
    if (typeof (root as Document).getElementById === 'function') return (root as Document).getElementById(id);
    try { return root.querySelector(`[id="${id.replace(/"/g, '\\\"')}"]`); } catch { return null; }
  };
  const first = els[0] || (box.matches('input,select,textarea,[role="combobox"]') ? box : box.querySelector('input,select,textarea,[role="combobox"]'));
  const isRadioOrCheckbox = first instanceof HTMLInputElement && (first.type === 'radio' || first.type === 'checkbox');

  // GEN-129: Group question prompts on Lever, Greenhouse, Workday, Ashby (prevent option labels like "0-1 years" from poisoning question prompt)
  if (isRadioOrCheckbox && first) {
    const leverQuestion = first.closest('.application-question')?.querySelector('.text, .application-label, label')?.textContent?.trim();
    if (isCleanQuestionCandidate(leverQuestion)) return leverQuestion!.replace(/\s+/g, ' ').trim().slice(0, 1500);

    const legend = first.closest('fieldset')?.querySelector('legend')?.textContent?.trim();
    if (isCleanQuestionCandidate(legend)) return legend!.replace(/\s+/g, ' ').trim().slice(0, 1500);

    const wdLabel = first.closest('[data-automation-id^="formField-"]')?.querySelector('label[data-automation-id*="formLabel"], legend')?.textContent?.trim();
    if (isCleanQuestionCandidate(wdLabel)) return wdLabel!.replace(/\s+/g, ' ').trim().slice(0, 1500);

    const ashbyLabel = first.closest('.ashby-application-form-field-entry, [class*="_fieldEntry_"]')?.querySelector('.ashby-application-form-question-title, label')?.textContent?.trim();
    if (isCleanQuestionCandidate(ashbyLabel)) return ashbyLabel!.replace(/\s+/g, ' ').trim().slice(0, 1500);

    const rg = first.closest('[role="radiogroup"], [role="group"]');
    if (rg) {
      const rgAria = (rg.getAttribute('aria-label') || '').trim();
      if (isCleanQuestionCandidate(rgAria)) return rgAria.slice(0, 1500);
      const rgLinked = (rg.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => findById(id)?.textContent || '').join(' ').trim();
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
    const wrapperLabel = first?.closest('.select-shell, .input-wrapper, .field, [class*="field"], .application-question')?.querySelector('label');
    if (isCleanQuestionCandidate(wrapperLabel?.textContent) && !wrapperLabel!.querySelector('input[type="radio"], input[type="checkbox"]')) {
      return wrapperLabel!.textContent!.replace(/\s+/g, ' ').trim().slice(0, 1500);
    }
  }

  // 3. Linked aria-labelledby
  const elLinked = first && typeof first.getAttribute === 'function' ? (first.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => findById(id)?.textContent || '').join(' ').trim() : '';
  const boxLinked = typeof box.getAttribute === 'function' ? (box.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => findById(id)?.textContent || '').join(' ').trim() : '';
  const linked = elLinked || boxLinked;
  if (isCleanQuestionCandidate(linked)) return linked.replace(/\s+/g, ' ').trim().slice(0, 1500);

  // 4. Explicit legends / Ashby titles / single question labels
  const explicitTitle = box.querySelector(
    'legend, .ashby-application-form-question-title, [data-automation-id$="-legend"], label[data-automation-id*="formLabel"], .field-label, .application-label'
  )?.textContent?.trim();
  if (isCleanQuestionCandidate(explicitTitle)) return explicitTitle!.replace(/\s+/g, ' ').trim().slice(0, 1500);

  // 5. Single label in box that doesn't wrap radio/checkbox
  const singleLabels = Array.from(box.querySelectorAll('label')).filter(l => !l.querySelector('input[type="radio"], input[type="checkbox"]'));
  if (singleLabels.length === 1 && isCleanQuestionCandidate(singleLabels[0]?.textContent)) {
    return singleLabels[0]!.textContent!.replace(/\s+/g, ' ').trim().slice(0, 1500);
  }

  const labels = first ? Array.from((first as HTMLInputElement).labels || []).map(label => label.textContent || '').join(' ').trim() : '';
  if (isCleanQuestionCandidate(labels)) return labels.replace(/\s+/g, ' ').trim().slice(0, 1500);

  // 6. Ancestor Climbing (up to 5 levels) with Shadow Root boundary crossing
  let currentParent: HTMLElement | null = getParentOrShadowHost(first || box);
  for (let depth = 0; depth < 5 && currentParent && !currentParent.matches('body, form'); depth++) {
    // Check custom Web Component host attributes (<spl-input label="First name *">, <oc-form-field label="City">)
    const hostLabel = currentParent.getAttribute('label') || currentParent.getAttribute('data-label') || currentParent.getAttribute('aria-label');
    if (isCleanQuestionCandidate(hostLabel)) {
      return hostLabel!.replace(/\s+/g, ' ').trim().slice(0, 1500);
    }

    const legend = currentParent.querySelector('legend, .ashby-application-form-question-title, [data-automation-id$="-legend"], label[data-automation-id*="formLabel"], .field-label, .application-label');
    if (isCleanQuestionCandidate(legend?.textContent)) {
      return legend!.textContent!.replace(/\s+/g, ' ').trim().slice(0, 1500);
    }
    const pClone = currentParent.cloneNode(true) as Element;
    pClone.querySelectorAll('select, option, textarea, input, button, [role="listbox"], [role="option"], .error, [role="alert"], [class*="placeholder"], script, style').forEach(n => n.remove());
    pClone.querySelectorAll('label').forEach(l => {
      if (!isCleanQuestionCandidate(l.textContent)) l.remove();
    });
    const pText = pClone.textContent?.replace(/\s+/g, ' ').trim() || '';
    if (isCleanQuestionCandidate(pText)) {
      return pText.slice(0, 1500);
    }
    currentParent = getParentOrShadowHost(currentParent);
  }

  // 7. Box clone text
  const clone = box.cloneNode(true) as Element;
  clone.querySelectorAll('select, option, textarea, input, button, [role="listbox"], [role="option"], .error, [role="alert"], [class*="placeholder"], script, style').forEach(node => node.remove());
  if (els.length > 1 && els.some(e => (e as HTMLInputElement).type === 'radio' || e.getAttribute('role') === 'radio')) {
    clone.querySelectorAll('label').forEach(label => label.remove());
  }
  const text = clone.textContent?.replace(/\s+/g, ' ').trim() || '';
  if (isCleanQuestionCandidate(text) && !/^(?:select|choose)\b|\.{3}/i.test(text)) return text.slice(0, 1500);

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

export function collectControls(elements: Element[]): Element[] {
  return elements.filter(el => {
    if (/beecatcher|honey-?pot|bot-trap/i.test([el.id, el.getAttribute('name'), el.getAttribute('data-automation-id')].join(' '))) return false;
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
  const controls = elements.filter(el => {
    if (/beecatcher|honey-?pot|bot-trap/i.test([el.id, el.getAttribute('name'), el.getAttribute('data-automation-id')].join(' '))) return false;
    // Ticket GEN-93.3: Exclude elements inside navigation, header, footer, cookies
    if (el.closest('header, nav, footer, [role="navigation"], [role="banner"], [role="contentinfo"], [id*="cookie" i], [class*="cookie" i]')) {
      return false;
    }
    const input = el as HTMLInputElement;
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
    const elLinked = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => root.getElementById(id)?.textContent || '').join(' ').trim();
    const boxLinked = (box.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => root.getElementById(id)?.textContent || '').join(' ').trim();
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
    el.setAttribute('data-autoapply-question', question.slice(0, 1500));
    el.setAttribute('data-autoapply-target', String(controls.indexOf(el)));
    box.setAttribute('data-autoapply-cluster', String(controls.indexOf(el)));
  }
}

export async function distillFormStep(frame: Frame): Promise<DistilledField[]> {
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

  const controls = frame.locator('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([data-autoapply-skip-file="true"]),select,textarea,[role=combobox],button[aria-haspopup=listbox],button.ashby-application-form-input-yesno-option,button[data-autoapply-btngroup-option]');
  await controls.evaluateAll(annotateQuestionClusters);
  const fields = await controls.evaluateAll(elements => {
    const splitDates = new Set<Element>();
    const radioGroups = new Set<string>();
    const ashbyGroups = new Set<Element>();
    return elements.filter(el => {
      if (/beecatcher|honey-?pot|bot-trap/i.test([el.id, el.getAttribute('name'), el.getAttribute('data-automation-id')].join(' '))) return false;
      if (el.getAttribute('data-autoapply-skip-file') === 'true') return false;
      const input = el as HTMLInputElement;
      const isButtonToggle = el.hasAttribute('data-autoapply-btngroup-option');
      const isChoice = el.getAttribute('role') === 'combobox' || el.getAttribute('role') === 'listbox' || el.getAttribute('data-uxi-widget-type') === 'selectinput' || !!el.getAttribute('aria-haspopup') || !!el.getAttribute('aria-controls') || !!el.getAttribute('aria-owns') || el.classList.contains('ashby-application-form-input-yesno-option') || isButtonToggle;
      if (input.readOnly && !isChoice) return false;
      if (input.type !== 'file' && (!el.getClientRects().length || el.closest('[hidden],[aria-hidden=true]'))) return false;
      const rect = el.getBoundingClientRect();
      if (rect.right < -1000 || rect.bottom < -1000) return false;
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

      const widgetKind: WidgetKind = isAshbyBtn
        ? 'BOOLEAN_TOGGLE'
        : input.type === 'file'
        ? 'FILE_UPLOAD'
        : el.tagName === 'TEXTAREA'
        ? 'TEXTAREA'
        : el.closest('[data-automation-id^="formField-"]')?.querySelector('[data-automation-id="dateSectionMonth-input"]')
        ? 'DATE_SPLIT'
        : ['radio', 'checkbox'].includes(input.type)
        ? 'BOOLEAN_TOGGLE'
        : el.tagName === 'SELECT' || el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox' || el.getAttribute('data-uxi-widget-type') === 'selectinput' || isGreenhouseSelect
        ? ((el as HTMLSelectElement).multiple ? 'MULTI_SELECT' : 'SINGLE_SELECT')
        : input.type === 'number'
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
      const target = el.getAttribute('data-autoapply-target');
      const question = el.getAttribute('data-autoapply-question') || el.getAttribute('aria-label') || Array.from(input.labels || []).map(label => label.textContent).join(' ') || input.name || el.id || 'Field';
      return {
        refKey: [el.id, input.name, target, question].join('|'),
        questionText: question.trim(),
        widgetKind,
        isRequired: isAshbyBtn ? true : (input.required || el.getAttribute('aria-required') === 'true'),
        sectionHeading: el.closest('fieldset')?.querySelector('legend')?.textContent || '',
        isFilled: (() => {
          if (isAshbyBtn) {
            return !!box?.querySelector('.ashby-application-form-input-yesno button[aria-pressed="true"], .ashby-application-form-input-yesno button[class*="selected"], .ashby-application-form-input-yesno button[class*="active"], button[data-autoapply-btngroup-option][aria-pressed="true"], button[data-autoapply-btngroup-option][data-state="checked"], button[data-autoapply-btngroup-option][class*="selected"], button[data-autoapply-btngroup-option][class*="active"]');
          }
          const singleVal = box?.querySelector('.select__single-value, [data-automation-id="selectedItem"], [class*="singleValue"]');
          if (singleVal && (singleVal.textContent || '').trim().length > 0) return true;
          return choices.length ? choices.some(peer => (peer as HTMLInputElement).checked) : input.type === 'checkbox' ? input.checked : !!input.value;
        })(),
        currentValue: (() => {
          if (isAshbyBtn) {
            return (box?.querySelector('.ashby-application-form-input-yesno button[aria-pressed="true"], .ashby-application-form-input-yesno button[class*="selected"], .ashby-application-form-input-yesno button[class*="active"], button[data-autoapply-btngroup-option][aria-pressed="true"], button[data-autoapply-btngroup-option][data-state="checked"], button[data-autoapply-btngroup-option][class*="selected"], button[data-autoapply-btngroup-option][class*="active"]')?.textContent?.trim() || '');
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
  return fields.map(field => ({ ...field, refKey: createHash('sha256').update(`${frame.url()}|${field.refKey}`).digest('hex') }));
}
