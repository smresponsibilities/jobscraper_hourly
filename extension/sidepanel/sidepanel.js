/**
 * Jobscraper Auto-Apply Bot Cockpit Controller
 * Reverse-Engineered & Unified from:
 * 1. FastApply (Stealth & Copilot multi-mode runner)
 * 2. JobWizard (Multi-page Workday/Taleo form handler)
 * 3. Jobright (Instant ATS field classifier)
 * 4. AIHawk (Autonomous Playwright runner & dynamic QA engine)
 *
 * Strictly Autofill & Auto-Apply — zero tracker overlap.
 */

// -------------------------------------------------------------
// State & Elements
// -------------------------------------------------------------
let currentProfile = null;
let currentAts = 'generic';

const el = {
  atsBadge: document.getElementById('ats-badge'),
  refreshPageBtn: document.getElementById('refresh-page-btn'),
  fieldsCountBadge: document.getElementById('fields-count-badge'),
  runAutofillBtn: document.getElementById('run-autofill-btn'),
  scanFieldsBtn: document.getElementById('scan-fields-btn'),

  // JobWizard
  wizardPlatformBadge: document.getElementById('wizard-platform-badge'),
  wizardCurrentStep: document.getElementById('wizard-current-step'),
  wizardAdvanceBtn: document.getElementById('wizard-advance-btn'),
  stepPills: {
    info: document.getElementById('step-info'),
    exp: document.getElementById('step-exp'),
    questions: document.getElementById('step-questions'),
    eeo: document.getElementById('step-eeo'),
    review: document.getElementById('step-review'),
  },

  // Jobright Classifier
  fieldsTableBody: document.getElementById('fields-table-body'),
  detectedStats: document.getElementById('detected-stats'),
  toggleBadgesBtn: document.getElementById('toggle-badges-btn'),

  // Profile Inputs
  saveProfileBtn: document.getElementById('save-profile-btn'),
  profFirstName: document.getElementById('prof-first-name'),
  profLastName: document.getElementById('prof-last-name'),
  profEmail: document.getElementById('prof-email'),
  profPhone: document.getElementById('prof-phone'),
  profCountry: document.getElementById('prof-country'),
  profCity: document.getElementById('prof-city'),
  profState: document.getElementById('prof-state'),

  profLinkedin: document.getElementById('prof-linkedin'),
  profGithub: document.getElementById('prof-github'),
  profWebsite: document.getElementById('prof-website'),

  profSchool: document.getElementById('prof-school'),
  profDegree: document.getElementById('prof-degree'),
  profMajor: document.getElementById('prof-major'),
  profGpa: document.getElementById('prof-gpa'),
  profGradYear: document.getElementById('prof-grad-year'),

  profYoe: document.getElementById('prof-yoe'),
  profNotice: document.getElementById('prof-notice'),
  profExpectedSalary: document.getElementById('prof-expected-salary'),
  profRelocate: document.getElementById('prof-relocate'),
  profWorkMode: document.getElementById('prof-work-mode'),

  profAuth: document.getElementById('prof-auth'),
  profSponsorship: document.getElementById('prof-sponsorship'),
  profFormerEmp: document.getElementById('prof-former-emp'),
  profNonCompete: document.getElementById('prof-non-compete'),

  profGender: document.getElementById('prof-gender'),
  profRace: document.getElementById('prof-race'),
  profVeteran: document.getElementById('prof-veteran'),
  profDisability: document.getElementById('prof-disability'),

  // QA Bank
  addQaBtn: document.getElementById('add-qa-btn'),
  qaListContainer: document.getElementById('qa-list-container'),

  // Console
  botConsole: document.getElementById('bot-console'),
  clearConsoleBtn: document.getElementById('clear-console-btn'),
};

function logToConsole(message) {
  const time = new Date().toISOString().slice(11, 19);
  const row = document.createElement('div');
  row.className = 'console-line';
  row.textContent = `[${time}] ${message}`;
  el.botConsole.appendChild(row);
  el.botConsole.scrollTop = el.botConsole.scrollHeight;
}

