/**
 * Quick-match: pair two strangers with no server.
 *
 * Everyone who taps "QUICK GAME" joins ONE public Trystero room and gossips
 * `propose` messages. Pairing uses **mutual-smallest**: each peer proposes to the
 * lowest peer id it sees; the two globally-lowest ids are each other's smallest,
 * so they pair first, derive a private room code from their sorted ids, leave the
 * pool, and meet alone there. The next-lowest pair forms in the following round.
 * This is a correct, stable matching for the common (low-traffic) case; heavy
 * concurrency could mis-pair on a race — good enough for a first pass.
 */
import {joinRoom, selfId} from 'trystero'
import type {Room} from 'trystero'
import {APP_ID} from './room'

const QUICK_ROOM = 'PIXELPONG-QUICKMATCH'

export interface QuickMatchHandle {
  cancel(): void
  poolSize(): number
}

export function startQuickMatch(onMatched: (privateCode: string, opponentId: string) => void): QuickMatchHandle {
  const room: Room = joinRoom({appId: APP_ID}, QUICK_ROOM)

  // normalize makeAction across Trystero API shapes (object {send,onMessage} vs [send,get])
  const made = (room as {makeAction: (n: string) => unknown}).makeAction('propose')
  const send: (data: unknown, target?: string) => void = Array.isArray(made)
    ? (d, t) => (made[0] as (d: unknown, t?: string) => void)(d, t)
    : (d, t) => (made as {send: (d: unknown, o?: {target: string}) => void}).send(d, t ? {target: t} : undefined)
  const onProposal = (cb: (peerId: string) => void): void => {
    if (Array.isArray(made)) {
      ;(made[1] as (h: (d: unknown, p: string) => void) => void)((_d, p) => cb(p))
    } else {
      // object API: onMessage is a settable handler property, not a method
      ;(made as {onMessage: (d: unknown, c: {peerId: string}) => void}).onMessage = (_d, c) => cb(c.peerId)
    }
  }

  let done = false

  const peerIds = (): string[] => Object.keys(room.getPeers())
  const smallestPeer = (): string | null => {
    const ps = peerIds()
    return ps.length ? ps.reduce((a, b) => (b < a ? b : a)) : null
  }

  const propose = (): void => {
    if (done) return
    const c = smallestPeer()
    if (c) send(1, c)
  }

  const match = (opponentId: string): void => {
    if (done) return
    done = true
    const code = [selfId, opponentId].sort().join('').slice(0, 24)
    void room.leave()
    onMatched(code, opponentId)
  }

  room.onPeerJoin = () => propose()
  room.onPeerLeave = () => propose()
  onProposal((peerId) => {
    // accept a proposal only from our current smallest candidate → mutual = stable pair
    if (!done && peerId === smallestPeer()) match(peerId)
  })

  propose() // in case peers are already present on join

  return {
    cancel: () => {
      if (done) return
      done = true
      void room.leave()
    },
    poolSize: () => peerIds().length + 1,
  }
}
