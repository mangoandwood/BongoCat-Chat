import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

const port = Number(process.env.PORT || 8787)
const rooms = new Map()
const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
  response.end('BongoCat chat relay is running.')
})
const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 * 1024 })

wss.on('connection', (socket, request) => {
  const url = new URL(request.url, `http://${request.headers.host}`)
  const room = url.searchParams.get('room')?.trim()
  if (!room || room.length > 48) return socket.close(1008, 'Invalid room')

  const clientId = url.searchParams.get('clientId')?.trim()
  if (!clientId || clientId.length > 80) return socket.close(1008, 'Invalid client')
  if (!rooms.has(room)) rooms.set(room, new Map())
  const peers = rooms.get(room)
  if (!peers.has(clientId) && peers.size >= 2) return socket.close(1008, 'Room is full')
  if (!peers.has(clientId)) peers.set(clientId, new Set())
  peers.get(clientId).add(socket)

  socket.on('message', (data) => {
    let message
    try {
      message = JSON.parse(data.toString())
    } catch {
      return
    }
    if (message.room !== room || message.senderId !== clientId || !['chat', 'activity', 'file'].includes(message.type)) return
    if (message.type === 'chat' && (typeof message.text !== 'string' || message.text.length > 2000)) return
    if (message.type === 'activity' && (typeof message.value !== 'string' || message.value.length > 80)) return
    if (message.type === 'file' && (typeof message.data !== 'string' || message.data.length > 7 * 1024 * 1024)) return
    const payload = JSON.stringify(message)
    for (const connections of peers.values()) {
      for (const peer of connections) {
        if (peer !== socket && peer.readyState === peer.OPEN) peer.send(payload)
      }
    }
  })

  socket.on('close', () => {
    const connections = peers.get(clientId)
    connections?.delete(socket)
    if (!connections?.size) peers.delete(clientId)
    if (!peers.size) rooms.delete(room)
  })
})

server.listen(port, '0.0.0.0', () => {
  console.log(`BongoCat chat relay listening on port ${port}`)
})
