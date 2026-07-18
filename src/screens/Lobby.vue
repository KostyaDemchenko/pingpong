<script setup lang="ts">
import {ref, watch, onMounted} from 'vue'
import PixelButton from '@/components/PixelButton.vue'
import {useGameFlow} from '@/composables/useGameFlow'
import {useNetwork} from '@/net/useNetwork'

const flow = useGameFlow()
const net = useNetwork()
const copied = ref(false)

onMounted(() => net.connect(flow.state.roomCode))

// When the opponent connects, lock in host/guest role and enter the match.
watch(
  () => net.state.status,
  (s) => {
    if (s === 'connected') {
      flow.setHost(net.state.amHost)
      flow.go('game') // NOTE: keep the room alive — do NOT disconnect here
    }
  },
)

async function copyCode() {
  try {
    await navigator.clipboard.writeText(flow.state.roomCode)
    copied.value = true
    setTimeout(() => (copied.value = false), 1200)
  } catch {
    /* clipboard blocked — ignore */
  }
}

async function share() {
  const text = `Join my PIXEL PONG match — room code ${flow.state.roomCode}`
  try {
    if (navigator.share) await navigator.share({title: 'PIXEL PONG', text})
    else await copyCode()
  } catch {
    /* cancelled */
  }
}

function cancel() {
  net.disconnect()
  flow.reset()
}
</script>

<template>
  <div
    class="relative isolate h-full w-full flex flex-col items-center justify-center gap-8 sm:gap-10 px-6 py-8 overflow-y-auto"
  >

    <!-- Header -->
    <div class="flex flex-col items-center gap-3 sm:gap-4 text-center">
      <h1 class="font-display text-text-primary text-base sm:text-[28px] leading-[1.4] max-w-[300px] sm:max-w-none">
        WAITING FOR OPPONENT
      </h1>
      <p class="font-body text-text-secondary text-[11px] sm:text-sm">SEND THIS CODE TO YOUR FRIEND</p>
    </div>

    <!-- Room code panel (dominant region) -->
    <div
      class="w-full max-w-[420px] sm:w-auto sm:max-w-none flex flex-col items-center gap-4 sm:gap-6 p-5 sm:p-10 bg-bg-surface border-[3px] border-brand pixel-shadow-brand"
    >
      <span class="font-body text-text-muted text-[11px] sm:text-xs">ROOM CODE</span>
      <div class="w-full sm:w-auto flex justify-center bg-bg-base border-2 border-border-strong px-4 py-3.5 sm:px-8 sm:py-5">
        <span class="font-display text-brand text-2xl sm:text-[40px] leading-none">{{ flow.state.roomCode }}</span>
      </div>
      <div class="w-full sm:w-auto flex gap-3 sm:gap-4">
        <PixelButton variant="primary" class="flex-1 sm:flex-none" @click="copyCode">
          {{ copied ? 'COPIED!' : 'COPY' }}
        </PixelButton>
        <PixelButton variant="secondary" class="flex-1 sm:flex-none" @click="share">SHARE</PixelButton>
      </div>
    </div>

    <!-- Player slots -->
    <div
      class="w-full max-w-[420px] sm:max-w-none flex flex-col sm:flex-row items-stretch sm:items-center sm:justify-center gap-3 sm:gap-6"
    >
      <!-- Player 1 (you) -->
      <div
        class="flex items-center gap-4 sm:gap-5 w-full sm:w-[400px] p-4 sm:p-6 bg-bg-surface border-2 border-border-strong"
      >
        <div
          class="shrink-0 grid place-items-center h-11 w-11 sm:h-14 sm:w-14 bg-brand-deep border-2 border-brand"
        >
          <span class="block h-[18px] w-[18px] sm:h-6 sm:w-6 bg-brand"></span>
        </div>
        <div class="flex flex-col gap-2 sm:gap-2.5 min-w-0">
          <span class="font-display text-text-primary text-xs sm:text-sm truncate">{{ flow.state.myName }}</span>
          <span
            class="self-start px-2.5 py-1 sm:px-3 sm:py-1.5 bg-brand-deep border-2 border-brand font-body text-brand text-[11px] sm:text-xs leading-none"
          >
            READY
          </span>
        </div>
      </div>

      <span class="hidden sm:block font-display text-text-muted text-xl">VS</span>

      <!-- Player 2 (opponent) -->
      <div
        class="flex items-center gap-4 sm:gap-5 w-full sm:w-[400px] p-4 sm:p-6 bg-bg-base border-[3px]"
        :class="net.state.status === 'connected' ? 'border-brand' : 'border-border-strong'"
      >
        <template v-if="net.state.status === 'connected'">
          <div
            class="shrink-0 grid place-items-center h-11 w-11 sm:h-14 sm:w-14 bg-brand-deep border-2 border-brand"
          >
            <span class="block h-[18px] w-[18px] sm:h-6 sm:w-6 bg-brand"></span>
          </div>
          <div class="flex flex-col gap-2 sm:gap-2.5 min-w-0">
            <span class="font-display text-text-primary text-xs sm:text-sm truncate">{{ flow.state.oppName }}</span>
            <span
              class="self-start px-2.5 py-1 sm:px-3 sm:py-1.5 bg-brand-deep border-2 border-brand font-body text-brand text-[11px] sm:text-xs leading-none"
            >
              JOINED
            </span>
          </div>
        </template>
        <template v-else>
          <div
            class="shrink-0 grid place-items-center h-11 w-11 sm:h-14 sm:w-14 bg-bg-elevated border-2 border-border-strong"
          >
            <span class="font-display text-text-muted text-sm sm:text-base leading-none">?</span>
          </div>
          <div class="flex flex-col gap-2.5 sm:gap-3 min-w-0">
            <span
              class="font-display text-xs sm:text-sm break-words leading-[1.4]"
              :class="net.state.status === 'error' ? 'text-danger' : 'text-text-secondary'"
            >
              {{
                net.state.status === 'connecting'
                  ? 'CONNECTING…'
                  : net.state.status === 'error'
                    ? net.state.error || 'CONNECTION ERROR'
                    : 'WAITING…'
              }}
            </span>
            <div v-if="net.state.status !== 'error'" class="flex gap-1.5 sm:gap-2">
              <span class="wait-dot h-3 w-3 sm:h-3.5 sm:w-3.5"></span>
              <span class="wait-dot h-3 w-3 sm:h-3.5 sm:w-3.5" style="animation-delay: 0.35s"></span>
              <span class="wait-dot h-3 w-3 sm:h-3.5 sm:w-3.5" style="animation-delay: 0.7s"></span>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Cancel -->
    <PixelButton variant="secondary" class="w-full max-w-[420px] sm:w-auto sm:max-w-none" @click="cancel">
      CANCEL
    </PixelButton>
  </div>
</template>

<style scoped>
/* Chasing pixel squares: one green square walks left-to-right, hard steps. */
.wait-dot {
  background: var(--color-border);
  animation: pp-wait 1.05s steps(1, end) infinite;
}
@keyframes pp-wait {
  0% {
    background: var(--color-brand);
  }
  33.4%,
  100% {
    background: var(--color-border);
  }
}
@media (prefers-reduced-motion: reduce) {
  .wait-dot {
    animation: none;
  }
  .wait-dot:first-child {
    background: var(--color-brand);
  }
}
</style>
