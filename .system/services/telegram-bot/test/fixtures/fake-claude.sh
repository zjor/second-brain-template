#!/usr/bin/env bash
# Test double for the `claude` CLI. Echoes a canned JSON envelope.
# Behavior controlled by env vars:
#   FAKE_CLAUDE_STDOUT  — the assistant message text (default: "OK")
#   FAKE_CLAUDE_SID     — the session id to report (default: "sid-test")
#   FAKE_CLAUDE_EXIT    — exit code (default: 0)

stdout="${FAKE_CLAUDE_STDOUT:-OK}"
sid="${FAKE_CLAUDE_SID:-sid-test}"
exit_code="${FAKE_CLAUDE_EXIT:-0}"

# Escape the stdout for JSON
esc=$(printf '%s' "$stdout" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')

printf '{"session_id":"%s","result":%s}\n' "$sid" "$esc"
exit "$exit_code"
