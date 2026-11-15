/**
 * A minimal static server for a production build, with gzip like the Cloudflare host, so
 * startup-profile.mjs can compare bytes on the wire with the dev server.
 *
 *   node tools/startup-serve.mjs DIR PORT
 *
 * Closes /ws upgrades by not handling them. Local measurement only, not a release server.
 */
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createGzip } from 'node:zlib'
import { join, resolve, extname, relative } from 'node:path'

const root = resolve(process.argv[2] ?? 'dist'), port = Number(process.argv[3] ?? 5211)
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.webmanifest': 'application/manifest+json', '.glb': 'model/gltf-binary' }
const compressible = /^(text\/|application\/(json|wasm|manifest)|image\/svg)/
createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let file = resolve(root, '.' + (path === '/' ? '/index.html' : path))
  if (relative(root, file).startsWith('..')) { res.writeHead(403).end(); return }
  let info = await stat(file).catch(() => null)
  if (!info?.isFile()) { file = join(root, 'index.html'); info = await stat(file) }
  const type = types[extname(file)] ?? 'application/octet-stream'
  const hashed = /\/assets\//.test(file)
  const headers = { 'content-type': type, 'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache' }
  if (compressible.test(type) && /gzip/.test(req.headers['accept-encoding'] ?? '')) {
    res.writeHead(200, { ...headers, 'content-encoding': 'gzip', vary: 'accept-encoding' })
    createReadStream(file).pipe(createGzip({ level: 6 })).pipe(res)
  } else {
    res.writeHead(200, { ...headers, 'content-length': info.size })
    createReadStream(file).pipe(res)
  }
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}/`))
