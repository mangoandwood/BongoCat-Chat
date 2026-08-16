<script setup lang="ts">
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import { normalizeChatServerUrl } from '@/utils/chatServer'

interface ChatMessage {
  id: string
  type: 'chat'
  room: string
  senderId: string
  senderName: string
  text: string
  sentAt: number
}

interface FileMessage {
  id: string
  type: 'file'
  room: string
  senderId: string
  senderName: string
  name: string
  mime: string
  data: string
  sentAt: number
}

const SETTINGS_KEY = 'bongocat-chat-settings-v1'
const HISTORY_PREFIX = 'bongocat-chat-history-v1:'
const clientId = localStorage.getItem('bongocat-chat-client-id') || crypto.randomUUID()
localStorage.setItem('bongocat-chat-client-id', clientId)

const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
const serverUrl = ref(saved.serverUrl || '')
const room = ref(saved.room || '')
const nickname = ref(saved.nickname || '')
const draft = ref('')
const connected = ref(false)
const connecting = ref(false)
const errorText = ref('')
const messages = ref<ChatMessage[]>([])
const files = ref<FileMessage[]>([])
const messageList = ref<HTMLElement>()
const dropActive = ref(false)
const contextMenu = ref<{ x: number, y: number, file: FileMessage }>()
let socket: WebSocket | undefined
let reconnectTimer: number | undefined

const canConnect = computed(() => Boolean(serverUrl.value.trim() && room.value.trim() && nickname.value.trim()))
const statusText = computed(() => connected.value ? '已连接' : connecting.value ? '连接中…' : '未连接')
const timeline = computed(() => [...messages.value, ...files.value].sort((a, b) => a.sentAt - b.sentAt))

function historyKey() {
  return `${HISTORY_PREFIX}${room.value.trim()}`
}

function loadHistory() {
  messages.value = JSON.parse(localStorage.getItem(historyKey()) || '[]')
  scrollToBottom()
}

function saveHistory() {
  localStorage.setItem(historyKey(), JSON.stringify(messages.value.slice(-2000)))
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    ...saved,
    serverUrl: serverUrl.value.trim(),
    room: room.value.trim(),
    nickname: nickname.value.trim(),
    autoConnect: true,
  }))
}

function appendMessage(message: ChatMessage) {
  if (message.room !== room.value.trim() || messages.value.some(item => item.id === message.id)) return
  messages.value.push(message)
  messages.value.sort((a, b) => a.sentAt - b.sentAt)
  saveHistory()
  scrollToBottom()
}

async function scrollToBottom() {
  await nextTick()
  if (messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight
}

function disconnect() {
  window.clearTimeout(reconnectTimer)
  reconnectTimer = undefined
  socket?.close()
  socket = undefined
  connected.value = false
  connecting.value = false
}

function connect() {
  if (!canConnect.value) {
    errorText.value = '请填写服务器地址、房间码和昵称。'
    return
  }

  disconnect()
  saveSettings()
  loadHistory()
  errorText.value = ''
  connecting.value = true

  try {
    serverUrl.value = normalizeChatServerUrl(serverUrl.value)
    const url = new URL(serverUrl.value)
    url.searchParams.set('room', room.value.trim())
    url.searchParams.set('clientId', clientId)
    socket = new WebSocket(url)

    socket.onopen = () => {
      connected.value = true
      connecting.value = false
    }
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as ChatMessage | FileMessage
        if (message.type === 'file') appendFile(message)
        else if (message.type === 'chat') appendMessage(message)
      } catch {
        errorText.value = '收到了一条无法识别的消息。'
      }
    }
    socket.onerror = () => {
      errorText.value = '无法连接聊天服务器，请检查地址或网络。'
    }
    socket.onclose = () => {
      connected.value = false
      connecting.value = false
      socket = undefined
    }
  } catch {
    connecting.value = false
    errorText.value = '服务器地址格式不正确。'
  }
}

function generateRoom() {
  const bytes = crypto.getRandomValues(new Uint8Array(18))
  room.value = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
}

