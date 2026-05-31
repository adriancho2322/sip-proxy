const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const net = require('net');
const dns = require('dns');

const PORT = process.env.PORT || 80;
const TARGET_HOST = 'webdial.keepcalling.net';
const TARGET_PORTS = [8080, 443, 5060];
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
  let connected = false;
  let client = null;
  let bufQueue = [];
  let tryIndex = 0;
  let reconnectTimer = null;

  function sendDebug(msg) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'debug', msg: msg }));
    }
  }

  dns.resolve4(TARGET_HOST, (err, addresses) => {
    const ip = err ? 'error: ' + err.message : addresses.join(', ');
    console.log('DNS resolve ' + TARGET_HOST + ' -> ' + ip);
    sendDebug('DNS: ' + TARGET_HOST + ' = ' + ip);
  });

  function tryConnect() {
    if (connected || tryIndex >= TARGET_PORTS.length) {
      tryIndex = 0;
      return;
    }

    const port = TARGET_PORTS[tryIndex];
    console.log('Trying ' + TARGET_HOST + ':' + port);
    sendDebug('Conectando a ' + TARGET_HOST + ':' + port + ' (TCP)...');

    client = net.connect(port, TARGET_HOST, () => {
      connected = true;
      sendDebug('Conectado a ' + TARGET_HOST + ':' + port);
      console.log('TCP connected to', TARGET_HOST + ':' + port);

      // Iniciar handshake con el navegador
      ws.send(JSON.stringify({ HaveSessionQ: true, reqID: "0" }));
      console.log('Sent HaveSessionQ to browser');

      for (const msg of bufQueue) {
        client.write(typeof msg === 'string' ? msg : Buffer.from(msg));
      }
      bufQueue = [];
    });

    client.on('data', (data) => {
      const str = data.toString();
      console.log('Target -> Client:', str.substring(0, 120));
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    client.on('close', () => {
      connected = false;
      console.log('Connection to ' + TARGET_HOST + ':' + port + ' closed');
      if (tryIndex < TARGET_PORTS.length - 1) {
        tryIndex++;
        sendDebug('Puerto ' + port + ' cerrado, probando ' + TARGET_PORTS[tryIndex] + '...');
        tryConnect();
      } else {
        sendDebug('Todos los puertos fallaron, reintentando en 5s...');
        reconnectTimer = setTimeout(() => { tryIndex = 0; tryConnect(); }, 5000);
      }
    });

    client.on('error', (err) => {
      connected = false;
      console.error('Error connecting to', TARGET_HOST + ':' + port, err.message);
      sendDebug('Error en puerto ' + port + ': ' + err.message);
      client.destroy();
    });
  }

  ws.on('message', (data) => {
    const msg = Buffer.isBuffer(data) ? data.toString() : data;
    if (connected && client && !client.destroyed) {
      client.write(typeof msg === 'string' ? msg : Buffer.from(msg));
    } else {
      bufQueue.push(msg);
    }
  });

  ws.on('close', () => {
    console.log('Browser WebSocket closed');
    if (client && !client.destroyed) client.destroy();
    connected = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
  });

  ws.on('error', (err) => {
    console.error('Browser WS error:', err.message);
    if (client && !client.destroyed) client.destroy();
    connected = false;
  });

  tryConnect();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
