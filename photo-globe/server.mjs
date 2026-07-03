// Minimal static file server for the Photo Globe asset.
// Serves this file's own directory — no dependency on process.cwd().
import { createServer } from 'node:http';
import { readFile } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 5599;
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml'
};

createServer((req, res) => {
  let path = decodeURIComponent(req.url.split('?')[0]);
  if (path === '/' || path.endsWith('/')) path += 'index.html';
  const full = join(ROOT, normalize(path));
  if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}).listen(PORT, () => console.log('photo-globe on http://localhost:' + PORT));
