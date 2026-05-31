const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');

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
  } else if (req.url === '/testudp') {
    testUdp((r) => { res.writeHead(200); res.end('UDP test: ' + r); });
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

// ---- SIP WebSocket proxy (WS -> TCP) ----
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws) => {
  let tcp = null;
  let tcpConnecting = true;
  let msgBuffer = [];

  function flushBuffer() {
    if (!tcpConnecting && tcp) {
      while (msgBuffer.length > 0) {
        tcp.write(msgBuffer.shift());
      }
    }
  }

  tcp = net.createConnection(SIP_PORT, SIP_HOST, () => {
    console.log('SIP TCP connected');
    tcpConnecting = false;
    flushBuffer();
  });

  tcp.setTimeout(10000);
  tcp.on('timeout', () => { console.log('TCP timeout'); tcp.destroy(); ws.close(); });

  let tcpBuffer = '';

  function parseContentLength(headers) {
    const m = headers.match(/^Content-Length:\s*(\d+)/im);
    return m ? parseInt(m[1], 10) : 0;
  }

  ws.on('message', (raw) => {
    const data = typeof raw === 'string' ? raw : raw.toString();
    if (tcpConnecting || !tcp) {
      msgBuffer.push(data);
    } else {
      tcp.write(data);
    }
  });

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
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  });

  function cleanup() {
    if (tcp) { try { tcp.destroy(); } catch(e) {} tcp = null; }
    if (ws.readyState === WebSocket.OPEN) ws.close();
  }

  tcp.on('close', () => cleanup());
  tcp.on('error', (e) => { console.error('TCP error:', e.message); cleanup(); });
  ws.on('close', () => { if (tcp) { try { tcp.destroy(); } catch(e) {} tcp = null; } });
  ws.on('error', () => { if (tcp) { try { tcp.destroy(); } catch(e) {} tcp = null; } });
});

// ---- Audio WebSocket (PCM16 <-> RTP/UDP bridge) ----
const audioServer = new WebSocket.Server({ server, path: '/audio' });

// Simple PCM16 48kHz -> PCMA 8kHz conversion
function linearToAlaw(sample) {
  // 16-bit signed to 8-bit a-law
  const SIGN = 0x80;
  const CLIP = 0x7f;
  if (sample >= 0) {
    const mask = 0xD5;
    if (sample > CLIP) sample = CLIP;
    sample = sample | 0x80;
  } else {
    const mask = 0x55;
    sample = -sample;
    if (sample > CLIP) sample = CLIP;
    sample = sample | 0x80;
    let seg = (sample >> 4) & 0x0f;
    if (seg >= 8) return ((seg << 4) | ((sample >> (seg - 4)) & 0x0f)) ^ mask;
  }
  let seg = (sample >> 4) & 0x0f;
  if (seg >= 8) return ((seg << 4) | ((sample >> (seg - 4)) & 0x0f)) ^ 0xD5;
  return ((seg << 4) | ((sample >> (seg >= 4 ? seg - 4 : 0)) & 0x0f)) ^ 0xD5;
}

