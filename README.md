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

### 1.1.0 (2026-08-23)
- Removed the paid tier: Rapid Prompt Navigation is now unlimited and free for everyone. The license UI, usage counter, upgrade modal, and the `api.polar.sh` host permission are gone; leftover license storage is cleared on update.

### 1.0.8 (2026-08-22)
- Fixed **Context Collector** copy output silently including ChatGPT tool calls (web search queries, Python code, agent/browser actions, canvas payloads) and agent interim progress notes as assistant messages.
- Stripped ChatGPT's inline citation/navlist marker glyphs from copied text.
- Fixed the full-conversation fetch added in 1.0.7: the backend answers an unauthenticated request with 404, so the fetch never succeeded and every feature fell back to the virtualized, markdown-stripped DOM. Copied text now carries the original markdown.
- **Message datetimes** and the session tracker's chatStart/lastPrompt now read times from the conversation payload; they previously depended on React internals a content script cannot see and never rendered.
- Completion chime detects the current stop-control markup.
- Internals: `shared.js` holds settings defaults and chime presets once; a single visible-turn scanner serves every feature.

### 1.0.7 (2026-06-03)
- Restored **Rapid Prompt Navigation** and **Context Collector** behavior for ChatGPT conversations whose message DOM is virtualized as you scroll.
- Added a full-conversation data cache backed by ChatGPT's same-origin conversation payload, with rendered DOM parsing retained as a fallback.
- Kept selected context messages stable when ChatGPT unmounts and remounts conversation turns during scrolling.

### 1.0.6 (2026-03-31)
- Restored the **Token Counter** after a ChatGPT site update changed turn/message DOM structure.
- Moved token estimation onto the shared turn parser used by the newer collector tools.
- Fixed stale counter states when re-enabling the feature or opening an empty chat.

### 1.0.5 (2026-02-15)
- Kept the bottom-right session tracker compact (no added datetime text there).
- Refined **Message Datetimes** to render elegantly inline on ChatGPT assistant messages.
- Tightened timestamp placement logic to avoid clutter and stale labels during dynamic re-renders.

### 1.0.4 (2026-02-15)
- Added optional **Message Datetimes** feature (toggle in popup).
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

## Pricing

All features are free and unlimited.

## Privacy

- Conversation parsing/token estimation happens locally in your browser.

## Disclaimer

ChatGPT UX Suite is not affiliated with OpenAI.
