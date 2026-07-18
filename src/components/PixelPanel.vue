<script setup lang="ts">
/** PixelPanel — surface card with inner border + hard pixel shadow. */
withDefaults(defineProps<{elevated?: boolean}>(), {elevated: false})
</script>

<template>
  <div
    :class="[
      'border-2 border-border-strong pixel-shadow-lg p-md',
      elevated ? 'bg-bg-elevated' : 'bg-bg-surface',
    ]"
  >
    <slot />
  </div>
</template>
