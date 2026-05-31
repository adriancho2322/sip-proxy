<?php
require_once __DIR__.'/auth.php';   // Redirige a login si no hay sesión
$nombre = htmlspecialchars($_SESSION['usuario_nombre']);
?>
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SIPcall</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Barlow:wght@300;400;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0c10;--panel:#111318;--border:#1e2330;
  --accent:#00e5a0;--accent2:#0088ff;--danger:#ff3b5c;
  --text:#e2e8f0;--muted:#5a6480;
  --mono:'Share Tech Mono',monospace;--sans:'Barlow',sans-serif;
}
body{background:var(--bg);color:var(--text);font-family:var(--sans);
  min-height:100vh;display:flex;flex-direction:column;align-items:center;
  justify-content:flex-start;padding:20px;}
body::before{content:'';position:fixed;inset:0;pointer-events:none;
  background-image:linear-gradient(rgba(0,229,160,.04) 1px,transparent 1px),
    linear-gradient(90deg,rgba(0,229,160,.04) 1px,transparent 1px);
  background-size:48px 48px;}

/* ── Navbar ── */
.navbar{display:flex;align-items:center;justify-content:space-between;
  background:var(--panel);border:1px solid var(--border);border-radius:14px;
  padding:10px 18px;width:100%;max-width:400px;margin-bottom:20px;
  box-shadow:0 4px 20px rgba(0,0,0,.4);}
.nav-brand{display:flex;align-items:center;gap:10px;}
.nav-icon{width:32px;height:32px;background:linear-gradient(135deg,var(--accent2),var(--accent));
  border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:15px;}
.nav-title{font-size:16px;font-weight:600;}
.nav-title span{color:var(--accent);}
.nav-right{display:flex;align-items:center;gap:10px;}
.nav-user{font-family:var(--mono);font-size:10px;color:var(--muted);display:none;}
@media(min-width:380px){.nav-user{display:block;}}
.nav-user strong{color:var(--accent);display:block;font-size:11px;}
.btn-logout{background:rgba(255,59,92,.1);border:1px solid rgba(255,59,92,.25);
  color:#ff6b85;border-radius:8px;padding:5px 12px;font-size:11px;
  font-family:var(--mono);cursor:pointer;text-decoration:none;
  transition:background .2s;white-space:nowrap;}
.btn-logout:hover{background:rgba(255,59,92,.22);}

/* ── SIP Card (same styles as sip-caller.html) ── */
.card{position:relative;background:var(--panel);border:1px solid var(--border);
  border-radius:20px;padding:36px;width:100%;max-width:400px;
  box-shadow:0 0 0 1px rgba(0,229,160,.06),0 30px 80px rgba(0,0,0,.6),
    inset 0 1px 0 rgba(255,255,255,.04);
  animation:slideUp .5s cubic-bezier(.16,1,.3,1) both;}
.card::before{content:'';position:absolute;top:0;left:36px;right:36px;height:1px;
  background:linear-gradient(90deg,transparent,var(--accent),transparent);opacity:.6;}
@keyframes slideUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}
.header{display:flex;align-items:center;gap:12px;margin-bottom:28px;}
.logo-icon{width:38px;height:38px;background:linear-gradient(135deg,var(--accent2),var(--accent));
  border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;
  flex-shrink:0;box-shadow:0 0 20px rgba(0,229,160,.3);}
.logo-text{font-size:18px;font-weight:600;}
.logo-text span{color:var(--accent);}
.status-pill{margin-left:auto;display:flex;align-items:center;gap:6px;
  font-family:var(--mono);font-size:10px;color:var(--muted);
  background:rgba(255,255,255,.04);border:1px solid var(--border);
  border-radius:20px;padding:4px 10px;transition:all .3s;}
