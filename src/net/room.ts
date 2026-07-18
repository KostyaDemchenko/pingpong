/**
 * Thin wrapper around Trystero so the rest of the app never imports it directly.
 * Reviewed against the local Trystero monorepo v0.25.2 (Nostr strategy, zero-config).
 *
 * Networking model (see cheat-sheet in README): host-authoritative.
 *  - The peer with the smaller id runs the physics sim and broadcasts `state`.
 *  - The guest sends only its paddle input and renders authoritative snapshots.
 *
 * The `defineAction` helper normalizes Trystero's `makeAction` across versions:
 * newer builds return an object `{send, onMessage}`, older ones a `[send, get]`
 * tuple — so a version bump only touches this file.
 */
import {joinRoom as joinNostrRoom, selfId} from 'trystero'
import {joinRoom as joinWsRelayRoom} from '@trystero-p2p/ws-relay'
import type {Room} from 'trystero'
import type {GameState, HotSnapshot} from '@/game/types'

/** Authoritative snapshot sent host→guest is just the (small, serializable) GameState. */
export type Snapshot = GameState

/** Unique to THIS app — NOT the room code. Bump to invalidate old clients. */
export const APP_ID = 'pixel_pong_v1'

/**
 * SIGNALING — two interchangeable strategies, chosen by env:
 *
 *  1. OWN RELAY (preferred for production): set `VITE_RELAY_URLS` to the
 *     wss:// URL(s) of our self-hosted @trystero-p2p/ws-relay server (see
 *     relay-server/README.md — a $4 VPS runs it). 100% under our control,
 *     no third-party policies/rate limits.
 *
 *  2. PUBLIC NOSTR (fallback / local dev, no env needed): a fixed list of
 *     public Nostr relays, the SAME for every client. Fragile long-term:
 *     public relays keep adding web-of-trust filters ("pubkey is not in our
 *     web of trust" — offchain.pub) and rate limits ("noting too much" —
 *     damus.io), which silently kill signaling. That's WHY own relay exists.
 */
const ENV_RELAYS = (import.meta.env.VITE_RELAY_URLS as string | undefined)
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const USE_OWN_RELAY = !!ENV_RELAYS && ENV_RELAYS.length > 0

/** Public Nostr fallback list (connectivity-tested; no WoT-filtering relays). */
export const NOSTR_RELAY_URLS = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.oxtr.dev',
  'wss://nostr.mom',
  'wss://purplerelay.com',
  'wss://relay.nostr.net',
]

/**
 * TURN for peers behind strict NATs (prod = different networks; direct WebRTC
 * often fails there while a LAN works). Own server via env
 * (`VITE_TURN_URL/USER/PASS`, e.g. coturn on the same VPS) with a public
 * free fallback. Data stays end-to-end encrypted through TURN either way.
 */
function turnConfig() {
  const url = import.meta.env.VITE_TURN_URL as string | undefined
  if (url) {
    return [
      {
        urls: url.split(',').map((s) => s.trim()),
        username: (import.meta.env.VITE_TURN_USER as string | undefined) ?? '',
        credential: (import.meta.env.VITE_TURN_PASS as string | undefined) ?? '',
      },
    ]
  }
  return [
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turns:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ]
}

/** Details Trystero reports when a peer fails to join (bad password, handshake
 * timeout, or SDP exchanged but ICE never connected → TURN missing/broken). */
export interface JoinErrorDetails {
  error: string
  appId: string
  roomId: string
  peerId: string
}

