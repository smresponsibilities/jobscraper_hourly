import type { Page, Frame } from 'patchright';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { extractWorkdayTenantKey, recordWorkdayTenantQuirk } from './workday-tenant-registry.js';

export interface ServerResponseRecord {
  url: string;
  status: number;
  body: any;
}

export interface HealedServerValidationResult {
  healedCount: number;
  healedFields: string[];
}

export async function auditEmptyRequiredFieldsInDom(pageOrFrame: Page | Frame, throwOnError = false): Promise<Array<{
  selector: string; tagName: string; inputType: string; label: string;
}>> {
  return pageOrFrame.evaluate(() => {
    const result: Array<{ selector: string; tagName: string; inputType: string; label: string }> = [];
    let visited = 0;
    const walk = (root: Document | ShadowRoot, depth: number) => {
      for (const el of Array.from(root.querySelectorAll('*'))) {
        if (++visited > 10000) return;
        const shadow = (el as HTMLElement).shadowRoot;
        if (shadow && depth < 5) walk(shadow, depth + 1);
        if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) continue;
        if (!(el.required || el.getAttribute('aria-required') === 'true') || el.disabled || !el.getClientRects().length) continue;
        // react-select's unnamed `…-requiredInput` only carries HTML validation;
        // the visible control is the combobox, which this audit does not own.
        if (el instanceof HTMLInputElement && /\brequiredInput\b/.test(el.className || '') && !el.name && !el.id) continue;
        if (el instanceof HTMLInputElement && (el.type === 'hidden' || el.maxLength === 1 || el.autocomplete === 'one-time-code' || /^security-input-/i.test(el.id))) continue;
        if (el instanceof HTMLInputElement && el.type === 'radio' && el.name) {
          const group = root.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`);
          if (Array.from(group).some(radio => (radio as HTMLInputElement).checked)) continue;
        } else if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
          if (el.checked) continue;
        } else if (el instanceof HTMLInputElement && el.type === 'file') {
          if (el.files?.length) continue;
        } else if (el.value.trim()) continue;
        const select = el.closest('.select__control, [class*="select__control"], [class*="select-container"], [class*="selectContainer"]');
        if (select?.querySelector('.select__single-value, .select__multi-value, [class*="singleValue"], [class*="multiValue"]')) continue;
        const parts: string[] = [];
        let current: Element | null = el;
        while (current) {
          const parent: Element | null = current.parentElement;
          const index = parent ? Array.from(parent.children).indexOf(current) + 1 : 1;
          parts.unshift(`${current.tagName.toLowerCase()}:nth-child(${index})`);
          current = parent;
        }
        const label = Array.from(el.labels || []).map(item => item.textContent?.trim() || '').filter(Boolean).join(' ') ||
          (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => root.querySelector(`#${CSS.escape(id)}`)?.textContent?.trim() || '').filter(Boolean).join(' ') ||
          el.getAttribute('aria-label') || el.getAttribute('name') || '';
        result.push({ selector: el.id ? `#${CSS.escape(el.id)}` : parts.join(' > '), tagName: el.tagName.toLowerCase(), inputType: el instanceof HTMLInputElement ? el.type : '', label });
      }
    };
    walk(document, 0);
    return result;
  }).catch(error => {
    if (throwOnError) throw error;
    return [];
  });
}

/**
 * Coerce values based on server-side rejection message.
 */
export function coerceFieldValueByErrorMessage(currentVal: string, errorMsg: string): string {
  const value = currentVal.trim();
  if (/must be a number|integer|numeric|digits only|invalid number|valid number/i.test(errorMsg)) {
    if (/^\d{1,3}(?:,\d{3})+$/.test(value)) return value.replace(/,/g, '');
    if (/^\d+$/.test(value)) return value;
  }
  if (/valid url|must be a url|enter a valid url|url is invalid/i.test(errorMsg) && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/:?#][^\s]*)?$/i.test(value)) {
    return `https://${value}`;
  }
  return currentVal;
}

