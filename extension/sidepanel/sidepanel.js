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
    el.profCountry.value = pers.country || '';
    el.profCity.value = pers.city || '';
    el.profState.value = pers.state || '';

    el.profLinkedin.value = pers.linkedinUrl || '';
    el.profGithub.value = pers.githubUrl || '';
    el.profWebsite.value = pers.portfolioUrl || '';

    const edu = (p.education && p.education[0]) || {};
    el.profSchool.value = edu.school || '';
    el.profDegree.value = edu.degree || '';
    el.profMajor.value = edu.fieldOfStudy || '';
    el.profGpa.value = edu.gpa || '';
    el.profGradYear.value = edu.graduationYear || '';

    const prof = p.professional || {};
    el.profYoe.value = prof.totalYearsExperience ?? '';
    el.profNotice.value = prof.noticePeriodDays ?? '';
    el.profExpectedSalary.value = prof.expectedSalary ?? '';
    el.profRelocate.value = prof.willingToRelocate === undefined ? '' : String(prof.willingToRelocate);
    el.profWorkMode.value = prof.workPreference || '';

    const auth = p.workAuthorization || {};
    el.profAuth.value = auth.authorizedInCountry === undefined ? '' : String(auth.authorizedInCountry);
    el.profSponsorship.value = auth.requiresSponsorshipNowOrFuture === undefined ? '' : String(auth.requiresSponsorshipNowOrFuture);
    el.profFormerEmp.value = auth.formerEmployee === undefined ? '' : String(auth.formerEmployee);
    el.profNonCompete.value = auth.hasNonCompete === undefined ? '' : String(auth.hasNonCompete);

    const eeo = p.eeo || {};
    el.profGender.value = eeo.gender || '';
    el.profRace.value = eeo.raceOrEthnicity || '';
    el.profVeteran.value = eeo.veteranStatus || '';
    el.profDisability.value = eeo.disabilityStatus || '';

    // QA Bank
    if (p.qaBank) {
      el.qaListContainer.innerHTML = '';
      for (const [q, a] of Object.entries(p.qaBank)) {
        appendQaRow(q, a);
      }
    }

    loadAdditionalProfile(p);
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
    ...currentProfile,
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
      totalYearsExperience: el.profYoe.value === '' ? undefined : Number(el.profYoe.value),
      noticePeriodDays: el.profNotice.value === '' ? undefined : Number(el.profNotice.value),
      expectedSalary: el.profExpectedSalary.value === '' ? undefined : Number(el.profExpectedSalary.value),
      willingToRelocate: el.profRelocate.value === '' ? undefined : el.profRelocate.value === 'true',
      workPreference: el.profWorkMode.value || undefined,
    },
    workAuthorization: {
      authorizedInCountry: el.profAuth.value === '' ? undefined : el.profAuth.value === 'true',
      requiresSponsorshipNowOrFuture: el.profSponsorship.value === '' ? undefined : el.profSponsorship.value === 'true',
      formerEmployee: el.profFormerEmp.value === '' ? undefined : el.profFormerEmp.value === 'true',
      hasNonCompete: el.profNonCompete.value === '' ? undefined : el.profNonCompete.value === 'true',

    },
    eeo: {
      gender: el.profGender.value,
      raceOrEthnicity: el.profRace.value,
      veteranStatus: el.profVeteran.value,
      disabilityStatus: el.profDisability.value,

    },
    qaBank,
  };

  readAdditionalProfile(profile);
  if (!profile.personal.firstName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.personal.email)) {
    alert('Enter your first name and a valid email.'); return;
  }
  currentProfile = profile;
  chrome.storage.local.set({ profile }, () => {
    logToConsole('Profile successfully saved.');
    if (chrome.runtime.lastError) { alert(chrome.runtime.lastError.message); return; }
    alert('Candidate profile saved!');
  });
}

