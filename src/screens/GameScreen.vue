<script setup lang="ts">
import {computed, onMounted, onBeforeUnmount, reactive, ref, watch} from 'vue'
import PixelButton from '@/components/PixelButton.vue'
import CoinFlip from '@/components/CoinFlip.vue'
import {useGameFlow} from '@/composables/useGameFlow'
import {useNetwork} from '@/net/useNetwork'
import {createGame, type GameHandle, type GameMode} from '@/game/loop'
import {FIELD} from '@/game/types'

const flow = useGameFlow()
const net = useNetwork()
const canvas = ref<HTMLCanvasElement | null>(null)
const score = reactive({host: 0, guest: 0})

// Role → engine mode. Practice = local vs AI; online = host or guest.
const mode: GameMode = flow.state.mode === 'local' ? 'local' : flow.state.isHost ? 'host' : 'guest'
// Practice & guest players are the near (green) paddle; host is the far (red) one.
const iAmHost = mode === 'host'

// --- pre-match coin flip (decides the first server) ---
const showCoin = ref(true)
const coinResult = ref<0 | 1 | null>(null)
const mySide = computed<0 | 1>(() => (iAmHost ? 0 : 1))

function onCoinDone() {
  showCoin.value = false
  if (mode !== 'guest' && coinResult.value !== null) game?.startMatch(coinResult.value)
}

// --- lightweight engine-state mirror for the HUD (chips, hint, log, pause) ---
interface LogLine {
  text: string
  mine: boolean
}
const ui = reactive({
  phase: 'coin' as string,
  serving: 0 as 0 | 1,
  paused: false,
  voteHost: false,
  voteGuest: false,
  log: [] as LogLine[],
  ping: 0,
})
// history panel: collapsed shows the tail; hover/tap expands the full log
const logExpanded = ref(false)
const visibleLog = computed(() => (logExpanded.value ? ui.log : ui.log.slice(-6)))
const myServe = computed(() => ui.serving === mySide.value && (ui.phase === 'serve' || ui.phase === 'point'))
const oppServe = computed(() => ui.serving !== mySide.value && (ui.phase === 'serve' || ui.phase === 'point'))

const sideName = (p: 0 | 1) => (p === mySide.value ? flow.state.myName : flow.state.oppName)
const REASON_LABEL: Record<string, string> = {
  double_bounce: '2x BOUNCE',
  hit_out: 'OUT',
  missed: 'MISS',
}

// --- opponent disconnected mid-match ---
const oppLeft = ref(false)

// --- mutual-vote pause ---
const myPauseVote = computed(() => (mySide.value === 0 ? ui.voteHost : ui.voteGuest))
const oppPauseVote = computed(() => (mySide.value === 0 ? ui.voteGuest : ui.voteHost))
const pauseLabel = computed(() => {
  if (ui.paused) return myPauseVote.value ? 'RESUME…' : 'RESUME'
  return myPauseVote.value ? 'PAUSE…' : 'PAUSE'
})
function togglePauseVote() {
  const v = !myPauseVote.value
  if (mode === 'guest') net.room()?.pauseVote.send(v)
  else game?.setPauseVote(mySide.value, v)
}

// --- "+1 NAME" toast whenever a point lands ---
const toast = ref<{text: string; mine: boolean; key: number} | null>(null)
let toastTimer = 0
function showToast(mineScored: boolean) {
  toast.value = {
    text: `+1 ${mineScored ? flow.state.myName : flow.state.oppName}`,
    mine: mineScored,
    key: Date.now(),
  }
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), 1500)
}

let game: GameHandle | null = null
let broadcast = 0
let fullSync = 0
let coinPoll = 0
let uiPoll = 0
let stopStatusWatch: (() => void) | null = null

let lastPaddleSend = 0
function onPointerMove(e: PointerEvent) {
  if (!game || !canvas.value) return
  const r = canvas.value.getBoundingClientRect()
  game.setPointer(e.clientX - r.left, e.clientY - r.top)
  if (mode === 'guest') {
    // throttle to ~40/s — pointermove can fire 120+/s and flood a TURN relay
    const now = performance.now()
    if (now - lastPaddleSend < 25) return
    lastPaddleSend = now
    const p = game.getLocalPaddle()
    net.room()?.paddle.send({x: p.x, y: p.y, t: now})
  }
}

