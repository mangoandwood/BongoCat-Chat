import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { confirm as confirmDialog, save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import { useTauriListen } from '@/composables/useTauriListen'
import { LISTEN_KEY } from '@/constants'
import { normalizeChatServerUrl } from '@/utils/chatServer'

export interface ChatMessage {
  id: string
  type: 'chat'
  room: string
  senderId: string
  senderName: string
  text: string
  sentAt: number
}

export interface ChatFileMessage {
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

interface ActivityMessage {
  id: string
  type: 'activity'
  room: string
  senderId: string
  senderName: string
  activity: 'key' | 'mouse' | 'mouse_move'
  value: string
  sentAt: number
}

interface DeviceEvent {
  kind: 'KeyboardPress' | 'KeyboardRelease' | 'MousePress' | 'MouseRelease' | 'MouseMove'
  value: string | { x: number, y: number }
}

interface ChatSettings {
  serverUrl: string
  room: string
  nickname: string
  showLocalCat: boolean
  showRemoteCat: boolean
  autoConnect: boolean
  bubbleScale: number
  bubbleWidth: number
  bubbleHeight: number
  bubbleMessageCount: number
  bubbleX: number
  bubbleY: number
  bubbleLocked: boolean
  bubbleFollowCat: boolean
  bubblePassThrough: boolean
  messageSoundEnabled: boolean
  messageSoundVolume: number
  messageSoundChoice: string
  keySoundEnabled: boolean
  keySoundVolume: number
  keySoundChoice: string
  gamePresets: GamePreset[]
  statsDisplay: 'today' | 'total' | 'both' | 'none'
}

export interface GamePreset {
  id: string
  name: string
  showRemoteCat: boolean
  catScale: number
  catX: number
  catY: number
  bubbleWidth: number
  bubbleHeight: number
  bubbleX: number
  bubbleY: number
  bubbleScale: number
  bubbleMessageCount: number
  catPassThrough: boolean
  bubblePassThrough: boolean
  alwaysOnTop: boolean
  showBubble: boolean
  fps: number
}

interface InputStats { total: number, days: Record<string, number> }

const SETTINGS_KEY = 'bongocat-chat-settings-v1'
const STATS_KEY = 'bongocat-chat-input-stats-v1'
const HISTORY_PREFIX = 'bongocat-chat-history-v1:'
const DEFAULT_SERVER = ''

function readJson<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || '') as T
  } catch {
    return fallback
  }
}

