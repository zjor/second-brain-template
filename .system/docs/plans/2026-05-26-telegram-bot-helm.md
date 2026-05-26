# Telegram Bot — Helm Chart Deployment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Helm chart that deploys the second-brain Telegram bot onto the existing Kubernetes cluster (same one running `tntfy` and `qrshare-api`), plus the small `/healthz` code change the chart's exec probes depend on.

**Architecture:** Bot pod runs as a single-replica `Deployment` (git lock requires one writer). Three PVCs (`brain-data`, `bot-db`, `bot-home`) on the `local-path` storage class. Two namespaced Secrets — one for env vars (`envFrom`), one for the SSH deploy key (mounted at `/home/bot/.ssh/id_ed25519`, mode `0400`). K8s probes use `exec curl` against `127.0.0.1:${NOTIFY_PORT}/healthz` — no Service, no Ingress, Hono stays loopback-only. Operator workflow: three bash scripts (`docker-build-and-push.sh`, `create-secrets.sh`, `deploy-with-helm.sh`) mirroring the tntfy patterns.

**Tech Stack:** Helm 3, Kubernetes, Docker (`buildx --platform linux/amd64`), kubectl, bash. Code change: one route in `src/notify.ts` (TypeScript / Hono).

**Spec:** `.system/docs/specs/2026-05-26-telegram-bot-helm-design.md`

**Working directory:** Run commands from `/Users/zjor/projects/second-brain-template` unless noted. Bot service lives at `.system/services/telegram-bot/`.

---

## File Structure

**New files:**
- `.system/services/telegram-bot/deploy/chart/Chart.yaml`
- `.system/services/telegram-bot/deploy/chart/.helmignore`
- `.system/services/telegram-bot/deploy/chart/values.yaml`
- `.system/services/telegram-bot/deploy/chart/templates/deployment.yaml`
- `.system/services/telegram-bot/deploy/chart/templates/pvcs.yaml`
- `.system/services/telegram-bot/deploy/chart/templates/NOTES.txt`
- `.system/services/telegram-bot/deploy/scripts/docker-build-and-push.sh`
- `.system/services/telegram-bot/deploy/scripts/create-secrets.sh`
- `.system/services/telegram-bot/deploy/scripts/deploy-with-helm.sh`

**Modified files:**
- `.system/services/telegram-bot/src/notify.ts` — add one `GET /healthz` route.
- `.system/services/telegram-bot/test/notify.test.ts` — assert healthz returns 200.
- `.system/services/telegram-bot/ROADMAP.md` — mark Helm chart shipped.

---

## Task 1: `/healthz` route on the notify Hono app

**Files:**
- Modify: `.system/services/telegram-bot/src/notify.ts`
- Modify: `.system/services/telegram-bot/test/notify.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("notify app", ...)` block in `.system/services/telegram-bot/test/notify.test.ts`:

```ts
  it("GET /healthz returns 200 ok", async () => {
    const app = createNotifyApp({ sendMessage: vi.fn() });
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd .system/services/telegram-bot && pnpm test -- notify
```
Expected: FAIL — the new test returns 404 (no `/healthz` route yet).

- [ ] **Step 3: Add the route**

In `.system/services/telegram-bot/src/notify.ts`, locate `export function createNotifyApp(deps: NotifyDeps) {` and add one line directly before the existing `app.post("/notify", ...)` registration:

```ts
  app.get("/healthz", (c) => c.json({ ok: true }));
```

Resulting top of the factory:

```ts
export function createNotifyApp(deps: NotifyDeps) {
  const app = new Hono();
  app.get("/healthz", (c) => c.json({ ok: true }));
  app.post("/notify", async (c) => {
    // …existing handler unchanged…
  });
  return app;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd .system/services/telegram-bot && pnpm test -- notify
```
Expected: PASS — all notify tests including the new healthz case.

- [ ] **Step 5: Full test suite + typecheck**

