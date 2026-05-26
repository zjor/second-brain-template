#!/bin/bash
# Deploy (or upgrade) the telegram-brain-bot release with the image tagged
# at the current git short SHA. Requires that:
#   1. The image at that tag has been pushed via docker-build-and-push.sh.
#   2. The env + ssh Secrets exist via create-secrets.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHART="$(cd "$SCRIPT_DIR/../chart" && pwd)"

NS=app-second-brain-bot
APP=telegram-brain-bot
VERSION=$(git rev-parse --short HEAD)
set -x

helm upgrade --namespace "$NS" --create-namespace --install "$APP" \
  --set image.tag="${VERSION}" \
  "$CHART"