function todayKey() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function useChatSync(options: { captureDevice?: boolean, onMessage?: (message: ChatMessage) => void, onFile?: (message: ChatFileMessage) => void, onConnection?: (connected: boolean) => void, onLocalKey?: () => void } = {}) {
  const clientId = localStorage.getItem('bongocat-chat-client-id') || crypto.randomUUID()
  localStorage.setItem('bongocat-chat-client-id', clientId)

  const saved = readJson<Partial<ChatSettings>>(SETTINGS_KEY, {})
  const visibilityFixKey = 'bongocat-chat-visibility-fix-v2'
  const resetVisibility = localStorage.getItem(visibilityFixKey) !== 'done'
  if (resetVisibility) {
    saved.showLocalCat = true
    saved.showRemoteCat = true
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(saved))
    localStorage.setItem(visibilityFixKey, 'done')
  }
  const settings = ref<ChatSettings>({
    serverUrl: saved.serverUrl || DEFAULT_SERVER,
    room: saved.room || '',
    nickname: saved.nickname || '',
    showLocalCat: resetVisibility ? true : saved.showLocalCat !== false,
    showRemoteCat: resetVisibility ? true : saved.showRemoteCat !== false,
    autoConnect: saved.autoConnect !== false,
    bubbleScale: saved.bubbleScale || 100,
    bubbleWidth: saved.bubbleWidth || 360,
    bubbleHeight: saved.bubbleHeight || 470,
    bubbleMessageCount: saved.bubbleMessageCount || 30,
    bubbleX: saved.bubbleX ?? 7,
    bubbleY: saved.bubbleY ?? 7,
    bubbleLocked: saved.bubbleLocked ?? false,
    bubbleFollowCat: saved.bubbleFollowCat ?? true,
    bubblePassThrough: saved.bubblePassThrough ?? false,
    messageSoundEnabled: saved.messageSoundEnabled !== false,
    messageSoundVolume: Number.isFinite(saved.messageSoundVolume) ? Number(saved.messageSoundVolume) : 35,
    messageSoundChoice: saved.messageSoundChoice?.startsWith('original-') ? saved.messageSoundChoice : 'original-drop-cute',
    keySoundEnabled: saved.keySoundEnabled !== false,
    keySoundVolume: Number.isFinite(saved.keySoundVolume) ? Number(saved.keySoundVolume) : 22,
    keySoundChoice: saved.keySoundChoice?.startsWith('original-') ? saved.keySoundChoice : 'original-boop-soft',
    gamePresets: Array.isArray(saved.gamePresets) ? saved.gamePresets : [],
    statsDisplay: saved.statsDisplay || 'both',
  })
  const messages = ref<ChatMessage[]>([])
  const connected = ref(false)
  const connecting = ref(false)
  const composerVisible = ref(false)
  const draft = ref('')
  const remoteActivity = ref('等待对方输入')
  const remotePulse = ref(0)
  const remoteMessagePulse = ref(0)
  const lastRemoteEvent = ref<ActivityMessage>()
  const remoteAway = ref(false)
  const remoteAwayText = ref('暂离')
  const stats = ref<InputStats>(readJson(STATS_KEY, { total: 0, days: {} }))
  let socket: WebSocket | undefined
  let reconnectTimer: number | undefined
  let stopped = false
  let lastMouseMoveSentAt = 0
  let heartbeatTimer: number | undefined
  let exportingHistory = false
  let localPresenceAway = false

  const todayCount = computed(() => stats.value.days[todayKey()] || 0)
  const recentMessages = computed(() => messages.value.slice(-7))

  function historyKey() {
    return `${HISTORY_PREFIX}${settings.value.room.trim()}`
  }
  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings.value))
  }
  function loadHistory() {
    messages.value = readJson<ChatMessage[]>(historyKey(), []).filter(item => item.type === 'chat').slice(-2000)
  }
  function saveHistory() {
    localStorage.setItem(historyKey(), JSON.stringify(messages.value.slice(-2000)))
  }
  async function offerHistoryExport() {
    if (exportingHistory || messages.value.length < 2000) return
    exportingHistory = true
    const accepted = await confirmDialog('本轮聊天记录已达到 2000 条上限。是否立即导出并开始新一轮记录？', {
      title: 'BongoCat 聊天记录已满',
      kind: 'info',
    })
    if (!accepted) {
      messages.value = messages.value.slice(-2000)
      saveHistory()
      exportingHistory = false
      return
    }
    const path = await save({
      defaultPath: `BongoCat-${settings.value.room.trim()}-${new Date().toISOString().slice(0, 10)}-聊天记录.txt`,
      filters: [{ name: '文本文件', extensions: ['txt'] }],
    })
    if (!path) {
      exportingHistory = false
      return
    }
    const lines = messages.value.flatMap(message => [
      `[${new Date(message.sentAt).toLocaleString('zh-CN')}] ${message.senderName}：`,
      message.text,
      '',
    ])
    await writeTextFile(path, lines.join('\r\n'))
    messages.value = []
    localStorage.removeItem(historyKey())
    exportingHistory = false
  }
  function appendMessage(message: ChatMessage) {
    if (message.room !== settings.value.room.trim() || messages.value.some(item => item.id === message.id)) return
    messages.value.push(message)
    messages.value.sort((a, b) => a.sentAt - b.sentAt)
    saveHistory()
    if (message.senderId !== clientId) remoteMessagePulse.value += 1
    options.onMessage?.(message)
    if (messages.value.length >= 2000) void offerHistoryExport()
  }
  function bumpStats() {
    const day = todayKey()
    stats.value.total += 1
    stats.value.days[day] = (stats.value.days[day] || 0) + 1
    localStorage.setItem(STATS_KEY, JSON.stringify(stats.value))
  }
  function send(payload: ChatMessage | ActivityMessage | ChatFileMessage) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload))
  }
  function connect() {
    window.clearTimeout(reconnectTimer)
    if (!settings.value.autoConnect || !settings.value.serverUrl.trim() || !settings.value.room.trim() || !settings.value.nickname.trim()) return
    saveSettings()
    loadHistory()
    connecting.value = true
    try {
      const normalizedServer = normalizeChatServerUrl(settings.value.serverUrl.trim() || DEFAULT_SERVER)
      settings.value.serverUrl = normalizedServer
      const url = new URL(normalizedServer)
      url.searchParams.set('room', settings.value.room.trim())
      url.searchParams.set('clientId', clientId)
      socket = new WebSocket(url)
      socket.onopen = () => {
        connected.value = true
        connecting.value = false
        options.onConnection?.(true)
        sendPresence(localPresenceAway)
        window.clearInterval(heartbeatTimer)
        heartbeatTimer = window.setInterval(() => send({
          id: crypto.randomUUID(),
          type: 'activity',
          room: settings.value.room.trim(),
          senderId: clientId,
          senderName: settings.value.nickname.trim(),
          activity: 'key',
          value: '__heartbeat__',
          sentAt: Date.now(),
        }), 5 * 60 * 1000)
      }
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as ChatMessage | ActivityMessage | ChatFileMessage
          if (message.type === 'chat') appendMessage(message)
          if (message.type === 'file' && message.room === settings.value.room.trim()) options.onFile?.(message)
          if (message.type === 'activity' && message.senderId !== clientId) {
            if (message.value === '__heartbeat__') return
            if (message.value === '__presence_away__' || message.value.startsWith('__presence_away__:')) {
              remoteAway.value = true
              remoteAwayText.value = message.value.startsWith('__presence_away__:')
                ? (message.value.slice('__presence_away__:'.length).trim() || '暂离').slice(0, 20)
                : '暂离'
              return
            }
            if (message.value === '__presence_back__') {
              remoteAway.value = false; return
            }
            lastRemoteEvent.value = message
            remoteActivity.value = message.activity === 'key' ? `键盘：${message.value}` : `鼠标：${message.value}`
            remotePulse.value += 1
          }
        } catch { /* Ignore malformed relay payloads. */ }
      }
      socket.onclose = () => {
        connected.value = false
        connecting.value = false
        socket = undefined
        window.clearInterval(heartbeatTimer)
        options.onConnection?.(false)
        if (!stopped && settings.value.autoConnect) reconnectTimer = window.setTimeout(connect, 5000)
      }
      socket.onerror = () => socket?.close()
    } catch {
      connecting.value = false
    }
  }
  function disconnect() {
    stopped = true
    window.clearTimeout(reconnectTimer)
    window.clearInterval(heartbeatTimer)
    socket?.close()
  }
  async function openComposer() {
    await invoke('remember_foreground_window')
    composerVisible.value = true
    await getCurrentWebviewWindow().setFocus()
    nextTick(() => (document.querySelector('.quick-composer input') as HTMLInputElement | null)?.focus())
  }
  async function closeComposer(restoreFocus = false) {
    composerVisible.value = false
    ;(document.querySelector('.quick-composer input') as HTMLInputElement | null)?.blur()
    if (restoreFocus) await invoke('restore_foreground_window')
  }
  function toggleComposer() {
    if (composerVisible.value) closeComposer(true)
    else openComposer()
  }
  function sendMessage() {
    const text = draft.value.trim()
    if (!text || !connected.value) return
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      type: 'chat',
      room: settings.value.room.trim(),
      senderId: clientId,
      senderName: settings.value.nickname.trim(),
      text: text.slice(0, 2000),
      sentAt: Date.now(),
    }
    send(message)
    appendMessage(message)
    draft.value = ''
    nextTick(() => (document.querySelector('.quick-composer input') as HTMLInputElement | null)?.focus())
  }
  function sendFileMessage(message: ChatFileMessage) {
    if (!connected.value || message.room !== settings.value.room.trim()) return
    send(message)
    options.onFile?.(message)
  }
  function sendPresence(away: boolean, signText = '暂离') {
    localPresenceAway = away
    send({
      id: crypto.randomUUID(),
      type: 'activity',
      room: settings.value.room.trim(),
      senderId: clientId,
      senderName: settings.value.nickname.trim(),
      activity: 'key',
      value: away ? `__presence_away__:${signText.trim().slice(0, 20) || '暂离'}` : '__presence_back__',
      sentAt: Date.now(),
    })
  }
  function toggleCat(which: 'local' | 'remote') {
    if (which === 'local') settings.value.showLocalCat = !settings.value.showLocalCat
    else settings.value.showRemoteCat = !settings.value.showRemoteCat
    saveSettings()
  }

  useTauriListen<DeviceEvent>(LISTEN_KEY.DEVICE_CHANGED, ({ payload }) => {
    if (options.captureDevice === false) return
    const value = String(payload.value)
    if (payload.kind === 'MouseMove' && typeof payload.value === 'object') {
      options.onLocalKey?.()
      const now = Date.now()
      // Eight updates per second remains responsive while fitting a two-person
      // room comfortably inside a self-hosted Workers Free allowance.
      if (now - lastMouseMoveSentAt < 125) return
      lastMouseMoveSentAt = now
      const x = Math.max(0, Math.min(1, payload.value.x / Math.max(1, screen.width)))
      const y = Math.max(0, Math.min(1, payload.value.y / Math.max(1, screen.height)))
      send({
        id: crypto.randomUUID(),
        type: 'activity',
        room: settings.value.room.trim(),
        senderId: clientId,
        senderName: settings.value.nickname.trim(),
        activity: 'mouse_move',
        value: `${x.toFixed(4)},${y.toFixed(4)}`,
        sentAt: now,
      })
      return
    }
    if (payload.kind !== 'KeyboardPress' && payload.kind !== 'MousePress') return
    if (payload.kind === 'KeyboardPress' || payload.kind === 'MousePress') options.onLocalKey?.()
    bumpStats()
    const activity: ActivityMessage = {
      id: crypto.randomUUID(),
      type: 'activity',
      room: settings.value.room.trim(),
      senderId: clientId,
      senderName: settings.value.nickname.trim(),
      activity: payload.kind === 'KeyboardPress' ? 'key' : 'mouse',
      value,
      sentAt: Date.now(),
    }
    send(activity)
  })

  onMounted(() => {
    stopped = false; loadHistory(); connect()
  })
  onBeforeUnmount(disconnect)

  return {
    clientId,
    settings,
    messages,
    recentMessages,
    connected,
    connecting,
    composerVisible,
    draft,
    remoteActivity,
    remotePulse,
    remoteMessagePulse,
    lastRemoteEvent,
    remoteAway,
    remoteAwayText,
    stats,
    todayCount,
    connect,
    disconnect,
    openComposer,
    sendMessage,
    sendFileMessage,
    sendPresence,
    closeComposer,
    toggleComposer,
    toggleCat,
    saveSettings,
  }
}