```bash
cd .system/services/telegram-bot && pnpm test && pnpm typecheck
```
Expected: 69 tests pass (was 68), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add .system/services/telegram-bot/src/notify.ts .system/services/telegram-bot/test/notify.test.ts
git commit -m "feat(telegram-bot): add GET /healthz route for k8s exec probes"
```

---

## Task 2: Helm chart scaffold — `Chart.yaml`, `.helmignore`, `values.yaml`, `NOTES.txt`

**Files:**
- Create: `.system/services/telegram-bot/deploy/chart/Chart.yaml`
- Create: `.system/services/telegram-bot/deploy/chart/.helmignore`
- Create: `.system/services/telegram-bot/deploy/chart/values.yaml`
- Create: `.system/services/telegram-bot/deploy/chart/templates/NOTES.txt`

- [ ] **Step 1: Create `Chart.yaml`**

```yaml
apiVersion: v2
name: telegram-brain-bot
description: Second-brain Telegram bot — Claude Code + grammy in one pod
type: application
version: 0.1.0
appVersion: "0.1.0"
```

- [ ] **Step 2: Create `.helmignore`**

```
# Patterns to ignore when packaging a chart.
.DS_Store
.git/
.gitignore
.svn/
.bzr/
.hg/
*.swp
*.bak
*.tmp
*.orig
*~
.idea/
.vscode/
```

- [ ] **Step 3: Create `values.yaml`**

```yaml
# replicaCount is NOT exposed in values — the Deployment template hardcodes
# replicas: 1 because git lock requires a single writer.

image:
  repository: zjor/telegram-brain-bot
  tag: latest    # overridden by deploy-with-helm.sh to git short SHA

storageClass: local-path

persistence:
  brainData: 2Gi
  botDb:     100Mi
  botHome:   1Gi

env:
  BRAIN_REPO_URL: ""
  GIT_USER_NAME:  "Brain Bot"
  GIT_USER_EMAIL: "bot@brain.local"
  NOTIFY_PORT:    "8080"

secretName:
  env: telegram-brain-bot-env
  ssh: telegram-brain-bot-ssh

resources:
  requests:
    memory: 256Mi
    cpu:    100m
  limits:
    memory: 1Gi
    cpu:    1000m
```

- [ ] **Step 4: Create `templates/NOTES.txt`**

```
Deployed {{ .Chart.Name }} v{{ .Values.image.tag }} to namespace {{ .Release.Namespace }}.

Logs:   kubectl logs   -n {{ .Release.Namespace }} deploy/{{ .Release.Name }} -f
Pods:   kubectl get    -n {{ .Release.Namespace }} pods -w
Events: kubectl events -n {{ .Release.Namespace }} --for deploy/{{ .Release.Name }}
```

- [ ] **Step 5: Lint the chart so far**

```bash
helm lint .system/services/telegram-bot/deploy/chart
```
Expected: warning about a missing icon and possibly empty templates, but no error. `1 chart(s) linted, 0 chart(s) failed`.

- [ ] **Step 6: Commit**

```bash
git add .system/services/telegram-bot/deploy/chart/Chart.yaml \
        .system/services/telegram-bot/deploy/chart/.helmignore \
        .system/services/telegram-bot/deploy/chart/values.yaml \
        .system/services/telegram-bot/deploy/chart/templates/NOTES.txt
git commit -m "feat(telegram-bot): scaffold Helm chart (Chart, values, NOTES)"
```

---

## Task 3: PVCs template — three claims in one file

**Files:**
- Create: `.system/services/telegram-bot/deploy/chart/templates/pvcs.yaml`

- [ ] **Step 1: Create `templates/pvcs.yaml`**

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ .Release.Name }}-brain-data
  labels:
    app: {{ .Release.Name }}
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: {{ .Values.storageClass }}
  resources:
    requests:
      storage: {{ .Values.persistence.brainData }}
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ .Release.Name }}-bot-db
  labels:
    app: {{ .Release.Name }}
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: {{ .Values.storageClass }}
  resources:
    requests:
      storage: {{ .Values.persistence.botDb }}
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ .Release.Name }}-bot-home
  labels:
    app: {{ .Release.Name }}
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: {{ .Values.storageClass }}
  resources:
    requests:
      storage: {{ .Values.persistence.botHome }}
```

- [ ] **Step 2: Render the template to verify it produces three valid PVCs**

```bash
helm template demo .system/services/telegram-bot/deploy/chart | grep -A1 "kind: PersistentVolumeClaim" | sort -u
```
Expected: three claim names — `demo-brain-data`, `demo-bot-db`, `demo-bot-home`.

