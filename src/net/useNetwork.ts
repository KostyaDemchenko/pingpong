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
      try {
        pong = createRoom(code)
        state.status = 'waiting'
        const flow = useGameFlow()
        // real nickname exchange: apply theirs, send ours on join (twice — the
        // second send covers the race where their handler wasn't ready yet)
        pong.name.onMessage((n) => {
          const clean = String(n).trim().slice(0, 16)
          if (clean) flow.setOppName(clean)
        })
        pong.onOpponentJoin((peerId, amHost) => {
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
      } catch (e) {
        state.status = 'error'
        state.error = e instanceof Error ? e.message : String(e)
      }
    },
    disconnect() {
      pong?.leave()
      pong = null
      state.status = 'idle'
      state.opponentId = ''
      state.amHost = false
      state.error = ''
    },
  }
}
