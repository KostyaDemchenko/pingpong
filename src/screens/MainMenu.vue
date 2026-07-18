<script setup lang="ts">
import {onBeforeUnmount, onMounted, ref} from 'vue'
import Wordmark from '@/components/Wordmark.vue'
import PixelButton from '@/components/PixelButton.vue'
import PixelPanel from '@/components/PixelPanel.vue'
import {useGameFlow} from '@/composables/useGameFlow'
import {startPresence} from '@/net/presence'

const flow = useGameFlow()
const code = ref('')

// real online counter (people currently on the menu, incl. us)
const online = ref(0)
let stopPresence: (() => void) | null = null
onMounted(() => {
  stopPresence = startPresence((n) => (online.value = n))
})
onBeforeUnmount(() => stopPresence?.())

function onJoin() {
  const c = code.value.trim()
  if (c.length < 4) return
  flow.joinRoom(c)
}
</script>

<template>
  <!-- Scroll container so the menu stays centered when it fits and scrolls when
       the viewport is short (small phones / landscape). -->
  <div class="relative isolate h-full w-full overflow-y-auto">

    <div
      class="relative min-h-full flex flex-col items-center justify-center gap-lg px-6 py-10"
    >
      <!-- Logo block — gentle idle float on the whole logo -->
      <div class="drift flex flex-col items-center gap-sm" style="animation-duration: 5s">
        <Wordmark size="lg" />
        <p class="font-body text-text-secondary text-sm tracking-wide">
          PLAY TABLE TENNIS WITH A FRIEND
        </p>
      </div>

      <!-- Menu card -->
      <PixelPanel class="w-full max-w-[420px] flex flex-col gap-lg">
        <!-- Primary actions -->
        <div class="flex flex-col items-center gap-sm">
          <PixelButton block @click="flow.quickPlay()">QUICK GAME</PixelButton>
          <PixelButton variant="secondary" block @click="flow.hostRoom()">CREATE ROOM</PixelButton>
          <p class="font-body text-text-muted text-xs text-center leading-relaxed">
            QUICK GAME FINDS YOU A PLAYER · CREATE ROOM MAKES A PRIVATE CODE
          </p>
        </div>

        <!-- Divider -->
        <div class="flex items-center gap-md">
          <span class="h-0.5 flex-1 bg-border"></span>
          <span class="font-body text-text-muted text-xs">OR</span>
          <span class="h-0.5 flex-1 bg-border"></span>
        </div>

        <!-- Join by code — field + button side-by-side on desktop, stacked on mobile -->
        <div class="flex flex-col gap-sm">
          <label class="font-body text-text-secondary text-xs">JOIN A ROOM</label>
          <div class="flex flex-col sm:flex-row gap-sm">
            <input
              v-model="code"
              maxlength="9"
              placeholder="ENTER ROOM CODE"
              class="min-w-0 flex-1 bg-bg-elevated border-2 border-border-strong px-3 py-2.5 font-body text-text-primary text-lg tracking-[2px] placeholder:text-text-muted uppercase outline-none focus:border-brand"
              @keyup.enter="onJoin"
            />
            <PixelButton variant="secondary" :disabled="code.trim().length < 4" @click="onJoin">
              JOIN
            </PixelButton>
          </div>
        </div>
      </PixelPanel>

      <!-- Practice link -->
      <button
        class="font-body text-text-muted text-xs underline underline-offset-4 hover:text-text-secondary"
        @click="flow.practice()"
      >
        OR PRACTICE VS AI
      </button>

      <!-- Footer — REAL online count (peers in the presence room) -->
      <div class="flex flex-wrap items-center justify-center gap-x-md gap-y-1">
        <div v-if="online > 0" class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 bg-brand"></span>
          <span class="font-body text-text-secondary text-xs">{{ online }} ONLINE</span>
        </div>
        <span v-if="online > 0" class="font-body text-text-muted text-xs hidden sm:inline">·</span>
        <span class="font-body text-text-muted text-xs">FIRST TO 11 POINTS WINS</span>
      </div>
    </div>
  </div>
</template>