- [ ] **Step 3: Dry-run apply to catch schema errors**

```bash
helm template demo .system/services/telegram-bot/deploy/chart | kubectl --dry-run=client apply -f -
```
Expected: three `persistentvolumeclaim/... configured (dry run)` lines, no errors.

- [ ] **Step 4: Commit**

```bash
git add .system/services/telegram-bot/deploy/chart/templates/pvcs.yaml
git commit -m "feat(telegram-bot): PVC templates for brain-data, bot-db, bot-home"
```

---

## Task 4: Deployment template

**Files:**
- Create: `.system/services/telegram-bot/deploy/chart/templates/deployment.yaml`

- [ ] **Step 1: Create `templates/deployment.yaml`**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Release.Name }}
  labels:
    app: {{ .Release.Name }}
spec:
  replicas: 1   # hardcoded — git lock requires a single writer; do not override
  strategy:
    type: Recreate   # PVCs are RWO; rolling update would deadlock on volume attach
  selector:
    matchLabels:
      app: {{ .Release.Name }}
  template:
    metadata:
      labels:
        app: {{ .Release.Name }}
    spec:
      containers:
        - name: {{ .Release.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          env:
            - name: COMMIT_SHA
              value: "{{ .Values.image.tag }}"
            {{- range $key, $value := .Values.env }}
            - name: {{ $key }}
              value: "{{ $value }}"
            {{- end }}
          envFrom:
            - secretRef:
                name: {{ .Values.secretName.env }}
          volumeMounts:
            - name: brain-data
              mountPath: /data/brain
            - name: bot-db
              mountPath: /data/db
            - name: bot-home
              mountPath: /home/bot
            - name: ssh-key
              mountPath: /home/bot/.ssh/id_ed25519
              subPath: id_ed25519
              readOnly: true
          livenessProbe:
            exec:
              command:
                - curl
                - -fs
                - "http://127.0.0.1:{{ .Values.env.NOTIFY_PORT }}/healthz"
            initialDelaySeconds: 30
            periodSeconds: 15
            failureThreshold: 4
          readinessProbe:
            exec:
              command:
                - curl
                - -fs
                - "http://127.0.0.1:{{ .Values.env.NOTIFY_PORT }}/healthz"
            initialDelaySeconds: 10
            periodSeconds: 10
          resources:
{{ toYaml .Values.resources | indent 12 }}
      volumes:
        - name: brain-data
          persistentVolumeClaim:
            claimName: {{ .Release.Name }}-brain-data
        - name: bot-db
          persistentVolumeClaim:
            claimName: {{ .Release.Name }}-bot-db
        - name: bot-home
          persistentVolumeClaim:
            claimName: {{ .Release.Name }}-bot-home
        - name: ssh-key
          secret:
            secretName: {{ .Values.secretName.ssh }}
            defaultMode: 0400
            items:
              - key: id_ed25519
                path: id_ed25519
```

- [ ] **Step 2: Render and inspect the deployment**

```bash
helm template demo .system/services/telegram-bot/deploy/chart \
  --set env.BRAIN_REPO_URL=git@github.com:zjor/brain.git \
  | sed -n '/kind: Deployment/,/^---/p' | head -80
```
Expected: a single `Deployment` manifest with `replicas: 1`, all four volumes, both probes, and the resources block.

- [ ] **Step 3: Dry-run apply the full chart**

```bash
helm template demo .system/services/telegram-bot/deploy/chart \
  --set env.BRAIN_REPO_URL=git@github.com:zjor/brain.git \
  | kubectl --dry-run=client apply -f -
```
Expected: one Deployment + three PVCs, all `configured (dry run)`, no errors.

- [ ] **Step 4: Lint the complete chart**

```bash
helm lint .system/services/telegram-bot/deploy/chart
```
Expected: `1 chart(s) linted, 0 chart(s) failed`. The "icon is recommended" info-level warning is fine.

- [ ] **Step 5: Commit**

```bash
git add .system/services/telegram-bot/deploy/chart/templates/deployment.yaml
git commit -m "feat(telegram-bot): Deployment template with PVC volumes, ssh secret, exec probes"
```

---

## Task 5: `docker-build-and-push.sh`

**Files:**
- Create: `.system/services/telegram-bot/deploy/scripts/docker-build-and-push.sh`

- [ ] **Step 1: Create the script**

```bash
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
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x .system/services/telegram-bot/deploy/scripts/docker-build-and-push.sh
```

- [ ] **Step 3: Sanity check that `$CONTEXT` resolves to the Dockerfile dir**

```bash
bash -c '
SCRIPT_DIR=/Users/zjor/projects/second-brain-template/.system/services/telegram-bot/deploy/scripts
CONTEXT=$(cd "$SCRIPT_DIR/../.." && pwd)
echo "CONTEXT=$CONTEXT"
test -f "$CONTEXT/Dockerfile" && echo OK || echo "MISSING DOCKERFILE"
'
```
Expected: `CONTEXT=/Users/zjor/projects/second-brain-template/.system/services/telegram-bot` and `OK`.

- [ ] **Step 4: Commit**

```bash
git add .system/services/telegram-bot/deploy/scripts/docker-build-and-push.sh
git commit -m "feat(telegram-bot): docker-build-and-push.sh for Helm flow"
```

---

## Task 6: `create-secrets.sh`

**Files:**
- Create: `.system/services/telegram-bot/deploy/scripts/create-secrets.sh`

- [ ] **Step 1: Create the script**

```bash
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

# env secret (envFrom in the deployment).
kubectl delete secret "${APP}-env" -n "$NS" --ignore-not-found
kubectl create secret generic "${APP}-env" \
  --from-env-file="$ENV_FILE" \
  -n "$NS"

# ssh secret mounted at /home/bot/.ssh/id_ed25519 (subPath, mode 0400).
kubectl delete secret "${APP}-ssh" -n "$NS" --ignore-not-found
kubectl create secret generic "${APP}-ssh" \
  --from-file=id_ed25519="$SSH_KEY" \
  -n "$NS"

# Roll the pod if the deployment is already up so it picks up the new env.
kubectl rollout restart "deployment/${APP}" -n "$NS" 2>/dev/null || true
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x .system/services/telegram-bot/deploy/scripts/create-secrets.sh
```

- [ ] **Step 3: Smoke test the missing-file branch (no kubectl run needed)**

Test the early-exit when `.env` is absent — temporarily rename it if it exists, run the script, expect a clear error, restore.

```bash
SERVICE_DIR=/Users/zjor/projects/second-brain-template/.system/services/telegram-bot
[[ -f "$SERVICE_DIR/.env" ]] && mv "$SERVICE_DIR/.env" "$SERVICE_DIR/.env.bak"
.system/services/telegram-bot/deploy/scripts/create-secrets.sh 2>&1 | head -2 || true
[[ -f "$SERVICE_DIR/.env.bak" ]] && mv "$SERVICE_DIR/.env.bak" "$SERVICE_DIR/.env"
```
Expected first line: `missing /Users/zjor/projects/second-brain-template/.system/services/telegram-bot/.env (copy from .env.example and fill in)`.

- [ ] **Step 4: Commit**

```bash
git add .system/services/telegram-bot/deploy/scripts/create-secrets.sh
git commit -m "feat(telegram-bot): create-secrets.sh for env + ssh Secrets"
```

---

## Task 7: `deploy-with-helm.sh`

**Files:**
- Create: `.system/services/telegram-bot/deploy/scripts/deploy-with-helm.sh`

- [ ] **Step 1: Create the script**

```bash
#!/bin/bash
# Deploy (or upgrade) the telegram-brain-bot release with the image tagged
# at the current git short SHA. Requires that:
#   1. The image at that tag has been pushed via docker-build-and-push.sh.
#   2. The env + ssh Secrets exist via create-secrets.sh.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHART="$(cd "$SCRIPT_DIR/../chart" && pwd)"

NS=app-second-brain-bot
APP=telegram-brain-bot
VERSION=$(git rev-parse --short HEAD)
set -x

helm upgrade --namespace "$NS" --create-namespace --install "$APP" \
  --set image.tag="${VERSION}" \
  "$CHART"
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x .system/services/telegram-bot/deploy/scripts/deploy-with-helm.sh
```

- [ ] **Step 3: Dry-run the helm command without contacting any cluster**

```bash
SCRIPT_DIR=/Users/zjor/projects/second-brain-template/.system/services/telegram-bot/deploy/scripts
CHART="$(cd "$SCRIPT_DIR/../chart" && pwd)"
helm template demo "$CHART" --set image.tag=test 2>&1 | head -10
```
Expected: rendered YAML (PVCs first), no errors.

- [ ] **Step 4: Commit**

```bash
git add .system/services/telegram-bot/deploy/scripts/deploy-with-helm.sh
git commit -m "feat(telegram-bot): deploy-with-helm.sh release wrapper"
```

---

## Task 8: README pointer for the Helm flow

**Files:**
- Modify: `.system/services/telegram-bot/README.md`

The existing README documents only the docker-compose flow. Add a short Helm section so operators can find the chart.

- [ ] **Step 1: Read the existing README to find the right insertion point**

```bash
sed -n '1,40p' .system/services/telegram-bot/README.md
```

- [ ] **Step 2: Append a new top-level section at the end of `README.md`**

```markdown
## Deploy to Kubernetes (Helm)

A Helm chart lives at `deploy/chart/` and three operator scripts live at
`deploy/scripts/`. Same `.env` and `ssh-deploy-key` files as the
docker-compose flow.

```bash
cd .system/services/telegram-bot
./deploy/scripts/docker-build-and-push.sh    # per code change
./deploy/scripts/create-secrets.sh           # once + when secrets change
./deploy/scripts/deploy-with-helm.sh         # per release
```

Notes:
- Namespace: `app-second-brain-bot`.
- Storage class: `local-path`. Three PVCs (`-brain-data`, `-bot-db`, `-bot-home`).
- Single replica — git lock requires a single writer; the chart hardcodes it.
- `/healthz` on the loopback Hono port is used by k8s exec probes (`curl -fs`).
- See `.system/docs/specs/2026-05-26-telegram-bot-helm-design.md` for the full design.
```

- [ ] **Step 3: Commit**

```bash
git add .system/services/telegram-bot/README.md
git commit -m "docs(telegram-bot): document the Helm deploy flow in README"
```

---

## Task 9: ROADMAP — mark Helm chart shipped

**Files:**
- Modify: `.system/services/telegram-bot/ROADMAP.md`

- [ ] **Step 1: Edit ROADMAP**

In `.system/services/telegram-bot/ROADMAP.md`, change the line:

```markdown
### [ ] Deploy to Kubernetes via Helm chart
```

to:

```markdown
### [x] Deploy to Kubernetes via Helm chart
```

- [ ] **Step 2: Commit**

```bash
git add .system/services/telegram-bot/ROADMAP.md
git commit -m "docs(telegram-bot): mark Helm chart shipped in roadmap"
```

---

## Final Verification

- [ ] **Run the full test suite**

```bash
cd .system/services/telegram-bot && pnpm test
```
Expected: 69 tests pass.

- [ ] **Typecheck**

```bash
pnpm typecheck
```
Expected: clean.

- [ ] **Lint the chart**

```bash
cd /Users/zjor/projects/second-brain-template
helm lint .system/services/telegram-bot/deploy/chart
```
Expected: `0 chart(s) failed`.

- [ ] **Render + dry-run apply the full chart**

```bash
helm template demo .system/services/telegram-bot/deploy/chart \
  --set env.BRAIN_REPO_URL=git@github.com:zjor/brain.git \
  | kubectl --dry-run=client apply -f -
```
Expected: 1 Deployment + 3 PVCs `configured (dry run)`, no errors.

- [ ] **Manual smoke test (post-deploy, optional)**

After running all three scripts against the real cluster:

1. `kubectl -n app-second-brain-bot get pods -w` until Running + Ready.
2. `kubectl logs -f deploy/telegram-brain-bot -n app-second-brain-bot` — look for `cloning_brain` on first boot, then `notify_listening`, `bot_started`.
3. Send `/start` in Telegram → bot replies.
4. Trigger send-file flow with a known brain file → file arrives.
5. `kubectl exec -n app-second-brain-bot deploy/telegram-brain-bot -- curl -fs http://127.0.0.1:8080/healthz` — returns `{"ok":true}` directly.
