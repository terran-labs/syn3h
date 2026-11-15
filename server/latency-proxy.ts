/**
 * A latency and jitter proxy for multiplayer testing. Forwards plain HTTP unchanged and relays
 * WebSockets with every message held back by half the round trip plus random jitter, in each
 * direction, in order (a TCP connection never reorders). Put it in front of either a whole
 * origin (`wrangler dev`, where the page and /ws share it) or just a room server (Vite dev,
 * with VITE_SERVER_URL pointing at the proxy).
 *
 *   npx tsx server/latency-proxy.ts --listen 8794 --target http://127.0.0.1:8787 --rtt 150 --jitter 30
 *
 * `--loss` is not offered: WebSockets ride TCP, so loss shows up as extra delay, which jitter
 * already models.
 */
import { createServer, request } from 'node:http'
import { WebSocket, WebSocketServer, type RawData } from 'ws'

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const listen = Number(arg('listen', '8794'))
const target = new URL(arg('target', 'http://127.0.0.1:8787'))
/** Round trip added, ms; each direction gets half. */
const rtt = Number(arg('rtt', '100'))
/** Extra delay per message, uniformly random in [0, jitter] ms, each direction. */
const jitter = Number(arg('jitter', '0'))

/** Delivers messages after the configured delay without ever reordering them. */
function delayedSender(send: (data: RawData, binary: boolean) => void) {
  let last = 0
  return (data: RawData, binary: boolean) => {
    const due = Math.max(last, Date.now() + rtt / 2 + Math.random() * jitter)
    last = due
    setTimeout(() => send(data, binary), due - Date.now())
  }
}

const http = createServer((req, res) => {
  const up = request(
    { host: target.hostname, port: target.port, path: req.url, method: req.method, headers: { ...req.headers, host: target.host } },
    (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers)
      r.pipe(res)
    },
  )
  up.on('error', (e) => {
    res.writeHead(502)
    res.end(String(e))
  })
  req.pipe(up)
})

const wss = new WebSocketServer({ noServer: true })
http.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (client) => {
    const proto = target.protocol === 'https:' ? 'wss:' : 'ws:'
    const upstream = new WebSocket(`${proto}//${target.host}${req.url ?? '/'}`)
    const pending: [RawData, boolean][] = []
    const toUp = delayedSender((d, b) => upstream.readyState === WebSocket.OPEN && upstream.send(d, { binary: b }))
    const toClient = delayedSender((d, b) => client.readyState === WebSocket.OPEN && client.send(d, { binary: b }))
    client.on('message', (d, b) => (upstream.readyState === WebSocket.OPEN ? toUp(d, b) : pending.push([d, b])))
    upstream.on('open', () => { for (const [d, b] of pending.splice(0)) toUp(d, b) })
    upstream.on('message', (d, b) => toClient(d, b))
    // Closing is delayed too, so a close never overtakes the messages before it.
    const close = (ws: WebSocket) => () => setTimeout(() => ws.close(), rtt / 2 + jitter)
    client.on('close', close(upstream))
    upstream.on('close', close(client))
    upstream.on('error', () => client.close())
    client.on('error', () => upstream.close())
  })
})

http.listen(listen, '127.0.0.1', () => {
  console.log(`latency proxy :${listen} -> ${target.origin}, rtt ${rtt} ms, jitter 0..${jitter} ms each way`)
})
