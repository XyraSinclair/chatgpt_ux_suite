'use strict';

const FEATURE_KEYS = ['tokenCounter', 'promptNavigator', 'responseStyling', 'sessionTracker', 'contextCollector', 'chatTimestamps', 'soundNotification'];

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (result) => {
      resolve(result);
    });
  });
}

async function saveSetting(key, value) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [key]: value }, () => {
      resolve();
    });
  });
}

function getManifestVersionLabel() {
  try {
    const version = chrome.runtime.getManifest().version;
    return version ? `v${version}` : 'v...';
  } catch (e) {
    return 'v...';
  }
}

function setPromptShortcutHint() {
  const hint = document.getElementById('prompt-nav-shortcuts');
  if (!hint) return;
  const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
  const isFirefox = /Firefox/i.test(navigator.userAgent);
  if (!isMac || !isFirefox) return;
  hint.textContent = 'Jump between prompts with Ctrl+E / Ctrl+D';
}

function updateCardState(feature, enabled) {
  const card = document.querySelector(`[data-feature="${feature}"]`);
  if (card) {
    if (enabled) {
      card.classList.remove('disabled');
      card.classList.add('enabled');
    } else {
      card.classList.add('disabled');
      card.classList.remove('enabled');
    }
  }
}

async function getSelectedChime() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ selectedChime: DEFAULT_CHIME }, (result) => {
      resolve(result.selectedChime);
    });
  });
}

async function saveSelectedChime(chimeName) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ selectedChime: chimeName }, resolve);
  });
}


async function initializePopup() {
  const settings = await loadSettings();
  setPromptShortcutHint();

  // Set toggle states based on saved settings
  FEATURE_KEYS.forEach((feature) => {
    const toggle = document.getElementById(`toggle-${feature}`);
    if (toggle) {
      toggle.checked = settings[feature] !== false;
      updateCardState(feature, toggle.checked);

      toggle.addEventListener('change', async (e) => {
        const enabled = e.target.checked;
        await saveSetting(feature, enabled);
        updateCardState(feature, enabled);

        // Show/hide chime selector when sound notification is toggled
        if (feature === 'soundNotification') {
          const chimeSelector = document.getElementById('chime-selector');
          if (chimeSelector) {
            chimeSelector.classList.toggle('visible', enabled);
          }
        }

        // Notify content scripts about the change
        notifyContentScripts({ type: 'SETTINGS_CHANGED', feature, enabled });
      });
    }
  });

  // Initialize chime selector
  const chimeSelector = document.getElementById('chime-selector');
  const soundToggle = document.getElementById('toggle-soundNotification');
  if (chimeSelector && soundToggle) {
    // Show selector if sound is enabled
    if (soundToggle.checked) {
      chimeSelector.classList.add('visible');
    }

    // Load saved chime selection
    const selectedChime = await getSelectedChime();
    const chimeButtons = chimeSelector.querySelectorAll('.chime-option');

    chimeButtons.forEach((btn) => {
      const chimeName = btn.dataset.chime;

      // Set active state
      if (chimeName === selectedChime) {
        btn.classList.add('active');
      }

      // Handle click - preview and save
      btn.addEventListener('click', async () => {
        // Remove active from all, add to clicked
        chimeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Save selection
        await saveSelectedChime(chimeName);

        // Play preview
        playChime(chimeName);

        // Notify content script
        notifyContentScripts({ type: 'CHIME_CHANGED', chime: chimeName });
      });
    });
  }

  const versionEl = document.querySelector('.version');
  if (versionEl) versionEl.textContent = getManifestVersionLabel();
}

function isChatGptUrl(url) {
  if (!url) return false;
  return url.startsWith('https://chatgpt.com/') || url.startsWith('https://chat.openai.com/');
}

async function notifyContentScripts(message) {
  try {
    const tab = await new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs.length) {
          resolve(tabs[0]);
          return;
        }
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (fallbackTabs) => {
          resolve(fallbackTabs && fallbackTabs.length ? fallbackTabs[0] : null);
        });
      });
    });

    if (tab && tab.id && isChatGptUrl(tab.url)) {
      chrome.tabs.sendMessage(tab.id, message, () => {
        // Content script might not be ready, ignore runtime errors
        const err = chrome.runtime.lastError;
        const errMessage = err && err.message ? err.message : '';
        if (errMessage && !errMessage.includes('Receiving end does not exist')) {
          console.debug('ChatGPT UX Suite: popup message delivery failed', errMessage);
        }
      });
    }
  } catch (e) {
    // Ignore errors
  }
}

document.addEventListener('DOMContentLoaded', initializePopup);
