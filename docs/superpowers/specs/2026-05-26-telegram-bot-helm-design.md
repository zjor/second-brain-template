---
created: 2026-05-26
status: active
tags: [telegram-bot, helm, deploy]
---

# Telegram Bot — Helm Chart Deployment

## Goal

Deploy the second-brain Telegram bot to an existing Kubernetes cluster via
a Helm chart. Replace (or coexist with) the current docker-compose-based
deploy. Match the operational shape of two sibling projects already running
on the same cluster: `tntfy` and `qrshare-api`.

Out of scope: K8s cluster setup, image-registry creation, DNS, monitoring
stack, CI for image build.

## Target Environment

- Kubernetes cluster (same one running `tntfy` + `qrshare-api`).
- Storage class: `local-path`.
- Image registry: Docker Hub, `zjor/telegram-brain-bot:<git-short-sha>`.
- Namespace: `app-second-brain-bot`.
- Single replica required (git lock = single writer).

## File Layout

```
.system/services/telegram-bot/deploy/
├── chart/
│   ├── Chart.yaml
│   ├── values.yaml
│   ├── .helmignore
│   └── templates/
│       ├── deployment.yaml      # single container, 3 PVCs + ssh-secret volume, exec probes
│       ├── pvcs.yaml            # 3 PVCs separated by ---
│       └── NOTES.txt
└── scripts/
    ├── docker-build-and-push.sh
    ├── create-secrets.sh
    └── deploy-with-helm.sh
```

No `service.yaml`, no `ingress.yaml`. The bot is outbound-only (Telegram
long-poll, internal `/notify` + `/send-file` bound to `127.0.0.1`). Health
probes use `exec curl` against the same loopback Hono server — no public
binding.

## Chart Contents

### `Chart.yaml`

```yaml
apiVersion: v2
name: telegram-brain-bot
description: Second-brain Telegram bot — Claude Code + grammy in one pod
type: application
version: 0.1.0
appVersion: "0.1.0"
```

### `values.yaml`

```yaml
# replicaCount is NOT exposed in values — Deployment hardcodes replicas: 1.
# Git lock requires a single writer; multiple replicas would deadlock.

image:
  repository: zjor/telegram-brain-bot
  tag: latest    # overridden by deploy-with-helm.sh to git short SHA

storageClass: local-path

persistence:
  brainData: 2Gi
  botDb:     100Mi
  botHome:   1Gi

env:
  BRAIN_REPO_URL: ""        # set at deploy time via --set or values override
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

### `templates/pvcs.yaml`

Three `PersistentVolumeClaim` manifests separated by `---`. Each claim:

- `accessModes: [ReadWriteOnce]`
- `storageClassName: {{ .Values.storageClass }}`
- size from `.Values.persistence.brainData|botDb|botHome`
- name `{{ .Release.Name }}-brain-data`, `-bot-db`, `-bot-home`

### `templates/deployment.yaml`

Single-container `Deployment`. Key elements:

- `replicas: 1` — hardcoded literal in the template. Not exposed in values.
  Git lock requires a single writer; lifting this would deadlock.
- Container image: `{{ .Values.image.repository }}:{{ .Values.image.tag }}`.
- `env`: literal pairs from `range $key, $value := .Values.env`.
- `envFrom: secretRef: name: {{ .Values.secretName.env }}` — pulls secrets
  (TELEGRAM_BOT_TOKEN, DEEPGRAM_API_KEY, ANTHROPIC_API_KEY, TG_ALLOWED_USER_IDS).
- 3 PVC volumes + 1 secret volume for the ssh key.
- Volume mounts:

| Mount path | Source | Mode |
|---|---|---|
| `/data/brain` | `<release>-brain-data` PVC | rw |
| `/data/db` | `<release>-bot-db` PVC | rw |
| `/home/bot` | `<release>-bot-home` PVC | rw |
| `/home/bot/.ssh/id_ed25519` (subPath `id_ed25519`) | `<release>-ssh` Secret | 0400 |

- Probes:

```yaml
livenessProbe:
  exec: { command: ["curl", "-fs", "http://127.0.0.1:{{ .Values.env.NOTIFY_PORT }}/healthz"] }
  initialDelaySeconds: 30
  periodSeconds: 15
  failureThreshold: 4
readinessProbe:
  exec: { command: ["curl", "-fs", "http://127.0.0.1:{{ .Values.env.NOTIFY_PORT }}/healthz"] }
  initialDelaySeconds: 10
  periodSeconds: 10