// -------------------------------------------------------------
// Profile Persistence
// -------------------------------------------------------------

function loadProfile() {
  chrome.storage.local.get('profile', (res) => {
    if (!res.profile) {
      logToConsole('Initializing default application profile.');
      return;
    }
    const p = res.profile;
    currentProfile = p;

    const pers = p.personal || {};
    el.profFirstName.value = pers.firstName || '';
    el.profLastName.value = pers.lastName || '';
    el.profEmail.value = pers.email || '';
    el.profPhone.value = pers.phone || '';
    el.profCountry.value = pers.country || 'India';
    el.profCity.value = pers.city || '';
    el.profState.value = pers.state || '';

    el.profLinkedin.value = pers.linkedinUrl || '';
    el.profGithub.value = pers.githubUrl || '';
    el.profWebsite.value = pers.portfolioUrl || '';

    const edu = (p.education && p.education[0]) || {};
    el.profSchool.value = edu.school || '';
    el.profDegree.value = edu.degree || 'B.Tech';
    el.profMajor.value = edu.fieldOfStudy || 'Computer Science';
    el.profGpa.value = edu.gpa || '';
    el.profGradYear.value = edu.graduationYear || '2026';

    const prof = p.professional || {};
    el.profYoe.value = prof.totalYearsExperience ?? 1;
    el.profNotice.value = prof.noticePeriodDays ?? 0;
    el.profExpectedSalary.value = prof.expectedSalary || 1500000;
    el.profRelocate.value = prof.willingToRelocate ? 'true' : 'false';
    el.profWorkMode.value = prof.workPreference || 'hybrid';

    const auth = p.workAuthorization || {};
    el.profAuth.value = auth.authorizedInCountry ? 'true' : 'false';
    el.profSponsorship.value = auth.requiresSponsorshipNowOrFuture ? 'true' : 'false';
    el.profFormerEmp.value = auth.formerEmployee ? 'true' : 'false';
    el.profNonCompete.value = auth.hasNonCompete ? 'true' : 'false';

    const eeo = p.eeo || {};
    el.profGender.value = eeo.gender || 'Prefer not to say';
    el.profRace.value = eeo.raceOrEthnicity || 'Asian';
    el.profVeteran.value = eeo.veteranStatus || 'No';
    el.profDisability.value = eeo.disabilityStatus || 'No';

    // QA Bank
    if (p.qaBank) {
      el.qaListContainer.innerHTML = '';
      for (const [q, a] of Object.entries(p.qaBank)) {
        appendQaRow(q, a);
      }
    }

    logToConsole('Profile loaded from storage.');
  });
}

function saveProfile() {
  const qaBank = {};
  const rows = el.qaListContainer.querySelectorAll('.qa-row');
  rows.forEach(r => {
    const k = r.querySelector('.qa-keyword')?.value?.trim();
    const v = r.querySelector('.qa-answer')?.value?.trim();
    if (k && v) qaBank[k] = v;
  });

  const profile = {
    personal: {
      firstName: el.profFirstName.value.trim(),
      lastName: el.profLastName.value.trim(),
      email: el.profEmail.value.trim(),
      phone: el.profPhone.value.trim(),
      country: el.profCountry.value.trim(),
      city: el.profCity.value.trim(),
      state: el.profState.value.trim(),
      linkedinUrl: el.profLinkedin.value.trim(),
      githubUrl: el.profGithub.value.trim(),
      portfolioUrl: el.profWebsite.value.trim(),
    },
    education: [
      {
        school: el.profSchool.value.trim(),
        degree: el.profDegree.value.trim(),
        fieldOfStudy: el.profMajor.value.trim(),
        gpa: el.profGpa.value.trim(),
        graduationYear: el.profGradYear.value.trim(),
      },
    ],
    professional: {
      totalYearsExperience: parseInt(el.profYoe.value, 10) || 1,
      noticePeriodDays: parseInt(el.profNotice.value, 10) || 0,
      expectedSalary: parseInt(el.profExpectedSalary.value, 10) || 1500000,
      willingToRelocate: el.profRelocate.value === 'true',
      workPreference: el.profWorkMode.value,
    },
    workAuthorization: {
      authorizedInCountry: el.profAuth.value === 'true',
      requiresSponsorshipNowOrFuture: el.profSponsorship.value === 'true',
      formerEmployee: el.profFormerEmp.value === 'true',
      hasNonCompete: el.profNonCompete.value === 'true',
      hasSecurityClearance: false,
      felonyConviction: false,
    },
    eeo: {
      gender: el.profGender.value,
      raceOrEthnicity: el.profRace.value,
      veteranStatus: el.profVeteran.value,
      disabilityStatus: el.profDisability.value,
      legalSignatureName: `${el.profFirstName.value.trim()} ${el.profLastName.value.trim()}`,
      signatureDate: new Date().toISOString().slice(0, 10),
    },
    qaBank,
  };

  currentProfile = profile;
  chrome.storage.local.set({ profile }, () => {
    logToConsole('Profile successfully saved.');
    alert('Candidate profile saved!');
  });
}

