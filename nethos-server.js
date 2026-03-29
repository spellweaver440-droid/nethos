// ╔══════════════════════════════════════════════════════╗
// ║         NethOS Server v2.0 — Real-Time Sync          ║
// ╠══════════════════════════════════════════════════════╣
// ║  INSTALL:  npm install express cors multer ws        ║
// ║  OPTIONAL: pip install yt-dlp                        ║
// ║  START:    node nethos-server.js                     ║
// ║  STOP:     Ctrl+C  (closes all sharing)              ║
// ╚══════════════════════════════════════════════════════╝

const express  = require('express');
const cors     = require('cors');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const http     = require('http');
const { exec } = require('child_process');
const WebSocket = require('ws');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });
const PORT   = process.env.PORT || 3000;

// ── Folders ──
const SHARE    = path.join(__dirname, 'nethos-files');
const DOWNLOAD = path.join(__dirname, 'nethos-downloads');
[SHARE, DOWNLOAD].forEach(d => { if(!fs.existsSync(d)) fs.mkdirSync(d, {recursive:true}); });

// ── Multer (file uploads) ──
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, SHARE),
  filename:    (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));        // serves nethos.html

// ── Range-aware static file serving for media streaming ──
// This allows video/audio seeking to work on all devices
app.get('/files/:name', (req, res) => {
  const fp = path.join(SHARE, decodeURIComponent(req.params.name));
  if(!fs.existsSync(fp)) return res.status(404).send('Not found');
  const stat = fs.statSync(fp);
  const total = stat.size;
  const range = req.headers.range;
  const ext = path.extname(fp).toLowerCase();
  const mimeMap = {
    '.mp4':'video/mp4','.mkv':'video/x-matroska','.webm':'video/webm',
    '.mov':'video/quicktime','.avi':'video/x-msvideo',
    '.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg',
    '.flac':'audio/flac','.aac':'audio/aac','.m4a':'audio/mp4',
  };
  const mime = mimeMap[ext] || 'application/octet-stream';
  if(range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end   = endStr ? parseInt(endStr, 10) : total - 1;
    const chunk = end - start + 1;
    res.writeHead(206, {
      'Content-Range':  `bytes ${start}-${end}/${total}`,
      'Accept-Ranges':  'bytes',
      'Content-Length': chunk,
      'Content-Type':   mime,
    });
    fs.createReadStream(fp, {start, end}).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': total,
      'Content-Type':   mime,
      'Accept-Ranges':  'bytes',
    });
    fs.createReadStream(fp).pipe(res);
  }
});

app.use('/downloads', express.static(DOWNLOAD));

// ══════════════════════════════════════════
//  WEBSOCKET — Real-Time Sync Hub
// ══════════════════════════════════════════
let clients = new Map(); // ws -> { id, name }
let clientCounter = 0;

// Shared playback state
let playbackState = {
  file:     null,   // filename
  url:      null,   // full URL
  playing:  false,
  time:     0,
  updatedAt: Date.now()
};

function broadcast(data, excludeWs = null) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(ws => {
    if(ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  });
}

