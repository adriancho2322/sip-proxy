const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const net = require('net');
const dns = require('dns');

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
  let connected = false;
  let client = null;
  let bufQueue = [];

  // Mostrar resolución DNS
  dns.resolve4(TARGET_HOST, (err, addresses) => {
    const ip = err ? 'error: ' + err.message : addresses.join(', ');
    console.log('DNS resolve ' + TARGET_HOST + ' -> ' + ip);
    ws.send(JSON.stringify({ type: 'debug', msg: 'DNS: ' + TARGET_HOST + ' = ' + ip }));
  });

  function connectToTarget() {
    // Intentar primero WebSocket
    const wsUrl = 'ws://' + TARGET_HOST + ':' + TARGET_PORT;
    console.log('Attempting WS connection to', wsUrl);

    try {
      client = new WebSocket(wsUrl);

      client.on('open', () => {
        connected = true;
        console.log('WS connected to target');
        ws.send(JSON.stringify({ type: 'debug', msg: 'Conectado a ' + TARGET_HOST + ' vía WebSocket' }));
        // Enviar mensajes encolados
        for (const msg of bufQueue) {
          client.send(msg);
        }
        bufQueue = [];
      });

      client.on('message', (data) => {
        if (ws.readyState === WebSocket.OPEN) {
          const raw = typeof data === 'string' ? data : data.toString();
          console.log('Target -> Client:', raw.substring(0, 120));
          ws.send(data);
        }
      });

      client.on('close', (code, reason) => {
        console.log('Target WS closed:', code, reason ? reason.toString() : '');
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'debug', msg: 'Conexión con target cerrada (' + code + ')' }));
          ws.close();
        }
      });

      client.on('error', (err) => {
        console.error('Target WS error:', err.message);
        ws.send(JSON.stringify({ type: 'debug', msg: 'Error WS target: ' + err.message }));
        // Fallback a TCP
        fallbackToTCP();
      });
    } catch (e) {
      console.error('Failed to create WS:', e.message);
      fallbackToTCP();
    }
  }

  function fallbackToTCP() {
    if (connected) return;
    console.log('Falling back to TCP...');
    ws.send(JSON.stringify({ type: 'debug', msg: 'WebSocket directo falló, intentando TCP...' }));

    try {
      client = net.connect(TARGET_PORT, TARGET_HOST, () => {
        connected = true;
        const addr = client.remoteAddress || '?';
        console.log('TCP connected to', TARGET_HOST, addr + ':' + TARGET_PORT);
        ws.send(JSON.stringify({ type: 'debug', msg: 'TCP conectado a ' + TARGET_HOST + ' (' + addr + ')' }));
        for (const msg of bufQueue) {
          client.write(typeof msg === 'string' ? msg : Buffer.from(msg));
        }
        bufQueue = [];
      });

      client.on('data', (data) => {
        const str = data.toString();
        console.log('Target TCP -> Client:', str.substring(0, 120));
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      client.on('close', (hadError) => {
        console.log('TCP closed, hadError=' + hadError);
        if (ws.readyState === WebSocket.OPEN) ws.close();
      });

      client.on('error', (err) => {
        console.error('TCP error:', err.message);
        ws.send(JSON.stringify({ type: 'debug', msg: 'Error TCP: ' + err.message }));
        if (ws.readyState === WebSocket.OPEN) ws.close();
      });
    } catch (e) {
      console.error('TCP connect failed:', e.message);
      ws.send(JSON.stringify({ type: 'debug', msg: 'Error: ' + e.message }));
    }

    timeout = setTimeout(() => {
      if (!connected && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'debug', msg: 'Timeout conectando a ' + TARGET_HOST }));
        ws.close(1011, 'Timeout');
      }
    }, 15000);
  }

  let timeout = setTimeout(() => {
    if (!connected && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'debug', msg: 'Timeout conectando a ' + TARGET_HOST }));
      ws.close(1011, 'Timeout');
    }
  }, 15000);

  ws.on('message', (data) => {
    const msg = Buffer.isBuffer(data) ? data.toString() : data;
    console.log('Client -> Target:', (typeof msg === 'string' ? msg.substring(0, 120) : 'buffer'));
    if (connected && client) {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(msg);
      } else if (client.writable) {
        client.write(msg);
      }
    } else {
      bufQueue.push(msg);
    }
  });

  ws.on('close', () => {
    console.log('Client WebSocket closed');
    if (timeout) clearTimeout(timeout);
    if (client) {
      if (client.close) client.close();
      if (client.destroy) client.destroy();
    }
  });

  ws.on('error', (err) => {
    console.error('Client WS error:', err.message);
    if (client) {
      if (client.close) client.close();
      if (client.destroy) client.destroy();
    }
  });

  // Iniciar conexión
  connectToTarget();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