function appendQaRow(keyword = '', answer = '') {
  const row = document.createElement('div');
  row.className = 'qa-row';
  row.innerHTML = `
    <input type="text" class="text-input qa-keyword" placeholder="Question pattern" value="${keyword}">
    <input type="text" class="text-input qa-answer" placeholder="Answer" value="${answer}">
  `;
  el.qaListContainer.appendChild(row);
}

// -------------------------------------------------------------
// Page Communication & Bot Control
// -------------------------------------------------------------

function scanPageFields() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) return;
    const tabId = tabs[0].id;

    logToConsole('Scanning page with Jobright classifier...');
    chrome.tabs.sendMessage(tabId, { type: 'SCAN_FIELDS' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        logToConsole(`Scan failed: ${chrome.runtime.lastError?.message || 'Content script not ready'}`);
        return;
      }

      currentAts = res.ats;
      el.atsBadge.textContent = `ATS: ${res.ats.toUpperCase()}`;
      el.fieldsCountBadge.textContent = `${res.fieldsCount} Fields`;

      // Update JobWizard stepper
      updateWizardUI(res.ats, res.workdayStep, res.hasNextStep);

      // Render Jobright classifier table
      renderClassifierTable(res.detected);
      logToConsole(`Classification complete: ${res.fieldsCount} inputs analyzed across 60+ taxonomies.`);
    });
  });
}

function updateWizardUI(ats, stepName, hasNextStep) {
  el.wizardPlatformBadge.textContent = ats.toUpperCase();
  el.wizardAdvanceBtn.disabled = !hasNextStep;

  if (ats === 'workday') {
    el.wizardCurrentStep.textContent = (stepName || 'Detecting').replace(/_/g, ' ').toUpperCase();

    // Reset pills
    Object.values(el.stepPills).forEach(p => p.classList.remove('active', 'completed'));

    if (stepName === 'my_information') {
      el.stepPills.info.classList.add('active');
    } else if (stepName === 'my_experience') {
      el.stepPills.info.classList.add('completed');
      el.stepPills.exp.classList.add('active');
    } else if (stepName === 'application_questions') {
      el.stepPills.info.classList.add('completed');
      el.stepPills.exp.classList.add('completed');
      el.stepPills.questions.classList.add('active');
    } else if (stepName === 'voluntary_disclosures') {
      el.stepPills.info.classList.add('completed');
      el.stepPills.exp.classList.add('completed');
      el.stepPills.questions.classList.add('completed');
      el.stepPills.eeo.classList.add('active');
    } else if (stepName === 'review') {
      Object.values(el.stepPills).forEach(p => p.classList.add('completed'));
      el.stepPills.review.classList.add('active');
    }
  } else {
    el.wizardCurrentStep.textContent = hasNextStep ? 'Multi-Step Wizard' : 'Single Page';
  }
}

