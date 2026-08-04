// server.js — Servidor estatico minimo, SIN dependencias externas.
// No usa Vite, Rollup, ni ningun paquete npm: solo modulos nativos de Node.
// Correr con: node server.js

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PORT = 5173;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let reqPath = decodeURIComponent(req.url.split('?')[0]);
  if (reqPath === '/') reqPath = '/index.html';

  const filePath = path.join(ROOT, reqPath);

  // Evita salir de la carpeta del proyecto
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Prohibido');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 - No encontrado: ' + reqPath);
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  CYBER-GEN V15.2 corriendo en:');
  console.log(`  http://localhost:${PORT}`);
  console.log('');
  console.log('  Presiona Ctrl+C para detener el servidor.');
  console.log('');
});
