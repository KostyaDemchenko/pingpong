<script setup lang="ts">
/**
 * PixelButton — code port of the reusable Pencil `PixelButton` component.
 * Pixel-art: sharp corners, inner black border, hard (blur-less) offset shadow.
 */
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'danger'
    disabled?: boolean
    block?: boolean
  }>(),
  {variant: 'primary', disabled: false, block: false},
)

defineEmits<{click: [MouseEvent]}>()

const variants: Record<string, string> = {
  primary: 'bg-brand text-pixel-black pixel-shadow-brand hover:bg-brand-hover',
  secondary: 'bg-bg-elevated text-text-primary border-border-strong pixel-shadow hover:bg-border',
  danger: 'bg-bg-elevated text-danger border-danger pixel-shadow hover:bg-danger/10',
}
</script>

<template>
  <button
    type="button"
    :disabled="disabled"
    :class="[
      'inline-flex items-center justify-center gap-2 px-md py-3',
      'border-[3px] border-pixel-black font-display text-[12px] leading-none uppercase',
      'transition-[transform,background-color] duration-75 select-none',
      'active:translate-x-[2px] active:translate-y-[2px] active:shadow-none',
      'disabled:opacity-40 disabled:pointer-events-none',
      variant === 'secondary' || variant === 'danger' ? 'border-[2px]' : '',
      variants[variant],
      block ? 'w-full' : '',
    ]"
    @click="$emit('click', $event)"
  >
    <slot />
  </button>
</template>
