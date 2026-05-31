const http = require('http');
const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const net = require('net');
const WebSocket = require('ws');
const sip = require('sip');
const crypto = require('crypto');

const PORT = process.env.PORT || 80;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.ico': 'image/x-icon',
};

const dns = require('dns');

const server = http.createServer((req, res) => {
  if (req.url === '/') { serveFile('index.html', res); }
  else if (req.url === '/dns') {
    dns.resolveSrv('_sip._udp.webdial.keepcalling.net', (err, srv) => {
      dns.resolve4('webdial.keepcalling.net', (err2, addrs) => {
        res.setHeader('Content-Type', 'text/plain');
        res.end('SRV: ' + (err ? err.code : JSON.stringify(srv)) + '\nA: ' + (err2 ? err2.code : JSON.stringify(addrs)));
      });
    });
  }
  else if (req.url === '/siptest') {
    dns.resolve4('webdial.keepcalling.net', (err, addrs) => {
      if (err) { res.end('DNS error: ' + err.code); return; }
      const ip = addrs[0];
      const sock = new net.Socket();
      sock.setTimeout(8000);
      let responded = false;
      sock.connect(5060, ip, () => {
        const msg = [
          'OPTIONS sip:webdial.keepcalling.net SIP/2.0',
          'Via: SIP/2.0/TCP 0.0.0.0:0;branch=z9hG4bK-test123',
          'From: <sip:test@test.com>;tag=test',
          'To: <sip:test@webdial.keepcalling.net>',
          'Call-ID: test123@test',
          'CSeq: 1 OPTIONS',
          'Contact: <sip:test@0.0.0.0>',
          'Max-Forwards: 70',
          'Content-Length: 0',
          '', '',
        ].join('\r\n');
        sock.write(msg);
      });
      let buf = '';
      sock.on('data', (data) => { buf += data.toString(); });
      sock.on('timeout', () => { if (!responded) { responded = true; res.end('TCP timeout after connect'); } sock.destroy(); });
      sock.on('error', (e) => { if (!responded) { responded = true; res.end('TCP error: ' + e.message); } sock.destroy(); });
      setTimeout(() => {
        if (!responded) { responded = true;
          res.end('Response len=' + buf.length + '\n' + buf.slice(0, 2000));
        } sock.destroy();
      }, 5000);
    });
  }
  else { res.writeHead(404); res.end('Not found'); }
});

function serveFile(name, res) {
  const filePath = path.join(PUBLIC_DIR, name);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(500); res.end('Error'); return; }
    const ext = path.extname(name);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
    res.end(data);
  });
}

// SIP stack (shared)
let sipReady = false;
try {
  sip.start({ udp: true, tcp: false, port: 15060 }, function(rq) {
    if (!sipReady) return;
    try { sip.send(sip.makeResponse(rq, 404, 'Not Found')); } catch(e) {}
  });
  sipReady = true;
  console.log('SIP stack started');
} catch(e) {
  console.error('SIP stack error:', e.message);
}

function rstring() { return Math.floor(Math.random() * 1e12).toString(); }