async function copyInvite() {
  if (!serverUrl.value.trim() || !room.value.trim()) {
    errorText.value = '请先填写服务器地址并生成房间码。'
    return
  }
  try {
    const normalized = normalizeChatServerUrl(serverUrl.value)
    await navigator.clipboard.writeText(`BongoCat 双人聊天邀请\n服务器：${normalized}\n房间码：${room.value.trim()}`)
    errorText.value = '邀请信息已复制，把它发给对方即可。'
  } catch {
    errorText.value = '服务器地址格式不正确。'
  }
}

function sendMessage() {
  const text = draft.value.trim()
  if (!text || !connected.value || !socket) return

  const message: ChatMessage = {
    id: crypto.randomUUID(),
    type: 'chat',
    room: room.value.trim(),
    senderId: clientId,
    senderName: nickname.value.trim(),
    text: text.slice(0, 2000),
    sentAt: Date.now(),
  }
  socket.send(JSON.stringify(message))
  appendMessage(message)
  draft.value = ''
}

function appendFile(file: FileMessage) {
  if (file.room !== room.value.trim() || files.value.some(item => item.id === file.id)) return
  files.value.push(file)
}

async function sendSelectedFile(file?: File) {
  if (!file || !socket || !connected.value) return
  if (file.size > 5 * 1024 * 1024) {
    errorText.value = '文件不能超过 5MB。'
    return
  }
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  const message: FileMessage = {
    id: crypto.randomUUID(),
    type: 'file',
    room: room.value.trim(),
    senderId: clientId,
    senderName: nickname.value.trim(),
    name: file.name,
    mime: file.type || 'application/octet-stream',
    data,
    sentAt: Date.now(),
  }
  socket.send(JSON.stringify(message))
  appendFile(message)
  scrollToBottom()
}

async function sendFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  await sendSelectedFile(file)
}

async function handlePaste(event: ClipboardEvent) {
  const clipboardFiles = [...(event.clipboardData?.files || [])]
  if (!clipboardFiles.length) return
  event.preventDefault()
  for (const file of clipboardFiles) await sendSelectedFile(file)
}

async function handleDrop(event: DragEvent) {
  dropActive.value = false
  const droppedFiles = [...(event.dataTransfer?.files || [])]
  for (const file of droppedFiles) await sendSelectedFile(file)
}

function downloadFile(file: FileMessage) {
  const link = document.createElement('a')
  link.href = file.data
  link.download = file.name
  link.click()
  contextMenu.value = undefined
}

async function copyImage(file: FileMessage) {
  try {
    const blob = await (await fetch(file.data)).blob()
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
    errorText.value = ''
  } catch {
    errorText.value = '图片复制失败，可以选择“下载”保存。'
  }
  contextMenu.value = undefined
}

async function copyChatText(text: string) {
  await navigator.clipboard.writeText(text)
}

function openFileMenu(event: MouseEvent, file: FileMessage) {
  event.preventDefault()
  contextMenu.value = { x: event.clientX, y: event.clientY, file }
}

function clearHistory() {
  if (!confirm('只清除这台电脑上当前房间的聊天记录？')) return
  messages.value = []
  localStorage.removeItem(historyKey())
}

