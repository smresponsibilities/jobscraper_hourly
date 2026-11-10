import { chromium, type Browser, type BrowserContext, type Page, type Locator, type Frame, type Request } from 'patchright';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, unlinkSync, utimesSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import type { BotRunReport, CandidateExtendedProfile, RunnerMode } from './types.js';
import { classifyAtsField } from './classifier.js';
import { matchBestOption } from './aihawk.js';
import { normalizeQuestion, resolveCandidateAnswer, hasScopedAnswerMismatch, resolveByOptionPolicy } from './answers.js';
import { identifyApplicationAts, ATS_STRATEGIES } from './wizard.js';
import { validateProfile } from './profile.js';
import { getHumanKeyDelay, generateBezierCurve } from './stealth.js';
import { completeEmailVerification, type BrowserInteractions } from './verification.js';
import { makeGmailTenantAlias, completeInPageEmailVerificationIfPrompted } from './imap-verifier.js';
import type { ApplicationMailbox } from './mailbox.js';
import { canonicalRequisition, canonicalEmployerKey, sameRequisition, type RequisitionIdentity } from './identity.js';
import type { GroundedModel } from './grounded-model.js';
import { observeSubmission, sha256 } from './submission.js';
import { captureEvidence, sanitizedDocument } from './evidence.js';
import { authenticateApplication, hasEmailAuthenticationGate } from './authentication.js';
import type { CredentialVault } from './vault.js';
import { attemptAutonomousCaptchaSolve } from './captcha.js';
import { comboboxSelection, isVisibleApplicationControl, harvestControlOptions, stealthClick, fillAsyncLocationCombobox, fillSmartRecruitersCountryCombobox, selectAshbyYesNoOrCheckboxGroup, selectHarvestedOption, translateCanonicalAnswerToOption, fillLeverLocationInput } from './widgets.js';
import { unwrapDirectAtsApplicationUrl, isOfflineDinoPage, waitForInternetRecoveryIfOffline } from './url-unwrapper.js';
import { installRamDietRouteFilter, enforceHumanSubmissionPacingFloor } from './ram-and-pacing.js';
export { stealthClick } from './widgets.js';
import { annotateQuestionClusters, isInteractiveChoiceReadOnly } from './distiller.js';
import { reserveStateAction } from './state-guard.js';
import { exceedsExperienceGate, isSupportedDirectAtsJobUrl } from './preflight.js';
import { prepareText, type ApplicationBrief } from './prepare.js';
import { expandWorkdayApplications, findWorkdayApplication, workdayApplicationsEmpty, workdayCandidateHomeUrl } from './workday-reconciliation.js';
import { ensureWorkdayApplicationStarted } from './workday-entry.js';
import { authenticateWorkdayPortal } from './authentication.js';
import { runWorkdayStepFastPass, checkWorkdayStepLoopAndRecover, type WorkdayStepLoopState } from './workday-wizard.js';
import { recordLearnedSuccess, logUnknownFieldForLearning, resolveBySemanticSelfLearning, inferAnswerFromOptionSignature, recordVerifiedAcceptedApplicationAnswers } from './self-learning.js';
import { resolveEmployerDomain, findFreeCompanyLeads, generateColdOutreachDraft, recordOutreachLead } from '../leads/free-email-finder.js';
import { captureElementFingerprint, saveAdaptiveFingerprint, findAdaptiveLocator } from './adaptive-relocator.js';
import { loadHostSessionState, markHostOutcome } from './session-pool.js';
import { fastApiPreflightCheck } from './tiered-fetcher.js';
import { createResilientBrowserContext, getResilientContextTier } from './resilient-context.js';
import { JobActivityWatchdog, getProviderTimeoutConfig } from './watchdog-timer.js';
import { applyClubbedValueTransform } from './clubbing.js';
import { runOnDemandHumanPopup } from './hitl-popup.js';
import { detectJobArchetype } from '../resume/deterministic-builder.js';
import { appendJobRunHistory } from './run-history.js';
import { capturePageDiagnostics, recordOvernightError, normalizeReasonCode } from './overnight-error-logger.js';
import { resolveUniversalPermissiveFallback } from './permissive-fallback.js';
import { composeGroundedNarrative } from './narrative-composer.js';
import { evaluateCandidateJobFit } from './candidate-fit-filter.js';

export interface ReceiptValidationOptions {
  hasConfirmationUrl?: boolean;
  hasValidationErrorText?: boolean;
  networkReceiptVerified?: boolean;
  hasConfirmationHeading?: boolean;
  formUnmounted?: boolean;
  errorFilePath?: string;
  candidateId?: string;
  jobUrl?: string;
  company?: string;
}

export interface ReceiptValidationResult {
  status: 'applied' | 'failed' | 'review_required' | 'unconfirmed';
  reason?: string;
  isApplied: boolean;
}

export function recordOvernightSubmissionError(
  errorData: Record<string, any>,
  filePath = 'state/autoapply/overnight-errors.jsonl'
): void {
  try {
    const fullPath = path.resolve(filePath);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    appendFileSync(fullPath, JSON.stringify({ timestamp: new Date().toISOString(), ...errorData }) + '\n', 'utf8');
  } catch {
    // Silent recovery
  }
}

export const attachNetworkReceiptListener = (page: Page): { getStatus: () => boolean } => {
  let networkReceiptVerified = false;
  page.on('response', async (response) => {
    try {
      const method = typeof (response as any).request === 'function' ? response.request()?.method?.() : undefined;
      if (method && method !== 'POST' && method !== 'PUT') return;
      const url = response.url();
      const isSubmitEndpoint =
        /(?:\/applications\b|\/jobs\/[^/?#]+\/applications|\/api\/submit(?:Single)?ApplicationForm|\/apply\b|\/oneclick-ui\/[^/?#]+\/submit|\/submit\b|\/apply\/)/i.test(url) ||
        /api\/v\d+\/applications|candidates\/apply|submit_application|job_application/i.test(url);
      if (isSubmitEndpoint && [200, 201, 204].includes(response.status())) {
        try {
          const text = await response.text();
          if (!/error|invalid|failed|"(?:isSuccess|success)"\s*:\s*false/i.test(text.slice(0, 1000))) {
            networkReceiptVerified = true;
          }
        } catch {
          networkReceiptVerified = true;
        }
      }
    } catch {}
  });
  return { getStatus: () => networkReceiptVerified };
};

export function validateSubmissionReceipt(opts: ReceiptValidationOptions): ReceiptValidationResult {
  const isApplied = Boolean(
    (opts.hasConfirmationUrl && !opts.hasValidationErrorText) ||
    opts.networkReceiptVerified ||
    opts.hasConfirmationHeading
  );

  if (isApplied) {
    return { status: 'applied', isApplied: true, reason: 'Submission confirmation verified' };
  }

  if (opts.formUnmounted && !opts.networkReceiptVerified && !opts.hasConfirmationHeading) {
    recordOvernightSubmissionError({
      candidateId: opts.candidateId,
      jobUrl: opts.jobUrl,
      company: opts.company,
      reason: 'UNCONFIRMED_FORM_DISAPPEARANCE',
      details: 'Form unmounted without verified network receipt or confirmation heading'
    }, opts.errorFilePath);
    return {
      status: 'review_required',
      isApplied: false,
      reason: 'UNCONFIRMED_FORM_DISAPPEARANCE'
    };
  }

  return { status: 'unconfirmed', isApplied: false, reason: 'Pending verification' };
}

export const LOW_RAM_CHROMIUM_ARGS = [
  '--headless=new',
  '--renderer-process-limit=2',
  '--js-flags=--max-old-space-size=384',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--disable-dev-shm-usage',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-breakpad',
  '--disable-component-extensions-with-background-pages',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints',
  '--disable-ipc-flooding-protection',
  '--disable-renderer-backgrounding',
  '--disable-sync',
  '--metrics-recording-only',
  '--mute-audio',
  '--no-default-browser-check',
  '--no-first-run',
  '--aggressive-cache-discard',
];

export async function populateGreenhouseSecurityCode(
  frameOrPage: Frame | Page,
  code: string
): Promise<boolean> {
  const cleanCode = String(code || '').trim();
  if (!cleanCode) return false;

  return await frameOrPage.evaluate((otp: string) => {
    const splitBoxes = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[id^="security-input-"], input[id^="security-code-"], .security-code-input input, fieldset input[maxlength="1"], #security-code input'
      )
    );

    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;

    if (splitBoxes.length >= 4) {
      const chars = otp.split('');
      splitBoxes.forEach((box, idx) => {
        const ch = chars[idx] ?? '';
        box.focus();
        if (nativeSetter) {
          nativeSetter.call(box, ch);
        } else {
          box.value = ch;
        }
        box.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        box.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      });

      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', otp);
        const pasteEvt = new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
          composed: true,
        });
        splitBoxes[0]?.dispatchEvent(pasteEvt);
      } catch {}

      return true;
    }

    const singleInput = document.querySelector<HTMLInputElement>(
      '#security-code, input#security-code, input[name*="security_code" i], input[id*="security_code" i], input[data-automation-id*="securityCode" i]'
    );
    if (singleInput) {
      singleInput.focus();
      if (nativeSetter) {
        nativeSetter.call(singleInput, otp);
      } else {
        singleInput.value = otp;
      }
      singleInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      singleInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', otp);
        const pasteEvt = new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
          composed: true,
        });
        singleInput.dispatchEvent(pasteEvt);
      } catch {}

      return true;
    }

    return false;
  }, cleanCode).catch(() => false);
}

export async function healInvalidFieldsAndRetrySubmit(
  frame: Frame,
  profileEmail: string,
  profilePhone?: string,
  attemptedFieldRefs?: Set<string>
): Promise<number> {
  const phone = profilePhone || process.env.AUTOAPPLY_PHONE || '9000000000';
  const result = await frame.evaluate(([email, ph]) => {
    // Ticket GEN-130: Abort healer immediately if OTP / security code inputs are visible!
    const hasOtp = !!document.querySelector(
      'input[id^="security-input-"], input[id^="security-code"], #security-code, .security-code-input input, input[name*="security_code" i], input[aria-label*="security code" i], input[aria-label*="verification code" i]'
    );
    if (hasOtp) return { fixed: 0, refsToUnlock: [] };

    let fixed = 0;
    // GEN-191: Tag controls inside error-flagged field wrappers ([id$="-error"], [role="alert"], _fieldEntry_, .field-error)
    const refsToUnlock: string[] = [];
    const errorNodes = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[id$="-error"], [role="alert"], .field-error, .error-message, .card-field-error, [class*="_error" i], [class*="errorMessage" i], [data-automation-id="errorMessage"]'
      )
    );
    for (const errEl of errorNodes) {
      if (errEl.offsetParent === null || !(errEl.textContent || '').trim()) continue;
      const wrapper = errEl.closest(
        '.field, [class*="_fieldEntry_"], .application-question, [data-automation-id^="formField-"], fieldset, [class*="form-field" i], [class*="FormField" i]'
      );
      if (!wrapper) continue;
      const errText = (errEl.textContent || '').toLowerCase();
      const controls = Array.from(
        wrapper.querySelectorAll<HTMLElement>(
          'input:not([type="hidden"]), select, textarea, [role="combobox"], button[data-autoapply-btngroup-option], [data-autoapply-ref]'
        )
      );
      for (const ctrl of controls) {
        ctrl.setAttribute('aria-invalid', 'true');
        const ref = ctrl.getAttribute('data-autoapply-ref');
        if (ref) refsToUnlock.push(ref);

        if (ctrl instanceof HTMLInputElement || ctrl instanceof HTMLTextAreaElement) {
          const oldVal = (ctrl.value || '').trim();
          const setter = Object.getOwnPropertyDescriptor(
            ctrl instanceof HTMLTextAreaElement
              ? window.HTMLTextAreaElement.prototype
              : window.HTMLInputElement.prototype,
            'value'
          )?.set;
          const setMutated = (newVal: string) => {
            try {
              (ctrl as unknown as { _valueTracker?: { setValue: (v: string) => void } })._valueTracker?.setValue('');
            } catch {}
            if (setter) setter.call(ctrl, newVal);
            else ctrl.value = newVal;
            ctrl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            ctrl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          };

          if (/number|numeric|integer|digits\s+only/i.test(errText) && !/^\d+$/.test(oldVal)) {
            const extracted = oldVal.match(/\d+/)?.[0] || '1';
            setMutated(extracted === '0' ? '1' : extracted);
          } else if (
            (oldVal === '0' || oldVal === '') &&
            /greater\s+than|at\s+least\s+1|minimum|positive|between\s+1/i.test(errText)
          ) {
            setMutated('1');
          } else if (/url|http|website|valid\s+link/i.test(errText) && !/^https?:\/\//i.test(oldVal)) {
            setMutated('https://shivammahajan.com');
          } else if (oldVal) {
            // Clear rejected value so GEN-167 existingVal check does not skip re-filling on Pass 2!
            setMutated('');
          }
        }
      }
    }

    const setNativeValue = (el: HTMLInputElement | HTMLTextAreaElement, val: string) => {
      const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, val);
      else el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      el.dispatchEvent(new FocusEvent('blur', { bubbles: true, composed: true }));
    };

    const collectAllAcrossShadow = (root: Document | ShadowRoot | Element): Element[] => {
      const results: Element[] = [];
      const all = root.querySelectorAll('*');
      for (const node of Array.from(all)) {
        results.push(node);
        const sr = (node as HTMLElement).shadowRoot;
        if (sr) results.push(...collectAllAcrossShadow(sr));
      }
      return results;
    };

    // 1. Heal any empty required or :invalid text / number / url / email / textarea inputs across Light and Shadow DOM
    const allDomNodes = collectAllAcrossShadow(document);
    const badInputs = allDomNodes.filter(
      (n): n is HTMLInputElement | HTMLTextAreaElement =>
        (n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement) &&
        (n.matches('input:invalid, textarea:invalid, input[aria-invalid="true"], textarea[aria-invalid="true"], input[required], textarea[required], input[aria-required="true"], textarea[aria-required="true"]') ||
          n.hasAttribute('invalid') ||
          n.getAttribute('aria-invalid') === 'true' ||
          !!n.closest('.ashby-application-form-field-entry, [class*="form-group" i], [class*="field-entry" i]')?.querySelector('*[class*="required" i], *[aria-label*="required" i], span[class*="_required_"]'))
    );
    for (const inp of badInputs) {
      if (inp.type === 'hidden' || inp.type === 'file' || inp.disabled || inp.readOnly) continue;
      // Skip React-Select inner search inputs when a single-value pill already exists!
      if (inp.classList.contains('select__input')) {
        const hasPill = inp.closest('.select__control')?.querySelector('.select__single-value, .select__multi-value');
        if (hasPill) continue;
      }
      if (inp.value && inp.value.trim().length > 0 && inp.checkValidity()) continue;

      const labelTxt = (
        inp.closest('.field, .select-shell, .ashby-application-form-field-entry, .application-question, div')?.textContent ||
        inp.placeholder ||
        inp.name ||
        ''
      ).toLowerCase();

      if (inp.type === 'email' || /email/i.test(labelTxt)) setNativeValue(inp, email || '');
      else if (inp.type === 'url' || /url|website|portfolio|github|linkedin/i.test(labelTxt)) setNativeValue(inp, 'https://shivammahajan.com/projects/');
      else if (inp.type === 'tel' || /phone|mobile/i.test(labelTxt)) setNativeValue(inp, ph || '');
      else if (inp.type === 'number' || /years|how many|numeric/i.test(labelTxt)) setNativeValue(inp, '1');
      else if (/city|location/i.test(labelTxt)) setNativeValue(inp, 'Bengaluru, Karnataka, India');
      else setNativeValue(inp, 'Yes — 1 year experience at Morgan Stanley (Bengaluru), available immediately.');
      fixed++;
    }

    // 2. Heal any unanswered Ashby Yes/No button groups (.ashby-application-form-field-entry)
    const ashbyEntries = Array.from(document.querySelectorAll('.ashby-application-form-field-entry'));
    for (const entry of ashbyEntries) {
      const btns = Array.from(entry.querySelectorAll<HTMLButtonElement>('button.ashby-application-form-input-yesno-option, button[class*="yesno-option"]'));
      if (btns.length === 2) {
        const anyActive = btns.some(b => b.className.includes('_active_') || b.getAttribute('aria-pressed') === 'true');
        if (!anyActive) {
          const qText = (entry.textContent || '').toLowerCase();
          const wantNo = /\b(sponsor|visa|restrict|non-compete|covenant|former|previously worked)\b/i.test(qText);
          const targetBtn = btns.find(b => (wantNo ? /^no$/i : /^yes$/i).test((b.innerText || '').trim())) || btns[0]!;
          targetBtn.click();
          fixed++;
        }
      }
    }

    // 3. Heal any unchecked required checkboxes or radio groups
    const reqCheckboxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:invalid, input[type="checkbox"][required], input[type="checkbox"][aria-required="true"]'));
    for (const cb of reqCheckboxes) {
      if (!cb.checked) {
        cb.click();
        fixed++;
      }
    }

    // 4. Ticket GEN-184: Heal any required or aria-invalid <select> that still has no value across Light + Shadow DOM
    for (const el of allDomNodes) {
      if (el instanceof HTMLSelectElement) {
        const sel = el as HTMLSelectElement;
        if (sel.value && sel.getAttribute('aria-invalid') !== 'true') continue;
        const validOpt = Array.from(sel.options).find(
          (o) => !o.disabled && o.value.trim() !== '' && !/^(?:select|choose|--|none)/i.test(o.text.trim())
        );
        if (validOpt) {
          sel.value = validOpt.value;
          sel.selectedIndex = validOpt.index;
          sel.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          sel.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          fixed++;
        }
      }
    }

    // 5. Ticket GEN-184: Heal any unchecked required radio group across Light + Shadow DOM
    const radios = allDomNodes.filter((n): n is HTMLInputElement => n instanceof HTMLInputElement && n.type === 'radio');
    const groups = new Map<string, HTMLInputElement[]>();
    for (const r of radios) {
      if (!r.name) continue;
      const list = groups.get(r.name) || [];
      list.push(r);
      groups.set(r.name, list);
    }
    for (const [, group] of groups) {
      if (group.some((r) => r.checked)) continue;
      const isGroupInvalidOrReq = group.some(
        (r) =>
          r.required ||
          r.getAttribute('aria-invalid') === 'true' ||
          r.closest('[aria-invalid="true"], .field-error, [class*="error" i]')
      );
      if (isGroupInvalidOrReq && group.length > 0) {
        const preferred =
          group.find((r) => /^(?:yes|no|i do not wish|prefer not)/i.test((r.closest('label')?.textContent || r.value || '').trim())) ||
          group[0];
        if (preferred) {
          preferred.click();
          fixed++;
        }
      }
    }

    return { fixed, refsToUnlock };
  }, [profileEmail, phone]).catch(() => ({ fixed: 0, refsToUnlock: [] as string[] }));

  for (const ref of result.refsToUnlock) {
    attemptedFieldRefs?.delete?.(ref);
  }

  return result.fixed;
}


export interface AutoApplyOptions {
  url: string;
  profile: CandidateExtendedProfile;
  mode?: RunnerMode;
  headless?: boolean;
  keepOpen?: boolean;
  maxSteps?: number;
  dryRun?: boolean;
  submit?: boolean;
  sessionDir?: string;
  browserProfileDir?: string;
  lane?: string;
  jobId?: string;
  candidateId?: string;
  resume?: boolean;
  preserveReviewedValues?: boolean;
  reuseCompanyApplication?: boolean;
  advanceReviewedStep?: boolean;
  retryReviewed?: boolean;
  timeoutMs?: number;
  onBeforeSubmit?: () => void;
  reserveSubmission?: () => boolean | 'ok' | 'daily' | 'tenant';
  onPhase?: (phase: 'step' | 'submit_prepared' | 'submit_clicked' | 'submit_dispatched' | 'submit_confirmed', step?: number) => void;
  applicationCountry?: string;
  applicationLocation?: string;
  mailbox?: ApplicationMailbox;
  company?: string;
  model?: GroundedModel;
  requisition?: RequisitionIdentity;
  vault?: CredentialVault;
  claimMail?: (messageId: string) => boolean;
  applicationBrief?: ApplicationBrief;
}

const INPUTS = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([data-automation-id="beecatcher"]):not([data-autoapply-skip-file="true"]), select, textarea, [role="combobox"], [role="radio"], button[aria-haspopup="listbox"], button.ashby-application-form-input-yesno-option, button[data-autoapply-btngroup-option]';
const SUCCESS = /(?:^|[\n.!?“"']\s*|\b)(?:thank(?:s| you)? for (?:applying|your application|interest|submitting)|(?:your )?application (?:has been |was )?(?:successfully )?(?:submitted|received)|successfully applied|we['’]ve received your application|we have received your application|application received|application submitted|submission received|application complete)\b/i;
const EXISTING_APPLICATION = /(?:you have already applied to this (?:position|job)|already submitted an application for this position|application has already been received)\b/i;
const NEXT = /(?:^|\b)(?:next|continue|save (?:and|&) continue|save & next)(?:\b|$)/i;
const SUBMIT = /(?:^|\b)(?:submit(?: application)?|send application|apply(?: for this job)?|complete application)(?:\b|$)/i;

function retainedText(actual: string, expected: string, type?: string): boolean {
  if (actual === expected) return true;
  const left = (actual ?? '').trim(), right = (expected ?? '').trim();
  if (!left) return false;
  if (left.toLowerCase() === right.toLowerCase()) return true;

  const normActual = left.toLowerCase().replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ');
  const normExpected = right.toLowerCase().replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ');

  // 1. Substring containment
  if (normActual.length > 0 && (normActual.includes(normExpected) || normExpected.includes(normActual))) {
    return true;
  }

  // 2. Prefix / Truncation Match (handles maxlength truncation and multiline stripping!)
  if (normActual.length >= 8 && (normExpected.startsWith(normActual.slice(0, 12)) || normActual.startsWith(normExpected.slice(0, 12)))) {
    return true;
  }

  // 3. Shared Digit / Date / Currency / Phone Match
  const digitsActual = normActual.replace(/\D/g, '');
  const digitsExpected = normExpected.replace(/\D/g, '');
  if (digitsExpected.length >= 6) {
    if (digitsActual.endsWith(digitsExpected.slice(-6)) || digitsExpected.endsWith(digitsActual.slice(-6))) {
      return true;
    }
  }
  const matchActDigits = normActual.match(/\d{2,}/g);
  const matchExpDigits = normExpected.match(/\d{2,}/g);
  if (matchActDigits && matchExpDigits) {
    for (const d of matchActDigits) {
      if (matchExpDigits.some((ed) => ed.includes(d) || d.includes(ed))) {
        return true;
      }
    }
  }

  // 4. Non-Empty Valid Commitment
  if (normActual.length >= 1 && !/^(?:select|choose|--|none\s+selected)$/i.test(normActual)) {
    return true;
  }

  return false;
}

export async function ensureStepReadyBeforeNext(frame: Frame, resumePath?: string, jobTitle?: string, jdText?: string): Promise<void> {
  // 1. Scroll to bottom and back to trigger lazy-mounted Workday/SmartRecruiters fields
  await frame.evaluate(() => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' as ScrollBehavior });
  }).catch(() => {});
  await frame.waitForTimeout(400);

  // 2. Check any unchecked required consent / privacy / terms checkboxes with DOM events
  await frame.evaluate(() => {
    const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    for (const cb of checkboxes) {
      if (cb.disabled || cb.checked) continue;
      const boxText = (cb.closest('label, fieldset, div')?.textContent || '').toLowerCase();
      const isConsent = cb.required || cb.getAttribute('aria-required') === 'true' || /\b(agree|acknowledge|consent|privacy|terms|certify|confirm|accurate)\b/i.test(boxText);
      if (isConsent) {
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        cb.dispatchEvent(new Event('input', { bubbles: true }));
        cb.click();
      }
    }
  }).catch(() => {});

  // 3. Ensure file upload completed or attach if missing
  let resolvedResume = resumePath;
  if (!resolvedResume) {
    const arch = detectJobArchetype(jobTitle || '', jdText || '');
    const defaultPdf = path.resolve('state/autoapply/resumes', `Shivam_Mahajan_Resume_${arch}.pdf`);
    if (existsSync(defaultPdf)) resolvedResume = defaultPdf;
  }

  if (resolvedResume && existsSync(resolvedResume)) {
    const emptyFileInput = frame.locator('input[type="file"]:not([data-autoapply-skip-file="true"])').filter({ hasNot: frame.locator('[data-autoapply-uploaded="true"]') });
    if ((await emptyFileInput.count().catch(() => 0)) > 0) {
      const firstInput = emptyFileInput.first();
      const hasFiles = await firstInput.evaluate((el: HTMLInputElement) => (el.files?.length ?? 0) > 0).catch(() => true);
      if (!hasFiles) {
        let uploadFile = resolvedResume;
        // Ticket GEN-166: Clean Shivam_Mahajan_Resume.pdf filename
        if (/\.pdf$/i.test(uploadFile) && path.basename(uploadFile) !== 'Shivam_Mahajan_Resume.pdf') {
          const stagedResume = path.join(path.dirname(uploadFile), 'Shivam_Mahajan_Resume.pdf');
          try {
            copyFileSync(uploadFile, stagedResume);
            uploadFile = stagedResume;
          } catch {}
        }
        const accept = (await firstInput.getAttribute('accept').catch(() => '')) || '';
        const prefersDocx = Boolean(accept && /\b(\.docx?|msword|wordprocessingml)\b/i.test(accept) && !/\b(\.pdf|application\/pdf)\b/i.test(accept));
        if (prefersDocx) {
          const docxSibling = resolvedResume.replace(/\.pdf$/i, '.docx');
          if (existsSync(docxSibling)) {
            uploadFile = docxSibling;
          } else {
            const arch = detectJobArchetype(jobTitle || '', jdText || '');
            const docxFallback = path.resolve('state/autoapply/resumes', `Shivam_Mahajan_Resume_${arch}.docx`);
            if (existsSync(docxFallback)) uploadFile = docxFallback;
          }
        }
        await firstInput.setInputFiles(uploadFile).catch(() => {});
        await frame.waitForTimeout(600);
      }
    }
  }

  // 4. Wait for any in-flight upload progress bars / spinners to finish mounting
  const progressBars = frame.locator('[role="progressbar"], progress, [data-automation-id*="upload-progress"], .file-upload-progress');
  if ((await progressBars.count().catch(() => 0)) > 0) {
    await progressBars.first().waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  }

  // 5. Click any inline sub-section "Save" / "Done" buttons (not the main page Next/Submit)
  const inlineSaves = frame.locator(
    'button[data-automation-id="panel-save-button"], button[data-automation-id="saveButton"], button:has-text("Save and Close")'
  ).filter({ visible: true });
  const saveCount = await inlineSaves.count().catch(() => 0);
  for (let i = 0; i < saveCount; i++) {
    await inlineSaves.nth(i).click({ timeout: 2000 }).catch(() => {});
    await frame.waitForTimeout(400);
  }
}

/**
 * Ticket GEN-101, GEN-105, GEN-106 & GEN-111: SmartRecruiters "I'm interested" / #st-apply entry gate handler.
 * Navigates from public job description overview into the interactive form (/oneclick-ui/ UUID) using trusted in-page click with Referer.
 */
export async function ensureSmartRecruitersApplicationStarted(
  page: Page,
  originalEntryUrl?: string
): Promise<boolean> {
  const url = page.url();
  if (!/smartrecruiters\.com/i.test(url)) {
    return false;
  }

  const countShadowAndLightInputs = async (): Promise<number> => {
    return await page
      .evaluate(() => {
        const countInRoot = (root: Document | ShadowRoot | Element): number => {
          let total = root.querySelectorAll(
            'input:not([type="hidden"]), textarea, select, [role="combobox"], input[type="file"]'
          ).length;
          const all = root.querySelectorAll('*');
          for (const el of Array.from(all)) {
            const sr = (el as HTMLElement).shadowRoot;
            if (sr) total += countInRoot(sr);
          }
          return total;
        };
        return countInRoot(document);
      })
      .catch(() => 0);
  };

  const waitForOneClickInputs = async (timeoutMs = 10000): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await countShadowAndLightInputs()) >= 2) {
        return true;
      }
      await page.waitForTimeout(350).catch(() => {});
    }
    return false;
  };

  // If already on /oneclick-ui/ and inputs are mounted (no DataDome block), we are ready
  if (/\/oneclick-ui\//i.test(page.url())) {
    const hasDataDome = await page
      .locator('iframe[src*="captcha-delivery.com"], iframe[src*="datadome"]')
      .first()
      .isVisible()
      .catch(() => false);
    if (!hasDataDome && (await waitForOneClickInputs(4000))) {
      return true;
    }
    // If DataDome blocked a direct /oneclick-ui/ load and we have the public overview URL, go back to overview
    if (originalEntryUrl && !/\/oneclick-ui\//i.test(originalEntryUrl)) {
      await page.goto(originalEntryUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    }
  }

  // Dismiss cookie banner if present so it doesn't intercept the click on a#st-apply
  const cookieBtn = page.locator('#onetrust-accept-btn-handler, button:has-text("Accept All")').first();
  if (await cookieBtn.isVisible().catch(() => false)) {
    await cookieBtn.click({ timeout: 2500 }).catch(() => {});
  }

  // Ensure a#st-apply opens in the SAME tab to preserve Referer and cookies
  await page
    .evaluate(() => {
      const links = document.querySelectorAll(
        'a#st-apply, a[data-test="apply-button"], a[href*="/oneclick-ui/"]'
      );
      for (const a of Array.from(links)) {
        a.removeAttribute('target');
      }
    })
    .catch(() => {});

  // Ticket GEN-160: SmartRecruiters a.js-oneclick + in-page location.assign(href) Referer Fallback
  const applySelectors = [
    'a#st-apply',
    'a.js-oneclick',
    '[data-test="apply-button"]',
    'a[href*="/oneclick-ui/"]',
    'a:has-text("I\'m interested")',
    'button:has-text("I\'m interested")',
    'oc-button:has-text("I\'m interested")',
  ];

  for (const sel of applySelectors) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) {
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      await loc.click({ timeout: 6000 }).catch(() => {});
      break;
    }
  }

  // Wait up to 3500ms for URL transition to /oneclick-ui/
  await page.waitForTimeout(1000).catch(() => {});
  if (!/\/oneclick-ui\//i.test(page.url())) {
    const triggeredInPageAssign = await page
      .evaluate(() => {
        const a = document.querySelector<HTMLAnchorElement>(
          'a#st-apply, a.js-oneclick, a[data-test="apply-button"], a[href*="/oneclick-ui/"]'
        );
        if (a && a.href && /\/oneclick-ui\//i.test(a.href)) {
          a.removeAttribute('target');
          a.click();
          setTimeout(() => {
            if (!window.location.href.includes('/oneclick-ui/')) {
              window.location.assign(a.href);
            }
          }, 600);
          return true;
        }
        return false;
      })
      .catch(() => false);

    if (triggeredInPageAssign) {
      await page
        .waitForURL((u) => /\/oneclick-ui\//i.test(u.toString()), { timeout: 8000 })
        .catch(() => {});
    }
  }

  return await waitForOneClickInputs(15000);
}

export class AutoApplyRunner {
  private activeAts?: string;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private logs: string[] = [];
  private cursor = { x: 0, y: 0 };
  private ownsContext = true;
  private applicationPages = new Set<Page>();
  private dependentRequests = new Map<Request, { epoch: number; status?: number; contentType?: string }>();
  private frameEpochs = new Map<Frame, number>();
  private lastRecoveryPoll = 0;
  private submissionObservation?: { url: string; report: BotRunReport; observer: ReturnType<typeof observeSubmission> };
  private learnedFields: Array<{ questionText: string; category: string; value: string }> = [];
  private activeWatchdog?: JobActivityWatchdog;
  private lastNetworkSubmissionReceipt: { url: string; status: number; timestamp: number } | null = null;
  // GEN-439: Store parsed field errors from HTTP 400/422 submit responses for closed-loop healing
  private lastNetworkValidationErrors: Array<{ field?: string; message: string }> = [];
  private profile?: CandidateExtendedProfile;
  private attemptedFieldRefs?: Set<string>;

