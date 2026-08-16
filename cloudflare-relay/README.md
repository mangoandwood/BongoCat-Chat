# BongoCat Chat Cloudflare Relay

这是 BongoCat 双人聊天版的无存储实时转发服务器。每个部署者使用自己的 Cloudflare Workers 免费额度；服务器不保存聊天记录和文件。

## 一键部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/mangoandwood/BongoCat-Chat/tree/main/cloudflare-relay)

部署成功后，访问 Cloudflare 给出的 `https://xxx.workers.dev` 地址。如果页面显示 `"ok":true`，服务器已经正常运行。

在 BongoCat 中既可以粘贴 `https://xxx.workers.dev`，也可以粘贴 `wss://xxx.workers.dev`；软件会自动转换。

同一对聊天用户必须使用相同的服务器地址和房间码。只需其中一人部署，另一人无需 Cloudflare 账号。

## 隐私

- 服务器只转发当前在线连接之间的数据。
- Durable Object 不写入存储。
- 聊天历史仅保存在双方电脑。
- 房间码相当于房间密码，请使用软件生成的随机房间码。
