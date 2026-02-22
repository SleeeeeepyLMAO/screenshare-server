const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, 'web', req.url === '/' ? 'index.html' : req.url);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
    res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'text/plain' });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

// sessions[code] = { phone: ws, viewers: [ws] }
const sessions = {};

wss.on('connection', (ws) => {
  let role = null;
  let code = null;

  ws.on('message', (msg) => {
    // Binary = JPEG frame from phone → forward to all viewers
    if (Buffer.isBuffer(msg) && role === 'phone') {
      if (sessions[code]) {
        sessions[code].viewers.forEach(v => {
          if (v.readyState === WebSocket.OPEN) v.send(msg);
        });
      }
      return;
    }

    let data;
    try { data = JSON.parse(msg); } catch { return; }

    // ── Phone registration ──
    if (data.type === 'register_phone') {
      code = data.code;
      role = 'phone';
      sessions[code] = { phone: ws, viewers: [] };
      ws.send(JSON.stringify({ type: 'registered', code }));
      console.log(`[+] Phone registered: ${code}`);
    }

    // ── WebRTC: phone sends offer ──
    else if (data.type === 'offer') {
      if (sessions[code]) {
        sessions[code].offer = data.sdp;
        // forward to any already-waiting viewer
        sessions[code].viewers.forEach(v => {
          if (v.readyState === WebSocket.OPEN)
            v.send(JSON.stringify({ type: 'offer', sdp: data.sdp }));
        });
      }
    }

    // ── WebRTC: viewer sends answer ──
    else if (data.type === 'answer') {
      if (sessions[code]?.phone?.readyState === WebSocket.OPEN)
        sessions[code].phone.send(JSON.stringify({ type: 'answer', sdp: data.sdp }));
    }

    // ── ICE candidates (both directions) ──
    else if (data.type === 'ice_candidate') {
      if (role === 'phone') {
        sessions[code]?.viewers.forEach(v => {
          if (v.readyState === WebSocket.OPEN)
            v.send(JSON.stringify({ type: 'ice_candidate', candidate: data.candidate }));
        });
      } else {
        if (sessions[code]?.phone?.readyState === WebSocket.OPEN)
          sessions[code].phone.send(JSON.stringify({ type: 'ice_candidate', candidate: data.candidate }));
      }
    }

    // ── Viewer joins ──
    else if (data.type === 'join_viewer') {
      code = data.code;
      role = 'viewer';
      if (!sessions[code] || !sessions[code].phone) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid or inactive code' }));
        return;
      }
      sessions[code].viewers.push(ws);
      ws.send(JSON.stringify({ type: 'joined', code }));
      // If phone already sent an offer, relay it now
      if (sessions[code].offer) {
        ws.send(JSON.stringify({ type: 'offer', sdp: sessions[code].offer }));
      }
      // Tell phone
      if (sessions[code].phone.readyState === WebSocket.OPEN)
        sessions[code].phone.send(JSON.stringify({ type: 'viewer_joined' }));
      console.log(`[+] Viewer joined: ${code}`);
    }

    // ── Touch from viewer → phone ──
    else if (data.type === 'touch') {
      if (sessions[code]?.phone?.readyState === WebSocket.OPEN)
        sessions[code].phone.send(JSON.stringify(data));
    }
  });

  ws.on('close', () => {
    if (!code || !sessions[code]) return;
    if (role === 'phone') {
      sessions[code].viewers.forEach(v => {
        if (v.readyState === WebSocket.OPEN)
          v.send(JSON.stringify({ type: 'disconnected' }));
      });
      delete sessions[code];
      console.log(`[-] Phone disconnected: ${code}`);
    } else if (role === 'viewer') {
      sessions[code].viewers = sessions[code].viewers.filter(v => v !== ws);
      if (sessions[code].phone?.readyState === WebSocket.OPEN)
        sessions[code].phone.send(JSON.stringify({ type: 'viewer_left' }));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`ScreenShare server → http://localhost:${PORT}`));