/** Click/tap = serve (only honored when it's actually my serve). */
function onPointerDown() {
  if (!game) return
  const st = game.getState()
  if (st.phase !== 'serve' || st.serving !== mySide.value) return
  if (mode === 'guest') net.room()?.serve.send(true)
  else game.requestServe(mySide.value)
}

function teardown() {
  game?.destroy()
  game = null
  if (broadcast) {
    clearInterval(broadcast)
    broadcast = 0
  }
  if (fullSync) {
    clearInterval(fullSync)
    fullSync = 0
  }
  if (coinPoll) {
    clearInterval(coinPoll)
    coinPoll = 0
  }
  if (uiPoll) {
    clearInterval(uiPoll)
    uiPoll = 0
  }
  window.clearTimeout(toastTimer)
}

function handleScore(s: {host: number; guest: number}) {
  const mineScored = iAmHost ? s.host > score.host : s.guest > score.guest
  score.host = s.host
  score.guest = s.guest
  showToast(mineScored)
  // push the full state (events/stats) right away so the guest's log & result
  // screen don't wait for the next 1s full-sync tick
  if (mode === 'host' && game) net.room()?.state.send(game.getState())
  // deuce rules live in the engine: the match ends only when phase === 'over'
  const st = game?.getState()
  if (st?.phase !== 'over') return
  const mine = iAmHost ? s.host : s.guest
  const theirs = iAmHost ? s.guest : s.host
  const matchStats = {
    rallies: st.stats.rallies,
    durationSec: Math.round(st.stats.ticks / FIELD.physicsHz),
    aces: st.stats.aces[mySide.value],
  }
  teardown()
  flow.endMatch(mine > theirs ? 'win' : 'lose', {mine, theirs}, matchStats)
}

function leave() {
  teardown()
  net.disconnect()
  flow.reset()
}

onMounted(() => {
  game = createGame(canvas.value!, {mode})
  game.onScore = handleScore

  const room = net.room()
  if (mode === 'host' && room) {
    room.paddle.onMessage((inp) => game?.setRemotePaddle(inp.x, inp.y, inp.t))
    room.serve.onMessage(() => game?.requestServe(1)) // guest's serve click
    room.pauseVote.onMessage((v) => game?.setPauseVote(1, v)) // guest's pause vote
    // hot path: tiny snapshot at 30Hz; the FULL state (events/stats) only ~1/sec
    broadcast = window.setInterval(() => {
      if (game) room.snap.send(game.getHotSnapshot())
    }, Math.round(1000 / FIELD.netBroadcastHz))
    fullSync = window.setInterval(() => {
      if (game) room.state.send(game.getState())
    }, 1000)
  } else if (mode === 'guest' && room) {
    room.snap.onMessage((h) => game?.applyHotSnapshot(h))
    room.state.onMessage((snap) => game?.applySnapshot(snap))
  }

  // mirror engine phase/server/log/pause into the HUD
  uiPoll = window.setInterval(() => {
    const st = game?.getState()
    if (!st) return
    ui.phase = st.phase
    ui.serving = st.serving
    ui.paused = st.paused
    ui.voteHost = st.pauseVoteHost
    ui.voteGuest = st.pauseVoteGuest
    ui.ping = game?.getPing() ?? 0
    ui.log = st.events.slice(-30).map((ev) => {
      if (ev.kind === 'serve') return {text: `> ${sideName(ev.player)} SERVES`, mine: ev.player === mySide.value}
      const mineScore = iAmHost ? ev.scoreHost : ev.scoreGuest
      const oppScore = iAmHost ? ev.scoreGuest : ev.scoreHost
      const why = ev.reason ? REASON_LABEL[ev.reason] ?? ev.reason : ''
      return {
        text: `+1 ${sideName(ev.player)} · ${why} · ${mineScore}:${oppScore}`,
        mine: ev.player === mySide.value,
      }
    })
  }, 120)

  // coin flip: practice & host decide (and broadcast via snapshots while the
  // engine sits in 'coin'); the guest follows the result from the snapshots.
  if (mode === 'guest') {
    coinPoll = window.setInterval(() => {
      const fs = game?.getState().firstServer ?? -1
      if (fs !== -1) {
        coinResult.value = fs
        clearInterval(coinPoll)
        coinPoll = 0
      }
    }, 150)
  } else {
    coinResult.value = Math.random() < 0.5 ? 0 : 1
    game.setCoinResult(coinResult.value)
  }

  game.start()

  // If the opponent disconnects mid-match: freeze the game and show an
  // overlay instead of silently dumping the player back to the menu.
  if (flow.state.mode === 'p2p') {
    stopStatusWatch = watch(
      () => net.state.status,
      (s) => {
        if (s !== 'connected' && !oppLeft.value) {
          oppLeft.value = true
          game?.stop()
        }
      },
    )
  }
})

