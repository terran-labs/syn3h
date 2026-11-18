#!/usr/bin/env node
/** Serve a frozen client and its matching room protocol in one process.
 * node tools/serve-stable.mjs --dir ../Syn3h-stable/current --port "$PASEO_PORT"
 * Restart explicitly after promoting. The current symlink is resolved only once.
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { resolve, join, relative, extname, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';

const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.map':'application/json', '.wasm':'application/wasm', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon', '.mp3':'audio/mpeg', '.ogg':'audio/ogg', '.wav':'audio/wav', '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf', '.glb':'model/gltf-binary', '.txt':'text/plain; charset=utf-8', '.webmanifest':'application/manifest+json' };
const inside = (root, file) => { const p = relative(root, file); return p !== '..' && !p.startsWith('../') && !isAbsolute(p); };

export async function serveStable({ dir, port }) {
  const snapshot = await realpath(resolve(dir));
  const root = await realpath(join(snapshot, 'dist'));
  const require = createRequire(join(snapshot, 'package.json'));
  const { tsImport } = require('tsx/esm/api');
  const options = { parentURL: pathToFileURL(join(snapshot, 'package.json')).href, tsconfig: join(snapshot, 'tsconfig.json') };
  // Never import from the live checkout: a protocol mismatch can corrupt a room.
  const { Room, CLOCK_MS = 1000 } = await tsImport(pathToFileURL(join(snapshot, 'server/room.ts')).href, options);
  const { roomName } = await tsImport(pathToFileURL(join(snapshot, 'server/util.ts')).href, options);
  const { WebSocketServer, WebSocket } = require('ws');
  const rooms = new Map();
  // The room's own clock, as server/dev.ts and the Worker run it. A snapshot frozen before
  // Room.needsClock existed reads undefined here and keeps its message driven ticks.
  const clocks = new Map();
  const keepClock = room => {
    if (clocks.has(room) || !room.needsClock) return;
    clocks.set(room, setTimeout(() => { clocks.delete(room); if (rooms.get(room.name) !== room) return; room.tick(); keepClock(room); }, CLOCK_MS));
  };
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const server = createServer(async (req, res) => {
    try {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/ws') { res.writeHead(426).end('WebSocket upgrade required'); return; }
      // The lobby polls /presence (server/dev.ts and the Worker answer it). This one process has
      // no cross-room registry, so it says no rooms are reporting: the shape the client reads,
      // instead of a 404 that the smoke's "no page errors" check counts as a failure.
      if (pathname === '/presence') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ version: 1, generatedAt: Date.now(), ttlMs: 90000, byRecipe: [] })); return; }
      if (pathname.includes('\0') || pathname.includes('\\')) { res.writeHead(400).end(); return; }
      const requested = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!inside(root, requested)) { res.writeHead(403).end(); return; }
      const file = await realpath(requested);
      if (!inside(root, file)) { res.writeHead(403).end(); return; }
      const info = await stat(file);
      if (!info.isFile()) { res.writeHead(404).end(); return; }
      const fresh = ['index.html', 'build.json'].includes(relative(root, file));
      const hashed = /^\/assets\/.*-[\w-]{8,}\.[\w.]+$/.test(pathname);
      res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': fresh ? 'no-store' : hashed ? 'public, max-age=31536000, immutable' : 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      if (req.method === 'HEAD') res.end();
      else await pipeline(createReadStream(file), res);
    } catch (error) {
      if (!res.headersSent) res.writeHead(error instanceof URIError ? 400 : ['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 500).end();
      else res.destroy();
    }
  });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws') { socket.destroy(); return; }
    sockets.handleUpgrade(req, socket, head, ws => {
      const name = roomName(url.searchParams.get('room'));
      let room = rooms.get(name);
      if (!room) { room = new Room(name); rooms.set(name, room); }
      const peer = { send: data => { if (ws.readyState === WebSocket.OPEN) ws.send(data); }, close: (code, reason) => ws.close(code, reason) };
      room.connect(peer);
      ws.on('message', (data, binary) => {
        const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
        room.receive(peer, binary ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : bytes.toString());
        keepClock(room);
      });
      ws.on('close', () => { room.disconnect(peer); if (room.connectionCount === 0 && rooms.get(name) === room) { rooms.delete(name); clearTimeout(clocks.get(room)); clocks.delete(room); } });
      ws.on('error', () => ws.close());
    });
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
  return { server, snapshot, close: async () => { for (const t of clocks.values()) clearTimeout(t); clocks.clear(); for (const ws of sockets.clients) ws.terminate(); sockets.close(); await new Promise(done => server.close(done)); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const value = key => args[args.indexOf(key) + 1];
    const dir = args.includes('--dir') ? value('--dir') : undefined;
    const port = Number(args.includes('--port') ? value('--port') : process.env.PASEO_PORT);
    if (!dir || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Usage: node tools/serve-stable.mjs --dir SNAPSHOT --port PORT');
    const app = await serveStable({ dir, port });
    console.log(`Stable snapshot ${app.snapshot} listening on 127.0.0.1:${port}`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
  } catch (error) { console.error('Stable server failed to start. Snapshot must include dist, server, shared, src and dependencies.\n', error); process.exitCode = 1; }
}
