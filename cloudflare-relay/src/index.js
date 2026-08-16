const MAX_ROOM_LENGTH = 48
const MAX_CLIENT_LENGTH = 80
const MAX_TEXT_LENGTH = 2000
const MAX_ACTIVITY_LENGTH = 80
const MAX_FILE_DATA_LENGTH = 7 * 1024 * 1024

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return json({
        ok: true,
        service: 'BongoCat Chat Relay',
        usage: 'Please connect with wss:// and the room/clientId query parameters.',
      })
    }

    const room = url.searchParams.get('room')?.trim() || ''
    const clientId = url.searchParams.get('clientId')?.trim() || ''
    if (!room || room.length > MAX_ROOM_LENGTH || !clientId || clientId.length > MAX_CLIENT_LENGTH) {
      return json({ ok: false, error: 'Invalid room or clientId' }, 400)
    }

    const roomObject = env.ROOMS.getByName(room)
    return roomObject.fetch(request)
  },
}

export class ChatRoom {
  constructor(state) {
    this.state = state
  }

  async fetch(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return json({ ok: false, error: 'WebSocket required' }, 426)
    }

    const url = new URL(request.url)
    const room = url.searchParams.get('room')?.trim() || ''
    const clientId = url.searchParams.get('clientId')?.trim() || ''
    const connectedClients = new Set(
      this.state.getWebSockets().map(socket => socket.deserializeAttachment()?.clientId).filter(Boolean),
    )
    if (!connectedClients.has(clientId) && connectedClients.size >= 2) {
      return json({ ok: false, error: 'Room is full' }, 403)
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    server.serializeAttachment({ clientId, room })
    this.state.acceptWebSocket(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(socket, data) {
    if (typeof data !== 'string') return
    const attachment = socket.deserializeAttachment() || {}
    let message
    try {
      message = JSON.parse(data)
    } catch {
      return
    }

    if (message.room !== attachment.room || message.senderId !== attachment.clientId) return
    if (!['chat', 'activity', 'file'].includes(message.type)) return
    if (message.type === 'chat' && (typeof message.text !== 'string' || message.text.length > MAX_TEXT_LENGTH)) return
    if (message.type === 'activity' && (typeof message.value !== 'string' || message.value.length > MAX_ACTIVITY_LENGTH)) return
    if (message.type === 'file' && (typeof message.data !== 'string' || message.data.length > MAX_FILE_DATA_LENGTH)) return

    for (const peer of this.state.getWebSockets()) {
      if (peer !== socket) {
        try {
          peer.send(data)
        } catch { /* A closed peer is removed by the runtime. */ }
      }
    }
  }

  async webSocketClose(socket, code, reason) {
    socket.close(code, reason)
  }

  async webSocketError(socket) {
    try {
      socket.close(1011, 'WebSocket error')
    } catch { /* Already closed. */ }
  }
}
