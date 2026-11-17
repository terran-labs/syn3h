/**
 * A latency and jitter proxy for multiplayer testing. Forwards plain HTTP unchanged and relays
 * WebSockets with every message held back by half the round trip plus random jitter, in each
 * direction, in order (a TCP connection never reorders). Put it in front of either a whole
 * origin (`wrangler dev`, where the page and /ws share it) or just a room server (Vite dev,
 * with VITE_SERVER_URL pointing at the proxy).
 *
 *   npx tsx server/latency-proxy.ts --listen 8794 --target http://127.0.0.1:8787 --rtt 150 --jitter 30
 *
 * Loss and stalls, the way a TCP connection shows them. A WebSocket never drops a message:
 * a lost packet is retransmitted, and everything behind it waits (head of line blocking).
 *
 *   --loss 0.03 --rto 200     each message has a 3% chance of being "lost": it and all
 *                             behind it are held 200 ms, doubling each time the resend is
 *                             lost too (at the same odds, at most three doublings)
 *   --stall 500 --stall-every 10   every 10 s nothing passes for 500 ms, both ways (a Wi-Fi
 *                             roam, a phone switching cells), then the backlog arrives at once
 */
import { createServer, request } from 'node:http'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import { delayedSender } from './latencyDelay'

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

/** Chance that a message is lost and must be resent, 0 to 1, each direction. */
const loss = Number(arg('loss', '0'))
/** Retransmission delay after a loss, ms. */
const rto = Number(arg('rto', '200'))
/** Length of the periodic full stall, ms (0 for none), and seconds between stalls. */
const stall = Number(arg('stall', '0'))
const stallEvery = Number(arg('stall-every', '10')) * 1000
const started = Date.now()

/** If `t` falls inside a stall window, the end of that window; otherwise `t`. */
function afterStall(t: number): number {
  if (stall <= 0) return t
  const into = (t - started) % stallEvery
  // The first window opens one period after start, so joining is never stalled.
  return t - started >= stallEvery && into < stall ? t - into + stall : t
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
    // In order, always: see server/latencyDelay.ts.
    const delay = { rtt, jitter, loss, rto, afterStall }
    const toUp = delayedSender((d: RawData, b: boolean) => { if (upstream.readyState === WebSocket.OPEN) upstream.send(d, { binary: b }) }, delay)
    const toClient = delayedSender((d: RawData, b: boolean) => { if (client.readyState === WebSocket.OPEN) client.send(d, { binary: b }) }, delay)
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
  console.log(`latency proxy :${listen} -> ${target.origin}, rtt ${rtt} ms, jitter 0..${jitter} ms each way, loss ${loss} (rto ${rto} ms), stall ${stall} ms every ${stallEvery / 1000} s`)
})
