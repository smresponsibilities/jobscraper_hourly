/**
 * Autonomous Playwright Auto-Apply Runner.
 * Reverse-engineered & unified from:
 * 1. FastApply (Stealth evasion & Copilot mode)
 * 2. JobWizard (Workday/Taleo multi-step state machine)
 * 3. Jobright (Instant ATS field classifier)
 * 4. AIHawk (Autonomous Playwright execution & failure recovery)
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type {
  BotRunReport,
  CandidateExtendedProfile,
  RunnerMode,
} from './types.js';
import { classifyAtsField, resolveExtendedProfileValue } from './classifier.js';
import { getHumanKeyDelay, STEALTH_INIT_SCRIPT } from './stealth.js';
import { identifyEnterpriseAts, classifyWorkdayStep, WORKDAY_SELECTORS, TALEO_SELECTORS } from './wizard.js';
import { resolveDynamicQuestion, matchBestOption } from './aihawk.js';

export interface AutoApplyOptions {
  url: string;
  profile: CandidateExtendedProfile;
  mode?: RunnerMode;
  headless?: boolean;
  maxSteps?: number;
  dryRun?: boolean;
}

export class AutoApplyRunner {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private logs: string[] = [];

  private log(msg: string) {
    const timestamp = new Date().toISOString().slice(11, 19);
    const line = `[${timestamp}] ${msg}`;
    this.logs.push(line);
    console.log(line);
  }

  /**
   * Initializes browser with FastApply anti-bot stealth parameters.
   */
  async initBrowser(headless = true): Promise<void> {
    this.log(`Launching Chromium (headless=${headless}) with FastApply anti-detection parameters...`);
    this.browser = await chromium.launch({
      headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--window-position=0,0',
        '--ignore-certificate-errors',
        '--ignore-certificate-errors-spki-list',
      ],
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });

    // Inject anti-bot evasions
    await this.context.addInitScript(STEALTH_INIT_SCRIPT);
    this.page = await this.context.newPage();
  }

  /**
   * Simulates FastApply human typing cadence into a Playwright locator.
   */
  async humanType(selector: string, text: string): Promise<void> {
    if (!this.page) return;

    await this.page.focus(selector);
    // Clear existing text safely
    await this.page.click(selector, { clickCount: 3 });
    await this.page.keyboard.press('Backspace');

    for (const char of text) {
      await this.page.keyboard.type(char, {
        delay: getHumanKeyDelay(35, 85),
      });
    }
  }

  /**
   * Runs the full autonomous application loop.
   */
  async run(options: AutoApplyOptions): Promise<BotRunReport> {
    const mode = options.mode || 'copilot';
    const startTime = new Date().toISOString();
    const report: BotRunReport = {
      mode,
      url: options.url,
      ats: 'unknown',
      startTime,
      fieldsFound: 0,
      fieldsFilled: 0,
      unmappedFields: 0,
      stepsTraversed: 0,
      status: 'completed',
      actions: [],
      logs: this.logs,
    };

    try {
      if (!this.page) {
        await this.initBrowser(options.headless ?? true);
      }

      const p = this.page!;
      this.log(`Navigating to application URL: ${options.url}`);
      await p.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(2000);

      const html = await p.content();
      const detectedAts = identifyEnterpriseAts(options.url, html) || 'generic';
      report.ats = detectedAts;
      this.log(`Identified ATS platform: ${detectedAts}`);

      let step = 1;
      const maxSteps = options.maxSteps || 6;

      while (step <= maxSteps) {
        report.stepsTraversed = step;
        this.log(`--- Processing Step ${step} (${detectedAts}) ---`);

        // Scan inputs on current page (traversing Taleo iframe if applicable)
        let inputLocator = p.locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea, [role="combobox"]');
        if (detectedAts === 'taleo') {
          const taleoFrameSelector = '#requisitionDescriptionInterface';
          const hasFrame = (await p.locator(taleoFrameSelector).count()) > 0;
          if (hasFrame) {
            this.log('Taleo iframe detected (#requisitionDescriptionInterface), traversing frame for inputs...');
            inputLocator = p.frameLocator(taleoFrameSelector).locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea, [role="combobox"]');
          }
        }
        const inputs = await inputLocator.all();
        report.fieldsFound += inputs.length;
        this.log(`Found ${inputs.length} candidate input fields on current step.`);

        for (const input of inputs) {
          const isVisible = await input.isVisible().catch(() => false);
          if (!isVisible) continue;

          const name = await input.getAttribute('name').catch(() => '') || '';
          const id = await input.getAttribute('id').catch(() => '') || '';
          const placeholder = await input.getAttribute('placeholder').catch(() => '') || '';
          const ariaLabel = await input.getAttribute('aria-label').catch(() => '') || '';
          const tagName = await input.evaluate((el) => el.tagName.toLowerCase()).catch(() => 'input');
          const inputType = await input.getAttribute('type').catch(() => 'text') || 'text';

          // Extract nearest label text
          const labelText = await input.evaluate((el) => {
            const id = el.getAttribute('id');
            if (id) {
              const lbl = document.querySelector(`label[for="${id}"]`);
              if (lbl) return lbl.textContent || '';
            }
            const parentLbl = el.closest('label');
            if (parentLbl) return parentLbl.textContent || '';
            const prev = el.previousElementSibling;
            if (prev && prev.tagName === 'LABEL') return prev.textContent || '';
            return el.parentElement?.innerText || '';
          }).catch(() => '');

          // Jobright instant classification
          const classification = classifyAtsField({
            name,
            id,
            placeholder,
            ariaLabel,
            label: labelText,
          });

          let valToSet: string | boolean | number | undefined = undefined;

          if (classification.category !== 'unknown') {
            valToSet = resolveExtendedProfileValue(classification.category, options.profile);
          } else if (labelText) {
            // AIHawk dynamic question answerer
            const dyn = resolveDynamicQuestion(labelText, options.profile);
            valToSet = dyn.value;
          }

          if (valToSet !== undefined && valToSet !== '') {
            const selDesc = id ? `#${id}` : name ? `[name="${name}"]` : tagName;

            if (options.dryRun) {
              this.log(`[DRY RUN] Would set ${classification.category} (${selDesc}) to "${valToSet}"`);
              report.fieldsFilled++;
              continue;
            }

            // Fill based on element type
            const role = await input.getAttribute('role').catch(() => '');
            if (role === 'combobox') {
              await input.scrollIntoViewIfNeeded().catch(() => {});
              await input.click().catch(() => {});
              await p.waitForTimeout(400);
              const opt = p.locator('[role="listbox"] [role="option"], [data-automation-id*="popup"] [role="option"]').filter({ hasText: String(valToSet) }).first();
              const optVisible = await opt.isVisible().catch(() => false);
              if (optVisible) {
                await opt.click();
                report.fieldsFilled++;
                this.log(`Selected combobox option "${valToSet}" for ${classification.category}`);
              }
            } else if (tagName === 'select') {
              const opts = await input.locator('option').all();
              const optData = await Promise.all(
                opts.map(async (o) => ({
                  value: (await o.getAttribute('value')) || '',
                  label: (await o.textContent()) || '',
                }))
              );
              const best = matchBestOption(valToSet, optData);
              if (best) {
                await input.selectOption(best.value);
                report.fieldsFilled++;
                this.log(`Selected option "${best.label}" for ${classification.category}`);
              }
            } else if (inputType === 'radio' || inputType === 'checkbox') {
              const targetBool = typeof valToSet === 'boolean'
                ? valToSet
                : /yes|true|1/i.test(String(valToSet));
              if (targetBool) {
                await input.check().catch(() => input.click());
                report.fieldsFilled++;
                this.log(`Checked ${classification.category} (${selDesc})`);
              }
            } else {
              // Text or textarea
              if (mode === 'stealth') {
                await this.humanType(selDesc, String(valToSet));
                // FastApply inter-field pause
                await p.waitForTimeout(Math.floor(Math.random() * 300 + 200));
              } else {
                await input.fill(String(valToSet));
              }
              report.fieldsFilled++;
              this.log(`Filled ${classification.category} (${selDesc}) with "${valToSet}"`);
            }

            // Workday address cascade delay
            if (classification.category === 'country') {
              await p.waitForTimeout(600);
            }
          } else {
            report.unmappedFields++;
          }
        }

        // Take audit screenshot of completed step (AIHawk auditability)
        try {
          const fs = await import('node:fs');
          if (!fs.existsSync('out/autoapply-screenshots')) {
            fs.mkdirSync('out/autoapply-screenshots', { recursive: true });
          }
          await p.screenshot({ path: `out/autoapply-screenshots/step-${step}.png`, fullPage: false });
          this.log(`Step ${step} audit screenshot saved to out/autoapply-screenshots/step-${step}.png`);
        } catch {}

        // Post-fill validation recovery check
        const invalidFieldsCount = await p.locator(':invalid, [aria-invalid="true"], .has-error input').count().catch(() => 0);
        if (invalidFieldsCount > 0) {
          this.log(`[VALIDATION NOTICE] Step ${step} has ${invalidFieldsCount} field(s) requiring review.`);
          if (mode === 'copilot') {
            report.status = 'paused_for_review';
            break;
          }
        }

        // Check if there is a next step button (Workday / Taleo wizard)
        let nextBtn = null;
        if (detectedAts === 'workday') {
          nextBtn = p.locator(WORKDAY_SELECTORS.nextButton).first();
        } else if (detectedAts === 'taleo') {
          const taleoFrameSelector = '#requisitionDescriptionInterface';
          const hasFrame = (await p.locator(taleoFrameSelector).count()) > 0;
          if (hasFrame) {
            nextBtn = p.frameLocator(taleoFrameSelector).locator(TALEO_SELECTORS.nextButton).first();
          } else {
            nextBtn = p.locator(TALEO_SELECTORS.nextButton).first();
          }
        }

        const hasNext = Boolean(nextBtn && (await nextBtn.isVisible().catch(() => false)));
        if (hasNext && nextBtn) {
          if (mode === 'copilot') {
            this.log(`[COPILOT MODE] Step ${step} completed. Pausing for human verification before advancing.`);
            report.status = 'paused_for_review';
            break;
          } else {
            this.log(`Stealth Runner: Auto-advancing to next step...`);
            await nextBtn.click();
            await p.waitForTimeout(3000);
            step++;
          }
        } else {
          this.log(`No next step button detected. Application form complete.`);
          break;
        }
      }

      report.endTime = new Date().toISOString();
      return report;
    } catch (err: any) {
      this.log(`Runner error: ${err.message}`);
      report.status = 'failed';
      report.endTime = new Date().toISOString();
      return report;
    } finally {
      if (options.headless !== false && this.browser) {
        await this.browser.close();
      }
    }
  }
}
