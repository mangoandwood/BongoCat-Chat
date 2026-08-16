# BongoCat chat relay

This server only forwards live messages between the two clients in a room. It does not store messages.

```bash
npm install
npm start
```

The default port is `8787`; hosting platforms can set the `PORT` environment variable. Use a hosting provider that supports WebSockets, and enter its `wss://` address in both desktop clients.