/**
 * Ticket GEN-536: Unified Server-Side HTTP 400/422 & GraphQL formErrors Surgical Auto-Healer.
 * Parses Ashby GraphQL, Greenhouse 422, SmartRecruiters 400/422, and Workday error responses,
 * locates DOM elements, and applies surgical format coercions.
 */
export async function parseAndHealServerValidationErrors(
  page: Page,
  provider: string,
  rawResponses: ServerResponseRecord[]
): Promise<HealedServerValidationResult> {
  const healedFields: string[] = [];
  const logEntries: any[] = [];

  for (const resp of rawResponses) {
    if (!resp || !resp.body) continue;
    const body = resp.body;
    const status = resp.status;

    // A. Ashby GraphQL (op=submitApplicationFormAction / submitMultipleFormsAction)
    // Structure: data.*.formErrors[] with { fieldEntryId, message }
    // fieldEntryId format: formId_fieldUuid
    if (/ashby/i.test(provider) || /ashbyhq\.com/i.test(resp.url) || body.data) {
      const formErrors =
        body?.data?.submitApplicationFormAction?.formErrors ||
        body?.data?.submitMultipleFormsAction?.formErrors ||
        body?.errors ||
        [];

      for (const err of formErrors) {
        const rawFieldEntryId = err.fieldEntryId || err.fieldId || err.path?.[0] || '';
        const message = err.message || JSON.stringify(err);
        const fieldUuid = rawFieldEntryId.includes('_') ? rawFieldEntryId.split('_').slice(1).join('_') : rawFieldEntryId;

        if (fieldUuid) {
          const success = await applyHealToDomElement(page, fieldUuid, message);
          if (success) {
            healedFields.push(fieldUuid);
          } else {
            logEntries.push({ provider: 'ashby', fieldUuid, message, status });
          }
        }
      }
    }

    // B. Greenhouse JSON / 422
    // Structure: { errors: [{ field, message }] }
    if (/greenhouse/i.test(provider) || /greenhouse\.io/i.test(resp.url) || status === 422) {
      const ghErrors = body?.errors || (Array.isArray(body) ? body : []);
      if (Array.isArray(ghErrors)) {
        for (const err of ghErrors) {
          const field = typeof err === 'string' ? err : err.field || err.name || '';
          const message = typeof err === 'string' ? err : err.message || '';
          if (field) {
            const success = await applyHealToDomElement(page, field, message);
            if (success) {
              healedFields.push(field);
            } else {
              logEntries.push({ provider: 'greenhouse', field, message, status });
            }
          }
        }
      }
    }

    // C. SmartRecruiters 400 / 422
    // Structure: { errors: [{ fieldId, code, message }] }
    if (/smartrecruiters/i.test(provider) || /smartrecruiters\.com/i.test(resp.url)) {
      const srErrors = body?.errors || [];
      if (Array.isArray(srErrors)) {
        for (const err of srErrors) {
          const fieldId = err.fieldId || err.field || '';
          const message = err.message || err.code || '';
          if (fieldId) {
            const success = await applyHealToDomElement(page, fieldId, message);
            if (success) {
              healedFields.push(fieldId);
            } else {
              logEntries.push({ provider: 'smartrecruiters', fieldId, message, status });
            }
          }
        }
      }
    }


  }

  if (extractWorkdayTenantKey(page.url()) && rawResponses.some(response => /workday/i.test(provider) || /myworkdayjobs\.com/i.test(response.url))) {
    const marker = `notice-${randomUUID()}`;
    const attempted = await page.evaluate(token => {
      let index = 0;
      for (const banner of document.querySelectorAll('[data-automation-id="errorMessage"]')) {
        if (!/must be a number|numeric|digits only|valid number/i.test(banner.textContent || '')) continue;
        const wrapper = banner.closest('[data-automation-id^="formField-"], fieldset, .field');
        const input = wrapper?.querySelector('input:not([type="hidden"]),textarea') as HTMLInputElement | HTMLTextAreaElement | null;
        if (!input || !/notice/i.test(`${wrapper?.textContent || ''} ${input.name} ${input.id}`) || !/^(?:immediate(?:ly)?\s*\(\s*0\s*days?\s*\)|0\s*days?)$/i.test(input.value.trim())) continue;
        const setter = Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(input, '0'); else input.value = '0';
        input.setAttribute('data-autoapply-notice-heal', `${token}-${index++}`);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return index;
    }, marker).catch(() => 0);
    if (attempted) {
      await page.waitForTimeout(250);
      const verified = await page.evaluate(token => {
        let count = 0;
        for (const input of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-autoapply-notice-heal]')) {
          if (!input.getAttribute('data-autoapply-notice-heal')?.startsWith(`${token}-`)) continue;
          input.removeAttribute('data-autoapply-notice-heal');
          const wrapper = input.closest('[data-automation-id^="formField-"], fieldset, .field');
          if (input.value === '0' && input.getAttribute('aria-invalid') !== 'true' && !wrapper?.querySelector('[data-automation-id="errorMessage"]')) count++;
        }
        return count;
      }, marker).catch(() => 0);
      if (verified) {
        healedFields.push('workday_numeric_notice');
        try { recordWorkdayTenantQuirk(page.url(), { requiresNumericNoticeDays: true }); } catch { /* A busy registry does not justify an unverified retry. */ }
      }
    }
  }

  // If any fields could not be mapped, record to portal-review-log.json
  if (logEntries.length > 0) {
    try {
      const logPath = path.resolve('state/autoapply/portal-review-log.json');
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      let existing: any[] = [];
      if (fs.existsSync(logPath)) {
        try {
          existing = JSON.parse(fs.readFileSync(logPath, 'utf8'));
        } catch {}
      }
      existing.push({ timestamp: new Date().toISOString(), entries: logEntries });
      fs.writeFileSync(logPath, JSON.stringify(existing.slice(-200), null, 2), 'utf8');
    } catch {}
  }

  return {
    healedCount: healedFields.length,
    healedFields,
  };
}