function stripQuotes(s) {
  if (typeof s === 'string' && s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') return s.slice(1, -1);
  return s;
}

// Global error handlers
process.on('uncaughtException', (err) => { console.error('UNCAUGHT:', err.message, err.stack); });
process.on('unhandledRejection', (err) => { console.error('UNHANDLED:', err.message); });

// ---- WebSocket único: señalización + audio ----
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('WS connected');
  let pendingAuth = null;
  let audioRelay = null;
  let pcmInputBuffer = Buffer.alloc(0);
  let pcmOutputBuffer = Buffer.alloc(0);

  function sendJSON(obj) { try { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); } catch(e) {} }
  function sendDebug(msg) { sendJSON({ type: 'debug', msg: String(msg) }); }

  function safeSipSend(req, cb, timeoutMs) {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      console.error('SIP timeout for', req.method, req.uri);
      sendDebug('SIP timeout para ' + req.method + ' ' + req.uri);
      if (cb) cb({ status: 408, reason: 'Request Timeout', headers: {}, content: '' });
    }, timeoutMs || 15000);
    const wrappedCb = (rs) => {
      if (done) return;
      done = true; clearTimeout(timer);
      if (cb) cb(rs);
    };
    try {
      sendDebug('SIP enviando ' + req.method + ' ' + req.uri);
      sip.send(req, wrappedCb);
    } catch(e) {
      if (done) return;
      done = true; clearTimeout(timer);
      console.error('safeSipSend error:', e.message, e.stack);
      sendDebug('Error SIP: ' + e.message);
      if (cb) cb({ status: 500, reason: 'Server error: ' + e.message, headers: {}, content: '' });
    }
  }

  // ---- Audio relay ----
  function startAudioRelay(info) {
    stopAudioRelay();
    const sock = dgram.createSocket('udp4');
    sock.on('error', (e) => console.error('RTP error:', e.message));
    sock.on('message', (msg) => {
      if (msg.length < 12) return;
      const pt = msg.readUInt8(1) & 0x7f;
      if (pt !== 8 && pt !== 0) return;
      const payload = msg.subarray(12);
      const pcm16 = Buffer.alloc(payload.length * 2);
      for (let i = 0; i < payload.length; i++) pcm16.writeInt16LE(alawToLinear(payload[i]), i * 2);
      pcmOutputBuffer = Buffer.concat([pcmOutputBuffer, pcm16]);
      while (pcmOutputBuffer.length >= 192) {
        if (ws.readyState === WebSocket.OPEN) ws.send(pcmOutputBuffer.subarray(0, 192));
        pcmOutputBuffer = pcmOutputBuffer.subarray(192);
      }
    });
    sock.bind(0, '0.0.0.0', () => {
      const addr = sock.address();
      console.log('RTP relay port', addr.port);
      audioRelay = { sock, rtpIp: info.rtpIp, rtpPort: info.rtpPort, ssrc: info.ssrc || Math.floor(Math.random() * 0xFFFFFFFF), seq: 0, ts: 0 };
      sendJSON({ type: 'relay_ready', localPort: addr.port });
    });
  }

  function stopAudioRelay() {
    if (audioRelay && audioRelay.sock) { try { audioRelay.sock.close(); } catch(e) {} }
    audioRelay = null; pcmInputBuffer = Buffer.alloc(0); pcmOutputBuffer = Buffer.alloc(0);
  }

  function handleAudioData(raw) {
    if (!audioRelay) return;
    pcmInputBuffer = Buffer.concat([pcmInputBuffer, Buffer.from(raw)]);
    const targetSamples = 960;
    while (pcmInputBuffer.length >= targetSamples * 2) {
      const packet = pcmInputBuffer.subarray(0, targetSamples * 2);
      pcmInputBuffer = pcmInputBuffer.subarray(targetSamples * 2);
      const pcma = Buffer.alloc(160);
      for (let i = 0; i < 160; i++) pcma[i] = linearToAlaw(packet.readInt16LE(i * 12));
      const rtp = Buffer.alloc(12 + 160);
      rtp[0] = 0x80; rtp[1] = 0x88;
      rtp.writeUInt16BE(audioRelay.seq, 2);
      rtp.writeUInt32BE(audioRelay.ts, 4);
      rtp.writeUInt32BE(audioRelay.ssrc, 8);
      pcma.copy(rtp, 12);
      audioRelay.seq = (audioRelay.seq + 1) & 0xFFFF;
      audioRelay.ts += 160;
      audioRelay.sock.send(rtp, 0, rtp.length, audioRelay.rtpPort, audioRelay.rtpIp, (e) => {
        if (e) console.error('RTP send:', e.message);
      });
    }
  }

  ws.on('message', (raw, isBinary) => {
    if (isBinary) { handleAudioData(raw); return; }
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }

    if (msg.type === 'start') { startAudioRelay(msg); return; }
    if (msg.type === 'stop') { stopAudioRelay(); return; }
    if (msg.action === 'ping') { sendJSON({ type: 'pong' }); return; }

    // --- sip_call: send SIP request ---
    if (msg.action === 'sip_call') {
      const domain = msg.domain || 'webdial.keepcalling.net';
      const user = msg.user;
      const pass = msg.password;
      const number = msg.number;
      const fromUri = 'sip:' + user + '@' + domain;
      const toUri = 'sip:' + number + '@' + domain;

      console.log('sip_call to', number);
      sendDebug('Llamando a ' + number);

      function doInvite(authHeader) {
        const req = {
          method: 'INVITE',
          uri: toUri,
          headers: {
            to: { uri: toUri },
            from: { uri: fromUri, params: { tag: rstring() } },
            'call-id': rstring(),
            cseq: { method: 'INVITE', seq: Math.floor(Math.random() * 1e5) },
            'content-type': 'application/sdp',
            contact: [{ uri: fromUri }],
            'max-forwards': '70',
          },
          content: 'v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\ns=-\r\nc=IN IP4 0.0.0.0\r\nt=0 0\r\nm=audio 4000 RTP/AVP 0 8\r\na=rtpmap:0 PCMU/8000\r\na=rtpmap:8 PCMA/8000\r\na=sendrecv\r\n',
        };
        if (authHeader) {
          const challenge = authHeader;
          const realm = stripQuotes(challenge.realm) || domain;
          const nonce = stripQuotes(challenge.nonce) || '';
          const ha1 = crypto.createHash('md5').update(user + ':' + realm + ':' + pass).digest('hex');
          const ha2 = crypto.createHash('md5').update('INVITE' + ':' + toUri).digest('hex');
          const resp = crypto.createHash('md5').update(ha1 + ':' + nonce + ':' + ha2).digest('hex');
          req.headers['proxy-authorization'] = [{
            scheme: 'Digest',
            username: user,
            realm: realm,
            nonce: nonce,
            uri: toUri,
            algorithm: 'MD5',
            response: resp,
          }];
        }
        safeSipSend(req, (rs) => handleResponse(rs, reqId));
      }

      function handleResponse(rs, reqId) {
        sendDebug('SIP ' + rs.status + ' ' + (rs.reason || ''));
        if (rs.status === 407) {
          const challenges = rs.headers['proxy-authenticate'];
          const challenge = Array.isArray(challenges) ? challenges[0] : challenges;
          if (challenge) {
            pendingAuth = { challenge, user, pass, domain, number, fromUri, toUri };
            if (msg.requireAuth !== false) {
              sendDebug('Autenticando...');
              doInvite(challenge);
            } else {
              sendJSON({ type: 'auth_challenge', reqId, challenge: {
                realm: stripQuotes(challenge.realm) || domain,
                nonce: stripQuotes(challenge.nonce) || '',
                username: user,
                uri: toUri,
              }});
            }
          }
          return;
        }
        if (rs.status >= 200 && rs.status < 300) {
          // Return SDP so browser can start audio relay
          sendJSON({
            type: 'call_connected',
            reqId,
            sdp: rs.content || '',
            headers: {
              to: stringifyHeader(rs.headers['to']),
              from: stringifyHeader(rs.headers['from']),
              'call-id': stringifyHeader(rs.headers['call-id']),
              cseq: stringifyHeader(rs.headers['cseq']),
              contact: stringifyHeader(rs.headers['contact']),
            },
          });
          // Send ACK
          const contact = Array.isArray(rs.headers['contact']) ? rs.headers['contact'][0] : rs.headers['contact'];
          const contactUri = contact && contact.uri ? contact.uri : toUri;
          const ackCseq = typeof rs.headers['cseq'] === 'object' ? rs.headers['cseq'].seq : NaN;
          safeSipSend({
            method: 'ACK',
            uri: contactUri,
            headers: {
              to: rs.headers['to'],
              from: rs.headers['from'],
              'call-id': rs.headers['call-id'],
              cseq: { method: 'ACK', seq: ackCseq },
              via: [],
            },
          });
          return;
        }
        if (rs.status >= 300) {
          sendJSON({ type: 'call_error', reqId, status: rs.status, reason: rs.reason || '' });
        }
      }

      doInvite(null);
      return;
    }

    // --- sip_auth: complete auth and re-send INVITE ---
    if (msg.action === 'sip_auth' && pendingAuth) {
      const { challenge, user, pass, domain, number, fromUri, toUri } = pendingAuth;
      const realm = stripQuotes(challenge.realm) || domain;
      const nonce = stripQuotes(challenge.nonce) || '';
      const ha1 = crypto.createHash('md5').update(user + ':' + realm + ':' + pass).digest('hex');
      const ha2 = crypto.createHash('md5').update('INVITE' + ':' + toUri).digest('hex');
      const response = crypto.createHash('md5').update(ha1 + ':' + nonce + ':' + ha2).digest('hex');
      const req = {
        method: 'INVITE',
        uri: toUri,
        headers: {
          to: { uri: toUri },
          from: { uri: fromUri, params: { tag: rstring() } },
          'call-id': msg.callId || rstring(),
          cseq: { method: 'INVITE', seq: Math.floor(Math.random() * 1e5) },
          'content-type': 'application/sdp',
          contact: [{ uri: fromUri }],
          'max-forwards': '70',
          'proxy-authorization': [{
            scheme: 'Digest',
            username: user,
            realm: realm,
            nonce: nonce,
            uri: toUri,
            algorithm: 'MD5',
          }],
        },
        content: msg.sdp || 'v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\ns=-\r\nc=IN IP4 0.0.0.0\r\nt=0 0\r\nm=audio 4000 RTP/AVP 0 8\r\na=rtpmap:0 PCMU/8000\r\na=rtpmap:8 PCMA/8000\r\na=sendrecv\r\n',
      };
      safeSipSend(req, (rs) => {
        sendDebug('SIP ' + rs.status + ' ' + (rs.reason || ''));
        if (rs.status >= 200 && rs.status < 300) {
          sendJSON({
            type: 'call_connected',
            reqId: msg.reqId,
            sdp: rs.content || '',
            headers: {
              to: stringifyHeader(rs.headers['to']),
              from: stringifyHeader(rs.headers['from']),
              'call-id': stringifyHeader(rs.headers['call-id']),
              cseq: stringifyHeader(rs.headers['cseq']),
              contact: stringifyHeader(rs.headers['contact']),
            },
          });
          const contact = Array.isArray(rs.headers['contact']) ? rs.headers['contact'][0] : rs.headers['contact'];
          const contactUri = contact && contact.uri ? contact.uri : toUri;
          const ackCseq = typeof rs.headers['cseq'] === 'object' ? rs.headers['cseq'].seq : NaN;
          safeSipSend({
            method: 'ACK',
            uri: contactUri,
            headers: {
              to: rs.headers['to'],
              from: rs.headers['from'],
              'call-id': rs.headers['call-id'],
              cseq: { method: 'ACK', seq: ackCseq },
              via: [],
            },
          });
        } else if (rs.status >= 300) {
          sendJSON({ type: 'call_error', reqId: msg.reqId, status: rs.status, reason: rs.reason || '' });
        }
      });
      return;
    }

    // --- sip_bye ---
    if (msg.action === 'sip_bye' && msg.headers) {
      const h = msg.headers;
      safeSipSend({
        method: 'BYE',
        uri: h.to_uri || 'sip:none@none',
        headers: {
          to: parseHeader(h.to),
          from: parseHeader(h.from),
          'call-id': h['call-id'],
          cseq: { method: 'BYE', seq: parseInt(h.cseq_seq) || 1 },
          via: [],
        },
      });
      sendDebug('BYE enviado');
      return;
    }
  });

  ws.on('error', (e) => console.error('WS error:', e.message));
  ws.on('close', (code, reason) => {
    console.log('WS disconnected code=' + code + ' reason=' + (reason || 'none'));
    stopAudioRelay();
  });
});

