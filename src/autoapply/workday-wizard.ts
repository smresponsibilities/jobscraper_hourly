// src/autoapply/workday-wizard.ts
import type { Frame, Page } from 'patchright';

export async function fillWorkdaySpinbuttonDates(frame: Frame): Promise<number> {
  let filled = 0;
  // Workday split dates use [data-automation-id="dateSectionMonth-input"] and [data-automation-id="dateSectionYear-input"]
  const dateFields = frame.locator('[data-automation-id^="formField-"]').filter({
    has: frame.locator('[data-automation-id="dateSectionMonth-input"], [data-automation-id="dateSectionYear-input"]'),
  });

  const count = await dateFields.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const field = dateFields.nth(i);
    const text = (await field.innerText().catch(() => '')).toLowerCase();
    const headingText = (await frame.locator('h1, h2, [data-automation-id="pageHeaderTitle"]').allTextContents().catch(() => [])).join(' ').toLowerCase();
    const fullContext = `${text} ${headingText}`;

    const inEducation = await field.evaluate((el) => Boolean(el.closest('[data-automation-id="educationSection"], [class*="education" i]'))).catch(() => false);
    const inWorkExp = await field.evaluate((el) => Boolean(el.closest('[data-automation-id="workExperienceSection"], [class*="experience" i], [class*="employment" i]'))).catch(() => false);

    const isEducation = !inWorkExp && (inEducation || (/education|school|university|degree/i.test(text) && !/self[-_\s]*identify|disability|signature/i.test(text)) || (/education|school|university|degree/i.test(headingText) && !/work\s*experience|employment|job/i.test(headingText)));
    const isStart = /from|start/i.test(text);
    const isSignatureOrToday = !isEducation && !inWorkExp && (/self[-_\s]*identify|disability|signature|today|date\s+signed/i.test(fullContext) || (/date/i.test(text) && !/from|to|start|end/i.test(text)));

    const now = new Date();
    let month = '08';
    let day = '05';
    let year = '2025';

    if (isSignatureOrToday) {
      month = String(now.getMonth() + 1).padStart(2, '0');
      day = String(now.getDate()).padStart(2, '0');
      year = String(now.getFullYear());
    } else if (isEducation) {
      // Graduation: 08/2026 for Chitkara University; Start: 08/2022
      month = '08';
      year = isStart ? '2022' : '2026';
    } else if (inWorkExp || /work\s*experience|employment|job/i.test(fullContext)) {
      // Work experience (Morgan Stanley: Aug 2025 - Aug 2026) -> Start: 08/2025
      month = '08';
      year = isStart ? '2025' : '2026';
    } else {
      month = '08';
      year = isStart ? '2025' : '2026';
    }

    const mInput = field.locator('[data-automation-id="dateSectionMonth-input"]').first();
    if (await mInput.isVisible().catch(() => false)) {
      const val = await mInput.inputValue().catch(() => '');
      if (!val || val === 'MM') {
        await mInput.click({ timeout: 1500 }).catch(() => {});
        await mInput.pressSequentially(month, { delay: 30 }).catch(() => {});
        filled++;
      }
    }

    const dInput = field.locator('[data-automation-id="dateSectionDay-input"]').first();
    if (await dInput.isVisible().catch(() => false)) {
      const val = await dInput.inputValue().catch(() => '');
      if (!val || val === 'DD') {
        await dInput.click({ timeout: 1500 }).catch(() => {});
        await dInput.pressSequentially(day, { delay: 30 }).catch(() => {});
        filled++;
      }
    }

    const yInput = field.locator('[data-automation-id="dateSectionYear-input"]').first();
    if (await yInput.isVisible().catch(() => false)) {
      const val = await yInput.inputValue().catch(() => '');
      if (!val || val === 'YYYY') {
        await yInput.click({ timeout: 1500 }).catch(() => {});
        await yInput.pressSequentially(year, { delay: 30 }).catch(() => {});
        filled++;
      }
    }

    // Handle unified spinbutton date inputs (MM/YYYY or MM/DD/YYYY)
    const unifiedInput = field.locator('input[role="spinbutton"], input[data-automation-id*="date" i]').first();
    if (await unifiedInput.isVisible().catch(() => false)) {
      const cur = (await unifiedInput.inputValue().catch(() => '')).trim();
      if (!cur || /^(?:mm|yyyy)/i.test(cur)) {
        const dateVal = isSignatureOrToday ? `${month}/${day}/${year}` : `${month}/${year}`;
        await unifiedInput.click({ timeout: 1500 }).catch(() => {});
        await unifiedInput.fill(dateVal).catch(() => {});
        filled++;
      }
    }
  }

  return filled;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function fillWorkdaySelectInputFast(
  frame: any,
  containerSelector: any,
  searchTerm: string,
  fallbackTerm?: string | string[]
): Promise<boolean> {
  try {
    const page = typeof frame.page === 'function' ? frame.page() : frame;
    const container = typeof containerSelector === 'string'
      ? frame.locator(containerSelector).first()
      : (containerSelector.first ? containerSelector.first() : containerSelector);

    if (!(await container.isVisible().catch(() => false))) return false;

    // Skip if already has a selected pill!
    if ((await container.locator('[data-automation-id="selectedItem"]').count().catch(() => 0)) > 0) {
      return true;
    }

    const control = container.locator('button[aria-haspopup="listbox"], input[role="combobox"], [data-automation-id="searchBox"], input[data-uxi-widget-type="selectinput"], button[role="combobox"], input').first();
    if (typeof control.count === 'function') {
      if ((await control.count().catch(() => 0)) === 0) return false;
    } else if (!(await control.isVisible().catch(() => false))) {
      return false;
    }

    const trySelect = async (targetText: string): Promise<boolean> => {
      await control.scrollIntoViewIfNeeded?.().catch(() => {});
      await control.click({ force: true }).catch(() => {});
      await page.waitForTimeout(200);

      const popup = page.locator('[data-automation-id="popupWrapper"], [role="listbox"]').first();
      if (typeof popup.waitFor === 'function') {
        await popup.waitFor({ state: 'visible', timeout: 3500 }).catch(() => null);
      }

      // Direct item match
      const directOption = page
        .locator('[data-automation-id="promptOption"], [role="option"]')
        .filter({ hasText: targetText })
        .first();

      if ((await directOption.count().catch(() => 0)) > 0) {
        await directOption.scrollIntoViewIfNeeded?.().catch(() => {});
        await directOption.click({ force: true }).catch(() => {});
      } else {
        // Typeahead Fallback: type first 4-5 chars to filter virtualized items
        const searchInput = page.locator('[data-automation-id="popupWrapper"] input[type="text"], [data-automation-id="popupWrapper"] input[role="searchbox"]').first();
        if ((await searchInput.count().catch(() => 0)) > 0 && (await searchInput.isVisible().catch(() => false))) {
          await searchInput.fill(targetText.slice(0, 4)).catch(() => {});
        } else {
          await page.keyboard.type(targetText.slice(0, 4), { delay: 40 }).catch(() => {});
        }
        await page.waitForTimeout(300);

        const filteredOption = page
          .locator('[data-automation-id="promptOption"], [role="option"]')
          .filter({ hasText: new RegExp(escapeRegex(targetText.slice(0, 4)), 'i') })
          .first();

        if ((await filteredOption.count().catch(() => 0)) > 0 && (await filteredOption.isVisible().catch(() => false))) {
          await filteredOption.click({ force: true }).catch(() => {});
        } else {
          await page.keyboard.press('ArrowDown').catch(() => {});
          await page.waitForTimeout(100);
          await page.keyboard.press('Enter').catch(() => {});
        }
      }

      await page.waitForTimeout(200);
      if ((await container.locator('[data-automation-id="selectedItem"]').count().catch(() => 0)) === 0) {
        const childOpt = page
          .locator('[data-automation-id="promptOption"], [role="option"]')
          .filter({ visible: true })
          .first();
        if (await childOpt.isVisible().catch(() => false)) {
          await childOpt.click({ force: true }).catch(() => {});
          await page.waitForTimeout(200);
        }
      }
      await page.keyboard.press('Escape').catch(() => {});
      return (await container.locator('[data-automation-id="selectedItem"]').count().catch(() => 0)) > 0;
    };

    if (await trySelect(searchTerm)) return true;
    const fallbacks = Array.isArray(fallbackTerm) ? fallbackTerm : (fallbackTerm ? [fallbackTerm] : []);
    for (const fb of fallbacks) {
      if (await trySelect(fb)) return true;
    }
    return false;
  } catch (err) {
    console.warn('[WORKDAY_SELECT_FAST] Dropdown selection warning:', err);
    return false;
  }
}

