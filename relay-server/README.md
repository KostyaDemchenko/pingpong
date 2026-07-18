# Pixel Pong relay server (Docker + Cloudflare)

Self-hosted signaling for the game's P2P connections + TURN, as one
`docker compose` stack on a cheap VPS:

- **relay** — tiny WebSocket relay (Trystero ws-relay strategy) brokering the
  WebRTC handshake; game traffic stays peer-to-peer, e2e-encrypted.
- **caddy** — TLS termination for `wss://`. Built with the cloudflare-dns
  plugin, so certificates are issued via DNS-01 through the Cloudflare API —
  works even with the hostname behind Cloudflare's proxy.
- **coturn** — TURN proxy for peer pairs whose NATs block direct WebRTC.

Deploys automatically from GitHub (`.github/workflows/deploy-relay.yml`) on
every push that touches `relay-server/`.

## One-time setup

### 1. Cloudflare DNS (domain already on Cloudflare)

| Record | Name    | Value    | Proxy                                     |
| ------ | ------- | -------- | ----------------------------------------- |
| A      | `relay` | VPS IP   | proxied (orange) is OK — WS goes through  |
| A      | `turn`  | VPS IP   | **DNS only (grey)! CF can't proxy TURN**  |

Also: SSL/TLS mode → **Full (strict)**.

### 2. Cloudflare API token (for Caddy's certificates)

My Profile → API Tokens → Create Token → template **"Edit zone DNS"**, scoped
to the `pixel-pong.online` zone. Goes into `.env` as `CF_API_TOKEN`.

### 3. VPS bootstrap (Ubuntu 24.04, SSH by key)

```sh
curl -fsSL https://get.docker.com | sh
git clone https://github.com/KostyaDemchenko/pingpong.git /opt/pingpong
cd /opt/pingpong/relay-server
cp .env.example .env && nano .env   # fill every value
docker compose up -d --build
docker compose ps                   # relay + caddy + coturn all "Up"
```

### 4. Firewall (ufw + hoster's panel if any)

```sh
ufw allow OpenSSH
ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
ufw allow 3478/tcp && ufw allow 3478/udp
ufw allow 49152:65535/udp
ufw enable
```

### 5. GitHub secrets (repo → Settings → Secrets → Actions)

- `VPS_HOST` — server IP (the raw IP, not the proxied hostname)
- `VPS_USER` — ssh user (e.g. `root`)
- `VPS_SSH_KEY` — private key; its public half must be in
  `~/.ssh/authorized_keys` on the VPS (password auth is disabled)

After that, pushes touching `relay-server/` redeploy the stack automatically;
manual runs via Actions → "Deploy relay" → Run workflow.

### 6. Vercel env vars (Production) + Redeploy

```
VITE_RELAY_URLS=wss://relay.pixel-pong.online
VITE_TURN_URL=turn:turn.pixel-pong.online:3478
VITE_TURN_USER=pong
VITE_TURN_PASS=<same as TURN_PASS in .env>
```

Note `VITE_TURN_URL` uses the **turn.** subdomain (grey-cloud). Without
`VITE_RELAY_URLS` the client falls back to public Nostr relays — fine for
local dev, unreliable in production.

## Ops cheatsheet

```sh
cd /opt/pingpong/relay-server
docker compose logs -f relay      # signaling connections
docker compose logs -f caddy      # cert issuance / proxy
docker compose logs -f coturn     # TURN sessions
docker compose up -d --build      # manual redeploy
```

Local test without TLS: `node server.mjs`, then run the app with
`VITE_RELAY_URLS=ws://localhost:8765 npm run dev` (`ws://` only works from
`http://localhost`; production needs the `wss://` URL).
