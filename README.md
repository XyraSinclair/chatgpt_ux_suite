# ChatGPT UX Suite

ChatGPT UX Suite is a browser extension that adds small, fast UX upgrades to ChatGPT (token counter, rapid prompt navigation, session tracking, optional message datetimes, context export, styling tweaks, and a completion chime).

- Chrome Web Store: [ChatGPT UX Suite](https://chromewebstore.google.com/detail/chatgpt-ux-suite/nlecdlfghppkoghjgjbgihhfjbdmckao)
- Supported sites: `https://chatgpt.com/*` and `https://chat.openai.com/*`

## Features

### 1. Token Counter (estimate)
Displays an estimated token count for the current conversation, helping you track context usage in real-time.

### 2. Rapid Prompt Navigation
Quickly navigate between user prompts using keyboard shortcuts:
- **Jump to Previous Prompt:** `Alt+E` (configurable)
- **Jump to Next Prompt:** `Alt+D` (configurable)
- Firefox on macOS also supports `Ctrl+E` / `Ctrl+D` for compatibility.

### 3. Response Styling
Adds custom styling to improve readability:
- Model responses styled with a translucent highlight
- Works with ChatGPT's theme settings

### 4. Session Time Tracking
Monitor your ChatGPT activity:
- View compact elapsed timers for `chatStart` and `lastPrompt`
- See subtle absolute date/time values alongside those timers
- Tracker data persists per conversation and reconciles after reloads/navigation

### 5. Context Collector
Select and export conversation messages:
- Quick select options (last 2, last 4, all, user only, GPT only)
- Export as Plain Text, JSON, or XML
- Configurable message separators

### 6. Message Datetimes (Optional)
Show subtle local date/time labels for each chat message:
- Low-contrast, low-visual-noise display
- Uses message timestamps when available
- Handles dynamic route changes and partial reloads

### 7. Sound Notification
Play a chime when ChatGPT completes a response:
- Multiple chime styles (Aurora, Ocean, Velvet, Chime)
- Low-frequency, ear-friendly tones

## Installation

### From Chrome Web Store
Install from the Chrome Web Store (recommended):

[ChatGPT UX Suite](https://chromewebstore.google.com/detail/chatgpt-ux-suite/nlecdlfghppkoghjgjbgihhfjbdmckao)

### From Source (Chrome / Chromium)
1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** in the top right corner
4. Click **Load unpacked**
5. Select the `chatgpt_ux_suite_extension` directory

### From Source (Firefox)
1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select `chatgpt_ux_suite_firefox/manifest.json`

## Usage

Once installed, the extension runs automatically on ChatGPT. Click the extension icon to toggle features and configure settings.

Tip: Keyboard shortcuts can be customized in Chrome at `chrome://extensions/shortcuts` (and in Firefox via `about:addons` → Manage Extension Shortcuts).

## Version Notes

### 1.0.4 (2026-02-15)
- Added optional **Message Datetimes** feature (toggle in popup).
- Session tracker now shows low-key absolute times for `chatStart` and `lastPrompt`.
- Improved timestamp resilience for older chats, reloads, and dynamic DOM swaps.
- Hardened timestamp caching to avoid stale values when ChatGPT reuses or re-renders turn nodes.
- Synced Chrome and Firefox extension bundles for matching behavior.

## Release / Store Upload

### 1) Build zips
```bash
./zip_extension.sh
```

This creates:
- `chatgpt_ux_suite_extension.zip` (Chrome Web Store)
- `chatgpt_ux_suite_firefox.zip` (Firefox Add-ons)

### 2) Upload to Chrome Web Store
- Developer Dashboard: https://chrome.google.com/webstore/devconsole
- Select **ChatGPT UX Suite**
- Open the **Package** tab
- Upload `chatgpt_ux_suite_extension.zip`
- Submit for review/publish

### 3) Upload to Firefox Add-ons (AMO)
- Developer Hub: https://addons.mozilla.org/en-US/developers/
- Existing add-ons list: https://addons.mozilla.org/en-US/developers/addons
- Open **ChatGPT UX Suite**, then upload a new version with `chatgpt_ux_suite_firefox.zip`
- For a brand new listing: https://addons.mozilla.org/en-US/developers/addon/submit/

## Pricing / Licensing

Prompt Navigator includes a free tier (30 navigations). Unlimited prompt navigation can be unlocked via a one-time purchase (license key validated via Polar).

All other features are included.

## Privacy

- Conversation parsing/token estimation happens locally in your browser.
- If you enter a license key, the extension may contact Polar (`api.polar.sh`) to validate it (no chat content is sent).

## Disclaimer

ChatGPT UX Suite is not affiliated with OpenAI.