function appendQaRow(keyword = '', answer = '') {
  const row = document.createElement('div');
  row.className = 'qa-row';
  for (const [className, placeholder, value] of [['qa-keyword', 'Question pattern', keyword], ['qa-answer', 'Answer', answer]]) {
    const input = document.createElement('input');
    input.type = 'text'; input.className = `text-input ${className}`;
    input.placeholder = placeholder; input.value = value; row.appendChild(input);
  }
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
// Additional fields use the same candidate structure as the CLI.
const extraSchema = {
  personal: [['phoneCountryCode', 'Phone country code'], ['address', 'Street address'], ['addressLine2', 'Address line 2'], ['postalCode', 'Postal code'], ['preferredName', 'Preferred name'], ['twitterUrl', 'Twitter URL'], ['leetcodeUrl', 'LeetCode URL']],
  professional: [['currentCompany', 'Current company'], ['currentTitle', 'Current title'], ['currentSalary', 'Current salary', 'number'], ['salaryCurrency', 'Salary currency']],
  workAuthorization: [['hasSecurityClearance', 'Security clearance', 'boolean'], ['felonyConviction', 'Felony conviction', 'boolean']],
  eeo: [['isHispanicLatino', 'Hispanic or Latino', 'boolean'], ['legalSignatureName', 'Signature name'], ['signatureDate', 'Signature date', 'date']],
};
let uploadedDocuments = {};

function profileControl(parent, key, label, type = 'text', value) {
  const container = document.createElement('div'); container.className = 'form-group';
  const caption = document.createElement('label'); caption.textContent = label;
  const input = document.createElement(type === 'boolean' ? 'select' : 'input');
  input.id = `extra-${key}-${Math.random().toString(36).slice(2)}`;
  caption.htmlFor = input.id;
  input.className = 'text-input'; input.dataset.key = key;
  if (type === 'boolean') {
    for (const [value, text] of [['', 'Unknown / leave unanswered'], ['true', 'Yes'], ['false', 'No']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; input.appendChild(option);
    }
  } else { input.type = type; if (type === 'number') { input.min = '0'; input.step = 'any'; } }
  input.value = value === undefined ? '' : String(value);
  container.append(caption, input); parent.appendChild(container);
}

function historyRow(kind, entry = {}) {
  const holder = document.querySelector(`#extra-${kind}`);
  const row = document.createElement('fieldset'); row.dataset.history = kind;
  const legend = document.createElement('legend'); legend.textContent = kind === 'education' ? 'Additional education' : 'Employment'; row.appendChild(legend);
  const fields = kind === 'education'
    ? [['school', 'School'], ['degree', 'Degree'], ['fieldOfStudy', 'Field of study'], ['gpa', 'GPA'], ['startYear', 'Start year'], ['graduationYear', 'Graduation year']]
    : [['title', 'Title'], ['company', 'Company'], ['location', 'Location'], ['startDate', 'Start date', 'date'], ['endDate', 'End date', 'date'], ['current', 'Currently employed here', 'boolean'], ['description', 'Responsibilities']];
  for (const [key, label, type] of fields) profileControl(row, key, label, type, entry[key]);
  const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove entry'; remove.onclick = () => row.remove();
  row.appendChild(remove); holder.appendChild(row);
}

function loadAdditionalProfile(profile = {}) {
  const root = document.getElementById('additional-profile'); root.replaceChildren();
  for (const [section, fields] of Object.entries(extraSchema)) {
    const group = document.createElement('div'); group.dataset.section = section; group.className = 'form-grid';
    for (const [key, label, type] of fields) profileControl(group, key, label, type, profile[section]?.[key]);
    root.appendChild(group);
  }
  for (const kind of ['education', 'experience']) {
    const group = document.createElement('div'); group.id = `extra-${kind}`; root.appendChild(group);
    for (const entry of (profile[kind] || []).slice(kind === 'education' ? 1 : 0)) historyRow(kind, entry);
    const add = document.createElement('button'); add.type = 'button'; add.className = 'small-btn';
    add.textContent = kind === 'education' ? 'Add education' : 'Add employment'; add.onclick = () => historyRow(kind); root.appendChild(add);
  }
  profileControl(root, 'skills', 'Skills, separated by commas', 'text', (profile.skills || []).join(', '));
  profileControl(root, 'coverLetterText', 'Cover letter text', 'text', profile.coverLetterText);
  profileControl(root, 'educationStartYear', 'First education start year', 'text', profile.education?.[0]?.startYear);
  uploadedDocuments = profile.documentUploads || {};
  for (const [kind, title] of [['resume', 'Resume'], ['coverLetter', 'Cover letter']]) {
    profileControl(root, kind, `${title} file`, 'file');
    const input = root.querySelector(`input[data-key="${kind}"]`); input.accept = '.pdf,.doc,.docx,.txt';
    const name = document.createElement('span'); name.textContent = uploadedDocuments[kind]?.name || 'No file selected'; input.after(name);
    const clear = document.createElement('button'); clear.type = 'button'; clear.textContent = `Remove ${title.toLowerCase()}`;
    clear.onclick = () => { delete uploadedDocuments[kind]; input.value = ''; name.textContent = 'No file selected'; }; name.after(clear);
    input.onchange = async () => {
      const file = input.files[0]; if (!file) return;
      const other = Object.entries(uploadedDocuments).filter(([key]) => key !== kind).reduce((sum, [, item]) => sum + (item.size || 0), 0);
      if (file.size + other > 6 * 1024 * 1024) { alert('Combined documents must be under 6 MB.'); input.value = ''; return; }
      const reader = new FileReader();
      reader.onload = () => { uploadedDocuments[kind] = { name: file.name, type: file.type, size: file.size, base64: String(reader.result).split(',')[1] }; name.textContent = file.name; };
      reader.onerror = () => alert('File could not be read'); reader.readAsDataURL(file);
    };
  }
}

function readAdditionalProfile(profile) {
  const read = control => control.value === '' ? undefined : control.tagName === 'SELECT' ? control.value === 'true' : control.type === 'number' ? Number(control.value) : control.value;
  for (const group of document.querySelectorAll('#additional-profile [data-section]')) {
    for (const control of group.querySelectorAll('[data-key]')) profile[group.dataset.section][control.dataset.key] = read(control);
  }
  profile.skills = document.querySelector('[data-key=skills]').value.split(',').map(skill => skill.trim()).filter(Boolean);
  profile.coverLetterText = document.querySelector('[data-key=coverLetterText]').value || undefined;
  profile.education[0].startYear = document.querySelector('[data-key=educationStartYear]').value || undefined;
  const firstEducation = { ...currentProfile?.education?.[0], ...profile.education[0] };
  profile.education = Object.values(firstEducation).some(Boolean) ? [firstEducation] : [];
  profile.experience = [];
  for (const row of document.querySelectorAll('[data-history]')) {
    const entry = {};
    for (const control of row.querySelectorAll('[data-key]')) entry[control.dataset.key] = read(control);
    profile[row.dataset.history].push(entry);
  }
  profile.documentUploads = uploadedDocuments;
}

loadAdditionalProfile();
for (const control of document.querySelectorAll('#sec-profile input[id], #sec-profile select[id]')) {
  const label = control.parentElement.querySelector('label'); if (label) label.htmlFor = control.id;
}
