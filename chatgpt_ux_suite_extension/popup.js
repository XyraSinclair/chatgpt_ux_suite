'use strict';

const FEATURE_KEYS = ['tokenCounter', 'promptNavigator', 'responseStyling', 'sessionTracker', 'contextCollector', 'chatTimestamps', 'soundNotification'];

const BACKDOOR_CLICKS_REQUIRED = 5;
const BACKDOOR_CLICK_WINDOW_MS = 6000;

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

// License management functions
async function getLicenseData() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({
      [LICENSE_STORAGE_KEYS.licenseKey]: null,
      [LICENSE_STORAGE_KEYS.usageCount]: 0,
      [LICENSE_STORAGE_KEYS.licenseValid]: false,
      [LICENSE_STORAGE_KEYS.lastValidated]: 0
    }, (result) => {
      resolve({
        licenseKey: result[LICENSE_STORAGE_KEYS.licenseKey],
        usageCount: result[LICENSE_STORAGE_KEYS.usageCount],
        isValid: result[LICENSE_STORAGE_KEYS.licenseValid],
        lastValidated: result[LICENSE_STORAGE_KEYS.lastValidated]
      });
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

async function saveLicenseKey(key, isValid) {
  const normalizedKey = normalizeLicenseKey(key);
  const storedKey = isBypassLicenseKey(normalizedKey) ? BYPASS_LICENSE_KEY : normalizedKey;
  return new Promise((resolve) => {
    chrome.storage.sync.set({
      [LICENSE_STORAGE_KEYS.licenseKey]: storedKey,
      [LICENSE_STORAGE_KEYS.licenseValid]: isValid,
      [LICENSE_STORAGE_KEYS.lastValidated]: Date.now()
    }, resolve);
  });
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


async function updateLicenseUI() {
  const data = await getLicenseData();
  const section = document.getElementById('license-section');
  const badge = document.getElementById('license-badge');
  const status = document.getElementById('license-status');
  const usageText = document.getElementById('usage-text');
  const inputGroup = document.getElementById('license-input-group');
  const upgradeLink = document.getElementById('upgrade-link');
  const keyInput = document.getElementById('license-key-input');

  if (data.isValid && data.licenseKey) {
    // Licensed user
    section.classList.add('licensed');
    badge.textContent = 'Pro';
    badge.classList.add('pro');
    status.classList.remove('warning', 'exhausted');
    status.classList.add('licensed');
    usageText.textContent = 'Unlimited navigations';
    inputGroup.style.display = 'none';
    upgradeLink.parentElement.style.display = 'none';
  } else {
    // Free tier user
    section.classList.remove('licensed');
    badge.textContent = 'Free';
    badge.classList.remove('pro');
    inputGroup.style.display = 'flex';
    upgradeLink.parentElement.style.display = 'block';

    const remaining = Math.max(0, FREE_NAVIGATIONS - data.usageCount);

    if (remaining === 0) {
      status.classList.remove('warning', 'licensed');
      status.classList.add('exhausted');
      usageText.textContent = 'No navigations remaining';
    } else if (remaining <= 3) {
      status.classList.remove('exhausted', 'licensed');
      status.classList.add('warning');
      usageText.textContent = `${remaining} navigation${remaining === 1 ? '' : 's'} remaining`;
    } else {
      status.classList.remove('warning', 'exhausted', 'licensed');
      usageText.textContent = `${remaining} navigations remaining`;
    }

    // Show existing key if any (masked)
    if (data.licenseKey && !data.isValid) {
      keyInput.value = data.licenseKey;
    }
  }
}

async function handleActivateLicense() {
  const keyInput = document.getElementById('license-key-input');
  const activateBtn = document.getElementById('activate-btn');
  if (activateBtn.disabled) return;
  const key = normalizeLicenseKey(keyInput.value);

  if (!key) {
    keyInput.focus();
    return;
  }
  keyInput.value = key;

  // Disable button and show loading state
  activateBtn.disabled = true;
  activateBtn.textContent = 'Validating...';

  const validation = await validateLicenseWithPolar(key);
  await saveLicenseKey(validation.key || key, validation.isValid);

  if (validation.isValid) {
    activateBtn.textContent = 'Activated!';
    activateBtn.classList.add('success');
    activateBtn.classList.remove('error');

    // Update UI after short delay
    setTimeout(() => {
      updateLicenseUI();
      // Notify content scripts
      notifyContentScripts({ type: 'LICENSE_ACTIVATED' });
    }, 1000);
  } else {
    activateBtn.textContent = validation.transientError ? 'Try again' : 'Invalid key';
    activateBtn.classList.add('error');
    activateBtn.classList.remove('success');

    setTimeout(() => {
      activateBtn.textContent = 'Activate';
      activateBtn.classList.remove('error');
      activateBtn.disabled = false;
    }, 2000);
  }
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

  // Initialize license UI
  await updateLicenseUI();

  // License activation handler
  const activateBtn = document.getElementById('activate-btn');
  if (activateBtn) {
    activateBtn.addEventListener('click', handleActivateLicense);
  }

  // Allow Enter key to activate license
  const keyInput = document.getElementById('license-key-input');
  if (keyInput) {
    keyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleActivateLicense();
      }
    });
  }

  // Secret bypass: click version 5 times to unlock
  const versionEl = document.querySelector('.version');
  if (versionEl) {
    const versionLabel = getManifestVersionLabel();
    versionEl.textContent = versionLabel;
    versionEl.title = `${BACKDOOR_CLICKS_REQUIRED} taps to unlock`;

    let bypassClicks = 0;
    let bypassTimer = null;
    const resetBypassProgress = () => {
      bypassClicks = 0;
      versionEl.textContent = versionLabel;
    };

    const activateBypass = async () => {
      resetBypassProgress();
      await chrome.storage.sync.set({
        [LICENSE_STORAGE_KEYS.licenseKey]: BYPASS_LICENSE_KEY,
        [LICENSE_STORAGE_KEYS.licenseValid]: true,
        [LICENSE_STORAGE_KEYS.lastValidated]: Date.now()
      });
      updateLicenseUI();
      notifyContentScripts({ type: 'LICENSE_ACTIVATED' });
      versionEl.textContent = 'Unlocked!';
      setTimeout(() => { versionEl.textContent = versionLabel; }, 1500);
    };

    versionEl.addEventListener('click', async () => {
      bypassClicks++;
      clearTimeout(bypassTimer);
      bypassTimer = setTimeout(resetBypassProgress, BACKDOOR_CLICK_WINDOW_MS);

      if (bypassClicks >= BACKDOOR_CLICKS_REQUIRED) {
        await activateBypass();
      } else {
        versionEl.textContent = `${versionLabel} (${bypassClicks}/${BACKDOOR_CLICKS_REQUIRED})`;
      }
    });
  }
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
