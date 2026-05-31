#!/usr/bin/env python3
"""
Ejecutar: python3 iniciar.py
Luego abrir en cualquier navegador: http://localhost:8080
"""
import http.server, os, sys

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args): pass  # silencia el log
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

os.chdir(os.path.dirname(os.path.abspath(__file__)))
port = 8080
print("\n✅  Abre en tu navegador: http://localhost:{}/sip-caller.html".format(port))
print("   Presiona Ctrl+C para detener\n")
httpd = http.server.HTTPServer(('', port), Handler)
httpd.serve_forever()
