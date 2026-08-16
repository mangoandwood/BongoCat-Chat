export function normalizeChatServerUrl(input: string) {
  const value = input.trim()
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`
  const url = new URL(withProtocol)
  if (url.protocol === 'https:') url.protocol = 'wss:'
  else if (url.protocol === 'http:') url.protocol = 'ws:'
  if (url.protocol !== 'wss:' && url.protocol !== 'ws:') throw new Error('Unsupported server protocol')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}
