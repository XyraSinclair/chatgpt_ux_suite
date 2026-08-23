// Minimal CDP driver for the headless verification browser on :9471.
// usage: node cdp.mjs targets | new <url> | nav <id> <url> | eval <id> <js> | evalf <id> <file> | shot <id> <png> | close <id>
import fs from 'node:fs';
const PORT = process.env.CDP_PORT || 9471;
const [cmd, ...rest] = process.argv.slice(2);
const j = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: p.startsWith('/json/new') ? 'PUT' : 'GET' })).json();
const pages = async () => (await j('/json/list')).filter((t) => t.type === 'page');

function connect(ws) {
  const sock = new WebSocket(ws);
  let id = 0; const waits = new Map(); const events = [];
  sock.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waits.has(d.id)) { waits.get(d.id)(d); waits.delete(d.id); } else events.push(d); };
  const call = (method, params = {}) => new Promise((res) => { const i = ++id; waits.set(i, res); sock.send(JSON.stringify({ id: i, method, params })); });
  return new Promise((res) => { sock.onopen = () => res({ call, events, close: () => sock.close() }); });
}
async function withPage(id, fn) {
  const p = (await pages()).find((t) => t.id.startsWith(id));
  if (!p) throw new Error('no page ' + id);
  const c = await connect(p.webSocketDebuggerUrl);
  try { return await fn(c, p); } finally { c.close(); }
}
const evalIn = async (c, js) => {
  await c.call('Emulation.setFocusEmulationEnabled', { enabled: true });
  const params = { expression: js, awaitPromise: true, returnByValue: true };
  if (process.env.WORLD) {
    await c.call('Runtime.enable');
    await new Promise((r) => setTimeout(r, 300));
    const ctx = c.events.filter((e) => e.method === 'Runtime.executionContextCreated').map((e) => e.params.context)
      .find((x) => !x.auxData?.isDefault && x.auxData?.frameId && (x.name.includes(process.env.WORLD) || x.origin.includes(process.env.WORLD)));
    if (!ctx) return 'NO WORLD; have: ' + JSON.stringify(c.events.filter((e) => e.method === 'Runtime.executionContextCreated').map((e) => [e.params.context.name, e.params.context.origin]));
    params.contextId = ctx.id;
  }
  const r = await c.call('Runtime.evaluate', params);
  if (r.result.exceptionDetails) return 'EXC: ' + JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails);
  return r.result.result.value;
};
const out = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1));

if (cmd === 'targets') out((await j('/json/list')).map((t) => `${t.id.slice(0, 8)} ${t.type} ${t.title.slice(0, 40)} ${t.url.slice(0, 90)}`).join('\n'));
else if (cmd === 'new') { const t = await j('/json/new?' + rest[0]); out(t.id.slice(0, 8)); }
else if (cmd === 'nav') await withPage(rest[0], async (c) => { await c.call('Page.navigate', { url: rest[1] }); });
else if (cmd === 'eval') await withPage(rest[0], async (c) => out(await evalIn(c, rest.slice(1).join(' '))));
else if (cmd === 'evalf') await withPage(rest[0], async (c) => out(await evalIn(c, fs.readFileSync(rest[1], 'utf8'))));
else if (cmd === 'shot') await withPage(rest[0], async (c) => { const r = await c.call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(rest[1], Buffer.from(r.result.data, 'base64')); out(rest[1]); });
else if (cmd === 'close') await j('/json/close/' + (await pages()).find((t) => t.id.startsWith(rest[0])).id);
else out('unknown cmd');
if (cmd === 'sw') { const t = (await j('/json/list')).find((x) => x.type === 'service_worker'); const c = await connect(t.webSocketDebuggerUrl); const r = await c.call('Runtime.evaluate', { expression: rest.join(' '), awaitPromise: true, returnByValue: true }); out(r.result?.result?.value ?? r); c.close(); }
if (cmd === 'grant') { const v = await j('/json/version'); const c = await connect(v.webSocketDebuggerUrl); out(await c.call('Browser.grantPermissions', { origin: rest[0], permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] })); c.close(); }
