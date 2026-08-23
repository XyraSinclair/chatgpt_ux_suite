#!/bin/bash
# Run the collector copy test across several conversations in the :9471 Chrome (injected harness).
# usage: multitest.sh <tabId> <convId>...   (FALLBACK=1 forces the DOM path by failing the API fetch)
cd "$(dirname "$0")"
export CDP_PORT=9471
T=$1; shift
for C in "$@"; do
  node cdp.mjs nav "$T" "https://chatgpt.com/c/$C" >/dev/null; sleep 10
  node inject.mjs "$T" >/dev/null
  if [ -n "$FALLBACK" ]; then WORLD=uxsuite node cdp.mjs eval "$T" "const __f=fetch; fetch=(u,o)=>String(u).includes('/backend-api/conversation/')?Promise.reject(new Error('forced')):__f(u,o); 'fetch-broken'" >/dev/null; fi
  sleep 3
  WORLD=uxsuite node cdp.mjs evalf "$T" t-copy.js > /tmp/uxsuite-copy-last.txt
  python3 - "$C" <<'EOF'
import json,re,sys
raw=open('/tmp/uxsuite-copy-last.txt').read()
try: d=json.loads(raw)
except Exception: print(sys.argv[1],'RAW:',raw[:300]); sys.exit()
p=d['out'].get('plain','')
print('##',sys.argv[1],d['stats'],'| chars',len(p),'PUA',len(re.findall('[-]',p)),'md',len(re.findall(r'\*\*|^- ',p,re.M)),'CalledTool',p.count('Called tool'),'Worked',p.count('Worked for'),'Thought',len(re.findall(r'^Thought for',p,re.M)))
for m in json.loads(d['out']['json']) if 'json' in d['out'] else []: print('  ',m['role'],len(m['content']),repr(m['content'][:80]))
EOF
  WORLD=uxsuite node cdp.mjs eval "$T" "JSON.stringify([...document.querySelectorAll('.cc-checkbox-overlay')].slice(0,1).map(c=>c.dataset.key.length))"
done
