<script setup lang="ts">
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { nextTick, onMounted, ref } from 'vue'

import sweetKittyMeow from '@/assets/sounds/original/drop-cute.wav'
import { useTauriListen } from '@/composables/useTauriListen'
import { LISTEN_KEY } from '@/constants'

const appWindow = getCurrentWebviewWindow()
const flashing = ref(false)
let hideTimer: number | undefined

function playCuteMeow() {
  try {
    const audio = new Audio(sweetKittyMeow)
    audio.volume = 0.55
    void audio.play()
  } catch { /* Sound may be blocked by a Windows audio policy. */ }
}

async function alert(event: { payload: { playSound?: boolean } }) {
  window.clearTimeout(hideTimer)
  flashing.value = false
  await appWindow.show()
  await appWindow.setAlwaysOnTop(true)
  await nextTick()
  requestAnimationFrame(() => {
    flashing.value = true
  })
  if (event.payload?.playSound !== false) playCuteMeow()
  hideTimer = window.setTimeout(() => {
    flashing.value = false
  }, 1450)
}

useTauriListen(LISTEN_KEY.MESSAGE_ALERT, alert)
onMounted(async () => {
  await appWindow.setIgnoreCursorEvents(true)
  await appWindow.setAlwaysOnTop(true)
  await appWindow.show()
})
</script>

<template>
  <main :class="{ flashing }" />
</template>

<style scoped>
:global(html),
:global(body),
:global(#app) {
  width: 100%;
  height: 100%;
  margin: 0;
  background: transparent !important;
  overflow: hidden;
}
main {
  position: fixed;
  inset: 0;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  border: 0 solid transparent;
  pointer-events: none;
}
main.flashing {
  animation: pink-screen-border 1.25s cubic-bezier(0.2, 0.85, 0.25, 1) both;
}
@keyframes pink-screen-border {
  0%,
  22%,
  48%,
  72%,
  100% {
    border-width: 0;
    box-shadow: inset 0 0 0 0 transparent;
  }
  8%,
  58% {
    border-width: 14px;
    border-color: #ff2f92;
    box-shadow:
      inset 0 0 18px 5px #ff2f92e6,
      inset 0 0 48px 12px #ff78b3b8;
  }
}
</style>
