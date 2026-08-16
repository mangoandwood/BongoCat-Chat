<script setup lang="ts">
import { emitTo } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { nextTick, ref } from 'vue'

import { useTauriListen } from '@/composables/useTauriListen'
import { LISTEN_KEY, WINDOW_LABEL } from '@/constants'

const appWindow = getCurrentWebviewWindow()
const draft = ref('')
const input = ref<HTMLTextAreaElement>()
const fileError = ref('')
const settings = JSON.parse(localStorage.getItem('bongocat-chat-settings-v1') || '{}')
const clientId = localStorage.getItem('bongocat-chat-client-id') || ''
const mode = ref<'chat' | 'away'>('chat')
let awayEditorTimer: number | undefined

async function forceFocus() {
  await appWindow.show()
  await appWindow.setAlwaysOnTop(true)
  await appWindow.setFocus()
  await nextTick()
  const focusInput = () => {
    input.value?.focus({ preventScroll: true })
    input.value?.setSelectionRange(draft.value.length, draft.value.length)
  }
  focusInput()
  window.setTimeout(focusInput, 50)
  window.setTimeout(focusInput, 150)
  window.setTimeout(focusInput, 300)
}

async function submit() {
  const text = draft.value.trim()
  if (!text) return
  if (mode.value === 'away') {
    window.clearTimeout(awayEditorTimer)
    await emitTo(WINDOW_LABEL.MAIN, LISTEN_KEY.AWAY_EDITOR_SUBMIT, text.slice(0, 20))
    draft.value = ''
    mode.value = 'chat'
    await close()
    return
  }
  await emitTo(WINDOW_LABEL.MAIN, LISTEN_KEY.COMPOSER_SUBMIT, text.slice(0, 2000))
  draft.value = ''
  await forceFocus()
}

async function close() {
  await appWindow.hide()
  await emitTo(WINDOW_LABEL.MAIN, LISTEN_KEY.COMPOSER_CLOSED)
}

async function sendFiles(files: File[]) {
  fileError.value = ''
  for (const file of files) {
    if (file.size > 5 * 1024 * 1024) {
      fileError.value = `${file.name} 超过 5MB，未发送。`
      continue
    }
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
    })
  }
  await forceFocus()
}

async function chooseFiles(event: Event) {
  const picker = event.target as HTMLInputElement
  await sendFiles([...(picker.files || [])])
  picker.value = ''
}

async function pasteFiles(event: ClipboardEvent) {
  const files = [...(event.clipboardData?.files || [])]
  if (!files.length) return
  event.preventDefault()
  await sendFiles(files)
}

async function dropFiles(event: DragEvent) {
  await sendFiles([...(event.dataTransfer?.files || [])])
}

useTauriListen(LISTEN_KEY.COMPOSER_FOCUS, forceFocus)
useTauriListen<string>(LISTEN_KEY.AWAY_EDITOR_OPEN, async ({ payload }) => {
  window.clearTimeout(awayEditorTimer)
  mode.value = 'away'
  draft.value = payload || '暂离'
  await forceFocus()
  await nextTick()
  input.value?.select()
  awayEditorTimer = window.setTimeout(async () => {
    if (mode.value !== 'away') return
    mode.value = 'chat'
    draft.value = ''
    await close()
  }, 5000)
})
</script>

<template>
  <main
    class="composer-window"
    @dragover.prevent
    @drop.prevent="dropFiles"
    @paste="pasteFiles"
  >
    <textarea
      ref="input"
      v-model="draft"
      aria-label="消息输入框"
      autofocus
      maxlength="2000"
      @keydown.enter.exact.prevent="submit"
    />
  </main>
</template>

<style scoped>
.composer-window {
  box-sizing: border-box;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  padding: 8px;
  border: 0;
  background: transparent;
  box-shadow: none;
}
textarea {
  box-sizing: border-box;
  display: block;
  width: 100%;
  height: 100%;
  resize: none;
  border: 2px solid #ffd0de;
  border-radius: 22px;
  padding: 14px 17px;
  color: #3a2930;
  background: linear-gradient(145deg, #fff 0%, #fff9fb 100%);
  box-shadow: 0 8px 24px #e98ca326;
  outline: none;
  caret-color: #ff6f9d;
  font:
    15px/1.5 'Microsoft YaHei UI',
    system-ui,
    sans-serif;
  transition:
    border-color 0.18s,
    box-shadow 0.18s;
}
textarea:focus {
  border: 0;
  box-shadow: none;
  outline: none;
}
textarea:focus {
  border: 2px solid #ffabc3;
  box-shadow:
    0 8px 28px #e98ca33d,
    inset 0 0 0 3px #fff;
}
</style>
