# Pixel Pong relay server

Self-hosted signaling for the game's P2P connections. Public Nostr relays
increasingly reject unknown keys (web-of-trust filters) or rate-limit our
signaling traffic — this tiny relay removes that dependency entirely.

Two services run on one cheap VPS (~€4/mo is plenty — signaling traffic is
tiny, game data stays peer-to-peer):

- **ws-relay** (this folder) — brokers the WebRTC handshake (SDP exchange).
- **coturn** — TURN proxy for peer pairs whose NATs block direct WebRTC.

## 1. Get a VPS + domain name

- Any small VPS: Hetzner CX22 (~€3.8/mo) / CAX11 (~€3.3/mo), Ubuntu 24.04.
- Point a DNS A-record at it, e.g. `relay.yourdomain.com` → `<VPS IP>`.
  No domain? `relay.<VPS-IP-with-dashes>.sslip.io` resolves automatically
  (e.g. `relay.203-0-113-7.sslip.io`) and works with Caddy's auto-TLS.

## 2. Install Node 22 + Caddy

```sh
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs caddy
```

## 3. Deploy the relay

```sh
sudo mkdir -p /opt/pixel-pong-relay
# copy server.mjs + package.json from this folder to /opt/pixel-pong-relay, then:
cd /opt/pixel-pong-relay && npm install
```

`/etc/systemd/system/pixel-pong-relay.service`:

```ini
[Unit]
Description=Pixel Pong ws-relay
After=network.target

[Service]
Environment=PORT=8765
ExecStart=/usr/bin/node /opt/pixel-pong-relay/server.mjs
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl enable --now pixel-pong-relay
```

`/etc/caddy/Caddyfile` (Caddy fetches the TLS cert automatically):

```
relay.yourdomain.com {
    reverse_proxy localhost:8765
}
```

```sh
sudo systemctl reload caddy
```

## 4. TURN (coturn) on the same VPS

```sh
sudo apt-get install -y coturn
```

`/etc/turnserver.conf` (replace the placeholders):

```
listening-port=3478
fingerprint
lt-cred-mech
user=pong:CHANGE_ME_STRONG_PASSWORD
realm=relay.yourdomain.com
no-cli
no-tlsv1
no-tlsv1_1
```

Enable and open the firewall:

```sh
echo 'TURNSERVER_ENABLED=1' | sudo tee /etc/default/coturn
sudo systemctl enable --now coturn
sudo ufw allow 3478/tcp && sudo ufw allow 3478/udp
sudo ufw allow 49152:65535/udp   # TURN media relay range
```

## 5. Point the game at your servers

Set these env vars in Vercel (Project → Settings → Environment Variables)
and redeploy:

```
VITE_RELAY_URLS=wss://relay.yourdomain.com
VITE_TURN_URL=turn:relay.yourdomain.com:3478
VITE_TURN_USER=pong
VITE_TURN_PASS=CHANGE_ME_STRONG_PASSWORD
```

Without `VITE_RELAY_URLS` the client falls back to public Nostr relays
(fine for local dev, unreliable in production).

Local test against a local relay:

```sh
# terminal 1
node relay-server/server.mjs
# terminal 2
VITE_RELAY_URLS=ws://localhost:8765 npm run dev
```

(`ws://` only works from `http://localhost`; production pages are https and
need the `wss://` URL via Caddy.)