export interface WorkdayStepLoopState {
  lastStepHash: string;
  consecutiveCount: number;
}

export async function checkWorkdayStepLoopAndRecover(
  page: Page | Frame,
  loopState: WorkdayStepLoopState
): Promise<{ loopDetected: boolean; errorMessages: string[]; healed: boolean }> {
  const currentStepText = await page
    .locator('[data-automation-id="pageHeader"], [data-automation-id="progressBarActiveStep"], [data-automation-id="pageHeaderTitle"]')
    .allInnerTexts()
    .then((texts: string[]) => texts.map((t: string) => t.trim()).join(' | '))
    .catch(() => '');

  const stepHash = currentStepText || 'default_step';
  if (stepHash === loopState.lastStepHash) {
    loopState.consecutiveCount++;
  } else {
    loopState.lastStepHash = stepHash;
    loopState.consecutiveCount = 1;
  }

  if (loopState.consecutiveCount >= 2) {
    const errorLocators = page.locator('[data-automation-id="errorMessage"], [data-automation-id="errorWidget"], [data-automation-id*="error" i], [aria-invalid="true"]');
    const count = await errorLocators.count().catch(() => 0);
    const errorMessages: string[] = [];
    for (let i = 0; i < count; i++) {
      const txt = (await errorLocators.nth(i).innerText().catch(() => '')).trim();
      if (txt) errorMessages.push(txt);
    }

    let healed = false;
    try {
      const frame = 'mainFrame' in page ? (page as Page).mainFrame() : (page as Frame);
      await runWorkdayStepFastPass(frame);
      healed = true;
    } catch {}

    return { loopDetected: true, errorMessages, healed };
  }

  return { loopDetected: false, errorMessages: [], healed: false };
}

