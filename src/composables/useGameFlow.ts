import {reactive, readonly} from 'vue'
import {randomNick} from '@/utils/nickname'

export type Screen = 'menu' | 'loading' | 'searching' | 'lobby' | 'game' | 'result'
export type MatchResult = 'win' | 'lose' | null

export type PlayMode = 'local' | 'p2p'

interface FlowState {
  screen: Screen
  roomCode: string
  /** 'local' = single-player vs AI (practice); 'p2p' = online via Trystero */
  mode: PlayMode
  /** true = we host the authoritative simulation (elected via peer id sort) */
  isHost: boolean
  result: MatchResult
  /** final score of the last match (my points / opponent's), for the result screen */
  finalScore: {mine: number; theirs: number} | null
  /** real end-of-match stats for the result screen */
  matchStats: {rallies: number; durationSec: number; aces: number} | null
  /** last human-readable connection/error status for UI */
  status: string
  /** local player's pixel nickname (stable for the session) */
  myName: string
  /** opponent's nickname — placeholder until real names sync over the network */
  oppName: string
}

const state = reactive<FlowState>({
  screen: 'menu',
  roomCode: '',
  mode: 'p2p',
  isHost: false,
  result: null,
  finalScore: null,
  matchStats: null,
  status: '',
  myName: randomNick(),
  oppName: randomNick(),
})

/** Generate a friendly room code like "AB12-CD34". */
export function makeRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no ambiguous 0/O/1/I
  const pick = (n: number) =>
    Array.from({length: n}, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
  return `${pick(4)}-${pick(4)}`
}

export function useGameFlow() {
  return {
    state: readonly(state),
    go(screen: Screen) {
      state.screen = screen
    },
    hostRoom() {
      state.roomCode = makeRoomCode()
      state.mode = 'p2p'
      state.result = null
      state.oppName = randomNick()
      state.screen = 'lobby'
    },
    joinRoom(code: string) {
      state.roomCode = code.trim().toUpperCase()
      state.mode = 'p2p'
      state.result = null
      state.oppName = randomNick()
      state.screen = 'lobby'
    },
    /** Start a single-player practice match vs AI (no networking). */
    practice() {
      state.mode = 'local'
      state.roomCode = ''
      state.isHost = false
      state.result = null
      state.oppName = 'CPU'
      state.screen = 'game'
    },
    /** Enter quick-match: search the public pool for an opponent, then auto-play. */
    quickPlay() {
      state.mode = 'p2p'
      state.roomCode = ''
      state.isHost = false
      state.result = null
      state.oppName = randomNick()
      state.screen = 'searching'
    },
    /** Set the opponent's nickname (e.g. when it arrives over the network). */
    setOppName(name: string) {
      state.oppName = name
    },
    /** Matchmaker paired us into a private room — used by the searching screen. */
    setRoomCode(code: string) {
      state.roomCode = code
    },
    setHost(v: boolean) {
      state.isHost = v
    },
    setStatus(s: string) {
      state.status = s
    },
    endMatch(
      result: MatchResult,
      finalScore: {mine: number; theirs: number} | null = null,
      matchStats: {rallies: number; durationSec: number; aces: number} | null = null,
    ) {
      state.result = result
      state.finalScore = finalScore
      state.matchStats = matchStats
      state.screen = 'result'
    },
    reset() {
      state.screen = 'menu'
      state.roomCode = ''
      state.mode = 'p2p'
      state.isHost = false
      state.result = null
      state.finalScore = null
      state.matchStats = null
      state.status = ''
    },
  }
}
