import fs from 'node:fs';
import path from 'node:path';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg' };

/** Mount dedicated public directories, never an entire application checkout. */
export function staticFiles(mounts) {
  const routes = Object.entries(mounts).sort(([a], [b]) => b.length - a.length);
  return (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
    if (pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (pathname.includes('\\') || pathname.split('/').some(part => part === '..' || part.startsWith('.'))) { res.writeHead(404).end(); return; }
    if (pathname.endsWith('/')) pathname += 'index.html';
    const route = routes.find(([prefix]) => pathname.startsWith(prefix));
    if (!route || !MIME[path.extname(pathname)]) { res.writeHead(404).end(); return; }
    const [prefix, directory] = route;
    const root = path.resolve(directory), filename = path.resolve(root, pathname.slice(prefix.length));
    if (!filename.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
    fs.realpath(filename, (error, real) => {
      if (error || !real.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
      fs.stat(real, (error, stat) => {
        if (error || !stat.isFile()) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(real)], 'content-length': stat.size, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' });
        if (req.method === 'HEAD') res.end(); else fs.createReadStream(real).on('error', () => res.destroy()).pipe(res);
      });
    });
  };
}
