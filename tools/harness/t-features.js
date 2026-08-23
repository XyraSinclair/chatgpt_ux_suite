(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const txt = (sel) => (document.querySelector(sel)?.innerText || '').replace(/\n/g, ' | ').trim();
  const scroller = (() => { let el = document.querySelector('[data-testid^="conversation-turn"]'); while (el && el !== document.body) { const cs = getComputedStyle(el); if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight) return el; el = el.parentElement; } return document.scrollingElement; })();
  const pos = () => Math.round(scroller.scrollTop);
  out.tokenCounter = txt('#chatgpt-token-counter');
  out.widget0 = txt('#prompt-navigator-widget');
  const steps = [];
  for (const direction of ['prev', 'prev', 'next', 'prev', 'prev', 'prev']) {
    __dispatch({ type: 'PROMPT_JUMP', direction }); await sleep(900);
    steps.push(direction + '→' + pos() + ' [' + txt('#prompt-navigator-widget').replace(/\s+\|\s+/g, ' ') + ']');
  }
  out.steps = steps;
  out.highlightClasses = [...new Set([...document.querySelectorAll('[class*="pn-"]')].flatMap((e) => [...e.classList].filter((c) => c.startsWith('pn-'))))];
  __dispatch({ type: 'SETTINGS_CHANGED', feature: 'chatTimestamps', enabled: true }); await sleep(1500);
  out.timestamps = [...document.querySelectorAll('[class*="ct-"], [class*="timestamp"], [class*="datetime"]')].slice(0, 6).map((e) => e.className + ' :: ' + e.innerText.trim().slice(0, 60));
  __dispatch({ type: 'SETTINGS_CHANGED', feature: 'responseStyling', enabled: true }); await sleep(500);
  out.stylingMarker = [...document.querySelectorAll('style[id], link[id]')].map((s) => s.id).join(',') + ' | body classes: ' + document.body.className;
  out.sessionRow = txt('#pn-session-row');
  return JSON.stringify(out);
})()