async function exportHistory() {
  if (!messages.value.length) {
    errorText.value = '当前房间还没有可以导出的消息。'
    return
  }

  const path = await save({
    defaultPath: `BongoCat-${room.value.trim()}-聊天记录.txt`,
    filters: [{ name: '文本文件', extensions: ['txt'] }],
  })
  if (!path) return

  const lines = [
    'BongoCat 双人聊天记录',
    `房间：${room.value.trim()}`,
    `导出时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    ...messages.value.flatMap(message => [
      `[${new Date(message.sentAt).toLocaleString('zh-CN')}] ${message.senderName}：`,
      message.text,
      '',
    ]),
  ]
  await writeTextFile(path, lines.join('\r\n'))
  errorText.value = ''
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

onMounted(() => {
  if (room.value) loadHistory()
  if (canConnect.value) connect()
})
onBeforeUnmount(disconnect)
</script>

<template>
  <main
    class="chat-shell"
    @click="contextMenu = undefined"
    @dragenter.prevent="dropActive = true"
    @dragleave.self="dropActive = false"
    @dragover.prevent
    @drop.prevent="handleDrop"
    @paste="handlePaste"
  >
    <header
      class="chat-header"
      data-tauri-drag-region
    >
      <div>
        <h1>🐾 双人聊天</h1>
        <p>消息会永久保存在本机，服务器只负责实时转发。</p>
      </div>
      <span
        class="status"
        :class="{ online: connected }"
      >{{ statusText }}</span>
    </header>

    <section
      v-if="!connected"
      class="connect-card"
    >
      <label>聊天服务器<input
        v-model="serverUrl"
        placeholder="可粘贴 https://xxx.workers.dev"
      ></label>
      <div class="two-columns">
        <label>房间码<input
          v-model="room"
          maxlength="48"
          placeholder="两个人填写相同房间码"
        ></label>
        <label>你的昵称<input
          v-model="nickname"
          maxlength="24"
          placeholder="例如：小猫A"
        ></label>
      </div>
      <div class="actions">
        <button
          class="quiet"
          @click="generateRoom"
        >
          生成安全房间码
        </button>
        <button
          class="quiet"
          @click="copyInvite"
        >
          复制邀请信息
        </button>
        <button
          class="primary"
          :disabled="!canConnect || connecting"
          @click="connect"
        >
          测试并进入房间
        </button>
      </div>
      <p
        v-if="errorText"
        class="error"
      >
        {{ errorText }}
      </p>
    </section>

    <template v-else>
      <section
        ref="messageList"
        class="message-list"
      >
        <div
          v-if="!messages.length"
          class="empty"
        >
          还没有消息，和对方说声你好吧。
        </div>
        <template
          v-for="item in timeline"
          :key="item.id"
        >
          <article
            v-if="item.type === 'chat'"
            class="message"
            :class="{ mine: item.senderId === clientId }"
          >
            <div class="meta">
              <b>{{ item.senderName }}</b><time>{{ formatTime(item.sentAt) }}</time>
            </div>
            <div
              class="bubble"
              title="右键复制消息"
              @contextmenu.prevent="copyChatText(item.text)"
            >
              {{ item.text }}
            </div>
          </article>
          <article
            v-else
            class="file-card"
            :class="{ mine: item.senderId === clientId }"
            @contextmenu="openFileMenu($event, item)"
          >
            <b>{{ item.senderName }}</b>
            <img
              v-if="item.mime.startsWith('image/')"
              :alt="item.name"
              :src="item.data"
            >
            <span>{{ item.name }}</span>
            <small>右键可复制图片或下载</small>
          </article>
        </template>
      </section>

      <footer class="composer">
        <textarea
          v-model="draft"
          maxlength="2000"
          placeholder="输入消息；Enter 发送，Shift+Enter 换行"
          rows="3"
          @keydown.enter.exact.prevent="sendMessage"
        />
        <div class="actions">
          <label class="file-button">发送图片/文件（≤5MB）<input
            type="file"
            @change="sendFile"
          ></label>
          <button
            class="quiet"
            @click="clearHistory"
          >
            清除本机记录
          </button>
          <button
            class="quiet"
            @click="exportHistory"
          >
            导出 TXT
          </button>
          <button
            class="quiet"
            @click="disconnect"
          >
            离开房间
          </button>
          <button
            class="primary"
            :disabled="!draft.trim()"
            @click="sendMessage"
          >
            发送
          </button>
        </div>
      </footer>
      <div
        v-if="dropActive"
        class="drop-mask"
      >
        松开鼠标发送文件或图片（≤5MB）
      </div>
      <div
        v-if="contextMenu"
        class="file-menu"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        @click.stop
      >
        <button
          v-if="contextMenu.file.mime.startsWith('image/')"
          @click="copyImage(contextMenu.file)"
        >
          复制图片
        </button>
        <button @click="downloadFile(contextMenu.file)">
          下载 {{ contextMenu.file.name }}
        </button>
      </div>
    </template>
  </main>
</template>

<style scoped>
.chat-shell {
  height: 100vh;
  display: flex;
  flex-direction: column;
  color: #3d342f;
  background: #fffaf5;
}
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 22px 16px;
  border-bottom: 1px solid #eadfd5;
  background: #fff;
  cursor: move;
  user-select: none;
}
h1 {
  margin: 0;
  font-size: 22px;
}
p {
  margin: 5px 0 0;
  color: #83756d;
  font-size: 12px;
}
.status {
  padding: 5px 10px;
  border-radius: 999px;
  color: #816f66;
  background: #eee7e2;
  font-size: 12px;
  white-space: nowrap;
}
.status.online {
  color: #23754c;
  background: #dff4e8;
}
.connect-card {
  width: min(440px, calc(100% - 36px));
  margin: 32px auto;
  padding: 22px;
  border: 1px solid #eadfd5;
  border-radius: 18px;
  background: white;
  box-shadow: 0 8px 28px #6f4d3520;
}
label {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-bottom: 16px;
  font-size: 13px;
  font-weight: 600;
}
input,
textarea {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid #dccdc1;
  border-radius: 10px;
  padding: 10px 12px;
  color: inherit;
  background: #fffdfa;
  outline: none;
}
input:focus,
textarea:focus {
  border-color: #e88c72;
  box-shadow: 0 0 0 3px #e88c7220;
}
.two-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
button {
  border: 0;
  border-radius: 10px;
  padding: 9px 15px;
  cursor: pointer;
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.primary {
  color: white;
  background: #db765d;
  font-weight: 700;
}
.quiet {
  color: #66574f;
  background: #eee6df;
}
.connect-card > .primary {
  width: 100%;
}
.error {
  color: #b42318;
}
.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}
.empty {
  margin: 20vh auto;
  color: #9c8e85;
  text-align: center;
}
.message {
  max-width: min(78%, 760px);
  margin: 0 0 15px;
}
.message.mine {
  margin-left: auto;
}
.meta {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin: 0 4px 5px;
  font-size: 12px;
}
.mine .meta {
  justify-content: flex-end;
}
.meta time {
  color: #a3958c;
  font-size: 10px;
}
.bubble {
  padding: 10px 13px;
  border: 1px solid #e8aabb;
  border-radius: 16px 16px 16px 5px;
  color: #2f2529;
  background: #ffc9d9;
  box-shadow: 0 2px 8px #9c587022;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.mine .bubble {
  border: 1px solid #e8aabb;
  border-radius: 16px 16px 5px 16px;
  color: #2f2529;
  background: #fffafc;
  box-shadow: 0 2px 8px #9c58701c;
}
.composer {
  padding: 14px 18px 18px;
  border-top: 1px solid #eadfd5;
  background: white;
}
textarea {
  resize: none;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 9px;
}
.file-button {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  margin: 0;
  border-radius: 10px;
  padding: 9px 12px;
  color: #66574f;
  background: #eee6df;
  font-size: 12px;
  cursor: pointer;
}
.file-button input {
  display: none;
}
.file-card {
  display: flex;
  flex-direction: column;
  gap: 7px;
  width: min(300px, 78%);
  margin: 12px 0;
  padding: 10px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 2px 8px #5e403414;
}
.file-card.mine {
  margin-left: auto;
}
.file-card img {
  max-width: 100%;
  max-height: 240px;
  border-radius: 8px;
  object-fit: contain;
}
.file-card small {
  color: #8b7b72;
  font-size: 11px;
}
.drop-mask {
  position: fixed;
  inset: 12px;
  z-index: 50;
  display: grid;
  place-items: center;
  border: 3px dashed #559ee8;
  border-radius: 18px;
  color: #245f9c;
  background: #dceeffe8;
  font-size: 18px;
  font-weight: 700;
  pointer-events: none;
}
.file-menu {
  position: fixed;
  z-index: 60;
  display: flex;
  flex-direction: column;
  min-width: 170px;
  padding: 6px;
  border-radius: 10px;
  background: white;
  box-shadow: 0 8px 28px #0003;
}
.file-menu button {
  color: #222;
  background: transparent;
  text-align: left;
}
.file-menu button:hover {
  background: #e6f2ff;
}
@media (max-width: 460px) {
  .two-columns {
    grid-template-columns: 1fr;
    gap: 0;
  }
  .chat-header p {
    display: none;
  }
}
</style>
