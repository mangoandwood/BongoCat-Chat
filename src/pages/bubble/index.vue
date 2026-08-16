<script setup lang="ts">
import { emitTo } from '@tauri-apps/api/event'
import { desktopDir, join } from '@tauri-apps/api/path'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { exists, writeFile } from '@tauri-apps/plugin-fs'
import { openPath } from '@tauri-apps/plugin-opener'
import { computed, nextTick, onMounted, ref } from 'vue'

import type { ChatFileMessage, ChatMessage } from '@/composables/useChatSync'

import { useTauriListen } from '@/composables/useTauriListen'
import { LISTEN_KEY, WINDOW_LABEL } from '@/constants'

type BubbleItem = ChatMessage | (ChatFileMessage & { alertOnly: true })

const appWindow = getCurrentWebviewWindow()
const items = ref<BubbleItem[]>([])
const bubbleList = ref<HTMLElement>()
const clientId = localStorage.getItem('bongocat-chat-client-id') || ''
let settings: Record<string, unknown> = {}
try {
  settings = JSON.parse(localStorage.getItem('bongocat-chat-settings-v1') || '{}')
} catch {
  settings = {}
}

const retainedCount = ref(Math.max(1, Math.min(30, Number(settings.bubbleMessageCount) || 30)))
const visibleItems = computed(() => items.value.slice(-retainedCount.value))
const playingVoiceId = ref('')
const previewImage = ref<ChatFileMessage>()
let configuredPassThrough = settings.bubblePassThrough === true

async function sendDroppedFiles(event: DragEvent) {
  const files = [...(event.dataTransfer?.files || [])]
  for (const file of files) {
    if (file.size > 5 * 1024 * 1024) continue
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    await emitTo(WINDOW_LABEL.MAIN, LISTEN_KEY.COMPOSER_FILE_SUBMIT, {
      id: crypto.randomUUID(),
      type: 'file',
      room: String(settings.room || '').trim(),
      senderId: clientId,
      senderName: String(settings.nickname || '').trim(),
      name: file.name,
      mime: file.type || 'application/octet-stream',
      data,
      sentAt: Date.now(),
    } satisfies ChatFileMessage)
  }
}

function addItem(item: BubbleItem) {
  if (items.value.some(existing => existing.id === item.id)) return
  items.value.push(item)
  items.value.sort((a, b) => a.sentAt - b.sentAt)
  items.value = items.value.slice(-2000)
  void nextTick(scrollToLatest)
}

function scrollToLatest() {
  const element = bubbleList.value
  if (!element) return
  element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
}

