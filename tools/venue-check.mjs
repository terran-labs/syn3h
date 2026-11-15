/**
 * Checks the venue fallback: the frozen build served from this Mac to the local network over
 * plain http (docs/VENUE-FALLBACK.md). Opens two players at the given address, each in its
 * own headless Chrome, and reports what a guest's browser gets there.
 *
 *   node tools/venue-check.mjs http://192.168.12.129:8080/
 *
 * A plain http page on a LAN address is not a secure context, so WebGPU and the clipboard are
 * missing and the game must fall back to WebGL. Passes (exit 0) when both players load,
 * render, connect to the room over ws:// and see each other move.
 */
import { chromium } from 'playwright-core'

const base = process.argv[2]
if (!base) { console.error('Usage: node tools/venue-check.mjs http://<lan address>:<port>/'); process.exit(2) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const room = `venue${Date.now() % 100000}`
const browsers = []
const errors = []
async function open(name) {
  const br = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
  browsers.push(br)
  const page = await (await br.newContext({ viewport: { width: 800, height: 450 } })).newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  await page.goto(`${base}?room=${room}&name=${name}&autoplay=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.syn3h?.shell, null, { timeout: 90000 })
  await page.evaluate(() => { window.syn3h.shell.play(); document.activeElement?.blur?.() })
  return page
}

let ok = false
try {
  const a = await open('Alice')
  const b = await open('Bob')
  await Promise.all([a, b].map((p) => p.waitForFunction(() => window.syn3hNet?.connected && window.syn3hNet.players.size === 2, null, { timeout: 30000 })))
  const idA = await a.evaluate(() => window.syn3hNet.id)
  await b.waitForFunction((id) => window.syn3hNet.remotes.has(id), idA, { timeout: 15000 })
  const copyOfA = () => b.evaluate((id) => { const t = window.syn3hNet.remotes.get(id).vehicle.body.translation(); return [t.x, t.z] }, idA)
  const before = await copyOfA()
  await a.evaluate(() => { window.syn3h.game.input.external.y = 1 })
  await wait(3000)
  await a.evaluate(() => { window.syn3h.game.input.external.y = 0 })
  const after = await copyOfA()
  const moved = Math.hypot(after[0] - before[0], after[1] - before[1])
  const browser = await a.evaluate(async () => ({
    secureContext: window.isSecureContext,
    webgpu: 'gpu' in navigator,
    backend: window.syn3h.game.backend,
    clipboard: Boolean(navigator.clipboard),
    gamepads: typeof navigator.getGamepads === 'function',
    deviceOrientation: 'DeviceOrientationEvent' in window,
    wakeLock: 'wakeLock' in navigator,
    socket: window.syn3hNet.conn?.url ?? null,
    inviteOrigin: location.origin,
    hud: document.getElementById('hud')?.textContent.split('\n').slice(0, 2).join(' | '),
  }))
  await b.screenshot({ path: '/tmp/syn3h-venue-check.png' })
  ok = moved > 3 && errors.length === 0
  console.log(JSON.stringify({ browser, movedOnOtherScreen: +moved.toFixed(1), errors }, null, 2))
} finally {
  await Promise.all(browsers.map((b) => b.close()))
}
console.log(ok ? 'VENUE CHECK OK, screenshot /tmp/syn3h-venue-check.png' : 'VENUE CHECK FAILED')
process.exit(ok ? 0 : 1)
