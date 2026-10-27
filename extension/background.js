/**
 * Jobscraper Companion - Background Service Worker (Manifest V3)
 */

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
          education: [
            {
              school: '',
              degree: 'Bachelor of Engineering',
              fieldOfStudy: 'Computer Science and Engineering',
              gpa: '',
              graduationYear: '2026',
            },
          ],
          experience: [],
          workAuthorization: {
            authorizedInCountry: true,
            requiresSponsorshipNowOrFuture: false,
          },
          eeo: {
            gender: 'Prefer not to say',
            veteranStatus: 'No',
            disabilityStatus: 'No',
          },
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
});