onBeforeUnmount(() => {
  teardown()
  stopStatusWatch?.()
})
</script>

<template>
  <div class="relative h-full w-full flex flex-col bg-bg-base">
    <header class="flex items-center justify-between px-4 py-3">
      <span class="flex items-center gap-2 font-body text-text-muted text-xs">
        {{ flow.state.mode === 'local' ? 'PRACTICE' : `ROOM ${flow.state.roomCode}` }}
        <template v-if="mode === 'guest' && ui.ping > 0">
          <span
            class="w-2 h-2"
            :class="ui.ping < 100 ? 'bg-brand' : ui.ping < 220 ? 'bg-text-secondary' : 'bg-danger'"
          ></span>
          <span :class="ui.ping < 100 ? 'text-brand' : ui.ping < 220 ? 'text-text-secondary' : 'text-danger'">
            PING {{ ui.ping }}MS
          </span>
        </template>
      </span>
      <div class="flex items-center gap-2 font-display text-sm">
        <span class="hidden sm:inline font-body text-[10px] text-brand truncate max-w-[80px]">{{ flow.state.myName }}</span>
        <span class="text-brand">{{ iAmHost ? score.host : score.guest }}</span>
        <span class="text-text-muted">:</span>
        <span class="text-text-primary">{{ iAmHost ? score.guest : score.host }}</span>
        <span class="hidden sm:inline font-body text-[10px] text-text-secondary truncate max-w-[80px]">{{ flow.state.oppName }}</span>
      </div>
      <div class="flex items-center gap-2">
        <PixelButton
          v-if="ui.phase !== 'coin' && ui.phase !== 'over'"
          variant="secondary"
          @click="togglePauseVote"
        >
          {{ pauseLabel }}
        </PixelButton>
        <PixelButton variant="danger" @click="leave">LEAVE</PixelButton>
      </div>
    </header>

    <div class="relative flex-1 min-h-0">
      <canvas
        ref="canvas"
        class="h-full w-full touch-none"
        @pointermove="onPointerMove"
        @pointerdown="onPointerDown"
      ></canvas>

      <!-- match history: who served, who scored & why (newest at the bottom).
           Hover/tap expands the full log; z-30 keeps it usable during pause. -->
      <div
        v-if="ui.log.length"
        class="absolute top-2 left-2 z-30 flex flex-col gap-1 max-w-[260px]"
        :class="logExpanded ? 'max-h-[70%] overflow-y-auto bg-bg-base/85 border border-border p-1.5' : ''"
        @mouseenter="logExpanded = true"
        @mouseleave="logExpanded = false"
        @click.stop="logExpanded = !logExpanded"
      >
        <span
          v-for="(l, i) in visibleLog"
          :key="i"
          class="px-1.5 py-0.5 bg-bg-base/70 font-body text-[10px] leading-tight truncate shrink-0"
          :class="l.mine ? 'text-brand' : 'text-danger'"
        >
          {{ l.text }}
        </span>
      </div>

      <!-- serving tags (from the Pencil Game frames: YOU · SERVING / RIVAL) -->
      <div
        v-if="oppServe"
        class="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-2.5 py-1.5 bg-bg-base/80 border border-danger"
      >
        <span class="h-1.5 w-1.5 bg-danger"></span>
        <span class="font-display text-[9px] text-danger leading-none">{{ flow.state.oppName }} · SERVING</span>
      </div>
      <div
        v-if="myServe"
        class="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-2.5 py-1.5 bg-bg-base/80 border border-brand"
      >
        <span class="h-1.5 w-1.5 bg-brand"></span>
        <span class="font-display text-[9px] text-brand leading-none">{{ flow.state.myName }} · SERVING</span>
      </div>

      <!-- point toast -->
      <div
        v-if="toast"
        :key="toast.key"
        class="point-toast pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-4 py-2 bg-bg-base/85 border-2"
        :class="toast.mine ? 'border-brand text-brand' : 'border-danger text-danger'"
      >
        <span class="font-display text-sm leading-none">{{ toast.text }}</span>
      </div>

      <!-- opponent left mid-match -->
      <div v-if="oppLeft" class="absolute inset-0 z-20 grid place-items-center bg-pixel-black/70">
        <div class="flex flex-col items-center gap-5 px-8 py-7 bg-bg-surface border-2 border-danger pixel-shadow-lg">
          <span class="font-display text-danger text-lg">OPPONENT LEFT</span>
          <span class="font-body text-text-secondary text-[11px]">{{ flow.state.oppName }} DISCONNECTED FROM THE MATCH</span>
          <PixelButton variant="primary" @click="leave">BACK TO MENU</PixelButton>
        </div>
      </div>

      <!-- mutual-vote pause overlay -->
      <div v-if="ui.paused && !oppLeft" class="absolute inset-0 z-10 grid place-items-center bg-pixel-black/70">
        <div class="flex flex-col items-center gap-5 px-8 py-7 bg-bg-surface border-2 border-border-strong pixel-shadow-lg">
          <span class="font-display text-text-primary text-xl">PAUSED</span>
          <div class="flex flex-col items-center gap-1.5 font-body text-[11px]">
            <span :class="myPauseVote ? 'text-brand' : 'text-text-muted'">
              {{ flow.state.myName }} · {{ myPauseVote ? 'READY' : 'NOT READY' }}
            </span>
            <span :class="oppPauseVote ? 'text-brand' : 'text-text-muted'">
              {{ flow.state.oppName }} · {{ oppPauseVote ? 'READY' : 'NOT READY' }}
            </span>
            <span class="text-text-secondary mt-1">BOTH PLAYERS MUST VOTE TO RESUME</span>
          </div>
          <PixelButton variant="primary" @click="togglePauseVote">
            {{ myPauseVote ? 'CANCEL VOTE' : 'VOTE RESUME' }}
          </PixelButton>
        </div>
      </div>
    </div>

    <CoinFlip
      v-if="showCoin"
      :my-name="flow.state.myName"
      :opp-name="flow.state.oppName"
      :result="coinResult"
      :my-side="mySide"
      @done="onCoinDone"
    />

    <footer class="px-4 py-3 text-center">
      <span v-if="ui.phase === 'serve' && myServe" class="font-body text-brand text-[11px]">
        CLICK / TAP TO SERVE · SWIPE SIDEWAYS FOR SPIN
      </span>
      <span v-else class="font-body text-text-muted text-[11px]">
        MOVE PADDLE WITH CURSOR / FINGER · FIRST TO 11 · WIN BY 2
      </span>
    </footer>
  </div>
</template>

<style scoped>
.point-toast {
  animation: pp-toast 1.5s ease-out both;
}
@keyframes pp-toast {
  0% {
    opacity: 0;
    transform: translate(-50%, -30%) scale(0.8);
  }
  12% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1.05);
  }
  20% {
    transform: translate(-50%, -50%) scale(1);
  }
  80% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -70%) scale(1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .point-toast {
    animation: none;
  }
}
</style>
