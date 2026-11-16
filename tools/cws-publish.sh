#!/usr/bin/env bash
# Zip chatgpt_ux_suite_extension/, upload it to the Chrome Web Store, and submit it for review.
# Bump manifest.json "version" first: the store refuses an upload whose version is not higher.
#
# Auth is keyless: a short-lived token minted as cws-publisher@exopriors.iam.gserviceaccount.com
# by impersonation from xyrasinclair@gmail.com's gcloud login (TokenCreator on that account).
# The service account is registered in the CWS Developer Dashboard (Account > Service accounts).
set -euo pipefail
cd "$(dirname "$0")/.."

ITEM=nlecdlfghppkoghjgjbgihhfjbdmckao
PUBLISHER=${CWS_PUBLISHER_ID:?set CWS_PUBLISHER_ID (Developer Dashboard > Account)}
SA=cws-publisher@exopriors.iam.gserviceaccount.com
API=https://chromewebstore.googleapis.com
ZIP=chatgpt_ux_suite_extension.zip

VERSION=$(python3 -c 'import json;print(json.load(open("chatgpt_ux_suite_extension/manifest.json"))["version"])')
rm -f "$ZIP"
(cd chatgpt_ux_suite_extension && zip -qr "../$ZIP" . -x "*.DS_Store")

TOKEN=$(gcloud auth print-access-token --account xyrasinclair@gmail.com \
  --impersonate-service-account "$SA" --scopes https://www.googleapis.com/auth/chromewebstore 2>/dev/null)
auth=(-H "Authorization: Bearer $TOKEN")
item="publishers/$PUBLISHER/items/$ITEM"

echo "uploading $ZIP (v$VERSION)"
state=$(curl -fsS -X POST "${auth[@]}" -T "$ZIP" "$API/upload/v2/$item:upload" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("uploadState","?"));print(d,file=sys.stderr)')
for _ in $(seq 1 30); do
  [[ $state == IN_PROGRESS || $state == UPLOAD_IN_PROGRESS ]] || break
  sleep 5
  state=$(curl -fsS "${auth[@]}" "$API/v2/$item:fetchStatus" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("lastAsyncUploadState","?"))')
done
[[ $state == SUCCEEDED ]] || { echo "upload state: $state" >&2; exit 1; }

curl -fsS -X POST "${auth[@]}" -H "Content-Type: application/json" -d '{}' "$API/v2/$item:publish"
echo
echo "submitted v$VERSION for review: https://chromewebstore.google.com/detail/$ITEM"
