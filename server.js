/* Minimal zero-dependency static server for Railway/Node hosting.
   Serves index.html + api.js (and other files) from this folder on $PORT.
   Not needed for a plain static host — only for a Node host like Railway. */
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
  const started = Date.now();
  const log = (code) => console.log(req.method + ' ' + req.url + ' -> ' + code + ' (' + (Date.now() - started) + 'ms)');
  try {
    // Health check endpoint (Railway can probe this)
    if (req.url === '/healthz' || req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); log(200); return;
    }

    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

    const filePath = path.normalize(path.join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); log(403); return; }

    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        // fall back to index.html for unknown paths
        const fallback = path.join(ROOT, 'index.html');
        return fs.readFile(fallback, (e2, buf) => {
          if (e2) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('index.html not found in ' + ROOT);
            console.error('!! index.html MISSING at ' + fallback + ' :: ' + e2.message);
            log(404); return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(buf); log(200);
        });
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res); log(200);
    });
  } catch (e) {
    res.writeHead(500); res.end('Server error'); log(500);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('==================================================');
  console.log('Villa Siesta static server');
  console.log('  listening on : 0.0.0.0:' + PORT + '  (env PORT=' + (process.env.PORT || '(unset)') + ')');
  console.log('  serving dir  : ' + ROOT);
  try {
    const files = fs.readdirSync(ROOT);
    console.log('  files here   : ' + files.join(', '));
    console.log('  index.html   : ' + (files.indexOf('index.html') !== -1 ? 'FOUND' : 'MISSING'));
  } catch (e) { console.error('  readdir error: ' + e.message); }
  console.log('==================================================');
});
