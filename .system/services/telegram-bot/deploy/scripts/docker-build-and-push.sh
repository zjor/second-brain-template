#!/bin/bash
# Build the telegram-brain-bot image for linux/amd64 and push to Docker Hub
# under zjor/telegram-brain-bot:<git-short-sha>.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# deploy/scripts/ → ../.. → telegram-bot/ (Dockerfile context root)
CONTEXT="$(cd "$SCRIPT_DIR/../.." && pwd)"

DOCKER_USER=zjor
IMAGE=telegram-brain-bot
VERSION=$(git rev-parse --short HEAD)
set -x

docker buildx build --platform linux/amd64 -t ${IMAGE} "$CONTEXT"
docker tag ${IMAGE} ${DOCKER_USER}/${IMAGE}:"${VERSION}"
docker push ${DOCKER_USER}/${IMAGE}:"${VERSION}"
