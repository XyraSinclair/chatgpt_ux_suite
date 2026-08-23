# Live verification harness

Drives the extension's content scripts against real chatgpt.com without a
visible window and without `--load-extension` (branded Chrome ≥137 ignores it;
fresh Chromium profiles trip Cloudflare).

1. Start a headless Chrome that already holds a ChatGPT session, with
   `--remote-debugging-port=9471 --remote-allow-origins=*`.
2. `node cdp.mjs new https://chatgpt.com/c/<id>` → tab id.
3. `node inject.mjs <tab>` evaluates `shared.js` + `tokenEstimator.js` +
   `unifiedContentScript.js` + `styles.css` inside an isolated world named
   `uxsuite`, with a `chrome.storage`/`chrome.runtime` shim. `__dispatch(msg)`
   delivers popup/worker messages; `navigator.clipboard.writeText` is captured.
   `FALLBACK=1` makes the conversation fetch fail to exercise the DOM path.
4. `WORLD=uxsuite node cdp.mjs evalf <tab> t-copy.js` copies every message in
   all three formats and returns them; `t-features.js` covers token counter,
   prompt navigation, timestamps, styling, and the session row.
5. `multitest.sh <tab> <conversationId>...` runs the copy test across chats.
