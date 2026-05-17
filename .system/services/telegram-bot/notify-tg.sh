#!/usr/bin/env bash
# notify-tg.sh — push a message to the Telegram user via the bot's /notify endpoint.
# Usage:
#   notify-tg.sh --text "Hello"
#   notify-tg.sh --text "Done" --parse-mode MarkdownV2
#
# Required env vars (set automatically by the bot container):
#   NOTIFY_PORT  — defaults to 8080
#   NOTIFY_CHAT_ID — the Telegram chat id to message
#
# Exit 0 on HTTP 200, 1 otherwise.

set -euo pipefail

text=""
parse_mode=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --text)        text="$2"; shift 2 ;;
    --parse-mode)  parse_mode="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$text" ]]; then
  echo "--text is required" >&2
  exit 2
fi

if [[ -z "${NOTIFY_CHAT_ID:-}" ]]; then
  echo "NOTIFY_CHAT_ID env var is not set" >&2
  exit 2
fi

port="${NOTIFY_PORT:-8080}"

export TEXT="$text"
export PARSE_MODE="$parse_mode"

payload=$(python3 -c '
import json, os, sys
d = {"chat_id": int(os.environ["NOTIFY_CHAT_ID"]), "text": os.environ["TEXT"]}
if os.environ.get("PARSE_MODE"):
    d["parse_mode"] = os.environ["PARSE_MODE"]
print(json.dumps(d))
' 2>/dev/null) || {
  # Python fallback: hand-roll JSON (text is escaped naively)
  esc_text=$(printf '%s' "$text" | sed 's/\\/\\\\/g; s/"/\\"/g')
  if [[ -n "$parse_mode" ]]; then
    payload="{\"chat_id\":${NOTIFY_CHAT_ID},\"text\":\"${esc_text}\",\"parse_mode\":\"${parse_mode}\"}"
  else
    payload="{\"chat_id\":${NOTIFY_CHAT_ID},\"text\":\"${esc_text}\"}"
  fi
}

http_code=$(curl -s -o /tmp/notify-resp -w "%{http_code}" \
  -X POST "http://127.0.0.1:${port}/notify" \
  -H "content-type: application/json" \
  -d "$payload")

if [[ "$http_code" != "200" ]]; then
  echo "notify-tg.sh: HTTP $http_code" >&2
  cat /tmp/notify-resp >&2 || true
  exit 1
fi
