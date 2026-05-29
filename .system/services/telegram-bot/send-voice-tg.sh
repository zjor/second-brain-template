#!/usr/bin/env bash
# send-voice-tg.sh — synthesize text to speech (Gemini) and deliver it to the
# Telegram user as a voice message, via the bot's /tts endpoint.
# Usage:
#   send-voice-tg.sh --text "Короткий ответ голосом."
#   send-voice-tg.sh --text "Warm hello" --voice Puck --style "say cheerfully"
#
# Required env vars (set automatically by the bot container):
#   NOTIFY_PORT     — defaults to 8080
#   NOTIFY_CHAT_ID  — the Telegram chat id to message
#
# Exit 0 on HTTP 200, non-zero otherwise. Server error body echoed to stderr.

set -euo pipefail

text=""
voice=""
style=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --text)   text="$2";  shift 2 ;;
    --voice)  voice="$2"; shift 2 ;;
    --style)  style="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$text" ]]; then
  echo "--text <string> is required" >&2
  exit 2
fi

if [[ -z "${NOTIFY_CHAT_ID:-}" ]]; then
  echo "NOTIFY_CHAT_ID env var is not set" >&2
  exit 2
fi

port="${NOTIFY_PORT:-8080}"

export TEXT_ARG="$text"
export VOICE="$voice"
export STYLE="$style"

payload=$(python3 -c '
import json, os
d = {
  "chat_id": int(os.environ["NOTIFY_CHAT_ID"]),
  "text": os.environ["TEXT_ARG"],
}
if os.environ.get("VOICE"):
    d["voice"] = os.environ["VOICE"]
if os.environ.get("STYLE"):
    d["style"] = os.environ["STYLE"]
print(json.dumps(d))
' 2>/dev/null) || {
  # Python fallback: hand-roll JSON (string fields escaped naively)
  esc_text=$(printf '%s' "$text" | sed 's/\\/\\\\/g; s/"/\\"/g')
  payload="{\"chat_id\":${NOTIFY_CHAT_ID},\"text\":\"${esc_text}\""
  if [[ -n "$voice" ]]; then
    esc_voice=$(printf '%s' "$voice" | sed 's/\\/\\\\/g; s/"/\\"/g')
    payload="${payload},\"voice\":\"${esc_voice}\""
  fi
  if [[ -n "$style" ]]; then
    esc_style=$(printf '%s' "$style" | sed 's/\\/\\\\/g; s/"/\\"/g')
    payload="${payload},\"style\":\"${esc_style}\""
  fi
  payload="${payload}}"
}

resp=$(mktemp)
trap 'rm -f "$resp"' EXIT

http_code=$(curl -s -o "$resp" -w "%{http_code}" \
  -X POST "http://127.0.0.1:${port}/tts" \
  -H "content-type: application/json" \
  -d "$payload")

if [[ "$http_code" != "200" ]]; then
  echo "send-voice-tg.sh: HTTP $http_code" >&2
  cat "$resp" >&2 || true
  exit 1
fi
