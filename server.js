const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const net = require('net');
const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 80;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SIP_HOST = 'webdial.keepcalling.net';
const SIP_PORT = 5060;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  if (req.url === '/') {
    serveFile('index.html', res);
  } else if (req.url === '/jssip.js') {
    serveFile('jssip.js', res);
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

// WebSocket SIP proxy: cada conexión WS -> TCP al proveedor SIP
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  const tcp = net.createConnection(SIP_PORT, SIP_HOST, () => {
    console.log('TCP connected to ' + SIP_HOST + ':' + SIP_PORT);
  });

  let tcpBuffer = '';

  ws.on('message', (raw) => {
    const data = typeof raw === 'string' ? raw : raw.toString();
    console.log('WS->TCP:', data.trimEnd());
    tcp.write(data);
  });

  function parseContentLength(headers) {
    const m = headers.match(/^Content-Length:\s*(\d+)/im);
    return m ? parseInt(m[1], 10) : 0;
  }

  tcp.on('data', (chunk) => {
    tcpBuffer += chunk.toString();
    while (true) {
      const idx = tcpBuffer.indexOf('\r\n\r\n');
      if (idx === -1) break;
      const headerPart = tcpBuffer.substring(0, idx);
      const clen = parseContentLength(headerPart);
      const totalLen = idx + 4 + clen;
      if (tcpBuffer.length < totalLen) break;
      const msg = tcpBuffer.substring(0, totalLen);
      tcpBuffer = tcpBuffer.substring(totalLen);
      console.log('TCP->WS:', msg.trimEnd());
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  });

  tcp.on('close', () => {
    console.log('TCP closed');
    ws.close();
  });

  tcp.on('error', (err) => {
    console.error('TCP error:', err.message);
    ws.close();
  });

  ws.on('close', () => {
    console.log('WS closed');
    tcp.destroy();
  });

  ws.on('error', (err) => {
    console.error('WS error:', err.message);
    tcp.destroy();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Server listening on port ' + PORT);
});