/**
 * Locates the target DOM control by field identifier and applies coerced value.
 */
async function applyHealToDomElement(page: Page, fieldIdOrUuid: string, errorMsg: string): Promise<boolean> {
  try {
    const rawFn = `(function(args) {
      var targetId = args.fieldIdOrUuid;
      var msg = args.errorMsg;

      function isOtp(el) {
        if (!el) return false;
        if (el.maxLength === 1) return true;
        var id = (el.id || '').toLowerCase();
        var name = (el.name || '').toLowerCase();
        if (id.includes('security') || name.includes('security') || name.includes('otp')) return true;
        if (el.closest && el.closest('[id*="security"], [class*="security"]')) return true;
        return false;
      }

      function coerce(val, err) {
        var value = val.trim();
        if (/must be a number|integer|numeric|digits only|invalid number|valid number/i.test(err)) {
          if (/^\\d{1,3}(?:,\\d{3})+$/.test(value)) return value.replace(/,/g, '');
          if (/^\\d+$/.test(value)) return value;
        }
        if (/valid url|must be a url|enter a valid url|url is invalid/i.test(err) && /^[a-z0-9-]+(?:\\.[a-z0-9-]+)+(?:[/:?#][^\\s]*)?$/i.test(value)) return 'https://' + value;
        return val;
      }

      // Try selectors
      var selectors = [
        '[name*="' + targetId + '"]',
        '[id*="' + targetId + '"]',
        '[data-field-id*="' + targetId + '"]',
        '[data-automation-id*="' + targetId + '"]'
      ];

      var control = null;
      for (var s of selectors) {
        try {
          var el = document.querySelector(s);
          if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
            control = el;
            break;
          }
        } catch (e) {}
      }

      if (!control) return false;
      if (isOtp(control)) return false;

      var current = control.value || '';
      var coerced = coerce(current, msg);
      if (coerced === current) return false;

      var prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) {
        setter.call(control, coerced);
      } else {
        control.value = coerced;
      }

      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
      control.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    })({ fieldIdOrUuid: ${JSON.stringify(fieldIdOrUuid)}, errorMsg: ${JSON.stringify(errorMsg)} })`;

    const success = await page.evaluate(rawFn);
    return Boolean(success);
  } catch {
    return false;
  }
}
