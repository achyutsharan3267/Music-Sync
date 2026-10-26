import { createServer } from 'node:http';
import { createReadStream, mkdirSync, statSync } from 'node:fs';
import { createWriteStream, promises as fs } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));
const audioRoot = resolve(root, '.local-audio');
mkdirSync(audioRoot, { recursive: true });
const audioPath = (room, index) => resolve(audioRoot, room, `${index}.mp3`);
const isAudioRoute = (pathname) => /^\/api\/rooms\/[A-Z0-9]{6}\/tracks\/\d+$/.test(pathname);
const mime = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

async function handleApi(req, res, url) {
  if (!isAudioRoute(url.pathname)) return false;
  const [, , , room, , indexText] = url.pathname.split('/');
  const filePath = audioPath(room, Number(indexText));
  if (req.method === 'PUT') {
    if (req.headers['content-type'] !== 'audio/mpeg') { res.writeHead(415).end('MP3 audio only'); return true; }
    await fs.mkdir(dirname(filePath), { recursive: true });
    let size = 0;
    const output = createWriteStream(filePath);
    req.on('data', (chunk) => { size += chunk.length; if (size > 100 * 1024 * 1024) { req.unpipe(output); output.destroy(); req.resume(); void fs.rm(filePath, { force: true }); if (!res.headersSent) res.writeHead(413).end('MP3 files must be under 100 MB'); } });
    req.pipe(output);
    output.on('finish', () => res.writeHead(201, { 'Cache-Control': 'no-store' }).end('Uploaded'));
    output.on('error', (error) => { void fs.rm(filePath, { force: true }); if (!res.headersSent) res.writeHead(500).end(error.message); });
    return true;
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    let stat;
    try { stat = statSync(filePath); } catch { res.writeHead(404).end('Track not uploaded'); return true; }
    const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    const start = range ? Number(range[1] || 0) : 0;
    const end = range && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end(); return true; }
    res.writeHead(range ? 206 : 200, { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'no-store', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}) });
    if (req.method === 'HEAD') res.end(); else createReadStream(filePath, { start, end }).pipe(res);
    return true;
  }
  res.writeHead(405, { Allow: 'GET, HEAD, PUT' }).end(); return true;
}

const dev = process.argv.includes('--dev');
const vite = dev ? await createViteServer({ server: { middlewareMode: true, hmr: false, allowedHosts: true } }) : null;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (await handleApi(req, res, url)) return;
    if (vite) { vite.middlewares(req, res, () => {}); return; }
    const distRoot = resolve(root, 'dist');
    const pathname = decodeURIComponent(url.pathname);
    let filePath = resolve(distRoot, `.${pathname}`);
    if (!filePath.startsWith(`${distRoot}${sep}`) && filePath !== distRoot) { res.writeHead(403).end(); return; }
    try { if (!statSync(filePath).isFile()) throw new Error(); } catch { filePath = resolve(distRoot, 'index.html'); }
    const contentType = filePath.endsWith('.html') ? 'text/html; charset=utf-8' : mime[extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType }); createReadStream(filePath).pipe(res);
  } catch (error) { console.error(error); if (!res.headersSent) res.writeHead(500).end('Server error'); }
});
const port = Number(process.env.PORT || 5173);
server.listen(port, '0.0.0.0', () => console.log(`SyncMusic ${dev ? 'dev' : 'server'} listening on port ${port}; open this computer's Wi-Fi IP on every device.`));
process.on('SIGINT', async () => { server.close(); await vite?.close(); process.exit(0); });
