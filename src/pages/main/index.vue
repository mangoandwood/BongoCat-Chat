<script setup lang="ts">
import type { MotionInfo } from 'easy-live2d'

import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi'
import { emitTo } from '@tauri-apps/api/event'
import { Menu, PredefinedMenuItem } from '@tauri-apps/api/menu'
import { sep } from '@tauri-apps/api/path'
import { getCurrentWebviewWindow, WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { enable as enableAutostart, isEnabled as isAutostartEnabled } from '@tauri-apps/plugin-autostart'
import { exists, readDir } from '@tauri-apps/plugin-fs'
import { useDebounceFn, useEventListener } from '@vueuse/core'
import { round } from 'es-toolkit'
import { nth } from 'es-toolkit/compat'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { useAppMenu } from '@/composables/useAppMenu'
import { useChatSync } from '@/composables/useChatSync'
import { useModel } from '@/composables/useModel'
import { useTauriListen } from '@/composables/useTauriListen'
import { INVOKE_KEY, LISTEN_KEY, WINDOW_LABEL } from '@/constants'
import { hideWindow, setAlwaysOnTop, setTaskbarVisibility, showWindow } from '@/plugins/window'
import { useCatStore } from '@/stores/cat'
import { useGeneralStore } from '@/stores/general.ts'
import { useModelStore } from '@/stores/model'
import { getChatSoundUrl } from '@/utils/chatSounds'
import { isImage } from '@/utils/is'
import live2d from '@/utils/live2d'
import { join } from '@/utils/path'
import { isWindows } from '@/utils/platform'
import { clearObject } from '@/utils/shared'

const appWindow = getCurrentWebviewWindow()
const { modelSize, handleLoad, handleDestroy, handleResize, handleKeyChange, handlePress, handleRelease, handleMouseChange, handleMouseMove: handleRemoteMouseMove } = useModel()
const catStore = useCatStore()
const { getBaseMenu, getExitMenu } = useAppMenu()
const modelStore = useModelStore()
const generalStore = useGeneralStore()
const resizing = ref(false)
const backgroundImagePath = ref<string>()
const composerOpen = ref(false)
const recordingVoice = ref(false)
let voiceRecorder: MediaRecorder | undefined
let voiceStream: MediaStream | undefined
let voiceChunks: Blob[] = []
let voiceStopTimer: number | undefined
let voiceStarting = false
let voiceStopRequested = false
const localAway = ref(false)
let awayInputSuppressedUntil = 0
async function toggleIndependentComposer() {
  const composer = await WebviewWindow.getByLabel(WINDOW_LABEL.COMPOSER)
  if (!composer) return
  if (composerOpen.value) {
    composerOpen.value = false
    await composer.hide()
    await invoke('restore_foreground_window')
  } else {
    await invoke('remember_foreground_window')
    composerOpen.value = true
    await composer.show()
    await composer.setAlwaysOnTop(true)
    await composer.setFocus()
    await emitTo(WINDOW_LABEL.COMPOSER, LISTEN_KEY.COMPOSER_FOCUS)
  }
}
const chat = useChatSync({
  captureDevice: true,
  onMessage: (message) => {
    void emitTo(WINDOW_LABEL.BUBBLE, LISTEN_KEY.BUBBLE_MESSAGE, message)
  },
  onFile: (message) => {
    void emitTo(WINDOW_LABEL.BUBBLE, LISTEN_KEY.BUBBLE_FILE, message)
    if (message.senderId !== localStorage.getItem('bongocat-chat-client-id')) triggerMessageAlert()
  },
  onConnection: (connected) => {
    void emitTo(WINDOW_LABEL.BUBBLE, LISTEN_KEY.BUBBLE_CONNECTION, connected)
  },
  onLocalKey: handleLocalKeyPresence,
})

function publishPresence(away: boolean, signText = '暂离') {
  if (localAway.value === away) return
  localAway.value = away
  chat.sendPresence(away, signText)
  chat.draft.value = away ? '我已暂离 💤' : '我回来啦～'
  chat.sendMessage()
}

async function openAwayEditor() {
  const composer = await WebviewWindow.getByLabel(WINDOW_LABEL.COMPOSER)
  if (!composer) return
  composerOpen.value = true
  await composer.show()
  await composer.setAlwaysOnTop(true)
  await composer.setFocus()
  await emitTo(WINDOW_LABEL.COMPOSER, LISTEN_KEY.AWAY_EDITOR_OPEN, '暂离')
}

function handleLocalKeyPresence() {
  if (localAway.value && Date.now() > awayInputSuppressedUntil) publishPresence(false)
}

async function blobToDataUrl(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

async function startVoiceRecording() {
  if (recordingVoice.value || voiceStarting) return
  voiceStarting = true
  voiceStopRequested = false
  try {
    voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    voiceChunks = []
    voiceRecorder = new MediaRecorder(voiceStream)
    voiceRecorder.ondataavailable = (event) => {
      if (event.data.size) voiceChunks.push(event.data)
    }
    voiceRecorder.onstop = async () => {
      recordingVoice.value = false
      voiceStream?.getTracks().forEach(track => track.stop())
      const blob = new Blob(voiceChunks, { type: voiceRecorder?.mimeType || 'audio/webm' })
      voiceChunks = []
      if (!blob.size || blob.size > 5 * 1024 * 1024) return
      chat.sendFileMessage({
        id: crypto.randomUUID(),
        type: 'file',
        room: chat.settings.value.room.trim(),
        senderId: chat.clientId,
        senderName: chat.settings.value.nickname.trim(),
        name: `语音-${new Date().toLocaleTimeString('zh-CN', { hour12: false }).replaceAll(':', '-')}.webm`,
        mime: blob.type || 'audio/webm',
        data: await blobToDataUrl(blob),
        sentAt: Date.now(),
      })
    }
    voiceRecorder.start()
    recordingVoice.value = true
    voiceStarting = false
    if (voiceStopRequested) {
      voiceRecorder.stop()
      return
    }
    voiceStopTimer = window.setTimeout(() => {
      if (voiceRecorder?.state === 'recording') voiceRecorder.stop()
    }, 60_000)
  } catch {
    voiceStarting = false
    recordingVoice.value = false
    voiceStream?.getTracks().forEach(track => track.stop())
  }
}

function stopVoiceRecording() {
  voiceStopRequested = true
  window.clearTimeout(voiceStopTimer)
  if (voiceRecorder?.state === 'recording') voiceRecorder.stop()
}
const pinkMessageFlash = ref(false)
let pinkMessageTimer: number | undefined
function playRemoteJellyKey() {
  if (!chat.settings.value.keySoundEnabled) return
  try {
    const audio = new Audio(getChatSoundUrl(chat.settings.value.keySoundChoice, 'original-boop-soft'))
    audio.volume = Math.max(0, Math.min(1, chat.settings.value.keySoundVolume / 100))
    void audio.play()
  } catch { /* Windows may temporarily have no audio output. */ }
}
function playMessageSound() {
  if (!chat.settings.value.messageSoundEnabled) return
  try {
    const audio = new Audio(getChatSoundUrl(chat.settings.value.messageSoundChoice, 'original-drop-cute'))
    audio.volume = Math.max(0, Math.min(1, chat.settings.value.messageSoundVolume / 100))
    void audio.play()
  } catch { /* Windows may temporarily have no audio output. */ }
}
async function showGlobalMessageAlert() {
  const monitor = await appWindow.currentMonitor()
  const originX = monitor?.position.x ?? 0
  const originY = monitor?.position.y ?? 0
  const width = monitor?.size.width ?? screen.width
  const height = monitor?.size.height ?? screen.height
  const thickness = Math.max(16, Math.round(Math.min(width, height) * 0.014))
  const definitions = [
    { label: 'notify-top', x: originX, y: originY, width, height: thickness },
    { label: 'notify-bottom', x: originX, y: originY + height - thickness, width, height: thickness },
    { label: 'notify-left', x: originX, y: originY + thickness, width: thickness, height: height - thickness * 2 },
    { label: 'notify-right', x: originX + width - thickness, y: originY + thickness, width: thickness, height: height - thickness * 2 },
  ]
  const edges = (await Promise.all(definitions.map(async (definition) => {
    const window = await WebviewWindow.getByLabel(definition.label)
    if (!window) return undefined
    await window.setPosition(new PhysicalPosition(definition.x, definition.y))
    await window.setSize(new PhysicalSize(definition.width, definition.height))
    await window.setIgnoreCursorEvents(true)
    await window.setAlwaysOnTop(true)
    return window
  }))).filter(Boolean) as WebviewWindow[]
  const showEdges = () => void Promise.all(edges.map(window => window.show()))
  const hideEdges = () => void Promise.all(edges.map(window => window.hide()))
  showEdges()
  window.setTimeout(hideEdges, 210)
  window.setTimeout(showEdges, 360)
  window.setTimeout(hideEdges, 650)
}
function triggerMessageAlert() {
  playMessageSound()
  pinkMessageFlash.value = false
  window.clearTimeout(pinkMessageTimer)
  requestAnimationFrame(() => {
    pinkMessageFlash.value = true
    pinkMessageTimer = window.setTimeout(() => {
      pinkMessageFlash.value = false
    }, 650)
  })
  void showGlobalMessageAlert()
}
const bubbleDragging = ref(false)
const bubbleResizing = ref(false)
let dragStartX = 0
let dragStartY = 0
let bubbleStartX = 0
let bubbleStartY = 0
let resizeStartWidth = 0
let resizeStartHeight = 0

const bubbleVisualScale = computed(() => {
  const ownScale = chat.settings.value.bubbleScale / 100
  const catScale = chat.settings.value.bubbleFollowCat ? catStore.window.scale / 100 : 1
  return ownScale * catScale
})

const bubblePositionStyle = computed(() => ({
  left: `${chat.settings.value.bubbleX}px`,
  top: `${chat.settings.value.bubbleY}px`,
  transform: `scale(${bubbleVisualScale.value})`,
  transformOrigin: 'top left',
  width: `${chat.settings.value.bubbleWidth}px`,
  height: `${chat.settings.value.bubbleHeight}px`,
}))

function beginBubbleDrag(event: PointerEvent) {
  if (chat.settings.value.bubbleLocked) return
  event.preventDefault()
  bubbleDragging.value = true
  dragStartX = event.clientX
  dragStartY = event.clientY
  bubbleStartX = chat.settings.value.bubbleX
  bubbleStartY = chat.settings.value.bubbleY
}

useEventListener(window, 'pointermove', (event) => {
  if (bubbleResizing.value) {
    chat.settings.value.bubbleWidth = Math.max(180, resizeStartWidth + event.clientX - dragStartX)
    chat.settings.value.bubbleHeight = Math.max(220, resizeStartHeight + event.clientY - dragStartY)
    return
  }
  if (!bubbleDragging.value) return
  chat.settings.value.bubbleX = Math.max(0, Math.min(innerWidth - 80, bubbleStartX + event.clientX - dragStartX))
  chat.settings.value.bubbleY = Math.max(0, Math.min(innerHeight - 80, bubbleStartY + event.clientY - dragStartY))
})

useEventListener(window, 'pointerup', () => {
  if (!bubbleDragging.value && !bubbleResizing.value) return
  bubbleDragging.value = false
  bubbleResizing.value = false
  chat.saveSettings()
})

function beginBubbleResize(event: PointerEvent) {
  if (chat.settings.value.bubbleLocked) return
  event.preventDefault()
  event.stopPropagation()
  bubbleResizing.value = true
  dragStartX = event.clientX
  dragStartY = event.clientY
  resizeStartWidth = chat.settings.value.bubbleWidth
  resizeStartHeight = chat.settings.value.bubbleHeight
}

useEventListener(window, 'blur', () => {
  if (chat.composerVisible.value) chat.closeComposer(false)
})

useEventListener(document, 'pointerdown', (event) => {
  if (!chat.composerVisible.value) return
  const target = event.target as HTMLElement
  if (target.closest('.quick-composer, .bubble-stack')) return
  chat.closeComposer(false)
})

onMounted(async () => {
  // Listen locally only for network transmission. The visible model is driven
  // exclusively by the other participant's relayed events.
  invoke(INVOKE_KEY.START_DEVICE_LISTENING)
  if (!await isAutostartEnabled()) await enableAutostart()
})

onUnmounted(() => {
  window.clearTimeout(voiceStopTimer)
  voiceStream?.getTracks().forEach(track => track.stop())
  handleDestroy()
})

const debouncedResize = useDebounceFn(async () => {
  await handleResize()

  resizing.value = false
}, 100)

useEventListener('resize', () => {
  resizing.value = true

  debouncedResize()
})

watch(() => modelStore.currentModel, async (model) => {
  if (!model) return

  await handleLoad()

  const path = join(model.path, 'resources', 'background.png')

  const existed = await exists(path)

  backgroundImagePath.value = existed ? convertFileSrc(path) : void 0

  clearObject([modelStore.supportKeys, modelStore.pressedKeys])

  const resourcePath = join(model.path, 'resources')
  const groups = ['left-keys', 'right-keys']

  for await (const groupName of groups) {
    const groupDir = join(resourcePath, groupName)
    const files = await readDir(groupDir).catch(() => [])
    const imageFiles = files.filter(file => isImage(file.name))

    for (const file of imageFiles) {
      const fileName = file.name.split('.')[0]

      modelStore.supportKeys[fileName] = join(groupDir, file.name)
    }
  }

  modelStore.modelReady = true
}, { deep: true, immediate: true })

watch([() => catStore.window.scale, modelSize], async ([scale, modelSize]) => {
  if (!modelSize) return

  const { width, height } = modelSize

  appWindow.setSize(
    new PhysicalSize({
      width: Math.round(width * (scale / 100)),
      height: Math.round(height * (scale / 100)),
    }),
  )
}, { immediate: true })

watch(modelStore.pressedKeys, (keys) => {
  const dirs = Object.values(keys).map((path) => {
    return nth(path.split(sep()), -2)!
  })

  const hasLeft = dirs.some(dir => dir.startsWith('left'))
  const hasRight = dirs.some(dir => dir.startsWith('right'))

  handleKeyChange(true, hasLeft)
  handleKeyChange(false, hasRight)
}, { deep: true })

watch(() => catStore.window.visible, async (value) => {
  value ? showWindow() : hideWindow()
})

watch(() => chat.lastRemoteEvent.value, (event) => {
  if (!event) return
  if (event.activity === 'mouse_move') {
    const [x, y] = event.value.split(',').map(Number)
    if (Number.isFinite(x) && Number.isFinite(y)) {
      handleRemoteMouseMove(new PhysicalPosition(x * screen.width, y * screen.height))
    }
    return
  }
  if (event.activity === 'key') {
    playRemoteJellyKey()
    handlePress(event.value)
    window.setTimeout(() => handleRelease(event.value), 120)
  } else {
    handleMouseChange(event.value)
    window.setTimeout(() => handleMouseChange(event.value, false), 120)
  }
})

watch(() => chat.remoteMessagePulse.value, () => {
  triggerMessageAlert()
})

useTauriListen<Record<string, unknown>>(LISTEN_KEY.CHAT_SETTINGS_CHANGED, async ({ payload }) => {
  Object.assign(chat.settings.value, payload)
  if (payload.bubblePassThrough !== undefined)
    await emitTo(WINDOW_LABEL.BUBBLE, LISTEN_KEY.BUBBLE_PASS_THROUGH, Boolean(payload.bubblePassThrough))
})

useTauriListen(LISTEN_KEY.VOICE_START, startVoiceRecording)
useTauriListen(LISTEN_KEY.VOICE_STOP, stopVoiceRecording)

useTauriListen(LISTEN_KEY.BUBBLE_TOGGLE, async () => {
  const bubble = await WebviewWindow.getByLabel(WINDOW_LABEL.BUBBLE)
  if (!bubble) return
  if (await bubble.isVisible()) {
    await bubble.hide()
  } else {
    await bubble.show()
    await bubble.setAlwaysOnTop(true)
  }
})

useTauriListen(LISTEN_KEY.AWAY_TOGGLE, () => {
  if (localAway.value) {
    publishPresence(false)
    return
  }
  awayInputSuppressedUntil = Date.now() + 5500
  publishPresence(true, '暂离')
  void openAwayEditor()
})

useTauriListen<string>(LISTEN_KEY.AWAY_EDITOR_SUBMIT, ({ payload }) => {
  if (!localAway.value) return
  const signText = payload.trim().slice(0, 20) || '暂离'
  chat.sendPresence(true, signText)
})

useTauriListen<string>(LISTEN_KEY.COMPOSER_SUBMIT, ({ payload }) => {
  chat.draft.value = payload
  chat.sendMessage()
})

useTauriListen<import('@/composables/useChatSync').ChatFileMessage>(LISTEN_KEY.COMPOSER_FILE_SUBMIT, ({ payload }) => {
  chat.sendFileMessage(payload)
})

useTauriListen(LISTEN_KEY.COMPOSER_CLOSED, async () => {
  composerOpen.value = false
  await invoke('restore_foreground_window')
})

watch(() => catStore.window.passThrough, (value) => {
  appWindow.setIgnoreCursorEvents(value)
}, { immediate: true })

watch(() => catStore.window.alwaysOnTop, setAlwaysOnTop, { immediate: true })

// The quick-chat bubbles are designed to stay above other windows.
onMounted(() => setAlwaysOnTop(true))

watch(() => generalStore.app.taskbarVisible, setTaskbarVisibility, { immediate: true })

watch(() => catStore.model.motionSound, live2d.setMotionSoundEnabled, { immediate: true })

watch(() => catStore.model.maxFPS, (value) => {
  live2d.setMaxFPS(value || 60)
}, { immediate: true })

useTauriListen<MotionInfo>(LISTEN_KEY.START_MOTION, ({ payload }) => {
  live2d.startMotion(payload)
})

useTauriListen<number>(LISTEN_KEY.SET_EXPRESSION, ({ payload }) => {
  live2d.setExpression(payload)
})

function handleMouseDown() {
  appWindow.startDragging()
}

async function handleContextmenu(event: MouseEvent) {
  event.preventDefault()

  if (event.shiftKey) return

  const menu = await Menu.new({
    items: [
      ...await getBaseMenu(),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      ...await getExitMenu(),
    ],
  })

  // Temporarily disable always-on-top on Windows so the context menu is not covered
  if (isWindows && catStore.window.alwaysOnTop) {
    setAlwaysOnTop(false)
  }

  await menu.popup()

  // Restore always-on-top after the menu is closed
  if (!isWindows || !catStore.window.alwaysOnTop) return

  setAlwaysOnTop(true)
}

function handleMouseMove(event: MouseEvent) {
  const { buttons, shiftKey, movementX, movementY } = event

  if (buttons !== 2 || !shiftKey) return

  const delta = (movementX + movementY) * 0.5
  const nextScale = Math.max(10, Math.min(catStore.window.scale + delta, 500))

  catStore.window.scale = round(nextScale)
}
</script>

<template>
  <div
    class="relative size-screen overflow-hidden"
    :style="{
      opacity: catStore.window.opacity / 100,
      borderRadius: `${catStore.window.radius}%`,
    }"
    @contextmenu="handleContextmenu"
    @mousedown="handleMouseDown"
    @mousemove="handleMouseMove"
  >
    <div
      v-show="chat.settings.value.showRemoteCat"
      class="cat-layer absolute size-full children:(absolute size-full)"
      :class="{ '-scale-x-100': catStore.model.mirror, 'pink-message-flash': pinkMessageFlash }"
    >
      <img
        v-if="backgroundImagePath"
        class="object-cover"
        :src="backgroundImagePath"
      >
      <canvas id="live2dCanvas" />
      <img
        v-for="path in modelStore.pressedKeys"
        :key="path"
        class="object-cover"
        :src="convertFileSrc(path)"
      >
    </div>
    <div
      v-if="chat.remoteAway.value && chat.settings.value.showRemoteCat"
      class="away-sign"
    >
      {{ chat.remoteAwayText.value }} 💤
    </div>

    <aside
      class="chat-overlay"
      @mousedown.stop
    >
      <div
        v-if="chat.settings.value.statsDisplay !== 'none'"
        class="stats-footer"
      >
        <template v-if="chat.settings.value.statsDisplay === 'today'">
          今日 {{ chat.todayCount.value }}
        </template>
        <template v-else-if="chat.settings.value.statsDisplay === 'total'">
          总计 {{ chat.stats.value.total }}
        </template>
        <template v-else>
          今日 {{ chat.todayCount.value }}　总计 {{ chat.stats.value.total }}
        </template>
      </div>
    </aside>

    <div
      v-show="resizing || !modelStore.modelReady"
      class="flex items-center justify-center bg-black"
    >
      <span class="text-center text-[10vw] text-white">
        {{ resizing ? $t('pages.main.hints.redrawing') : $t('pages.main.hints.switching') }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.chat-overlay {
  position: absolute;
  inset: 7px;
  z-index: 20;
  pointer-events: none;
  color: #3b302a;
  font-family: system-ui, sans-serif;
}
.pink-message-flash {
  transform-origin: center bottom;
  animation: cat-pink-message 0.78s cubic-bezier(0.2, 0.85, 0.3, 1.2);
}
.away-sign {
  position: absolute;
  top: 5%;
  right: 5%;
  z-index: 30;
  padding: 0.38em 0.72em;
  border: 0.16em solid #e892aa;
  border-radius: 0.8em;
  color: #7c3e54;
  background: #fff2f6ee;
  box-shadow: 0 0.25em 0.7em #9f536034;
  transform: rotate(4deg);
  pointer-events: none;
  font-size: clamp(11px, 5.5vw, 24px);
  font-weight: 800;
  letter-spacing: 0.08em;
}
.bubble-stack {
  position: absolute;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 5px;
  align-items: flex-start;
  max-width: calc(100vw - 14px);
  max-height: calc(100vh - 14px);
  pointer-events: none;
}
.bubble-drag-handle {
  align-self: flex-start;
  border: 0;
  border-radius: 9px;
  padding: 2px 7px;
  color: #63483d;
  background: #ffe4d4e8;
  box-shadow: 0 2px 7px #5d38252b;
  cursor: grab;
  pointer-events: auto;
}
.bubble-drag-handle:active {
  cursor: grabbing;
}
.bubble-drag-handle.locked {
  cursor: default;
  opacity: 0.65;
}
.quick-bubble {
  box-sizing: border-box;
  max-width: 100%;
  padding: 7px 11px;
  border: 1px solid #e8aabb;
  border-radius: 16px 16px 16px 5px;
  overflow-wrap: anywhere;
  color: #2f2529;
  background: #ffc9d9f2;
  box-shadow: 0 3px 10px #9c587030;
  font-size: clamp(10px, 3vw, 14px);
  line-height: 1.42;
  white-space: pre-wrap;
  pointer-events: auto;
}
.quick-bubble.mine {
  border: 1px solid #e8aabb;
  border-radius: 16px 16px 5px 16px;
  color: #2f2529;
  background: #fffafcf5;
  box-shadow: 0 3px 10px #9c587024;
}
.quick-bubble.newest {
}
.bubble-resize-handle {
  position: absolute;
  right: -4px;
  bottom: -4px;
  width: 18px;
  height: 18px;
  border: 0;
  border-right: 3px solid #6caef0;
  border-bottom: 3px solid #6caef0;
  border-radius: 0 0 5px;
  background: transparent;
  cursor: nwse-resize;
  pointer-events: auto;
}
.bubble-pop-enter-active {
  animation: bubble-bounce 0.55s cubic-bezier(0.18, 0.89, 0.32, 1.35);
}
.bubble-pop-move {
  transition: transform 0.38s cubic-bezier(0.22, 0.9, 0.3, 1.18);
}
.bubble-pop-leave-active {
  position: absolute;
  transition:
    opacity 0.45s ease,
    transform 0.45s ease;
}
.bubble-pop-leave-to {
  opacity: 0;
  transform: translateY(-24px) scale(0.82);
}
.quick-composer {
  align-self: flex-start;
  width: min(100%, 320px);
  pointer-events: auto;
}
.quick-composer input {
  box-sizing: border-box;
  width: 100%;
  border: 2px solid #ff8b62;
  border-radius: 14px;
  padding: 8px 11px;
  outline: none;
  background: #fffffff5;
  box-shadow: 0 5px 20px #38251c45;
  font-size: 12px;
}
.stats-footer {
  position: absolute;
  bottom: 2px;
  left: 2px;
  padding: 4px 8px;
  border-radius: 8px;
  color: #111;
  background: #fff;
  box-shadow: 0 2px 8px #0002;
  font-size: 10px;
}
@keyframes bubble-bounce {
  0% {
    opacity: 0;
    transform: translateY(24px) scale(0.35);
  }
  55% {
    opacity: 1;
    transform: translateY(-7px) scale(1.12);
  }
  75% {
    transform: translateY(3px) scale(0.96);
  }
  100% {
    transform: translateY(0) scale(1);
  }
}
@keyframes cat-pink-message {
  0% {
    filter: none;
    translate: 0 0;
    scale: 1 1;
  }
  12% {
    filter: sepia(0.55) saturate(3.8) hue-rotate(285deg) brightness(1.22);
    translate: 0 5%;
    scale: 1.08 0.9;
  }
  28% {
    filter: none;
    translate: 0 -12%;
    scale: 0.94 1.1;
  }
  40% {
    filter: none;
    translate: 0 2%;
    scale: 1.04 0.96;
  }
  50% {
    filter: sepia(0.62) saturate(4.4) hue-rotate(285deg) brightness(1.3);
    translate: 0 -7%;
    scale: 0.97 1.06;
  }
  64% {
    filter: sepia(0.22) saturate(1.5) hue-rotate(285deg) brightness(1.08);
    translate: 0 1%;
    scale: 1.02 0.98;
  }
  78% {
    filter: none;
    translate: 0 -2%;
    scale: 0.99 1.02;
  }
  100% {
    filter: none;
    translate: 0 0;
    scale: 1 1;
  }
}
</style>
