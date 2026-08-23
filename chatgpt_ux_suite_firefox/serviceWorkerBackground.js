'use strict';

// Firefox lists shared.js in background.scripts; Chrome's worker imports it.
if (typeof importScripts === 'function') importScripts('shared.js');

/**
 * ChatGPT UX Suite - Background Service Worker
 * Handles keyboard command routing and settings management
 */

const PROMPT_NAV_COMMANDS = {
  'jump-to-prev-user-prompt': 'previous',
  'jump-to-next-user-prompt': 'next'
};

const CHATGPT_ORIGINS = ['https://chatgpt.com/', 'https://chat.openai.com/'];

// Initialize default settings on install
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.sync.set(DEFAULT_SETTINGS, () => {
      console.log('ChatGPT UX Suite: Default settings initialized');
    });
    // Open welcome tab on first install
    chrome.tabs.create({ url: 'popup.html' });
  }
});

function isChatGptUrl(url) {
  if (typeof url !== 'string') {
    return false;
  }
  return CHATGPT_ORIGINS.some((origin) => url.startsWith(origin));
}

function queryActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        console.warn('ChatGPT UX Suite: tab query failed', chrome.runtime.lastError.message);
        resolve(null);
        return;
      }
      resolve(tabs && tabs.length ? tabs[0] : null);
    });
  });
}

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (result) => {
      resolve(result);
    });
  });
}

function sendJumpMessage(tabId, direction) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'PROMPT_JUMP', direction }, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        if (!lastError.message.includes('Receiving end does not exist')) {
          console.warn('ChatGPT UX Suite: content script message failed', lastError.message);
        }
      } else {
        console.debug('ChatGPT UX Suite (bg): message sent, response:', response);
      }
      resolve();
    });
  });
}

// Handle keyboard commands
chrome.commands.onCommand.addListener(async (command) => {
  const direction = PROMPT_NAV_COMMANDS[command];
  if (!direction) {
    return;
  }

  // Check if prompt navigator is enabled
  const settings = await getSettings();
  if (!settings.promptNavigator) {
    console.debug('ChatGPT UX Suite (bg): Prompt Navigator disabled, ignoring command');
    return;
  }

  const activeTab = await queryActiveTab();
  if (!activeTab || !activeTab.id || !isChatGptUrl(activeTab.url)) {
    if (activeTab && activeTab.url) {
      console.debug('ChatGPT UX Suite (bg): active tab URL not ChatGPT', activeTab.url);
    } else {
      console.debug('ChatGPT UX Suite (bg): no suitable active tab');
    }
    return;
  }

  console.debug('ChatGPT UX Suite (bg): sending jump message, direction', direction);
  await sendJumpMessage(activeTab.id, direction);
});

// Listen for settings requests from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_SETTINGS') {
    getSettings().then((settings) => {
      sendResponse(settings);
    });
    return true; // Keep channel open for async response
  }
});
