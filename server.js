const http = require('http');
const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const net = require('net');
const WebSocket = require('ws');
const crypto = require('crypto');
const dns = require('dns');

const PORT = process.env.PORT || 80;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.ico': 'image/x-icon',
};

const SIP_HOST = 'webdial.keepcalling.net';
const SIP_PORT = 5060;

const server = http.createServer((req, res) => {
  if (req.url === '/') { serveFile('index.html', res); }
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

// ---- Raw SIP over TCP ----
// Construct a SIP request string from an object like {method, uri, headers, content}
function rstring() { return Math.floor(Math.random() * 1e12).toString(); }

function sendDebug(msg) {
  const payload = JSON.stringify({ type: 'debug', msg: String(msg) });
  if (wss) wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(payload); });
}

function buildSipRequest(req) {
  const hdrs = req.headers || {};
  let hasVia = false, hasContentLength = false;
  let msg = req.method + ' ' + req.uri + ' SIP/2.0\r\n';
  for (const [k, v] of Object.entries(hdrs)) {
    if (v === undefined || v === null) continue;
    const lk = k.toLowerCase();
    if (lk === 'via') hasVia = true;
    if (lk === 'content-length') hasContentLength = true;
    const vals = Array.isArray(v) ? v : [v];
    for (const val of vals) {
      if (typeof val === 'object') {
        if (lk === 'to' || lk === 'from') {
          let s = '<' + val.uri + '>';
          if (val.params && val.params.tag) s += ';tag=' + val.params.tag;
          msg += k + ': ' + s + '\r\n';
        } else if (lk === 'contact') {
          let s = '<' + val.uri + '>';
          msg += k + ': ' + s + '\r\n';
        } else if (lk === 'cseq') {
          msg += k + ': ' + (val.seq || 1) + ' ' + (val.method || req.method) + '\r\n';
        } else if (lk === 'via') {
          msg += k + ': SIP/2.0/TCP ' + (val.host || '0.0.0.0') + ':' + (val.port || '0') + ';branch=' + (val.params ? val.params.branch : 'z9hG4bK' + rstring()) + '\r\n';
        } else if (lk === 'proxy-authorization' || lk === 'authorization') {
          let s = val.scheme + ' ';
          for (const [pk, pv] of Object.entries(val)) {
            if (pk === 'scheme') continue;
            s += pk + '="' + pv + '", ';
          }
          msg += k + ': ' + s.replace(/, $/, '') + '\r\n';
        } else {
          msg += k + ': ' + JSON.stringify(val) + '\r\n';
        }
      } else {
        msg += k + ': ' + String(val) + '\r\n';
      }
    }
  }
  if (!hasVia) msg += 'Via: SIP/2.0/TCP 0.0.0.0:0;branch=z9hG4bK' + rstring() + '\r\n';
  const body = req.content || '';
  if (!hasContentLength) msg += 'Content-Length: ' + Buffer.byteLength(body) + '\r\n';
  msg += '\r\n';
  msg += body;
  return msg;
}

// Parse a SIP response string into {status, reason, headers, content}
// Handles Content-Length properly for TCP framing
function parseSipResponse(text) {
  const idx = text.indexOf('\r\n\r\n');
  if (idx === -1) return null;
  const head = text.slice(0, idx);
  const bodyStart = idx + 4;
  const lines = head.split('\r\n');
  const sl = lines[0].match(/^SIP\/2\.0\s+(\d+)\s+(.*)$/);
  if (!sl) return null;
  const headers = {};
  let contentLength = 0;
  for (let i = 1; i < lines.length; i++) {
    const m = lines[i].match(/^([^:]+):\s*(.*)$/);
    if (m) {
      const k = m[1].toLowerCase();
      const v = m[2];
      if (k === 'content-length') contentLength = parseInt(v, 10) || 0;
      if (headers[k]) { if (!Array.isArray(headers[k])) headers[k] = [headers[k]]; headers[k].push(v); }
      else headers[k] = v;
    }
  }
  const body = text.slice(bodyStart, bodyStart + contentLength);
  // Only return complete message if we have all the body bytes
  if (text.length < bodyStart + contentLength) return null;
  return { status: parseInt(sl[1]), reason: sl[2], headers, content: body };
}

