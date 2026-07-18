<script setup lang="ts">
/** PIXEL PONG wordmark + paddle-ball-paddle motif, ported from the Pencil logo. */
withDefaults(defineProps<{size?: 'sm' | 'md' | 'lg'}>(), {size: 'lg'})

const titleSize: Record<string, string> = {
  sm: 'text-[20px]',
  md: 'text-[28px]',
  lg: 'text-[40px]',
}
</script>

<template>
  <div class="flex flex-col items-center gap-sm select-none">
    <!-- motif: green paddle · ball · red paddle -->
    <div class="flex items-center gap-2.5">
      <span class="block w-3.5 h-8 bg-brand border-2 border-pixel-black"></span>
      <span class="block w-3 h-3 bg-text-primary border-2 border-pixel-black"></span>
      <span class="block w-3.5 h-8 bg-danger border-2 border-pixel-black"></span>
    </div>
    <div class="flex flex-col items-center gap-0.5">
      <span
        :class="titleSize[size]"
        class="font-display text-brand leading-none"
        style="text-shadow: 4px 4px 0 var(--color-brand-shadow)"
        >PIXEL</span
      >
      <span
        :class="titleSize[size]"
        class="font-display text-brand leading-none"
        style="text-shadow: 4px 4px 0 var(--color-pixel-black)"
        >PONG</span
      >
    </div>
  </div>
</template>