```

`curl` already present in the runtime image (`Dockerfile:30`).

- `resources` from `.Values.resources`.
- `securityContext`: not set explicitly — image already drops to non-root
  `bot` user (`Dockerfile:38, 58`).

### `templates/NOTES.txt`

Short post-install hint:

```
Deployed {{ .Chart.Name }} v{{ .Values.image.tag }} to namespace {{ .Release.Namespace }}.
Logs:  kubectl logs -n {{ .Release.Namespace }} deploy/{{ .Release.Name }} -f
Pods:  kubectl get pods -n {{ .Release.Namespace }} -w
```

## Scripts

All scripts use `git rev-parse --short HEAD` as the image tag.

### `scripts/docker-build-and-push.sh`

Mirrors `tntfy/src/infra/deploy/scripts/docker-build-and-push.sh`. Context is
`telegram-bot/` (one level up from `deploy/scripts/`). Builds for
`linux/amd64` via `docker buildx`, tags with the git short SHA, pushes to
Docker Hub `zjor/telegram-brain-bot:<sha>`.

### `scripts/create-secrets.sh`

Creates **two** secrets in the namespace (creating the namespace if missing):

1. `<release>-env` from `.system/services/telegram-bot/.env` via
   `kubectl create secret generic ... --from-env-file=$ENV_FILE`.
2. `<release>-ssh` from the existing `.system/services/telegram-bot/ssh-deploy-key`
   file via `kubectl create secret generic ... --from-file=id_ed25519=$SSH_KEY`.

Idempotent: deletes each secret before recreating. Triggers a rollout
restart if the deployment already exists; silently skips otherwise.

Both source files (`.env`, `ssh-deploy-key`) are already gitignored and
used by the existing docker-compose flow — no duplication.

### `scripts/deploy-with-helm.sh`

```bash
helm upgrade --install --create-namespace \
  --namespace app-second-brain-bot \
  telegram-brain-bot "$CHART" \
  --set image.tag="$(git rev-parse --short HEAD)"
```

Operator workflow:

```bash
cd .system/services/telegram-bot
./deploy/scripts/docker-build-and-push.sh    # per code change
./deploy/scripts/create-secrets.sh           # once + when secrets change
./deploy/scripts/deploy-with-helm.sh         # per release
```

## Code Change: `/healthz` Endpoint

Add a `GET /healthz` route to the existing Hono server (defined in
`src/notify.ts`) so the K8s exec probe has something to hit.

In `src/notify.ts`, inside `createNotifyApp`, before `return app`:

```ts
app.get("/healthz", (c) => c.json({ ok: true }));
```

One line. No deps required. The route is mounted on the same `127.0.0.1`
server that already hosts `/notify` and (via composition in `index.ts`)
`/send-file`. Not externally reachable.

Add a vitest case in `test/notify.test.ts` asserting `GET /healthz → 200`.

## Security

- Hono stays bound to `127.0.0.1` (no Service, no Ingress).
- `/notify`, `/send-file`, `/healthz` all share the same loopback-only
  port. `/healthz` exposes nothing sensitive (constant 200 JSON).
- SSH key mounted read-only (`0400`) at `/home/bot/.ssh/id_ed25519` from a
  Secret — never in the image, never in env vars, never in chart values.
- Bot env-file Secret used via `envFrom` — secrets land as container env
  but never on disk and never in the chart.
- Container drops to non-root `bot` user (preserved from the existing
  Dockerfile; nothing in the chart overrides it).

## Testing Strategy

1. **Offline chart checks** (every change):
   - `helm lint deploy/chart`
   - `helm template deploy/chart --set image.tag=test --set env.BRAIN_REPO_URL=git@github.com:x/y.git`
     piped to `kubectl --dry-run=client apply -f -` to catch schema errors.

2. **Healthz unit test** in `test/notify.test.ts`:

   ```ts
   it("GET /healthz returns 200 ok", async () => {
     const app = createNotifyApp({ sendMessage: vi.fn() });
     const res = await app.request("/healthz");
     expect(res.status).toBe(200);
     expect(await res.json()).toEqual({ ok: true });
   });
   ```

3. **Smoke test (manual, post-deploy):**
   - Run all three scripts in order.
   - `kubectl -n app-second-brain-bot get pods -w` until Running + Ready.
   - `kubectl logs -f deploy/telegram-brain-bot` — verify `notify_listening`,
     `bot_started`, and `cloning_brain` (on first boot).
   - In Telegram: send `/start`; expect reply.
   - Trigger the send-file flow with a known brain file; verify delivery.

4. **No automated cluster test in CI** — matches sibling projects.

## Migration / Coexistence

- `.env` and `ssh-deploy-key` files at
  `.system/services/telegram-bot/` are shared between docker-compose and
  the Helm flow. No duplication.
- The `/healthz` route is additive — no existing call path changes.
- Docker-compose deploy remains functional. Operator chooses one or runs
  them on different machines.
- Existing tests + build pipeline unchanged.

## Open Items

None. All decisions captured above.
