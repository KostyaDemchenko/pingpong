/**
 * Pixel Pong signaling relay — a tiny self-hosted WebSocket relay for
 * Trystero's ws-relay strategy. It only brokers WebRTC handshakes (SDP);
 * all game traffic stays peer-to-peer and end-to-end encrypted.
 *
 * Run:  PORT=8765 node server.mjs
 * See README.md for full VPS deployment (systemd + Caddy TLS + coturn).
 */
import {createWsRelayServer} from '@trystero-p2p/ws-relay/server'

const port = Number(process.env.PORT ?? 8765)
createWsRelayServer({port})
console.log(`pixel-pong relay listening on :${port}`)
