<script setup lang="ts">
import {computed} from 'vue'
import {useGameFlow} from '@/composables/useGameFlow'
import PixelDecor from '@/components/PixelDecor.vue'
import MainMenu from '@/screens/MainMenu.vue'
import LoadingScreen from '@/screens/LoadingScreen.vue'
import QuickMatch from '@/screens/QuickMatch.vue'
import Lobby from '@/screens/Lobby.vue'
import GameScreen from '@/screens/GameScreen.vue'
import ResultScreen from '@/screens/ResultScreen.vue'

const flow = useGameFlow()

const screens = {
  menu: MainMenu,
  loading: LoadingScreen,
  searching: QuickMatch,
  lobby: Lobby,
  game: GameScreen,
  result: ResultScreen,
}
const current = computed(() => screens[flow.state.screen])
</script>

<template>
  <main class="relative isolate h-full w-full bg-bg-base text-text-primary overflow-hidden">
    <!-- Decor lives HERE (not inside screens) so it never remounts on screen
         changes — screens with an opaque bg (game/result) simply cover it. -->
    <PixelDecor />
    <!-- CRT power-off/on: the leaving screen collapses to a bright line (top +
         bottom inward), then the entering one expands from the line. Both are
         absolutely stacked; the enter animation is DELAYED past the leave via
         CSS, NOT via mode="out-in" — out-in has a known blank-gap failure here
         (see git history), so never reintroduce it. -->
    <!-- explicit duration => Vue clears transition classes on a timer, so a
         hidden/throttled tab can never leave the app stuck mid-transition -->
    <Transition name="screen" :duration="{leave: 240, enter: 620}">
      <component :is="current" :key="flow.state.screen" class="screen-layer" />
    </Transition>
  </main>
</template>
