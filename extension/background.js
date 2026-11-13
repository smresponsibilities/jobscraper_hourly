/**
 * Jobscraper Companion - Background Service Worker (Manifest V3)
 */

chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

chrome.runtime.onInstalled.addListener(() => {
  console.log('Jobscraper Companion extension installed.');

  // Initialize storage defaults if empty
  chrome.storage.local.get(['profile', 'savedJobs'], (result) => {
    if (!result.profile) {
      chrome.storage.local.set({
        profile: {
          personal: {
            firstName: '',
            lastName: '',
            email: '',
            phone: '',
            linkedinUrl: '',
            githubUrl: '',
            portfolioUrl: '',
            city: '',
            state: '',
            country: 'India',
          },
          education: [],
          experience: [],
          professional: {},
          workAuthorization: {},
          eeo: {},
          resumeText: '',
        },
      });
    }

    if (!result.savedJobs) {
      chrome.storage.local.set({ savedJobs: [] });
    }
  });

  // Create context menus for quick access
  chrome.contextMenus.create({
    id: 'jobscraper_open_panel',
    title: 'Open Jobscraper Side Panel',
    contexts: ['page', 'selection'],
  });

  chrome.contextMenus.create({
    id: 'jobscraper_autofill',
    title: 'Autofill Application Form',
    contexts: ['page', 'editable'],
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;

  if (info.menuItemId === 'jobscraper_open_panel') {
    chrome.sidePanel.open({ tabId: tab.id }).catch((err) => console.warn('Could not open sidePanel:', err));
  } else if (info.menuItemId === 'jobscraper_autofill') {
    chrome.storage.local.get('profile', (res) => {
      chrome.tabs.sendMessage(tab.id, {
        type: 'AUTOFILL_FORM',
        profile: res.profile,
      }).catch((err) => console.warn('Autofill message failed:', err));
    });
  }
});

// Reactively notify active tab on navigation/SPA URL update (matches Teal Uc handler)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.status === 'complete' || changeInfo.url)) {
    chrome.tabs.sendMessage(tabId, { type: 'URL_CHANGED', url: tab.url }).catch(() => {});
  }
});

// Message routing hub
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OPEN_SIDEPANEL') {
    if (sender.tab?.id) {
      chrome.sidePanel.open({ tabId: sender.tab.id })
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }
  }

  if (message.type === 'SAVE_JOB') {
    chrome.storage.local.get({ savedJobs: [] }, (data) => {
      const jobs = data.savedJobs;
      const existingIdx = jobs.findIndex((j) => j.url === message.job.url || (j.externalId && j.externalId === message.job.externalId));

      if (existingIdx !== -1) {
        jobs[existingIdx] = { ...jobs[existingIdx], ...message.job, updatedAt: new Date().toISOString() };
      } else {
        jobs.unshift({
          ...message.job,
          id: 'job_' + Date.now(),
          status: message.job.status || 'Saved',
          savedAt: new Date().toISOString(),
        });
      }

      chrome.storage.local.set({ savedJobs: jobs }, () => {
        sendResponse({ success: true, count: jobs.length });
      });
    });
    return true;
  }

  if (message.type === 'GET_SAVED_JOBS') {
    chrome.storage.local.get({ savedJobs: [] }, (data) => {
      sendResponse({ jobs: data.savedJobs });
    });
    return true;
  }

  if (message.type === 'DELETE_SAVED_JOB') {
    chrome.storage.local.get({ savedJobs: [] }, (data) => {
      const filtered = data.savedJobs.filter((j) => j.id !== message.id && j.url !== message.url);
      chrome.storage.local.set({ savedJobs: filtered }, () => {
        sendResponse({ success: true, count: filtered.length });
      });
    });
    return true;
  }

  if (message.type === 'SYNC_BRAIN' || message.type === 'LEARN_FIELD' || message.type === 'RESOLVE_FIELDS') {
    if (!sender.url?.startsWith(chrome.runtime.getURL(''))) {
      sendResponse({ success: false, error: 'Extension page required' });
      return false;
    }
    chrome.storage.local.get(['dashboardToken'], async ({ dashboardToken }) => {
      if (!dashboardToken) { sendResponse({ success: false, error: 'Dashboard token not configured' }); return; }
      try {
        const request = message.type === 'SYNC_BRAIN' ? { method: 'GET' } : {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message.type === 'RESOLVE_FIELDS' ? { fields: message.fields, jobUrl: message.jobUrl } : { questionText: message.questionText, resolvedValue: message.resolvedValue, factKey: message.factKey }),
        };
        const response = await fetch('http://127.0.0.1:4321/api/extension-brain', { ...request, headers: { ...request.headers, Authorization: `Bearer ${dashboardToken}` } });
        const data = await response.json();
        if (!response.ok) { sendResponse({ success: false, error: data.error || 'Dashboard request failed' }); return; }
        if (message.type === 'SYNC_BRAIN') await chrome.storage.local.set({ semanticMemory: data.semanticMemory, candidateSummary: data.candidateSummary, resumePaths: data.resumePaths, brainUpdatedAt: data.updatedAt });
        sendResponse({ success: true, data });
      } catch (error) { sendResponse({ success: false, error: error.message }); }
    });
    return true;
  }

});
