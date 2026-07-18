<script setup lang="ts">
/**
 * Decorative background layer — two large, faded pixel figures that flank the
 * menu card, ported from the Pencil main-menu design (nodes "Deco Ball Left"
 * and "Deco Paddle Right"):
 *   • a GREEN pixel BALL (stepped/rounded pixel circle) on the lower-left
 *   • a RED PADDLE (tall rectangle, tilted) on the upper-right
 * Purely cosmetic: sits behind content (-z-10), ignores pointer events, and
 * respects prefers-reduced-motion (see .sway/.drift in style.css, which the
 * reduced-motion media query disables).
 */
</script>

<template>
  <div class="pointer-events-none absolute inset-0 -z-10 overflow-hidden select-none" aria-hidden="true">
    <!-- Green pixel BALL — flanks the lower-left, gently floats. Rounded 5×5
         pixel grid so it reads as a chunky pixel-art circle; crispEdges keeps
         it sharp / anti-alias free. -->
    <svg
      class="drift text-brand absolute left-[4%] top-[54%] h-28 w-28 opacity-[0.12] sm:h-36 sm:w-36"
      viewBox="0 0 5 5"
      fill="currentColor"
      shape-rendering="crispEdges"
    >
      <rect x="1" y="0" width="3" height="1" />
      <rect x="0" y="1" width="5" height="1" />
      <rect x="0" y="2" width="5" height="1" />
      <rect x="0" y="3" width="5" height="1" />
      <rect x="1" y="4" width="3" height="1" />
    </svg>

    <!-- Red PADDLE — flanks the upper-right, tilted and swaying. -->
    <span
      class="sway bg-danger border-pixel-black absolute right-[5%] top-[13%] block h-40 w-20 border-[3px] opacity-[0.12] sm:h-52 sm:w-24"
      style="--pp-rot: -15deg"
    ></span>
  </div>
</template>
