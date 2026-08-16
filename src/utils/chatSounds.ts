const originalModules = import.meta.glob<string>('/src/assets/sounds/original/*.wav', {
  eager: true,
  query: '?url',
  import: 'default',
})

export interface ChatSoundOption { id: string, label: string, url: string }

const labels: Record<string, string> = {
  'boop-soft': '原创 · 轻柔啵',
  'boop-round': '原创 · 圆润啵',
  'pop-low': '原创 · 低沉短啵',
  'jelly-short': '原创 · 短促果冻',
  'jelly-bright': '原创 · 明亮果冻',
  'drop-cute': '原创 · 可爱水滴',
}

const originalOptions = Object.entries(originalModules)
  .map(([path, url]) => {
    const name = decodeURIComponent(path.split('/').pop()?.replace(/\.wav$/i, '') || path)
    return { id: `original-${name}`, label: labels[name] || `原创 · ${name}`, url }
  })
  .sort((a, b) => a.id.localeCompare(b.id, 'zh-CN', { numeric: true }))

export const CHAT_SOUND_OPTIONS: ChatSoundOption[] = [
  ...originalOptions,
]

export function getChatSoundUrl(id: string, fallbackId: string) {
  return CHAT_SOUND_OPTIONS.find(item => item.id === id)?.url
    || CHAT_SOUND_OPTIONS.find(item => item.id === fallbackId)?.url
    || CHAT_SOUND_OPTIONS[0]!.url
}
