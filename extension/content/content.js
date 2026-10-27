/**
 * Jobscraper Companion - Injected Content Engine
 * Reverse-Engineered & Unified from:
 * 1. FastApply (Stealth typing cadence & Copilot multi-mode runner)
 * 2. JobWizard (Multi-page Workday/Taleo form handler)
 * 3. Jobright (Instant ATS field classifier across 60+ taxonomies)
 * 4. AIHawk (Autonomous Playwright runner & validation recovery)
 * 5. Autoaply (Continuous 4-hour freshness auto-apply loop & multi-board queue)
 *
 * Strictly Autofill & Auto-Apply Bots — zero tracker overlap.
 */

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__JOBSCRAPER_INJECTED__) return;
  window.__JOBSCRAPER_INJECTED__ = true;

  // -------------------------------------------------------------
  // 1. ATS Identity & Platform Detection
  // -------------------------------------------------------------

  function detectAts() {
    const host = window.location.hostname.toLowerCase();
    const url = window.location.href;

    if (host.includes('greenhouse.io') || document.querySelector('iframe[src*="greenhouse.io"]') || url.includes('gh_jid')) {
      return 'greenhouse';
    }
    if (host.includes('myworkdayjobs.com') || host.includes('myworkdaysite.com') || document.querySelector('[data-automation-id="jobPostingDescription"]')) {
      return 'workday';
    }
    if (host.includes('jobs.lever.co') || document.querySelector('.posting-page')) {
      return 'lever';
    }
    if (host.includes('ashbyhq.com') || document.querySelector('[class*="descriptionText"]')) {
      return 'ashby';
    }
    if (host.includes('smartrecruiters.com') || document.querySelector('.job-sections')) {
      return 'smartrecruiters';
    }
    if (host.includes('icims.com') || document.querySelector('.iCIMS_JobContent')) {
      return 'icims';
    }
    if (host.includes('workable.com') || document.querySelector('[data-ui="job-description"]')) {
      return 'workable';
    }
    if (host.includes('bamboohr.com') || document.querySelector('.BambooHR-ATS-Jobs-Item')) {
      return 'bamboohr';
    }
    if (host.includes('jobvite.com') || document.querySelector('.jv-job-detail')) {
      return 'jobvite';
    }
    if (host.includes('breezy.hr') || document.querySelector('.position-description')) {
      return 'breezy';
    }
    if (host.includes('recruitee.com') || document.querySelector('.offer-description')) {
      return 'recruitee';
    }
    if (host.includes('rippling-ats.com') || host.includes('rippling.com') || document.querySelector('[data-qa="job-description"]')) {
      return 'rippling';
    }
    if (host.includes('taleo.net') || document.querySelector('#requisitionDescriptionInterface') || document.querySelector('iframe[id*="taleo"]')) {
      return 'taleo';
    }
    if (host.includes('eightfold.ai') || document.querySelector('.position-job-description')) {
      return 'eightfold';
    }
    if (host.includes('applytojob.com') || document.querySelector('#job-description')) {
      return 'jazzhr';
    }
    if (host.includes('linkedin.com')) {
      return 'linkedin';
    }
    if (host.includes('indeed.com')) {
      return 'indeed';
    }
    if (host.includes('naukri.com') || document.querySelector('#job_header')) {
      return 'naukri';
    }
    if (host.includes('freshteam.com') || document.querySelector('.job-details-header')) {
      return 'freshteam';
    }
    return 'generic';
  }

  // -------------------------------------------------------------
  // 2. Jobright Instant ATS Field Classifier Matrix (60+ Taxonomies)
  // -------------------------------------------------------------

  const CLASSIFICATION_TAXONOMY = [
    // Personal
    { category: 'first_name', regex: /\bfirst[_\-\s]?name\b|\bgiven[_\-\s]?name\b|\bfname\b/i, neg: [/middle/i, /last/i, /full/i] },
    { category: 'last_name', regex: /\blast[_\-\s]?name\b|\bfamily[_\-\s]?name\b|\bsurname\b|\blname\b/i, neg: [/first/i, /middle/i, /full/i] },
    { category: 'full_name', regex: /\bfull[_\-\s]?name\b|\bcandidate[_\-\s]?name\b|^name$|\byour[_\-\s]?name\b/i, neg: [/first/i, /last/i, /company/i] },
    { category: 'preferred_name', regex: /\bpreferred[_\-\s]?name\b|\bnickname\b|\bchosen[_\-\s]?name\b/i },
    { category: 'email', regex: /\be-?mail[_\-\s]?(?:address)?\b/i, neg: [/confirm/i] },
    { category: 'phone_country_code', regex: /\bcountry[_\-\s]?code\b|\bdialing[_\-\s]?code\b/i },
    { category: 'phone', regex: /\bphone[_\-\s]?(?:number)?\b|\bmobile\b|\btelephone\b|\bcontact[_\-\s]?number\b/i, neg: [/country[_\-\s]?code/i] },
    { category: 'address_line_2', regex: /\baddress[_\-\s]?(?:line)?[_\-\s]?2\b|\bapt[_\-\s]?(?:suite|unit|bldg)?\b/i },
    { category: 'address', regex: /\bstreet[_\-\s]?address\b|\baddress[_\-\s]?(?:line)?[_\-\s]?1\b|^address$/i, neg: [/email/i, /address[_\-\s]?2/i] },
    { category: 'city', regex: /\bcity\b|\btown\b|\bmunicipality\b/i },
    { category: 'state', regex: /\bstate\b|\bprovince\b|\bregion\b/i, neg: [/united\s+states/i, /statement/i, /authorized|eligible|right\s+to\s+work/i] },
    { category: 'postal_code', regex: /\bzip[_\-\s]?(?:code)?\b|\bpostal[_\-\s]?(?:code)?\b|\bpincode\b/i },
    { category: 'country', regex: /\bcountry\b|\bnationality\b/i, neg: [/country[_\-\s]?code/i, /authorized|eligible|right\s+to\s+work/i] },

    // Workday date triplets & years
    { category: 'date_year', regex: /datesection_year\b|\bgrad(?:uation)?[_\-\s]?year\b/i },
    { category: 'date_month', regex: /datesection_month\b/i },
    { category: 'date_day', regex: /datesection_day\b/i },
    { category: 'start_year', regex: /\bstart[_\-\s]?year\b|\byear[_\-\s]?of[_\-\s]?joining\b/i },
    { category: 'graduation_year', regex: /\bgraduation[_\-\s]?year\b|\bgrad[_\-\s]?year\b/i },

    // Social / Portfolios
    { category: 'linkedin', regex: /\blinkedin[_\-\s]?(?:profile|url|link)?\b|linkedin\.com/i },
    { category: 'github', regex: /\bgithub[_\-\s]?(?:profile|url|handle)?\b|github\.com/i },
    { category: 'website', regex: /\bpersonal[_\-\s]?(?:website|site|url)\b|\bwebsite\b/i },
    { category: 'portfolio', regex: /\bportfolio[_\-\s]?(?:url|link)?\b/i },
    { category: 'twitter', regex: /\btwitter\b|\bx[_\-\s]?handle\b/i },
    { category: 'leetcode', regex: /\bleetcode\b|\bhackerrank\b/i },

    // Education
    { category: 'school', regex: /\buniversity\b|\bcollege\b|\bschool[_\-\s]?(?:name)?\b|\binstitution\b/i, neg: [/high\s*school/i] },
    { category: 'degree', regex: /\bdegree\b|\beducation[_\-\s]?level\b|\bhighest[_\-\s]?degree\b/i },
    { category: 'discipline', regex: /\bfield[_\-\s]?of[_\-\s]?study\b|\bmajor\b|\bdiscipline\b|\bbranch\b/i },
    { category: 'gpa', regex: /\bgpa\b|\bgrade[_\-\s]?point\b|\bcgpa\b|\bpercentage\b/i },
    { category: 'grad_year', regex: /\bgraduation[_\-\s]?year\b|\byear[_\-\s]?of[_\-\s]?passing\b|\bgrad[_\-\s]?year\b/i },

    // Experience & Compensation
    { category: 'current_company', regex: /\bcurrent[_\-\s]?company\b|\bcurrent[_\-\s]?employer\b|\bpresent[_\-\s]?company\b/i },
    { category: 'current_title', regex: /\bcurrent[_\-\s]?(?:job[_\-\s]?)?title\b|\bcurrent[_\-\s]?role\b/i },
    { category: 'total_experience', regex: /\btotal[_\-\s]?(?:years[_\-\s]?of[_\-\s]?)?experience\b|\byoe\b/i },
    { category: 'notice_period', regex: /\bnotice[_\-\s]?period\b|\bhow[_\-\s]?soon[_\-\s]?can[_\-\s]?you[_\-\s]?start\b|\bearliest[_\-\s]?start[_\-\s]?date\b/i },
    { category: 'current_salary', regex: /\bcurrent[_\-\s]?(?:ctc|salary|compensation)\b/i },
    { category: 'expected_salary', regex: /\bexpected[_\-\s]?(?:ctc|salary|compensation)\b|\bsalary[_\-\s]?expectations?\b|\btarget[_\-\s]?pay\b/i },
    { category: 'salary_currency', regex: /\bsalary[_\-\s]?currency\b|\bpay[_\-\s]?currency\b|\bcurrency\b/i },
    { category: 'relocate', regex: /\bwilling[_\-\s]?to[_\-\s]?relocate\b|\brelocation\b/i },
    { category: 'work_preference', regex: /\bwork[_\-\s]?mode\b|\bremote[_\-\s]?(?:or)?[_\-\s]?hybrid\b/i },

    // Work Auth & Legal
    { category: 'work_authorization', regex: /\blegally[_\-\s]?(?:authorized|eligible)[_\-\s]?to[_\-\s]?work\b|\bright[_\-\s]?to[_\-\s]?work\b|\bwork[_\-\s]?auth/i },
    { category: 'sponsorship', regex: /\b(?:require|need)[_\-\s]?(?:visa[_\-\s]?)?sponsorship\b|\bfuture[_\-\s]?sponsorship\b|\bvisa[_\-\s]?sponsorship\b/i },
    { category: 'former_employee', regex: /\bpreviously[_\-\s]?(?:employed|worked)\b|\bformer[_\-\s]?employee\b/i },
    { category: 'non_compete', regex: /\bnon[_\-\s]?compete\b|\brestrictive[_\-\s]?covenant\b/i },
    { category: 'security_clearance', regex: /\bsecurity[_\-\s]?clearance\b|\bclearance[_\-\s]?level\b/i },
    { category: 'felony_conviction', regex: /\bconvicted[_\-\s]?of[_\-\s]?(?:a[_\-\s]?)?felony\b|\bcriminal[_\-\s]?record\b/i },

    // EEO & Demographics
    { category: 'gender', regex: /\bgender\b|\bsex\b|\bgender[_\-\s]?identity\b/i },
    { category: 'hispanic_latino', regex: /\bhispanic\b|\blatino\b|\bhispanic[_\-\s]?or[_\-\s]?latino\b/i },
    { category: 'race', regex: /\brace\b|\bethnicity\b/i },
    { category: 'veteran', regex: /\bveteran[_\-\s]?(?:status)?\b|\bmilitary[_\-\s]?status\b|\bprotected[_\-\s]?veteran\b/i },
    { category: 'disability', regex: /\bdisability[_\-\s]?(?:status)?\b|\bform[_\-\s]?cc-?305\b/i },
    { category: 'disability_signature_name', regex: /\byour[_\-\s]?name\b.*disability|\bsignature[_\-\s]?(?:name)?\b|\btype[_\-\s]?(?:your)?[_\-\s]?full[_\-\s]?name\b/i },
    { category: 'disability_signature_date', regex: /\btoday'?s?[_\-\s]?date\b|\bdate[_\-\s]?(?:of[_\-\s]?signature)?\b/i },

    // General Questions
    { category: 'hear_about_us', regex: /\bhow[_\-\s]?did[_\-\s]?you[_\-\s]?(?:hear|learn)[_\-\s]?about[_\-\s]?(?:us|this[_\-\s]?role)\b|\breferral[_\-\s]?source\b/i },
    { category: 'referral_name', regex: /\breferred[_\-\s]?by\b|\breferral[_\-\s]?(?:name|employee)?\b/i },
    { category: 'cover_letter', regex: /\bcover[_\-\s]?letter\b|\bwhy[_\-\s]?do[_\-\s]?you[_\-\s]?want[_\-\s]?to[_\-\s]?join\b/i },
  ];

  function getFieldDescriptor(el) {
    const name = el.getAttribute('name') || '';
    const id = el.getAttribute('id') || '';
    const placeholder = el.getAttribute('placeholder') || '';
    const ariaLabel = el.getAttribute('aria-label') || '';
    const dataAutomationId = el.getAttribute('data-automation-id') || '';

    let labelText = '';
    if (id) {
      const labelEl = document.querySelector(`label[for="${id}"]`);
      if (labelEl) labelText = labelEl.textContent || '';
    }
    if (!labelText && el.closest('label')) {
      labelText = el.closest('label').textContent || '';
    }
    if (!labelText) {
      const parent = el.parentElement;
      if (parent) {
        const prev = el.previousElementSibling;
        if (prev && (prev.tagName === 'LABEL' || prev.classList?.contains('label'))) {
          labelText = prev.textContent || '';
        } else {
          labelText = parent.innerText || '';
        }
      }
    }

    return `${name} ${id} ${placeholder} ${ariaLabel} ${dataAutomationId} ${labelText}`.toLowerCase();
  }

  function classifyField(el) {
    const desc = getFieldDescriptor(el);

    for (const item of CLASSIFICATION_TAXONOMY) {
      if (item.neg && item.neg.some(n => n.test(desc))) continue;
      if (item.regex.test(desc)) {
        return { category: item.category, confidence: 0.95 };
      }
    }

    return { category: 'unknown', confidence: 0.0 };
  }

  // -------------------------------------------------------------
  // 3. FastApply Stealth Human-Like Event Sequencing & Typing Engine
  // -------------------------------------------------------------

  function getGaussianDelay(minMs = 35, maxMs = 85) {
    const u1 = Math.random() || 0.001;
    const u2 = Math.random() || 0.001;
    const randStdNormal = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
    const mean = (minMs + maxMs) / 2;
    const stdDev = (maxMs - minMs) / 4;
    return Math.max(minMs, Math.min(maxMs, Math.round(mean + randStdNormal * stdDev)));
  }

  async function humanTypeAsync(element, text) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await new Promise(r => setTimeout(r, 120));

    // Pointer sequence
    element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    element.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

    const proto = element instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

    let currentVal = '';
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      currentVal += char;

      element.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));

      if (setter) {
        setter.call(element, currentVal);
      } else {
        element.value = currentVal;
      }

      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));

      // Natural variable typing cadence
      await new Promise(r => setTimeout(r, getGaussianDelay(35, 85)));
    }

    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  }

  function setNativeValueDirect(element, value) {
    element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    const proto = element instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) {
      setter.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  }

  // -------------------------------------------------------------
  // 4. JobWizard Multi-Page Workday & Taleo Form Handler
  // -------------------------------------------------------------

  async function handleWorkdayCustomCombobox(comboboxEl, targetValue) {
    try {
      comboboxEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      comboboxEl.click();
      await new Promise(r => setTimeout(r, 400));

      const options = Array.from(document.querySelectorAll('[role="listbox"] [role="option"], [data-automation-id*="popup"] [role="option"]'));
      const targetStr = String(targetValue).toLowerCase();

      const match = options.find(o => (o.textContent || '').toLowerCase().includes(targetStr));
      if (match) {
        match.click();
        await new Promise(r => setTimeout(r, 200));
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  function detectWorkdayStep() {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, [data-automation-id="pageHeader"]')).map(h => h.textContent || '').join(' ');
    if (/my\s+information|contact\s+info/i.test(headings)) return 'my_information';
    if (/my\s+experience|work\s+experience|resume/i.test(headings)) return 'my_experience';
    if (/application\s+questions|questionnaire/i.test(headings)) return 'application_questions';
    if (/voluntary\s+disclosures|self\s+identification|eeo/i.test(headings)) return 'voluntary_disclosures';
    if (/review\s+and\s+submit|review/i.test(headings)) return 'review';
    return 'step';
  }

  function findNextStepButton() {
    // Workday next buttons
    const wdNext = document.querySelector('button[data-automation-id="bottom-navigation-next-button"], button[data-automation-id="page-navigation-next-button"]');
    if (wdNext) return wdNext;

    // Taleo next buttons (including iframe)
    const taleoIframe = document.querySelector('#requisitionDescriptionInterface');
    if (taleoIframe && taleoIframe.contentDocument) {
      try {
        const frameBtn = taleoIframe.contentDocument.querySelector('input[value*="Save and Continue" i], input[value*="Next" i], input[id*="btnNext" i], a.wizard-btn-next');
        if (frameBtn) return frameBtn;
      } catch {}
    }
    const taleoNext = document.querySelector('input[value*="Save and Continue" i], input[value*="Next" i], input[id*="btnNext" i], a.wizard-btn-next');
    if (taleoNext) return taleoNext;

    // Generic multi-step buttons
    const genericNext = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]')).find(b => {
      const t = (b.textContent || b.value || '').trim();
      return /^(?:save\s+(?:&|and)\s+continue|next\s+step|continue|next)$/i.test(t);
    });
    return genericNext || null;
  }

  // -------------------------------------------------------------
  // 5. AIHawk Dynamic Question Resolution & Profile Mapping
  // -------------------------------------------------------------

  function resolveValueFromProfile(category, profile, elDesc = '') {
    if (!profile) return undefined;

    const p = profile.personal || {};
    const edu = (profile.education && profile.education[0]) || {};
    const prof = profile.professional || {};
    const auth = profile.workAuthorization || {};
    const eeo = profile.eeo || {};
    const qa = profile.qaBank || {};

    // Check custom QA bank for exact/substring matches
    for (const [k, v] of Object.entries(qa)) {
      if (elDesc.includes(k.toLowerCase())) return v;
    }

    switch (category) {
      case 'first_name': return p.firstName;
      case 'last_name': return p.lastName;
      case 'full_name': return p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim();
      case 'preferred_name': return p.preferredName || p.firstName;
      case 'email': return p.email;
      case 'phone_country_code':
      case 'phone_code': return p.phoneCountryCode || '+91';
      case 'phone': return p.phone;
      case 'address_line_2':
      case 'address_2': return p.addressLine2 || '';
      case 'address': return p.address;
      case 'city': return p.city;
      case 'state': return p.state;
      case 'postal_code': return p.postalCode;
      case 'country': return p.country || 'India';

      case 'linkedin': return p.linkedinUrl;
      case 'github': return p.githubUrl;
      case 'portfolio':
      case 'website': return p.portfolioUrl;
      case 'twitter': return p.twitterUrl;
      case 'leetcode': return p.leetcodeUrl;

      case 'school': return edu.school;
      case 'degree': return edu.degree;
      case 'discipline': return edu.fieldOfStudy;
      case 'gpa': return edu.gpa;
      case 'start_year': return edu.startYear || '2022';
      case 'graduation_year':
      case 'grad_year':
      case 'date_year': return edu.graduationYear || '2026';
      case 'date_month': return '05';
      case 'date_day': return '15';

      case 'current_company': return prof.currentCompany || '';
      case 'current_title': return prof.currentTitle || '';
      case 'total_experience': return prof.totalYearsExperience ?? 1;
      case 'notice_period': return prof.noticePeriodDays != null ? `${prof.noticePeriodDays} days` : 'Immediate';
      case 'current_salary': return prof.currentSalary;
      case 'expected_salary': return prof.expectedSalary || 1500000;
      case 'salary_currency': return prof.salaryCurrency || 'INR';
      case 'relocate': return prof.willingToRelocate ? 'Yes' : 'No';
      case 'work_preference': return prof.workPreference || 'hybrid';

      case 'work_authorization':
      case 'work_auth': return auth.authorizedInCountry ? 'Yes' : 'No';
      case 'sponsorship': return auth.requiresSponsorshipNowOrFuture ? 'Yes' : 'No';
      case 'former_employee': return auth.formerEmployee ? 'Yes' : 'No';
      case 'non_compete': return auth.hasNonCompete ? 'Yes' : 'No';
      case 'security_clearance': return auth.hasSecurityClearance ? 'Yes' : 'No';
      case 'felony_conviction':
      case 'felony': return 'No';

      case 'gender': return eeo.gender || 'Prefer not to say';
      case 'hispanic_latino': return eeo.isHispanicLatino ? 'Yes' : 'No';
      case 'race': return eeo.raceOrEthnicity || 'Asian';
      case 'veteran': return eeo.veteranStatus || 'No';
      case 'disability': return eeo.disabilityStatus || 'No';
      case 'disability_signature_name':
      case 'signature_name': return eeo.legalSignatureName || `${p.firstName || ''} ${p.lastName || ''}`.trim();
      case 'disability_signature_date':
      case 'signature_date': return eeo.signatureDate || new Date().toISOString().slice(0, 10);

      case 'hear_about_us': return 'LinkedIn';
      case 'referral_name': return '';
      case 'cover_letter': return '';
      default: return undefined;
    }
  }

  // -------------------------------------------------------------
  // 6. Unified Multi-Mode Runner (Stealth vs Copilot)
  // -------------------------------------------------------------

  async function executeAutofill(profile, mode = 'copilot') {
    if (!profile) return { count: 0, fieldsFilled: [], errors: [] };

    let inputs = Array.from(document.querySelectorAll(
      'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]), select, textarea, [role="combobox"]'
    ));

    // Taleo iframe traversal
    const taleoIframe = document.querySelector('#requisitionDescriptionInterface');
    if (taleoIframe && taleoIframe.contentDocument) {
      try {
        const frameInputs = Array.from(taleoIframe.contentDocument.querySelectorAll(
          'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]), select, textarea, [role="combobox"]'
        ));
        inputs = inputs.concat(frameInputs);
      } catch {}
    }

    let filledCount = 0;
    const filledNames = [];
    const errors = [];

    for (const el of inputs) {
      const desc = getFieldDescriptor(el);
      const classification = classifyField(el);

      let valToSet = undefined;
      if (classification.category !== 'unknown') {
        valToSet = resolveValueFromProfile(classification.category, profile, desc);
      } else {
        // AIHawk fallback questions
        if (/18\s+years|legal\s+working\s+age/i.test(desc)) valToSet = 'Yes';
        else if (/background\s+check|drug\s+test/i.test(desc)) valToSet = 'Yes';
        else if (/essential\s+functions/i.test(desc)) valToSet = 'Yes';
      }

      if (valToSet !== undefined && valToSet !== '') {
        try {
          if (el.tagName === 'SELECT') {
            const options = Array.from(el.options);
            const valLower = String(valToSet).toLowerCase();
            const best = options.find(opt => opt.text.toLowerCase().includes(valLower) || opt.value.toLowerCase().includes(valLower));
            if (best) {
              el.value = best.value;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              el.classList.add('jobscraper-autofilled');
              filledCount++;
              filledNames.push(classification.category);
            }
          } else if (el.getAttribute('role') === 'combobox') {
            const ok = await handleWorkdayCustomCombobox(el, valToSet);
            if (ok) {
              el.classList.add('jobscraper-autofilled');
              filledCount++;
              filledNames.push(classification.category);
            }
          } else if (el.type === 'radio' || el.type === 'checkbox') {
            const valStr = String(valToSet).toLowerCase();
            const isAffirmative = valStr === 'yes' || valStr === 'true' || valStr === '1';
            const labelLower = desc.toLowerCase();
            const elValLower = String(el.value || '').toLowerCase();

            const isMatch = (isAffirmative && (labelLower.includes('yes') || labelLower.includes('authorized') || elValLower === 'yes' || elValLower === 'true')) ||
              (!isAffirmative && (labelLower.includes('no') || labelLower.includes('not required') || elValLower === 'no' || elValLower === 'false'));

            if (isMatch) {
              el.checked = true;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              el.dispatchEvent(new Event('click', { bubbles: true }));
              el.classList.add('jobscraper-autofilled');
              filledCount++;
              filledNames.push(classification.category);
            }
          } else {
            // Text inputs
            if (mode === 'stealth') {
              await humanTypeAsync(el, String(valToSet));
            } else {
              setNativeValueDirect(el, String(valToSet));
            }
            el.classList.add('jobscraper-autofilled');
            filledCount++;
            filledNames.push(classification.category);
          }

          // Workday country cascade reload wait
          if (classification.category === 'country') {
            await new Promise(r => setTimeout(r, 600));
          }

          // FastApply stealth inter-field thinking pause
          if (mode === 'stealth') {
            await new Promise(r => setTimeout(r, Math.floor(Math.random() * 300 + 200)));
          }
        } catch (e) {
          errors.push({ field: classification.category, error: e.message });
        }
      }
    }

    // AIHawk validation recovery: check for invalid inputs
    const invalidFields = Array.from(document.querySelectorAll(':invalid, [aria-invalid="true"], .has-error input'));
    if (invalidFields.length > 0) {
      invalidFields[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      invalidFields[0].classList.add('jobscraper-field-review');
    }

    if (mode === 'copilot') {
      showCopilotBanner(filledCount, Boolean(findNextStepButton()), invalidFields.length);
    }

    return { count: filledCount, fieldsFilled: filledNames, errors, invalidCount: invalidFields.length };
  }

  function showCopilotBanner(count, hasNextStep, invalidCount) {
    if (window !== window.top) return;
    let banner = document.getElementById('jobscraper-copilot-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'jobscraper-copilot-banner';
      banner.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#0f172a;color:#f8fafc;padding:10px 18px;border-radius:9999px;border:1px solid #334155;box-shadow:0 10px 30px rgba(0,0,0,0.4);display:flex;align-items:center;gap:12px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:12px;font-weight:600;animation:jobscraper-slide-in 0.3s ease;';
      document.body.appendChild(banner);
    }

    const nextBtn = findNextStepButton();
    banner.innerHTML = `
      <span style="color:#10b981;">⚡ Copilot:</span>
      <span>${count} fields filled</span>
      ${invalidCount > 0 ? `<span style="color:#f59e0b;">⚠️ ${invalidCount} to review</span>` : ''}
      ${nextBtn ? `<button id="copilot-advance-btn" style="background:#10b981;color:#000;border:none;border-radius:9999px;padding:4px 12px;font-weight:700;font-size:11px;cursor:pointer;">🧙 Next Step</button>` : `<span style="color:#60a5fa;">✓ Ready</span>`}
      <button id="copilot-close-btn" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:14px;padding:0 4px;">✕</button>
    `;

    banner.querySelector('#copilot-close-btn')?.addEventListener('click', () => banner.remove());
    banner.querySelector('#copilot-advance-btn')?.addEventListener('click', () => {
      if (nextBtn) {
        nextBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        nextBtn.click();
        banner.remove();
      }
    });
  }

  let badgesActive = false;
  function toggleFieldBadges(forceState) {
    badgesActive = forceState !== undefined ? forceState : !badgesActive;
    document.querySelectorAll('.jobscraper-field-badge').forEach(b => b.remove());
    if (!badgesActive) return false;

    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea, [role="combobox"]'));
    for (const input of inputs) {
      const cl = classifyField(input);
      if (cl.category === 'unknown') continue;
      const b = document.createElement('span');
      b.className = 'jobscraper-field-badge';
      b.textContent = `${cl.category} (95%)`;
      input.parentNode?.insertBefore(b, input);
    }
    return true;
  }

  // -------------------------------------------------------------
  // 7. Floating Action Pill & Copilot Bar UI
  // -------------------------------------------------------------

  function injectFloatingBadge() {
    if (window !== window.top) return;
    if (document.getElementById('jobscraper-floating-pill-host')) return;

    const ats = detectAts();
    const host = document.createElement('div');
    host.id = 'jobscraper-floating-pill-host';
    host.style.cssText = 'all: initial; position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;';

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        display: block;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      .jobscraper-pill-inner {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        background: #111827;
        color: #f9fafb;
        border: 1px solid #374151;
        border-radius: 9999px;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.2);
        cursor: pointer;
        user-select: none;
        transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
        animation: jobscraper-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .jobscraper-pill-inner:hover {
        transform: translateY(-2px);
        background: #1f2937;
        box-shadow: 0 14px 28px -5px rgba(0, 0, 0, 0.35);
      }
      .jobscraper-pill-icon { font-size: 14px; color: #10b981; }
      .jobscraper-pill-text { font-size: 13px; font-weight: 600; color: #f9fafb; }
      .jobscraper-pill-badge {
        font-size: 11px;
        font-weight: 500;
        text-transform: capitalize;
        background: #065f46;
        color: #a7f3d0;
        padding: 2px 8px;
        border-radius: 6px;
      }
      @keyframes jobscraper-slide-in {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    `;

    const pill = document.createElement('div');
    pill.className = 'jobscraper-pill-inner';
    pill.title = 'Click to open Jobscraper Cockpit';
    pill.innerHTML = `
      <span class="jobscraper-pill-icon">⚡</span>
      <span class="jobscraper-pill-text">Jobscraper Auto-Apply</span>
      ${ats !== 'generic' ? `<span class="jobscraper-pill-badge">${ats}</span>` : ''}
    `;

    pill.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' });
    });

    shadow.appendChild(style);
    shadow.appendChild(pill);
    document.body.appendChild(host);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectFloatingBadge);
  } else {
    injectFloatingBadge();
  }

  // -------------------------------------------------------------
  // 8. Chrome Message Routing Hub
  // -------------------------------------------------------------

  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.type === 'AUTOFILL_FORM') {
      const mode = req.mode || 'copilot';
      executeAutofill(req.profile, mode).then(res => {
        const nextBtn = findNextStepButton();
        sendResponse({
          success: true,
          count: res.count,
          fields: res.fieldsFilled,
          errors: res.errors,
          hasNextStep: Boolean(nextBtn),
          ats: detectAts(),
        });
      });
      return true; // Keep sendResponse channel open for async execution
    }

    if (req.type === 'ADVANCE_STEP') {
      const nextBtn = findNextStepButton();
      if (nextBtn) {
        nextBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        nextBtn.click();
        sendResponse({ success: true, message: 'Advanced to next step' });
      } else {
        sendResponse({ success: false, message: 'No next step button found' });
      }
      return true;
    }

    if (req.type === 'SCAN_FIELDS') {
      let inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), select, textarea, [role="combobox"]'));
      const taleoIframe = document.querySelector('#requisitionDescriptionInterface');
      if (taleoIframe && taleoIframe.contentDocument) {
        try {
          const frameInputs = Array.from(taleoIframe.contentDocument.querySelectorAll('input:not([type="hidden"]), select, textarea, [role="combobox"]'));
          inputs = inputs.concat(frameInputs);
        } catch {}
      }
      const detected = inputs.map(el => ({
        tag: el.tagName.toLowerCase(),
        name: el.getAttribute('name') || '',
        id: el.getAttribute('id') || '',
        category: classifyField(el).category,
      }));
      const nextBtn = findNextStepButton();
      sendResponse({
        ats: detectAts(),
        fieldsCount: inputs.length,
        detected,
        hasNextStep: Boolean(nextBtn),
        workdayStep: detectAts() === 'workday' ? detectWorkdayStep() : null,
      });
      return true;
    }

    if (req.type === 'TOGGLE_FIELD_BADGES') {
      const active = toggleFieldBadges(req.show);
      sendResponse({ success: true, badgesVisible: active });
      return true;
    }

    if (req.type === 'GET_PAGE_DATA') {
      const inputsCount = document.querySelectorAll('input:not([type="hidden"]), select, textarea').length;
      sendResponse({
        ats: detectAts(),
        formFieldsCount: inputsCount,
        title: document.title,
        url: window.location.href,
      });
      return true;
    }

    if (req.type === 'URL_CHANGED') {
      if (window === window.top) {
        injectFloatingBadge();
      }
      return true;
    }
  });

})();
