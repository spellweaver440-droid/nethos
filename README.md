# NethOS — Network Media Sync Server

A local LAN-based media sharing + synchronized playback server and client UI. Run `nethos-server.js` on your machine, open `nethos.html` in browser(s), and watch/stream shared files in sync across devices.

## 🔧 Features

- Express-based REST API for file listing, upload, delete, and playback state
- WebSocket-based real-time sync: playback, seek, chat, file events, peer join/leave
- Range-aware stream serving for media seeking support (`/files/:name`)
- Drag/drop upload + built-in audio/video player and playlist
- YouTube download integration via `yt-dlp` (backend) to `nethos-downloads`
- Auto detects local IP and publishes in UI

## 📦 Requirements

- Node.js (18+ recommended but 16+ should work)
- `npm install`
- `yt-dlp` for YouTube download support (optional)

## 🛠️ Setup

From repo root:

```bash
npm install
# if you use YouTube downloader (optional)
pip install yt-dlp
```

## ▶ Run

```bash
node nethos-server.js
```

Open browser on host or LAN clients:

- `http://localhost:3000/nethos.html`
- `http://<host-ip>:3000/nethos.html`

## 📁 File sharing flow

1. Open `nethos.html` after server starts.
2. Upload files via the `Files` panel.
3. Uploaded files go to `nethos-files/` and are available at `http://<ip>:3000/files/<filename>`.
4. In `Media`, load and play files. Playback commands broadcast to peers.

## 🔌 API Endpoints

- `GET /api/info` — server info and peer count
- `GET /api/files` — list shared files
- `POST /api/upload` — upload files as `multipart/form-data` field `files`
- `DELETE /api/files/:name` — delete shared file
- `GET /api/downloads` — list downloaded files
- `POST /api/download` — download from YouTube: `{url, type: "video"|"audio"}`
- `GET /api/playback` — current playback state
- `GET /api/peers` — connected peers

## ⚙️ WebSocket events

- Send:
  - `play`, `pause`, `seek`, `track_change`, `chat`, `set_name`, `file_added`
- Receive:
  - `welcome`, `peer_joined`, `peer_left`, `play`, `pause`, `seek`, `track_change`, `chat`, `peer_renamed`, `file_added`, `file_deleted`, `server_shutdown`

## 🗂️ Directory structure

- `nethos-server.js` — server and WebSocket implementation
- `nethos.html` — front-end UI + front-end JavaScript
- `nethos-files/` — uploaded media share folder
- `nethos-downloads/` — YouTube download output

## ✅ GitHub push instructions

Already applied in this PR:

```bash
git add README.md
git commit -m "docs: add README and usage guide"
git push
```

## 💡 Tips

- Use a fixed local IP (or static DHCP lease) for stable sharing on LAN.
- For public use, put this behind a reverse proxy and HTTPS if opening to internet.
- Restart server after dependencies update.
