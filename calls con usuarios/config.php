<?php
// ── Configuración de base de datos ─────────────────────────────────────────
define('DB_HOST', 'sql100.byetcluster.com');
define('DB_NAME', 'b10_41692119_sipcaller');
define('DB_USER', 'b10_41692119');          // ← cambiar
define('DB_PASS', '23227323');              // ← cambiar

// ── Configuración de correo SMTP ───────────────────────────────────────────
define('MAIL_HOST',     'smtp.gmail.com');   // ← tu servidor SMTP
define('MAIL_PORT',     587);
define('MAIL_USER',     'josesoaza@gmail.com');  // ← tu correo
define('MAIL_PASS',     'qujw mqvv ezzg khos');     // ← app password de Gmail
define('MAIL_FROM',     'josesoaza@gmail.com');
define('MAIL_FROM_NAME','SIPcall');

// ── Credenciales SIP (solo backend, nunca en el cliente) ──────────────────
define('SIP_USER',   'jash2322');
define('SIP_PASS',   'Adri2322*');
define('SIP_DOMAIN', 'sip.linphone.org');
define('SIP_SERVER', 'wss://sip.jash.site');

// ── URL base del sitio ─────────────────────────────────────────────────────
define('BASE_URL', 'http://vipiptv.byethost10.com/sipcaller');

// ── Zona horaria ───────────────────────────────────────────────────────────
date_default_timezone_set('America/Bogota');

// ── Sesión segura ──────────────────────────────────────────────────────────
session_start();

// ── Conexión PDO ───────────────────────────────────────────────────────────
function getDB(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        try {
            $pdo = new PDO(
                'mysql:host='.DB_HOST.';dbname='.DB_NAME.';charset=utf8mb4',
                DB_USER, DB_PASS,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                 PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
            );
        } catch (PDOException $e) {
            die(json_encode(['error' => 'Error de base de datos: '.$e->getMessage()]));
        }
    }
    return $pdo;
}
