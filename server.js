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

function handleRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let reqPath = decodeURIComponent(req.url.split('?')[0]);
  let filePath = null;

  // Rutas amigables
  if (reqPath === '/' || reqPath === '') {
    filePath = path.join(ROOT, 'index.html');
  } else if (reqPath === '/tienda' || reqPath === '/tienda.html' || reqPath === '/catalogo') {
    filePath = path.join(ROOT, 'tienda.html');
  } else {
    let p = path.join(ROOT, reqPath);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      p = path.join(p, 'index.html');
    }
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      filePath = p;
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

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

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

const targetPorts = [8081, 8080, 5000];
targetPorts.forEach(port => {
  const s = http.createServer(handleRequest);
  s.listen(port, '0.0.0.0', () => {
    console.log(`[Black Honey Server] Activo en http://localhost:${port}/ y http://127.0.0.1:${port}/`);
  });
  s.on('error', (err) => {
    // Puerto ocupado, omitir silenciosamente
  });
});
