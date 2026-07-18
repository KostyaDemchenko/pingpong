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
import {joinRoom, selfId} from 'trystero'
import type {Room} from 'trystero'
import type {GameState} from '@/game/types'

/** Authoritative snapshot sent host→guest is just the (small, serializable) GameState. */
export type Snapshot = GameState

/** Unique to THIS app — NOT the room code. Bump to invalidate old clients. */
export const APP_ID = 'pixel_pong_v1'

/**
 * Fixed set of reliable, long-lived public Nostr relays — the SAME list for
 * every client. Trystero's default list has ~50 entries, many flaky or dead
 * (e.g. koru.bitcointxoko.org), and each client connects to a random subset —
 * so two peers could end up with NO working relay in common and never meet
 * (symptom in prod: "WebSocket connection to wss://… failed" + nobody joins).
 * Passing explicit urls makes every client use this exact list.
 */
export const RELAY_URLS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.oxtr.dev',
  'wss://nostr.mom',
  'wss://offchain.pub',
]

/**
 * Free public TURN (Open Relay / metered.ca) so peers behind strict NATs can
 * still connect over the internet (Vercel prod = different networks; direct
 * WebRTC often fails there while it works fine on one LAN). Data stays
 * end-to-end encrypted through TURN. If this service ever gets flaky, swap in
 * your own — Cloudflare Calls has a free TURN tier.
 */
export const TURN_CONFIG = [
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

/** Shared Trystero config for BOTH the game room and quick-match. */
export function baseNetConfig() {
  return {appId: APP_ID, relayConfig: {urls: RELAY_URLS}, turnConfig: TURN_CONFIG}
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
  ready: Action<boolean>
  rematch: Action<boolean>
  /** guest -> host: "I clicked to serve" (host relays into its simulation) */
  serve: Action<boolean>
  /** guest -> host: the guest's current pause vote (host feeds its sim) */
  pauseVote: Action<boolean>
  /** Called when the (single) opponent connects; provides host election result. */
  onOpponentJoin: (cb: (peerId: string, amHost: boolean) => void) => void
  onOpponentLeave: (cb: (peerId: string) => void) => void
  peerCount: () => number
  leave: () => void
}

export function createRoom(roomCode: string): PongRoom {
  const code = roomCode.trim().toUpperCase()
  // password = code → only matching codes ever connect, SDP stays private.
  const room = joinRoom({...baseNetConfig(), password: code}, code)

  return {
    room,
    selfId,
    paddle: defineAction<PaddleInput>(room, 'paddle'),
    state: defineAction<Snapshot>(room, 'state'),
    ready: defineAction<boolean>(room, 'ready'),
    rematch: defineAction<boolean>(room, 'rematch'),
    serve: defineAction<boolean>(room, 'serve'),
    pauseVote: defineAction<boolean>(room, 'pauseVote'),
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
