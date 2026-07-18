import {reactive, readonly} from 'vue'
import {createRoom, type PongRoom} from './room'

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
        pong.onOpponentJoin((peerId, amHost) => {
          state.opponentId = peerId
          state.amHost = amHost
          state.status = 'connected'
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
