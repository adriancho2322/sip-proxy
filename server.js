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
  let tcpConnected = false;

  const client = net.connect(TARGET_PORT, TARGET_HOST, () => {
    tcpConnected = true;
    console.log('TCP connected to ' + TARGET_HOST + ':' + TARGET_PORT);
    ws.send(JSON.stringify({ type: 'debug', msg: 'TCP conectado a ' + TARGET_HOST }));
  });

  ws.on('message', (data) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (tcpConnected) {
      client.write(buf);
    } else {
      console.log('TCP not ready yet, buffering message');
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

  client.on('close', (hadError) => {
    console.log('TCP closed (hadError=' + hadError + ')');
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
    client.destroy();
  });

  client.on('error', (err) => {
    console.error('TCP error connecting to', TARGET_HOST + ':' + TARGET_PORT, err.message);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'debug', msg: 'Error TCP: ' + err.message }));
      ws.close(1011, 'TCP error: ' + err.message);
    }
  });

  // Timeout si TCP no conecta en 15s
  setTimeout(() => {
    if (!tcpConnected && ws.readyState === WebSocket.OPEN) {
      const msg = 'Timeout conectando a ' + TARGET_HOST + ':' + TARGET_PORT;
      console.error(msg);
      ws.send(JSON.stringify({ type: 'debug', msg: msg }));
      ws.close(1011, msg);
    }
  }, 15000);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