.status-dot{width:6px;height:6px;border-radius:50%;background:var(--muted);transition:all .3s;}
.pill-ok .status-dot{background:var(--accent);box-shadow:0 0 8px var(--accent);animation:pulse 2s infinite;}
.pill-ok{color:var(--accent);border-color:rgba(0,229,160,.2);}
.pill-busy .status-dot{background:var(--accent2);box-shadow:0 0 8px var(--accent2);animation:pulse 1s infinite;}
.pill-busy{color:var(--accent2);border-color:rgba(0,136,255,.2);}
.pill-call .status-dot{background:var(--accent);box-shadow:0 0 8px var(--accent);animation:pulse .6s infinite;}
.pill-call{color:var(--accent);border-color:rgba(0,229,160,.3);}
.pill-err .status-dot{background:var(--danger);}
.pill-err{color:var(--danger);border-color:rgba(255,59,92,.2);}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
label{display:block;font-size:10px;font-family:var(--mono);color:var(--muted);
  letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;}
.field{margin-bottom:18px;}
.input-wrap{position:relative;}
.input-icon{position:absolute;left:13px;top:50%;transform:translateY(-50%);
  color:var(--muted);font-size:14px;pointer-events:none;}
input[type="tel"]{width:100%;background:rgba(255,255,255,.03);border:1px solid var(--border);
  border-radius:10px;padding:12px 14px 12px 38px;color:var(--text);
  font-family:var(--mono);font-size:15px;letter-spacing:1px;outline:none;
  transition:border-color .2s,box-shadow .2s;}
input[type="tel"]:focus{border-color:rgba(0,229,160,.4);background:rgba(0,229,160,.03);
  box-shadow:0 0 0 3px rgba(0,229,160,.07);}
.call-state{font-family:var(--mono);font-size:12px;text-align:center;color:var(--accent2);
  letter-spacing:1px;min-height:20px;margin:14px 0 6px;}
.btn-row{display:flex;gap:12px;margin-top:8px;}
.btn{flex:1;border:none;border-radius:11px;padding:13px;font-family:var(--sans);
  font-weight:700;font-size:14px;cursor:pointer;transition:transform .15s,box-shadow .15s,opacity .2s;}
