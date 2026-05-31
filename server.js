const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const sip = require('sip');
const digest = require('sip/digest');

const PORT = process.env.PORT || 80;
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

function rstring() { return Math.floor(Math.random() * 1e12).toString(); }

// Iniciar stack SIP global
let sipStarted = false;
function ensureSipStack() {
  if (sipStarted) return;
  try {
    sip.start({ tcp: true, udp: false, port: 0 }, function(rq) {
      sip.send(sip.makeResponse(rq, 404, 'Not Found'));
    });
    sipStarted = true;
    console.log('SIP stack started');
  } catch (e) {
    console.error('SIP stack error:', e.message);
  }
}

wss.on('connection', (ws) => {
  let sessionId = null;
  let sipAccount = null;
  let dialConfig = null;
  let callActive = false;

  function sendJSON(obj) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function sendDebug(msg) {
    sendJSON({ type: 'debug', msg: msg });
  }

  function sendBCEvent(state) {
    sendJSON({ BCEvent: state });
  }

  function sendReqResponse(reqId, data) {
    sendJSON({ reqID: reqId, reqData: data });
  }

  sendDebug('Servidor JSON API listo');
  sendJSON({ HaveSessionQ: true });

  function handleMakeCall(from, to) {
    sendDebug('Iniciando llamada SIP: ' + from + ' -> ' + to);
    ensureSipStack();

    const domain = (sipAccount && sipAccount.sipDomain) || 'webdial.keepcalling.net';
    const user = (sipAccount && sipAccount.sipUserName) || from;
    const pass = (sipAccount && sipAccount.sipPassword) || '';
    const fromUri = 'sip:' + user + '@' + domain;
    const toUri = 'sip:' + to + '@' + domain;
    const contactUri = 'sip:' + user + '@' + domain;
    let authSession = null;

    sendDebug('Usuario SIP: ' + user + ' @ ' + domain);

    function sendInvite() {
      sip.send({
        method: 'INVITE',
        uri: toUri,
        headers: {
          to: { uri: toUri },
          from: { uri: fromUri, params: { tag: rstring() } },
          'call-id': rstring(),
          cseq: { method: 'INVITE', seq: Math.floor(Math.random() * 1e5) },
          'content-type': 'application/sdp',
          contact: [{ uri: contactUri }],
          'max-forwards': '70'
        },
        content: ''
      }, handleResponse);
    }

    function handleResponse(rs) {
      const statusStr = rs.status + ' ' + (rs.reason || '');
      sendDebug('SIP response: ' + statusStr);
      // Debug: mostrar headers relevantes
      const authH = rs.headers['proxy-authenticate'];
      const wwwAuth = rs.headers['www-authenticate'];
      const allKeys = Object.keys(rs.headers).join(', ');
      sendDebug('Headers: ' + allKeys);
      sendDebug('proxy-auth: ' + (authH ? (typeof authH === 'object' ? JSON.stringify(authH) : authH) : 'none'));
      sendDebug('www-auth: ' + (wwwAuth ? (typeof wwwAuth === 'object' ? JSON.stringify(wwwAuth) : wwwAuth) : 'none'));
      if (rs.status === 407) {
        sendDebug('Autenticación requerida, enviando credenciales...');
        const req = {
          method: 'INVITE',
          uri: toUri,
          headers: {
            to: { uri: toUri },
            from: { uri: fromUri, params: { tag: rstring() } },
            'call-id': rs.headers['call-id'] || rstring(),
            cseq: { method: 'INVITE', seq: Math.floor(Math.random() * 1e5) },
            'content-type': 'application/sdp',
            contact: [{ uri: contactUri }],
            'max-forwards': '70'
          },
          content: ''
        };
        authSession = {};
        const signedReq = digest.signRequest(
          authSession,
          req,
          rs,
          { user: user, password: pass }
        );
        if (signedReq) {
          sip.send(signedReq, function(rs2) {
            sendDebug('SIP auth response: ' + rs2.status + ' ' + (rs2.reason || ''));
            if (rs2.status >= 200 && rs2.status < 300) {
              sendBCEvent({ Connected: {} });
              callActive = true;
              sip.send({
                method: 'ACK',
                uri: rs2.headers.contact[0].uri,
                headers: {
                  to: rs2.headers.to,
                  from: rs2.headers.from,
                  'call-id': rs2.headers['call-id'],
                  cseq: { method: 'ACK', seq: rs2.headers.cseq.seq },
                  via: []
                }
              });
            } else if (rs2.status >= 100 && rs2.status < 200) {
              sendBCEvent({ RingingCallee: {} });
            } else {
              sendBCEvent({ NoCall: {} });
              callActive = false;
              sendDebug('Llamada falló: ' + rs2.status + ' ' + (rs2.reason || ''));
            }
          });
        } else {
          sendDebug('Error firmando request de autenticación');
          sendBCEvent({ NoCall: {} });
        }
        return;
      }
      if (rs.status >= 200 && rs.status < 300) {
        sendBCEvent({ Connected: {} });
        callActive = true;
        sip.send({
          method: 'ACK',
          uri: rs.headers.contact[0].uri,
          headers: {
            to: rs.headers.to,
            from: rs.headers.from,
            'call-id': rs.headers['call-id'],
            cseq: { method: 'ACK', seq: rs.headers.cseq.seq },
            via: []
          }
        });
      } else if (rs.status >= 100 && rs.status < 200) {
        sendBCEvent({ RingingCallee: {} });
      } else {
        sendBCEvent({ NoCall: {} });
        callActive = false;
        sendDebug('Llamada falló: ' + rs.status + ' ' + (rs.reason || ''));
      }
    }

    sendInvite();
  }

  ws.on('message', (raw) => {
    const str = Buffer.isBuffer(raw) ? raw.toString() : raw;
    let msg;
    try { msg = JSON.parse(str); } catch (e) { return; }

    if (msg.type === 'ping') { sendJSON({ type: 'pong' }); return; }

    if (msg.HaveSessionQ) {
      sendJSON({ ContinueSession: sessionId || 'new-session' });
      return;
    }

    if (msg.NewSession) {
      sessionId = 'sess-' + rstring();
      sendDebug('Sesión iniciada: ' + sessionId);
      sendJSON({ StartSession: sessionId });
      return;
    }

    if (msg.reqData) {
      const data = msg.reqData;

      if (data.SetSIPAccount) {
        sipAccount = data.SetSIPAccount;
        sendDebug('Cuenta SIP configurada: ' + sipAccount.sipUserName);
        sendReqResponse(msg.reqID, { RequestConf: { type: 'SIPAccount', status: 'ok' } });
        return;
      }

      if (data.SetDialConfig) {
        dialConfig = data.SetDialConfig;
        sendDebug('Config de llamada: ' + data.SetDialConfig.phoneNum);
        sendReqResponse(msg.reqID, { RequestConf: { type: 'DialConfig', status: 'ok' } });
        return;
      }

      if (data.GetSnapshot) {
        sendReqResponse(msg.reqID, { Snapshot: { callActive: callActive } });
        return;
      }

      if (data.BCRequest && data.BCRequest.MakeCall) {
        const to = data.BCRequest.MakeCall.destNum;
        const from = dialConfig ? dialConfig.phoneNum : 'anon';
        sendBCEvent({ Initiated: {} });
        handleMakeCall(from, to);
        return;
      }

      if (data.BCRequest && data.BCRequest.Hangup) {
        sendDebug('Colgando llamada');
        sendBCEvent({ NoCall: {} });
        callActive = false;
        return;
      }

      sendReqResponse(msg.reqID, { RequestConf: { status: 'ok' } });
    }
  });

  ws.on('close', () => {
    sendDebug('Cliente desconectado');
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Server listening on port ' + PORT);
});
