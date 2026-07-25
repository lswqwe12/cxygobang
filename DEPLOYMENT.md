# Online Deployment Guide

This document summarizes how to deploy the Gobang game so that all users can access it
via a public link.

## Key Considerations

1. **A server is required.** Online play uses WebSocket, so the game **cannot** be hosted
   on pure static hosts (GitHub Pages, Netlify static, S3, etc.). You need a platform that
   runs a persistent Node.js process and supports WebSocket connections.
2. **Single port.** `server.js` serves both the static files (HTTP) and the WebSocket
   endpoint on the same port (`process.env.PORT || 3000`). No extra WebSocket
   infrastructure is needed.
3. **HTTPS/WSS.** If the site is served over HTTPS, the browser requires secure WebSocket
   (`wss://`). The client handles this automatically
   (`public/client.js` picks `wss://` when the page is HTTPS) — just make sure your
   platform terminates TLS.
4. **Stateless clients, in-memory rooms.** Rooms live in server memory. That's fine for a
   single instance; do not run multiple replicas behind a load balancer unless you add
   sticky sessions.

## Environment Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port the HTTP/WebSocket server listens on |

No database, no other configuration. The only dependency is the npm package `ws`
(installed via `npm install`, start with `npm start`).

---

## Option A — Render (free tier, easiest)

1. Push this project to a GitHub repository.
2. In [Render](https://render.com), create a **Web Service**:
   - **Runtime**: Node
   - **Build command**: `npm install`
   - **Start command**: `npm start`
3. Render sets `PORT` automatically; `server.js` already reads it.
4. Render gives you a public URL like `https://your-app.onrender.com` with TLS —
   share this link with players.

Note: free instances sleep after inactivity; the first visit may take ~30 s to wake up.

## Option B — Railway / Fly.io / similar PaaS

Same idea: connect the repo, set build `npm install`, start `npm start`, and the
platform injects `PORT`. All of these support WebSocket out of the box.

## Option C — VPS (Ubuntu) with Nginx + TLS

For full control (e.g. your own domain):

```bash
# on the server
git clone <your-repo> && cd TFBoysTest
npm install
npm install -g pm2
PORT=3000 pm2 start server.js --name gobang
pm2 save && pm2 startup
```

Nginx reverse-proxy config (`/etc/nginx/sites-available/gobang`) — note the
WebSocket upgrade headers:

```nginx
server {
    listen 80;
    server_name gobang.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;   # required for WebSocket
        proxy_set_header Connection "upgrade";    # required for WebSocket
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;                 # keep idle games connected
    }
}
```

Then enable TLS with Certbot:

```bash
sudo certbot --nginx -d gobang.example.com
```

Players access the game at `https://gobang.example.com`.

## Option D — Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
docker build -t gobang .
docker run -p 3000:3000 gobang
```

## Post-Deployment Checklist

- [ ] Open the public URL in two different browsers/devices.
- [ ] Create a room in one, join it from the other with the code + password.
- [ ] Ready up on both — the match should start automatically.
- [ ] Place a few moves, test the undo request/accept flow.
- [ ] Close the owner's tab — all other players should see the "room closed" message.