async function saveToDesktop(file: ChatFileMessage, openAfter = true) {
  const safeName = file.name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_') || 'BongoCat文件'
  const desktop = await desktopDir()
  let target = await join(desktop, safeName)
  if (await exists(target)) {
    const dot = safeName.lastIndexOf('.')
    const suffix = `-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
    const renamed = dot > 0 ? `${safeName.slice(0, dot)}${suffix}${safeName.slice(dot)}` : `${safeName}${suffix}`
    target = await join(desktop, renamed)
  }
  const bytes = new Uint8Array(await (await fetch(file.data)).arrayBuffer())
  await writeFile(target, bytes)
  if (openAfter) await openPath(target)
}

function downloadFile(file: ChatFileMessage) {
  void saveToDesktop(file, false)
}

async function copyImage(file: ChatFileMessage) {
  try {
    const blob = await (await fetch(file.data)).blob()
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
  } catch {
    // Some Windows clipboard policies reject images; download remains available.
  }
}

async function copyBubbleItem(item: BubbleItem) {
  if (item.type === 'chat') await navigator.clipboard.writeText(item.text)
  else if (!item.mime.startsWith('image/')) await navigator.clipboard.writeText(item.mime.startsWith('audio/') ? '语音消息' : item.name)
}

async function toggleVoice(event: MouseEvent, item: ChatFileMessage) {
  const audio = (event.currentTarget as HTMLElement).querySelector('audio')
  if (!audio) return
  document.querySelectorAll<HTMLAudioElement>('audio.voice-audio').forEach((other) => {
    if (other !== audio) {
      other.pause(); other.currentTime = 0
    }
  })
  if (audio.paused) {
    await audio.play()
    playingVoiceId.value = item.id
  } else {
    audio.pause()
    playingVoiceId.value = ''
  }
}

function finishVoice() {
  playingVoiceId.value = ''
}

useTauriListen<ChatMessage>(LISTEN_KEY.BUBBLE_MESSAGE, ({ payload }) => addItem(payload))
useTauriListen<ChatFileMessage>(LISTEN_KEY.BUBBLE_FILE, ({ payload }) => addItem({ ...payload, alertOnly: true }))
useTauriListen<Record<string, unknown>>(LISTEN_KEY.CHAT_SETTINGS_CHANGED, ({ payload }) => {
  if (payload.bubbleMessageCount === undefined) return
  retainedCount.value = Math.max(1, Math.min(30, Number(payload.bubbleMessageCount) || 30))
  void nextTick(scrollToLatest)
})
useTauriListen<boolean>(LISTEN_KEY.BUBBLE_PASS_THROUGH, ({ payload }) => {
  configuredPassThrough = payload
  if (payload) {
    document.querySelectorAll<HTMLAudioElement>('audio.voice-audio').forEach((audio) => {
      audio.pause(); audio.currentTime = 0
    })
    playingVoiceId.value = ''
  }
  void appWindow.setIgnoreCursorEvents(payload)
})

onMounted(() => {
  void appWindow.setIgnoreCursorEvents(settings.bubblePassThrough === true)
  const room = String(settings.room || '').trim()
  if (!room) return
  try {
    const history = JSON.parse(localStorage.getItem(`bongocat-chat-history-v1:${room}`) || '[]') as ChatMessage[]
    items.value = history.slice(-2000)
    void nextTick(scrollToLatest)
  } catch { /* Ignore damaged local history. */ }
})
</script>

<template>
  <main
    class="bubble-window"
    @dragover.prevent
    @drop.prevent="sendDroppedFiles"
  >
    <header data-tauri-drag-region>
      <span
        data-tauri-drag-region
        title="拖动气泡区域"
      >⠿</span>
    </header>
    <section
      ref="bubbleList"
      class="bubble-list"
    >
      <TransitionGroup name="bubble-pop">
        <article
          v-for="item in visibleItems"
          :key="item.id"
          class="bubble"
          :class="{ mine: item.senderId === clientId, file: item.type === 'file', voice: item.type === 'file' && item.mime.startsWith('audio/') }"
          @click="item.type === 'file' && item.mime.startsWith('audio/') && toggleVoice($event, item)"
          @contextmenu.prevent="copyBubbleItem(item)"
        >
          <b>{{ item.senderName }}</b>
          <template v-if="item.type === 'chat'">
            {{ item.text }}
          </template>
          <template v-else>
            <img
              v-if="item.mime.startsWith('image/')"
              :alt="item.name"
              :src="item.data"
              title="点击预览大图"
              @click.stop="previewImage = item"
              @contextmenu.stop.prevent="copyImage(item)"
            >
            <template v-else-if="item.mime.startsWith('audio/')">
              <audio
                class="voice-audio"
                preload="auto"
                :src="item.data"
                @ended="finishVoice"
              />
              <span class="voice-content"><span>{{ playingVoiceId === item.id ? '⏸' : '▶' }}</span><i /><span>语音</span></span>
            </template>
            <div
              v-else
              class="open-file"
              title="点击保存到桌面并打开"
              @click.stop="saveToDesktop(item)"
            >
              <span class="file-icon">📎</span>{{ item.name }}
            </div>
            <div
              v-if="!item.mime.startsWith('audio/')"
              class="file-actions"
            >
              <button
                v-if="item.mime.startsWith('image/')"
                @click.stop="copyImage(item)"
              >
                复制图片
              </button>
              <button @click.stop="downloadFile(item)">
                保存到桌面
              </button>
            </div>
          </template>
        </article>
      </TransitionGroup>
    </section>
    <div
      v-if="previewImage"
      class="image-preview"
      title="点击空白处关闭"
      @click="previewImage = undefined"
    >
      <img
        :alt="previewImage.name"
        :src="previewImage.data"
        @click.stop
      >
      <button
        title="关闭预览"
        @click="previewImage = undefined"
      >
        ×
      </button>
    </div>
    <button
      class="resize"
      title="拖动调整气泡区域大小"
      @pointerdown.prevent="appWindow.startResizeDragging('SouthEast')"
    />
  </main>
</template>

<style scoped>
:global(html),
:global(body),
:global(#app) {
  background: transparent !important;
}
.bubble-window {
  box-sizing: border-box;
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  border: 0;
  color: #38282e;
  background: transparent;
  font-family: system-ui, sans-serif;
}
header {
  position: absolute;
  top: 2px;
  left: 2px;
  z-index: 5;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  color: #754252;
  background: #ffd5e1;
  cursor: move;
  font-size: 14px;
  opacity: 0.2;
  user-select: none;
  transition: opacity 0.2s;
}
header:hover {
  opacity: 0.95;
}
.bubble-list {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 7px;
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 28px 12px 14px;
  scrollbar-width: none;
}
.bubble-list::-webkit-scrollbar {
  display: none;
}
.bubble {
  flex: none;
  align-self: flex-start;
  max-width: 92%;
  padding: 8px 11px;
  border: 0;
  border-radius: 16px 16px 16px 5px;
  color: #34262b;
  background: #ffc8d8ef;
  box-shadow: none;
  line-height: 1.42;
  overflow-wrap: anywhere;
}
.bubble.mine {
  align-self: flex-end;
  border-radius: 16px 16px 5px 16px;
  background: #fff;
}
.bubble.file {
  background: #ffe3ebf2;
}
.bubble.file img {
  display: block;
  max-width: 100%;
  max-height: 240px;
  margin-bottom: 6px;
  border-radius: 12px;
  object-fit: contain;
}
.bubble.file img,
.open-file {
  cursor: pointer;
}
.open-file:hover {
  color: #a03962;
}
.bubble.file audio {
  display: block;
  width: min(280px, 100%);
  margin-bottom: 6px;
}
.bubble.voice {
  min-width: 112px;
  cursor: pointer;
  user-select: none;
}
.bubble.voice > b {
  display: none;
}
.voice-audio {
  display: none !important;
}
.voice-content {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 650;
}
.voice-content i {
  display: block;
  width: 38px;
  height: 15px;
  opacity: 0.65;
  background: repeating-linear-gradient(90deg, currentColor 0 2px, transparent 2px 5px);
  mask: linear-gradient(0deg, transparent 0%, #000 18%, #000 82%, transparent 100%);
}
.bubble b {
  margin-right: 5px;
  font-size: 11px;
}
.file-icon {
  margin: 0 3px;
}
.file-actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.file-actions button {
  border: 0;
  border-radius: 8px;
  padding: 4px 8px;
  color: #6d4050;
  background: #ffffffb8;
  cursor: pointer;
  font-size: 10px;
}
.resize {
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 13px;
  height: 13px;
  border: 0;
  border-radius: 50%;
  background: #da719033;
  cursor: nwse-resize;
  transition: background 0.2s;
}
.resize:hover {
  background: #da7190bb;
}
.image-preview {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 18px;
  background: #241b20d9;
}
.image-preview img {
  max-width: 100%;
  max-height: 100%;
  border-radius: 12px;
  object-fit: contain;
}
.image-preview button {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 50%;
  color: #442532;
  background: #fff1f6;
  cursor: pointer;
  font-size: 22px;
  line-height: 1;
}
.bubble-pop-enter-active {
  animation: pop 0.48s cubic-bezier(0.18, 0.89, 0.32, 1.35);
}
.bubble-pop-move {
  transition: transform 0.34s ease;
}
.bubble-pop-leave-active {
  position: absolute;
  transition:
    opacity 0.35s,
    transform 0.35s;
}
.bubble-pop-leave-to {
  opacity: 0;
  transform: translateY(-18px) scale(0.85);
}
@keyframes pop {
  0% {
    opacity: 0;
    transform: translateY(22px) scale(0.5);
  }
  65% {
    transform: translateY(-4px) scale(1.06);
  }
  100% {
    opacity: 1;
    transform: none;
  }
}
</style>