.btn:active{transform:scale(.96);}
.btn:disabled{opacity:.35;cursor:not-allowed;transform:none!important;}
.btn-connect{background:linear-gradient(135deg,#00c87a,#00e5a0);color:#003020;
  box-shadow:0 4px 24px rgba(0,229,160,.25);}
.btn-connect:hover:not(:disabled){box-shadow:0 6px 32px rgba(0,229,160,.4);transform:translateY(-1px);}
.btn-hangup{background:linear-gradient(135deg,#c02040,#ff3b5c);color:#fff;
  box-shadow:0 4px 24px rgba(255,59,92,.2);}
.btn-hangup:hover:not(:disabled){box-shadow:0 6px 32px rgba(255,59,92,.4);transform:translateY(-1px);}
.log{margin-top:18px;background:rgba(0,0,0,.35);border:1px solid var(--border);
  border-radius:10px;padding:10px 13px;font-family:var(--mono);font-size:11px;
  color:var(--muted);min-height:34px;max-height:90px;overflow-y:auto;line-height:1.65;word-break:break-all;}
.log .ok{color:var(--accent);}.log .err{color:var(--danger);}.log .inf{color:var(--accent2);}
.log::-webkit-scrollbar{width:4px;}
.log::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px;}

/* ── SSL Floating Panel ── */
@keyframes popIn{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes waiting{0%,100%{opacity:.4}50%{opacity:1}}
.ssl-floater{position:fixed;bottom:24px;right:24px;width:300px;z-index:9999;
  background:var(--panel);border:1px solid rgba(0,136,255,.4);border-radius:16px;
  box-shadow:0 0 0 1px rgba(0,136,255,.08),0 24px 64px rgba(0,0,0,.75);
  overflow:hidden;animation:popIn .3s cubic-bezier(.16,1,.3,1) both;}
.ssl-floater.hidden{display:none;}
/* header */
.ssl-fbar{display:flex;align-items:center;justify-content:space-between;
  padding:9px 14px;background:rgba(0,136,255,.1);border-bottom:1px solid rgba(0,136,255,.18);}
.ssl-fbar-left{display:flex;align-items:center;gap:7px;font-size:11px;
  font-family:var(--mono);color:var(--accent2);font-weight:600;}
.ssl-badge{font-size:10px;font-family:var(--mono);
  border-radius:20px;padding:2px 9px;white-space:nowrap;
  background:rgba(255,255,255,.05);border:1px solid var(--border);color:var(--muted);}
.ssl-badge.ok{background:rgba(0,229,160,.12);border-color:rgba(0,229,160,.3);color:var(--accent);}
.ssl-badge.waiting{animation:waiting 1.2s infinite;}
/* body */
.ssl-fbody{padding:14px 14px 4px;}
.ssl-step{display:flex;align-items:flex-start;gap:9px;margin-bottom:10px;}
.ssl-step-num{min-width:20px;height:20px;border-radius:50%;background:rgba(0,136,255,.15);
  border:1px solid rgba(0,136,255,.3);font-size:10px;font-family:var(--mono);
  color:var(--accent2);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.ssl-step-num.done{background:rgba(0,229,160,.15);border-color:rgba(0,229,160,.35);color:var(--accent);}
.ssl-step-txt{font-size:11px;font-family:var(--mono);color:var(--muted);line-height:1.5;padding-top:2px;}
.ssl-step-txt em{color:var(--text);font-style:normal;}
/* footer */
.ssl-ffoot{padding:10px 14px 14px;}
.btn-ssl-verify{display:block;width:100%;background:linear-gradient(135deg,#0055bb,#0088ff);
  color:#fff;border:none;border-radius:10px;padding:10px 14px;
  font-family:var(--sans);font-weight:700;font-size:13px;cursor:pointer;
  box-shadow:0 4px 18px rgba(0,136,255,.35);transition:box-shadow .2s,transform .15s,opacity .2s;}
.btn-ssl-verify:hover:not(:disabled){box-shadow:0 6px 24px rgba(0,136,255,.5);transform:translateY(-1px);}
.btn-ssl-verify:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none;}
.ssl-footnote{font-size:10px;font-family:var(--mono);color:var(--muted);
  text-align:center;margin-top:8px;opacity:.7;}
</style>
</head>
<body>

<!-- ── Navbar ── -->
<nav class="navbar">
  <div class="nav-brand">
    <div class="nav-icon">📞</div>
    <div class="nav-title">SIP<span>call</span></div>
  </div>
  <div class="nav-right">
    <div class="nav-user">
      Bienvenido<strong><?= $nombre ?></strong>
    </div>
    <a href="logout.php" class="btn-logout">Salir ↗</a>
  </div>
</nav>

<!-- ── SIP Card ── -->
<div class="card">
  <div class="header">
    <div class="logo-icon">📞</div>
    <div class="logo-text">SIP<span>call</span></div>
    <div class="status-pill" id="pill">
      <div class="status-dot"></div>
      <span id="pillTxt">conectando…</span>
    </div>
  </div>

  <div class="field">
    <label>Número Origen (tu teléfono)</label>
    <div class="input-wrap">
      <span class="input-icon">👤</span>
      <input type="tel" id="fromNum" placeholder="ej. 15551234567" autocomplete="off">
    </div>
  </div>

  <div class="field">
    <label>Número Destino</label>
    <div class="input-wrap">
      <span class="input-icon">📲</span>
      <input type="tel" id="toNum" placeholder="ej. 15559876543" autocomplete="off">
    </div>
  </div>

  <div class="call-state" id="callState"></div>

  <div class="btn-row">
    <button class="btn btn-connect" id="btnCall"   onclick="makeCall()" disabled>▶ Conectar</button>
    <button class="btn btn-hangup"  id="btnHangup" onclick="hangup()"   disabled>✕ Finalizar</button>
  </div>

  <div class="log" id="log"><span class="inf">› Iniciando…</span></div>
</div>

<!-- ── Floating SSL verifier ── -->
<div class="ssl-floater hidden" id="sslFloater">
  <div class="ssl-fbar">
    <div class="ssl-fbar-left">🔐 Verificar certificado</div>
    <div class="ssl-badge waiting" id="sslBadge">pendiente</div>
  </div>
  <div class="ssl-fbody">
    <div class="ssl-step">
      <div class="ssl-step-num" id="sslN1">1</div>
      <div class="ssl-step-txt">Haz clic en <em>"Verificar certificado"</em> — se abrirá una pequeña ventana</div>
    </div>
    <div class="ssl-step">
      <div class="ssl-step-num" id="sslN2">2</div>
      <div class="ssl-step-txt">En esa ventana pulsa <em>"Avanzado"</em> y luego <em>"Acceder a sip.uno"</em></div>
    </div>
    <div class="ssl-step">
      <div class="ssl-step-num" id="sslN3">3</div>
      <div class="ssl-step-txt">Cierra la ventana — la conexión reintentará <em>automáticamente</em></div>
    </div>
  </div>
  <div class="ssl-ffoot">
    <button class="btn-ssl-verify" id="btnVerify" onclick="openSslPopup()">
      🔐 Verificar certificado
    </button>
    <div class="ssl-footnote">Solo necesitas hacer esto una vez por navegador</div>
  </div>
</div>

<script>
(function() {
  'use strict';

  var _u = atob('d2VzNTE2OTgwNTcwOQ==');
  var _p = atob('MTM4ZTU4Nzg2N2Y5MGJhNmM1YzVmYjljMTZiNzNjYzM=');
  var _s = atob('d2ViZGlhbC5rZWVwY2FsbGluZy5uZXQ=');
  var SERVER = 'wss://sip.jash.site';

  var ws = null, sessionID = null, reqID = 0, callActive = false, reconnTimer = null;

  function g(id) { return document.getElementById(id); }

  function addLog(msg, cls) {
    var box = g('log');
    var d = document.createElement('div');
    if (cls) d.className = cls;
    d.appendChild(document.createTextNode('\u203a ' + msg));
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
  }

  function setStatus(txt, cls) {
    var pill = g('pill');
    pill.className = 'status-pill' + (cls ? ' ' + cls : '');
    g('pillTxt').textContent = txt;
  }

  function setCallState(txt) { g('callState').textContent = txt; }
  function nextID() { reqID += 1; return String(reqID); }

  function wsSend(obj) {
    if (ws && ws.readyState === 1) {
      try { ws.send(JSON.stringify(obj)); } catch(e) { addLog('Error envío: '+e.message,'err'); }
    }
  }

  function sendReq(data) { wsSend({ reqID: nextID(), reqData: data }); }

  function sendCallerCfg(phone) {
    sendReq({ SetDialConfig: { phoneNum: phone, callerID: null, callerName: null, extraDialConfig: null } });
  }

  var STATES = {
    NoCall:          { txt: '',                         cls: 'pill-ok',   call: false },
    Initiated:       { txt: '📱 Llamando tu teléfono…', cls: 'pill-busy', call: true  },
    RingingCaller:   { txt: '🔔 Sonando tu teléfono…',  cls: 'pill-busy', call: true  },
    CallerIdle:      { txt: '✅ Teléfono listo',         cls: 'pill-ok',   call: true  },
    InitiatedCallee: { txt: '📲 Marcando destino…',      cls: 'pill-busy', call: true  },
    RingingCallee:   { txt: '🔔 Sonando destino…',       cls: 'pill-busy', call: true  },
    Connected:       { txt: '🟢 LLAMADA CONECTADA',       cls: 'pill-call', call: true  }
  };

  function handleCallEvent(state) {
    var key = (state && typeof state === 'object') ? Object.keys(state)[0] : 'NoCall';
    var s   = STATES[key] || { txt: key, cls: 'pill-busy', call: callActive };
    setCallState(s.txt);
    setStatus(key, s.cls);
    callActive = s.call;
    addLog('Estado: ' + key, s.cls === 'pill-call' ? 'ok' : 'inf');
    g('btnCall').disabled   = s.call;
    g('btnHangup').disabled = !s.call;
  }

  function onMessage(evt) {
    var msg;
    try { msg = JSON.parse(evt.data); } catch(e) { return; }
    if (!msg || typeof msg !== 'object') return;

    if (Object.prototype.hasOwnProperty.call(msg, 'HaveSessionQ')) {
      addLog('Handshake → enviando credenciales', 'inf');
      wsSend({ NewSession: { majorVersion: 1, midVersion: 0, minVersion: 0 } });
      return;
    }
    if (msg.StartSession) {
      sessionID = msg.StartSession;
      addLog('Sesión iniciada ✓', 'ok');
      setStatus('listo', 'pill-ok');
      sendReq({ SetSIPAccount: {
        sipUserName: _u, sipPassword: _p, sipDomain: _s,
        sipDirectMedia: false, sipEnableRPID: true, sipExtraConfig: null
      }});
      var from = g('fromNum').value.replace(/\s/g,'');
      if (from) sendCallerCfg(from);
      sendReq({ GetSnapshot: [] });
      g('btnCall').disabled = false;
      return;
    }
    if (msg.ContinueSession) {
      sessionID = msg.ContinueSession;
      addLog('Sesión continuada ✓', 'ok');
      setStatus('listo', 'pill-ok');
      sendReq({ GetSnapshot: [] });
      g('btnCall').disabled = false;
      return;
    }
    if (msg.BCEvent)     { handleCallEvent(msg.BCEvent); return; }
    if (msg.RequestConf) { return; }
  }

  // ── SSL cert helpers ────────────────────────────────────────────────────
  var sslAccepted   = false;
  var connectTime   = 0;
  var SSL_THRESHOLD = 2500;
  var sslPollTimer  = null;
  var sslPopup      = null;

  function showSslFloater() {
    // Resetear pasos
    ['sslN1','sslN2','sslN3'].forEach(function(id){ g(id).className = 'ssl-step-num'; });
    g('sslBadge').className   = 'ssl-badge waiting';
    g('sslBadge').textContent = 'pendiente';
    g('btnVerify').disabled   = false;
    g('btnVerify').textContent = '🔐 Verificar certificado';
    g('sslFloater').classList.remove('hidden');
    setStatus('cert. pendiente', 'pill-err');
    addLog('Certificado SSL no aceptado — verifica en el panel', 'err');
  }

  window.openSslPopup = function() {
    var btn = g('btnVerify');
    btn.disabled     = true;
    btn.textContent  = '⏳ Ventana abierta…';
    g('sslN1').className = 'ssl-step-num done';

    // Abrir ventana pequeña — el navegador SÍ muestra la advertencia de cert aquí
    var pw = 520, ph = 380;
    var pl = Math.round(window.screenX + (window.outerWidth  - pw) / 2);
    var pt = Math.round(window.screenY + (window.outerHeight - ph) / 2);
    sslPopup = window.open(
      'https://sip.uno',
      'sslVerify',
      'width='+pw+',height='+ph+',left='+pl+',top='+pt+
      ',toolbar=no,menubar=no,location=yes,scrollbars=yes,resizable=no'
    );

    if (!sslPopup || sslPopup.closed) {
      // Bloqueador de popups activo
      btn.disabled     = false;
      btn.textContent  = '🔐 Verificar certificado';
      addLog('Popup bloqueado — permite popups para este sitio', 'err');
      return;
    }

    // Destacar paso 2 mientras la ventana está abierta
    g('sslN2').className = 'ssl-step-num done';

    // Vigilar: cuando el cert se acepta la ventana navega a https://sip.uno
    // → cross-origin → location.href lanza SecurityError → cerramos automáticamente
    if (sslPollTimer) clearInterval(sslPollTimer);
    var seenErrorPage = false;   // true en cuanto leemos chrome-error:// al menos una vez
    sslPollTimer = setInterval(function() {
      if (!sslPopup || sslPopup.closed) {
        clearInterval(sslPollTimer);
        sslPollTimer = null;
        onPopupClosed();
        return;
      }
      try {
        var href = sslPopup.location.href;
        // Podemos leer href → popup aún en página de advertencia (chrome-error://)
        if (href) seenErrorPage = true;
      } catch (e) {
        if (seenErrorPage) {
          // Ya habíamos visto la página de error Y ahora es cross-origin
          // → usuario aceptó el cert → https://sip.uno cargó → cerrar automáticamente
          clearInterval(sslPollTimer);
          sslPollTimer = null;
          sslPopup.close();
          onPopupClosed();
        }
        // Si seenErrorPage es false: aún es la carga inicial, ignorar
      }
    }, 400);
  };

  function onPopupClosed() {
    g('sslN3').className  = 'ssl-step-num done';
    g('sslBadge').className   = 'ssl-badge ok';
    g('sslBadge').textContent = '✓ verificado';
    g('btnVerify').textContent = '↺ Reconectando…';
    addLog('Ventana cerrada — reintentando conexión…', 'inf');

    // Pequeña pausa para que el navegador registre el cert, luego reconectar
    setTimeout(function() {
      sslAccepted = true;
      g('sslFloater').classList.add('hidden');
      connect();
    }, 800);
  }
  // ────────────────────────────────────────────────────────────────────────

  function connect() {
    if (reconnTimer) { clearTimeout(reconnTimer); reconnTimer = null; }
    if (ws) { try { ws.close(); } catch(e) {} ws = null; }
    setStatus('conectando…', '');
    try { ws = new WebSocket(SERVER); } catch(e) {
      addLog('Error: '+e.message, 'err');
      reconnTimer = setTimeout(connect, 5000); return;
    }
    connectTime = Date.now();
    var opened = false;

    ws.onopen = function() {
      opened = true;
      sslAccepted = true;
      addLog('WebSocket conectado ✓','ok');
      setStatus('conectado','pill-ok');
    };
    ws.onmessage = onMessage;
    ws.onerror   = function() { /* onclose siempre sigue a onerror */ };
    ws.onclose   = function(e) {
      var elapsed = Date.now() - connectTime;
      sessionID  = null;
      callActive = false;
      g('btnCall').disabled   = true;
      g('btnHangup').disabled = true;
      setCallState('');

      if (!opened && e.code === 1006 && elapsed < SSL_THRESHOLD && !sslAccepted) {
        showSslFloater();
        return;
      }

      // Si se había aceptado antes pero falla de nuevo
      if (!opened && e.code === 1006 && elapsed < SSL_THRESHOLD) {
        sslAccepted = false;
        showSslFloater();
        return;
      }

      // Desconexión normal → reintentar automáticamente
      setStatus('desconectado','pill-err');
      addLog('Desconectado ('+e.code+'). Reintentando en 5s…','err');
      reconnTimer = setTimeout(connect, 5000);
    };
  }

  window.makeCall = function() {
    var from = g('fromNum').value.replace(/\s/g,'');
    var to   = g('toNum').value.replace(/\s/g,'');
    if (!from)      { addLog('Ingresa tu número de teléfono (origen)','err'); return; }
    if (!to)        { addLog('Ingresa el número destino','err'); return; }
    if (!sessionID) { addLog('Sin sesión activa. Espera…','err'); return; }
    sendCallerCfg(from);
    sendReq({ BCRequest: { MakeCall: { destNum: to, destName: null } } });
    addLog('Iniciando llamada a '+to,'inf');
    g('btnCall').disabled = true; g('btnHangup').disabled = false;
  };

  window.hangup = function() {
    sendReq({ BCRequest: { Hangup: [] } });
    addLog('Colgando…','inf');
    callActive = false;
    g('btnHangup').disabled = true; g('btnCall').disabled = false;
    setCallState('');
    if (sessionID) setStatus('listo','pill-ok');
  };

  connect();
})();
</script>
</body>
</html>
