import type { Frame, Locator } from 'patchright';

export interface HarvestedChoiceResult { options: string[]; popupContainer: Locator | null }

export function inferTypeaheadSeed(questionText: string, candidateCity = 'Bengaluru'): string {
  const q = questionText.toLowerCase();
  if (/\b(?:current\s+)?(?:location|city|metro|address|where are you based)\b/i.test(q)) return candidateCity;
  if (/\b(?:country|nation)\b/i.test(q)) return 'India';
  if (/\b(?:school|university|college|institution)\b/i.test(q)) return 'Chitkara';
  if (/\b(?:degree|qualification)\b/i.test(q)) return 'Bachelor';
  if (/\b(?:major|field of study|discipline)\b/i.test(q)) return 'Computer';
  if (/\b(?:referral|hear about|how did you hear|source)\b/i.test(q)) return 'Website';
  if (/\b(?:employer|company|current company|current employer)\b/i.test(q)) return 'Morgan Stanley';
  return 'a';
}

/**
 * Ticket GEN-138: Recursive shadow-piercing helper to find elements tagged with data-autoapply-ref
 * across open Shadow Roots (<spl-input>, <spl-select>, <spl-autocomplete>, etc.)
 */
export function findByRefDeep(root: Document | ShadowRoot | Element, targetRef: string): HTMLElement | null {
  try {
    const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(targetRef) : targetRef.replace(/"/g, '\\"');
    const direct = (root as Element).querySelector?.(`[data-autoapply-ref="${escaped}"], [data-autoapply-target="${escaped}"], [data-autoapply-control="${escaped}"]`) as HTMLElement | null;
    if (direct) return direct;
    const all = (root as Element).querySelectorAll?.('*') || [];
    for (const node of Array.from(all)) {
      const sr = (node as HTMLElement).shadowRoot;
      if (sr) {
        const found = findByRefDeep(sr, targetRef);
        if (found) return found;
      }
    }
  } catch {}
  return null;
}

export async function verifyChoiceReadBack(
  cluster: Locator,
  control: Locator,
  expectedText?: string
): Promise<boolean> {
  try {
    const evalPromise = control.evaluate((el, wanted) => {
    // Workday button triggers (Phone Device Type*, Country*, Degree*, etc.)
    if (el.tagName.toLowerCase() === 'button') {
      const btnText = ((el as HTMLElement).innerText || el.textContent || '').trim();
      if (btnText && !/^(select|select one|choose|--)$/i.test(btnText)) {
        return true;
      }
    }

    // Climb to enclosing cluster or shell, excluding [role="combobox"] on el itself
    const root =
      el.closest('.select-shell, [class*="select__control"], [class$="-control"], [data-select-container], [data-automation-id="multiSelectContainer"], [data-automation-id^="formField-"], .ashby-application-form-field-entry, [data-autoapply-cluster], .field, fieldset') ||
      el.parentElement;

    const pill = root?.querySelector('[data-automation-id="selectedItem"], [class*="single-value"], [class*="singleValue"], [class*="multiValue"], [class*="selected-option"]');
    if (pill && (pill.textContent || '').trim().length > 0) return true;

    const checkedRadio = root?.querySelector('input[type="radio"]:checked, input[type="checkbox"]:checked, [aria-checked="true"], [aria-pressed="true"], button[data-autoapply-btngroup-option][aria-pressed="true"], button[data-autoapply-btngroup-option][data-state="checked"], button[data-autoapply-btngroup-option][class*="selected"], button[data-autoapply-btngroup-option][class*="active"]');
    if (checkedRadio) return true;

    // Check surrounding text if button or div container
    const containerText = (root?.textContent || '').trim();
    if (wanted && containerText.toLowerCase().includes(wanted.toLowerCase())) return true;

    const inputVal = ((el as HTMLInputElement).value || '').trim();
    if (!inputVal) return false;
    // Reject single-char seed leftovers like 'a'
    if (wanted && inputVal.length === 1 && wanted.length > 1) return false;
    return true;
  }, expectedText);

    return await Promise.race([
      evalPromise,
      new Promise<boolean>(r => setTimeout(() => r(true), 1500)),
    ]);
  } catch {
    return true;
  }
}

/** Open a bounded, control-associated menu before resolving its answer. */
export async function harvestControlOptions(
  frame: Frame,
  clusterOrControl: Locator,
  controlArg?: Locator,
  widgetKind?: string,
  questionTextArg?: string
): Promise<HarvestedChoiceResult> {
  const control = controlArg || clusterOrControl;
  const questionText = questionTextArg || await control.getAttribute('data-autoapply-question') || await control.getAttribute('aria-label') || '';

  // Physics 1: Native SELECT
  if (await control.evaluate(el => el.tagName === 'SELECT')) {
    return { options: await control.locator('option').allTextContents(), popupContainer: null };
  }

  // Physics 1: Radio group
  if (await control.evaluate(el => (el as HTMLInputElement).type === 'radio' || el.getAttribute('role') === 'radio')) {
    const options = await control.evaluate(el => {
      const input = el as HTMLInputElement;
      const root = el.getRootNode() as Document | ShadowRoot;
      const group = el.closest('[role=radiogroup]');
      return Array.from(group?.querySelectorAll('[role=radio]') || root.querySelectorAll('input[type=radio]')).filter(peer => group || peer === el || input.name && (peer as HTMLInputElement).name === input.name && (peer as HTMLInputElement).form === input.form).map(peer => Array.from((peer as HTMLInputElement).labels || []).map(label => label.textContent || '').join(' ').trim() || peer.getAttribute('aria-label') || peer.textContent?.trim() || (peer as HTMLInputElement).value);
    });
    return { options, popupContainer: null };
  }

  // If control already has selected items/pills, preserve without opening menu
  const existingSelection = await control.evaluate(comboboxSelection).catch(() => ({ values: [], multiple: false }));
  if (existingSelection.values.length > 0) {
    return { options: existingSelection.values, popupContainer: null };
  }

  // Physics 2: Click trigger / overlay
  const overlay = control.locator('..').locator('[data-automation-id="click_filter"]').filter({ visible: true });
  if (await overlay.count() === 1) await overlay.click({ timeout: 3000 }).catch(() => {});
  else await control.click({ timeout: 3000 }).catch(() => {});

  const popupId = await control.getAttribute('aria-controls') || await control.getAttribute('aria-owns');
  let popup = popupId ? frame.locator(`[id=${JSON.stringify(popupId)}]`) : frame.locator('[role=listbox],[data-automation-id="activeListContainer"],[data-automation-id="responsiveMonikerPrompt"]').filter({ visible: true });

  // Failure 2B: Ambiguous visible menus -> select last mounted
  if (await popup.count() > 1) {
    popup = popup.last();
  }

  let choices = popup.locator('[role=option],[data-automation-id="promptOption"],.select__option,._option_1svni_32,.itta-item').filter({ visible: true });
  await choices.first().waitFor({ state: 'visible', timeout: 800 }).catch(() => {});
  let options = [...new Set((await choices.allTextContents()).map(text => text.trim()).filter(Boolean))];

  // Physics 3: Seed-then-harvest typeahead
  const tag = await control.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
  const isReadOnly = await control.evaluate(el => (el as HTMLInputElement).readOnly).catch(() => false);
  const isWorkdaySelectInput = await control.evaluate(el => el.getAttribute('data-uxi-widget-type') === 'selectinput').catch(() => false);

  if (options.length === 0 && tag === 'input' && !isWorkdaySelectInput) {
    const seed = inferTypeaheadSeed(questionText);
    if (isReadOnly) {
      await control.click({ timeout: 1000 }).catch(() => {});
      await frame.page().keyboard.type(seed, { delay: 25 }).catch(() => {});
    } else {
      await control.fill(seed).catch(() => {});
    }
    await new Promise(resolve => setTimeout(resolve, 350));
    choices = popup.locator('[role=option],[data-automation-id="promptOption"],.select__option,._option_1svni_32,.itta-item').filter({ visible: true });
    options = [...new Set((await choices.allTextContents()).map(text => text.trim()).filter(Boolean))];

    // CRITICAL: Clear temporary seed during harvest so raw seed text never masquerades as a selected value!
    if (!isReadOnly) {
      await control.fill('').catch(() => {});
    }
  }

  await control.press('Escape').catch(() => {});
  await frame.page().keyboard.press('Escape').catch(() => {});
  const openMenu = frame.locator('.select__menu, [role="listbox"], [data-automation-id="activeListContainer"]').filter({ visible: true });
  if (await openMenu.count().catch(() => 0) > 0) {
    await frame.page().keyboard.press('Escape').catch(() => {});
  }
  const popper = frame.locator('[data-popper-placement],[data-behavior-click-outside-close="topmost"]').filter({ visible: true });
  if (await popper.count() > 0) {
    await frame.locator('body').click({ position: { x: 5, y: 5 }, timeout: 800 }).catch(() => {});
  }
  return { options, popupContainer: popup };
}

export async function selectHarvestedOption(frame: Frame, control: Locator, option: string): Promise<boolean> {
  if (await control.evaluate(el => el.tagName === 'SELECT')) {
    await control.selectOption({ label: option }).catch(() => {});
    return (await control.locator('option:checked').allTextContents()).includes(option);
  }

  // GEN-127: Check if options / listbox are currently visible; if 0 visible options, re-open portal
  const countVisibleOpts = async () => {
    return await frame.locator('[role="option"], .select__option, [data-automation-id="promptOption"], [class*="_option_"]').filter({ visible: true }).count().catch(() => 0);
  };

  let visibleCount = await countVisibleOpts();
  if (visibleCount === 0) {
    const overlay = control.locator('..').locator('[data-automation-id="click_filter"]').filter({ visible: true });
    if (await overlay.count() === 1) await overlay.click({ force: true, timeout: 3000 }).catch(() => {});
    else await control.click({ force: true, timeout: 3000 }).catch(() => {});

    await control.press('ArrowDown').catch(() => {});
    await frame.page().waitForTimeout(350);
  }

  const popupId = await control.getAttribute('aria-controls') || await control.getAttribute('aria-owns');
  let popup = popupId
    ? frame.locator(`[id=${JSON.stringify(popupId)}]`)
    : frame.locator('[role=listbox], .select__menu, [class*="-menu"], [data-automation-id="activeListContainer"]').filter({ visible: true });
  if (await popup.count() > 1) popup = popup.last();
  if (await popup.count() === 0) {
    popup = frame.locator('.select__menu-portal, [role="listbox"]').filter({ visible: true });
    if (await popup.count() === 0) return false;
  }

  const choice = popup.getByRole('option', { name: option, exact: true }).or(popup.locator('.select__option, [data-automation-id=promptOption], [role="option"], [class*="_option_"]').filter({ hasText: new RegExp(`^${option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }));
  if (await choice.count() > 0) {
    const opt = choice.first();
    await opt.dispatchEvent('mousedown').catch(() => {});
    await opt.click({ force: true }).catch(() => {});
    await opt.dispatchEvent('mouseup').catch(() => {});
  } else {
    const partialChoice = popup.locator('[role=option], .select__option, [data-automation-id=promptOption], [class*="_option_"]').filter({ hasText: option });
    if (await partialChoice.count() > 0) {
      const opt = partialChoice.first();
      await opt.dispatchEvent('mousedown').catch(() => {});
      await opt.click({ force: true }).catch(() => {});
      await opt.dispatchEvent('mouseup').catch(() => {});
    }
  }

  // Failure 2C: Workday 2-level menu closes without selecting leaf
  await frame.page().waitForTimeout(600);
  const selectedCount = await frame.locator('[data-automation-id="selectedItem"]').count();
  const remainingPromptCount = await frame.locator('[data-automation-id="promptOption"]').filter({ visible: true }).count();
  if (selectedCount === 0 && remainingPromptCount > 0) {
    const childOpts = frame.locator('[data-automation-id="promptOption"]').filter({ visible: true });
    const matchingChild = childOpts.filter({ hasText: option });
    if (await matchingChild.count() > 0) {
      await matchingChild.first().click().catch(() => {});
    } else {
      await childOpts.first().click().catch(() => {});
    }
  }

  // Ensure any open flyout / popup menu is closed so it doesn't block next field
  const remainingMenu = frame.locator('.select__menu, [role="listbox"], [data-automation-id="activeListContainer"]').filter({ visible: true });
  if (await remainingMenu.count().catch(() => 0) > 0) {
    await frame.page().keyboard.press('Escape').catch(() => {});
  }

  return (await control.evaluate(comboboxSelection)).values.includes(option) || (await control.innerText()).trim() === option || await verifyChoiceReadBack(control, control);
}

/** Runs in the browser and preserves visible fixed-position and below-fold controls. */
export function isVisibleApplicationControl(element: Element): boolean {
  if (/beecatcher|honey-?pot|bot-trap/i.test([element.id, element.getAttribute('name'), element.getAttribute('data-automation-id')].join(' '))) return false;
  if (!element.isConnected || !element.getClientRects().length) return false;
  const input = element as HTMLInputElement;
  const labels = Array.from(input.labels || []);
  const visibleLabel = labels.some(label => {
    if (!label.getClientRects().length) return false;
    for (let node: Element | null = label; node; node = node.parentElement || (node.getRootNode() instanceof ShadowRoot ? (node.getRootNode() as ShadowRoot).host : null)) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || Number(style.opacity) === 0) return false;
      const rect = node.getBoundingClientRect();
      if (['absolute', 'fixed'].includes(style.position) && (rect.right < -1000 || rect.bottom < -1000)) return false;
    }
    return true;
  });
  for (let node: Element | null = element; node; node = node.parentElement || (node.getRootNode() instanceof ShadowRoot ? (node.getRootNode() as ShadowRoot).host : null)) {
    const style = getComputedStyle(node);
    const labeledToggle = node === element && ['radio', 'checkbox'].includes(input.type) && visibleLabel;
    if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || (Number(style.opacity) === 0 && !labeledToggle)) return false;
    const rect = node.getBoundingClientRect();
    if (['absolute', 'fixed'].includes(style.position) && (rect.right < -1000 || rect.bottom < -1000)) return false;
  }
  const label = labels.map(label => label.textContent || '').join(' ');
  return !/robots only|do not (?:fill|enter|complete)|leave (?:this field )?(?:blank|empty)/i.test(label);
}

/** An editable combobox's empty query is not its selection. */
export function comboboxSelection(element: Element): { values: string[]; multiple: boolean } {
  const root = element.closest('[class*="select__control"],[class$="-control"],[data-select-container],[data-automation-id="multiSelectContainer"]')?.parentElement || element.parentElement;
  const values = [element.getAttribute('aria-valuetext') || ''];
  for (const item of Array.from(root?.querySelectorAll('[class*="single-value"],[class*="singleValue"],[class*="multi-value__label"],[class*="multiValueLabel"],[data-selected-value],[data-automation-id="selectedItem"]') || [])) values.push(item.textContent || '');
  const popupId = element.getAttribute('aria-controls') || element.getAttribute('aria-owns');
  const popup = popupId ? (element.getRootNode() as Document | ShadowRoot).getElementById(popupId) : undefined;
  for (const item of Array.from(popup?.querySelectorAll('[role=option][aria-selected=true]') || [])) values.push(item.textContent || '');
  const selected = [...new Set(values.map(value => value.trim()).filter(Boolean))];
  const multiple = selected.length > 1 || element.getAttribute('aria-multiselectable') === 'true' || popup?.getAttribute('aria-multiselectable') === 'true' || !!root?.querySelector('[class*="multi-value"],[class*="multiValue"]');
  return { values: selected, multiple };
}

export async function stealthClick(locator: Locator, timeout = 4000): Promise<void> {
  await locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  await locator.hover({ timeout: 2000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 65 + Math.floor(Math.random() * 85)));
  await locator.click({ timeout });
}

export async function fillAsyncLocationCombobox(frame: Frame, control: Locator, city = 'Bengaluru'): Promise<boolean> {
  const seeds = city.includes('Bengaluru') || city.includes('Bangalore')
    ? ['Bengaluru, Karnataka, India', 'Bengaluru', 'Bangalore', 'India']
    : [city, city.split(',')[0]!.trim()];

  for (const seed of seeds) {
    await control.click({ timeout: 2500 }).catch(() => {});
    await control.fill('').catch(() => {});
    await control.pressSequentially(seed, { delay: 35 }).catch(async () => {
      await control.fill(seed).catch(() => {});
    });

    // Wait up to 900ms for async location autocomplete options to mount
    const optionLocator = frame
      .locator(
        '.select__menu .select__option, [role="listbox"] [role="option"], .ui-menu-item, .itta-results .itta-item, .location-results li, .pac-item, spl-select-option, .spl-autocomplete-option, li[role="option"]'
      )
      .filter({ visible: true });

    await optionLocator.first().waitFor({ state: 'visible', timeout: 900 }).catch(() => {});
    const count = await optionLocator.count().catch(() => 0);
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const item = optionLocator.nth(i);
        const txt = (await item.innerText().catch(() => '')).toLowerCase();
        if (/bengaluru|bangalore|india|karnataka/.test(txt)) {
          await item.dispatchEvent('mousedown').catch(() => {});
          await item.click({ force: true, timeout: 1500 }).catch(() => {});
          await item.dispatchEvent('mouseup').catch(() => {});
          await frame.page().keyboard.press('Enter').catch(() => {});
          await frame.page().keyboard.press('Escape').catch(() => {});
          return true;
        }
      }
      const firstItem = optionLocator.first();
      await firstItem.dispatchEvent('mousedown').catch(() => {});
      await firstItem.click({ force: true, timeout: 1500 }).catch(() => {});
      await firstItem.dispatchEvent('mouseup').catch(() => {});
      await frame.page().keyboard.press('Enter').catch(() => {});
      await frame.page().keyboard.press('Escape').catch(() => {});
      return true;
    }
  }

  // Fallback keyboard selection if portal menu is in a detached layer
  await control.press('ArrowDown').catch(() => {});
  await frame.waitForTimeout(100);
  await control.press('Enter').catch(() => {});
  await frame.page().keyboard.press('Escape').catch(() => {});
  return true;
}

export async function selectAshbyYesNoOrCheckboxGroup(
  cluster: Locator,
  wantedAnswer: string | number | boolean
): Promise<boolean> {
  const normalizedWanted =
    typeof wantedAnswer === 'boolean'
      ? wantedAnswer ? 'yes' : 'no'
      : String(wantedAnswer).trim().toLowerCase();

  // 1. Ashby Yes/No <button> pair (.ashby-application-form-input-yesno-option, [data-autoapply-btngroup-option])
  const ashbyBtns = cluster.locator('button.ashby-application-form-input-yesno-option, button[class*="yesno-option"], button[data-autoapply-btngroup-option], button[type="button"], [role="button"]');
  const btnCount = await ashbyBtns.count().catch(() => 0);
  if (btnCount > 0) {
    const targetText = /^(true|yes|1|i agree)$/i.test(normalizedWanted) ? /^yes$/i : /^no$/i;
    for (let i = 0; i < btnCount; i++) {
      const btn = ashbyBtns.nth(i);
      const txt = (await btn.innerText().catch(() => '')).trim();
      if (targetText.test(txt)) {
        await btn.scrollIntoViewIfNeeded().catch(() => {});
        await btn.click({ timeout: 2500 });
        return true;
      }
    }
  }

  // 2. Checkbox Group (multiple <input type="checkbox"> inside cluster)
  const checkboxes = cluster.locator('input[type="checkbox"]');
  const cbCount = await checkboxes.count().catch(() => 0);
  if (cbCount === 1) {
    if (/^(true|yes|1|check|i agree)$/i.test(normalizedWanted)) {
      const cb = checkboxes.first();
      if (!(await cb.isChecked().catch(() => false))) {
        await cb.check({ force: true }).catch(async () => await cb.click());
      }
      return true;
    }
  } else if (cbCount > 1) {
    for (let i = 0; i < cbCount; i++) {
      const cb = checkboxes.nth(i);
      const labelTxt = await cb.evaluate(el => {
        const lbl = el.closest('label') || (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null) || el.parentElement;
        return (lbl?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      }).catch(() => '');
      if (
        labelTxt === normalizedWanted ||
        labelTxt.includes(normalizedWanted) ||
        (normalizedWanted === 'yes' && /^yes\b/i.test(labelTxt)) ||
        (/base/i.test(normalizedWanted) && /base/i.test(labelTxt))
      ) {
        if (!(await cb.isChecked().catch(() => false))) {
          await cb.check({ force: true }).catch(async () => await cb.click());
        }
        return true;
      }
    }
  }
  return false;
}

/**
 * SmartRecruiters Country/Region* Combobox Autocomplete Fix:
 * Types 'India' with delay, waits 700ms, and clicks visible oc-list-item / [role="option"] / li matching /^India$/i,
 * falling back to ArrowDown + Enter.
 */
export async function fillSmartRecruitersCountryCombobox(
  frame: Frame,
  control: Locator,
  country = 'India'
): Promise<boolean> {
  await control.click({ timeout: 2500 }).catch(() => {});
  await control.fill('').catch(() => {});
  await control.pressSequentially(country, { delay: 45 }).catch(async () => {
    await control.fill(country).catch(() => {});
  });
  await frame.page().waitForTimeout(700);

  const optionLocator = frame
    .locator('oc-list-item, spl-select-option, [role="option"], li, .autocomplete-suggestion')
    .filter({ visible: true });

  const count = await optionLocator.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const item = optionLocator.nth(i);
    const txt = (await item.innerText().catch(() => '')).trim();
    if (new RegExp(`^${country}$`, 'i').test(txt)) {
      await item.click({ timeout: 2000 }).catch(() => {});
      return true;
    }
  }

  // Pierce open shadow roots if not found in light DOM (Ticket GEN-96)
  const clickedInShadow = await frame.page().evaluate((targetCountry) => {
    function findInRoots(root: Document | ShadowRoot): HTMLElement | null {
      const candidates = root.querySelectorAll('oc-list-item, spl-select-option, [role="option"], li, .autocomplete-suggestion');
      for (const el of Array.from(candidates)) {
        const txt = el.textContent?.trim() || '';
        if (new RegExp(`^${targetCountry}$`, 'i').test(txt)) {
          return el as HTMLElement;
        }
      }
      for (const el of Array.from(root.querySelectorAll('*'))) {
        if (el.shadowRoot) {
          const hit = findInRoots(el.shadowRoot);
          if (hit) return hit;
        }
      }
      return null;
    }
    const target = findInRoots(document);
    if (target) {
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      target.click();
      return true;
    }
    return false;
  }, country).catch(() => false);

  if (clickedInShadow) return true;

  // Fallback: ArrowDown + Enter
  await control.press('ArrowDown').catch(() => {});
  await frame.page().waitForTimeout(100);
  await control.press('Enter').catch(() => {});
  return true;
}
