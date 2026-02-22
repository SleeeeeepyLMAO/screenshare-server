const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // POST /frame/:code — phone sends a JPEG frame
  if (req.method === 'POST' && req.url.startsWith('/frame/')) {
    const code = req.url.split('/frame/')[1];
    let chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const frameData = Buffer.concat(chunks);
      if (!sessions[code]) sessions[code] = { viewers: [], lastFrame: null };
      sessions[code].lastFrame = frameData; // store latest frame
      // Forward to all connected viewers
      sessions[code].viewers.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.send(frameData);
      });
      res.writeHead(200);
      res.end('ok');
    });
    return;
  }

  // POST /session/:code/start
  if (req.method === 'POST' && req.url.startsWith('/session/') && req.url.endsWith('/start')) {
    const code = req.url.split('/session/')[1].split('/start')[0];
    sessions[code] = { viewers: [], lastFrame: null };
    console.log(`[+] Session started: ${code}`);
    res.writeHead(200);
    res.end('ok');
    return;
  }

  // POST /session/:code/stop
  if (req.method === 'POST' && req.url.startsWith('/session/') && req.url.endsWith('/stop')) {
    const code = req.url.split('/session/')[1].split('/stop')[0];
    if (sessions[code]) {
      sessions[code].viewers.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: 'disconnected' }));
      });
      delete sessions[code];
    }
    console.log(`[-] Session stopped: ${code}`);
    res.writeHead(200);
    res.end('ok');
    return;
  }

  // GET /session/:code/check
  if (req.method === 'GET' && req.url.startsWith('/session/') && req.url.endsWith('/check')) {
    const code = req.url.split('/session/')[1].split('/check')[0];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ active: !!sessions[code] }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocket.Server({ server });
const sessions = {};

wss.on('connection', (ws, req) => {
  if (!req.url.startsWith('/watch/')) { ws.close(); return; }
  const code = req.url.split('/watch/')[1];

  console.log(`[+] Viewer connected for code: ${code}`);

  if (!sessions[code]) {
    ws.send(JSON.stringify({ type: 'error', message: 'Invalid code' }));
    ws.close();
    return;
  }

  sessions[code].viewers.push(ws);

  // Send the last frame immediately so viewer doesn't wait
  if (sessions[code].lastFrame) {
    ws.send(sessions[code].lastFrame);
  }

  ws.on('close', () => {
    if (sessions[code]) {
      sessions[code].viewers = sessions[code].viewers.filter(v => v !== ws);
    }
    console.log(`[-] Viewer disconnected for code: ${code}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`ScreenShare server running on port ${PORT}`));