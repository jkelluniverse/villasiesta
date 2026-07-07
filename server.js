/* Minimal zero-dependency static server for Railway/Node hosting.
   Serves index.html + api.js (and other files) from this folder on $PORT.
   Not needed for GoDaddy static hosting — only for a Node host like Railway. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8'
};

const server = http.createServer((req, res) => {
  try {
    // strip query string, decode, normalize
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

    // resolve safely inside ROOT (block path traversal)
    const filePath = path.normalize(path.join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }

    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        // SPA-style fallback: unknown path → index.html
        const fallback = path.join(ROOT, 'index.html');
        return fs.readFile(fallback, (e2, buf) => {
          if (e2) { res.writeHead(404); res.end('Not found'); return; }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(buf);
        });
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (e) {
    res.writeHead(500); res.end('Server error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Villa Siesta site listening on 0.0.0.0:' + PORT);
});
