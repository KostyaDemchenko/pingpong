<script setup lang="ts">
/**
 * Pre-match coin flip overlay. One side of the pixel coin is YOU (green),
 * the other is the OPPONENT (red) — whoever lands up serves first.
 *
 * Modes:
 *  - decided-locally (practice / P2P host): `result` prop is set at mount; the
 *    coin spins with an easing-out cadence and lands on the result.
 *  - follower (P2P guest): `result` starts null; the coin keeps spinning until
 *    the parent updates `result` from the host's snapshots, then lands.
 * When the reveal finishes, emits 'done' — the parent starts the match.
 */
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue'

const props = defineProps<{
  myName: string
  oppName: string
  /** 0|1 = engine player id of the coin winner; null = still unknown (guest) */
  result: 0 | 1 | null
  /** which engine player id is ME (0 = host, 1 = guest) */
  mySide: 0 | 1
}>()
const emit = defineEmits<{done: []}>()

/** face currently showing: true = my green face, false = opponent's red */
const faceMine = ref(true)
const landed = ref(false)
const squash = ref(false)
const winnerIsMe = computed(() => props.result !== null && props.result === props.mySide)
const winnerName = computed(() => (winnerIsMe.value ? props.myName : props.oppName))

const MIN_SPIN_MS = 1900
let timer = 0
let spinStart = 0
let interval = 90

function scheduleFlip(): void {
  timer = window.setTimeout(() => {
    squash.value = !squash.value // mid-flip squash frame
    if (squash.value) {
      faceMine.value = !faceMine.value
      scheduleFlip()
      return
    }
    const elapsed = performance.now() - spinStart
    const canLand = elapsed >= MIN_SPIN_MS && props.result !== null
    if (canLand && faceMine.value === winnerIsMe.value) {
      landed.value = true
      timer = window.setTimeout(() => emit('done'), 1300)
      return
    }
    // ease out only once the result is known & minimum spin served
    if (elapsed >= MIN_SPIN_MS && props.result !== null) interval = Math.min(interval + 55, 320)
    scheduleFlip()
  }, interval)
}

onMounted(() => {
  spinStart = performance.now()
  scheduleFlip()
})
watch(
  () => props.result,
  () => {
    /* result arriving mid-spin is picked up by the next scheduled flip */
  },
)
onBeforeUnmount(() => window.clearTimeout(timer))
</script>

<template>
  <div class="absolute inset-0 z-20 grid place-items-center bg-pixel-black/70">
    <div class="flex flex-col items-center gap-6">
      <span class="font-body text-text-secondary text-xs tracking-widest">
        {{ landed ? 'FIRST SERVE' : 'COIN FLIP…' }}
      </span>

      <!-- the coin: pixel disc, squashes horizontally mid-flip -->
      <div
        class="coin grid place-items-center border-4 border-pixel-black"
        :class="[
          faceMine ? 'bg-brand' : 'bg-danger',
          squash && !landed ? 'coin-squash' : '',
          landed ? 'coin-land' : '',
        ]"
      >
        <span class="font-display text-pixel-black text-2xl select-none">
          {{ faceMine ? 'P1' : 'P2' }}
        </span>
      </div>

      <div class="h-10 flex flex-col items-center gap-2">
        <template v-if="landed">
          <span
            class="font-display text-sm"
            :class="winnerIsMe ? 'text-brand' : 'text-danger'"
          >
            {{ winnerName }}
          </span>
          <span class="font-body text-text-secondary text-[11px]">SERVES FIRST</span>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.coin {
  width: 96px;
  height: 96px;
  box-shadow: 6px 6px 0 0 var(--color-pixel-black);
  transition: transform 0.09s steps(2);
  animation: coin-hop 0.5s ease-in-out infinite;
}
.coin-squash {
  transform: scaleX(0.12);
}
.coin-land {
  animation: coin-slam 0.35s ease-out both;
}
@keyframes coin-hop {
  0%,
  100% {
    translate: 0 0;
  }
  50% {
    translate: 0 -14px;
  }
}
@keyframes coin-slam {
  0% {
    scale: 1.35;
  }
  60% {
    scale: 0.94;
  }
  100% {
    scale: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .coin {
    animation: none;
  }
}
</style>
