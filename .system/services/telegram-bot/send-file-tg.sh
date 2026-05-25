#!/usr/bin/env bash
# send-file-tg.sh — push a file to the Telegram user via the bot's /send-file endpoint.
# Usage:
#   send-file-tg.sh --document /data/brain/inbox/files/x.pdf
#   send-file-tg.sh --photo    /data/brain/inbox/files/sunset.jpg --caption "Sunset"
#   send-file-tg.sh --document /data/brain/notes/x.md --caption "Notes" --parse-mode MarkdownV2
#
# Required env vars (set automatically by the bot container):
#   NOTIFY_PORT     — defaults to 8080
#   NOTIFY_CHAT_ID  — the Telegram chat id to message
#
# Exit 0 on HTTP 200, 1 otherwise. Server error body echoed to stderr.

set -euo pipefail

kind=""
path=""
caption=""
parse_mode=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --document)    kind="document"; path="$2"; shift 2 ;;
    --photo)       kind="photo";    path="$2"; shift 2 ;;
    --caption)     caption="$2"; shift 2 ;;
    --parse-mode)  parse_mode="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$kind" || -z "$path" ]]; then
  echo "exactly one of --document <path> or --photo <path> is required" >&2
  exit 2
fi

if [[ -z "${NOTIFY_CHAT_ID:-}" ]]; then
  echo "NOTIFY_CHAT_ID env var is not set" >&2
  exit 2
fi

port="${NOTIFY_PORT:-8080}"

export PATH_ARG="$path"
export KIND="$kind"
export CAPTION="$caption"
export PARSE_MODE="$parse_mode"

payload=$(python3 -c '
import json, os
d = {
  "chat_id": int(os.environ["NOTIFY_CHAT_ID"]),
  "path": os.environ["PATH_ARG"],
  "kind": os.environ["KIND"],
}
if os.environ.get("CAPTION"):
    d["caption"] = os.environ["CAPTION"]
if os.environ.get("PARSE_MODE"):
    d["parse_mode"] = os.environ["PARSE_MODE"]
print(json.dumps(d))
' 2>/dev/null) || {
  echo "send-file-tg.sh: failed to build JSON payload (python3 missing?)" >&2
  exit 2
}

http_code=$(curl -s -o /tmp/send-file-resp -w "%{http_code}" \
  -X POST "http://127.0.0.1:${port}/send-file" \
  -H "content-type: application/json" \
  -d "$payload")

if [[ "$http_code" != "200" ]]; then
  echo "send-file-tg.sh: HTTP $http_code" >&2
  cat /tmp/send-file-resp >&2 || true
  exit 1
fi
