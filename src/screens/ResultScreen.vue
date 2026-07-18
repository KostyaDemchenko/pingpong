<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, reactive, watch} from 'vue'
import PixelButton from '@/components/PixelButton.vue'
import {useGameFlow} from '@/composables/useGameFlow'
import {useNetwork} from '@/net/useNetwork'

const flow = useGameFlow()
const net = useNetwork()
const won = computed(() => flow.state.result === 'win')

// ---- Same-room rematch handshake -------------------------------------------
// Both players click REMATCH -> the match restarts in the SAME room (no new
// code). The sender re-sends every second until answered, so a click landing
// before the other side's handler is registered can't get lost.
const rm = reactive({mine: false, theirs: false, oppGone: false})
let resend = 0
let stopStatusWatch: (() => void) | null = null

onMounted(() => {
  if (flow.state.mode !== 'p2p') return
  const room = net.room()
  if (!room || net.state.status !== 'connected') {
    rm.oppGone = true
    return
  }
  room.rematch.onMessage(() => {
    rm.theirs = true
    maybeStart()
  })
  stopStatusWatch = watch(
    () => net.state.status,
    (s) => {
      if (s !== 'connected') rm.oppGone = true
    },
  )
})
onBeforeUnmount(() => {
  window.clearInterval(resend)
  stopStatusWatch?.()
})

function maybeStart() {
  if (rm.mine && rm.theirs) {
    window.clearInterval(resend)
    flow.go('game')
  }
}

function rematch() {
  if (flow.state.mode === 'local') {
    flow.practice()
    return
  }
  if (rm.oppGone || !net.room()) {
    // opponent is gone — fall back to hosting a fresh room
    net.disconnect()
    flow.hostRoom()
    return
  }
  rm.mine = true
  net.room()!.rematch.send(true)
  window.clearInterval(resend)
  resend = window.setInterval(() => {
    if (net.room() && !rm.theirs) net.room()!.rematch.send(true)
    else window.clearInterval(resend)
  }, 1000)
  maybeStart()
}

function toMenu() {
  net.disconnect()
  flow.reset()
}

// ---- Display data ----------------------------------------------------------
const pad2 = (n: number) => String(n).padStart(2, '0')
const youScore = computed(() => pad2(flow.state.finalScore?.mine ?? (won.value ? 11 : 0)))
const oppScore = computed(() => pad2(flow.state.finalScore?.theirs ?? (won.value ? 0 : 11)))
const rematchLabel = computed(() => {
  if (flow.state.mode === 'local') return 'PLAY AGAIN'
  if (rm.oppGone) return 'NEW ROOM'
  if (rm.mine && !rm.theirs) return 'WAITING…'
  if (!rm.mine && rm.theirs) return 'ACCEPT REMATCH'
  return 'REMATCH'
})
const rematchHint = computed(() => {
  if (flow.state.mode !== 'p2p') return ''
  if (rm.oppGone) return `${flow.state.oppName} LEFT — START A NEW ROOM`
  if (!rm.mine && rm.theirs) return `${flow.state.oppName} WANTS A REMATCH!`
  if (rm.mine && !rm.theirs) return `WAITING FOR ${flow.state.oppName}…`
  return ''
})

// Placeholder end-of-game stats (mirrors the design values).
const stats = [
  {label: 'RALLIES', value: '42'},
  {label: 'DURATION', value: '3:24'},
  {label: 'ACES', value: '6'},
] as const

// ---- Falling pixel particles ------------------------------------------------
// Win: colorful confetti raining from the top. Lose: sparse dim red "rain".
interface Piece {
  left: string
  size: number
  color: string
  delay: string
  duration: string
}
function makePieces(count: number, palette: string[], minDur: number, maxDur: number): Piece[] {
  return Array.from({length: count}, (_, i) => ({
    left: `${(i * 97) % 100}%`,
    size: 8 + ((i * 53) % 9),
    color: palette[i % palette.length]!,
    delay: `${((i * 71) % 40) / 10}s`,
    duration: `${(minDur + (((i * 37) % 100) / 100) * (maxDur - minDur)).toFixed(2)}s`,
  }))
}
const CONFETTI = makePieces(
  44,
  ['var(--color-brand)', 'var(--color-text-primary)', 'var(--color-danger)', 'var(--color-brand-hover)'],
  2.6,
  4.6,
)
const RAIN = makePieces(22, ['var(--color-danger)', 'var(--color-text-muted)'], 4.0, 6.5)
</script>

