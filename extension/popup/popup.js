/**
 * Jobscraper Auto-Apply Bot - Popup Controller
 * Reverse-Engineered from FastApply, JobWizard, Jobright & AIHawk.
 * Strictly Autofill & Auto-Apply — Zero Tracker Overlap.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const atsBadge = document.getElementById('popup-ats-badge');
  const fieldsCountEl = document.getElementById('popup-fields-count');
  const stepStatusEl = document.getElementById('popup-step-status');
  const autofillBtn = document.getElementById('popup-autofill-btn');
  const advanceBtn = document.getElementById('popup-advance-btn');
  const scanBtn = document.getElementById('popup-scan-btn');
  const sidepanelBtn = document.getElementById('popup-sidepanel-btn');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  function scanTab() {
    if (!tab?.id) return;
    chrome.tabs.sendMessage(tab.id, { type: 'SCAN_FIELDS' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        atsBadge.textContent = 'NO FORM';
        fieldsCountEl.textContent = '0 detected';
        return;
      }

      atsBadge.textContent = res.ats.toUpperCase();
      fieldsCountEl.textContent = `${res.fieldsCount} inputs`;
      stepStatusEl.textContent = res.workdayStep ? res.workdayStep.replace(/_/g, ' ') : res.hasNextStep ? 'Multi-Step' : 'Complete';
      advanceBtn.disabled = !res.hasNextStep;
    });
  }

  scanTab();

  // Run Auto-Apply
  autofillBtn.addEventListener('click', () => {
    if (!tab?.id) return;
    const mode = document.querySelector('input[name="popup-mode"]:checked')?.value || 'copilot';

    chrome.storage.local.get(['profile'], (data) => {
      autofillBtn.disabled = true;
      autofillBtn.innerHTML = '<span>⚡ Running...</span>';

      chrome.tabs.sendMessage(tab.id, {
        type: 'AUTOFILL_FORM',
        profile: data.profile,
        mode,
      }, (res) => {
        autofillBtn.disabled = false;
        if (res?.success) {
          autofillBtn.innerHTML = `<span>✓ Filled ${res.count}!</span>`;
          if (res.hasNextStep) advanceBtn.disabled = false;
          setTimeout(() => {
            autofillBtn.innerHTML = '<span class="btn-icon">⚡</span><span class="btn-label">Run Auto-Apply</span>';
          }, 2500);
        } else {
          autofillBtn.innerHTML = '<span>Failed</span>';
          setTimeout(() => {
            autofillBtn.innerHTML = '<span class="btn-icon">⚡</span><span class="btn-label">Run Auto-Apply</span>';
          }, 2000);
        }
      });
    });
  });

  // Advance Step (JobWizard)
  advanceBtn.addEventListener('click', () => {
    if (!tab?.id) return;
    chrome.tabs.sendMessage(tab.id, { type: 'ADVANCE_STEP' }, (res) => {
      advanceBtn.innerHTML = '<span>✓ Advanced!</span>';
      setTimeout(() => {
        advanceBtn.innerHTML = '<span class="btn-icon">🧙</span><span class="btn-label">Next Step</span>';
        scanTab();
      }, 1500);
    });
  });

  // Scan Fields (Jobright)
  scanBtn.addEventListener('click', () => {
    scanTab();
    scanBtn.innerHTML = '<span>✓ Scanned!</span>';
    setTimeout(() => {
      scanBtn.innerHTML = '<span class="btn-icon">🎯</span><span class="btn-label">Scan Fields</span>';
    }, 1200);
  });

  // Open Full Cockpit
  sidepanelBtn.addEventListener('click', () => {
    if (tab?.id) {
      chrome.sidePanel.open({ tabId: tab.id });
      window.close();
    }
  });
});