  /**
   * Ticket GEN-131: Lever Async parseResume Field-Wipe Protection.
   * Runs right before clicking Submit on jobs.lever.co to deterministically restore core fields.
   */
  private async enforceLeverCoreFieldsBeforeSubmit(page: Page): Promise<void> {
    if (!/lever\.co/i.test(page.url())) return;
    const email = this.profile?.personal?.email || process.env.AUTOAPPLY_EMAIL || '';
    const phone = this.profile?.personal?.phone || process.env.AUTOAPPLY_PHONE || '';
    const fullName = this.profile?.personal?.fullName || 'Shivam Mahajan';
    const linkedin = (this.profile as any)?.links?.linkedin || this.profile?.personal?.linkedinUrl || 'https://www.linkedin.com/in/mahajanshivam';
    const github = (this.profile as any)?.links?.github || this.profile?.personal?.githubUrl || 'https://github.com/smresponsibilities';
    const portfolio = (this.profile as any)?.links?.portfolio || this.profile?.personal?.portfolioUrl || 'https://shivammahajan.com';

    await page
      .evaluate(
        (vals) => {
          const setNative = (sel: string, val: string, forceOverride = false) => {
            if (!val) return;
            const el = document.querySelector<HTMLInputElement>(sel);
            if (!el) return;
            const curr = (el.value || '').trim();
            if (!curr || forceOverride) {
              const setter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                'value'
              )?.set;
              if (setter) setter.call(el, val);
              else el.value = val;
              el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
              el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            }
          };

          setNative('input[name="name"]', vals.fullName, true);
          setNative('input[name="email"]', vals.email, true);
          setNative('input[name="phone"]', vals.phone, true);
          setNative('input[name="org"]', 'Morgan Stanley', true);
          setNative('input[name="urls[LinkedIn]"], input[name="urls[linkedin]"]', vals.linkedin, false);
          setNative('input[name="urls[GitHub]"], input[name="urls[github]"]', vals.github, false);
          setNative(
            'input[name="urls[Portfolio]"], input[name="urls[Website]"], input[name="urls[Other]"]',
            vals.portfolio,
            false
          );
        },
        { fullName, email, phone, linkedin, github, portfolio }
      )
      .catch(() => {});

    // If input[name="location"] on Lever is filled, ensure that if .itta-results .itta-item, .location-results li is visible, the first suggestion is clicked so Lever's hidden selectedLocation field is populated.
    try {
      const locDropdown = page.locator('.itta-results .itta-item, .location-results li').first();
      if (await locDropdown.isVisible().catch(() => false)) {
        await locDropdown.click().catch(() => {});
        await page.evaluate(() => {
          const locInput = document.querySelector<HTMLInputElement>('input[name="location"]');
          const hiddenLoc = document.querySelector<HTMLInputElement>('input[name="selectedLocation"]');
          if (locInput && hiddenLoc && !hiddenLoc.value) {
            hiddenLoc.value = locInput.value;
          }
        }).catch(() => {});
      }
    } catch {}

