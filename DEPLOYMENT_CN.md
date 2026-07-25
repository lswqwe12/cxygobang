# Deployment Guide — WeChat Cloud Hosting & Mainland China Alternatives

This document explains how to deploy the Gobang game so it is reliably accessible from
mainland China. The recommended option is **WeChat Cloud Hosting (微信云托管)**; equivalent
alternatives (Tencent Lighthouse, Alibaba Cloud) are covered at the end.

> Note: overseas platforms from `DEPLOYMENT.md` (Render, Railway, etc.) are often slow or
> unreachable from mainland China. Use one of the options below instead.

## Why WeChat Cloud Hosting

- Container-based (runs our `Dockerfile` directly) — supports long-running Node.js
  processes, not just static pages.
- **Supports WebSocket**, which online rooms require.
- Provides a default HTTPS domain in mainland China with **no ICP filing (备案) required**
  for the default domain.
- Pay-as-you-go billing with a small monthly free quota; cheap at this game's scale.

## Prerequisites

1. A WeChat account with real-name authentication (实名认证).
2. A Tencent Cloud / CloudBase account: open the
   [CloudBase console](https://console.cloud.tencent.com/tcb) and enable CloudBase (云开发)
   — or enable it from 微信公众平台 → 开发 → 云服务.
3. This project folder (no local Docker required for console deployment).

The repo already contains everything the platform needs:

```
Dockerfile       # Node 20 Alpine, npm ci, runs server.js on $PORT (default 3000)
.dockerignore
server.js        # listens on 0.0.0.0 and process.env.PORT; includes a 30s WS heartbeat
public/          # static client
```

---

## Option A — WeChat Cloud Hosting via the Console (recommended)

### Step 1: Create an environment
1. Open the [CloudBase console](https://console.cloud.tencent.com/tcb).
2. Click **新建环境 (Create Environment)** → choose **按量计费 (pay-as-you-go)**.
3. Pick a region close to your players, e.g. **上海 (Shanghai)** or **广州 (Guangzhou)**.
4. Note the **环境 ID (Environment ID)**.

### Step 2: Create a Cloud Hosting service
1. In the environment, go to **云托管 (CloudBase Run)** → **新建服务 (New Service)**.
2. Service name: e.g. `gobang`.
3. Deployment mode: **代码包上传 (upload code package)** with **Dockerfile** build —
   the platform builds the image for you in the cloud (no local Docker needed).
   - Zip the project folder (`Dockerfile`, `server.js`, `package.json`,
     `package-lock.json`, `public/`) and upload it.
   - Alternative: connect a Git repository (GitHub/GitLab/工蜂) for auto-deploy on push.

### Step 3: Configure the service
| Setting | Value | Notes |
|---|---|---|
| 容器端口 (container port) | `3000` | Must match `EXPOSE`/`PORT` in the Dockerfile |
| 实例规格 (instance size) | 0.25–0.5 vCPU / 0.5 GB | Plenty for many concurrent rooms |
| 实例数 (instances) | min 1, max 1–2 | Keep min ≥ 1 (min 0 = cold starts drop live games) |
| 环境变量 (env vars) | `PORT=3000` | Optional; Dockerfile already defaults to 3000 |

### Step 4: Enable public access
1. Under the service's **访问服务 (access/trigger)** settings, enable the default
   **HTTP trigger / 公网访问 (public access)**.
2. The platform issues a default HTTPS domain like
   `https://gobang-xxxxxx.ap-shanghai.run.tcloudbase.com`.
3. The gateway supports WebSocket automatically — the client switches to `wss://`
   on HTTPS pages by itself.

### Step 5: Verify
- Open the default domain in **two** browsers/devices.
- Create a room in one, join from the other with the code + password.
- Ready up on both; place moves; test an undo request; close the owner's tab and confirm
  the other player sees "room closed".

### Step 6 (optional): Custom domain
- You can bind your own domain in the console, but a custom domain hosted in mainland
  China **requires ICP filing (ICP备案)**. The default `tcloudbase.com` domain does not.
- WeChat in-app browsers also open the default domain without allow-list issues; for
  Mini Program embedding you would add the domain to the Mini Program's request/socket
  allow-list (not needed for plain browser access).

---

## Option B — Deploy with the CloudBase CLI

Useful for repeatable deploys from your terminal:

```bash
npm install -g @cloudbase/cli
tcb login                                  # opens WeChat scan-code login
cd TFBoysTest
tcb cloudrun deploy --envId <your-env-id> --serviceName gobang
# (run `tcb cloudrun deploy --help` to confirm flags for your CLI version)
```

The CLI uploads the current directory and builds from the `Dockerfile`, same as the
console flow. Subsequent deploys overwrite the service and roll out a new version.

---

## Option C — Equivalent services

### Tencent Lighthouse (轻量应用服务器)
Best if you want a full VPS (fixed monthly price, ~¥24+/month for the entry plan):

```bash
# on the Lighthouse instance (Ubuntu)
curl -fsSL https://get.docker.com | sh
git clone <your-repo> && cd TFBoysTest
docker build -t gobang .
docker run -d --restart unless-stopped -p 3000:3000 --name gobang gobang
```

- Open port **3000** (or 80→3000) in the Lighthouse firewall page.
- Access via `http://<public-ip>:3000`. For a domain + HTTPS, put Nginx in front
  (config in `DEPLOYMENT.md`, Option C) and complete ICP filing.

### Alibaba Cloud equivalents
- **SAE (Serverless App Engine)**: closest equivalent to WeChat Cloud Hosting —
  deploy the same `Dockerfile`, set container port 3000, bind a public SLB endpoint.
- **ECS**: same VPS procedure as Lighthouse above.
- ICP filing rules are the same: default platform domains are fine, custom domains
  need 备案.

---

## WebSocket Reliability Notes (all platforms)

- `server.js` sends a **ping every 30 s** and terminates sockets that miss a pong.
  This keeps connections alive through cloud gateways that drop idle connections and
  makes "room owner went offline" detection prompt and reliable.
- Do **not** scale to multiple instances without sticky sessions — rooms live in one
  process's memory. Max 1 instance is the safe configuration.
- If the platform offers a "session/connection timeout" setting, set it to the maximum
  (e.g. 3600 s) so long matches aren't cut off.

## Post-Deployment Checklist

- [ ] Default domain opens the home screen on phone + desktop.
- [ ] Two devices can create/join a room with code + password.
- [ ] Match starts when everyone readies up.
- [ ] Undo request/accept works across devices.
- [ ] Owner closing the tab ends the room for everyone within ~30 s (heartbeat).
- [ ] (If custom domain) ICP filing completed and HTTPS certificate valid.