<template>
  <div
    class="relative h-full w-full overflow-hidden bg-bg-base flex flex-col items-center justify-center gap-lg px-6"
  >
    <!-- Win: confetti raining down. Lose: sparse dim red pixel rain. -->
    <div class="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
      <span
        v-for="(c, i) in won ? CONFETTI : RAIN"
        :key="i"
        class="absolute block"
        :class="won ? 'confetti-bit' : 'rain-bit'"
        :style="{
          left: c.left,
          top: '-20px',
          width: c.size + 'px',
          height: c.size + 'px',
          background: c.color,
          animationDelay: c.delay,
          animationDuration: c.duration,
        }"
      />
    </div>

    <!-- Motif: pixel trophy (win) or down-arrow (lose) -->
    <div class="relative z-10 flex flex-col items-center">
      <!-- Trophy -->
      <div v-if="won" class="motif-win flex flex-col items-center">
        <!-- Rim + handles -->
        <div class="flex items-center">
          <div class="w-[12px] h-[12px] bg-brand" />
          <div class="w-[60px] h-[12px] bg-brand" />
          <div class="w-[12px] h-[12px] bg-brand" />
        </div>
        <div class="w-[60px] h-[36px] bg-brand" />
        <div class="w-[16px] h-[16px] bg-brand-deep" />
        <div class="w-[44px] h-[12px] bg-brand" />
      </div>

      <!-- Down arrow -->
      <div v-else class="motif-lose flex flex-col items-center">
        <div class="w-[20px] h-[40px] bg-text-muted" />
        <div class="flex flex-col items-center">
          <div class="w-[60px] h-[12px] bg-text-secondary" />
          <div class="w-[44px] h-[12px] bg-text-secondary" />
          <div class="w-[28px] h-[12px] bg-text-secondary" />
          <div class="w-[12px] h-[12px] bg-text-secondary" />
        </div>
      </div>
    </div>

    <!-- Title block -->
    <div class="relative z-10 flex flex-col items-center gap-3">
      <h1
        class="font-display text-[32px] sm:text-[40px] leading-none text-center"
        :class="won ? 'text-brand title-pop' : 'text-danger title-pop title-shake'"
        :style="`text-shadow: 5px 5px 0 ${won ? 'var(--color-brand-shadow)' : 'var(--color-pixel-black)'}`"
      >
        {{ won ? 'YOU WIN!' : 'YOU LOSE' }}
      </h1>
      <span class="font-body text-[14px] tracking-widest text-text-secondary">
        {{ won ? 'VICTORY' : 'DEFEAT' }}
      </span>
    </div>

    <!-- Score panel (surface card, borders/shadow match PixelPanel) -->
    <div
      class="relative z-10 flex items-stretch border-2 border-border-strong bg-bg-surface pixel-shadow-lg"
    >
      <!-- Your side -->
      <div
        class="flex flex-col items-center gap-3 px-6 sm:px-10 py-7"
        :class="won ? 'bg-brand-deep' : 'bg-bg-elevated'"
      >
        <span
          class="font-body text-[14px]"
          :class="won ? 'text-brand' : 'text-text-secondary'"
        >
          {{ flow.state.myName }}
        </span>
        <span
          class="font-display text-[32px] sm:text-[40px] leading-none"
          :class="won ? 'text-text-primary' : 'text-text-muted'"
        >
          {{ youScore }}
        </span>
      </div>

      <div class="flex items-center px-2">
        <span class="font-display text-[24px] sm:text-[32px] text-text-muted leading-none">:</span>
      </div>

      <!-- Opponent side -->
      <div
        class="flex flex-col items-center gap-3 px-6 sm:px-10 py-7"
        :class="won ? '' : 'bg-danger'"
      >
        <span
          class="font-body text-[14px]"
          :class="won ? 'text-text-secondary' : 'text-text-primary'"
        >
          {{ flow.state.oppName }}
        </span>
        <span
          class="font-display text-[32px] sm:text-[40px] leading-none"
          :class="won ? 'text-text-muted' : 'text-text-primary'"
        >
          {{ oppScore }}
        </span>
      </div>
    </div>

    <!-- Stats row -->
    <div class="relative z-10 flex gap-4">
      <div
        v-for="s in stats"
        :key="s.label"
        class="w-[104px] sm:w-[160px] flex flex-col items-center gap-2 border-2 border-border bg-bg-elevated px-4 sm:px-6 py-4"
      >
        <span class="font-body text-[11px] text-text-muted">{{ s.label }}</span>
        <span
          class="font-display text-[20px] leading-none"
          :class="won ? 'text-brand' : 'text-text-secondary'"
        >
          {{ s.value }}
        </span>
      </div>
    </div>

    <!-- Buttons -->
    <div class="relative z-10 flex flex-col sm:flex-row gap-4 w-full max-w-[320px] sm:max-w-none sm:w-auto">
      <PixelButton class="w-full sm:w-auto" @click="rematch">{{ rematchLabel }}</PixelButton>
      <PixelButton variant="secondary" class="w-full sm:w-auto" @click="toMenu">BACK TO MENU</PixelButton>
      <span
        v-if="rematchHint"
        class="w-full text-center font-body text-[11px]"
        :class="rm.oppGone ? 'text-danger' : 'text-brand'"
      >
        {{ rematchHint }}
      </span>
    </div>
  </div>