function stringifyHeader(h) {
  if (!h) return '';
  if (typeof h === 'string') return h;
  if (h.uri) return '<' + h.uri + '>' + (h.params && h.params.tag ? ';tag=' + h.params.tag : '');
  try { return JSON.stringify(h); } catch(e) { return String(h); }
}

function parseHeader(str) {
  if (!str) return { uri: 'sip:none@none' };
  const match = str.match(/<([^>]+)>/);
  const uri = match ? match[1] : str;
  const tagMatch = str.match(/tag=([^;>]+)/);
  const params = tagMatch ? { tag: tagMatch[1] } : {};
  return { uri, params };
}

// Linear to A-law conversion
function linearToAlaw(sample) {
  if (sample >= 0) {
    if (sample > 0x7fff) sample = 0x7fff;
    sample = sample | 0x80;
    let seg = (sample >> 4) & 0x0f;
    return ((seg << 4) | ((sample >> (seg >= 4 ? seg - 4 : 0)) & 0x0f)) ^ 0xD5;
  }
  sample = -sample;
  if (sample > 0x7fff) sample = 0x7fff;
  sample = sample | 0x80;
  let seg = (sample >> 4) & 0x0f;
  return ((seg << 4) | ((sample >> (seg >= 4 ? seg - 4 : 0)) & 0x0f)) ^ 0x55;
}

function alawToLinear(alaw) {
  const a = alaw ^ 0xD5;
  const sign = (a & 0x80) ? -1 : 1;
  const exponent = (a >> 4) & 0x07;
  const mantissa = a & 0x0f;
  return sign * ((exponent === 0 ? mantissa : ((mantissa << 3) | 0x84)) << (exponent + 4));
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('Server on port ' + PORT);
});
