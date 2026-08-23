(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const captured = [];
  navigator.clipboard.writeText = async (t) => { captured.push(t); };
  const fab = document.getElementById('context-collector-fab');
  if (!fab) return 'NO FAB';
  if (!document.getElementById('context-collector-panel')) { fab.click(); await sleep(2500); }
  const btn = (label) => [...document.querySelectorAll('#context-collector-panel button')].find((b) => b.textContent.trim().startsWith(label));
  btn('All').click(); await sleep(800);
  const stats = document.getElementById('cc-stats').innerText;
  const out = {};
  for (const fmt of ['plain', 'json', 'xml']) {
    const opt = [...document.querySelectorAll('.cc-format-option')].find((o) => o.dataset.format === fmt);
    opt.click(); await sleep(300);
    out[fmt] = captured[captured.length - 1];
  }
  return JSON.stringify({ stats, checkboxes: document.querySelectorAll('.cc-checkbox-overlay').length, captured: captured.length, out });
})()