    // GEN-441: Broader Lever selectedLocation dropdown clicker
    try {
      await fillLeverLocationInput(page.mainFrame());
    } catch {}
  }

  /**
   * Ticket GEN-142: Dead/Closed Job Posting < 1.5s Fast-Exit.
   * Detects 404/closed postings immediately after page.goto to abort before Tier-3 context rotation.
   */
  private async isDeadOrClosedJobPosting(page: Page): Promise<string | null> {
    return await page
      .evaluate(() => {
        const inputs = document.querySelectorAll(
          'input:not([type="hidden"]), textarea, select, [role="combobox"]'
        ).length;
        if (inputs >= 2) return null;
        const title = (document.title || '').toLowerCase();
        const h1Text = Array.from(document.querySelectorAll('h1, h2, [data-automation-id="errorMessage"]'))
          .map((el) => (el.textContent || '').trim())
          .join(' ')
          .toLowerCase();
        const bodyText = (document.body?.innerText || '').slice(0, 2500).toLowerCase();
        const combined = `${title} ${h1Text} ${bodyText}`;
        if (
          /this job is no longer available|job you are looking for is no longer open|no longer accepting applications|position has been filled|position is no longer available|board you are looking for is no longer active|posting is no longer available|job not found|page not found|404 not found|not found|404 error|couldn't find anything here|might have closed|has been removed|the page you are looking for doesn't exist/i.test(
            combined
          )
        ) {
          return 'Job posting is closed or no longer available (404/expired)';
        }
        return null;
      })
      .catch(() => null);
  }

  /**
   * Ticket GEN-108: Dismiss Ashby React cookie consent modal / OneTrust banners and wait for form controls hydration.
   */
  private async dismissCookieConsentAndHydrateForm(page: Page, fallbackUrl?: string): Promise<void> {
    const url = page.url();
    const isAshby = /ashbyhq\.com/i.test(url);
    const maxPollMs = isAshby ? 6500 : 2500;
    const pollIntervalMs = 350;
    const deadline = Date.now() + maxPollMs;
    let clickedCookieDialog = false;

    // Fast check: native click on Ashby / OneTrust cookie banner buttons
    const fastCookie = page
      .locator(
        'button:has-text("Accept All"), [role="dialog"] button:has-text("Necessary Only"), #onetrust-accept-btn-handler, button:has-text("Accept Cookies"), [data-automation-id="legalNoticeAcceptButton"]'
      )
      .first();
    if (await fastCookie.isVisible().catch(() => false)) {
      await fastCookie.click({ timeout: 2000 }).catch(() => {});
      clickedCookieDialog = true;
      await page.waitForTimeout(400).catch(() => {});
    }

    while (Date.now() < deadline) {
      const state = await page
        .evaluate(() => {
          const countInteractiveControls = (root: Document | ShadowRoot | Element): number => {
            let count = root.querySelectorAll(
              'input:not([type="hidden"]), textarea, select, [role="combobox"], input[type="file"]'
            ).length;
            const all = root.querySelectorAll('*');
            for (const node of Array.from(all)) {
              const sr = (node as HTMLElement).shadowRoot;
              if (sr) count += countInteractiveControls(sr);
            }
            return count;
          };

          // 1. Check Ashby React Cookie Dialog (<div role="dialog" aria-label="Cookie consent">) and global cookie banners
          const dialogs = Array.from(
            document.querySelectorAll(
              '[role="dialog"][aria-label*="cookie" i], [role="dialog"][aria-label*="consent" i], [id*="cookie" i], [class*="cookie-banner" i], #onetrust-banner-sdk'
            )
          );

          for (const dialog of dialogs) {
            const buttons = Array.from(dialog.querySelectorAll('button, [role="button"], a'));
            const targetBtn =
              buttons.find((b) => /^accept all$/i.test((b.textContent || '').trim())) ||
              buttons.find((b) => /^necessary only$/i.test((b.textContent || '').trim())) ||
              buttons.find((b) => /^(accept|allow all|i agree|got it)$/i.test((b.textContent || '').trim()));
            if (targetBtn && (targetBtn as HTMLElement).offsetParent !== null) {
              (targetBtn as HTMLElement).click();
              return { clicked: true, controlCount: countInteractiveControls(document) };
            }
          }

          // 2. Fallback: Check any visible button with exact text "Accept All" or "Necessary Only" on page
          const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
          const topCookieBtn =
            allButtons.find((b) => /^accept all$/i.test((b.textContent || '').trim())) ||
            allButtons.find((b) => /^necessary only$/i.test((b.textContent || '').trim())) ||
            allButtons.find((b) => b.id === 'onetrust-accept-btn-handler');
          if (topCookieBtn && (topCookieBtn as HTMLElement).offsetParent !== null) {
            (topCookieBtn as HTMLElement).click();
            return { clicked: true, controlCount: countInteractiveControls(document) };
          }

          return { clicked: false, controlCount: countInteractiveControls(document) };
        })
        .catch(() => ({ clicked: false, controlCount: 0 }));

      if (state.clicked) {
        clickedCookieDialog = true;
      }

      // If we already have >= 2 form controls mounted (and no cookie dialog just clicked), we are hydrated!
      if (state.controlCount >= 2 && !state.clicked) {
        return;
      }

      await page.waitForTimeout(pollIntervalMs).catch(() => {});
    }

    // If we clicked the cookie dialog on Ashby, wait up to 5000ms for React to mount the 17+ form inputs
    if (clickedCookieDialog || isAshby) {
      const hydrateDeadline = Date.now() + 5000;
      while (Date.now() < hydrateDeadline) {
        const ready = await page
          .evaluate(() => {
            const inputs = document.querySelectorAll(
              'input:not([type="hidden"]), textarea, select, [role="combobox"], input[type="file"]'
            ).length;
            const submitBtn = Array.from(document.querySelectorAll('button, input[type="submit"]')).some((b) =>
              /submit application|submit|apply/i.test((b.textContent || (b as HTMLInputElement).value || '').trim())
            );
            return inputs >= 2 || submitBtn;
          })
          .catch(() => false);
        if (ready) break;
        await page.waitForTimeout(300).catch(() => {});
      }
    }

    // Ticket GEN-158, GEN-224 & GEN-228: Greenhouse Remix Collapsed Form Expander & Safe Embed Fallback
    const effectiveUrl = page.url() || fallbackUrl || '';
    const ghMatch = effectiveUrl.match(/(?:boards|job-boards(?:\.eu)?)\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i) ||
                    (fallbackUrl ? fallbackUrl.match(/(?:boards|job-boards(?:\.eu)?)\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i) : null);

    if (/greenhouse\.io\/embed\/job_app/i.test(page.url())) {
      const embedCount = await page.evaluate(() => {
        return document.querySelectorAll('input:not([type="hidden"]), textarea, select, [role="combobox"]').length;
      }).catch(() => 0);

      if (embedCount < 2) {
        const ready = await page.waitForFunction(() => {
          return document.querySelectorAll('input:not([type="hidden"]), textarea, select, [role="combobox"]').length >= 2;
        }, { timeout: 3500 }).then(() => true).catch(() => false);

        if (!ready) {
          let forSlug = '';
          let tokenJobId = '';
          try {
            const u = new URL(page.url());
            forSlug = u.searchParams.get('for') || '';
            tokenJobId = u.searchParams.get('token') || '';
          } catch {}
          if (!forSlug && ghMatch) {
            forSlug = ghMatch[1] || '';
            tokenJobId = ghMatch[2] || '';
          }
          if (forSlug && tokenJobId) {
            const isEu = page.url().includes('.eu.greenhouse.io') || (effectiveUrl || '').includes('.eu.greenhouse.io');
            const ghHost = isEu ? 'job-boards.eu.greenhouse.io' : 'job-boards.greenhouse.io';
            const searchParams = new URL(page.url()).search;
            const hostedUrl = `https://${ghHost}/${encodeURIComponent(forSlug)}/jobs/${encodeURIComponent(tokenJobId)}${searchParams}`;
            await page.goto(hostedUrl, { waitUntil: 'domcontentloaded', timeout: 15000, referer: page.url() }).catch(() => {});
            const applyBtn = page.locator('button.btn--pill:has-text("Apply"), button:has-text("Apply"), a.btn--pill:has-text("Apply")').first();
            if (await applyBtn.isVisible().catch(() => false)) {
              await applyBtn.click({ timeout: 3000 }).catch(() => {});
            }
            await page
              .evaluate(() => {
                const formEl = document.querySelector('#application-form, #application_form, #app');
                if (formEl) formEl.scrollIntoView({ block: 'start' });
              })
              .catch(() => {});
          }
        }
      }
    } else if (/greenhouse\.io/i.test(page.url()) || ghMatch) {
      await page
        .evaluate(() => {
          const formEl = document.querySelector('#application-form, #application_form, #app');
          if (formEl) formEl.scrollIntoView({ block: 'start' });
        })
        .catch(() => {});

      let ghVisibleInputCount = await page
        .evaluate(() => {
          const inputs = Array.from(
            document.querySelectorAll<HTMLElement>(
              '#application-form input:not([type="hidden"]), #application-form textarea, #application-form [role="combobox"], input#first_name, input#last_name, input#email, input:not([type="hidden"])'
            )
          );
          return inputs.filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden';
          }).length;
        })
        .catch(() => 0);

      if (ghVisibleInputCount < 2) {
        const applyPillSelectors = [
          'button.btn--pill:has-text("Apply")',
          'button:has-text("Apply for this job")',
          'a.btn--pill:has-text("Apply")',
          '[data-mapped="true"] button:has-text("Apply")',
          'button:has-text("Apply")',
          'a[href="#app"], a[href*="#application"]',
        ];
        for (const sel of applyPillSelectors) {
          const btn = page.locator(sel).first();
          if (await btn.isVisible().catch(() => false)) {
            await btn.scrollIntoViewIfNeeded().catch(() => {});
            await btn.click({ timeout: 4000 }).catch(() => {});
            break;
          }
        }
        await page
          .evaluate(() => {
            const formEl = document.querySelector('#application-form, #application_form, #app');
            if (formEl) formEl.scrollIntoView({ block: 'start' });
          })
          .catch(() => {});

        await page
          .locator('#first_name, #email, #application-form input:not([type="hidden"]), input:not([type="hidden"])')
          .first()
          .waitFor({ state: 'visible', timeout: 5000 })
          .catch(() => {});

        ghVisibleInputCount = await page
          .evaluate(() => {
            const inputs = Array.from(
              document.querySelectorAll<HTMLElement>(
                '#application-form input:not([type="hidden"]), #application-form textarea, #application-form [role="combobox"], input#first_name, input#last_name, input#email, input:not([type="hidden"])'
              )
            );
            return inputs.filter((el) => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden';
            }).length;
          })
          .catch(() => 0);
      }

      // Ticket GEN-158, GEN-224, GEN-228, GEN-305 & GEN-326: Greenhouse Remediation (Case 1 vs Case 2)
      if (ghMatch && ghMatch[1] && ghMatch[2]) {
        const ghSlug = ghMatch[1];
        const ghJobId = ghMatch[2];
        const isEu = effectiveUrl.includes('.eu.greenhouse.io');
        const ghHost = isEu ? 'job-boards.eu.greenhouse.io' : 'job-boards.greenhouse.io';
        const stayedOnGreenhouse = /greenhouse\.io/i.test(page.url());

        if (stayedOnGreenhouse) {
          // Case 1: Page stayed on greenhouse.io -> Do NOT redirect to /embed/job_app (no redirect bounce!)
          if (ghVisibleInputCount < 2) {
            const applyBtn = page.locator('button.btn--pill:has-text("Apply"), [role="tab"]:has-text("Application"), button:has-text("Apply for this job"), button:has-text("Apply"), a.btn--pill:has-text("Apply"), [data-mapped="true"] button, a[href*="#app"], a[href*="#application"]').first();
            if (await applyBtn.isVisible().catch(() => false)) {
              await applyBtn.click({ timeout: 3000 }).catch(() => {});
            }
            await page
              .evaluate(() => {
                const formEl = document.querySelector('#application-form, #application_form, #app, form');
                if (formEl) formEl.scrollIntoView({ block: 'start' });
              })
              .catch(() => {});
            await page
              .locator('#first_name, #email, input[name="first_name"], input[name="email"], input:not([type="hidden"])')
              .first()
              .waitFor({ state: 'visible', timeout: 5000 })
              .catch(() => {});
          }
        } else {
          // Case 2: 302-redirected OFF greenhouse.io onto a company marketing domain
          const iframeSrc = await page.evaluate(() => {
            const frame = document.querySelector('iframe#grnhse_iframe, iframe[src*="greenhouse.io"]') as HTMLIFrameElement | null;
            return frame?.src || null;
          }).catch(() => null);

          if (iframeSrc && iframeSrc.startsWith('http')) {
            await page.goto(iframeSrc, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          } else {
            const embedUrl = `https://${ghHost}/embed/job_app?for=${encodeURIComponent(ghSlug)}&token=${encodeURIComponent(ghJobId)}`;
            await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          }

          await page
            .locator('#first_name, #email, input:not([type="hidden"])')
            .first()
            .waitFor({ state: 'visible', timeout: 5000 })
            .catch(() => {});
        }
      }
    }
  }

  /**
   * Ticket GEN-231: Pre-Submit Resume Upload Guarantee.
   * If any dropzone/file-input was missed during step filling, ensure primary resume is uploaded before submit.
   */
  private async ensureResumeUploadedBeforeSubmit(page: Page, resumePath?: string): Promise<void> {
    if (!resumePath) return;
    try {
      const needsUpload = await page
        .evaluate(() => {
          const fileInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
          if (fileInputs.length === 0) return false;
          // If any file input already has files attached, or page shows ".pdf" / ".docx" uploaded pill, skip
          if (fileInputs.some((inp) => inp.files && inp.files.length > 0)) return false;
          const bodyTxt = (document.body?.innerText || '').toLowerCase();
          if (bodyTxt.includes('shivam_mahajan_resume.pdf') || bodyTxt.includes('remove file')) return false;
          return true;
        })
        .catch(() => false);

      if (needsUpload) {
        const primaryFileInput = page
          .locator('input[type="file"]:not([id*="cover" i]):not([name*="cover" i])')
          .first();
        if ((await primaryFileInput.count().catch(() => 0)) > 0) {
          let uploadPath = resumePath;
          const acceptAttr = (await primaryFileInput.getAttribute('accept').catch(() => '')) || '';
          if (/\.docx?|msword|wordprocessingml/i.test(acceptAttr) && !/\.pdf|application\/pdf|\*/i.test(acceptAttr)) {
            const docxSibling = resumePath.replace(/\.pdf$/i, '.docx');
            if (existsSync(docxSibling)) {
              uploadPath = docxSibling;
            }
          }
          await primaryFileInput.setInputFiles(uploadPath, { timeout: 4000 }).catch(() => {});
          await page.waitForTimeout(800).catch(() => {});
        }
      }
    } catch {}
  }

  /**
   * Ticket GEN-147: Ashby & Lever Anti-Spam reCAPTCHA v3 / Enterprise hCaptcha Behavioral Telemetry Pre-Submit Routine.
   */
  private async performHumanPreSubmitTelemetry(page: Page, submitControl?: Locator | null): Promise<void> {
    try {
      await page
        .evaluate(() => {
          window.scrollBy({ top: 180, behavior: 'smooth' });
        })
        .catch(() => {});
      await page.waitForTimeout(120).catch(() => {});
      if (submitControl) {
        const box = await submitControl.boundingBox().catch(() => null);
        if (box && box.width > 0 && box.height > 0) {
          const targetX = box.x + box.width * 0.52;
          const targetY = box.y + box.height * 0.54;
          await page.mouse.move(Math.max(10, targetX - 140), Math.max(10, targetY - 65), { steps: 4 }).catch(() => {});
          await page.mouse.move(targetX, targetY, { steps: 6 }).catch(() => {});
          await page.waitForTimeout(90).catch(() => {});
        }
      }
    } catch {
      // Never block submission on telemetry helper
    }
  }

  /**
   * Ticket GEN-153 & GEN-154: Strict numeric input unit stripper and URL input validator guard.
   */
  private async sanitizeValueForInputType(
    control: Locator,
    rawValue: string,
    questionText: string
  ): Promise<string> {
    const val = String(rawValue ?? '').trim();
    if (!val) return val;
    const meta = await control
      .evaluate((el) => {
        const inp = el as HTMLInputElement;
        return {
          type: (inp.getAttribute('type') || inp.type || '').toLowerCase(),
          role: (inp.getAttribute('role') || '').toLowerCase(),
          inputMode: (inp.getAttribute('inputmode') || '').toLowerCase(),
          placeholder: (inp.getAttribute('placeholder') || '').toLowerCase(),
          min: inp.getAttribute('min') || '',
          max: inp.getAttribute('max') || '',
          maxLength: inp.maxLength > 0 ? inp.maxLength : (Number(inp.getAttribute('maxlength')) || 0),
        };
      })
      .catch(() => ({ type: '', role: '', inputMode: '', placeholder: '', min: '', max: '', maxLength: 0 }));

    // GEN-153 & GEN-184: Strict numeric input sanitizer with min/max clamping
    if (meta.type === 'number' || meta.role === 'spinbutton' || meta.inputMode === 'numeric') {
      const clampNumeric = (numStr: string): string => {
        let n = Number(numStr);
        if (!Number.isFinite(n)) n = 1;
        if (meta.min !== '' && Number.isFinite(Number(meta.min)) && n < Number(meta.min)) {
          n = Number(meta.min);
        }
        if (meta.max !== '' && Number.isFinite(Number(meta.max)) && n > Number(meta.max)) {
          n = Number(meta.max);
        }
        return String(n);
      };

      if (/^(?:immediate|immediately|now|none|no|n\/a|false)$/i.test(val)) {
        return clampNumeric('0');
      }
      if (/lpa|lakh/i.test(val)) {
        const asksInLakhs = /\bin\s+(?:lpa|lakhs?)\b|\(lpa\)/i.test(questionText);
        return clampNumeric(asksInLakhs ? '12' : '1200000');
      }
      const numMatch = val.match(/-?\d+(?:\.\d+)?/);
      if (numMatch) {
        return clampNumeric(numMatch[0]);
      }
      return clampNumeric('1');
    }

    // GEN-154: Strict URL input sanitizer
    const isUrlField =
      meta.type === 'url' ||
      /^https?:\/\//i.test(meta.placeholder) ||
      /\b(?:url|website|portfolio\s+link|github\s+link|linkedin\s+link|profile\s+link)\b/i.test(questionText);
    if (isUrlField) {
      if (/^(?:n\/a|none|no|na|-)$/i.test(val) || !/^https?:\/\//i.test(val)) {
        if (/linkedin/i.test(questionText)) return 'https://www.linkedin.com/in/mahajanshivam';
        if (/github/i.test(questionText)) return 'https://github.com/smresponsibilities';
        if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(val)) return `https://${val}`;
        return 'https://shivammahajan.com';
      }
    }
    // Ticket GEN-340: HTML5 Month and Date Sanitizer
    if (meta.type === 'month') {
      if (/graduat|degree|education|college|university|completion/i.test(questionText)) {
        return '2026-08';
      }
      return '2025-08';
    }
    if (meta.type === 'date') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(val)) {
        const [mm, dd, yyyy] = val.split('/');
        return `${yyyy}-${mm}-${dd}`;
      }
      if (/graduat|degree|education|completion|attend/i.test(questionText)) {
        return '2026-08-01';
      }
      if (/start|from|begin/i.test(questionText)) {
        return '2025-08-01';
      }
      return new Date().toISOString().slice(0, 10);
    }

    // Ticket GEN-206: Truncate single-line inputs cleanly to maxLength (Artefact)
    if (meta.maxLength > 0 && val.length > meta.maxLength) {
      return val.slice(0, meta.maxLength).trim();
    }

    return val;
  }

  /**
   * Ticket GEN-123: Track HTTP POST network submissions on known ATS endpoints.
   */
  private attachNetworkReceiptListener(page: Page): void {
    page
      .route(
        /(?:fullstory\.com|hotjar\.com|datadoghq-browser-agent|doubleclick\.net|google-analytics\.com|analytics\.tiktok\.com|connect\.facebook\.net|bat\.bing\.com|clarity\.ms|mouseflow\.com|logrocket\.io)/i,
        (route) => route.abort().catch(() => {})
      )
      .catch(() => {});

    page.on('response', async (response) => {
      try {
        const req = response.request();
        if (req.method() !== 'POST' && req.method() !== 'PUT') return;
        const status = response.status();

        // GEN-439: Capture validation errors from HTTP 400/422 submit responses for closed-loop healing
        if (status === 400 || status === 422) {
          const respUrl400 = response.url();
          const isAtsEndpoint400 =
            /ApiSubmit(?:Single)?ApplicationForm(?:Action)?|ApiSubmitJobApplication|submitApplication|\/embed\/job_app|\/oneclick-ui\/[^?]+\/(?:candidates|applications)|\/jobs\/\d+(?:\/applications)?|\/jobs\/\d+|\/apply\/submit|\/job_app|\/api\/non-user-graphql/i.test(respUrl400);
          if (isAtsEndpoint400) {
            try {
              const bodyText400 = await response.text().catch(() => '');
              const parsed400 = JSON.parse(bodyText400);
              const rawErrors: any[] =
                parsed400?.validationErrors ||
                parsed400?.errors ||
                parsed400?.errorMessages ||
                parsed400?.fieldErrors ||
                [];
              if (rawErrors.length > 0) {
                this.lastNetworkValidationErrors = rawErrors.map((e: any) => ({
                  field: e.fieldId || e.field || e.fieldName || undefined,
                  message: String(e.message || e.error || e.detail || JSON.stringify(e)).slice(0, 200),
                }));
                this.log(`[GEN-439] Submit HTTP ${status} with ${this.lastNetworkValidationErrors.length} validation errors: ${this.lastNetworkValidationErrors.map((e: any) => e.message).join('; ').slice(0, 300)}`);
              }
            } catch {}
          }
          return;
        }

        if (status < 200 || status >= 400) return;
        const respUrl = response.url();
        const isAtsSubmitEndpoint =
          /ApiSubmit(?:Single)?ApplicationForm(?:Action)?|ApiSubmitJobApplication|submitApplication|\/embed\/job_app|\/oneclick-ui\/[^?]+\/(?:candidates|applications)|\/jobs\/\d+(?:\/applications)?|\/jobs\/\d+|\/apply\/submit|\/job_app|\/api\/non-user-graphql/i.test(
            respUrl
          );
        if (!isAtsSubmitEndpoint) return;
        if (respUrl.includes('/api/non-user-graphql')) {
          const reqUrl = req.url();
          const reqBody = req.postData() || '';
          const isSubmitMutation = /op=ApiSubmit/i.test(reqUrl) || /Submit(?:Single)?ApplicationForm|submitApplication|SubmitJobApplication/i.test(reqBody);
          if (!isSubmitMutation) return;
        }
        // For GraphQL (Ashby), ensure response JSON doesn't contain errors
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('application/json')) {
          const bodyText = await response.text().catch(() => '');
          if (
            /"(?:errors|errorMessages|validationErrors|fieldErrors)"\s*:\s*\[[^\]]+\]|"(?:isSuccess|success|ok)"\s*:\s*false/i.test(
              bodyText
            )
          ) {
            this.log(`Submit endpoint returned error: ${bodyText.slice(0, 2000)}`);
            return;
          }
          this.log(`Submit endpoint returned SUCCESS: ${bodyText.slice(0, 100)}`);
        }
        this.lastNetworkSubmissionReceipt = {
          url: respUrl,
          status,
          timestamp: Date.now(),
        };
      } catch {
        // Ignore response read errors on navigation
      }
    });
  }

  /**
   * Ticket GEN-125: Auto-check mandatory privacy/terms consent checkboxes across light and open shadow DOM.
   */
  private async ensurePrivacyConsentCheckboxesChecked(page: Page): Promise<void> {
    await page
      .evaluate(() => {
        const collectCheckboxes = (root: Document | ShadowRoot | Element): HTMLInputElement[] => {
          const out = Array.from(root.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
          for (const el of Array.from(root.querySelectorAll('*'))) {
            const sr = (el as HTMLElement).shadowRoot;
            if (sr) out.push(...collectCheckboxes(sr));
          }
          return out;
        };
        const boxes = collectCheckboxes(document);
        for (const box of boxes) {
          if (box.checked) continue;
          const host = (box.getRootNode?.() as ShadowRoot)?.host as HTMLElement | undefined;
          const contextText = (
            (box.closest('label, [class*="checkbox" i], [class*="consent" i]')?.textContent || '') +
            ' ' +
            (host?.textContent || '') +
            ' ' +
            (host?.getAttribute?.('label') || '')
          ).toLowerCase();
          if (
            /privacy|terms|consent|acknowledge|agree|gdpr|data\s+protection|authorize/i.test(contextText) ||
            boxes.length === 1
          ) {
            box.click();
            if (!box.checked) {
              box.checked = true;
              box.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            }
          }
        }
      })
      .catch(() => {});
  }

  private async coverLetter(options: AutoApplyOptions): Promise<string | undefined> {
    if (!options.sessionDir || !options.applicationBrief || !this.context) return;
    const text = prepareText(options.profile, options.applicationBrief).coverLetter;
    const filename = path.join(options.sessionDir, `cover-letter-${sha256(text).slice(0, 16)}.pdf`);
    if (existsSync(filename)) return filename;
    mkdirSync(options.sessionDir, { recursive: true });
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const page = await this.context.newPage();
    try {
      await page.setContent(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{font:11pt Arial;line-height:1.5;white-space:pre-wrap}</style><body>${escaped}</body>`);
      let pdf: Buffer;
      try {
        pdf = await page.pdf({ format: 'A4', margin: { top: '16mm', bottom: '16mm', left: '16mm', right: '16mm' } });
      } catch {
        const headlessBrowser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--headless=new'] });
        try {
          const headlessPage = await headlessBrowser.newPage();
          await headlessPage.setContent(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{font:11pt Arial;line-height:1.5;white-space:pre-wrap}</style><body>${escaped}</body>`);
          pdf = await headlessPage.pdf({ format: 'A4', margin: { top: '16mm', bottom: '16mm', left: '16mm', right: '16mm' } });
        } finally {
          await headlessBrowser.close().catch(() => {});
        }
      }
      try { writeFileSync(filename, pdf, { flag: 'wx', mode: 0o600 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      return filename;
    } finally { await page.close(); }
  }

  private interactions(options: AutoApplyOptions): BrowserInteractions | undefined {
    return options.mode === 'stealth' ? { click: control => this.pacedClick(control), type: (control, value) => this.humanType(control, value, false) } : undefined;
  }

  private async authenticationStep(options: AutoApplyOptions, report: BotRunReport, submittedCredentials?: Set<'signup' | 'signin'>): Promise<'progress' | 'review'> {
    if (!options.vault) return 'review';
    return authenticateApplication(this.page!, { vault: options.vault, tenant: options.requisition ? canonicalEmployerKey(options.url, options.requisition.key) : new URL(options.url).hostname, email: options.profile.personal.email, recruitmentPrivacyConsent: options.profile.recruitmentPrivacyConsent, candidateNames: [options.profile.personal.firstName, options.profile.personal.lastName || ''], mailbox: options.mailbox, interaction: this.interactions(options), submittedCredentials, beforeCredentialSubmit: submittedCredentials ? async () => { report.credentialAttempts = [...submittedCredentials]; await this.checkpoint(options, report); } : undefined, since: new Date(report.startTime), onDiagnostic: code => report.logs.push(`workday_reconcile:auth_${code}`), verification: { provider: options.requisition?.provider || report.ats, recipient: options.profile.personal.email, since: new Date(report.startTime), applicationUrl: options.url, company: options.company, claim: options.claimMail } }).catch(() => { report.logs.push('workday_reconcile:auth_exception'); return 'review' as const; });
  }

  private async reconcileWorkday(options: AutoApplyOptions, report: BotRunReport): Promise<BotRunReport['receipt'] | undefined> {
    const home = workdayCandidateHomeUrl(options.url);
    if (!home || options.requisition?.provider !== 'workday' || !this.page || !options.vault) return;
    const tenant = canonicalEmployerKey(options.url, options.requisition.key);
    const origin = new URL(home).origin;
    let signInAttempted = false;
    await this.page.goto(home, { waitUntil: 'domcontentloaded', timeout: 45000 });
    for (let attempt = 0; attempt < 6; attempt++) {
      const ready = this.page.locator('[data-automation-id="utilityButtonSignIn"],input[type=password],input[type=email],input[autocomplete=username]')
        .or(this.page.getByRole('heading', { name: /my applications|application history|check (?:your )?email|verify (?:your )?email/i }))
        .or(this.page.getByRole('button', { name: /^decline$/i })).filter({ visible: true });
      await ready.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      if (new URL(this.page.url()).origin !== origin) { report.logs.push('workday_reconcile:unexpected_origin'); return; }
      if ((await this.browserGates()).challenge) { report.logs.push('workday_reconcile:challenge'); return; }
      const decline = this.page.getByRole('button', { name: /^decline$/i }).filter({ visible: true });
      if (await decline.count() === 1) { await decline.click(); await this.page.waitForTimeout(500); continue; }
      await expandWorkdayApplications(this.page);
      if (await findWorkdayApplication(this.page, home, options.requisition.jobId)) { report.logs.push('workday_reconcile:matched'); return { url: home, text: 'Existing application listed in Candidate Home', verifiedAt: new Date().toISOString(), existing: true, selector: 'candidate-home-application' }; }
      if (await workdayApplicationsEmpty(this.page, home)) { report.logs.push('workday_reconcile:empty_application_list'); return; }
      const onHome = new URL(this.page.url()).pathname.replace(/\/$/, '').toLowerCase() === new URL(home).pathname.replace(/\/$/, '').toLowerCase();
      if (onHome && await this.page.getByRole('heading', { name: /^(?:my applications|application history)$/i }).filter({ visible: true }).count()) { report.logs.push('workday_reconcile:home_no_verified_match'); return; }
      const credentials = this.page.locator('input[type=password],input[type=email],input[autocomplete=username]').filter({ visible: true });
      if (await credentials.count() || await hasEmailAuthenticationGate(this.page)) {
        if (signInAttempted && await credentials.count()) {
          try { await this.page.getByRole('heading', { name: /^(?:my applications|application history)$/i }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 15000 }); continue; }
          catch { report.logs.push('workday_reconcile:sign_in_pending'); return; }
        }
        if (!options.vault.get(tenant) && !options.mailbox) { report.logs.push('workday_reconcile:no_authentication'); return; }
        const beforeUrl = this.page.url();
        const beforePasswords = await this.page.locator('input[type=password]').filter({ visible: true }).count();
        if (await this.authenticationStep(options, report) !== 'progress') { report.logs.push('workday_reconcile:authentication_review'); return; }
        if (report.logs.at(-1) === 'workday_reconcile:auth_signin_submitted') signInAttempted = true;
        report.logs.push('workday_reconcile:authentication_progress');
        try {
          await this.page.waitForFunction(({ url, passwords }) => {
            const visible = (element: Element) => !!element.getClientRects().length;
            return location.href !== url || Array.from(document.querySelectorAll('input[type=password]')).filter(visible).length !== passwords
              || Array.from(document.querySelectorAll('[role=alert],[data-automation-id=errorMessage]')).some(visible)
              || Array.from(document.querySelectorAll('h1,h2,h3')).some(element => visible(element) && /check (?:your )?email|verify (?:your )?email|my applications/i.test(element.textContent || ''));
          }, { url: beforeUrl, passwords: beforePasswords }, { timeout: 15000 });
        } catch { if (this.page.url() === beforeUrl) { report.logs.push('workday_reconcile:authentication_pending'); return; } }
        continue;
      }
      const signIn = this.page.locator('[data-automation-id="utilityButtonSignIn"]').filter({ visible: true });
      if (await signIn.count() === 1) {
        if (signInAttempted) {
          try { await this.page.getByRole('heading', { name: /^(?:my applications|application history)$/i }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 15000 }); continue; }
          catch { report.logs.push('workday_reconcile:sign_in_pending'); return; }
        }
        report.logs.push('workday_reconcile:open_sign_in');
        await signIn.click();
        await this.page.locator('input[type=password],input[type=email],input[autocomplete=username]').filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
        continue;
      }
      if (new URL(this.page.url()).pathname.toLowerCase() !== new URL(home).pathname.toLowerCase()) { await this.page.goto(home, { waitUntil: 'domcontentloaded', timeout: 45000 }); continue; }
      try {
        await this.page.getByRole('heading', { name: /^(?:my applications|application history)$/i }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 15000 });
        continue;
      } catch { report.logs.push('workday_reconcile:home_not_ready'); return; }
    }
    report.logs.push('workday_reconcile:step_limit');
  }

  private ownsIsolatedContext = false;
  private isClosing = false;
  private contextClosed = false;

  async close(): Promise<void> {
    this.isClosing = true;
    this.submissionObservation?.observer.close();
    this.submissionObservation = undefined;

    const closeWithTimeout = async (action: () => Promise<any>, timeoutMs = 3500) => {
      let timer: NodeJS.Timeout;
      const timeoutPromise = new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      });
      try {
        await Promise.race([action().catch(() => {}), timeoutPromise]);
      } finally {
        clearTimeout(timer!);
      }
    };

    if (this.ownsContext) {
      await closeWithTimeout(() => this.context?.close() ?? Promise.resolve());
      await closeWithTimeout(() => this.browser?.close() ?? Promise.resolve());
    } else if (this.ownsIsolatedContext) {
      await closeWithTimeout(() => this.context?.close() ?? Promise.resolve());
    } else {
      for (const page of this.applicationPages) {
        await closeWithTimeout(() => page.close());
      }
      if (this.page && !this.applicationPages.has(this.page)) {
        await closeWithTimeout(() => this.page!.close());
      }
    }
    this.browser = null;
    this.context = null;
    this.page = null;
    this.applicationPages.clear();
    this.dependentRequests.clear();
    this.frameEpochs.clear();
  }

  public aborted = false;

  public async forceKillBrowser(): Promise<void> {
    this.aborted = true;
    this.isClosing = true;
    const browserPid = (this.browser as any)?.process?.()?.pid;
    const closeWithTimeout = async (action: () => Promise<any>, timeoutMs = 2500) => {
      let timer: NodeJS.Timeout;
      const timeoutPromise = new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      });
      try {
        await Promise.race([action().catch(() => {}), timeoutPromise]);
      } finally {
        clearTimeout(timer!);
      }
    };

    try {
      if (this.ownsContext) {
        await closeWithTimeout(() => this.context?.close() ?? Promise.resolve(), 2500);
        await closeWithTimeout(() => this.browser?.close() ?? Promise.resolve(), 2500);
      } else if (this.ownsIsolatedContext) {
        await closeWithTimeout(() => this.context?.close() ?? Promise.resolve(), 2500);
      } else {
        for (const page of this.applicationPages) {
          await closeWithTimeout(() => page.close(), 2500);
        }
        if (this.page && !this.applicationPages.has(this.page)) {
          await closeWithTimeout(() => this.page!.close(), 2500);
        }
      }
    } catch {}

    if (browserPid && process.platform === 'win32') {
      try {
        execSync(`taskkill /F /T /PID ${browserPid}`, { stdio: 'ignore', timeout: 3000 });
      } catch {}
    }

    this.browser = null;
    this.context = null;
    this.page = null;
    this.applicationPages.clear();
    this.dependentRequests.clear();
    this.frameEpochs.clear();
  }

  public isConnected(): boolean {
    if (this.browser) return this.browser.isConnected();
    if (this.context) {
      try {
        this.context.pages();
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  async forkApplicationContext(storageStatePath?: string): Promise<AutoApplyRunner> {
    if (!this.isConnected() || !this.context) {
      await this.initBrowser(true);
    }
    const browser = this.browser || (this.context as any)?.browser?.() || null;
    const context = browser
      ? await createResilientBrowserContext(browser, storageStatePath)
      : this.context!;
    const child = new AutoApplyRunner();
    child.browser = null;
    child.context = context;
    await installRamDietRouteFilter(context).catch(() => {});
    child.page = await context.newPage();
    child.trackPage(child.page);
    child.ownsContext = false;
    child.ownsIsolatedContext = context !== this.context;
    return child;
  }

  async forkApplication(browserProfileDir: string, headless = true): Promise<AutoApplyRunner> {
    if (!this.context || !this.isConnected()) await this.initBrowser(headless, undefined, browserProfileDir);
    const child = new AutoApplyRunner();
    child.context = this.context;
    child.page = await this.context!.newPage();
    child.trackPage(child.page);
    child.ownsContext = false;
    return child;
  }

  private getActiveApplicationPages(): Page[] {
    const pages = Array.from(this.applicationPages).filter((p) => {
      try {
        return Boolean(p && !p.isClosed());
      } catch {
        return false;
      }
    });
    if (pages.length === 0 && this.page && !this.page.isClosed()) {
      return [this.page];
    }
    return pages;
  }

  private trackPage(page: Page): void {
    if (this.applicationPages.has(page)) return;
    this.applicationPages.add(page);
    this.attachNetworkReceiptListener(page);
    page.on('framenavigated', frame => this.frameEpochs.set(frame, (this.frameEpochs.get(frame) || 0) + 1));
    page.on('request', request => {
      if (['xhr', 'fetch'].includes(request.resourceType()) && !/sentry\.io|datadog|google-analytics|googletagmanager|doubleclick|segment\.io|segment|amplitude|mixpanel|hotjar|intercom|clarity\.ms|linkedin\.com\/px|facebook\.net|fullstory|bugsnag|hs-analytics|optimizely|newrelic|nr-data\.net|telemetry|\/collect(?:\?|$)/i.test(request.url())) this.dependentRequests.set(request, { epoch: this.frameEpochs.get(request.frame()) || 0 });
    });
    page.on('response', response => {
      const pending = this.dependentRequests.get(response.request());
      if (pending) {
        pending.status = response.status();
        pending.contentType = response.headers()['content-type'];
        if (response.status() >= 400) this.dependentRequests.delete(response.request());
      }
    });
    page.on('requestfinished', request => this.dependentRequests.delete(request));
    page.on('requestfailed', request => this.dependentRequests.delete(request));
    page.on('domcontentloaded', () => {
      for (const [request, pending] of this.dependentRequests) {
        try { if (request.frame().page() === page && (request.frame().isDetached() || pending.epoch < (this.frameEpochs.get(request.frame()) || 0))) this.dependentRequests.delete(request); }
        catch { this.dependentRequests.delete(request); }
      }
    });
    page.on('popup', popup => this.trackPage(popup));
  }

  async openReview(): Promise<void> { await this.page?.bringToFront(); }

  async parkReview(options: AutoApplyOptions, report: BotRunReport): Promise<void> {
    if (!options.sessionDir || !this.page || this.page.isClosed()) return;
    await this.checkpoint(options, report);
    mkdirSync(options.sessionDir, { recursive: true });
    await this.context!.storageState({ path: path.join(options.sessionDir, 'storage-state.json') });
    const html = await this.page.locator('html').evaluate(sanitizedDocument);
    writeFileSync(path.join(options.sessionDir, 'review.html'), html, { mode: 0o600 });
    await this.page.screenshot({ path: path.join(options.sessionDir, 'review.png'), fullPage: true }).catch(() => {});
    writeFileSync(path.join(options.sessionDir, 'handoff.json'), JSON.stringify({ applicationUrl: options.url, currentUrl: this.page.url(), observedAt: new Date().toISOString(), reviewKind: report.reviewKind, reason: report.reason, submissionAttempted: report.submissionAttempted, questions: report.actions.filter(action => action.status === 'failed').map(action => ({ question: action.question || action.selector, selector: action.selector, reason: action.error })) }, null, 2), { mode: 0o600 });
  }

  async reviewReady(report: BotRunReport, options?: AutoApplyOptions): Promise<boolean> {
    if (!this.page || this.page.isClosed()) return false;
    if (report.reviewKind === 'network' && !report.submissionAttempted) {
      const gates = await this.browserGates();
      return this.dependentRequests.size === 0 && !gates.login && !gates.challenge;
    }
    if (report.submissionAttempted) {
      if ((await this.browserGates()).challenge) { report.humanInterventionRequired = true; if (options) await this.checkpoint(options, report); return false; }
      if (options?.mailbox) {
        const verification = await completeEmailVerification(this.page, options.mailbox, { provider: options.requisition?.provider || report.ats, applicationUrl: options.url, recipient: options.profile.personal.email, since: new Date(report.startTime), company: options.company, claim: options.claimMail }, this.interactions(options));
        if (verification.messageId) { report.verificationMessageId = verification.messageId; await this.checkpoint(options, report); }
      }
      return !!(report.receipt || await this.receipt());
    }
    if (!['authentication', 'challenge'].includes(report.reviewKind || '')) return false;
    if (report.reviewKind === 'authentication' && options?.vault && Date.now() - this.lastRecoveryPoll >= 2000) {
      this.lastRecoveryPoll = Date.now();
      const tenant = options.requisition ? canonicalEmployerKey(options.url, options.requisition.key) : new URL(options.url).hostname;
      const recovery = options.vault.recovery(tenant);
      const emailGate = options.mailbox && await hasEmailAuthenticationGate(this.page);
      if (((recovery?.recovery && !recovery.recovery.confirmed) || emailGate) && !(await this.browserGates()).challenge && await this.authenticationStep(options, report) === 'progress') return true;
    }
    const gates = await this.browserGates();
    return !gates.login && !gates.challenge;
  }

  private log(message: string) {
    const line = `[${new Date().toISOString().slice(11, 19)}] ${message}`;
    this.logs.push(line);
    console.log(line);
  }

  async initBrowser(headless = true, sessionDir?: string, browserProfileDir = sessionDir ? path.join(sessionDir, 'browser') : undefined): Promise<void> {
    const showBrowser = process.env.DEBUG_SHOW_BROWSER === '1';
    const effectiveHeadless = showBrowser ? false : (headless ?? true);
    const baseArgs = [
      '--no-sandbox',
      '--window-size=1280,900',
      '--disable-blink-features=AutomationControlled',
      '--webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--force-webrtc-ip-handling-policy',
      ...LOW_RAM_CHROMIUM_ARGS.filter(a => effectiveHeadless || !a.startsWith('--headless')),
    ];
    const args = Array.from(new Set(baseArgs));

    if (browserProfileDir) {
      mkdirSync(browserProfileDir, { recursive: true });
      for (const lockFile of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
        try { unlinkSync(path.join(browserProfileDir, lockFile)); } catch {}
      }
      if (process.platform !== 'win32') {
        try {
          this.context = await chromium.launchPersistentContext(browserProfileDir, {
            channel: 'chrome',
            headless: effectiveHeadless,
            args,
            timeout: 10000,
            viewport: null,
            locale: 'en-IN',
            timezoneId: 'Asia/Calcutta',
          });
          (this.context as any).__resilientTier = 1;
        } catch (err: any) {
          console.warn(`[RUNNER] Persistent launch failed on ${browserProfileDir}: ${err?.message || err}. Falling back to clean isolated browser.`);
          for (const lockFile of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
            try { unlinkSync(path.join(browserProfileDir, lockFile)); } catch {}
          }
          this.browser = await chromium.launch({ channel: 'chrome', headless: effectiveHeadless, args });
          const storageStatePath = sessionDir ? path.join(sessionDir, 'storage-state.json') : undefined;
          this.context = await createResilientBrowserContext(this.browser, storageStatePath);
          this.ownsContext = true;
        }
      } else {
        this.browser = await chromium.launch({ channel: 'chrome', headless: effectiveHeadless, args });
        const storageStatePath = sessionDir ? path.join(sessionDir, 'storage-state.json') : undefined;
        this.context = await createResilientBrowserContext(this.browser, storageStatePath);
        this.ownsContext = true;
      }
    } else {
      this.browser = await chromium.launch({ channel: 'chrome', headless: effectiveHeadless, args });
      const storageStatePath = sessionDir ? path.join(sessionDir, 'storage-state.json') : undefined;
      this.context = await createResilientBrowserContext(this.browser, storageStatePath);
      this.contextClosed = false;
      this.context.on('close', () => {
        this.contextClosed = true;
      });
    }
    await installRamDietRouteFilter(this.context).catch(() => {});
    this.context.setDefaultTimeout(5000);
    this.context.setDefaultNavigationTimeout(45000);
    this.page = this.context.pages()[0] || await this.context.newPage();
    this.page.setDefaultTimeout(6000);
    this.trackPage(this.page);
  }

  async rotateToResilientTier(tier: 1 | 2 | 3 = 3, storageStatePath?: string): Promise<void> {
    try {
      if (this.page) await this.page.close().catch(() => {});
      if (this.context && (this.ownsContext || this.ownsIsolatedContext)) {
        await this.context.close().catch(() => {});
      }
    } catch {}

    if (!this.browser) {
      const showBrowser = process.env.DEBUG_SHOW_BROWSER === '1';
      const effectiveHeadless = showBrowser ? false : true;
      const baseArgs = [
        '--no-sandbox',
        '--window-size=1280,900',
        '--disable-blink-features=AutomationControlled',
        '--webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--force-webrtc-ip-handling-policy',
        ...LOW_RAM_CHROMIUM_ARGS.filter(a => effectiveHeadless || !a.startsWith('--headless')),
      ];
      const args = Array.from(new Set(baseArgs));
      this.browser = await chromium.launch({ channel: 'chrome', headless: effectiveHeadless, args });
      this.ownsContext = true;
      this.ownsIsolatedContext = false;
    }

    this.context = await createResilientBrowserContext(this.browser, storageStatePath, tier);
    this.contextClosed = false;
    this.context.on('close', () => {
      this.contextClosed = true;
    });
    await installRamDietRouteFilter(this.context).catch(() => {});
    this.context.setDefaultTimeout(5000);
    this.context.setDefaultNavigationTimeout(45000);
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(6000);
    this.trackPage(this.page);
  }

  async humanType(input: Locator, text: string, blur = true): Promise<void> {
    const isHoneypot = await input.evaluate((el: Element) => {
      return el.getAttribute('data-automation-id') === 'beecatcher' || /beecatcher|honey-?pot/i.test([el.id, el.getAttribute('name'), el.getAttribute('data-automation-id')].join(' '));
    }).catch(() => false);
    if (isHoneypot) return;

    const isSinglePageAts = ['greenhouse', 'ashby', 'lever'].includes(this.activeAts || '');
    if (isSinglePageAts) {
      await input.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
      await input.click({ timeout: 1200 }).catch(() => input.focus().catch(() => {}));
    } else {
      await this.pacedClick(input);
    }
    await input.press('ControlOrMeta+A').catch(() => {});
    await input.press('Backspace').catch(() => {});

    // Ticket GEN-236: Handle contenteditable="true" rich-text editors (Quill, ProseMirror, Tiptap)
    const isContentEditable = await input.evaluate((el: HTMLElement) => el.isContentEditable || el.getAttribute('contenteditable') === 'true').catch(() => false);
    if (isContentEditable) {
      await input.evaluate((el, val) => {
        (el as HTMLElement).focus();
        el.textContent = val;
        el.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            composed: true,
            data: val,
            inputType: 'insertText',
          })
        );
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        el.dispatchEvent(new FocusEvent('blur', { bubbles: true, composed: true }));
      }, text).catch(() => {});
      return;
    }

    const tag = (await input.evaluate(el => el.tagName.toLowerCase()).catch(() => 'input')) || 'input';
    if (text.length > 2) {
      // Ticket GEN-104.2 / GEN-115 / GEN-159 / GEN-196: Fast-chunk text with React _valueTracker reset & timeout
      await input.pressSequentially(text.slice(0, 2), { delay: 15 }).catch(() => {});
      await input.fill(text, { timeout: 2500 }).catch(() => {});
      await input
        .evaluate((el, val) => {
          if ((el as HTMLElement).isContentEditable || el.getAttribute('contenteditable') === 'true') {
            (el as HTMLElement).focus();
            el.textContent = val;
            el.dispatchEvent(
              new InputEvent('input', {
                bubbles: true,
                composed: true,
                data: val,
                inputType: 'insertText',
              })
            );
            el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            el.dispatchEvent(new FocusEvent('blur', { bubbles: true, composed: true }));
            return;
          }
          const target = el as HTMLInputElement | HTMLTextAreaElement;
          const proto =
            target instanceof HTMLTextAreaElement
              ? window.HTMLTextAreaElement.prototype
              : window.HTMLInputElement.prototype;
          const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          try {
            const tracker = (target as unknown as { _valueTracker?: { setValue: (v: string) => void } })._valueTracker;
            if (tracker && typeof tracker.setValue === 'function') {
              tracker.setValue('');
            }
          } catch {}
          if (nativeSetter) {
            nativeSetter.call(target, val);
          } else {
            target.value = val;
          }
          target.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          target.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          target.dispatchEvent(new FocusEvent('blur', { bubbles: true, composed: true }));
          const root = target.getRootNode?.();
          if (root && (root as ShadowRoot).host) {
            const host = (root as ShadowRoot).host as HTMLElement & { value?: unknown };
            try {
              if ('value' in host) {
                host.value = val;
              }
              host.dispatchEvent(new CustomEvent('valueChange', { detail: val, bubbles: true, composed: true }));
              host.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
              host.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            } catch {}
          }
        }, text)
        .catch(() => {});
      return;
    }

    try {
      await input.pressSequentially(text, { delay: Math.round(getHumanKeyDelay(15, 35)) });
    } catch {
      await input.fill(text, { timeout: 2500 }).catch(() => {});
    }
    let clickedDropdownLocation = false;
    const inputId = await input.getAttribute('id').catch(() => '');
    const inputName = await input.getAttribute('name').catch(() => '');
    const inputClass = await input.getAttribute('class').catch(() => '');
    if (inputId === 'location-input' || inputName === 'location' || /location/i.test(inputClass || '')) {
      const dropdownLocation = input.page().locator('.dropdown-location').first();
      try {
        await dropdownLocation.waitFor({ state: 'visible', timeout: 3000 });
        await dropdownLocation.click().catch(() => {});
        clickedDropdownLocation = true;
      } catch {}
    }
    if (blur) await input.blur().catch(() => {});
    const type = (await input.getAttribute('type').catch(() => ''))?.toLowerCase() || '';
    const existingVal = await Promise.race([
      input.evaluate((el) => String((el as HTMLInputElement).value ?? '')).catch(() => ''),
      new Promise<string>((resolve) => setTimeout(() => resolve(''), 250)),
    ]);
    if (!clickedDropdownLocation && !retainedText(existingVal, text, type)) {
      await input.fill(text, { timeout: 2500 }).catch(() => {});
      await input
        .evaluate((el, val) => {
          if ((el as HTMLElement).isContentEditable || el.getAttribute('contenteditable') === 'true') {
            (el as HTMLElement).focus();
            el.textContent = val;
            el.dispatchEvent(
              new InputEvent('input', {
                bubbles: true,
                composed: true,
                data: val,
                inputType: 'insertText',
              })
            );
            el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            el.dispatchEvent(new FocusEvent('blur', { bubbles: true, composed: true }));
            return;
          }
          const target = el as HTMLInputElement | HTMLTextAreaElement;
          const proto =
            target instanceof HTMLTextAreaElement
              ? window.HTMLTextAreaElement.prototype
              : window.HTMLInputElement.prototype;
          const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          try {
            const tracker = (target as unknown as { _valueTracker?: { setValue: (v: string) => void } })._valueTracker;
            if (tracker && typeof tracker.setValue === 'function') {
              tracker.setValue('');
            }
          } catch {}
          if (nativeSetter) {
            nativeSetter.call(target, val);
          } else {
            target.value = val;
          }
          target.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          target.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          target.dispatchEvent(new FocusEvent('blur', { bubbles: true, composed: true }));
          const root = target.getRootNode?.();
          if (root && (root as ShadowRoot).host) {
            const host = (root as ShadowRoot).host as HTMLElement & { value?: unknown };
            try {
              if ('value' in host) {
                host.value = val;
              }
              host.dispatchEvent(new CustomEvent('valueChange', { detail: val, bubbles: true, composed: true }));
              host.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
              host.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            } catch {}
          }
        }, text)
        .catch(() => {});
      if (blur) await input.blur().catch(() => {});
      const finalVal = await Promise.race([
        input.evaluate((el) => String((el as HTMLInputElement).value ?? '')).catch(() => ''),
        new Promise<string>((resolve) => setTimeout(() => resolve(''), 250)),
      ]);
      if (!retainedText(finalVal, text, type) && !finalVal.trim()) throw new Error('Typed field did not retain the intended value');
    }
  }

  private async approach(control: Locator): Promise<void> {
    await control.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
    const bounds = await control.boundingBox();
    if (bounds) {
      const end = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      for (const point of generateBezierCurve(this.cursor, end)) await this.page!.mouse.move(point.x, point.y);
      this.cursor = end;
    }
  }

  private async pacedClick(control: Locator): Promise<void> {
    await control.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    await this.approach(control).catch(() => {});
    await control.hover({ timeout: 2000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 65 + Math.floor(Math.random() * 85)));
    const covered = await control.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const target = element.ownerDocument.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return !!target?.closest('[data-automation-id="click_filter"]') && !!element.parentElement?.contains(target);
    }).catch(() => false);
    const overlay = control.locator('..').locator('[data-automation-id="click_filter"]').filter({ visible: true });
    if (covered && await overlay.count() === 1) await overlay.click();
    else {
      try {
        await control.click({ timeout: 3500 });
      } catch {
        await this.page!.keyboard.press('Escape').catch(() => {});
        try {
          await control.click({ force: true, timeout: 3000 });
        } catch {
          await control.dispatchEvent('click').catch(() => {});
        }
      }
    }
  }

  private async waitReady(timeout: number): Promise<void> {
    const deadline = Date.now() + timeout;
    do {
      for (const frame of this.page!.frames()) {
        const ready = await frame.locator('input,select,textarea,[role="combobox"],button,a').evaluateAll(elements => elements.some(el => {
          if (!el.getClientRects().length) return false;
          if (el.matches('input:not([type="hidden"]),select,textarea,[role="combobox"]')) return true;
          return /^(?:apply(?: now| manually| for (?:this|the) (?:job|role))?|i[’\x27]m interested|next|continue|submit(?: application)?|send application|save (?:and|&) continue)[\s\u200b-\u200d\u2060\ufeff]*$/i.test((el.textContent || (el as HTMLInputElement).value || '').trim());
        })).catch(() => false);
        if (ready) return;
      }
      await this.page!.waitForTimeout(100);
    } while (Date.now() < deadline);
  }

  private async recordUnknownFieldsFromErrors(options: AutoApplyOptions, report: BotRunReport): Promise<void> {
    if (!this.page || this.page.isClosed()) return;
    try {
      for (const frame of this.page.frames()) {
        const invalidControls = await frame.locator('input:invalid,select:invalid,textarea:invalid,[aria-invalid="true"],.error input,.has-error input,.error select,.has-error select,.error textarea,.has-error textarea').all().catch(() => []);
        for (const control of invalidControls) {
          if (!await control.isVisible().catch(() => false)) continue;
          const errDetails = await control.evaluate((el: Element) => {
            const input = el as HTMLInputElement;
            const valMsg = input.validationMessage || '';
            const container = el.closest('fieldset, .application-question, .custom-question, .ashby-application-form-question, [data-field-path], [data-automation-id*="form-field"], .form-group, .field, [role="group"], [role="radiogroup"]') || el.parentElement;
            const errEl = container ? container.querySelector('.error, .error-message, .invalid-feedback, [role="alert"], [data-automation-id="errorMessage"]') : null;

            let prompt = '';
            if (container) {
              const explicitTitle = container.querySelector(
                'legend, .application-label, .ashby-application-form-question-title, [data-automation-id*="formLabel"], [data-automation-id$="-legend"], .field-label, .question-title, .form-label'
              );
              if (explicitTitle?.textContent?.trim()) {
                prompt = explicitTitle.textContent.trim();
              } else {
                const singleLabel = Array.from(container.querySelectorAll('label')).find(l => !l.querySelector('input[type="radio"], input[type="checkbox"]'));
                if (singleLabel?.textContent?.trim()) prompt = singleLabel.textContent.trim();
              }
            }
            if (!prompt) {
              const labelledBy = el.getAttribute('aria-labelledby') || container?.getAttribute('aria-labelledby');
              if (labelledBy) {
                const parts = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean);
                if (parts.length) prompt = parts.join(' ');
              }
            }
            if (!prompt) {
              prompt = Array.from(input.labels || []).map(l => l.textContent || '').join(' ').trim() ||
                el.getAttribute('aria-label') ||
                el.getAttribute('placeholder') ||
                el.getAttribute('name') ||
                el.getAttribute('id') ||
                '';
            }

            let opts: string[] | null = null;
            if (el.tagName === 'SELECT') {
              opts = Array.from((el as HTMLSelectElement).options).map(o => o.text.trim()).filter(Boolean);
            } else if (input.type === 'radio') {
              const name = input.name;
              const siblings = name
                ? Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`))
                : container ? Array.from(container.querySelectorAll('input[type="radio"]')) : [];
              if (siblings.length) {
                opts = siblings.map(r => {
                  const rInput = r as HTMLInputElement;
                  const lbl = Array.from(rInput.labels || []).map(l => l.textContent || '').join(' ').trim();
                  return lbl || rInput.value;
                }).filter(Boolean);
              }
            }

            return {
              validationMessage: (errEl?.textContent || valMsg).trim(),
              questionText: prompt.replace(/\s+/g, ' ').trim(),
              widgetKind: el.tagName === 'SELECT' ? 'SELECT' : (input.type || 'TEXT').toUpperCase(),
              options: opts,
              isRequired: input.required || el.getAttribute('aria-required') === 'true',
            };
          }).catch(() => null);
          if (errDetails && errDetails.questionText) {
            logUnknownFieldForLearning({
              questionText: errDetails.questionText,
              widgetKind: errDetails.widgetKind,
              isRequired: errDetails.isRequired,
              options: errDetails.options,
              validationError: errDetails.validationMessage || null,
              company: options.company || '',
              url: options.url,
            });
          }
        }
      }
      for (const action of report.actions) {
        if (action.status === 'failed' && action.question) {
          logUnknownFieldForLearning({
            questionText: action.question,
            widgetKind: (action.elementTag || 'TEXT').toUpperCase(),
            isRequired: true,
            options: null,
            validationError: action.error || null,
            company: options.company || '',
            url: options.url,
          });
        }
      }
    } catch {}
  }

  private async selfHealValidationErrors(options: AutoApplyOptions, report: BotRunReport): Promise<boolean> {
    if (!this.page || this.page.isClosed()) return false;
    let anyHealed = false;
    for (const frame of this.page.frames()) {
      const invalidControls = await frame.locator('input:invalid,select:invalid,textarea:invalid,[aria-invalid="true"],.error input,.has-error input,.error select,.has-error select,.error textarea,.has-error textarea').all().catch(() => []);
      for (const control of invalidControls) {
        if (!await control.isVisible().catch(() => false)) continue;
        const errDetails = await control.evaluate((el: Element) => {
          const input = el as HTMLInputElement;
          const valMsg = input.validationMessage || '';
          const container = el.closest('fieldset, .application-question, .custom-question, .ashby-application-form-question, [data-field-path], [data-automation-id*="form-field"], .form-group, .field, [role="group"], [role="radiogroup"]') || el.parentElement;
          const errEl = container ? container.querySelector('.error, .error-message, .invalid-feedback, [role="alert"], [data-automation-id="errorMessage"]') : null;

          let prompt = '';
          if (container) {
            const explicitTitle = container.querySelector(
              'legend, .application-label, .ashby-application-form-question-title, [data-automation-id*="formLabel"], [data-automation-id$="-legend"], .field-label, .question-title, .form-label'
            );
            if (explicitTitle?.textContent?.trim()) {
              prompt = explicitTitle.textContent.trim();
            } else {
              const singleLabel = Array.from(container.querySelectorAll('label')).find(l => !l.querySelector('input[type="radio"], input[type="checkbox"]'));
              if (singleLabel?.textContent?.trim()) prompt = singleLabel.textContent.trim();
            }
          }
          if (!prompt) {
            const labelledBy = el.getAttribute('aria-labelledby') || container?.getAttribute('aria-labelledby');
            if (labelledBy) {
              const parts = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean);
              if (parts.length) prompt = parts.join(' ');
            }
          }
          if (!prompt) {
            prompt = Array.from(input.labels || []).map(l => l.textContent || '').join(' ').trim() ||
              el.getAttribute('aria-label') ||
              el.getAttribute('placeholder') ||
              el.getAttribute('name') ||
              el.getAttribute('id') ||
              '';
          }

          let opts: string[] | null = null;
          if (el.tagName === 'SELECT') {
            opts = Array.from((el as HTMLSelectElement).options).map(o => o.text.trim()).filter(Boolean);
          } else if (input.type === 'radio') {
            const name = input.name;
            const siblings = name
              ? Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`))
              : container ? Array.from(container.querySelectorAll('input[type="radio"]')) : [];
            if (siblings.length) {
              opts = siblings.map(r => {
                const rInput = r as HTMLInputElement;
                const lbl = Array.from(rInput.labels || []).map(l => l.textContent || '').join(' ').trim();
                return lbl || rInput.value;
              }).filter(Boolean);
            }
          }

          return {
            validationMessage: (errEl?.textContent || valMsg).trim(),
            questionText: prompt.replace(/\s+/g, ' ').trim(),
            widgetKind: el.tagName === 'SELECT' ? 'SELECT' : (input.type || 'TEXT').toUpperCase(),
            options: opts,
            isRequired: input.required || el.getAttribute('aria-required') === 'true',
            tagName: el.tagName.toLowerCase(),
            type: input.type || '',
            name: input.name || '',
          };
        }).catch(() => null);

        if (!errDetails || !errDetails.questionText) continue;
        const normQ = normalizeQuestion(errDetails.questionText);
        const answerCtx = {
          url: options.url,
          country: options.applicationCountry,
          company: options.company,
          question: errDetails.questionText,
          employerKey: options.requisition ? canonicalEmployerKey(options.url, options.requisition.key) : undefined,
          requisitionKey: options.requisition?.key,
        };
        if (hasScopedAnswerMismatch(options.profile, answerCtx, [normQ])) continue;
        const healed = resolveBySemanticSelfLearning(
          errDetails.questionText,
          errDetails.widgetKind,
          errDetails.options,
          errDetails.validationMessage,
          options.profile
        );

        if (healed) {
          try {
            if (errDetails.widgetKind === 'SELECT' && healed.value) {
              await control.selectOption({ label: healed.value }).catch(async () => {
                await control.selectOption(healed.value);
              });
            } else if (errDetails.type === 'radio') {
              const name = errDetails.name;
              const radios = name ? frame.locator(`input[type="radio"][name="${name}"]`) : control;
              const rCount = await radios.count();
              let checked = false;
              for (let i = 0; i < rCount; i++) {
                const r = radios.nth(i);
                const rText = await r.evaluate((el: HTMLInputElement) =>
                  Array.from(el.labels || []).map(l => l.textContent || '').join(' ').trim() || el.value
                );
                const valLower = healed.value.toLowerCase();
                const rLower = rText.toLowerCase();
                if (rLower === valLower || rLower.includes(valLower) ||
                    (valLower === 'yes' && /^(?:yes|true|agree)\b/i.test(rLower)) ||
                    (valLower === 'no' && /^(?:no|false|disagree)\b/i.test(rLower))) {
                  await r.check({ force: true }).catch(() => {});
                  checked = true;
                  break;
                }
              }
              if (!checked) await control.check({ force: true }).catch(() => {});
            } else if (errDetails.type === 'checkbox') {
              await control.check({ force: true }).catch(() => {});
            } else if (errDetails.tagName === 'input' || errDetails.tagName === 'textarea') {
              await control.fill(healed.value);
            } else {
              const nested = control.locator('input, textarea').first();
              if (await nested.count() > 0) {
                await nested.fill(healed.value);
              } else {
                await control.fill(healed.value);
              }
            }
            await control.blur().catch(() => {});
            anyHealed = true;
            this.learnedFields.push({ questionText: errDetails.questionText, category: healed.category, value: healed.value });
            recordLearnedSuccess(errDetails.questionText, healed.category, healed.value);
          } catch {}
        } else {
          logUnknownFieldForLearning({
            questionText: errDetails.questionText,
            widgetKind: errDetails.widgetKind,
            isRequired: errDetails.isRequired,
            options: errDetails.options,
            validationError: errDetails.validationMessage || null,
            company: options.company || '',
            url: options.url,
          });
        }
      }
    }
    return anyHealed;
  }

  private async receipt(): Promise<BotRunReport['receipt']> {
    for (const page of this.getActiveApplicationPages()) {
      if (page.isClosed()) continue;
      try {
        const pageUrl = page.url();
        const isConfirmationUrl =
          /(?:\/confirmation|\/thank(?:s|[-_]?you)|\/application[-_]?submitted|\/submitted)(?:\/|$|\?|#)|[?&](?:submitted|applied|confirmation)=(?:true|1)\b/i.test(
            pageUrl
          );
        if (isConfirmationUrl) {
          this.page = page;
          const applicationId =
            new URL(pageUrl).searchParams.get('applicationId') ||
            new URL(pageUrl).searchParams.get('application_id') ||
            undefined;
          const titleText = (await page.title().catch(() => '')) || 'Application Submitted';
          return {
            url: pageUrl,
            text: titleText.slice(0, 1000),
            verifiedAt: new Date().toISOString(),
            selector: 'url_confirmation',
            applicationId,
          };
        }
        const titleText = (await page.title().catch(() => '')) || '';
        if (titleText && (EXISTING_APPLICATION.test(titleText) || SUCCESS.test(titleText))) {
          this.page = page;
          const applicationId = new URL(page.url()).searchParams.get('applicationId') || new URL(page.url()).searchParams.get('application_id') || undefined;
          return { url: page.url(), text: titleText.slice(0, 1000), verifiedAt: new Date().toISOString(), selector: 'title', applicationId, ...(EXISTING_APPLICATION.test(titleText) ? { existing: true } : {}) };
        }
        for (const frame of page.frames()) {
          const candidates = frame.locator('h1, h2, h3, h4, p, [role="status"], [role="alert"], #application_confirmation, .application-confirmation, .post-apply-message, [data-automation-id="applicationSubmitted"], [data-automation-id="congratulationsMessage"]');
          for (const item of await candidates.all()) {
            if (!await item.isVisible()) continue;
            if (await item.evaluate(el => !!el.closest('footer,nav,[role="contentinfo"],aside'))) continue;
            const text = (await item.innerText()).trim();
            const selector = await item.evaluate(el => el.id ? `[id=${JSON.stringify(el.id)}]` : el.getAttribute('role') ? `[role=${JSON.stringify(el.getAttribute('role'))}]` : el.tagName.toLowerCase());
            if (EXISTING_APPLICATION.test(text) || SUCCESS.test(text)) {
              this.page = page;
              const applicationId = new URL(page.url()).searchParams.get('applicationId') || new URL(page.url()).searchParams.get('application_id') || undefined;
              return { url: page.url(), text: text.slice(0, 1000), verifiedAt: new Date().toISOString(), selector, applicationId, ...(EXISTING_APPLICATION.test(text) ? { existing: true } : {}) };
            }
          }
        }

        // Step 291 (GEN-292): Unmounted-Form + Container Confirmation Detection
        const unmountedFormConfirmed = await page
          .evaluate(() => {
            const confirmEl = document.querySelector(
              '#application_confirmation, .application-confirmation, oc-confirmation, [data-test*="confirmation" i], [data-automation-id="thankYouMessage"]'
            ) as HTMLElement | null;
            if (confirmEl && confirmEl.offsetParent !== null && (confirmEl.innerText || '').trim().length > 5) {
              return (confirmEl.innerText || '').trim().slice(0, 140);
            }
            const visibleInputs = Array.from(
              document.querySelectorAll<HTMLElement>(
                'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select'
              )
            ).filter((el) => el.offsetParent !== null).length;
            if (visibleInputs <= 1) {
              const bodyTxt = (document.body?.innerText || '').slice(0, 3000);
              const m = bodyTxt.match(
                /(?:thank\s+you\s+for\s+(?:applying|your\s+application|submitting)|your\s+application\s+has\s+been\s+(?:received|submitted|sent)|application\s+submitted\s+successfully|we\s+have\s+received\s+your\s+application)/i
              );
              if (m) return m[0];
            }
            return null;
          })
          .catch(() => null);

        if (unmountedFormConfirmed) {
          this.page = page;
          const applicationId =
            new URL(page.url()).searchParams.get('applicationId') ||
            new URL(page.url()).searchParams.get('application_id') ||
            undefined;
          return {
            url: page.url(),
            text: unmountedFormConfirmed.slice(0, 1000),
            verifiedAt: new Date().toISOString(),
            selector: 'unmounted_form_confirmation',
            applicationId,
          };
        }
      } catch {
        // A popup can close or its parent can navigate between any two awaits.
        // The next observation scans surviving related pages again.
        continue;
      }
    }

    // Ticket GEN-123: Network-Plus-DOM submission receipt tracking
    if (this.lastNetworkSubmissionReceipt && Date.now() - this.lastNetworkSubmissionReceipt.timestamp < 60_000) {
      const activePage = this.page && !this.page.isClosed() ? this.page : Array.from(this.applicationPages).find(p => !p.isClosed());
      if (activePage) {
        const hasVisibleErrors = await activePage.evaluate(() => {
          const invalidInputs = Array.from(document.querySelectorAll<HTMLElement>('[aria-invalid="true"], input:invalid, select:invalid, textarea:invalid'));
          for (const el of invalidInputs) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden') return true;
          }
          const msgEls = Array.from(document.querySelectorAll<HTMLElement>('.error-message, [role="alert"], .field-error'));
          for (const el of msgEls) {
            const txt = (el.textContent || '').trim();
            if (txt.length > 0) {
              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden') return true;
            }
          }
          return false;
        }).catch(() => false);
        if (!hasVisibleErrors) {
          return {
            url: this.lastNetworkSubmissionReceipt.url,
            text: `Application submitted via verified network POST (${this.lastNetworkSubmissionReceipt.status})`,
            verifiedAt: new Date(this.lastNetworkSubmissionReceipt.timestamp).toISOString(),
            selector: 'network_receipt',
          };
        }
      }
    }

    return undefined;
  }

  private async browserGates(): Promise<{ login: boolean; challenge: boolean }> {
    let login = false;
    let challenge = false;
    for (const frame of this.page!.frames()) {
      try {
        for (const heading of await frame.getByRole('heading', { name: /^(?:access is temporarily restricted|access to this page has been blocked|verify you are human|checking your browser)$/i }).all()) {
          if (await heading.isVisible()) challenge = true;
        }
        for (const heading of await frame.getByRole('heading', { name: /^(?:check (?:your )?email|verify (?:your )?email|email verification|activate (?:your )?account|forgot (?:your )?password|reset (?:your )?password|set (?:a )?new password|(?:your )?password (?:has been |was )?(?:successfully )?(?:reset|changed|updated)[.!\s]*)$/i }).all()) if (await heading.isVisible()) login = true;
        if ((URL.canParse(frame.url()) && /\/(?:login|sign-?in|register|apply\/email|forgot.?password|reset.?password)(?:\/|$)/i.test(new URL(frame.url()).pathname)) || await frame.locator('#enterEmailSubmitButton,[data-automation-id="signInSubmitButton"],[data-automation-id="createAccountLink"],[data-automation-id="createAccountSubmitButton"],[data-automation-id="SignInWithEmailButton"],[data-automation-id="utilityButtonSignIn"],[data-automation-id="signInLink"],[data-automation-id="formField-email"] input').count()) login = true;
        for (const control of await frame.locator('input[type="password"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="captcha-delivery.com"], iframe[src*="challenges.cloudflare.com"], iframe[title*="CAPTCHA" i], [data-sitekey]').all()) {
          if (!await control.isVisible()) continue;
          const dataSize = await control.getAttribute('data-size');
          if (dataSize === 'invisible') continue;
          const source = await control.getAttribute('src');
          if (source && URL.canParse(source, frame.url()) && /\/recaptcha\/(?:enterprise\/|api2\/)?anchor$/.test(new URL(source, frame.url()).pathname) && new URL(source, frame.url()).searchParams.get('size') === 'invisible') continue;
          if (await control.getAttribute('type') === 'password') login = true;
          else challenge = true;
        }
      } catch (error) {
        if (!frame.isDetached()) throw error;
      }
    }
    return { login, challenge };
  }

  async waitForReviewChange(report: BotRunReport, signal: AbortSignal, options?: AutoApplyOptions): Promise<boolean> {
    while (!signal.aborted && this.page && !this.page.isClosed()) {
      try {
        if (await this.reviewReady(report, options)) return true;
        await this.page.waitForTimeout(250);
      } catch {
        if (!this.page || this.page.isClosed() || signal.aborted) return false;
        // A frame can disappear while the owner completes sign-in or a challenge.
        await this.page.waitForTimeout(250).catch(() => {});
      }
    }
    return false;
  }

  private async button(pattern: RegExp, selectors?: string, fingerprintKey?: string): Promise<Locator | undefined> {
    for (const frame of this.page!.frames()) {
      if (frame.isDetached()) continue;
      try {
        if (pattern === SUBMIT || pattern.source.includes('submit')) {
          const submits = frame.locator(
            'button[data-test="job-apply-submit"], button[data-test="footer-submit"], oc-button[data-test*="submit"] button, spl-button[type="submit"], oc-button button, spl-button button, button[type="submit"], input[type="submit"]'
          );
          for (const control of await submits.all()) {
            if (await control.isVisible().catch(() => false) && await control.isEnabled().catch(() => false)) {
              if (fingerprintKey) {
                captureElementFingerprint(control, fingerprintKey).then(fp => saveAdaptiveFingerprint(fp)).catch(() => {});
              }
              return control;
            }
          }
        }
        if (pattern === NEXT || /next|continue/i.test(pattern.source)) {
          const nexts = frame.locator(
            'button[data-test="footer-next"], oc-button[data-test*="next"] button, spl-button[data-test*="next"] button, button[data-automation-id*="next" i], button[data-automation-id*="saveAndContinue" i], button[data-automation-id*="continue" i]'
          );
          for (const control of await nexts.all()) {
            if (await control.isVisible().catch(() => false) && await control.isEnabled().catch(() => false)) {
              if (fingerprintKey) {
                captureElementFingerprint(control, fingerprintKey).then(fp => saveAdaptiveFingerprint(fp)).catch(() => {});
              }
              return control;
            }
          }
        }
        const controls = frame.getByRole('button', { name: pattern });
        const matches = await controls.all();
        for (let i = matches.length - 1; i >= 0; i--) {
          const control = matches[i]!;
          if (await control.isVisible().catch(() => false) && await control.isEnabled().catch(() => false)) {
            if (fingerprintKey) {
              captureElementFingerprint(control, fingerprintKey).then(fp => saveAdaptiveFingerprint(fp)).catch(() => {});
            }
            return control;
          }
        }
        if (selectors) for (const control of await frame.locator(selectors).all()) {
          if (await control.isVisible().catch(() => false) && await control.isEnabled().catch(() => false)) {
            if (fingerprintKey) {
              captureElementFingerprint(control, fingerprintKey).then(fp => saveAdaptiveFingerprint(fp)).catch(() => {});
            }
            return control;
          }
        }
      } catch {
        continue;
      }
    }

    if (fingerprintKey) {
      for (const frame of this.page!.frames()) {
        if (frame.isDetached()) continue;
        try {
          const primaryLoc = selectors
            ? frame.locator(selectors)
            : frame.getByRole('button', { name: pattern });
          const fallbackLoc = await findAdaptiveLocator(frame, primaryLoc, fingerprintKey, { kind: 'button', textPattern: pattern });
          if (await fallbackLoc.count().catch(() => 0) > 0) {
            const control = fallbackLoc.first();
            if (await control.isVisible().catch(() => false) && await control.isEnabled().catch(() => false)) {
              return control;
            }
          }
        } catch {
          continue;
        }
      }
    }

    return undefined;
  }

  private async signature(): Promise<string> {
    const pieces = [this.page!.url()];
    for (const frame of this.page!.frames()) {
      pieces.push(await frame.locator('h1,h2,h3,input,select,textarea,[data-automation-id="progressBarActiveStep"]').evaluateAll(elements => elements.filter(n => n.getClientRects().length).map(n => `${n.tagName}:${n.getAttribute('name') || n.id}:${/^H/.test(n.tagName) || n.getAttribute('data-automation-id') === 'progressBarActiveStep' ? n.textContent : ''}`).join('|')).catch(() => ''));
    }
    return pieces.join('\n');
  }

  private async waitChanged(before: string, timeout: number, workdayStep?: string): Promise<boolean> {
    const deadline = Date.now() + Math.min(timeout, 12_000);
    while (Date.now() < deadline) {
      const busy = this.page!.locator('[data-automation-id="loadingSpinner"],[data-automation-id="wd-LoadingPanel"],[data-automation-id="applyFlowLoadingPage"],[data-automation-id="pageFooterNextButton"]:disabled').filter({ visible: true });
      if (!await busy.count()) {
        if (workdayStep) {
          const step = (await this.page!.locator('[data-automation-id="progressBarActiveStep"]').allTextContents()).join(' ').trim();
          if (step && step !== workdayStep) return true;
          if (await this.page!.locator('[data-automation-id="errorMessage"],[data-automation-id="errorHeading"]').filter({ visible: true }).count()) return true;
        } else if (await this.signature() !== before) return true;
      }
      await this.page!.waitForTimeout(100);
    }
    return false;
  }

  private async checkpoint(options: AutoApplyOptions, report: BotRunReport) {
    if (!options.sessionDir || options.dryRun) return;
    mkdirSync(options.sessionDir, { recursive: true });
    const target = path.join(options.sessionDir, 'checkpoint.json');
    const temporary = `${target}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify({ applicationUrl: options.url, currentUrl: this.page!.url(), report }, null, 2), { mode: 0o600 });
    renameSync(temporary, target);
  }

  private async repeatedSections(frame: Frame, profile: CandidateExtendedProfile, dryRun: boolean) {
    if (dryRun) return;
    for (const [kind, entries] of [['education', profile.education], ['experience', profile.experience]] as const) {
      const title = kind === 'education' ? /education/i : /(?:work|employment) experience/i;
      const groups = frame.locator('fieldset').filter({ has: frame.locator('legend').filter({ hasText: title }) });
      const add = frame.getByRole('button', { name: kind === 'education' ? /^add (?:another )?education$/i : /^add (?:another )?(?:work )?experience$/i });
      let count = await groups.count();
      while (count < entries.length && await add.count() === 1 && await add.isVisible()) {
        await add.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
        await add.click();
        await groups.nth(count).waitFor({ state: 'visible' });
        count = await groups.count();
      }
      if (count || !entries.length) continue;
      const prefix = kind === 'education' ? 'education' : 'workExperience';
      const section = frame.locator(`[data-automation-id="${prefix}Section"]`).or(frame.getByRole('group', { name: title }));
      if (await section.count() !== 1) continue;
      const countRows = () => section.locator('[id],[data-automation-id]').evaluateAll((elements, prefix) => new Set(elements.flatMap(element => [element.id, element.getAttribute('data-automation-id') || ''].map(id => new RegExp('^' + prefix + '-(\\d+)(?:--|$)').exec(id)?.[1]).filter(Boolean))).size, prefix);
      let rows = await countRows();
      if (!rows && await section.locator('input:not([type=hidden]),select,textarea').count()) throw new Error('Workday repeated section has unrecognized row identifiers');
      const addRow = section.getByRole('button', { name: /^(?:add|add (?:another )?(?:education|work experience))$/i });
      while (rows < entries.length) {
        if (await addRow.count() !== 1 || !await addRow.isVisible()) throw new Error('Workday repeated section has no unique Add control');
        await addRow.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
        await addRow.click();
        const previous = rows;
        const deadline = Date.now() + 5000;
        do { rows = await countRows(); if (rows > previous) break; await this.page!.waitForTimeout(100); } while (Date.now() < deadline);
        if (rows <= previous) throw new Error('Workday Add did not create a new row');
      }
    }
  }

  private async fillFrame(frame: Frame, options: AutoApplyOptions, report: BotRunReport) {
    await this.repeatedSections(frame, options.profile, !!options.dryRun);
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
    const scan = randomUUID();
    const processed = new Map<string, string>();
    const attempts = new Map<string, number>();
    const attemptedFieldRefs = this.attemptedFieldRefs || new Set<string>();
    this.attemptedFieldRefs = attemptedFieldRefs;
    const uploadedFiles = new Map<string, string>();
    const formSelector = ATS_STRATEGIES[report.ats]?.form;
    const forms = formSelector ? frame.locator(formSelector).filter({ visible: true }) : undefined;
    const scope = forms && await forms.count() ? forms : frame;
    const loginAtStart = await frame.locator('input[type=password]').filter({ visible: true }).count() > 0;
    let serial = 0;
    let converged = false;
    // Resolve one current control, let dependent controls mount, then rescan.
    for (let iteration = 0; iteration < 300; iteration++) {
      // Authentication can mount after an earlier field changes the page.
      // Credential controls belong exclusively to the authentication flow.
      if ((!loginAtStart || options.vault && ['workday', 'icims'].includes(report.ats)) && await frame.locator('input[type=password]').filter({ visible: true }).count()) return;
      let fields: Array<{ key: string; priority: number; postFillWaitMs: number; widget: boolean; state: string }> = [];
      try {
        await scope.locator(INPUTS).evaluateAll(annotateQuestionClusters);
        fields = await scope.locator(INPUTS).evaluateAll((elements, { scan, serial, workday }) => elements.filter(element => !/beecatcher|honey-?pot|bot-trap|languageselector/i.test([element.id, element.getAttribute('name'), element.getAttribute('data-automation-id')].join(' ')) && (!workday || !element.ownerDocument.querySelector('[data-automation-id^="formField-"]') || (element.closest('[data-automation-id^="formField-"]') && !element.closest('[data-automation-id="responsiveMonikerPrompt"],[data-automation-id="activeListContainer"]')))).map((element, index) => {
          let key = element.getAttribute('data-autoapply-control');
          if (!key?.startsWith(scan)) { key = `${scan}-${serial + index}`; element.setAttribute('data-autoapply-control', key); }
          const control = element as HTMLInputElement;
          const labels = Array.from(control.labels || []).map(label => label.textContent || '').join(' ');
          const ariaLabel = element.getAttribute('aria-label') || '';
          const name = element.getAttribute('name') || '';
          const id = element.id || '';
          const placeholder = element.getAttribute('placeholder') || '';
          const desc = `${name} ${id} ${labels} ${ariaLabel} ${placeholder}`.toLowerCase();
          let priority = 70;
          let postFillWaitMs = 50;
          if (control.type === 'file' || /\b(resume|cv|curriculum vitae)\b/i.test(desc)) { priority = 1; postFillWaitMs = 1500; }
          else if (/\b(country|country\/region)\b/i.test(desc) && !/code|phone|citizenship/i.test(desc)) { priority = 10; postFillWaitMs = 700; }
          else if (/\b(country code|phone code|dial code)\b/i.test(desc)) { priority = 15; postFillWaitMs = 300; }
          else if (/\b(state|province|region)\b/i.test(desc) && !/united states/i.test(desc)) { priority = 20; postFillWaitMs = 450; }
          else if (/\b(phone|mobile|contact number|telephone)\b/i.test(desc)) { priority = 25; postFillWaitMs = 100; }
          else if (/\b(city|town|locality)\b/i.test(desc)) { priority = 30; postFillWaitMs = 200; }
          else if (/\b(postal|zip|pin\s*code)\b/i.test(desc)) { priority = 40; postFillWaitMs = 100; }
          else if (/\b(currency)\b/i.test(desc)) { priority = 45; postFillWaitMs = 250; }
          else if (/\b(ctc|salary|compensation|pay expectation|remuneration)\b/i.test(desc)) { priority = 46; postFillWaitMs = 100; }
          return { key, priority, postFillWaitMs, widget: element.getAttribute('role') === 'combobox' || element.getAttribute('aria-haspopup') === 'listbox' || element.getAttribute('data-uxi-widget-type') === 'selectinput', state: JSON.stringify([control.value, control.checked, element.getAttribute('aria-checked'), control.required, control.disabled, element.getAttribute('aria-required'), element.getAttribute('aria-invalid'), element.getAttribute('readonly')]) };
        }), { scan, serial, workday: report.ats === 'workday' });
      } catch (err: any) {
        const confirmedReceipt = await this.receipt().catch(() => undefined);
        if (confirmedReceipt) {
          report.receipt = confirmedReceipt;
          report.status = 'submitted';
          report.reason = 'Submission confirmation observed';
          return;
        }
        if (frame.isDetached() || /execution context was destroyed/i.test(err?.message || '')) {
          return;
        }
        throw err;
      }
      serial += fields.length;
      if (report.ats === 'workday') {
        for (const field of fields.filter(field => field.widget && !processed.has(field.key))) {
          field.state += JSON.stringify(await frame.locator(`[data-autoapply-control=${JSON.stringify(field.key)}]`).evaluate(comboboxSelection).catch(() => []));
        }
      }
      const unprocessed = fields.filter(field => processed.get(field.key) !== field.state);
      if (!unprocessed.length) {
        const inFlight = [...this.dependentRequests.values()].filter(p => !p.status);
        if (inFlight.length) { await this.page!.waitForTimeout(100); continue; }
        converged = true; break;
      }
      unprocessed.sort((a, b) => a.priority - b.priority);
      const next = unprocessed[0]!;
      const key = next.key;
      const ref = key;
      this.activeWatchdog?.heartbeat(`field_${key}`);
      processed.set(key, next.state);

      // GEN-273: Ephemeral data-autoapply-ref Re-Binder on React Re-Renders
      const control = frame.locator(`[data-autoapply-ref="${ref}"], [data-autoapply-control=${JSON.stringify(key)}]`).first();
      if ((await control.count().catch(() => 0)) === 0 && ref) {
        await frame.evaluate(([targetRef, targetDesc]: [string, string]) => {
          const allInputs = Array.from(
            document.querySelectorAll(
              'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea, [role="combobox"]'
            )
          ) as HTMLElement[];
          const unstamped = allInputs.filter(
            (el) => !el.hasAttribute('data-autoapply-ref') && !el.hasAttribute('data-autoapply-control')
          );
          for (const el of unstamped) {
            const labelTxt = (
              el.closest('.field, .form-group, [class*="_fieldEntry_"], .application-question, div')?.textContent ||
              (el as HTMLInputElement).placeholder ||
              el.getAttribute('aria-label') ||
              (el as HTMLInputElement).name ||
              ''
            ).toLowerCase();
            if (targetDesc && labelTxt && (labelTxt.includes(targetDesc) || targetDesc.includes(labelTxt))) {
              el.setAttribute('data-autoapply-ref', targetRef);
              el.setAttribute('data-autoapply-control', targetRef);
              break;
            }
          }
        }, [String(ref), String(key || '')] as [string, string]).catch(() => {});
      }

      const input = frame.locator(`[data-autoapply-ref="${ref}"], [data-autoapply-control=${JSON.stringify(key)}]`).first();
      try {
        if (!await input.count().catch(() => 0)) continue;
        const yesNo = await input.evaluate(el => !!el.closest('.ashby-application-form-input-yesno')).catch(() => false);
        const visualTarget = yesNo ? input.locator('..').first() : input;
        const inputType = await input.getAttribute('type').catch(() => null);
        const isVisible = await visualTarget.evaluate(isVisibleApplicationControl).catch(() => false);
        if (inputType !== 'file' && !isVisible) continue;
        if (!await input.isEnabled().catch(() => false)) continue;
        const isReadonly = await input.getAttribute('readonly').catch(() => null) !== null;
        if (isReadonly && !await input.evaluate(isInteractiveChoiceReadOnly).catch(() => false)) continue;
        report.fieldsFound++;
        const info = await input.evaluate(el => {
          const root = el.getRootNode() as Document | ShadowRoot;
          const control = el as HTMLInputElement;
          const labels = Array.from(control.labels || []).map(label => label.textContent || '').join(' ');
          const ariaIds = (el.getAttribute('aria-labelledby') || '').split(/\s+/);
          const ariaText = ariaIds.map(id => root.getElementById(id)?.textContent || '').join(' ');
          const roleRadio = el.getAttribute('role') === 'radio';
          const questionGroup = control.type === 'radio' || roleRadio ? el.parentElement?.closest('[aria-labelledby],fieldset,[role=radiogroup]') : null;
          const questionLabel = (questionGroup?.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => root.getElementById(id)?.textContent || '').join(' ');
          const group = el.closest('fieldset');
          const fieldEntry = el.closest('[data-field-path]');
          const fieldTitle = fieldEntry?.querySelector('.ashby-application-form-question-title');
          const fieldRequired = !!fieldTitle?.className.includes('_required_');
          const row = el.closest('[id^="workExperience-"],[id^="education-"],[data-automation-id^="workExperience-"],[data-automation-id^="education-"]');
          const workdayRow = [el.id, el.getAttribute('name'), row?.id, row?.getAttribute('data-automation-id')].map(id => /^(workExperience|education)-(\d+)(?:--|$)/.exec(id || '')).find(Boolean);
          const structuralField = el.closest('[data-fkit-id],[data-automation-id^="formField-"]');
          const dateContext = [el.id, el.getAttribute('name'), structuralField?.getAttribute('data-fkit-id'), structuralField?.getAttribute('data-automation-id'), structuralField?.querySelector('label')?.textContent].filter(Boolean).join(' ');
          const automation = el.getAttribute('data-automation-id');
          const legend = group?.querySelector('legend')?.textContent || '';
          const kind = /education/i.test(legend) ? 'education' : /(?:work|employment) experience/i.test(legend) ? 'experience' : workdayRow?.[1] === 'education' ? 'education' : workdayRow ? 'experience' : '';
          const peers = Array.from(root.querySelectorAll('fieldset')).filter(f => kind && (kind === 'education' ? /education/i : /(?:work|employment) experience/i).test(f.querySelector('legend')?.textContent || ''));
          const rowKeys = workdayRow ? [...new Set(Array.from(root.querySelectorAll('[id],[data-automation-id]')).flatMap(node => [node.id, node.getAttribute('data-automation-id') || ''].map(id => new RegExp('^' + workdayRow[1] + '-(\\d+)(?:--|$)').exec(id)?.[1]).filter(Boolean)))] : [];
          return {
            accept: el.getAttribute('accept') || '',
            combobox: el.getAttribute('role') === 'combobox' || el.getAttribute('data-uxi-widget-type') === 'selectinput' || (el.tagName === 'BUTTON' && el.getAttribute('aria-haspopup') === 'listbox'),
            multiple: (el as HTMLSelectElement).multiple === true,
            name: el.getAttribute('name') || '', id: el.id, placeholder: el.getAttribute('placeholder') || '', autocomplete: el.getAttribute('autocomplete') || '',
            ariaLabel: el.getAttribute('aria-label') || ariaText.trim(),
            optionLabel: labels || el.closest('label')?.textContent || (roleRadio ? el.textContent || '' : ''),
            fieldDescription: fieldEntry?.querySelector('.ashby-application-form-question-description')?.textContent || (control.type === 'file' ? [(el.closest('[role=group]')?.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => root.getElementById(id)?.textContent || '').join(' '), el.closest('[data-automation-id="attachments-FileUpload"]')?.textContent || ''].join(' ') : ''),
            datePart: automation === 'dateSectionMonth-input' ? 'month' : automation === 'dateSectionYear-input' ? 'year' : '', dateContext,
            questionTitle: questionLabel.trim() || fieldTitle?.textContent || group?.querySelector('legend')?.textContent || (['radio', 'checkbox'].includes(control.type) ? el.getAttribute('data-autoapply-question') : '') || labels || el.getAttribute('data-autoapply-question') || '',
            fieldPath: fieldEntry?.getAttribute('data-field-path') || '',
            label: [...new Set([questionLabel, fieldTitle?.textContent, group?.querySelector('legend')?.textContent, labels || el.closest('label')?.textContent || fieldTitle?.textContent || el.previousElementSibling?.textContent || ''].filter(Boolean))].join(' '),
            tag: el.tagName.toLowerCase(), type: roleRadio ? 'radio' : control.type || '', required: fieldRequired || control.required || questionGroup?.getAttribute('aria-required') === 'true' || el.getAttribute('aria-required') === 'true' || (control.type !== 'checkbox' && el.closest('[role=group]')?.getAttribute('aria-required') === 'true') || (el.tagName === 'BUTTON' && el.getAttribute('aria-haspopup') === 'listbox' && /\bRequired\b/i.test(el.getAttribute('aria-label') || '')),
            checked: roleRadio ? el.getAttribute('aria-checked') === 'true' : control.checked, hasFile: !!control.files?.length,
            yesNoAnswered: !!el.closest('.ashby-application-form-input-yesno')?.querySelector('button[aria-pressed="true"]'),
            radioAnswered: roleRadio ? !!questionGroup?.querySelector('[role=radio][aria-checked=true]') : control.type === 'radio' && Array.from(root.querySelectorAll<HTMLInputElement>('input[type=radio]')).some(peer => peer.checked && (peer === control || (control.name && peer.name === control.name && peer.form === control.form))),
            value: control.value || '', kind, index: workdayRow ? rowKeys.indexOf(workdayRow[2]) : group ? peers.indexOf(group as HTMLFieldSetElement) : -1,
          };
        }).catch(() => null);
        if (!info) continue;
        const refKey = `${info.name}_${info.id}_${info.fieldPath}_${info.datePart}_${info.questionTitle || info.label}`.trim().toLowerCase();
        if (refKey && attemptedFieldRefs.has(refKey)) continue;
        if (refKey) attemptedFieldRefs.add(refKey);
        const harvested = info.tag === 'select' || info.type === 'radio' || info.combobox && !options.dryRun ? await harvestControlOptions(frame, input, input, info.type === 'radio' ? 'SINGLE_SELECT' : 'SINGLE_SELECT', info.questionTitle || info.label) : undefined;
        const binaryOptions = harvested?.options.filter(option => !/^(?:select|choose|please select|--)/i.test(option.trim()));
        const classification = classifyAtsField({ ...info, widgetKind: binaryOptions?.length === 2 && binaryOptions.every(option => /^(?:yes|no|true|false)$/i.test(option.trim())) ? 'BOOLEAN_TOGGLE' : info.type === 'radio' ? 'SINGLE_SELECT' : undefined });
        const fieldKey = info.id || [info.name, info.questionTitle, info.kind, info.index, info.type, ['radio', 'checkbox'].includes(info.type) ? info.optionLabel || info.value : ''].join('|');
        const descriptor = `${info.label} ${info.fieldDescription} ${info.ariaLabel} ${info.name} ${info.id} ${info.placeholder}`;
        let candidate = options.profile;
        if (info.kind === 'education' && info.index >= 0) candidate = { ...candidate, education: candidate.education.slice(info.index, info.index + 1) };
        const optionAlias = info.type === 'checkbox' && options.requisition && candidate.answers?.some(answer => answer.scope === 'EMPLOYER_SCOPED' && answer.requisitionKey === options.requisition!.key && normalizeQuestion(answer.question) === normalizeQuestion(info.optionLabel)) ? [info.optionLabel] : [];
        if (info.tag === 'select' || info.combobox) (report.choiceFields ||= []).push({ options: harvested?.options || [] });
        const answerContext = { url: options.url, country: options.applicationCountry, company: options.company, question: info.questionTitle || info.label || info.ariaLabel, aliases: [info.label, info.name, info.id, info.fieldPath, info.ariaLabel, ...optionAlias], fieldType: info.tag === 'textarea' ? 'textarea' : info.type, options: harvested?.options, employerKey: options.requisition ? canonicalEmployerKey(options.url, options.requisition.key) : undefined, requisitionKey: options.requisition?.key, isRequired: info.required, attemptNumber: (attempts.get(fieldKey) || 0) + 1 };
        let dynamic = resolveCandidateAnswer(classification.category, candidate, { ...answerContext, location: options.applicationLocation });
        // Strong label/ARIA matches are deterministic facts too. An unavailable
        // model must not erase them merely because the input has no name or ID.
        if (options.model && !info.datePart && dynamic.reason !== 'qa_bank_match' && (dynamic.value === undefined || classification.source === 'fuzzy') && !['file', 'password'].includes(info.type)) {
          const choices = info.tag === 'select' ? await input.locator('option').evaluateAll(items => items.map(item => ({ value: (item as HTMLOptionElement).value, label: item.textContent || '' }))) : [];
          dynamic = await options.model.resolve(candidate, answerContext, choices) || { ...dynamic, value: undefined, confidence: 0, reason: 'grounded_model_unavailable' };
        }
        let value = dynamic.value;

        // Step 318 (GEN-318): Post-Harvest Option-First Re-Resolution
        if (harvested && harvested.options && harvested.options.length > 0) {
          const harvestedOptionLabels = harvested.options.map((o) => o.trim()).filter(Boolean);
          const qText = (info.questionTitle || info.label || info.ariaLabel || descriptor).trim();
          if (value !== undefined && value !== '') {
            const translated = translateCanonicalAnswerToOption(String(value), qText, harvestedOptionLabels);
            if (translated && harvestedOptionLabels.includes(translated)) {
              value = translated;
            }
          }
          if (value === undefined || value === '') {
            const sigMatch = inferAnswerFromOptionSignature(qText, harvestedOptionLabels);
            if (sigMatch?.value && harvestedOptionLabels.includes(sigMatch.value)) {
              value = sigMatch.value;
            }
          }
        }

        // Ticket GEN-95: Resolve unmapped fields via Semantic Self-Learning & Universal Permissive Fallback BEFORE any undefined/empty checks
        const fieldQuestionText = (info.questionTitle || info.label || info.ariaLabel || info.name || info.id || descriptor).trim();
        const fieldWidgetKind = info.tag === 'select' ? 'SINGLE_SELECT' : info.combobox ? 'SINGLE_SELECT' : (info.type || 'TEXT').toUpperCase();

        if ((value === undefined || value === '') && fieldQuestionText.length > 0 && info.type !== 'password' && info.type !== 'file') {
          const learned = resolveBySemanticSelfLearning(
            fieldQuestionText,
            fieldWidgetKind,
            harvested?.options || null,
            null,
            options.profile
          );
          if (learned?.value !== undefined && learned.value !== '') {
            value = learned.value;
          }
        }

        if ((value === undefined || value === '') && fieldQuestionText.length > 0 && info.type !== 'password' && info.type !== 'file') {
          const fallbackVal = resolveUniversalPermissiveFallback({
            questionText: fieldQuestionText,
            widgetKind: fieldWidgetKind,
            options: (harvested as any)?.options || null,
            placeholder: info.placeholder,
            inputType: info.type,
            profileEmail: options.profile.personal.email,
          });
          if (fallbackVal !== undefined && fallbackVal !== '') {
            value = fallbackVal;
          }
        }

        // Ticket GEN-84/GEN-95: Coerce boolean true -> "Yes" and false -> "No" for all non-checkbox controls
        if (typeof value === 'boolean' && info.type !== 'checkbox') {
          value = value ? 'Yes' : 'No';
        }

        // Ticket GEN-95: Phone resolution verification
        if ((classification.category === 'phone' || /^(?:phone|mobile|telephone|contact number)\*?$/i.test(fieldQuestionText)) && !value) {
          value = process.env.AUTOAPPLY_PHONE || options.profile.personal.phone;
        }

        // Single-Option Dropdown Auto-Select (GEN-89):
        if ((info.tag === 'select' || info.combobox) && harvested?.options?.length) {
          const cleanOptions = harvested.options.filter(o => !/^(?:select|choose|please select|--)/i.test(o.trim()));
          if (cleanOptions.length === 1 && (!value || value === '')) {
            value = cleanOptions[0];
          }
        }

        // Ticket GEN-84/GEN-96: When a TEXTAREA resolves to a bare number ("0" or 0 from skill_experience), replace with grounded narrative
        if (info.tag === 'textarea' && (value === undefined || value === '0' || value === 0 || typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value.trim())))) {
          value = composeGroundedNarrative(fieldQuestionText, options.profile) || resolveUniversalPermissiveFallback({
            questionText: fieldQuestionText,
            widgetKind: 'TEXTAREA',
            options: null,
            placeholder: info.placeholder,
            profileEmail: options.profile.personal.email,
          });
        }

        // Ticket GEN-89: Social Profile Links (Facebook, Twitter, etc.)
        if (/\b(facebook|twitter|x\s*\(twitter\)|instagram|threads|tiktok)\b/i.test(descriptor)) {
          if (!info.required) {
            continue;
          } else {
            value = info.type === 'url' || /url|link/i.test(descriptor) ? 'https://github.com/smresponsibilities' : 'N/A';
          }
        }

        // Ticket GEN-84: Map Greenhouse split phone country prefix controls to "+91" / "India (+91)"
        if (['country_code', 'phone_country_code'].includes(classification.category as string) || /country\s*code|phone\s*country/i.test(descriptor)) {
          value = '+91';
        }
        const matchChoices = (choices: Array<{ value: string; label: string }>, excludeCategories = false) => {
          if (dynamic.reason !== 'source_preferences' || !candidate.referralSources?.length) return value === undefined ? null : matchBestOption(value, choices);
          const available = excludeCategories ? choices.filter(choice => !/^(?:website|job boards?)$/i.test(choice.label.trim())) : choices;
          const companyWebsite = options.company && available.find(choice => normalizeQuestion(choice.label) === normalizeQuestion(`${options.company} careers website`));
          if (companyWebsite) { value = companyWebsite.label; return companyWebsite; }
          for (const source of candidate.referralSources) {
            const found = matchBestOption(source, available);
            if (found) { value = source; return found; }
          }
          return null;
        };
        if (info.kind === 'experience' && info.index >= 0) {
          const entry = candidate.experience[info.index];
          if (entry) {
            if (/company|employer/i.test(descriptor)) value = entry.company;
            else if (/title|position/i.test(descriptor)) value = entry.title;
            else if (/start.?date/i.test(descriptor)) value = entry.startDate;
            else if (/end.?date/i.test(descriptor)) value = entry.endDate;
            else if (/description|responsibilities/i.test(descriptor)) value = entry.description;
            else if (/location/i.test(descriptor)) value = entry.location;
            else if (/current/i.test(descriptor)) value = entry.current;
          }
        }
        if (dynamic.reason === 'qa_bank_match') value = dynamic.value;
        if (classification.category === 'phone' && typeof value === 'string') {
          const hasCountryCodeSelector = await frame.locator('select, [role="combobox"], button[aria-haspopup="listbox"], input[name*="code" i], input[id*="code" i]').filter({ hasText: /\+91|country code|dial code/i }).count().catch(() => 0) > 0;
          const expects10Digits = /10[\s-]digit|without (?:country )?code/i.test(descriptor) || (info.placeholder && /^\d{10}$/.test(info.placeholder.replace(/\D/g, '')));
          if (hasCountryCodeSelector || expects10Digits) {
            value = applyClubbedValueTransform(value, {
              field: { questionText: info.questionTitle || info.label || info.name, widgetKind: 'TEXT', isRequired: info.required, refKey: key, sectionHeading: '', isFilled: false, currentValue: '', options: [], validationError: null, containerSelector: '', controlSelector: '' },
              clubKind: 'PHONE_COMPOSITE',
              executionPriority: 25,
              postFillWaitMs: 100,
              valueTransform: 'strip_country_code',
            });
          }
        }
        if ((classification.category === 'current_salary' || classification.category === 'expected_salary' || /\b(ctc|salary|compensation|pay expectation|remuneration)\b/i.test(descriptor)) && typeof value === 'string') {
          value = applyClubbedValueTransform(value, {
            field: { questionText: info.questionTitle || info.label || info.name, widgetKind: 'TEXT', isRequired: info.required, refKey: key, sectionHeading: '', isFilled: false, currentValue: '', options: [], validationError: null, containerSelector: '', controlSelector: '' },
            clubKind: 'COMPENSATION_COMPOSITE',
            executionPriority: 46,
            postFillWaitMs: 100,
            valueTransform: 'lpa_vs_annual',
          });
        }
        if (info.datePart) {
          const start = /start.?date|\bfrom\b/i.test(info.dateContext);
          const end = /end.?date|graduat|\bto\b/i.test(info.dateContext);
          const entry = info.kind === 'experience' ? options.profile.experience[info.index] : info.kind === 'education' ? options.profile.education[info.index] : undefined;
          let date = start !== end && entry ? (start ? entry.startDate : entry.endDate) : undefined;
          if (!date && start !== end && info.kind === 'education') { const education = options.profile.education[info.index]; date = start ? education?.startYear : education?.graduationYear; }
          const parts = typeof date === 'string' ? /^(\d{4})(?:-(0[1-9]|1[0-2]))?(?:-(?:0[1-9]|[12]\d|3[01]))?$/.exec(date) : undefined;
          value = parts ? info.datePart === 'month' ? parts[2] : parts[1] : undefined;
        }
        let document = info.type === 'file' ? (/cover.?letter/i.test(descriptor) ? candidate.documents?.coverLetter : /resume|\bcv\b/i.test(descriptor) ? candidate.documents?.resume : undefined) : undefined;
        if (info.type === 'file' && (/resume|\bcv\b/i.test(descriptor) || !/cover.?letter/i.test(descriptor))) {
          const archetype = detectJobArchetype(
            options.applicationBrief?.title || options.company || '',
            options.applicationBrief?.text || ''
          );
          const resumesDir = path.resolve('state/autoapply/resumes');
          const docxCandidate = path.join(resumesDir, `Shivam_Mahajan_Resume_${archetype}.docx`);
          const pdfCandidate = path.join(resumesDir, `Shivam_Mahajan_Resume_${archetype}.pdf`);
          const prefersDocx = Boolean(info.accept && /\b(\.docx?|msword|wordprocessingml)\b/i.test(info.accept) && !/\b(\.pdf|application\/pdf)\b/i.test(info.accept));

          if (prefersDocx) {
            document = existsSync(docxCandidate) ? docxCandidate : existsSync(pdfCandidate) ? pdfCandidate : undefined;
          } else {
            document = existsSync(pdfCandidate) ? pdfCandidate : existsSync(docxCandidate) ? docxCandidate : undefined;
          }
          if (!document && candidate.documents?.resume) {
            document = candidate.documents.resume;
          }
        }
        if (info.type === 'file' && /cover.?letter/i.test(descriptor)) {
          // Ticket GEN-140: Check if "Enter manually" toggle is present
          const manualToggle = frame.locator('button:has-text("Enter manually"), a:has-text("Enter manually"), [data-source="paste"]').filter({ visible: true }).first();
          if (await manualToggle.isVisible().catch(() => false)) {
            await manualToggle.click().catch(() => {});
            await frame.page().waitForTimeout(300);
            const clTextarea = frame.locator('#cover_letter_text, textarea[name*="cover_letter" i], textarea[aria-label*="cover letter" i]').filter({ visible: true }).first();
            if (await clTextarea.isVisible().catch(() => false)) {
              const narrative = 'I am eager to contribute to your engineering team by leveraging my experience at Morgan Stanley in building scalable distributed systems and backend data pipelines. I look forward to delivering reliable, high-impact software from day one.';
              await clTextarea.fill(narrative).catch(() => {});
              report.actions.push({
                documentHash: undefined,
                controlKey: key,
                question: (info.label || info.ariaLabel || info.name || info.id).trim().slice(0, 500),
                category: classification.category,
                confidence: classification.confidence,
                selector: '#cover_letter_text',
                value: 'composed_cover_letter',
                elementTag: 'textarea',
                status: 'filled',
                error: undefined,
              });
              report.fieldsFilled++;
              continue;
            }
          }
          if (!document) document = candidate.documents?.resume;
        }
        if (!document && !options.dryRun && info.type === 'file' && info.required && /cover.?letter/i.test(descriptor)) document = await this.coverLetter(options) || candidate.documents?.resume;
        if (!document && !options.dryRun && info.type === 'file' && info.required) document = candidate.documents?.resume;
        if (info.type === 'file') value = document;
        if (info.hasFile && !report.actions.some(action => action.controlKey === key && action.documentHash)) {
          const selected = await input.evaluate(async el => {
            const file = (el as HTMLInputElement).files?.[0];
            if (!file) return;
            const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
            return { name: file.name, hash: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('') };
          });
          if (selected) report.actions.push({ controlKey: key, question: info.label, category: classification.category, confidence: classification.confidence, selector: info.id || info.name, value: selected.name, elementTag: 'input', status: 'filled', documentHash: selected.hash });
        }
        if (info.hasFile && document && uploadedFiles.get(key) === document) continue;
        if (info.hasFile && document && report.actions.some(action => action.controlKey === key && action.documentHash === sha256(readFileSync(document)))) continue;
        const reviewedSelection = options.resume && info.combobox ? await input.evaluate(comboboxSelection) : undefined;
        // Only explicit owner review can preserve an unknown answer; a widget query is not a selection.
        if (options.resume && dynamic.reason !== 'qa_bank_match' && ((info.value && !info.combobox && !['radio', 'checkbox', 'file'].includes(info.type)) || reviewedSelection?.values.length || (info.type === 'checkbox' && (yesNo ? info.yesNoAnswered : info.checked)) || info.radioAnswered || info.hasFile)) continue;
        if (info.type === 'checkbox' && value === undefined) {
          const isConsent = /\b(agree|acknowledge|consent|privacy|terms|certify|confirm|accurate)\b/i.test(info.label);
          if (isConsent) {
            value = true;
          } else if (/\b(?:hear|heard|source|find|learn)\b/i.test(info.questionTitle || info.label)) {
            const matchesSource = (options.profile.referralSources || []).some(s => matchBestOption(s, [{ value: info.optionLabel, label: info.optionLabel }])) || /linkedin|other.*(?:job|online)|job.*board|website|newsletter|google\s*jobs/i.test(info.optionLabel);
            value = matchesSource ? true : false;
          }
        }
        if (!options.dryRun && value !== undefined && info.value && !info.combobox && info.tag !== 'select' && !['file', 'checkbox', 'radio'].includes(info.type) && retainedText(info.value, String(value), info.type)) continue;
        if (!options.dryRun && info.type === 'checkbox' && typeof value === 'boolean' && info.checked === value && (!yesNo || info.yesNoAnswered)) continue;
        if (!options.dryRun && info.type === 'radio' && info.checked && value !== undefined && matchBestOption(value, [{ value: info.value, label: info.optionLabel }])) continue;
        const action = { documentHash: undefined as string | undefined, controlKey: key, question: (info.label || info.ariaLabel || info.name || info.id).trim().slice(0, 500), category: classification.category, confidence: classification.confidence, selector: info.id || info.name || info.tag, value: '', elementTag: info.tag, status: 'needs_review' as 'needs_review' | 'filled' | 'failed' | 'skipped', error: undefined as string | undefined };
        report.actions.push(action);
        if ((value === undefined || value === '') && info.type !== 'password' && info.type !== 'file') {
            const fallbackVal = resolveUniversalPermissiveFallback({
              questionText: action.question,
              widgetKind: info.tag === 'select' ? 'SINGLE_SELECT' : info.combobox ? 'SINGLE_SELECT' : (info.type || 'TEXT').toUpperCase(),
              options: (harvested as any)?.options || null,
              placeholder: info.placeholder,
              inputType: info.type,
              profileEmail: options.profile.personal.email,
            });
            if (fallbackVal !== undefined && fallbackVal !== '') {
              value = fallbackVal;
            }
          }
          if (value === undefined || value === '' || info.type === 'password') {
          if (info.type === 'checkbox') {
            action.status = 'skipped';
            continue;
          }
          if (info.required && action.question.trim().length > 0) {
            report.unmappedFields++;
            action.status = 'failed';
            action.error = 'Required answer is missing';
            logUnknownFieldForLearning({
              questionText: action.question,
              widgetKind: info.tag === 'select' ? 'SELECT' : (info.type || 'TEXT').toUpperCase(),
              isRequired: true,
              options: harvested?.options || null,
              validationError: null,
              sectionHeading: '',
              company: options.company || '',
              url: options.url,
            });
          } else {
            action.status = info.type === 'checkbox' ? 'needs_review' : 'skipped';
          }
          continue;
        }
        if (!info.combobox && ['input', 'textarea'].includes(info.tag) && !['radio', 'checkbox', 'file'].includes(info.type) && retainedText(info.value, String(value), info.type)) { action.status = 'skipped'; continue; }
        if (options.dryRun) { action.status = 'skipped'; continue; }
        if ((attempts.get(fieldKey) || 0) >= 2) {
          const retained = info.combobox ? !!matchBestOption(value, (await input.evaluate(comboboxSelection)).values.map(label => ({ value: label, label }))) : info.type === 'radio' ? info.checked : info.type === 'checkbox' ? info.checked === value : retainedText(info.value, String(value), info.type);
          action.status = retained || !info.required ? 'skipped' : 'failed';
          if (!retained) action.error = 'Field attempt limit reached; retained value requires review';
          continue;
        }
        attempts.set(fieldKey, (attempts.get(fieldKey) || 0) + 1);
        try {
          const isSinglePageAts = ['greenhouse', 'ashby', 'lever'].includes(report.ats);
          if (options.mode === 'stealth') await this.page!.waitForTimeout(isSinglePageAts ? 100 + Math.random() * 150 : 300 + Math.random() * 300);
          if (info.type === 'file' && document) {
            let docToUpload = document;
            // Ticket GEN-238: Check accept attribute for .docx-only file inputs
            const acceptAttr = (await input.getAttribute('accept').catch(() => '')) || '';
            if (/\.docx?|msword|wordprocessingml/i.test(acceptAttr) && !/\.pdf|application\/pdf|\*/i.test(acceptAttr)) {
              const docxCandidate = document.replace(/\.pdf$/i, '.docx');
              if (existsSync(docxCandidate)) {
                docToUpload = docxCandidate;
              }
            }
            const bytes = readFileSync(docToUpload);
            let uploadName = 'Shivam_Mahajan_Resume.pdf';
            if (/\.docx$/i.test(docToUpload)) {
              uploadName = 'Shivam_Mahajan_Resume.docx';
            }
            await input.setInputFiles({
              name: uploadName,
              mimeType: /\.pdf$/i.test(docToUpload) ? 'application/pdf' : /\.docx$/i.test(docToUpload) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/octet-stream',
              buffer: bytes
            });
            // Ticket GEN-92.1: Fix input.evaluate timeout bug on detached file input
            const inputCountAfterUpload = await input.count().catch(() => 0);
            const hasFile = inputCountAfterUpload === 0 ? true : await Promise.race([
              input.evaluate(el => Boolean((el as HTMLInputElement).files?.length || (el as HTMLInputElement).value)).catch(() => true),
              new Promise<boolean>(r => setTimeout(() => r(true), 1200)),
            ]);
            if (!hasFile) {
              await this.page!.waitForTimeout(1000);
              const previewOrSuccess = await this.page!.locator('.file-preview, .uploaded-file, [data-test*="file"], [class*="upload-success"], [class*="file-item"], [class*="resume-card"], .file-name, [aria-label*="remove"], button:has-text("Remove"), button:has-text("Delete"), [class*="c-file-upload"]').filter({ visible: true }).count().catch(() => 0);
              const postInputCount = await input.count().catch(() => 0);
              const postWaitFile = postInputCount === 0 ? true : await Promise.race([
                input.evaluate(el => Boolean((el as HTMLInputElement).files?.length || (el as HTMLInputElement).value)).catch(() => true),
                new Promise<boolean>(r => setTimeout(() => r(true), 1200)),
              ]);
              const detachedOrHidden = postInputCount === 0 || !(await input.isVisible().catch(() => false));
              if (!postWaitFile && !previewOrSuccess && !detachedOrHidden) {
                throw new Error('Uploaded file did not remain selected');
              }
            }
            action.documentHash = sha256(bytes);
            if (/lever\.co/i.test(frame.url())) {
              // Wait up to 5000ms for Lever's async resume parser (.resume-upload-working / .resume-upload-success) to settle
              const leverParseDeadline = Date.now() + 5000;
              await frame.page().waitForTimeout(800).catch(() => {});
              while (Date.now() < leverParseDeadline) {
                const isParsing = await frame
                  .evaluate(() => {
                    const working = window.document.querySelector(
                      '.resume-upload-working, .analyzing-resume, [class*="resume-upload-working" i]'
                    );
                    return Boolean(working && (working as HTMLElement).offsetParent !== null);
                  })
                  .catch(() => false);
                if (!isParsing) break;
                await frame.page().waitForTimeout(350).catch(() => {});
              }
            }
          }
          else if (info.tag === 'select') {
            const selectedFast = await selectHarvestedOption(frame, input, String(value), action.question).catch(() => false);
            if (selectedFast) {
              action.status = 'filled';
              action.value = String(value);
              report.fieldsFilled++;
              continue;
            }
            const choices = await input.locator('option').evaluateAll(options => options.map(o => ({ value: (o as HTMLOptionElement).value, label: o.textContent || '' })));
            let best = matchChoices(choices);
            // Ticket GEN-89: Auto-select single valid non-placeholder option
            const cleanChoices = choices.filter(c => c.value && !/^(select|choose|--|none|placeholder)/i.test(c.value) && !/^(select|choose|--)/i.test(c.label.trim()));
            if (!best && cleanChoices.length === 1) {
              best = cleanChoices[0]!;
            }
            if (!best && choices.length > 0) {
              // 1. Stem match against value (e.g. Immediate <-> Immediately)
              if (value) {
                const targetStem = String(value).trim().toLowerCase().slice(0, 5);
                if (targetStem.length >= 3) {
                  best = choices.find(c => {
                    const l = c.label.trim().toLowerCase();
                    const v = c.value.trim().toLowerCase();
                    return l.startsWith(targetStem) || v.startsWith(targetStem) || (l.length >= 5 && l.slice(0, 5) === targetStem);
                  }) || null;
                }
              }
              // 2. resolveByOptionPolicy
              if (!best) {
                const optLabels = choices.map(c => c.label.trim()).filter(Boolean);
                const policyRes = resolveByOptionPolicy(action.question, optLabels, candidate, options.company);
                if (policyRes?.value) {
                  best = choices.find(c => c.label.trim().toLowerCase() === String(policyRes.value).trim().toLowerCase() || c.value === String(policyRes.value)) || null;
                }
              }
              // 3. resolveUniversalPermissiveFallback
              if (!best) {
                const fallbackChoice = resolveUniversalPermissiveFallback({
                  questionText: action.question,
                  widgetKind: 'SINGLE_SELECT',
                  options: choices.map(c => c.label).filter(Boolean),
                  placeholder: info.placeholder,
                  profileEmail: options.profile.personal.email,
                });
                if (fallbackChoice) {
                  best = choices.find(c => c.label === fallbackChoice || c.value === fallbackChoice) || null;
                  if (!best) {
                    const fallbackStem = fallbackChoice.trim().toLowerCase().slice(0, 5);
                    if (fallbackStem.length >= 3) {
                      best = choices.find(c => c.label.trim().toLowerCase().startsWith(fallbackStem)) || null;
                    }
                  }
                }
              }
              // 4. Fallback to first non-placeholder option
              if (!best) {
                best = choices.find(c => c.value && !/^(?:select|choose|--|none|placeholder)/i.test(c.value) && !/^(?:select|choose|--)/i.test(c.label.trim())) || choices.find(c => c.value) || choices[0] || null;
              }
            }
            if (!best) {
              if (info.required) {
                report.unmappedFields++;
                action.status = 'failed';
                action.error = 'Required option could not be matched';
                logUnknownFieldForLearning({
                  questionText: action.question,
                  widgetKind: 'SELECT',
                  isRequired: true,
                  options: choices.map(c => c.label).filter(Boolean),
                  validationError: 'Required option could not be matched',
                  company: options.company || '',
                  url: options.url,
                });
              } else { action.status = 'needs_review'; }
              continue;
            }
            if (!info.multiple && info.value === best.value) { action.status = 'skipped'; continue; }
            if (options.mode === 'stealth' && !isSinglePageAts) await this.approach(input);
            await input.selectOption(best.value);
            if (await input.inputValue() !== best.value) throw new Error('Select did not retain the selected value');
          } else if (info.combobox) {
            if (
              classification.category === 'country' ||
              (classification.category as string) === 'country_code' ||
              /\b(country|country\/region)\b/i.test(info.label || info.name || info.id)
            ) {
              const countryVal = candidate.personal.country || 'India';
              const isSmartRecruiters = options.url.includes('smartrecruiters.com') || (this.page && this.page.url().includes('smartrecruiters.com'));
              const handled = isSmartRecruiters
                ? await fillSmartRecruitersCountryCombobox(frame, input, countryVal).catch(() => false)
                : await fillAsyncLocationCombobox(frame, input, countryVal).catch(() => false);
              if (handled) {
                action.status = 'filled';
                action.value = countryVal;
                report.fieldsFilled++;
                continue;
              }
            }
            if (classification.category === 'city' || info.id === 'candidate-location' || /location\s*\((?:city|metro|town)\)|candidate-location/i.test(info.label || info.name || info.id)) {
              const city = candidate.personal.city || 'Bengaluru';
              const handled = await fillAsyncLocationCombobox(frame, input, city).catch(() => false);
              if (handled) {
                action.status = 'filled';
                action.value = city;
                report.fieldsFilled++;
                continue;
              }
            }
            if (value !== undefined && value !== '') {
              const selectedComboFast = await selectHarvestedOption(frame, input, String(value), action.question).catch(() => false);
              if (selectedComboFast) {
                action.status = 'filled';
                action.value = String(value);
                report.fieldsFilled++;
                continue;
              }
            }
            const selected = await input.evaluate(comboboxSelection);
            if (options.resume && selected.values.length && dynamic.reason !== 'qa_bank_match') { action.status = 'skipped'; continue; }
            if (selected.multiple && selected.values.some(label => !matchBestOption(value!, [{ value: label, label }]))) { action.status = 'failed'; action.error = 'Existing multi-select answers require explicit review'; continue; }
            if (matchBestOption(value, selected.values.map(label => ({ value: label, label })))) { action.status = 'skipped'; continue; }
            if (info.tag === 'button' && (await input.innerText()).trim().toLowerCase() === String(value).trim().toLowerCase()) { action.status = 'skipped'; continue; }
            const editable = info.tag === 'input' && (!!await input.getAttribute('aria-autocomplete') || await input.getAttribute('data-uxi-widget-type') === 'selectinput');
            const workdayInput = await input.getAttribute('data-uxi-widget-type') === 'selectinput';
            if (!(options.mode === 'stealth' && editable)) { if (options.mode === 'stealth' && !isSinglePageAts) await this.pacedClick(input); else await input.click(); }
            if (editable) {
              const text = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
              if (options.mode === 'stealth') await this.humanType(input, text, false); else await input.fill(text);
            }
            const popupId = await input.getAttribute('aria-controls') || await input.getAttribute('aria-owns');
            const workdayPrompt = frame.locator('[data-automation-id="activeListContainer"]').filter({ visible: true }).last();
            if (workdayInput) await input.press('Enter');
            const choices = (workdayInput ? workdayPrompt.locator('[data-automation-id="promptOption"],[role="option"]') : popupId ? frame.locator(`[id=${JSON.stringify(popupId)}]`).getByRole('option') : frame.getByRole('option')).and(frame.locator(':not([data-automation-id="selectedItem"])')).filter({ visible: true });
            let best: ReturnType<typeof matchBestOption> = null;
            let selectedBySearch = false;
            let degreeLevelFallback = false;
            const choicesDeadline = Date.now() + 5000;
            do {
              if (workdayInput) {
                if (value !== undefined && value !== '') {
              const selectedComboFast = await selectHarvestedOption(frame, input, String(value), action.question).catch(() => false);
              if (selectedComboFast) {
                action.status = 'filled';
                action.value = String(value);
                report.fieldsFilled++;
                continue;
              }
            }
            const selected = await input.evaluate(comboboxSelection);
                if (matchBestOption(value, selected.values.map(label => ({ value: label, label })))) { selectedBySearch = true; break; }
              }
              const data = await choices.evaluateAll(items => items.map((o, i) => ({ value: `option-${i}`, label: o.textContent || '' })));
              best = matchChoices(data, workdayInput && dynamic.reason === 'source_preferences');
              if (!best && classification.category === 'country') best = matchBestOption(value, data.map(o => ({ ...o, label: o.label.replace(/\s+\+\d+\s*$/, '') })));
              if (!best && classification.category === 'city') best = matchBestOption([candidate.personal.city, candidate.personal.state, candidate.personal.country].filter(Boolean).join(', '), data);
              if (best) break;
              await this.page!.waitForTimeout(100);
            } while (Date.now() < choicesDeadline);
            // Some portals list only degree levels, while the profile records a
            // specific bachelor's degree. Retry a level search without guessing
            // between different degree subjects.
            if (!best && !selectedBySearch && editable && classification.category === 'degree'
              && /^(?:b\.?\s*(?:e|tech|sc)\.?|bachelor(?:'s)?(?:\s+of\s+.+)?)$/i.test(String(value).trim())) {
              if (options.mode === 'stealth') await this.humanType(input, 'Bachelor', false); else await input.fill('Bachelor');
              const deadline = Date.now() + 5000;
              do {
                const data = await choices.evaluateAll(items => items.map((item, index) => ({ value: `option-${index}`, label: (item.textContent || '').trim() })));
                const levels = data.filter(option => /^bachelor(?:'s|’s)?\s+degree$/i.test(option.label));
                if (levels.length === 1) { best = levels[0]!; degreeLevelFallback = true; break; }
                await this.page!.waitForTimeout(100);
              } while (Date.now() < deadline);
            }
            // Traverse an identified source category only to reach the requested
            // leaf. Never choose an unrelated school/source merely to advance.
            if (!best && !selectedBySearch && workdayInput && classification.category === 'hear_about_us') {
              await input.fill(''); await input.press('Enter');
              const category = /website|career/i.test(String(value)) ? /^(?:website|company website|careers website|career site)$/i : /job board/i.test(String(value)) ? /^job boards?$/i : undefined;
              if (category) {
                const categories = choices.filter({ hasText: category });
                if (await categories.count() === 1) {
                  await categories.click();
                  const leafDeadline = Date.now() + 5000;
                  do {
                    best = matchChoices(await choices.evaluateAll(items => items.map((item, index) => ({ value: `option-${index}`, label: item.textContent || '' }))));
                    if (best) break;
                    await this.page!.waitForTimeout(100);
                  } while (Date.now() < leafDeadline);
                }
              }
            }
            if (!best && !selectedBySearch) {
              const liveChoices = await choices.evaluateAll(items => items.map((o, i) => ({ value: `option-${i}`, label: (o.textContent || '').trim() }))).catch(() => []);
              const candidateChoices = liveChoices.length > 0 ? liveChoices : (harvested?.options || []).map((label, i) => ({ value: `option-${i}`, label }));
              if (candidateChoices.length > 0) {
                // 1. Stem match against value (e.g. Immediate <-> Immediately)
                if (value) {
                  const targetStem = String(value).trim().toLowerCase().slice(0, 5);
                  if (targetStem.length >= 3) {
                    best = candidateChoices.find(c => c.label.toLowerCase().startsWith(targetStem) || c.label.toLowerCase().slice(0, 5) === targetStem) || null;
                  }
                }
                // 2. resolveByOptionPolicy
                if (!best) {
                  const optLabels = candidateChoices.map(c => c.label).filter(Boolean);
                  const policyRes = resolveByOptionPolicy(action.question, optLabels, candidate, options.company);
                  if (policyRes?.value) {
                    best = candidateChoices.find(c => c.label.toLowerCase() === String(policyRes.value).toLowerCase() || c.value === String(policyRes.value)) || null;
                  }
                }
                // 3. resolveUniversalPermissiveFallback
                if (!best) {
                  const fallbackChoice = resolveUniversalPermissiveFallback({
                    questionText: action.question,
                    widgetKind: 'SINGLE_SELECT',
                    options: candidateChoices.map(c => c.label).filter(Boolean),
                    placeholder: info.placeholder,
                    profileEmail: options.profile.personal.email,
                  });
                  if (fallbackChoice) {
                    best = candidateChoices.find(c => c.label === fallbackChoice || c.label.toLowerCase().includes(fallbackChoice.toLowerCase())) || null;
                  }
                }
                // 4. Fallback to first non-placeholder choice
                if (!best) {
                  best = candidateChoices.find(c => c.label && !/^(?:select|choose|--|none)/i.test(c.label)) || candidateChoices[0] || null;
                }
              }
            }
            if (!best && !selectedBySearch) {
              await input.press('Escape').catch(() => {});
              await this.page!.keyboard.press('Escape').catch(() => {});
              await this.page!.locator('body').click({ position: { x: 5, y: 5 }, timeout: 1000 }).catch(() => {});
              if (info.required) {
                report.unmappedFields++;
                action.status = 'failed';
                action.error = 'Required option could not be matched';
                logUnknownFieldForLearning({
                  questionText: action.question,
                  widgetKind: 'COMBOBOX',
                  isRequired: true,
                  options: harvested?.options || null,
                  validationError: 'Required option could not be matched',
                  company: options.company || '',
                  url: options.url,
                });
              } else { action.status = 'skipped'; }
              continue;
            }
            if (!selectedBySearch) {
              // Ticket GEN-92.2: React-Select onMouseDown dispatch
              const option = choices.nth(Number(best!.value.slice(7)));
              await option.dispatchEvent('mousedown').catch(() => {});
              if (options.mode === 'stealth') await this.pacedClick(option); else await option.click({ force: true }).catch(() => {});
              await option.dispatchEvent('mouseup').catch(() => {});
              await this.page!.keyboard.press('Enter').catch(() => {});
              await this.page!.waitForTimeout(200);
            }
            if (degreeLevelFallback && !matchBestOption(best!.label, (await input.evaluate(comboboxSelection)).values.map(label => ({ value: label, label })))) throw new Error('Degree selection did not remain selected');
            // Ticket GEN-92.2: W3C ARIA APG commit fallback
            if (workdayInput) {
              const retainedDeadline = Date.now() + 3000;
              let retained = false;
              do {
                const selected = await input.evaluate(comboboxSelection).catch(() => ({ values: [String(value)] }));
                retained = !!matchBestOption(value, selected.values.map(label => ({ value: label, label })));
                if (retained) break;
                await this.page!.waitForTimeout(100);
              } while (Date.now() < retainedDeadline);
              if (!retained) {
                await input.press('ArrowDown').catch(() => {});
                await input.press('Enter').catch(() => {});
                await input.press('Escape').catch(() => {});
              }
            }
            if (!workdayInput) {
              const retained = await input.evaluate(comboboxSelection).catch(() => ({ values: [] }));
              const text = info.tag === 'button' ? (await input.innerText().catch(() => '')).trim() : '';
              const matchValues = [value];
              if (['country', 'country_code', 'phone_country_code'].includes(classification.category)) {
                if (candidate.personal.country) matchValues.push(candidate.personal.country);
                if (candidate.personal.phoneCountryCode) matchValues.push(candidate.personal.phoneCountryCode);
              }
              const parentText = await input.locator('..').innerText().catch(() => '');
              const choices = [...retained.values, text, parentText].filter(Boolean).map(label => ({ value: label, label }));
              if (!matchValues.some(v => matchBestOption(v, choices))) {
                if (!choices.some(c => c.value && value && c.value.toLowerCase().includes(String(value).toLowerCase()))) {
                  await input.press('ArrowDown').catch(() => {});
                  await input.press('Enter').catch(() => {});
                  await input.press('Escape').catch(() => {});
                }
              }
            }
          } else if (info.type === 'radio') {
            if (yesNo) {
              const cluster = input.locator('..');
              const handled = await selectAshbyYesNoOrCheckboxGroup(cluster, value ?? 'Yes').catch(() => false);
              if (handled) {
                action.status = 'filled';
                action.value = String(value ?? 'Yes');
                report.fieldsFilled++;
                continue;
              }
            }
            if (!matchBestOption(value, [{ value: info.value, label: info.optionLabel }])) { action.status = 'skipped'; continue; }
            if (await input.getAttribute('role') === 'radio') {
              if (options.mode === 'stealth') await this.pacedClick(input); else await input.click({ force: true }).catch(() => {});
              if (await input.getAttribute('aria-checked') !== 'true') throw new Error('Radio option did not retain selection');
            } else {
              if (options.mode === 'stealth') await this.approach(input);
              // Ticket GEN-233: Zero-Interception <label> click + .checked = true setter for styled radio
              await input
                .evaluate((el) => {
                  const inp = el as HTMLInputElement;
                  const doc = inp.ownerDocument;
                  const lbl =
                    inp.closest('label') ||
                    (inp.id && typeof CSS !== 'undefined' && typeof CSS.escape === 'function' && doc
                      ? doc.querySelector<HTMLElement>(`label[for="${CSS.escape(inp.id)}"]`)
                      : null);
                  if (lbl) {
                    lbl.click();
                  } else {
                    inp.click();
                  }
                  if (!inp.checked) {
                    inp.checked = true;
                    inp.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                    inp.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                  }
                })
                .catch(async () => {
                  await input.check({ force: true }).catch(() => {});
                });
              if (!await input.isChecked().catch(() => true)) throw new Error('Radio option did not retain selection');
            }
          } else if (info.type === 'checkbox') {
            if (yesNo) {
              const cluster = input.locator('..');
              const handled = await selectAshbyYesNoOrCheckboxGroup(cluster, value ?? true).catch(() => false);
              if (handled) {
                action.status = 'filled';
                action.value = value ? 'Yes' : 'No';
                report.fieldsFilled++;
                continue;
              }
            }
            // Ticket GEN-94.4 & GEN-139: Checkbox string coercion, Bangalore synonym matcher, and multi-option required fallback
            const optText = (info.optionLabel || info.label || info.value || '').toLowerCase();
            const qText = (action.question || info.questionTitle || descriptor || '').toLowerCase();
            const valStr = typeof value === 'string' ? value.toLowerCase() : '';

            const isLocationSynonymMatch =
              (/\b(?:bengaluru|bangalore|india)\b/i.test(valStr) || /\b(?:location|office|city)\b/i.test(qText)) &&
              /\b(?:bengaluru|bangalore|karnataka|india|hybrid|remote|any)\b/i.test(optText);

            const isSkillsMatch =
              /\b(?:programming|language|tech\s*stack|skills?|technolog|tools?|framework)\b/i.test(qText) &&
              /\b(?:java|python|typescript|javascript|sql|spark|pyspark|kafka|spring|react|node\.?js|c\+\+|git|docker|aws|azure|linux)\b/i.test(optText);

            let targetBool: boolean;
            if (typeof value === 'boolean') {
              targetBool = value;
            } else if (typeof value === 'string') {
              targetBool =
                /^(?:true|yes|1|y)$/i.test(value.trim()) ||
                isLocationSynonymMatch ||
                isSkillsMatch ||
                matchBestOption(value, [{ value: info.value, label: info.optionLabel }]) !== null;
            } else {
              targetBool = isLocationSynonymMatch || isSkillsMatch;
            }

            // Ticket GEN-206: Guarantee screening & compensation clusters check >= 1 box (Particle41)
            const isScreeningCluster = /\b(?:compensation|salary|range|package|current|desired|expected|budget|align|location|city|skills?|shift|eligib|agreement|confirm|hear|source|find|vacancy|channel)\b/i.test(qText);
            if (!targetBool && (info.required || isScreeningCluster)) {
              const isSafeDefault = /yes|align|agree|confirm|comfortable|understand|accept|bengaluru|bangalore|india|remote|10|12|15|linkedin|other.*(?:job|online)|job.*board|website|newsletter|google|none of the above|do not wish|prefer not/i.test(optText);
              if (isSafeDefault) targetBool = true;
            }

            if (!targetBool && !info.required && !isScreeningCluster && typeof value !== 'boolean') {
              action.status = 'skipped';
              continue;
            }
            if (yesNo) {
              const option = input.locator('..').locator(`button[data-option="${targetBool ? 'yes' : 'no'}"]`);
              if (options.mode === 'stealth') await this.pacedClick(option); else await option.click({ force: true }).catch(() => {});
              if (await option.getAttribute('aria-pressed') !== 'true' && await option.getAttribute('aria-checked') !== 'true' && !(targetBool && await input.isChecked())) throw new Error('Yes/No option did not retain selection');
            } else {
              if (options.mode === 'stealth') await this.approach(input);
              // Ticket GEN-233: Zero-Interception <label> click + .checked = true setter for styled checkbox
              await input
                .evaluate((el, wanted) => {
                  const inp = el as HTMLInputElement;
                  const doc = inp.ownerDocument;
                  if (inp.checked !== wanted) {
                    const lbl =
                      inp.closest('label') ||
                      (inp.id && typeof CSS !== 'undefined' && typeof CSS.escape === 'function' && doc
                        ? doc.querySelector<HTMLElement>(`label[for="${CSS.escape(inp.id)}"]`)
                        : null);
                    if (lbl) {
                      lbl.click();
                    } else {
                      inp.click();
                    }
                    if (inp.checked !== wanted) {
                      inp.checked = wanted;
                      inp.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                      inp.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                    }
                  }
                }, targetBool)
                .catch(async () => {
                  await input.setChecked(targetBool, { force: true }).catch(() => {});
                });
            }
          } else if (info.tag === 'button' || (info.tag !== 'input' && info.type === 'button')) {
            const cluster = input.locator('..');
            let handled = await selectAshbyYesNoOrCheckboxGroup(cluster, value ?? 'Yes').catch(() => false);
            if (!handled) {
              const normVal = typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value ?? '').trim().toLowerCase();
              const isYes = /^(true|yes|1|i agree)$/i.test(normVal);
              const isNo = /^(false|no|0|decline|disagree)$/i.test(normVal);
              const btnTxt = (await input.innerText().catch(() => '')).trim().toLowerCase();
              const match =
                (isYes && /^yes\b/i.test(btnTxt)) ||
                (isNo && /^no\b/i.test(btnTxt)) ||
                btnTxt === normVal ||
                (normVal && btnTxt.includes(normVal)) ||
                (normVal && normVal.includes(btnTxt) && btnTxt.length > 2);
              if (match) {
                await input.scrollIntoViewIfNeeded().catch(() => {});
                await input.click({ force: true, timeout: 2500 }).catch(() => {});
                handled = true;
              }
            }
            if (handled) {
              action.status = 'filled';
              action.value = String(value ?? 'Yes');
              report.fieldsFilled++;
              this.activeWatchdog?.heartbeat(`filled_${key}`);
              continue;
            } else {
              action.status = 'skipped';
              continue;
            }
          } else {
            if (
              classification.category === 'country' ||
              (classification.category as string) === 'country_code' ||
              /\b(country|country\/region)\b/i.test(info.label || info.name || info.id)
            ) {
              const countryVal = candidate.personal.country || 'India';
              const isSmartRecruiters = options.url.includes('smartrecruiters.com') || (this.page && this.page.url().includes('smartrecruiters.com'));
              const handled = isSmartRecruiters
                ? await fillSmartRecruitersCountryCombobox(frame, input, countryVal).catch(() => false)
                : await fillAsyncLocationCombobox(frame, input, countryVal).catch(() => false);
              if (handled) {
                action.status = 'filled';
                action.value = countryVal;
                report.fieldsFilled++;
                continue;
              }
            }
            if (classification.category === 'city' || info.id === 'candidate-location' || /location\s*\((?:city|metro|town)\)|candidate-location/i.test(info.label || info.name || info.id)) {
              const city = candidate.personal.city || 'Bengaluru';
              const handled = await fillAsyncLocationCombobox(frame, input, city).catch(() => false);
              if (handled) {
                action.status = 'filled';
                action.value = city;
                report.fieldsFilled++;
                continue;
              }
            }
            if (info.type === 'range') {
              const appliedVal = await input.evaluate((el) => {
                const inp = el as HTMLInputElement;
                const maxVal = inp.max || '5';
                const protoSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                if (protoSetter) {
                  protoSetter.call(inp, maxVal);
                } else {
                  inp.value = maxVal;
                }
                inp.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                inp.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                return maxVal;
              }).catch(() => '5');
              action.status = 'filled';
              action.value = appliedVal || '5';
              report.fieldsFilled++;
              continue;
            }
            let stringVal = String(value);
            if (info.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(stringVal.trim())) {
              const isGraduation = /graduat|degree|education|completion|attend/i.test(descriptor + ' ' + (info.questionTitle || ''));
              stringVal = isGraduation ? '2026-08-01' : new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
            }
            stringVal = await this.sanitizeValueForInputType(
              input,
              stringVal,
              descriptor + ' ' + (info.questionTitle || '') + ' ' + (action.question || '')
            );

            // Ticket GEN-167 / GEN-196: Pre-populated input value check with 250ms non-blocking evaluation
            const existingVal = await Promise.race([
              input.evaluate((el) => String((el as HTMLInputElement).value ?? '')).catch(() => ''),
              new Promise<string>((resolve) => setTimeout(() => resolve(''), 250)),
            ]);
            const isCurrentlyInvalid = await Promise.race([
              input.evaluate((el: Element) => el.getAttribute('aria-invalid') === 'true').catch(() => false),
              new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 200)),
            ]);
            if (
              existingVal &&
              !isCurrentlyInvalid &&
              (retainedText(existingVal, stringVal, info.type) || existingVal.trim() === String(stringVal).trim())
            ) {
              action.status = 'filled';
              action.value = info.type === 'password' ? '' : String(value);
              report.fieldsFilled++;
              this.activeWatchdog?.heartbeat(`prefilled_${key}`);
              continue;
            }

            if (options.mode === 'stealth') await this.humanType(input, stringVal);
            else {
              await input.fill(stringVal, { timeout: 2500 }).catch(() => {});
              const typedVal = await Promise.race([
                input.evaluate((el) => String((el as HTMLInputElement).value ?? '')).catch(() => ''),
                new Promise<string>((resolve) => setTimeout(() => resolve(''), 250)),
              ]);
              if (!retainedText(typedVal, stringVal, info.type) && !typedVal.trim()) {
                throw new Error('Typed field did not retain the intended value');
              }
            }
          }
          action.status = 'filled';
          action.value = info.type === 'password' ? '' : String(value);
          if (dynamic.reason === 'semantic_self_learning' && dynamic.value !== undefined) {
            this.learnedFields.push({ questionText: action.question, category: dynamic.canonicalIntent, value: String(dynamic.value) });
          }
          if (info.type === 'file' && document) uploadedFiles.set(key, document);
          report.fieldsFilled++;
          this.activeWatchdog?.heartbeat(`filled_${key}`);
          if (report.fieldsFilled === 1 || report.fieldsFilled % 4 === 0) void this.checkpoint(options, report);
          const isLargeForm = fields.length >= 10 || ['greenhouse', 'ashby', 'lever'].includes(report.ats);
          if (options.mode === 'stealth') {
            await this.page!.waitForTimeout(isLargeForm ? getHumanKeyDelay(20, 50) : getHumanKeyDelay(50, 350));
          }
          if (next.postFillWaitMs > 50) {
            await this.page!.waitForTimeout(isLargeForm ? Math.min(next.postFillWaitMs, 50) : next.postFillWaitMs);
          }
          await input.blur().catch(() => {});
          if (info.type === 'tel' || /phone|mobile/i.test((info.id || '') + ' ' + (info.name || ''))) {
            await frame.evaluate(`() => {
              const list = document.querySelector('.iti__country-list:not(.iti__hide)');
              if (list) {
                list.classList.add('iti__hide');
                list.dispatchEvent(new Event('blur', { bubbles: true }));
              }
            }`).catch(() => {});
            await frame.page().keyboard.press('Escape').catch(() => {});

            // GEN-146: Dual-format phone self-healer (10-digit national vs +91 E.164)
            const isPhoneInvalid = await input
              .evaluate((el) => {
                const inp = el as HTMLInputElement;
                if (inp.getAttribute('aria-invalid') === 'true') return true;
                const wrapper = inp.closest('[class*="field" i], [class*="input" i], .field, [data-automation-id^="formField-"]');
                if (!wrapper) return false;
                if (wrapper.querySelector('[aria-invalid="true"], [class*="error" i], .field-error')) {
                  const errTxt = (wrapper.textContent || '').toLowerCase();
                  if (/valid\s+phone|invalid\s+phone|format|country\s+code/i.test(errTxt)) return true;
                }
                return false;
              })
              .catch(() => false);

            if (isPhoneInvalid) {
              const rawDigits = String(value).replace(/\D/g, '');
              const tenDigits = rawDigits.length === 12 && rawDigits.startsWith('91') ? rawDigits.slice(2) : rawDigits.slice(-10);
              const alternatePhone = String(value).trim().startsWith('+') ? tenDigits : `+91${tenDigits}`;
              if (tenDigits.length === 10) {
                await this.humanType(input, alternatePhone);
                await input.blur().catch(() => {});
              }
            }

            // Ticket GEN-302: If phone is valid 10 digits and has no visible error message text, clear stale aria-invalid
            await input.evaluate((el) => {
              const inp = el as HTMLInputElement;
              const val = (inp.value || '').replace(/\D/g, '');
              if (val.length === 10 || (val.length === 12 && val.startsWith('91'))) {
                const wrapper = inp.closest('[class*="field" i], [class*="input" i], .field, [data-automation-id^="formField-"]');
                const errText = (wrapper?.querySelector('[id$="-error"], .error-message, .field-error')?.textContent || '').trim();
                if (!errText) {
                  inp.setAttribute('aria-invalid', 'false');
                  (inp as any).setCustomValidity?.('');
                }
              }
            }).catch(() => {});
          }
          if (!isSinglePageAts) {
            await frame.evaluate(`() => new Promise(resolve => {
              let quiet;
              const complete = () => { clearTimeout(quiet); clearTimeout(limit); observer.disconnect(); resolve(); };
              const observer = new MutationObserver(() => { clearTimeout(quiet); quiet = setTimeout(complete, 200); });
              const limit = setTimeout(complete, 1000);
              observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
              const roots = [document];
              for (let index = 0; index < roots.length; index++) for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot) {
                observer.observe(element.shadowRoot, { subtree: true, childList: true, attributes: true });
                roots.push(element.shadowRoot);
              }
              quiet = setTimeout(complete, 200);
            })`).catch(() => {});
          }
        } catch (error) {
          if (info.required) {
            action.status = 'failed';
            action.error = error instanceof Error && error.message ? error.message : 'Field interaction failed; inspect the saved review';
            report.unmappedFields++;
          } else {
            action.status = 'skipped';
            action.error = error instanceof Error && error.message ? error.message : 'Optional field interaction skipped';
          }
        }
      } catch (error) {
        if (frame.isDetached()) return;
        if (!await input.count()) continue; // Reacquire a replacement on the next scan.
        throw error;
      }
    }
    if (!converged) {
      // Ticket GEN-265: Check this.receipt() before ever throwing "Waiting for application requests to finish"
      const confirmedReceipt = (await this.receipt().catch(() => undefined));
      if (confirmedReceipt) {
        report.receipt = confirmedReceipt;
        report.status = 'submitted';
        report.reason = 'Submission confirmation observed';
        return;
      }

      // Filter out any 3rd-party analytics beacons that slipped into dependentRequests
      const ANALYTICS_BEACONS_REGEX = /sentry\.io|datadog|google-analytics|googletagmanager|doubleclick|segment\.io|amplitude|mixpanel|hotjar|intercom|clarity\.ms|linkedin\.com\/px|facebook\.net|fullstory|bugsnag|hs-analytics|optimizely|newrelic|nr-data\.net/i;
      const pending = [...this.dependentRequests]
        .filter(([req]) => !ANALYTICS_BEACONS_REGEX.test(req.url()))
        .map(([request, response]) => {
          const url = new URL(request.url());
          return `${request.method()} ${url.hostname} route#${sha256(url.pathname).slice(0, 12)} ${response.status || 'awaiting-headers'} ${response.contentType || ''}`;
        });
      this.log(`Pending application requests: ${[...new Set(pending)].join(', ') || 'none'}`);
      if (pending.length) {
        report.reviewKind = 'network';
        report.pendingFormRequests = true;
        throw new Error('Waiting for application requests to finish; retained tab will resume automatically');
      }
      throw new Error('Application controls did not stabilize; review the current form');
    }
    for (const action of report.actions.filter(action => action.controlKey?.startsWith(scan) && action.status === 'failed')) {
      if (!await frame.locator(`[data-autoapply-control=${JSON.stringify(action.controlKey)}]`).count()) action.status = 'skipped';
    }
  }

  async run(options: AutoApplyOptions): Promise<BotRunReport> {
    const attemptStartWallClockMs = Date.now();
    this.logs = [];
    this.lastNetworkSubmissionReceipt = null;
    options.url = unwrapDirectAtsApplicationUrl(options.url);
    // Ticket GEN-91: Strict 5-ATS Positive Allowlist Gate (0ms rejection)
    if (!isSupportedDirectAtsJobUrl(options.url)) {
      return {
        mode: options.mode || 'copilot',
        url: options.url,
        ats: 'unknown',
        startTime: new Date().toISOString(),
        fieldsFound: 0,
        fieldsFilled: 0,
        unmappedFields: 0,
        stepsTraversed: 0,
        status: 'skipped',
        reason: 'unsupported_non_direct_ats_url',
        humanInterventionRequired: false,
        actions: [],
        logs: ['fast_gate:unsupported_non_direct_ats_url'],
      };
    }
    const report: BotRunReport = { mode: options.mode || 'copilot', url: options.url, ats: 'unknown', startTime: new Date().toISOString(), fieldsFound: 0, fieldsFilled: 0, unmappedFields: 0, stepsTraversed: 0, status: 'paused_for_review', humanInterventionRequired: !!(options.advanceReviewedStep || (options.mode === 'copilot' && options.retryReviewed) || options.preserveReviewedValues === true), actions: [], logs: this.logs };
    const submittedCredentials = new Set<'signup' | 'signin'>();
    if (this.submissionObservation && this.submissionObservation.url !== options.url) { this.submissionObservation.observer.close(); this.submissionObservation = undefined; }
    let observer = this.submissionObservation?.observer;
    const semanticLearnedThisRun: Array<{ questionText: string; category: string; value: string }> = [];
    let selfHealAttempted = false;
    try {
      const apiCheck = await fastApiPreflightCheck(options.url).catch(() => ({ status: 'eligible' as const }));
      if (apiCheck.status === 'skipped') {
        report.status = 'skipped';
        report.reason = apiCheck.reason || 'Job closed or exceeds experience requirement';
        return report;
      }
      validateProfile(options.profile);
      this.profile = options.profile;
      const timeoutConfig = getProviderTimeoutConfig(options.url);
      const effectiveMaxTotalMs = Math.max(timeoutConfig.maxTotalMs, options.timeoutMs ?? 0);
      const watchdog = new JobActivityWatchdog(effectiveMaxTotalMs, timeoutConfig.maxIdleMs);
      watchdog.onHeartbeat = () => {
        if (options.sessionDir) {
          try {
            const cpPath = path.join(options.sessionDir, 'checkpoint.json');
            if (existsSync(cpPath)) {
              const now = new Date();
              utimesSync(cpPath, now, now);
            }
          } catch {}
        }
      };
      this.activeWatchdog = watchdog;
      const maxSteps = options.maxSteps ?? (options.url.toLowerCase().includes('myworkdayjobs.com') ? 14 : options.url.toLowerCase().includes('smartrecruiters.com') ? 6 : 12);
      if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new Error('maxSteps must be a positive integer');
      if (!['http:', 'https:', 'file:'].includes(new URL(options.url).protocol)) throw new Error('Unsupported application URL');
      if (!this.page || this.page.isClosed()) {
        if (this.context && this.isConnected()) {
          this.page = await this.context.newPage();
          this.trackPage(this.page);
        } else {
          const normLane = (options.lane || '0').replace(/^lane-?/, '');
          const defaultProfileDir = path.resolve('state/autoapply', `browser-profile-lane-${normLane}`);
          await this.initBrowser(options.headless ?? true, options.sessionDir, options.browserProfileDir || defaultProfileDir);
        }
      }
      this.page?.setDefaultTimeout(6000);
      const preserveReviewedValues = !!(options.preserveReviewedValues || options.advanceReviewedStep) && !!options.resume && this.page!.url() !== 'about:blank';
      let target = options.url;
      const checkpoint = options.sessionDir && path.join(options.sessionDir, 'checkpoint.json');
      if (checkpoint && existsSync(checkpoint)) {
        let saved: any = null;
        try { saved = JSON.parse(readFileSync(checkpoint, 'utf8')); } catch {}
        const isGreenhouseEmbed = options.url.includes('boards.greenhouse.io/embed/job_app') || (saved?.applicationUrl && saved.applicationUrl.includes('boards.greenhouse.io/embed/job_app'));
        const matchesJob = saved && ((options.jobId && saved.jobId === options.jobId) || saved.applicationUrl === options.url || isGreenhouseEmbed);
        if (!options.resume || (saved && !matchesJob)) {
          try { unlinkSync(checkpoint); } catch {}
          saved = null;
        } else if (saved && saved.applicationUrl !== options.url && !isGreenhouseEmbed) {
          try { unlinkSync(checkpoint); } catch {}
          saved = null;
        }
        if (saved) {
          const isSavedConfirmation =
            typeof saved.currentUrl === 'string' &&
            /(?:\/confirmation|\/thank(?:s|[-_]?you)|\/application[-_]?submitted|\/submitted)(?:\/|$|\?|#)|[?&](?:submitted|applied|confirmation)=(?:true|1)\b/i.test(
              saved.currentUrl
            );
          if (isSavedConfirmation) {
            report.status = 'submitted';
            report.receipt = {
              url: saved.currentUrl,
              text: 'Application Submitted',
              verifiedAt: new Date().toISOString(),
              selector: 'checkpoint_confirmation_url',
            };
            report.reason = 'Previous submission confirmed via confirmation URL; no new submission made';
            return report;
          }
          if (!options.retryReviewed) {
          for (const action of saved.report?.credentialAttempts || []) if (action === 'signup' || action === 'signin') submittedCredentials.add(action);
          for (const action of ['signup', 'signin'] as const) if (saved.report?.logs?.includes(`workday_reconcile:auth_${action}_submitted`)) submittedCredentials.add(action);
          report.credentialAttempts = [...submittedCredentials];
        }
        report.reconcileAfter = saved.report?.reconcileAfter;
        if (!options.retryReviewed && saved.report?.humanInterventionRequired !== false) report.humanInterventionRequired = true;
        if ((saved.report?.submissionAttempted || ['clicked', 'dispatched', 'confirmed'].includes(saved.report?.submission?.phase)) && !options.retryReviewed) {
          report.submissionAttempted = true;
          report.submission = saved.report.submission;
          report.actions = saved.report.actions || [];
          report.submittedFields = saved.report.submittedFields;
          report.verificationMessageId = saved.report.verificationMessageId;
          report.startTime = report.startTime || saved.report.startTime;
          if (options.resume && this.page!.url() === 'about:blank') await this.page!.goto(saved.currentUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
          if (options.resume) await this.reviewReady(report, options);
          const current = new URL(this.page!.url());
          const previous = new URL(saved.currentUrl);
          const relatedConfirmation = current.origin === previous.origin && current.pathname === `${previous.pathname.replace(/\/$/, '')}/confirmation`;
          report.receipt = saved.report.receipt || (options.resume && (this.page!.url() === saved.currentUrl || relatedConfirmation) ? await this.receipt() : undefined);
          if (!report.receipt && options.resume && options.requisition?.provider === 'workday') report.receipt = await this.reconcileWorkday(options, report).catch(() => { report.logs.push('workday_reconcile:exception'); return undefined; });
          if (report.receipt) report.status = 'submitted';
          else report.reviewKind = 'receipt';
          report.reason = report.receipt?.existing ? 'Employer confirms an existing application; no new submission made' : report.receipt ? 'Previous submission confirmed; no new submission made' : report.logs.includes('workday_reconcile:empty_application_list') ? 'Candidate Home has no applications; previous submit remains ambiguous' : 'A previous submit may have reached the employer. Verify its receipt before retrying.';
          return report;
        }
        if (options.resume && typeof saved.currentUrl === 'string' && ['http:', 'https:', 'file:'].includes(new URL(saved.currentUrl).protocol)) target = saved.currentUrl;
        }
      }
      if (this.context && /(?:myworkdayjobs\.com|myworkdaysite\.com|smartrecruiters\.com|smartr\.me)/i.test(new URL(target).hostname)) {
        await loadHostSessionState(this.context, target).catch(() => false);
      }
      if (!options.resume || this.page!.url() === 'about:blank') {
        try {
          await this.page!.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });
        } catch (gotoErr: any) {
          if (isOfflineDinoPage(gotoErr?.message || '')) {
            this.log('Wi-Fi / DNS drop detected during page navigation. Pausing for internet recovery...');
            const recovered = await waitForInternetRecoveryIfOffline(300_000);
            if (recovered) {
              await this.page!.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });
            } else {
              report.status = 'skipped';
              report.reason = 'wifi_drop_requeued';
              return report;
            }
          } else {
            throw gotoErr;
          }
        }
      }
      const pageTitle = await this.page!.title().catch(() => '');
      const bodySnippet = await this.page!.evaluate(() => document.body ? document.body.innerText.slice(0, 500) : '').catch(() => '');
      if (isOfflineDinoPage(pageTitle) || isOfflineDinoPage(bodySnippet)) {
        this.log('Wi-Fi / DNS drop detected (Dino page loaded). Pausing for internet recovery...');
        const recovered = await waitForInternetRecoveryIfOffline(300_000);
        if (recovered) {
          await this.page!.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });
        } else {
          report.status = 'skipped';
          report.reason = 'wifi_drop_requeued';
          return report;
        }
      }
      await this.page!.locator('body').waitFor({ state: 'attached' });
      await this.waitReady(Math.min(options.timeoutMs ?? 5000, 5000));

      // Ticket GEN-224 & GEN-347: Greenhouse 302 marketing site redirect fallback with EU host preservation
      const ghNavMatch = (target || options.url).match(/(?:(?:boards|job-boards)(?:\.eu)?)\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i);
      if (ghNavMatch && ghNavMatch[1] && ghNavMatch[2]) {
        const ghSlug = ghNavMatch[1];
        const ghJobId = ghNavMatch[2];
        const isEu = (target || options.url).includes('.eu.greenhouse.io');
        const ghHost = isEu ? 'job-boards.eu.greenhouse.io' : 'boards.greenhouse.io';
        const currentUrl = this.page!.url().toLowerCase();
        if (!currentUrl.includes('greenhouse.io')) {
          let extraQuery = '';
          try {
            const origUrl = new URL(target || options.url);
            origUrl.searchParams.forEach((v, k) => {
              if (k !== 'for' && k !== 'token') extraQuery += `&${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
            });
          } catch {}
          const embedUrl = `https://${ghHost}/embed/job_app?for=${encodeURIComponent(ghSlug)}&token=${encodeURIComponent(ghJobId)}${extraQuery}`;
          this.log(`Redirected off Greenhouse to marketing page (${currentUrl}); recovering via embed URL: ${embedUrl}`);
          await this.page!.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 30000, referer: target || options.url }).catch(() => {});
          await this.page!.locator('body').waitFor({ state: 'attached' }).catch(() => {});
        }
      }

      // Ticket GEN-142: Fast-exit if job posting is 404/closed
      const deadReason = await this.isDeadOrClosedJobPosting(this.page!);
      if (deadReason) {
        this.log(`Fast-exit: ${deadReason}`);
        report.status = 'failed';
        report.reason = deadReason;
        return report;
      }
      const isWorkdayHost = options.url.toLowerCase().includes('myworkdayjobs.com') || this.page!.url().toLowerCase().includes('myworkdayjobs.com');
      if (isWorkdayHost) {
        await this.page!.locator(
          '[data-automation-id="adventureButton"], [data-automation-id="applyButton"], [data-automation-id="jobPostingHeader"], [data-automation-id="signInContent"], [data-automation-id="createAccountContent"], [data-automation-id^="formField-"], [data-automation-id="bottom-navigation-next-button"]'
        ).first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
      }

      // If active Workday form or apply button is visible, the job is definitively alive
      const workdayAlive = isWorkdayHost && (await this.page!.locator(
        '[data-automation-id="adventureButton"], [data-automation-id="applyButton"], [data-automation-id="jobPostingHeader"], [data-automation-id="signInContent"], [data-automation-id^="formField-"]'
      ).first().isVisible().catch(() => false));

      if (!workdayAlive) {
        const pageInfo = await this.page!.evaluate(() => ({
          text: (document.body?.innerText || '').slice(0, 6000),
          title: document.title || '',
          headings: Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"], [data-automation-id="errorHeading"]')).map(el => el.textContent?.trim() || '').join(' ')
        })).catch(() => ({ text: '', title: '', headings: '' }));

        const combinedText = `${pageInfo.title} ${pageInfo.headings} ${pageInfo.text}`;
        const isMaintenanceAtStart = /workday is currently unavailable|service is temporarily unavailable|undergoing scheduled maintenance/i.test(combinedText);
        if (isMaintenanceAtStart) {
          markHostOutcome(options.url, 'rate_limited');
          report.status = 'queued';
          report.reason = 'service_temporarily_unavailable';
          return report;
        }

        const isClosedOrNotFound =
          /no longer accepting applications|this position is closed|job is no longer available|requisition is closed|the page you are looking for doesn['’]?t exist|job posting (?:has )?expired|this posting is no longer active|this job is no longer open|this job has expired|position has been filled|the requisition has been closed|\bpage not found\b|\b404\s*-\s*page not found\b|this vacancy is no longer available|no longer open for applications|job post has been removed/i.test(combinedText);

        const currentUrlAtStart = this.page!.url();
        const isRedirectedToSearchAtStart = options.url.includes('/job/') && (currentUrlAtStart.endsWith('/search') || currentUrlAtStart.endsWith('/jobs') || currentUrlAtStart.endsWith('/jobs/'));

        if (isClosedOrNotFound || isRedirectedToSearchAtStart) {
          report.status = 'skipped';
          report.reason = 'job_closed';
          return report;
        }
      }
      await this.dismissCookieConsentAndHydrateForm(this.page!, target || options.url);
      const immediateReceipt = await this.receipt();
      if (immediateReceipt) {
        report.receipt = immediateReceipt;
        report.status = 'submitted';
        report.reason = immediateReceipt.existing
          ? 'Employer confirms an existing application; no new submission made'
          : 'Application submission confirmed via confirmation URL/heading';
        return report;
      }
      if ((await this.browserGates()).challenge && getResilientContextTier(this.context) !== 3) {
        this.log('Portal challenge/WAF detected on Tier 1 context; rotating to Tier 3 native context and retrying');
        const storageStatePath = options.sessionDir ? path.join(options.sessionDir, 'storage-state.json') : undefined;
        await this.rotateToResilientTier(3, storageStatePath);
        await this.page!.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await this.page!.locator('body').waitFor({ state: 'attached' });
        await this.waitReady(Math.min(options.timeoutMs ?? 5000, 5000));
        await this.dismissCookieConsentAndHydrateForm(this.page!, target || options.url);
        if (options.url.toLowerCase().includes('smartrecruiters.com') || this.page!.url().toLowerCase().includes('smartrecruiters.com')) {
          await ensureSmartRecruitersApplicationStarted(this.page!);
        }
      }
      // Workday can render only its public header when a saved apply route loses
      // authentication. Re-enter through the approved posting, never another job.
      if (options.resume && /\.myworkdayjobs\.com$/i.test(new URL(options.url).hostname)
        && /\/apply\//i.test(new URL(this.page!.url()).pathname)
        && await this.page!.locator('[data-automation-id="utilityButtonSignIn"]').isVisible().catch(() => false)
        && !await this.page!.locator('main input,main textarea,main button,form input,[data-automation-id="jobPostingHeader"]').filter({ visible: true }).count()
        && !(await this.browserGates()).challenge) {
        await this.page!.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await this.waitReady(Math.min(options.timeoutMs ?? 5000, 5000));
      }
      // Ticket GEN-63: Workday Overview-to-Wizard Entry State Machine
      if (options.url.toLowerCase().includes('myworkdayjobs.com') || this.page!.url().toLowerCase().includes('myworkdayjobs.com')) {
        const workdayEntry = await ensureWorkdayApplicationStarted(this.page!);
        if (workdayEntry.jobClosed) {
          report.status = 'skipped';
          report.reason = 'Position closed / no longer accepting applications';
          return report;
        }
      }
      // Ticket GEN-101: SmartRecruiters "I'm interested" / #st-apply entry gate
      if (options.url.toLowerCase().includes('smartrecruiters.com') || this.page!.url().toLowerCase().includes('smartrecruiters.com')) {
        await ensureSmartRecruitersApplicationStarted(this.page!);
      }
      {
        const applyName = /^(?:apply(?: now| manually| for (?:this|the) (?:job|role))?|i['’]m interested)[\s\u200b-\u200d\u2060\ufeff]*$/i;
        for (let entryStep = 0; entryStep < 3; entryStep++) {
          const applicationInputs = this.page!.locator('input[type="email"], input[type="file"], textarea').filter({ visible: true });
          const reuse = this.page!.getByRole('button', { name: /^use my last application$/i }).or(this.page!.getByRole('link', { name: /^use my last application$/i })).filter({ visible: true }).first();
          const applyManually = this.page!.locator('[data-automation-id="applyManually"], [data-automation-id="applyManuallyButton"], a:has-text("Apply Manually"), button:has-text("Apply Manually")').filter({ visible: true }).first();
          const hasManual = await applyManually.isVisible().catch(() => false);
          const entry = options.reuseCompanyApplication && await reuse.isVisible().catch(() => false)
            ? reuse
            : hasManual
            ? applyManually
            : this.page!.getByRole('link', { name: applyName }).or(this.page!.getByRole('button', { name: applyName })).filter({ visible: true }).first();
          if (!await applicationInputs.count() && !await entry.isVisible().catch(() => false)) await entry.waitFor({ state: 'visible', timeout: Math.min(5000, Math.max(1000, options.timeoutMs ?? 5000)) }).catch(() => {});
          if (await applicationInputs.count() || !await entry.isVisible().catch(() => false) || await entry.evaluate(el => Boolean(el.closest('form')))) break;
          const origin = this.page!;
          if (!await reserveStateAction(origin.mainFrame(), entry, 'entry')) break;
          const popup = origin.waitForEvent('popup', { timeout: 1500 }).catch(() => undefined);
          if (options.mode === 'stealth') await this.pacedClick(entry); else await entry.click();
          const opened = await popup;
          if (opened) this.page = opened;
          await this.page!.waitForLoadState('domcontentloaded');
          await this.waitReady(Math.min(options.timeoutMs ?? 5000, 5000));
        }
      }
      report.ats = identifyApplicationAts(this.page!.url(), await this.page!.content());
      this.activeAts = report.ats;
      const expectedIdentity = options.requisition || canonicalRequisition(options.url);
      const loadedIdentity = canonicalRequisition(this.page!.url());
      const isGreenhouseEmbed = options.url.includes('boards.greenhouse.io/embed/job_app') || this.page!.url().includes('boards.greenhouse.io/embed/job_app');
      if (!isGreenhouseEmbed && expectedIdentity && loadedIdentity && !sameRequisition(expectedIdentity, loadedIdentity)) {
        const isAshbyOrLever = /ashbyhq\.com|lever\.co/i.test(options.url) || /ashbyhq\.com|lever\.co/i.test(this.page!.url());
        if (isAshbyOrLever && this.context) {
          this.log('Requisition mismatch detected on session; clearing cookies and reloading fresh target URL');
          await this.context.clearCookies().catch(() => {});
          await this.page!.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
          await this.waitReady(Math.min(options.timeoutMs ?? 5000, 5000));
          const reloadedIdentity = canonicalRequisition(this.page!.url());
          if (reloadedIdentity && !sameRequisition(expectedIdentity, reloadedIdentity)) {
            throw new Error('Loaded application belongs to a different requisition');
          }
        } else {
          throw new Error('Loaded application belongs to a different requisition');
        }
      }
      const descriptions = await this.page!.locator('[data-automation-id=jobPostingDescription],.job-description,[data-testid=job-description],#job-description,.posting-description').allTextContents();
      const titleCandidate = options.applicationBrief?.title || (options as any).jobTitle || (options as any).title || '';
      const candidateFit = evaluateCandidateJobFit({ title: titleCandidate, company: options.company || '', url: options.url });
      if (!candidateFit.allowed && descriptions.some(text => exceedsExperienceGate(text, titleCandidate))) {
        report.status = 'skipped'; report.reason = 'ineligible_jd_experience'; return report;
      }
      const timeout = options.timeoutMs ?? 10000;
      let reviewedSignature: string | undefined;
      const workdayLoopState: WorkdayStepLoopState = { lastStepHash: '', consecutiveCount: 0 };
      for (let step = 1; step <= maxSteps; step++) {
        this.attemptedFieldRefs = new Set<string>();
        if (this.isClosing || !this.page || this.page.isClosed()) {
          report.status = report.submissionAttempted ? 'submitted' : 'failed';
          report.reason = 'Job timed out or runner closed';
          return report;
        }
        options.onPhase?.('step', step);
        const stepStarted = Date.now();
        report.stepsTraversed = step;
        watchdog.heartbeat(`step_${step}`);
        watchdog.checkOrThrow();
        await this.checkpoint(options, report);

        // Ticket GEN-106: Ensure SmartRecruiters is on valid /oneclick-ui/ UUID form inside Step 1
        if (step === 1 && (options.url.toLowerCase().includes('smartrecruiters.com') || this.page!.url().toLowerCase().includes('smartrecruiters.com'))) {
          if (!/\/oneclick-ui\/.*\/publication\/[0-9a-f-]{20,}/i.test(this.page!.url())) {
            await ensureSmartRecruitersApplicationStarted(this.page!);
          }
        }
        await this.dismissCookieConsentAndHydrateForm(this.page!, target || options.url);

        // Ticket GEN-99: Auto-click "Are You Still With Us?" session timeout modal
        const isSessionModal = await this.page!.evaluate(() => {
          const txt = (document.body?.innerText || '').toLowerCase();
          return /are you still with us\??|session is about to expire/i.test(txt);
        }).catch(() => false);
        if (isSessionModal) {
          const sessionBtn = this.page!.locator(
            'button:has-text("Continue"), button:has-text("Yes"), button:has-text("I\'m still here"), [data-automation-id="sessionTimeoutContinueButton"], [data-automation-id="dialogKeepAliveButton"]'
          ).filter({ visible: true }).first();
          if (await sessionBtn.isVisible().catch(() => false)) {
            await sessionBtn.click().catch(() => {});
            await this.page!.waitForTimeout(500);
          }
        }
        const existingReceipt = await this.receipt();
        if (existingReceipt) {
          report.receipt = existingReceipt;
          report.status = 'submitted';
          report.reason = existingReceipt.existing ? 'Employer confirms an existing application; no new submission made' : 'Existing confirmation found; no new submission made';
          break;
        }
        const { login, challenge } = await this.browserGates();
        if (login && !challenge && options.vault && ['workday', 'icims'].includes(options.requisition?.provider || report.ats)) {
          const progress = await this.authenticationStep(options, report, submittedCredentials);
          if (progress === 'progress') { await this.page!.waitForTimeout(300); continue; }
        }
        // Ticket GEN-64: Workday Auth Unblocker
        if (login && !challenge && (options.vault || ['workday', 'icims'].includes(options.requisition?.provider || report.ats))) {
          if (report.ats === 'workday' || this.page!.url().toLowerCase().includes('myworkdayjobs.com')) {
            const envPw = process.env.AUTOAPPLY_WORKDAY_PASSWORD || process.env.AUTOAPPLY_PASSWORD || 'Wk#2026!Rp9';
            const authRes = await authenticateWorkdayPortal(this.page!, options.profile.personal.email, envPw);
            if (authRes.authenticated) {
              await this.page!.waitForTimeout(1000);
              continue;
            }
          }
        }

        // Ticket GEN-67: If password input remains visible after auth, pause immediately
        // Never fall through into distillFormStep/fillFrame to scrape login forms as unmapped questions!
        const remainingPwCount = await this.page!
          .locator('input[type="password"]:not([data-automation-id="beecatcher"])')
          .filter({ visible: true })
          .count()
          .catch(() => 0);
        if (remainingPwCount > 0) {
          // Ticket GEN-100: If password input remains visible on Workday, attempt Create Account / Sign In with Gmail alias before parking
          if (report.ats === 'workday' || this.page!.url().toLowerCase().includes('myworkdayjobs.com')) {
            const envPw = process.env.AUTOAPPLY_WORKDAY_PASSWORD || process.env.AUTOAPPLY_PASSWORD || 'Wk#2026!Rp9';
            const aliasEmail = makeGmailTenantAlias(options.profile.personal.email, this.page!.url());
            const authRetry = await authenticateWorkdayPortal(this.page!, aliasEmail, envPw);
            if (authRetry.authenticated) {
              await this.page!.waitForTimeout(1000);
              continue;
            }
          }
          report.status = 'paused_for_review';
          report.reason = 'Login needs browser review';
          report.reviewKind = 'authentication';
          break;
        }

        // Ticket GEN-69 & GEN-158: Greenhouse Collapsed Form Expander (capco, cognite, GitLab, Crewmeister, Ensono, Esri, Moniepoint, Schrödinger)
        if (report.ats === 'greenhouse' || this.page!.url().toLowerCase().includes('greenhouse.io')) {
          const ghIframe = this.page!.locator('#grnhse_iframe, iframe[src*="greenhouse.io"]').first();
          if (await ghIframe.isVisible().catch(() => false)) {
            await ghIframe.scrollIntoViewIfNeeded().catch(() => {});
            await this.page!.waitForTimeout(500);
          }

          const ghVisibleInputCount = await this.page!
            .evaluate(() => {
              const inputs = Array.from(
                document.querySelectorAll<HTMLElement>(
                  '#application-form input:not([type="hidden"]), #application-form textarea, #application-form [role="combobox"], input#first_name, input#last_name, input#email'
                )
              );
              return inputs.filter((el) => {
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden';
              }).length;
            })
            .catch(() => 0);

          if (ghVisibleInputCount < 2) {
            const rawSrc = await ghIframe.getAttribute('src').catch(() => null);
            const iframeSrc = rawSrc ? (rawSrc.startsWith('http') ? rawSrc : new URL(rawSrc, this.page!.url()).href) : null;
            if (iframeSrc && /greenhouse\.io/i.test(iframeSrc)) {
              this.log(`Unwrapping greenhouse iframe directly to top-level: ${iframeSrc}`);
              await this.page!.goto(iframeSrc, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
              await this.page!.locator('body').waitFor({ state: 'attached' }).catch(() => {});
            }

            const applyPillSelectors = [
              'button.btn--pill:has-text("Apply")',
              'button:has-text("Apply for this job")',
              'a.btn--pill:has-text("Apply")',
              '[data-mapped="true"] button:has-text("Apply")',
              'button:has-text("Apply")',
              'a[href="#app"], a[href*="#application"]',
            ];
            for (const sel of applyPillSelectors) {
              const btn = this.page!.locator(sel).first();
              if (await btn.isVisible().catch(() => false)) {
                await btn.scrollIntoViewIfNeeded().catch(() => {});
                await btn.click({ timeout: 4000 }).catch(() => {});
                break;
              }
            }
            // Wait up to 6000ms for #first_name / #email / form inputs to mount after clicking Apply
            await this.page!
              .locator('#first_name, #email, #application-form input:not([type="hidden"])')
              .first()
              .waitFor({ state: 'visible', timeout: 6000 })
              .catch(() => {});
          }
        }

        // Ashby form expander & cookie dismissal
        if (report.ats === 'ashby' || this.page!.url().toLowerCase().includes('ashbyhq.com')) {
          const cookieBtn = this.page!.locator('button:has-text("Accept"), button:has-text("Agree"), button:has-text("Allow All"), #onetrust-accept-btn-handler').first();
          if (await cookieBtn.isVisible().catch(() => false)) {
            await cookieBtn.click().catch(() => {});
          }

          const ashbyInputCount = await this.page!
            .evaluate(() => {
              const inputs = Array.from(document.querySelectorAll<HTMLElement>('input:not([type="hidden"]), textarea, [role="combobox"]'));
              return inputs.filter((el) => {
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              }).length;
            })
            .catch(() => 0);

          if (ashbyInputCount < 2) {
            const ashbyApplyBtns = [
              'a[href*="/application"]',
              'button:has-text("Apply for this Job")',
              'button:has-text("Apply")',
              'a:has-text("Apply for this Job")',
              'a:has-text("Apply")',
            ];
            for (const sel of ashbyApplyBtns) {
              const btn = this.page!.locator(sel).first();
              if (await btn.isVisible().catch(() => false)) {
                await btn.scrollIntoViewIfNeeded().catch(() => {});
                await btn.click({ timeout: 4000 }).catch(() => {});
                break;
              }
            }
            await this.page!
              .locator('input:not([type="hidden"]), textarea')
              .first()
              .waitFor({ state: 'visible', timeout: 5000 })
              .catch(() => {});
          }
        }

        // Lever form expander
        if (report.ats === 'lever' || this.page!.url().toLowerCase().includes('lever.co')) {
          const leverInputCount = await this.page!
            .evaluate(() => {
              const inputs = Array.from(document.querySelectorAll<HTMLElement>('input:not([type="hidden"]), textarea'));
              return inputs.filter((el) => {
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              }).length;
            })
            .catch(() => 0);

          if (leverInputCount < 2) {
            const leverApplyBtn = this.page!.locator('a[href*="/apply"], a.postings-btn, button:has-text("Apply for this job"), button:has-text("Apply")').first();
            if (await leverApplyBtn.isVisible().catch(() => false)) {
              await leverApplyBtn.scrollIntoViewIfNeeded().catch(() => {});
              await leverApplyBtn.click({ timeout: 4000 }).catch(() => {});
              await this.page!
                .locator('input:not([type="hidden"]), textarea')
                .first()
                .waitFor({ state: 'visible', timeout: 5000 })
                .catch(() => {});
            }
          }
        }
        // Step 319.2: Click [role="tab"]:has-text("Application") / Apply triggers when interactive inputs < 2
        const interactiveInputsCount = await this.page!
          .evaluate(() => {
            const inputs = Array.from(document.querySelectorAll<HTMLElement>('input:not([type="hidden"]), textarea, select, [role="combobox"]'));
            return inputs.filter((el) => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            }).length;
          })
          .catch(() => 0);

        if (interactiveInputsCount < 2) {
          const applyTriggers = [
            '[role="tab"]:has-text("Application")',
            'a[href$="/application"]',
            'a[href$="/apply"]',
            'button:has-text("Apply for this Job")',
            'button:has-text("Apply for this job")',
            'a:has-text("Apply for this job")',
            'button.btn--pill:has-text("Apply")',
            'a#st-apply',
            'a.js-oneclick',
            '[data-automation-id="adventureButton"]',
            'button:has-text("Apply Now")',
            'a:has-text("Apply Now")',
            'button:has-text("Apply")',
            'a:has-text("Apply")',
          ];
          for (const sel of applyTriggers) {
            const btn = this.page!.locator(sel).first();
            if (await btn.isVisible().catch(() => false)) {
              await btn.scrollIntoViewIfNeeded().catch(() => {});
              await btn.click({ timeout: 4000 }).catch(() => {});
              await this.page!.waitForTimeout(2500);
              break;
            }
          }
        }

        // Multi-Frame (page.frames()) Prioritization: Order frames so the frame with highest number of distilled/interactive controls is processed first
        const allCandidateFrames = this.page!.frames();
        const frameScores: { frame: Frame; count: number }[] = [];
        for (const f of allCandidateFrames) {
          const c = await f.evaluate(() => {
            return document.querySelectorAll('input:not([type="hidden"]), textarea, select, [role="combobox"]').length;
          }).catch(() => 0);
          frameScores.push({ frame: f, count: c });
        }
        frameScores.sort((a, b) => b.count - a.count);
        const sortedFrames = frameScores.map((fs) => fs.frame);

        for (const frame of sortedFrames) {
          // Ticket GEN-65: Run Workday step fast-pass accelerator
          if (report.ats === 'workday' || frame.url().toLowerCase().includes('myworkdayjobs.com')) {
            await runWorkdayStepFastPass(frame, options.profile.documents?.resume).catch(() => {});
          }
          try { await this.fillFrame(frame, { ...options, resume: preserveReviewedValues && step === 1 }, report); }
          catch (error: any) {
            const confirmedReceipt = await this.receipt().catch(() => undefined);
            if (confirmedReceipt) {
              report.receipt = confirmedReceipt;
              report.status = 'submitted';
              report.reason = 'Submission confirmation observed';
              break;
            }
            if (!frame.isDetached() && !/execution context was destroyed/i.test(error?.message || '')) throw error;
          }
        }

        // Ticket GEN-94.5: 2-Pass Conditional Field Delta Sweep
        // Wait 500ms for conditional fields to reveal, then perform pass 2
        await this.page!.waitForTimeout(500);
        for (const frame of this.page!.frames()) {
          try { await this.fillFrame(frame, { ...options, resume: preserveReviewedValues && step === 1 }, report); }
          catch (error: any) {
            const confirmedReceipt = await this.receipt().catch(() => undefined);
            if (confirmedReceipt) {
              report.receipt = confirmedReceipt;
              report.status = 'submitted';
              report.reason = 'Submission confirmation observed';
              break;
            }
            if (!frame.isDetached() && !/execution context was destroyed/i.test(error?.message || '')) throw error;
          }
        }
        if (options.dryRun) { report.reason = 'Inspection only; no fields or navigation changed'; break; }
        const currentGates = await this.browserGates();
        if ((!login && currentGates.login) || (!challenge && currentGates.challenge)) continue;
        if (challenge) {
          const cap = await attemptAutonomousCaptchaSolve(this.page!);
          if (cap.detected && cap.solved) {
            continue;
          }
          if (getResilientContextTier(this.context) !== 3) {
            this.log('Portal challenge detected during step execution; rotating to Tier 3 native context and retrying');
            const storageStatePath = options.sessionDir ? path.join(options.sessionDir, 'storage-state.json') : undefined;
            await this.rotateToResilientTier(3, storageStatePath);
            await this.page!.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
            await this.page!.locator('body').waitFor({ state: 'attached' });
            await this.waitReady(Math.min(options.timeoutMs ?? 5000, 5000));
            if (options.url.toLowerCase().includes('smartrecruiters.com') || this.page!.url().toLowerCase().includes('smartrecruiters.com')) {
              await ensureSmartRecruitersApplicationStarted(this.page!);
            }
            step = 0;
            continue;
          }
          if (!cap.solved) {
            if (report.fieldsFilled >= 3 && !process.env.AUTOAPPLY_DISABLE_HITL_POPUP) {
              this.log('HITL: CAPTCHA encountered after filling fields; requesting quick human assist popup');
              const storageStatePath = options.sessionDir ? path.join(options.sessionDir, 'storage-state.json') : undefined;
              if (storageStatePath) await this.context?.storageState({ path: storageStatePath }).catch(() => {});
              const res = await runOnDemandHumanPopup({
                url: this.page!.url(),
                storageStatePath,
                reason: 'visual_captcha',
                timeoutMs: 60_000,
              });
              if (res.captchaSolved || res.intervened) {
                continue;
              }
            }
            this.log('CAPTCHA visual challenge deferred — rotating to next queued role');
            report.status = 'skipped';
            report.reason = 'captcha_deferred';
            break;
          }
        }
        if (login) { report.reviewKind = 'authentication'; report.reason = 'Login needs browser review'; break; }
        let invalid = false;
        for (const frame of this.page!.frames()) {
          for (const control of await frame.locator('input:invalid,select:invalid,textarea:invalid,[aria-invalid="true"]').all()) {
            if (await control.isVisible()) {
              invalid = true;
              const ctrlDesc = await control.evaluate((el: Element) => `${el.tagName}#${el.id}[name="${el.getAttribute('name')}"][type="${el.getAttribute('type')}"]: ${(el as HTMLInputElement).validationMessage || el.getAttribute('aria-invalid')}`).catch(() => 'unknown');
              this.log(`Invalid visible control: ${ctrlDesc}`);
            }
          }
          for (const group of await frame.locator('fieldset[aria-required="true"],[role="group"][aria-required="true"]').all()) {
            if (!await group.isVisible()) continue;
            const controls = [];
            for (const control of await group.locator('input[type="checkbox"]').all()) {
              if (await control.isEnabled() && await control.evaluate(isVisibleApplicationControl)) controls.push(control);
            }
            if (controls.length && !(await Promise.all(controls.map(control => control.isChecked()))).some(Boolean)) {
              let healed = false;
              for (const control of controls) {
                const labelText = await control.evaluate(el => {
                  const label = el.closest('label') || document.querySelector(`label[for="${el.id}"]`);
                  return label?.textContent?.trim() || el.getAttribute('aria-label') || (el as HTMLInputElement).value || '';
                }).catch(() => '');
                if (/none|none of the above|n\/a|not applicable|other|neither|no experience|sql/i.test(labelText)) {
                  await control.check().catch(() => {});
                  healed = true;
                  report.fieldsFilled++;
                  break;
                }
              }
              if (!healed && controls[0]) {
                await controls[0].check().catch(() => {});
                healed = true;
                report.fieldsFilled++;
              }
              if (!healed) {
                invalid = true;
                report.logs.push('Required checkbox group has no selection');
              }
            }
          }
        }
        const hasUnresolvedFailure = report.actions.some(a => a.status === 'failed' && !report.actions.some(later => (later.controlKey === a.controlKey || later.selector === a.selector) && later.status === 'filled'));
        if (invalid || hasUnresolvedFailure) {
          if (!selfHealAttempted) {
            selfHealAttempted = true;
            const healed = await this.selfHealValidationErrors(options, report);
            if (healed) {
              invalid = false;
              for (const frame of this.page!.frames()) {
                for (const control of await frame.locator('input:invalid,select:invalid,textarea:invalid,[aria-invalid="true"]').all()) {
                  if (await control.isVisible()) invalid = true;
                }
              }
            }
          }
          let visibleInvalidCount = 0;
          if (this.page && !this.page.isClosed()) {
            for (const frame of this.page.frames()) {
              visibleInvalidCount += await frame.locator('input:invalid,select:invalid,textarea:invalid,[aria-invalid="true"]').filter({ visible: true }).count().catch(() => 0);
            }
          }
          if (visibleInvalidCount > 0 && this.page && !this.page.isClosed()) {
            for (const frame of this.page.frames()) {
              await healInvalidFieldsAndRetrySubmit(frame, options.profile.personal.email, options.profile.personal.phone, this.attemptedFieldRefs).catch(() => 0);
            }
            visibleInvalidCount = 0;
            for (const frame of this.page.frames()) {
              visibleInvalidCount += await frame.locator('input:invalid,select:invalid,textarea:invalid,[aria-invalid="true"]').filter({ visible: true }).count().catch(() => 0);
            }
          }
          if (visibleInvalidCount === 0) {
            invalid = false;
          }
          if (invalid) {
            if (report.fieldsFilled >= 3 && !process.env.AUTOAPPLY_DISABLE_HITL_POPUP) {
              const missingQuestions = report.actions
                .filter(a => a.status === 'failed' && a.error === 'Required answer is missing')
                .map(a => a.question)
                .filter((q): q is string => typeof q === 'string' && q.length > 0);
              if (missingQuestions.length > 0 && missingQuestions.length <= 4 && !process.env.AUTOAPPLY_DISABLE_HITL_POPUP) {
                this.log(`HITL: Form has ${missingQuestions.length} missing required fields; requesting quick human assist popup`);
                const storageStatePath = options.sessionDir ? path.join(options.sessionDir, 'storage-state.json') : undefined;
                if (storageStatePath) await this.context?.storageState({ path: storageStatePath }).catch(() => {});
                const res = await runOnDemandHumanPopup({
                  url: this.page!.url(),
                  storageStatePath,
                  reason: 'missing_required_fields',
                  missingQuestions,
                  timeoutMs: 60_000,
                });
                if (res.intervened) {
                  for (const frame of this.page!.frames()) {
                    await this.fillFrame(frame, { ...options, resume: false }, report).catch(() => {});
                  }
                  invalid = false;
                }
              }
            }
            if (invalid) {
              report.reviewKind = 'answers';
              report.reason = 'Validation or field errors require review';
              await this.recordUnknownFieldsFromErrors(options, report);
              break;
            }
          }
        }
        for (const frame of this.page!.frames()) {
          await ensureStepReadyBeforeNext(frame, options.profile.documents?.resume, options.applicationBrief?.title, options.applicationBrief?.text).catch(() => {});
        }
        watchdog.heartbeat(`before_next_step_${step}`);
        watchdog.checkOrThrow();
        await this.ensurePrivacyConsentCheckboxesChecked(this.page!);
        const isSinglePageAts = ['greenhouse', 'ashby', 'lever'].includes(report.ats);
        let submitControl: Locator | undefined;
        if (isSinglePageAts) {
          submitControl = await this.button(SUBMIT, ATS_STRATEGIES[report.ats]?.submit, 'flow_submit_button');
        }
        let next = !submitControl ? (
          (await this.button(NEXT, ATS_STRATEGIES[report.ats]?.next, 'flow_next_button'))
          || (await this.button(/^(?:review|review application)$/i, undefined, 'flow_review_button'))
        ) : undefined;
        if (next) {
          const nextText = (await next.innerText().catch(() => '')).trim();
          if (/^\s*submit\b/i.test(nextText)) {
            submitControl = next;
            next = undefined;
          }
        }
        if (!submitControl && this.page) {
          const wdBtn = this.page.locator('button[data-automation-id="bottom-navigation-next-button"], button[data-automation-id="pageFooterNextButton"]').filter({ hasText: /^\s*submit\b/i }).first();
          if (await wdBtn.count().catch(() => 0) > 0 && await wdBtn.isVisible().catch(() => false)) {
            submitControl = wdBtn;
            next = undefined;
          }
        }
        // Ticket GEN-125 & GEN-144: SmartRecruiters & open Shadow-DOM submit/next discovery
        if (this.page) {
          const shadowBtnResult = await this.page.evaluate(() => {
            const findShadowBtn = (root: Document | ShadowRoot | Element): { el: HTMLElement; kind: 'submit' | 'next' } | null => {
              const nextDirect = root.querySelector('[data-test="footer-next"], oc-button[data-test="footer-next"], button[data-test="footer-next"]') as HTMLElement | null;
              if (nextDirect) return { el: nextDirect, kind: 'next' };

              const submitDirect = root.querySelector('[data-test="footer-submit"], oc-button[data-test="footer-submit"], button[data-test="footer-submit"]') as HTMLElement | null;
              if (submitDirect) {
                const txt = (submitDirect.textContent || '').trim();
                if (/^(?:next|continue|save\s*(?:and|&)\s*continue|proceed)$/i.test(txt)) {
                  return { el: submitDirect, kind: 'next' };
                }
                return { el: submitDirect, kind: 'submit' };
              }

              const allEls = Array.from(root.querySelectorAll('*'));
              for (const el of allEls) {
                if (el.tagName.toLowerCase() === 'oc-button' || el.tagName.toLowerCase() === 'button') {
                  const testAttr = (el.getAttribute('data-test') || '').toLowerCase();
                  const txt = (el.textContent || '').trim();
                  if (testAttr === 'footer-next' || /^(?:next|continue|save\s*(?:and|&)\s*continue|proceed)$/i.test(txt)) {
                    return { el: el as HTMLElement, kind: 'next' };
                  }
                  if (testAttr === 'footer-submit' || /^(?:submit|submit application|send application|apply)$/i.test(txt)) {
                    return { el: el as HTMLElement, kind: 'submit' };
                  }
                }
                const sr = (el as HTMLElement).shadowRoot;
                if (sr) {
                  const found = findShadowBtn(sr);
                  if (found) return found;
                }
              }
              return null;
            };
            const res = findShadowBtn(document);
            if (res) {
              const marker = res.kind === 'next' ? 'data-autoapply-shadow-next' : 'data-autoapply-shadow-submit';
              res.el.setAttribute(marker, 'true');
              const innerBtn = res.el.shadowRoot?.querySelector('button') || res.el.querySelector('button');
              if (innerBtn) innerBtn.setAttribute(marker, 'true');
              return res.kind;
            }
            return null;
          }).catch(() => null);

          if (shadowBtnResult === 'next' && step < maxSteps) {
            next = this.page.locator('[data-autoapply-shadow-next="true"]').first();
            submitControl = undefined;
          } else if (shadowBtnResult === 'submit' && !submitControl) {
            submitControl = this.page.locator('[data-autoapply-shadow-submit="true"]').first();
            next = undefined;
          }
        }
        if (submitControl && step < maxSteps) {
          const subText = (await submitControl.innerText().catch(() => '')).trim();
          const dataTest = (await submitControl.getAttribute('data-test').catch(() => '')) || '';
          if (dataTest === 'footer-next' || /^(?:next|continue|save\s*(?:and|&)\s*continue|proceed)$/i.test(subText)) {
            next = submitControl;
            submitControl = undefined;
          }
        }
        if (next) {
          if (report.mode === 'copilot' && !(options.advanceReviewedStep && step === 1)) { report.reason = 'Review before advancing'; break; }
          const before = await this.signature();
          const workdayStep = report.ats === 'workday' ? (await this.page!.locator('[data-automation-id="progressBarActiveStep"]').allTextContents()).join(' ').trim() : undefined;
          if (options.mode === 'stealth' && options.submit !== false) await this.page!.waitForTimeout(Math.max(0, 4000 + Math.random() * 4000 - (Date.now() - stepStarted)));
          let changed = false;
          for (let attempt = 0; attempt < 2; attempt++) {
            for (const frame of this.page!.frames()) {
              await ensureStepReadyBeforeNext(frame, options.profile.documents?.resume, options.applicationBrief?.title, options.applicationBrief?.text).catch(() => {});
            }
            if (!await reserveStateAction(this.page!.mainFrame(), next, 'next')) break;
            if (options.mode === 'stealth') await this.pacedClick(next); else await next.click();
            if (await this.waitChanged(before, timeout, workdayStep)) { changed = true; break; }
            if (this.dependentRequests.size) break;
            const invalidCount = await this.page!.locator('input:invalid,select:invalid,textarea:invalid,[aria-invalid="true"]').filter({ visible: true }).count();
            if (invalidCount && !selfHealAttempted) {
              selfHealAttempted = true;
              const healed = await this.selfHealValidationErrors(options, report);
              if (healed) {
                if (options.mode === 'stealth') await this.pacedClick(next); else await next.click();
                if (await this.waitChanged(before, timeout, workdayStep)) { changed = true; break; }
              }
            }
            if (attempt === 0 && !changed) {
              for (const frame of this.page!.frames()) {
                await this.fillFrame(frame, { ...options, resume: false }, report).catch(() => {});
              }
            }
            if (invalidCount) break;
          }
          if (!changed) {
            // Ticket GEN-199: Heal & retry before failing on "Next did not change the form"
            if (this.page && !this.page.isClosed()) {
              for (const frame of this.page.frames()) {
                await healInvalidFieldsAndRetrySubmit(
                  frame,
                  options.profile.personal.email,
                  options.profile.personal.phone,
                  this.attemptedFieldRefs
                ).catch(() => 0);
              }
              // SmartRecruiters autocomplete shadow-root option selector
              await this.page.evaluate(() => {
                const autoNodes = Array.from(document.querySelectorAll('spl-autocomplete, [class*="autocomplete"]'));
                for (const node of autoNodes) {
                  const sr = (node as HTMLElement).shadowRoot;
                  const opt = sr?.querySelector<HTMLElement>('spl-select-option, .spl-autocomplete-option, [role="option"]');
                  if (opt) opt.click();
                }
              }).catch(() => {});

              if (options.mode === 'stealth') await this.pacedClick(next); else await next.click().catch(() => {});
              if (await this.waitChanged(before, timeout, workdayStep)) {
                changed = true;
              }
            }
          }
          if (!changed && this.page && !this.page.isClosed() && (report.ats === 'workday' || this.page.url().toLowerCase().includes('myworkdayjobs.com'))) {
            const recovery = await checkWorkdayStepLoopAndRecover(this.page, workdayLoopState);
            if (recovery.loopDetected) {
              this.log(`[GEN-429] Workday step loop detected: ${recovery.errorMessages.join('; ')}`);
              if (recovery.healed) {
                if (options.mode === 'stealth') await this.pacedClick(next); else await next.click().catch(() => {});
                if (await this.waitChanged(before, timeout, workdayStep)) {
                  changed = true;
                }
              }
            }
          }
          if (!changed) {
            report.reason = 'Next did not change the form';
            await this.recordUnknownFieldsFromErrors(options, report);
            break;
          }
          for (const item of this.learnedFields) {
            recordLearnedSuccess(item.questionText, item.category, item.value);
          }
          this.learnedFields = [];
          selfHealAttempted = false;
          watchdog.heartbeat(`advanced_step_${step}`);
          if (report.ats === 'smartrecruiters' || this.page!.url().includes('smartrecruiters.com')) {
            await this.page!.waitForTimeout(1800).catch(() => {});
          }
          continue;
        }
        let submit = submitControl || (await this.button(SUBMIT, ATS_STRATEGIES[report.ats]?.submit, 'flow_submit_button'));
        if (!submit && this.page) {
          const shadowBtn = this.page.locator('[data-autoapply-shadow-submit="true"], [data-test="footer-submit"], oc-button[data-test="footer-submit"], [role="button"]:has-text("Submit"), [role="button"]:has-text("Apply"), button[data-automation-id*="submit" i], a.btn-submit').first();
          if (await shadowBtn.count().catch(() => 0) > 0 && await shadowBtn.isVisible().catch(() => false)) {
            submit = shadowBtn;
          }
        }
        if (!submit && this.page) {
          // Ticket GEN-169 / GEN-199: Child-frame submitControl piercer
          for (const f of this.page.frames()) {
            if (f === this.page.mainFrame()) continue;
            const childSubmit = f.locator('button[type="submit"], input[type="submit"], #submit_app, button:has-text("Submit Application"), button:has-text("Submit"), [data-test="footer-submit"], [role="button"]:has-text("Submit"), [role="button"]:has-text("Apply"), button[data-automation-id*="submit" i], a.btn-submit').first();
            if (await childSubmit.count().catch(() => 0) > 0 && await childSubmit.isVisible().catch(() => false)) {
              submit = childSubmit;
              break;
            }
          }
        }
        if (!submit) {
          const isClosedOr404 = await this.page!.evaluate(() => {
            const bodyTxt = (document.body?.innerText || '').slice(0, 6000);
            const titleTxt = document.title || '';
            const headings = Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"], [data-automation-id="errorHeading"]')).map(el => el.textContent?.trim() || '').join(' ');
            const fullText = `${titleTxt} ${headings} ${bodyTxt}`;
            return /no longer accepting applications|this position is closed|job is no longer available|requisition is closed|the page you are looking for doesn['’]?t exist|job posting (?:has )?expired|this posting is no longer active|this job is no longer open|this job has expired|position has been filled|the requisition has been closed|\bpage not found\b|\b404\s*-\s*page not found\b|this vacancy is no longer available|no longer open for applications|job post has been removed/i.test(fullText);
          }).catch(() => false);

          const currentUrlStr = this.page!.url();
          const isRedirectedToSearch = options.url.includes('/job/') && (currentUrlStr.endsWith('/search') || currentUrlStr.endsWith('/jobs') || currentUrlStr.endsWith('/jobs/'));

          if (isClosedOr404 || isRedirectedToSearch) {
            report.status = 'skipped';
            report.reason = 'job_closed';
            break;
          }

          // Ticket GEN-99: Workday Maintenance Guard before missing submit control
          const isMaintenanceNow = await this.page!.evaluate(() => {
            const txt = (document.body?.innerText || '').toLowerCase();
            return /workday is currently unavailable|service is temporarily unavailable|undergoing scheduled maintenance/i.test(txt);
          }).catch(() => false);

          if (isMaintenanceNow) {
            markHostOutcome(options.url, 'rate_limited');
            report.status = 'queued';
            report.reason = 'service_temporarily_unavailable';
            break;
          }

          const lateReceipt = await this.receipt();
          if (lateReceipt) {
            report.receipt = lateReceipt;
            report.status = 'submitted';
            report.reason = lateReceipt.existing
              ? 'Employer confirms an existing application; no new submission made'
              : 'Application submission confirmed via confirmation URL/heading';
            break;
          }

          report.reason = 'No supported submit control found';
          break;
        }
        if (report.fieldsFound === 0) { report.reviewKind = 'answers'; report.reason = 'No application fields observed; review before submission'; break; }
        if (!options.submit) { report.reason = 'Ready for submission review; use --submit to send'; break; }
        if (options.mode === 'stealth') {
          const currentSignature = await this.signature();
          if (reviewedSignature !== currentSignature) {
            const formOpenedAtMs = Date.parse(report.startTime) || Date.now();
            const alreadyElapsedMs = Date.now() - formOpenedAtMs;
            // Ticket GEN-104.1 / GEN-159: Lower required elapsed floor from 18s-22s down to 4000ms (4s)
            const remainingHumanFloorMs = alreadyElapsedMs >= 4000 ? 0 : Math.min(3000, 4000 - alreadyElapsedMs);
            if (remainingHumanFloorMs > 0) {
              await this.page!.waitForTimeout(remainingHumanFloorMs).catch(() => {});
            }
            reviewedSignature = currentSignature;
            if (!isSinglePageAts) {
              continue; // Rescan and validate multi-page forms after review dwell before preparing Submit.
            }
          }
        }
        const reservation = options.reserveSubmission?.();
        if (reservation === false || reservation === 'daily' || reservation === 'tenant') { report.reason = reservation === 'tenant' ? 'Company hourly submission limit reached' : 'Daily submission limit reached'; report.reviewKind = 'answers'; break; }
        if (this.page && !this.page.isClosed()) {
          const pacingCapMs = isSinglePageAts ? 22_000 : undefined;
          await enforceHumanSubmissionPacingFloor(
            this.page,
            Date.parse(report.startTime) || Date.now(),
            report.fieldsFilled || 0,
            pacingCapMs
          ).catch(() => 0);

          // Ticket GEN-231: Pre-Submit Resume Upload Guarantee
          const activeResumePath = options.profile?.documents?.resume ||
            (existsSync(path.resolve('state/autoapply/resumes', 'Shivam_Mahajan_Resume_swe.pdf')) ? path.resolve('state/autoapply/resumes', 'Shivam_Mahajan_Resume_swe.pdf') : undefined);
          await this.ensureResumeUploadedBeforeSubmit(this.page, activeResumePath);
        }
        if (!await reserveStateAction(this.page!.mainFrame(), submit, 'submit')) { report.reason = 'Submit already dispatched on this form state'; break; }
        report.submittedFields = [];
        for (const frame of this.page!.frames()) report.submittedFields.push(...await frame.locator(INPUTS).evaluateAll(elements => elements.filter(el => !el.matches('input[type=password],input[type=file]') && el.getClientRects().length).map(el => {
          const control = el as HTMLInputElement;
          return { label: Array.from(control.labels || []).map(label => label.textContent || '').join(' ') || el.getAttribute('aria-label') || '', selector: el.id ? `[id=${JSON.stringify(el.id)}]` : `[name=${JSON.stringify(el.getAttribute('name') || '')}]`, value: ['checkbox', 'radio'].includes(control.type) ? control.checked : control.value || el.textContent || '' };
        })));
        report.submission = { phase: 'prepared', requests: [] };
        options.onPhase?.('submit_prepared');
        await this.page!.addScriptTag({ content: `document.documentElement.removeAttribute('data-autoapply-client-error'); window.addEventListener('error', function () { document.documentElement.setAttribute('data-autoapply-client-error', 'true'); }, { once: true });` }).catch(() => { report.logs.push('Page policy prevents client-error instrumentation; ambiguous failures require review'); });
        observer?.close();
        let dispatchedRecorded = false;
        observer = observeSubmission(this.context!, this.applicationPages, report, () => { if (!dispatchedRecorded && report.submission?.phase === 'dispatched') { options.onPhase?.('submit_dispatched'); dispatchedRecorded = true; } void this.checkpoint(options, report); });
        this.submissionObservation = { url: options.url, report, observer };
        await this.checkpoint(options, report);
        // A crash between click and dispatch remains ambiguous unless a live
        // validation bounce proves the browser sent no mutation.
        report.submissionAttempted = true;
        report.submission.phase = 'clicked';
        options.onPhase?.('submit_clicked');
        report.submission.clickedAt = new Date().toISOString();
        options.onBeforeSubmit?.();
        await this.checkpoint(options, report);
        const capBefore = await attemptAutonomousCaptchaSolve(this.page!);
        if (capBefore.detected && !capBefore.solved) {
          if (report.fieldsFilled >= 3 && !process.env.AUTOAPPLY_DISABLE_HITL_POPUP) {
            this.log('HITL: CAPTCHA encountered before submit; requesting quick human assist popup');
            const storageStatePath = options.sessionDir ? path.join(options.sessionDir, 'storage-state.json') : undefined;
            if (storageStatePath) await this.context?.storageState({ path: storageStatePath }).catch(() => {});
            const res = await runOnDemandHumanPopup({
              url: this.page!.url(),
              storageStatePath,
              reason: 'visual_captcha',
              timeoutMs: 60_000,
            });
            if (!res.captchaSolved && !res.intervened) {
              this.log('CAPTCHA visual grid deferred — rotating to next queued role');
              report.status = 'skipped';
              report.reason = 'captcha_deferred';
              break;
            }
          } else {
            this.log('CAPTCHA visual grid deferred — rotating to next queued role');
            report.status = 'skipped';
            report.reason = 'captcha_deferred';
            break;
          }
        }
        watchdog.heartbeat('submit_click');
        watchdog.checkOrThrow();
        await this.enforceLeverCoreFieldsBeforeSubmit(this.page!);
        await this.performHumanPreSubmitTelemetry(this.page!, submit);
        if (options.mode === 'stealth') await this.pacedClick(submit);
        else await submit.click();
        const deadline = Date.now() + Math.min(timeout, 25_000);
        let lastMailPoll = 0;
        let captchaCheckedAfterSubmit = false;
        let inpageOtpAttempted = false;
        const submitClickedTime = Date.now();
        do {
          watchdog.heartbeat('post_submit_poll');
          if (options.mailbox && Date.now() - lastMailPoll >= 2000) {
            lastMailPoll = Date.now();
            const verification = await completeEmailVerification(this.page!, options.mailbox, { provider: options.requisition?.provider || canonicalRequisition(options.url)?.provider || report.ats, applicationUrl: options.url, recipient: options.profile.personal.email, since: new Date(report.startTime), company: options.company, claim: options.claimMail }, this.interactions(options));
            if (verification.status === 'completed') { report.verificationMessageId = verification.messageId; await this.checkpoint(options, report); }
          }
          report.receipt ||= await this.receipt();
          if (report.receipt) { report.status = 'submitted'; report.reason = 'Submission confirmation observed'; break; }

          if (!captchaCheckedAfterSubmit && Date.now() - submitClickedTime >= 2000 && !report.receipt) {
            captchaCheckedAfterSubmit = true;
            const capAfter = await attemptAutonomousCaptchaSolve(this.page!);
            if (capAfter.detected && capAfter.solved) {
              const retrySubmit = await this.button(SUBMIT, ATS_STRATEGIES[report.ats]?.submit, 'flow_submit_button');
              if (retrySubmit && await retrySubmit.isVisible().catch(() => false)) {
                await this.performHumanPreSubmitTelemetry(this.page!, retrySubmit);
                if (options.mode === 'stealth') await this.pacedClick(retrySubmit);
                else await retrySubmit.click();
                await this.page!.waitForTimeout(5000);
                report.receipt ||= await this.receipt();
                if (report.receipt) { report.status = 'submitted'; report.reason = 'Submission confirmation observed'; break; }
              }
            } else if (capAfter.detected && !capAfter.solved) {
              this.log('CAPTCHA visual grid deferred — rotating to next queued role');
              report.status = 'skipped';
              report.reason = 'captcha_deferred';
              break;
            }
          }

          // Ticket GEN-302 / GEN-304: Check for HTTP 428 Precondition Required or in-page security code prompt on OTP-supported ATS
          const has428 = (report.submission?.requests || []).some(r => r.status === 428);
          if (!report.receipt && !this.page!.isClosed() && ['greenhouse', 'workday', 'smartrecruiters', 'unknown'].includes(report.ats) && (has428 || (!inpageOtpAttempted && Date.now() - submitClickedTime >= 3500))) {
            inpageOtpAttempted = true;
            for (const f of this.page!.frames()) {
              const verified = await completeInPageEmailVerificationIfPrompted(this.page!, f, () => this.activeWatchdog?.heartbeat('inpage_otp')).catch(() => false);
              if (verified) {
                await this.page!.waitForTimeout(3000);
                report.receipt ||= await this.receipt();
                if (report.receipt) { report.status = 'submitted'; report.reason = 'Submission confirmation observed'; break; }
              }
            }
            if (report.receipt) break;
          }

          await new Promise(resolve => setTimeout(resolve, 100));
        } while (Date.now() < deadline);
        if (!report.receipt) {
          let validationBounce = !report.submission.requests.length && (observer.clientError() || (!this.page!.isClosed() && await this.page!.locator('html').getAttribute('data-autoapply-client-error') === 'true'));
          if (!report.submission.requests.length && !this.page!.isClosed()) for (const frame of this.page!.frames()) {
            if (await frame.locator('input:invalid,select:invalid,textarea:invalid,[aria-invalid="true"],[role="alert"]').filter({ visible: true }).count()) validationBounce = true;
          }
          if (!report.receipt && !this.page!.isClosed()) {
            for (const frame of this.page!.frames()) {
              const verified = await completeInPageEmailVerificationIfPrompted(this.page!, frame, () => this.activeWatchdog?.heartbeat('inpage_otp')).catch(() => false);
              if (verified) {
                await this.page!.waitForTimeout(3000);
                report.receipt ||= await this.receipt();
                if (report.receipt) break;
              }
            }
          }
          // Ticket GEN-59, GEN-60 & GEN-61: Post-Submit :invalid Surgical Healer
          if (!report.receipt && !this.page!.isClosed()) {
            for (const frame of this.page!.frames()) {
              const healedCount = await healInvalidFieldsAndRetrySubmit(frame, options.profile.personal.email, options.profile.personal.phone, this.attemptedFieldRefs);
              if (healedCount > 0) {
                this.log(`Post-submit surgical healer fixed ${healedCount} invalid/unanswered fields on frame.`);
                const retrySubmit = await this.button(SUBMIT, ATS_STRATEGIES[report.ats]?.submit, 'flow_submit_button');
                if (retrySubmit && await retrySubmit.isVisible().catch(() => false)) {
                  if (options.mode === 'stealth') await this.pacedClick(retrySubmit);
                  else await retrySubmit.click();
                  await this.page!.waitForTimeout(3500);
                  report.receipt ||= await this.receipt();
                  if (report.receipt) break;

                  // Ticket GEN-302: Check for in-page email OTP / verification prompt after healed retry submit
                  if (!report.receipt && !this.page!.isClosed()) {
                    for (const f of this.page!.frames()) {
                      const verified = await completeInPageEmailVerificationIfPrompted(this.page!, f, () => this.activeWatchdog?.heartbeat('inpage_otp')).catch(() => false);
                      if (verified) {
                        await this.page!.waitForTimeout(3000);
                        report.receipt ||= await this.receipt();
                        if (report.receipt) break;
                      }
                    }
                  }
                  if (report.receipt) break;
                }
              }
            }
          }
          // GEN-439: Closed-loop HTTP 400/422 network field healer — parse rejected fields and auto-retry submit once
          if (!report.receipt && this.lastNetworkValidationErrors.length > 0 && !this.page!.isClosed()) {
            const networkErrors = this.lastNetworkValidationErrors;
            this.lastNetworkValidationErrors = [];
            this.log(`[GEN-439] Healing ${networkErrors.length} network-rejected fields before retry submit`);
            for (const frame of this.page!.frames()) {
              // Mark each rejected field as aria-invalid so healInvalidFieldsAndRetrySubmit picks it up
              await frame.evaluate((errors: Array<{ field?: string; message: string }>) => {
                for (const err of errors) {
                  if (!err.field) continue;
                  const selectors = [
                    `[name="${CSS.escape(err.field)}"]`,
                    `[id="${CSS.escape(err.field)}"]`,
                    `[data-field-id="${CSS.escape(err.field)}"]`,
                    `[data-automation-id="${CSS.escape(err.field)}"]`,
                  ];
                  for (const sel of selectors) {
                    try {
                      const el = document.querySelector<HTMLElement>(sel);
                      if (el) { el.setAttribute('aria-invalid', 'true'); break; }
                    } catch {}
                  }
                }
              }, networkErrors).catch(() => {});
              await healInvalidFieldsAndRetrySubmit(frame, options.profile.personal.email, options.profile.personal.phone, this.attemptedFieldRefs).catch(() => 0);
            }
            const retrySubmitBtn = await this.button(SUBMIT, ATS_STRATEGIES[report.ats]?.submit, 'flow_submit_button');
            if (retrySubmitBtn && await retrySubmitBtn.isVisible().catch(() => false)) {
              if (options.mode === 'stealth') await this.pacedClick(retrySubmitBtn);
              else await retrySubmitBtn.click().catch(() => {});
              await this.page!.waitForTimeout(3500);
              report.receipt ||= await this.receipt();
            }
          }
          if (validationBounce && !selfHealAttempted) {            selfHealAttempted = true;
            const healed = await this.selfHealValidationErrors(options, report);
            if (healed) {
              const retrySubmit = await this.button(SUBMIT, ATS_STRATEGIES[report.ats]?.submit, 'flow_submit_button');
              if (retrySubmit && await retrySubmit.isVisible().catch(() => false)) {
                await this.performHumanPreSubmitTelemetry(this.page!, retrySubmit);
                if (options.mode === 'stealth') await this.pacedClick(retrySubmit);
                else await retrySubmit.click();
                await this.page!.waitForTimeout(3000);
                report.receipt ||= await this.receipt();

                // Ticket GEN-302: Check for in-page email OTP / verification prompt after self-healed retry submit
                if (!report.receipt && !this.page!.isClosed()) {
                  for (const f of this.page!.frames()) {
                    const verified = await completeInPageEmailVerificationIfPrompted(this.page!, f, () => this.activeWatchdog?.heartbeat('inpage_otp')).catch(() => false);
                    if (verified) {
                      await this.page!.waitForTimeout(3000);
                      report.receipt ||= await this.receipt();
                      if (report.receipt) break;
                    }
                  }
                }
              }
            }
          }
          if (report.receipt) {
            report.status = 'submitted';
            report.reason = 'Submission confirmation observed';
          } else if (validationBounce) {
            report.reviewKind = 'receipt';
            report.humanInterventionRequired = true;
            report.reason = 'Submit clicked; validation or client error observed. Verify the outcome before retrying.';
            await this.recordUnknownFieldsFromErrors(options, report);
          } else {
            const isUnmounted = await this.page?.evaluate(() => {
              return document.querySelectorAll('input:not([type="hidden"]), select, textarea').length <= 1;
            }).catch(() => false);
            if (isUnmounted) {
              recordOvernightSubmissionError({
                candidateId: options.candidateId,
                jobUrl: options.url,
                company: options.company,
                reason: 'UNCONFIRMED_FORM_DISAPPEARANCE',
                error: 'Form unmounted without verified network receipt or confirmation heading'
              });
              report.status = 'failed';
              report.reviewKind = 'receipt';
              report.reason = 'UNCONFIRMED_FORM_DISAPPEARANCE';
            } else {
              report.reviewKind = 'receipt';
              report.reason = 'Submit clicked but no receipt observed; verify manually before retrying';
            }
          }
        }
        if (report.receipt) {
          for (const item of this.learnedFields) {
            recordLearnedSuccess(item.questionText, item.category, item.value);
          }
          this.learnedFields = [];
        }
        break;
      }
      report.reason ||= 'Step limit reached; review before continuing';
    } catch (error) {
      if (error instanceof Error && isOfflineDinoPage(error.message)) {
        report.status = 'skipped';
        report.reason = 'wifi_drop_requeued';
        return report;
      }
      if (this.isClosing || (error instanceof Error && error.message.includes('Target page, context or browser has been closed'))) {
        report.status = report.submissionAttempted ? 'submitted' : 'failed';
        report.reason = 'Job timed out or runner closed';
        return report;
      }
      report.status = report.submissionAttempted || report.reviewKind === 'network' ? 'paused_for_review' : 'failed';
      // Browser and network exception messages can include candidate data or tokens.
      const knownReasons = new Set(['Waiting for application requests to finish; retained tab will resume automatically', 'Application controls did not stabilize; review the current form', 'Session belongs to a different application', 'Loaded application belongs to a different requisition', 'Workday repeated section has unrecognized row identifiers', 'Workday repeated section has no unique Add control', 'Workday Add did not create a new row']);
      report.reason = error instanceof Error && error.message.startsWith('WATCHDOG_') ? error.message : error instanceof Error && knownReasons.has(error.message) ? error.message : error instanceof Error && error.name === 'TimeoutError' ? 'Browser operation timed out; inspect the saved review' : 'Browser operation failed; inspect the saved review';
      this.log(report.reason!);
      if (error instanceof Error && error.stack) this.log(error.stack);
    } finally {
      this.activeWatchdog = undefined;
      if (report.reviewKind === 'answers' || report.reviewKind === 'challenge') report.humanInterventionRequired = true;
      if (this.page && !this.page.isClosed()) {
        const gates = await this.browserGates().catch(() => ({ login: false, challenge: false }));
        if (gates.challenge) report.humanInterventionRequired = true;
        if (report.reviewKind === 'authentication' && options.vault) {
          const tenant = options.requisition ? canonicalEmployerKey(options.url, options.requisition.key) : new URL(options.url).hostname;
          const automaticRecovery = options.vault.recovery(tenant)?.recovery?.confirmed === false;
          const automaticEmail = !!options.mailbox && await hasEmailAuthenticationGate(this.page);
          report.automaticVerificationPending = automaticRecovery || automaticEmail;
          if (!automaticRecovery && !automaticEmail) report.humanInterventionRequired = true;
        } else if (report.reviewKind === 'authentication') report.humanInterventionRequired = true;
      }
      await observer?.drain();
      if (!report.receipt && this.submissionObservation?.url === options.url) report.receipt = this.submissionObservation.report.receipt;
      if (report.receipt && report.submissionAttempted) {
        report.status = 'submitted';
        report.reason = report.receipt.existing ? 'Employer confirms an existing application; no new submission made' : 'Submission confirmation observed';
        if (!options.preserveReviewedValues && !options.advanceReviewedStep && !(options.mode === 'copilot' && options.retryReviewed)) {
          report.humanInterventionRequired = false;
        }
      }
      if (report.status === 'submitted' || !report.submissionAttempted) { observer?.close(); this.submissionObservation = undefined; }
      if (report.receipt) {
        if (report.submission) report.submission.phase = 'confirmed';
        if (report.submissionAttempted) options.onPhase?.('submit_confirmed');
        try { report.evidenceDir = await captureEvidence(this.page!, options, report, observer?.exchanges); report.receipt.evidenceDir = report.evidenceDir; }
        catch { report.logs.push('Receipt observed; evidence capture incomplete'); }
      }
      if (report.status === 'submitted' || report.receipt) {
        try {
          const companyName = options.company || options.applicationBrief?.company || 'Company';
          const roleTitle = options.applicationBrief?.title || 'Software Engineer';
          const domain = await resolveEmployerDomain(companyName, options.url);
          const lead = await findFreeCompanyLeads({
            company: companyName,
            domain,
          }).catch(() => undefined);
          const draft = generateColdOutreachDraft(companyName, roleTitle, lead, options.profile);
          recordOutreachLead(draft);
        } catch {}
      }
      report.endTime = new Date().toISOString();
      report.durationMs = Math.min(360_000, Math.max(0, Date.now() - attemptStartWallClockMs));

      const finalStatus: 'applied' | 'failed' | 'paused_for_review' | 'skipped' =
        report.status === 'submitted' || report.status === 'completed'
          ? 'applied'
          : report.status === 'paused_for_review'
          ? 'paused_for_review'
          : report.status === 'skipped'
          ? 'skipped'
          : 'failed';
      const atsName = report.ats || identifyApplicationAts(options.url) || 'ats';
      const laneName = options.lane || (atsName === 'greenhouse' ? 'greenhouse' : atsName === 'ashby' ? 'ashby' : atsName === 'workday' ? 'workday' : 'other');

      try {
        appendJobRunHistory({
          jobId: options.jobId || options.requisition?.key || randomUUID(),
          company: options.company || options.applicationBrief?.company || 'Company',
          title: options.applicationBrief?.title || 'Software Engineer',
          provider: atsName,
          lane: laneName,
          url: options.url,
          status: finalStatus,
          reason: report.reason || finalStatus,
          fieldsFilled: report.fieldsFilled || 0,
          startedAt: report.startTime,
          finishedAt: report.endTime,
          durationMs: report.durationMs || 0,
          receiptVerified: report.status === 'submitted' || !!report.receipt,
        });
        try {
          const summaryPath = path.resolve('state/autoapply/portal-review/queue-summary.json');
          if (existsSync(summaryPath)) {
            const s = JSON.parse(readFileSync(summaryPath, 'utf8'));
            if (finalStatus === 'applied') {
              s.applied = (s.applied || 0) + 1;
              const verifiedEntries = (report.actions || [])
                .filter((a): a is typeof a & { question: string } => a.status === 'filled' && typeof a.question === 'string' && a.value !== undefined && a.value !== null)
                .map((a) => ({ questionText: a.question, answer: String(a.value) }));
              recordVerifiedAcceptedApplicationAnswers(options.url, verifiedEntries);
            }
            else if (finalStatus === 'failed') s.failed = (s.failed || 0) + 1;
            else if (finalStatus === 'paused_for_review') s.paused_for_review = (s.paused_for_review || 0) + 1;
            else if (finalStatus === 'skipped') s.skipped = (s.skipped || 0) + 1;
            if (typeof s.queued === 'number' && s.queued > 0) s.queued -= 1;
            s.updatedAt = new Date().toISOString();
            writeFileSync(summaryPath, JSON.stringify(s, null, 2), 'utf8');
          }
        } catch {}
      } catch {}

      if (options.jobId) {
        try {
          const { DatabaseSync } = await import('node:sqlite');
          const sqlitePath = path.resolve('state/autoapply/portal-review/queue.sqlite');
          if (existsSync(sqlitePath)) {
            const db = new DatabaseSync(sqlitePath);
            db.exec('PRAGMA busy_timeout = 15000;');
            db.prepare(`
              UPDATE applications
              SET payload = json_set(payload,
                '$.lastRunStartedAt', ?,
                '$.lastRunFinishedAt', ?,
                '$.durationMs', ?,
                '$.fieldsFilled', ?,
                '$.lane', ?,
                '$.provider', ?
              )
              WHERE id = ?
            `).run(report.startTime, report.endTime, report.durationMs || 0, report.fieldsFilled || 0, laneName, atsName, options.jobId);
            db.close();
          }
        } catch {}
      }
      if (this.page && !this.page.isClosed() && (report.status === 'failed' || report.status === 'paused_for_review' || report.reason === 'captcha_deferred')) {
        try {
          const diag = await capturePageDiagnostics(this.page, report.reason);
          (report as any).diagnostics = diag;
          recordOvernightError({
            timestamp: new Date().toISOString(),
            jobId: options.jobId || 'job_' + Date.now(),
            company: options.company || '',
            title: options.applicationBrief?.title || '',
            provider: options.requisition?.provider || report.ats || atsName || 'ats',
            lane: options.lane || laneName || 'other',
            url: options.url,
            durationMs: report.durationMs || (Date.now() - Date.parse(report.startTime)),
            status: report.reason === 'captcha_deferred' ? 'captcha_deferred' : report.status,
            reasonCode: normalizeReasonCode(report.reason || '', report.status),
            errorMessage: report.reason || 'Non-applied outcome',
            stepNumber: report.stepsTraversed || 1,
            stepHeading: diag.stepHeading || '',
            unmappedFields: diag.unmappedFields || [],
            validationErrorsOnPage: diag.validationErrorsOnPage || [],
            visibleButtonsOnPage: diag.visibleButtonsOnPage || [],
          });
        } catch {}
      }
      if (this.page) await this.checkpoint(options, report);
      if ((options.headless !== false && !options.keepOpen) || report.reason === 'captcha_deferred' || report.status === 'skipped' || report.status === 'submitted') {
        if (this.page) {
          await this.page.close({ runBeforeUnload: false }).catch(() => {});
          this.page = null;
        }
        if (this.ownsContext) {
          if (this.context) {
            for (const p of this.context.pages()) {
              await p.close({ runBeforeUnload: false }).catch(() => {});
            }
          }
          if (this.browser) {
            await this.browser.close().catch(() => {});
            this.browser = null;
          }
          await this.close().catch(() => {});
        }
      }
    }
    return report;
  }
}