audioServer.on('connection', (ws) => {
  let relay = null; // { rtpIp, rtpPort, ssrc, seq, ts, sock }
  let pcmInputBuffer = Buffer.alloc(0); // buffer raw PCM16 input
  let pcmOutputBuffer = Buffer.alloc(0); // buffer raw PCM16 for output

  function startRelay(info) {
    stopRelay();
    const sock = dgram.createSocket('udp4');
    sock.on('error', (e) => console.error('RTP socket error:', e.message));
    sock.on('message', (msg) => {
      // Receive RTP from provider -> extract PCM -> send to browser
      if (msg.length < 12) return;
      const pt = msg.readUInt8(1) & 0x7f;
      if (pt !== 8 && pt !== 0) return; // skip non-audio
      const payload = msg.subarray(12);
      // Decompress a-law to PCM16
      const pcm16 = Buffer.alloc(payload.length * 2);
      for (let i = 0; i < payload.length; i++) {
        const alaw = payload[i] ^ 0xD5;
        let sign = (alaw & 0x80) ? -1 : 1;
        let exponent = (alaw >> 4) & 0x07;
        let mantissa = alaw & 0x0f;
        let sample = sign * ((exponent === 0 ? mantissa : ((mantissa << 3) | 0x84)) << (exponent + 4));
        pcm16.writeInt16LE(sample, i * 2);
      }
      pcmOutputBuffer = Buffer.concat([pcmOutputBuffer, pcm16]);
      // Send buffered PCM to browser
      while (pcmOutputBuffer.length >= 192) { // 96 samples @ 48kHz = 2ms buffer
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(pcmOutputBuffer.subarray(0, 192));
        }
        pcmOutputBuffer = pcmOutputBuffer.subarray(192);
      }
    });

    sock.bind(0, '0.0.0.0', () => {
      const addr = sock.address();
      console.log('RTP relay bound to :' + addr.port);
      relay = {
        sock,
        rtpIp: info.rtpIp,
        rtpPort: info.rtpPort,
        ssrc: info.ssrc || Math.floor(Math.random() * 0xFFFFFFFF),
        seq: 0,
        ts: 0,
      };
      ws.send(JSON.stringify({ type: 'relay_ready', localPort: addr.port }));
    });
  }

  function stopRelay() {
    if (relay && relay.sock) {
      try { relay.sock.close(); } catch (e) {}
    }
    relay = null;
    pcmInputBuffer = Buffer.alloc(0);
  }

  ws.on('message', (raw) => {
    if (typeof raw === 'string') {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'start') {
          startRelay(msg);
        } else if (msg.type === 'stop') {
          stopRelay();
        }
      } catch (e) {}
      return;
    }

    // Binary = PCM16 input from browser @ 48kHz
    if (!relay) return;
    pcmInputBuffer = Buffer.concat([pcmInputBuffer, raw]);

    // Flush 20ms of audio @ 8kHz = 160 PCMA samples
    const pcm16Samples = pcmInputBuffer.length / 2;
    const targetSamples = 160 * 6; // 960 PCM16 samples @ 48kHz = 20ms = 160 PCMA @ 8kHz
    if (pcm16Samples >= targetSamples) {
      const packet = pcmInputBuffer.subarray(0, targetSamples * 2);
      pcmInputBuffer = pcmInputBuffer.subarray(targetSamples * 2);

      // Downsample 48kHz -> 8kHz (take every 6th sample) and encode PCMA
      const pcma = Buffer.alloc(160);
      for (let i = 0; i < 160; i++) {
        const sample = packet.readInt16LE(i * 12); // every 6th sample at 48kHz
        pcma[i] = linearToAlaw(sample);
      }

      // Build RTP header
      const rtp = Buffer.alloc(12 + 160);
      rtp[0] = 0x80; // V=2, P=0, X=0, CC=0
      rtp[1] = 0x88; // M=1 (first in talkspurt), PT=8 (PCMA)
      rtp.writeUInt16BE(relay.seq, 2);
      rtp.writeUInt32BE(relay.ts, 4);
      rtp.writeUInt32BE(relay.ssrc, 8);
      pcma.copy(rtp, 12);

      relay.seq = (relay.seq + 1) & 0xFFFF;
      relay.ts += 160;

      relay.sock.send(rtp, 0, rtp.length, relay.rtpPort, relay.rtpIp, (err) => {
        if (err) console.error('RTP send error:', err.message);
      });
    }
  });

  ws.on('close', () => stopRelay());
  ws.on('error', () => stopRelay());
});

function testUdp(callback) {
  const sock = dgram.createSocket('udp4');
  let result = 'ok';
  sock.on('error', (err) => { result = 'error: ' + err.message; });
  sock.bind(0, '0.0.0.0', () => {
    const addr = sock.address();
    const msg = Buffer.from('test');
    sock.send(msg, 0, msg.length, 53, '8.8.8.8', (err) => {
      if (err) result = 'send error: ' + err.message;
      sock.close();
      callback(result + ' bound=' + addr.address + ':' + addr.port);
    });
  });
  setTimeout(() => { try { sock.close(); } catch(e) {} if (result === 'ok') result = 'timeout'; callback(result); }, 5000);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('Server listening on port ' + PORT);
});