function broadcastAll(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(ws => {
    if(ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

wss.on('connection', (ws, req) => {
  const id   = ++clientCounter;
  const ip   = req.socket.remoteAddress;
  const name = `Device-${id}`;
  clients.set(ws, { id, name, ip });

  console.log(`[+] ${name} connected (${ip})  [${wss.clients.size} online]`);

  // Send welcome + current state to new client
  ws.send(JSON.stringify({
    type: 'welcome',
    id, name,
    peers: [...clients.values()].map(c => ({id:c.id, name:c.name})),
    playback: playbackState,
    files: getFileList()
  }));

  // Tell everyone else a new peer joined
  broadcast({ type:'peer_joined', peer:{id,name} }, ws);

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch(e) { return; }
    const client = clients.get(ws);

    switch(msg.type) {

      // ── Playback sync ──
      case 'play':
        playbackState = { file: msg.file, url: msg.url, playing: true,  time: msg.time||0, updatedAt: Date.now() };
        broadcast({ type:'play', file:msg.file, url:msg.url, time:msg.time||0, by:client.name }, ws);
        console.log(`[▶] ${client.name} playing "${msg.file}" at ${msg.time}s`);
        break;

      case 'pause':
        playbackState.playing  = false;
        playbackState.time     = msg.time||0;
        playbackState.updatedAt = Date.now();
        broadcast({ type:'pause', time:msg.time||0, by:client.name }, ws);
        console.log(`[⏸] ${client.name} paused at ${msg.time}s`);
        break;

      case 'seek':
        playbackState.time      = msg.time||0;
        playbackState.updatedAt = Date.now();
        broadcast({ type:'seek', time:msg.time, by:client.name }, ws);
        console.log(`[⏩] ${client.name} seeked to ${msg.time}s`);
        break;

      case 'track_change':
        playbackState = { file:msg.file, url:msg.url, playing:true, time:0, updatedAt:Date.now() };
        broadcast({ type:'track_change', file:msg.file, url:msg.url, by:client.name }, ws);
        console.log(`[🎵] ${client.name} changed track to "${msg.file}"`);
        break;

      // ── Chat ──
      case 'chat':
        broadcastAll({ type:'chat', from:client.name, text:msg.text, at: Date.now() });
        break;

      // ── Rename ──
      case 'set_name':
        client.name = msg.name.substring(0,20);
        broadcastAll({ type:'peer_renamed', id:client.id, name:client.name });
        break;

      // ── File notify ──
      case 'file_added':
        broadcast({ type:'file_added', file:msg.file, by:client.name }, ws);
        break;
    }
  });

  ws.on('close', () => {
    const client = clients.get(ws);
    console.log(`[-] ${client?.name} disconnected  [${wss.clients.size-1} online]`);
    broadcast({ type:'peer_left', id:client?.id, name:client?.name });
    clients.delete(ws);
  });

  ws.on('error', () => clients.delete(ws));
});

// ══════════════════════════════════════════
//  REST API
// ══════════════════════════════════════════

// Server info
app.get('/api/info', (req, res) => {
  res.json({ ip: getLocalIP(), port: PORT, version: '2.0', peers: wss.clients.size });
});

// List shared files
app.get('/api/files', (req, res) => res.json(getFileList()));

// Upload files
app.post('/api/upload', upload.array('files'), (req, res) => {
  const saved = req.files.map(f => ({
    name: f.originalname,
    size: f.size,
    url:  `http://${getLocalIP()}:${PORT}/files/${encodeURIComponent(f.originalname)}`
  }));
  // Notify all connected clients
  saved.forEach(f => broadcastAll({ type:'file_added', file:f }));
  res.json({ ok:true, files: saved });
});

// Delete file
app.delete('/api/files/:name', (req, res) => {
  const fp = path.join(SHARE, req.params.name);
  if(fs.existsSync(fp)) {
    fs.unlinkSync(fp);
    broadcastAll({ type:'file_deleted', name:req.params.name });
    res.json({ ok:true });
  } else {
    res.status(404).json({ error:'Not found' });
  }
});

// List downloads
app.get('/api/downloads', (req, res) => {
  const ip = getLocalIP();
  const files = fs.readdirSync(DOWNLOAD).map(name => ({
    name, size: fs.statSync(path.join(DOWNLOAD,name)).size,
    url: `http://${ip}:${PORT}/downloads/${encodeURIComponent(name)}`
  }));
  res.json(files);
});

// YouTube download
app.post('/api/download', (req, res) => {
  const { url, type } = req.body;
  if(!url) return res.status(400).json({ error:'No URL' });
  const flags = type==='audio'
    ? `-x --audio-format mp3 --audio-quality 0`
    : `-f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"`;
  const cmd = `yt-dlp ${flags} -o "${DOWNLOAD}/%(title)s.%(ext)s" "${url}"`;
  console.log('[yt-dlp]', cmd);
  exec(cmd, {timeout:300000}, (err, stdout, stderr) => {
    if(err) return res.status(500).json({ error: stderr||err.message });
    // notify clients
    broadcastAll({ type:'file_added', file:{ name:'YouTube download complete', url:'' } });
    res.json({ ok:true, output:stdout });
  });
});

// Current playback state
app.get('/api/playback', (req, res) => res.json(playbackState));

// Connected peers
app.get('/api/peers', (req, res) => {
  res.json([...clients.values()].map(c => ({id:c.id, name:c.name, ip:c.ip})));
});

// ── Helpers ──
function getLocalIP() {
  for(const nets of Object.values(os.networkInterfaces())) {
    for(const n of nets) {
      if(n.family==='IPv4' && !n.internal) return n.address;
    }
  }
  return 'localhost';
}

function getFileList() {
  const ip = getLocalIP();
  return fs.readdirSync(SHARE).map(name => ({
    name,
    size: fs.statSync(path.join(SHARE,name)).size,
    url:  `http://${ip}:${PORT}/files/${encodeURIComponent(name)}`
  }));
}

// ── Start ──
const ip = getLocalIP();
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║       NethOS Server v2.0 — LIVE          ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Local:   http://localhost:${PORT}           ║`);
  console.log(`║  Network: http://${ip.padEnd(15)}:${PORT}  ║`);
  console.log(`║  WS:      ws://${ip.padEnd(15)}:${PORT}    ║`);
  console.log(`║  Files:   ${SHARE.slice(-32).padEnd(32)} ║`);
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  npm install express cors multer ws      ║');
  console.log('║  Ctrl+C to stop & close all sharing      ║');
  console.log('╚══════════════════════════════════════════╝\n');
});

process.on('SIGINT', () => {
  console.log('\nNethOS shutting down — all sharing closed.');
  broadcastAll({ type:'server_shutdown' });
  process.exit(0);
});