export async function runWorkdayStepFastPass(frame: Frame, resumePdfPath?: string): Promise<void> {
  const currentUrl = frame.url();
  if (!currentUrl.toLowerCase().includes('myworkdayjobs.com')) return;

  // 1. Upload Resume immediately if a file upload input is on this step and no file is attached yet
  if (resumePdfPath) {
    const fileInput = frame
      .locator('input[data-automation-id="file-upload-input-ref"], input[type="file"]')
      .first();
    const existingUpload = await frame
      .locator('[data-automation-id="file-upload-item"], [data-automation-id="file-upload-successful"], [data-automation-id="delete-file"]')
      .count()
      .catch(() => 0);
    if (existingUpload === 0 && (await fileInput.count().catch(() => 0)) > 0) {
      await fileInput.setInputFiles(resumePdfPath).catch(() => {});
      await frame.waitForTimeout(1500);
    }
  }

  // 2. "Previously Worked Here?" -> Always click "No"
  const prevWorkerNo = frame
    .locator(
      '[data-automation-id="formField-candidateIsPreviousWorker"] label:has-text("No"), [data-automation-id="formField-candidateIsPreviousWorker"] input[value="false"]'
    )
    .first();
  if (await prevWorkerNo.isVisible().catch(() => false)) {
    await prevWorkerNo.click({ timeout: 1500 }).catch(() => {});
  }

  // 3. "How Did You Hear About Us?" (sourcePrompt) -> "Website" or "LinkedIn"
  await fillWorkdaySelectInputFast(
    frame,
    '[data-automation-id="formField-sourcePrompt"], [data-automation-id="formField-source"]',
    'Website',
    'LinkedIn'
  );

  // 4. Education Field of Study -> "Computer Science" & School -> "Chitkara University" (fallback ["Chitkara", "Other", "India", "University"])
  await fillWorkdaySelectInputFast(
    frame,
    '[data-automation-id="formField-field-of-study"], [data-automation-id="formField-fieldOfStudy"]',
    'Computer Science',
    ['Engineering', 'Information Technology']
  );
  await fillWorkdaySelectInputFast(
    frame,
    '[data-automation-id="formField-schoolItem"], [data-automation-id="formField-school"]',
    'Chitkara University',
    ['Chitkara', 'Other', 'India', 'University']
  );

  // Ticket GEN-230: Workday Step 2 "I currently work here" checkbox physics
  const workExpSection = frame.locator('[data-automation-id="workExperienceSection"]').first();
  if (await workExpSection.isVisible().catch(() => false)) {
    const currentlyWorkHere = workExpSection.locator('input[data-automation-id="currentlyWorkHere"], [data-automation-id="currentlyWorkHere"] input[type="checkbox"], [data-automation-id="currentlyWorkHere"]').filter({ visible: true }).first();
    if (await currentlyWorkHere.isVisible().catch(() => false)) {
      const isChecked = await currentlyWorkHere.isChecked().catch(() => false);
      if (!isChecked) {
        await currentlyWorkHere.click({ force: true, timeout: 2000 }).catch(() => {});
        await frame.waitForTimeout(250);
      }
    }
  }

  // 5. Fill all Workday MM/DD/YYYY spinbutton date clusters
  await fillWorkdaySpinbuttonDates(frame);

  // 6. Voluntary Disclosures agreement checkbox (Ticket GEN-134)
  const agreement = frame.locator('[data-automation-id="agreementCheckbox"]').filter({ visible: true }).first();
  if (await agreement.isVisible().catch(() => false)) {
    const isChecked = await agreement.isChecked().catch(() => false);
    if (!isChecked) {
      await agreement.click({ force: true, timeout: 2000 }).catch(() => {});
    }
  }

  // 7. Self Identify Disability name input & mutually exclusive disability checkboxes (Ticket GEN-134)
  const nameInput = frame.locator('input[data-automation-id="name"]').filter({ visible: true }).first();
  if (await nameInput.isVisible().catch(() => false)) {
    const val = (await nameInput.inputValue().catch(() => '')).trim();
    if (!val) {
      await nameInput.fill('Shivam Mahajan').catch(() => {});
    }
  }

  // Check disability status if on self-identify step and none checked
  const disabilityBoxes = frame.locator('[data-automation-id*="disability" i] input[type="checkbox"], fieldset input[type="checkbox"]').filter({ visible: true });
  const dCount = await disabilityBoxes.count().catch(() => 0);
  if (dCount >= 2) {
    let anyChecked = false;
    for (let j = 0; j < dCount; j++) {
      if (await disabilityBoxes.nth(j).isChecked().catch(() => false)) {
        anyChecked = true;
        break;
      }
    }
    if (!anyChecked) {
      const declineOrNo = frame.locator('label:has-text("I do not want to answer"), label:has-text("No, I do not have a disability"), label:has-text("I do not wish to answer")').first();
      if (await declineOrNo.isVisible().catch(() => false)) {
        await declineOrNo.click({ timeout: 1500 }).catch(() => {});
      } else {
        await disabilityBoxes.last().check({ force: true }).catch(() => {});
      }
    }
  }

  // GEN-150: Expand collapsed Work Experience & Education sections on Workday Step 2 ("My Experience")
  const expandWorkdaySectionIfNeeded = async (
    sectionSelector: string,
    existingFieldSelector: string
  ): Promise<void> => {
    const section = frame.locator(sectionSelector).first();
    if (!(await section.isVisible().catch(() => false))) return;
    const hasExpandedOrSavedItem = await section
      .locator(existingFieldSelector)
      .first()
      .isVisible()
      .catch(() => false);
    if (hasExpandedOrSavedItem) return;
    const addBtn = section
      .locator('button[data-automation-id="add-button"], button[aria-label*="Add" i]')
      .first();
    if (await addBtn.isVisible().catch(() => false)) {
      await addBtn.click({ timeout: 3500 }).catch(() => {});
      await frame.waitForTimeout(550).catch(() => {});
    }
  };
  await expandWorkdaySectionIfNeeded(
    '[data-automation-id="workExperienceSection"]',
    'input[data-automation-id="jobTitle"], [data-automation-id^="workExperience-"]'
  );
  await expandWorkdaySectionIfNeeded(
    '[data-automation-id="educationSection"]',
    'input[data-automation-id="school"], [data-automation-id="formField-schoolItem"] input, [data-automation-id="formField-school"] input, [data-automation-id^="education-"]'
  );

  // 8. Workday Step 1 & 2 pre-expanded empty card fast-fill (Ticket GEN-141)
  const defaultFastFills: Array<[string, string]> = [
    ['input[data-automation-id="jobTitle"]', 'Technology Apprentice'],
    ['input[data-automation-id="company"]', 'Morgan Stanley'],
    ['input[data-automation-id="location"]', 'Bengaluru, India'],
    ['textarea[data-automation-id="description"]', 'Engineered CIAM data warehouse pipelines using Apache Kafka, PySpark, Apache Spark, Hive, and Azure Snowflake processing 5,000,000+ events with zero row-count tolerance; built distributed Java Spring Boot REST APIs and Jenkins CI/CD pipelines.'],
    ['input[data-automation-id="gpa"]', '9.35'],
    ['input[data-automation-id="addressSection_addressLine1"]', 'Bengaluru, Karnataka'],
    ['input[data-automation-id="addressSection_city"]', 'Bengaluru'],
    ['input[data-automation-id="addressSection_postalCode"]', '560001'],
    ['input[data-automation-id="legalNameSection_firstName"]', 'Shivam'],
    ['input[data-automation-id="legalNameSection_lastName"]', 'Mahajan'],
    ['input[data-automation-id="school"]', 'Chitkara University'],
  ];

  for (const [sel, val] of defaultFastFills) {
    const loc = frame.locator(sel).filter({ visible: true }).first();
    if (await loc.isVisible().catch(() => false)) {
      const cur = (await loc.inputValue().catch(() => '')).trim();
      if (!cur) {
        await loc.fill(val).catch(() => {});
      }
    }
  }

  // 9. Workday Step 2 Education Degree listbox fast-pass (Ticket GEN-148)
  const degreeBtn = frame.locator('button[data-automation-id="degree"], [data-automation-id="formField-degree"] button[aria-haspopup="listbox"], [data-automation-id="formField-degree"] button').filter({ visible: true }).first();
  if (await degreeBtn.isVisible().catch(() => false)) {
    const txt = (await degreeBtn.innerText().catch(() => '')).trim();
    if (!txt || /^(?:select|select one|--)$/i.test(txt)) {
      await degreeBtn.click({ force: true, timeout: 2000 }).catch(() => {});
      await frame.waitForTimeout(400);
      const opt = frame.locator('[role="listbox"] [role="option"], [data-automation-id="promptOption"]').filter({ hasText: /bachelor|b\.?\s*e\b|b\.?\s*tech|undergraduate|bs|ba/i }).first();
      if (await opt.isVisible().catch(() => false)) {
        await opt.click({ force: true, timeout: 1500 }).catch(() => {});
      } else {
        const firstOpt = frame.locator('[role="listbox"] [role="option"], [data-automation-id="promptOption"]').first();
        if (await firstOpt.isVisible().catch(() => false)) {
          await firstOpt.click({ force: true, timeout: 1500 }).catch(() => {});
        }
      }
    }
  }
}
