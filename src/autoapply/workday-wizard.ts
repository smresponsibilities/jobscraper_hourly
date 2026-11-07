// src/autoapply/workday-wizard.ts
import type { Frame } from 'patchright';

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

    const isEducation = /education|school|university|degree/i.test(fullContext) && !/self[-_\s]*identify|disability|signature/i.test(fullContext);
    const isStart = /from|start/i.test(text);
    const isSignatureOrToday = /self[-_\s]*identify|disability|signature|today|date\s+signed/i.test(fullContext) || (/date/i.test(text) && !/from|to|start|end/i.test(text));

    const now = new Date();
    let month = '08';
    let day = '05';
    let year = '2025';

    if (isSignatureOrToday) {
      month = String(now.getMonth() + 1).padStart(2, '0');
      day = String(now.getDate()).padStart(2, '0');
      year = String(now.getFullYear());
    } else if (isEducation) {
      month = isStart ? '08' : '06';
      year = isStart ? '2022' : '2026';
    } else {
      // Work experience (Morgan Stanley: Aug 2025 - Aug 2026)
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
  }
  return filled;
}

export async function fillWorkdaySelectInputFast(
  frame: Frame,
  containerSelector: string,
  searchTerm: string,
  fallbackTerm?: string
): Promise<boolean> {
  const container = frame.locator(containerSelector).first();
  if (!(await container.isVisible().catch(() => false))) return false;

  // Skip if already has a selected pill!
  if ((await container.locator('[data-automation-id="selectedItem"]').count().catch(() => 0)) > 0) {
    return true;
  }

  const input = container.locator('input[data-uxi-widget-type="selectinput"], input').first();
  if (!(await input.isVisible().catch(() => false))) return false;

  const trySearch = async (term: string): Promise<boolean> => {
    await input.click({ timeout: 2000 }).catch(() => {});
    await input.fill(term).catch(() => {});
    await input.press('Enter').catch(() => {});
    await frame.waitForTimeout(700);

    const opt = frame
      .locator('[data-automation-id="promptOption"], [role="option"]')
      .filter({ visible: true })
      .first();
    if (await opt.isVisible().catch(() => false)) {
      await opt.click({ timeout: 2000 }).catch(() => {});
      await frame.waitForTimeout(500);
      // If 2-level hierarchical menu (e.g. Source -> Website -> Corporate Website), click child leaf
      if ((await container.locator('[data-automation-id="selectedItem"]').count().catch(() => 0)) === 0) {
        const childOpt = frame
          .locator('[data-automation-id="promptOption"], [role="option"]')
          .filter({ visible: true })
          .first();
        if (await childOpt.isVisible().catch(() => false)) {
          await childOpt.click({ timeout: 2000 }).catch(() => {});
          await frame.waitForTimeout(400);
        }
      }
      await frame.page().keyboard.press('Escape').catch(() => {});
      return (await container.locator('[data-automation-id="selectedItem"]').count().catch(() => 0)) > 0;
    }
    return false;
  };

  if (await trySearch(searchTerm)) return true;
  if (fallbackTerm && (await trySearch(fallbackTerm))) return true;
  await frame.page().keyboard.press('Escape').catch(() => {});
  return false;
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

  // 4. Education Field of Study -> "Computer Science" & School -> "Chitkara" (fallback "Other")
  await fillWorkdaySelectInputFast(
    frame,
    '[data-automation-id="formField-field-of-study"], [data-automation-id="formField-fieldOfStudy"]',
    'Computer Science',
    'Engineering'
  );
  await fillWorkdaySelectInputFast(
    frame,
    '[data-automation-id="formField-schoolItem"], [data-automation-id="formField-school"]',
    'Chitkara',
    'Other'
  );

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
}