// Simple SIP TCP send: resolve, connect, send, receive response(s), callback, close
function sipSendTcp(req, cb, timeoutMs) {
  const msgStr = buildSipRequest(req);
  const timer = setTimeout(() => {
    sendDebug('[sipSendTcp] timeout for ' + req.method);
    if (cb) cb({ status: 408, reason: 'Request Timeout', headers: {}, content: '' });
    cb = null;
  }, timeoutMs || 30000);

  dns.resolve4(SIP_HOST, (err, addrs) => {
    if (!cb) return;
    if (err || !addrs || !addrs.length) {
      clearTimeout(timer);
      if (cb) cb({ status: 500, reason: 'DNS failed: ' + (err ? err.code : 'no addresses'), headers: {}, content: '' });
      return;
    }
    const ip = addrs[0];
    const sock = new net.Socket();
    let buf = '';
    let done = false;

    sock.setTimeout(timeoutMs || 30000);
    sock.connect(SIP_PORT, ip, () => sock.write(msgStr));

    function handleData() {
      if (done || !cb) return;
      while (true) {
        const rs = parseSipResponse(buf);
        if (!rs) break;
        const headerEnd = buf.indexOf('\r\n\r\n');
        const contentLength = parseInt(rs.headers['content-length'] || '0', 10);
        const msgLen = headerEnd + 4 + contentLength;
        // Provisional (1xx): remove from buffer and keep waiting
        if (rs.status >= 100 && rs.status < 200) {
          sendDebug('[sipSendTcp] provisional ' + rs.status + ' ' + (rs.reason || ''));
          buf = buf.slice(msgLen);
          continue;
        }
        // Final response: deliver and close
        sendDebug('[sipSendTcp] final resp ' + rs.status + ' ' + (rs.reason || ''));
        buf = buf.slice(msgLen);
        done = true; clearTimeout(timer);
        try { sock.end(); } catch(e) {}
        if (cb) cb(rs);
        break;
      }
    }

    sock.on('data', (data) => {
      sendDebug('[sipSendTcp] recv ' + data.length + ' bytes');
      buf += data.toString('binary');
      handleData();
    });

    sock.on('error', (e) => {
      sendDebug('[sipSendTcp] error: ' + e.message);
      if (done || !cb) return; done = true; clearTimeout(timer);
      try { sock.destroy(); } catch(e) {}
      if (cb) cb({ status: 500, reason: 'TCP error: ' + e.message, headers: {}, content: '' });
    });

    sock.on('close', () => {
      if (done || !cb) return; done = true; clearTimeout(timer);
      const rs = parseSipResponse(buf);
      if (rs) { if (cb) cb(rs); }
      else if (cb) cb({ status: 500, reason: 'Connection closed', headers: {}, content: '' });
    });

    sock.on('timeout', () => {
      if (done || !cb) return; done = true; clearTimeout(timer);
      try { sock.destroy(); } catch(e) {}
      if (cb) cb({ status: 408, reason: 'TCP timeout', headers: {}, content: '' });
    });
  });
}

function stripQuotes(s) {
  if (typeof s === 'string' && s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') return s.slice(1, -1);
  return s;
}

// Parse a SIP auth header string like: Digest realm="...", nonce="..."
function parseAuthHeader(str) {
  if (!str) return null;
  const m = str.match(/^\s*(\w+)\s+(.*)$/);
  if (!m) return null;
  const scheme = m[1];
  const rest = m[2];
  const params = {};
  // Match key="value" or key=value patterns
  const regex = /(\w+)\s*=\s*(?:"([^"]*)"|([^\s,]+))/g;
  let match;
  while ((match = regex.exec(rest)) !== null) {
    params[match[1]] = match[2] !== undefined ? match[2] : match[3];
  }
  return { scheme, ...params };
}

// Global error handlers
process.on('uncaughtException', (err) => { console.error('UNCAUGHT:', err.message, err.stack); });
process.on('unhandledRejection', (err) => { console.error('UNHANDLED:', err.message); });

// ---- WebSocket único: señalización + audio ----
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  let pendingAuth = null;
  let audioRelay = null;
  let pcmInputBuffer = Buffer.alloc(0);
  let pcmOutputBuffer = Buffer.alloc(0);

  function sendJSON(obj) { try { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); } catch(e) {} }

  function safeSipSend(req, cb) {
    sipSendTcp(req, cb);
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
      const reqId = msg.reqId || rstring();
      const callId = rstring();
      const fromTag = rstring();
      let cseq = Math.floor(Math.random() * 1e5);

      sendDebug('Llamando a ' + number);

      let authTried = false;
      function doInvite(authHeader) {
        cseq++;
        const req = {
          method: 'INVITE',
          uri: toUri,
          headers: {
            to: { uri: toUri },
            from: { uri: fromUri, params: { tag: fromTag } },
            'call-id': callId,
            cseq: { method: 'INVITE', seq: cseq },
            'content-type': 'application/sdp',
            contact: [{ uri: fromUri }],
            'max-forwards': '70',
          },
          content: 'v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\ns=-\r\nc=IN IP4 0.0.0.0\r\nt=0 0\r\nm=audio 4000 RTP/AVP 0 8\r\na=rtpmap:0 PCMU/8000\r\na=rtpmap:8 PCMA/8000\r\na=sendrecv\r\n',
        };
        if (authHeader) {
          const realm = authHeader.realm || domain;
          const nonce = authHeader.nonce || '';
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
          const challengeStr = Array.isArray(challenges) ? challenges[0] : challenges;
          const challenge = parseAuthHeader(challengeStr);
          if (challenge && !authTried) {
            authTried = true;
            pendingAuth = { challenge, user, pass, domain, number, fromUri, toUri };
            if (msg.requireAuth !== false) {
              sendDebug('Autenticando...');
              doInvite(challenge);
            } else {
              sendJSON({ type: 'auth_challenge', reqId, challenge: {
                realm: challenge.realm || domain,
                nonce: challenge.nonce || '',
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
      safeSipSend(req, (rs) => handleResponse(rs, msg.reqId));
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

  ws.on('error', (e) => {});
  ws.on('close', (code, reason) => {
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
