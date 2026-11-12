import type { Page } from 'patchright';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ServerResponseRecord {
  url: string;
  status: number;
  body: any;
}

export interface HealedServerValidationResult {
  healedCount: number;
  healedFields: string[];
}

/**
 * Coerce values based on server-side rejection message.
 */
export function coerceFieldValueByErrorMessage(currentVal: string, errorMsg: string): string {
  const msg = (errorMsg || '').toLowerCase();

  // 1. Numeric-only expected ("must be a number", "integer", "numeric")
  if (/\b(?:must be a number|integer|numeric|digits only|invalid number|valid number)\b/i.test(msg)) {
    const digitsOnly = currentVal.replace(/lpa|inr|usd|eur|rs\.?|,|\+/gi, '').replace(/\s+/g, '').replace(/\D/g, '');
    if (digitsOnly) {
      // If original was "12 LPA", digitsOnly is "12" -> expand to standard annual INR "1200000" if small
      if (Number(digitsOnly) <= 50 && /lpa|lakh/i.test(currentVal)) {
        return String(Number(digitsOnly) * 100000);
      }
      return digitsOnly;
    }
    return '1200000';
  }

  // 2. URL format required ("valid url", "must be a url", "enter a url")
  if (/\b(?:valid url|must be a url|enter a valid url|url is invalid)\b/i.test(msg)) {
    if (!currentVal || !currentVal.trim() || currentVal.toLowerCase() === 'n/a' || currentVal === 'none') {
      return 'https://shivammahajan.com/projects/';
    }
    if (!/^https?:\/\//i.test(currentVal)) {
      return `https://${currentVal.trim()}`;
    }
    return currentVal;
  }

  // 3. Date format required
  if (/\b(?:date format|valid date|yyyy-mm-dd|mm\/dd\/yyyy)\b/i.test(msg)) {
    if (/yyyy-mm-dd/i.test(msg)) return '2026-08-01';
    if (/mm\/dd\/yyyy/i.test(msg)) return '08/01/2026';
    return '08/2026';
  }

  // 4. Default string fallback: strip illegal symbols
  return currentVal.replace(/[^\w\s@.,\-\/:+]/g, '').trim();
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

    // D. Workday inline banner errors (handled via DOM queries directly)
    if (/workday/i.test(provider) || /myworkday/i.test(resp.url)) {
      const wdHealed = await page.evaluate(() => {
        let count = 0;
        const errBanners = Array.from(document.querySelectorAll('[data-automation-id="errorMessage"]'));
        for (const b of errBanners) {
          const text = (b.textContent || '').toLowerCase();
          const wrapper = b.closest('[data-automation-id^="formField-"], fieldset, .field');
          if (!wrapper) continue;
          const input = wrapper.querySelector('input:not([type="hidden"]), textarea') as HTMLInputElement | HTMLTextAreaElement | null;
          if (input) {
            // Guard against OTP
            if (input.maxLength === 1 || input.id.includes('security') || input.name.includes('security')) continue;
            if (/must be a number|numeric/i.test(text)) {
              input.value = input.value.replace(/\D/g, '') || '1200000';
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              count++;
            }
          }
        }
        return count;
      }).catch(() => 0);
      if (wdHealed > 0) {
        healedFields.push('workday_inline_banner');
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
        var m = (err || '').toLowerCase();
        if (/must be a number|integer|numeric|digits only|invalid number|valid number/i.test(m)) {
          var d = val.replace(/lpa|inr|usd|eur|rs\\.?|,|\\+/gi, '').replace(/\\s+/g, '').replace(/\\D/g, '');
          if (d) {
            if (Number(d) <= 50 && /lpa|lakh/i.test(val)) return String(Number(d) * 100000);
            return d;
          }
          return '1200000';
        }
        if (/valid url|must be a url|enter a valid url|url is invalid/i.test(m)) {
          if (!val || !val.trim() || val.toLowerCase() === 'n/a' || val === 'none') {
            return 'https://shivammahajan.com/projects/';
          }
          if (!/^https?:\\/\\//i.test(val)) return 'https://' + val.trim();
          return val;
        }
        if (/date format|valid date|yyyy-mm-dd|mm\\/dd\\/yyyy/i.test(m)) {
          if (/yyyy-mm-dd/i.test(m)) return '2026-08-01';
          if (/mm\\/dd\\/yyyy/i.test(m)) return '08/01/2026';
          return '08/2026';
        }
        return val.replace(/[^\\w\\s@.,\\-\\/:+]/g, '').trim();
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
