const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = __dirname;

const MIMES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json'
};

const COMPRESSIBLE = new Set(['.html', '.js', '.json', '.css', '.svg']);

// Resuelve una ruta pedida dentro de ROOT. Devuelve null si el resultado
// se sale de ROOT (path traversal) o si la ruta no es decodificable.
function safeResolve(reqPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(reqPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const normalized = path.posix.normalize('/' + decoded.replace(/\\/g, '/'));
  // Nada de archivos/carpetas ocultos: .git, .env, .claude...
  if (normalized.split('/').some((seg) => seg.startsWith('.') && seg !== '')) return null;
  const resolved = path.resolve(ROOT, '.' + normalized);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) return null;
  return resolved;
}

function handleRequest(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', 'Allow': 'GET, HEAD, OPTIONS' });
    res.end('405 Method Not Allowed');
    return;
  }

  const reqPath = req.url.split('?')[0];
  let filePath = null;

  // Rutas amigables
  if (reqPath === '/' || reqPath === '') {
    filePath = path.join(ROOT, 'index.html');
  } else if (reqPath === '/tienda' || reqPath === '/tienda.html' || reqPath === '/catalogo') {
    filePath = path.join(ROOT, 'tienda.html');
  } else {
    const p = safeResolve(reqPath);
    if (p === null) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }
    let candidate = p;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      candidate = path.join(candidate, 'index.html');
    }
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      filePath = candidate;
    } else if (fs.existsSync(p + '.html') && fs.statSync(p + '.html').isFile()) {
      filePath = p + '.html';
    }
  }

  if (!filePath || !fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found: ' + reqPath);
    return;
  }

  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIMES[ext] || 'application/octet-stream';

  // El HTML se revalida siempre para que un deploy se vea de inmediato; los
  // assets (imágenes, video, fuentes) se cachean fuerte porque no cambian.
  if (ext === '.html') {
    res.setHeader('Cache-Control', 'no-cache');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
  res.setHeader('ETag', `"${stat.size}-${stat.mtimeMs}"`);
  if (req.headers['if-none-match'] === `"${stat.size}-${stat.mtimeMs}"`) {
    res.writeHead(304);
    res.end();
    return;
  }

  // Soporte Range para video streaming (.mp4)
  const range = req.headers.range;
  if (range && stat.size > 0) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunksize = end - start + 1;
    const file = fs.createReadStream(filePath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType
    });
    file.pipe(res);
    return;
  }

  const acceptEncoding = req.headers['accept-encoding'] || '';

  if (COMPRESSIBLE.has(ext) && stat.size > 512) {
    res.setHeader('Vary', 'Accept-Encoding');
    if (acceptEncoding.includes('gzip')) {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Encoding': 'gzip'
      });
      fs.createReadStream(filePath).pipe(zlib.createGzip({ level: 6 })).pipe(res);
      return;
    }
  }

  res.writeHead(200, {
    'Content-Length': stat.size,
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes'
  });
  fs.createReadStream(filePath).pipe(res);
}

// En producción (Docker/EasyPanel) se usa un único puerto vía PORT. En local se
// abren varios para no chocar con otros procesos.
const targetPorts = process.env.PORT ? [Number(process.env.PORT)] : [8081, 8080, 5000];
let listening = 0;

targetPorts.forEach(port => {
  const s = http.createServer(handleRequest);
  s.listen(port, '0.0.0.0', () => {
    listening++;
    console.log(`[Black Honey Server] Activo en http://localhost:${port}/ y http://127.0.0.1:${port}/`);
  });
  s.on('error', (err) => {
    console.error(`[Black Honey Server] No se pudo escuchar en ${port}: ${err.code}`);
    if (listening === 0 && port === targetPorts[targetPorts.length - 1]) {
      console.error('[Black Honey Server] Ningún puerto disponible, saliendo.');
      process.exit(1);
    }
  });
});
