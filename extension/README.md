# Jobscraper Auto-Apply Bot & Companion Extension

A Manifest V3 browser extension & Playwright automation runner reverse-engineered strictly for **Autofill & Autonomous Auto-Apply Bots** (zero tracker overlap):

1. **FastApply** (Stealth & Copilot multi-mode runner):
   - **Copilot Mode**: Interactive assistant that auto-fills fields, highlights inputs with visual confidence status, and pauses for human verification before advancing.
   - **Stealth Runner Mode**: Autonomous auto-apply with Gaussian typing cadence (35ms–85ms inter-keystroke jitter), smooth micro-scrolls, full synthetic pointer event sequences, and anti-bot evasion (`navigator.webdriver` scrubbing, velocity limiting).
2. **JobWizard** (Multi-page Workday & Taleo form handler):
   - Multi-step wizard state machine: traverses complex Workday stages (`My Information` -> `My Experience` -> `Application Questions` -> `Voluntary Disclosures` -> `Review`).
   - Workday custom widget interactor: handles custom comboboxes (`button[role="combobox"]`, `[data-automation-id*="dropdown"]`), radio groups, and composite address cascades.
   - Taleo iframe resolver and wizard pagination (`Save and Continue`, `btnNext`).
3. **Jobright** (Instant ATS field classifier):
   - 60+ granular field taxonomy rules: personal, education, professional experience, notice period (days), salary expectations, work authorization, non-compete, security clearance, and EEO voluntary disclosures (Form CC-305 Disability signature & date, Veteran status, Gender, Race).
   - High-speed heuristic regex matcher with confidence scoring (95%+).
4. **AIHawk** (Open-source autonomous Playwright runner):
   - Dynamic question answering engine matching unmapped questions against candidate profile & custom QA bank.
   - Validation error recovery loop: scans for `:invalid` or `[aria-invalid="true"]` fields, focuses them, and suggests alternative answers.
   - Standalone CLI Playwright runner (`npm run auto-apply -- --url <job_url>`).

---

## Installation (Load Unpacked)

1. Open Chromium browser (Google Chrome, Brave, Arc, Edge).
2. Navigate to `chrome://extensions/` (or `brave://extensions/`).
3. Enable **Developer mode** toggle in top-right corner.
4. Click **Load unpacked** in top-left corner.
5. Select the directory:
   ```
   D:\Jobscraper-next\extension
   ```
6. The **Jobscraper Bot** icon (⚡) will appear in your browser toolbar.

---

## Standalone Playwright CLI Runner (AIHawk Architecture)

For headless or batch command-line application submissions:
```powershell
# Run with Copilot mode (pauses before step advance)
npm run auto-apply -- --url "https://nvidia.wd5.myworkdayjobs.com/..." --mode copilot

# Run with Stealth mode (autonomous with human typing delays)
npm run auto-apply -- --url "https://boards.greenhouse.io/..." --mode stealth

# Dry-run inspection (classifies all fields without mutating form)
npm run auto-apply -- --url "https://jobs.lever.co/..." --dry-run
```
