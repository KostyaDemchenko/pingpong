<script setup lang="ts">
import {onMounted, onBeforeUnmount, ref, watch} from 'vue'
import Wordmark from '@/components/Wordmark.vue'
import PixelButton from '@/components/PixelButton.vue'
import {useGameFlow} from '@/composables/useGameFlow'
import {useNetwork} from '@/net/useNetwork'
import {startQuickMatch, type QuickMatchHandle} from '@/net/quickMatch'

const flow = useGameFlow()
const net = useNetwork()
const players = ref(1)

let handle: QuickMatchHandle | null = null
let poll = 0
let disposed = false

onMounted(async () => {
  // async: waits out a pending pool leave from a PREVIOUS quick match first
  const h = await startQuickMatch((code) => {
    // paired → migrate into our private room and wait for the opponent to arrive
    flow.setRoomCode(code)
    net.connect(code)
  })
  if (disposed) {
    h.cancel()
    return
  }
  handle = h
  poll = window.setInterval(() => {
    if (handle) players.value = handle.poolSize()
  }, 1000)
})

// once the private room is up and the opponent connects → drop into the match
watch(
  () => net.state.status,
  (s) => {
    if (s === 'connected') {
      flow.setHost(net.state.amHost)
      flow.go('game')
    }
  },
)

function stopPolling() {
  if (poll) {
    clearInterval(poll)
    poll = 0
  }
}

function cancel() {
  stopPolling()
  handle?.cancel()
  handle = null
  net.disconnect()
  flow.reset()
}

onBeforeUnmount(() => {
  disposed = true
  stopPolling()
  handle?.cancel() // no-op once matched; frees the pool if we left early
})
</script>

<template>
  <div class="relative isolate h-full w-full flex flex-col items-center justify-center gap-xl px-8">

    <div class="flex flex-col items-center gap-sm">
      <Wordmark size="md" />
      <p class="font-body text-text-secondary text-xs">QUICK MATCH</p>
    </div>

    <!-- searching indicator: bouncing ball + pulsing dots -->
    <div class="flex flex-col items-center gap-md">
      <span class="bob block h-5 w-5 bg-brand border-2 border-pixel-black"></span>
      <div class="flex items-center gap-2">
        <span class="font-body text-text-primary text-sm">SEARCHING FOR OPPONENT</span>
        <span class="flex gap-1">
          <span class="wait-dot h-1.5 w-1.5"></span>
          <span class="wait-dot h-1.5 w-1.5" style="animation-delay: 0.35s"></span>
          <span class="wait-dot h-1.5 w-1.5" style="animation-delay: 0.7s"></span>
        </span>
      </div>
    </div>

    <p class="font-body text-text-muted text-[11px]">
      <span class="text-brand">{{ players }}</span> IN THE QUICK-PLAY POOL
    </p>

    <PixelButton variant="danger" @click="cancel">CANCEL</PixelButton>
  </div>
</template>

<style scoped>
/* Chasing pixel squares (same loader as the lobby's waiting slot). */
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