</template>

<style scoped>
/* Confetti falls the full screen height, tumbling; staggered delays loop it. */
.confetti-bit {
  animation-name: pp-confetti-fall;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}
@keyframes pp-confetti-fall {
  0% {
    transform: translateY(-4vh) rotate(0deg);
    opacity: 1;
  }
  85% {
    opacity: 1;
  }
  100% {
    transform: translateY(108vh) rotate(340deg);
    opacity: 0.6;
  }
}

/* Defeat: slow dim red pixel rain, no tumbling — just a sad drizzle. */
.rain-bit {
  opacity: 0.4;
  animation-name: pp-rain-fall;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}
@keyframes pp-rain-fall {
  0% {
    transform: translateY(-4vh) scaleY(1.6);
  }
  100% {
    transform: translateY(108vh) scaleY(1.6);
  }
}

/* Defeat title: one short pixel-glitch shake. */
.title-shake {
  animation:
    pp-title-pop 0.45s ease-out both,
    pp-shake 0.4s steps(2) 0.45s 2;
}
@keyframes pp-shake {
  0%,
  100% {
    translate: 0 0;
  }
  25% {
    translate: -6px 0;
  }
  75% {
    translate: 6px 0;
  }
}

/* Trophy gently bobs up and down. */
.motif-win {
  animation: pp-trophy-bob 2.6s ease-in-out infinite;
}
@keyframes pp-trophy-bob {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-6px);
  }
}

/* Defeat arrow: slow, subtle sink. */
.motif-lose {
  animation: pp-arrow-sink 3.6s ease-in-out infinite;
}
@keyframes pp-arrow-sink {
  0%,
  100% {
    transform: translateY(0);
    opacity: 0.85;
  }
  50% {
    transform: translateY(4px);
    opacity: 1;
  }
}

/* One-shot pop on the title (celebratory nudge). */
.title-pop {
  animation: pp-title-pop 0.45s ease-out both;
}
@keyframes pp-title-pop {
  0% {
    transform: scale(0.82);
    opacity: 0;
  }
  70% {
    transform: scale(1.06);
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .confetti-bit,
  .rain-bit,
  .motif-win,
  .motif-lose,
  .title-pop,
  .title-shake {
    animation: none;
  }
}
</style>