function renderClassifierTable(detectedList = []) {
  el.fieldsTableBody.innerHTML = '';
  if (!detectedList.length) {
    el.fieldsTableBody.innerHTML = '<tr><td colspan="3" class="empty-table">No inputs found on page.</td></tr>';
    return;
  }

  detectedList.forEach(item => {
    const tr = document.createElement('tr');
    const isKnown = item.category !== 'unknown';
    tr.innerHTML = `
      <td><span class="category-chip ${isKnown ? 'known' : 'unknown'}">${item.category}</span></td>
      <td class="element-tag">&lt;${item.tag}${item.name ? ` name="${item.name}"` : item.id ? ` id="${item.id}"` : ''}&gt;</td>
      <td><span class="confidence-badge ${isKnown ? 'high' : 'low'}">${isKnown ? '95%' : '0%'}</span></td>
    `;
    el.fieldsTableBody.appendChild(tr);
  });
}

function triggerAutoApply() {
  if (!currentProfile) {
    alert('Please save your Candidate Profile first.');
    return;
  }

  const selectedMode = document.querySelector('input[name="runner-mode"]:checked')?.value || 'copilot';

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) return;
    const tabId = tabs[0].id;

    logToConsole(`Launching Auto-Apply in ${selectedMode.toUpperCase()} mode...`);
    el.runAutofillBtn.disabled = true;
    el.runAutofillBtn.textContent = 'Running...';

    chrome.tabs.sendMessage(tabId, {
      type: 'AUTOFILL_FORM',
      profile: currentProfile,
      mode: selectedMode,
    }, (res) => {
      el.runAutofillBtn.disabled = false;
      el.runAutofillBtn.textContent = '⚡ Run Auto-Apply';

      if (chrome.runtime.lastError || !res) {
        logToConsole(`Execution failed: ${chrome.runtime.lastError?.message || 'No response'}`);
        return;
      }

      logToConsole(`Autofill complete: ${res.count} fields filled.`);
      if (res.hasNextStep) {
        el.wizardAdvanceBtn.disabled = false;
        logToConsole('Next step detected! Ready to advance in JobWizard.');
      }
      if (res.errors && res.errors.length) {
        logToConsole(`Validation notice: ${res.errors.length} fields require manual check.`);
      }
    });
  });
}

function advanceWizardStep() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) return;
    const tabId = tabs[0].id;

    logToConsole('JobWizard: Clicking next step button...');
    chrome.tabs.sendMessage(tabId, { type: 'ADVANCE_STEP' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        logToConsole(`Advance failed: ${chrome.runtime.lastError?.message}`);
        return;
      }
      logToConsole(res.message);
      setTimeout(scanPageFields, 2000);
    });
  });
}

// -------------------------------------------------------------
// Event Listeners
// -------------------------------------------------------------

el.refreshPageBtn.addEventListener('click', scanPageFields);
el.scanFieldsBtn.addEventListener('click', scanPageFields);
el.toggleBadgesBtn?.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_FIELD_BADGES' }, (res) => {
      if (res?.badgesVisible) {
        logToConsole('In-DOM field badges enabled.');
        el.toggleBadgesBtn.textContent = '🏷️ Hide Badges';
      } else {
        logToConsole('In-DOM field badges hidden.');
        el.toggleBadgesBtn.textContent = '🏷️ In-DOM Badges';
      }
    });
  });
});
el.runAutofillBtn.addEventListener('click', triggerAutoApply);
el.wizardAdvanceBtn.addEventListener('click', advanceWizardStep);
el.saveProfileBtn.addEventListener('click', saveProfile);
el.addQaBtn.addEventListener('click', () => appendQaRow('', ''));
el.clearConsoleBtn.addEventListener('click', () => {
  el.botConsole.innerHTML = '';
  logToConsole('Console cleared.');
});

// Initialize on open
document.addEventListener('DOMContentLoaded', () => {
  loadProfile();
  setTimeout(scanPageFields, 500);
});
