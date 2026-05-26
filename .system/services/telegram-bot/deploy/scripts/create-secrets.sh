#!/bin/bash
# Create/replace the two Secrets the chart depends on:
#   <release>-env  — from the existing .env file
#   <release>-ssh  — from the existing ssh-deploy-key file
#
# Both source files already exist in .system/services/telegram-bot/ for
# the docker-compose flow and are gitignored. We reuse them here.
#
# Triggers a rolling restart of the deployment if it exists already.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"   # → .system/services/telegram-bot
ENV_FILE="$SERVICE_DIR/.env"
SSH_KEY="$SERVICE_DIR/ssh-deploy-key"

NS=app-second-brain-bot
APP=telegram-brain-bot

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE (copy from .env.example and fill in)" >&2
  exit 1
fi
if [[ ! -f "$SSH_KEY" ]]; then
  echo "missing $SSH_KEY (place the private deploy key here)" >&2
  exit 1
fi

# Ensure the namespace exists.
kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -

# env secret (envFrom in the deployment). Atomic create-or-update.
kubectl create secret generic "${APP}-env" \
  --from-env-file="$ENV_FILE" \
  -n "$NS" \
  --dry-run=client -o yaml | kubectl apply -f -

# ssh secret mounted at /home/bot/.ssh/id_ed25519 (subPath, mode 0400). Atomic.
kubectl create secret generic "${APP}-ssh" \
  --from-file=id_ed25519="$SSH_KEY" \
  -n "$NS" \
  --dry-run=client -o yaml | kubectl apply -f -

# Roll the pod if the deployment is already up so it picks up the new env.
kubectl rollout restart "deployment/${APP}" -n "$NS" 2>/dev/null || true
