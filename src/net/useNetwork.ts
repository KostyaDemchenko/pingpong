import {reactive, readonly} from 'vue'
import {createRoom, type PongRoom} from './room'
import {useGameFlow} from '@/composables/useGameFlow'

export type NetStatus = 'idle' | 'connecting' | 'waiting' | 'connected' | 'left' | 'error'

interface NetState {
  status: NetStatus
  opponentId: string
  amHost: boolean
  error: string
}

// Module-level singleton so Lobby and GameScreen share ONE room instance.
const state = reactive<NetState>({status: 'idle', opponentId: '', amHost: false, error: ''})
let pong: PongRoom | null = null
let nameResend = 0
let joinRetries = 0
let retryTimer = 0
/** last leave() promise — re-joining the SAME room id before the previous
 * leave finished hands Trystero's cached (dead) room back to us */
let leavePending: Promise<unknown> = Promise.resolve()

function teardownRoom(): void {
  if (pong) leavePending = pong.leave().catch(() => {})
  pong = null
}

/** (Re)create the room; on a join error (usually transient ICE trouble on the
 * first TURN allocation) tear down and retry a couple of times before failing. */
async function establish(code: string): Promise<void> {
  await leavePending.catch(() => {})
  if (state.status === 'idle') return // user backed out while we waited
  const flow = useGameFlow()
  pong = createRoom(code, () => onJoinFailed(code))
  state.status = 'waiting'
  // real nickname exchange: apply theirs, send ours on join (twice — the
  // second send covers the race where their handler wasn't ready yet)
  pong.name.onMessage((n) => {
    const clean = String(n).trim().slice(0, 16)
    if (clean) flow.setOppName(clean)
  })
  pong.onOpponentJoin((peerId, amHost) => {
    joinRetries = 0
    state.opponentId = peerId
    state.amHost = amHost
    state.status = 'connected'
    pong?.name.send(flow.state.myName)
    window.clearTimeout(nameResend)
    nameResend = window.setTimeout(() => pong?.name.send(flow.state.myName), 1200)
  })
  pong.onOpponentLeave(() => {
    state.opponentId = ''
    state.status = 'waiting'
  })
}

function onJoinFailed(code: string): void {
  if (state.status === 'connected' || state.status === 'idle') return
  if (joinRetries < 2) {
    joinRetries++
    console.warn(`[pixel-pong net] join failed — retrying (${joinRetries}/2)…`)
    teardownRoom()
    window.clearTimeout(retryTimer)
    retryTimer = window.setTimeout(() => {
      void establish(code).catch(fail)
    }, 900)
    return
  }
  state.status = 'error'
  state.error = 'CONNECT FAILED — CHECK NETWORK & RETRY'
}

function fail(e: unknown): void {
  state.status = 'error'
  state.error = e instanceof Error ? e.message : String(e)
}

export function useNetwork() {
  return {
    state: readonly(state),
    /** the live Trystero room wrapper (null until connected) — used by the game loop */
    room: () => pong,
    connect(code: string) {
      if (pong) return
      state.status = 'connecting'
      state.opponentId = ''
      state.error = ''
      joinRetries = 0
      void establish(code).catch(fail)
    },
    disconnect() {
      window.clearTimeout(retryTimer)
      window.clearTimeout(nameResend)
      teardownRoom()
      state.status = 'idle'
      state.opponentId = ''
      state.amHost = false
      state.error = ''
    },
  }
}
