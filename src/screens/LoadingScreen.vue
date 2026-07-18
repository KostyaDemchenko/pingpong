<script setup lang="ts">
import Wordmark from '@/components/Wordmark.vue'

// Static progress for the scaffold; wire to real connect/asset progress later.
const filled = 13
const total = 20
</script>

<template>
  <div class="relative isolate h-full w-full flex flex-col items-center justify-center gap-xl px-8">
    <div class="flex flex-col items-center gap-sm">
      <Wordmark size="md" />
      <p class="font-body text-text-secondary text-xs">CONNECTING TO MATCH…</p>
    </div>

    <div class="w-full max-w-[340px] flex flex-col gap-sm">
      <div class="flex gap-1 bg-bg-elevated border-2 border-border-strong p-1 pixel-shadow">
        <span
          v-for="i in total"
          :key="i"
          class="flex-1 h-4"
          :class="i <= filled ? 'bg-brand' : 'bg-border'"
        ></span>
      </div>
      <div class="flex items-center justify-between">
        <span class="font-body text-text-secondary text-[13px]">LOADING…</span>
        <span class="font-display text-brand text-base">{{ Math.round((filled / total) * 100) }}%</span>
      </div>
    </div>

    <p class="font-body text-text-muted text-xs text-center">TIP: A SHORT SERVE IS HARDER TO ATTACK</p>
  </div>
</template>