/** Join a Trystero room via the configured strategy (game room & quick-match). */
export function netJoinRoom(
  extra: {password?: string},
  roomId: string,
  onJoinError?: (details: JoinErrorDetails) => void,
): Room {
  const cfg = {appId: APP_ID, turnConfig: turnConfig(), ...extra}
  const callbacks = {
    onJoinError: (details: JoinErrorDetails) => {
      // always log: this is the ONLY signal when WebRTC can't connect a pair
      console.warn('[pixel-pong net] join error:', details.error, details)
      onJoinError?.(details)
    },
  }
  if (USE_OWN_RELAY) {
    return joinWsRelayRoom(
      {...cfg, relayConfig: {urls: ENV_RELAYS!}},
      roomId,
      callbacks,
    ) as unknown as Room
  }
  return joinNostrRoom({...cfg, relayConfig: {urls: NOSTR_RELAY_URLS}}, roomId, callbacks)
}

// ---- Wire message shapes (keep tiny; hot path runs many times/sec) ----
export interface PaddleInput {
  x: number // normalized paddle x-position 0..1 (portrait table)
  y: number // normalized paddle depth 0..1, clamped to the sender's half
  t: number // sender clock (performance.now) for latest-wins
}

type SendFn<T> = (data: T, target?: string | string[]) => void
interface Action<T> {
  send: SendFn<T>
  onMessage: (cb: (data: T, peerId: string) => void) => void
}

function defineAction<T>(room: Room, name: string): Action<T> {
  const made = (room as any).makeAction(name)
  // newer Trystero: object { send, onMessage }; older: tuple [send, get]
  if (Array.isArray(made)) {
    const [send, get] = made
    return {
      send: (data, target) => send(data, target),
      onMessage: (cb) => get((data: T, peerId: string) => cb(data, peerId)),
    }
  }
  return {
    send: (data, target) => made.send(data, target ? {target} : undefined),
    onMessage: (cb) => {
      made.onMessage = (data: T, ctx: {peerId: string}) => cb(data, ctx.peerId)
    },
  }
}

export interface PongRoom {
  room: Room
  selfId: string
  paddle: Action<PaddleInput>
  state: Action<Snapshot>
  /** host -> guest, 30Hz: compact hot snapshot (full `state` goes ~1/sec) */
  snap: Action<HotSnapshot>
  ready: Action<boolean>
  rematch: Action<boolean>
  /** guest -> host: "I clicked to serve" (host relays into its simulation) */
  serve: Action<boolean>
  /** guest -> host: the guest's current pause vote (host feeds its sim) */
  pauseVote: Action<boolean>
  /** both ways: each peer's nickname, sent on connect */
  name: Action<string>
  /** Called when the (single) opponent connects; provides host election result. */
  onOpponentJoin: (cb: (peerId: string, amHost: boolean) => void) => void
  onOpponentLeave: (cb: (peerId: string) => void) => void
  peerCount: () => number
  leave: () => void
}

export function createRoom(
  roomCode: string,
  onJoinError?: (details: JoinErrorDetails) => void,
): PongRoom {
  const code = roomCode.trim().toUpperCase()
  // password = code → only matching codes ever connect, SDP stays private.
  const room = netJoinRoom({password: code}, code, onJoinError)

  return {
    room,
    selfId,
    paddle: defineAction<PaddleInput>(room, 'paddle'),
    state: defineAction<Snapshot>(room, 'state'),
    snap: defineAction<HotSnapshot>(room, 'snap'),
    ready: defineAction<boolean>(room, 'ready'),
    rematch: defineAction<boolean>(room, 'rematch'),
    serve: defineAction<boolean>(room, 'serve'),
    pauseVote: defineAction<boolean>(room, 'pauseVote'),
    name: defineAction<string>(room, 'name'),
    onOpponentJoin(cb) {
      // onPeerJoin is an assignable callback property in Trystero, not a method.
      room.onPeerJoin = (peerId) => {
        // deterministic, server-less host election — both peers agree.
        const amHost = selfId < peerId
        cb(peerId, amHost)
      }
    },
    onOpponentLeave(cb) {
      room.onPeerLeave = (peerId) => cb(peerId)
    },
    peerCount() {
      return Object.keys(room.getPeers()).length
    },
    leave() {
      void room.leave()
    },
  }
}
