// Inject the extension's content scripts + CSS into a chatgpt.com tab of the CDP browser on :9471,
// inside an isolated world named "uxsuite", with a minimal chrome.* shim (storage.sync in-memory,
// runtime.onMessage collected so tests can dispatch popup/SW messages via __dispatch).
// usage: node inject.mjs <tabIdPrefix> [extDir]
import fs from 'node:fs';
const PORT = process.env.CDP_PORT || 9471;
const [tabId, extDirArg] = process.argv.slice(2);
const EXT = extDirArg || '' + new URL('../../chatgpt_ux_suite_extension', import.meta.url).pathname + '';
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const p = list.find((t) => t.type === 'page' && t.id.startsWith(tabId));
const sock = new WebSocket(p.webSocketDebuggerUrl);
let id = 0; const waits = new Map(); const events = [];
sock.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waits.has(d.id)) { waits.get(d.id)(d); waits.delete(d.id); } else events.push(d); };
const call = (method, params = {}) => new Promise((res) => { const i = ++id; waits.set(i, res); sock.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => (sock.onopen = r));
await call('Page.enable');
const tree = await call('Page.getFrameTree');
const frameId = tree.result.frameTree.frame.id;
const world = await call('Page.createIsolatedWorld', { frameId, worldName: 'uxsuite', grantUniveralAccess: true });
const contextId = world.result.executionContextId;
const shim = `
(() => {
  const store = (globalThis.__store = globalThis.__store || {});
  const listeners = { storage: [], message: [] };
  const norm = (keys) => { if (keys == null) return { ...store }; if (typeof keys === 'string') keys = [keys]; if (Array.isArray(keys)) { const o = {}; keys.forEach((k) => { if (k in store) o[k] = store[k]; }); return o; } const o = { ...keys }; Object.keys(keys).forEach((k) => { if (k in store) o[k] = store[k]; }); return o; };
  const sync = {
    get: (keys, cb) => { const v = norm(keys); if (cb) cb(v); return Promise.resolve(v); },
    set: (items, cb) => { const changes = {}; Object.entries(items).forEach(([k, v]) => { changes[k] = { oldValue: store[k], newValue: v }; store[k] = v; }); listeners.storage.forEach((l) => l(changes, 'sync')); if (cb) cb(); return Promise.resolve(); }
  };
  globalThis.chrome = {
    storage: { sync, local: sync, onChanged: { addListener: (l) => listeners.storage.push(l) } },
    runtime: { onMessage: { addListener: (l) => listeners.message.push(l) }, sendMessage: () => Promise.resolve(), getURL: (p) => 'chrome-extension://shim/' + p, lastError: undefined, id: 'shim' }
  };
  globalThis.__dispatch = (msg) => { const out = []; listeners.message.forEach((l) => l(msg, {}, (r) => out.push(r))); return out; };
  globalThis.__captured = [];
  navigator.clipboard.writeText = async (t) => { globalThis.__captured.push(t); };
})();
`;
const fallback = process.env.FALLBACK ? "const __f=fetch; fetch=(u,o)=>String(u).includes('/backend-api/conversation/')?Promise.reject(new Error('forced')):__f(u,o);" : '';
const css = fs.readFileSync(`${EXT}/styles.css`, 'utf8');
const src = shim + fallback + '\n' + fs.readFileSync(`${EXT}/shared.js`, 'utf8') + '\n' + fs.readFileSync(`${EXT}/tokenEstimator.js`, 'utf8') + '\n' + fs.readFileSync(`${EXT}/unifiedContentScript.js`, 'utf8')
  + `\n;(() => { const s = document.createElement('style'); s.id = 'uxsuite-css'; s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s); })(); 'injected'`;
const r = await call('Runtime.evaluate', { expression: src, contextId, awaitPromise: true, returnByValue: true });
console.log(r.result.exceptionDetails ? 'EXC ' + JSON.stringify(r.result.exceptionDetails).slice(0, 800) : r.result.result.value);
sock.close();
