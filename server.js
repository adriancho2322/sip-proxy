const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const net = require('net');

const PORT = process.env.PORT || 80;
const TARGET_HOST = 'webdial.keepcalling.net';
const TARGET_PORT = 5060;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  if (req.url === '/') {
    serveFile('index.html', res);
  } else if (req.url.startsWith('/tts?')) {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const text = params.get('text');
    if (!text) { res.writeHead(400); res.end('Missing text'); return; }
    const lang = params.get('tl') || 'es';
    const ttsUrl = 'https://translate.google.com/translate_tts?ie=UTF-8&q=' + encodeURIComponent(text) + '&tl=' + lang + '&client=tw-ob';
    https.get(ttsUrl, (ttsRes) => {
      res.writeHead(ttsRes.statusCode, {
        'Content-Type': ttsRes.headers['content-type'] || 'audio/mpeg',
      });
      ttsRes.pipe(res);
    }).on('error', (e) => {
      res.writeHead(500); res.end('TTS error: ' + e.message);
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

function serveFile(name, res) {
  const filePath = path.join(PUBLIC_DIR, name);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end('Error loading page');
      return;
    }
    const ext = path.extname(name);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
    res.end(data);
  });
}

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  const client = net.connect(TARGET_PORT, TARGET_HOST, () => {
    console.log('TCP connected to', TARGET_HOST);
  });

  ws.on('message', (data) => {
    if (Buffer.isBuffer(data)) {
      client.write(data);
    } else {
      client.write(data);
    }
  });

  client.on('data', (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket closed');
    client.destroy();
  });

  client.on('close', () => {
    console.log('TCP closed');
    ws.close();
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
    client.destroy();
  });

  client.on('error', (err) => {
    console.error('TCP error:', err.message);
    ws.close();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
