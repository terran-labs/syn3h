/**
 * Scripted drive in headless Chrome for judging feel by eye: screenshots and telemetry every
 * half second through a fixed sequence (rest, launch, corners, wings, brake).
 *
 *   node tests/vehicles/drive.mjs [url] [outdir] [kind]
 *
 * kind 'buggy-classic' swaps the player for the classic buggy in page, via the Vite module graph.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'

const url = process.argv[2] ?? 'http://localhost:5182/?autoplay=1'
const out = process.argv[3] ?? '/tmp/syn3h-drive'
const kind = process.argv[4] ?? 'buggy'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`) })
await page.goto(url, { waitUntil: 'load' })
await page.waitForFunction(() => window.mira?.game?.tick > 25, null, { timeout: 30000 })
// The start screen suspends input until Play, even with ?autoplay=1.
await page.locator('.shell-play').click({ timeout: 3000 }).catch(() => {})
await page.waitForTimeout(1000)

if (kind !== 'buggy') {
  await page.evaluate(async (kind) => {
    const s = window.mira
    const { createVehicle } = await import('/src/vehicles/index.ts')
    const p = s.player.body.translation()
    const r = s.player.body.rotation()
    const heading = 2 * Math.atan2(r.y, r.w)
    const v = createVehicle(s.game, s.terrain, kind, { x: p.x, y: p.y + 1, z: p.z, clone() { return this } }, heading)
    v.isLocal = true
    const cam = s.game.systems.find((x) => 'target' in x)
    // Networking keeps a reference to the original player, so park it rather than freeing it.
    s.player.body.setEnabled(false)
    s.player.object.visible = false
    s.game.add(v)
    cam.target = v.object
    s.player = v
  }, kind)
}

const telemetry = () => page.evaluate(() => {
  const s = window.mira
  const b = s.player.body
  const p = b.translation(), v = b.linvel(), r = b.rotation()
  const upY = 1 - 2 * (r.x * r.x + r.z * r.z)
  return {
    kind: s.player.kind,
    pos: [p.x, p.y, p.z].map((n) => +n.toFixed(1)),
    ground: +s.terrain.heightAt(p.x, p.z).toFixed(1),
    speed: +Math.hypot(v.x, v.y, v.z).toFixed(1),
    upY: +upY.toFixed(3),
    wheels: s.player.wheelsGrounded,
    wings: s.player.wingsOpen,
    hd: s.player.hitDistance?.map((h) => +h.toFixed(2)),
    fps: Math.round(s.game.fps),
  }
})

const log = []
let n = 0
async function shoot(label) {
  const t = await telemetry()
  const file = `${out}/${String(n++).padStart(2, '0')}-${label}.png`
  await page.screenshot({ path: file })
  log.push({ file, label, ...t })
  console.log(label.padEnd(10), JSON.stringify(t))
}
async function hold(keys, seconds, label) {
  for (const k of keys) await page.keyboard.down(k)
  for (let t = 0; t < seconds; t += 0.5) {
    await page.waitForTimeout(500)
    await shoot(label)
  }
  for (const k of keys) await page.keyboard.up(k)
}

await page.waitForTimeout(1500)
await shoot('rest')
await hold(['KeyW'], 5, 'launch')
await hold(['KeyW', 'KeyA'], 1.5, 'left')
await hold(['KeyW', 'KeyD'], 1.5, 'right')
await hold(['KeyW'], 2, 'straight')
await page.keyboard.press('Space')
await hold(['KeyW'], 1, 'wingsW')
await hold([], 2, 'glide')
await hold(['KeyD'], 1, 'rollR')
await hold(['KeyS'], 1, 'pitchUp')
await page.keyboard.press('Space')
await hold([], 3, 'land')
await hold(['ShiftLeft'], 2, 'brake')
await hold([], 1.5, 'parked')

writeFileSync(`${out}/telemetry.json`, JSON.stringify({ errors, log }, null, 2))
await browser.close()
console.log(JSON.stringify({ errors }, null, 2))
