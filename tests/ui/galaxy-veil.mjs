/**
 * Worlds level with the sun: captures of the arrangement that once showed a "cutting shape",
 * a world beside the sun and at its depth drawn as a pale sphere with a darker disc inside.
 * The sun's glow was added over every pixel of a world farther than the sun and almost none
 * over nearer pixels, so the plane at the sun's depth sliced each sphere it passed through.
 *
 * The script holds the system still, looks along the orbital plane as the owner did, finds
 * moments when a world's centre is at the sun's depth and beside it on screen, and saves a
 * capture of each. It asserts what can be measured: across such a world's disc, from its
 * centre to near its limb, brightness has no step (no neighbouring samples differ sharply).
 *
 *   MIRA_URL=http://127.0.0.1:5193/ /Users/vtn/dev/Syn3h/tools/heavy.sh node tests/ui/galaxy-veil.mjs
 *
 * The measure is coarse (a world's own surface varies too, and the forming world's magma is
 * left out of it): the captures are the evidence, the assertion only catches the old slice.
 * VEIL_TAG names the captures (default "after"); VEIL_ASSERT=0 only captures.
 */
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5193/', tag = process.env.VEIL_TAG ?? 'after', out = 'tests/ui/artifacts/galaxy-veil'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = []
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${base}?room=veil-${Date.now()}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.mira?.shell?.galaxy?.live && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
  await page.evaluate(() => { window.__pin = setInterval(() => window.mira.params.set('gfx.level', 2), 400); window.mira.params.set('gfx.level', 2) })
  await page.waitForFunction(() => window.mira.shell.graphics.planetMaps >= window.mira.planets.PLANETS.length, null, { timeout: 60000 })
  await page.waitForTimeout(4500) // past the logo's reveal
  // Hold the orbits, look along the plane from close in, and step the clock by hand.
  const at = (clock, yaw) => page.evaluate(async ([clock, yaw]) => {
    const g = window.mira.shell.galaxy
    window.mira.shell.stopAttract() // the idle tour would replace the galaxy after twenty seconds
    g.options.still = () => true; g.clock = clock; g.yaw = yaw; g.pitch = 0.1; g.distance = 9; g.reach = 9; g.wake = 3
    for (let i = 0; i < 4; i++) { g.wake = 3; await new Promise(r => requestAnimationFrame(r)) }
    return { reach: g.reach, screen: g.screen.map(s => ({ id: s.id, x: s.x, y: s.y, r: s.radius, depth: s.depth, visible: s.visible })) }
  }, [clock, yaw])
  // Moments when a world is beside the sun (one to four of its radii off) and at its depth.
  const found = []
  for (let clock = 0; clock < 700 && found.length < 3; clock += 3) {
    const { reach, screen } = await at(clock, 0.6)
    const hit = screen.find(s => s.visible && Math.abs(s.depth - reach) < 0.12 && Math.abs(s.x - 640) > s.r * 1.2 && Math.abs(s.x - 640) < s.r * 5 && s.r > 30 && !screen.some(o => o !== s && o.visible && Math.hypot(o.x - s.x, o.y - s.y) < o.r + s.r))
    if (hit && !found.some(f => f.id === hit.id)) found.push({ clock, ...hit })
  }
  assert.ok(found.length > 0, 'found a world level with the sun to look at')
  for (const [n, world] of found.entries()) {
    await at(world.clock, 0.6); await page.waitForTimeout(150)
    const path = `${out}/${tag}-${n}-${world.id}.png`
    const shot = await page.screenshot({ path, clip: { x: Math.max(0, world.x - 320), y: Math.max(0, world.y - 240), width: 640, height: 480 } })
    // Brightness along eight spokes of the disc, centre to 85 percent of the radius.
    const steps = await page.evaluate(async ([data, cx, cy, r]) => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
      const c = canvas.getContext('2d'); c.drawImage(image, 0, 0)
      const scale = image.width / 640, px = c.getImageData(0, 0, image.width, image.height)
      const luma = (x, y) => { let sum = 0, count = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const i = (Math.round(y * scale) + dy) * image.width * 4 + (Math.round(x * scale) + dx) * 4; sum += 0.2126 * px.data[i] + 0.7152 * px.data[i + 1] + 0.0722 * px.data[i + 2]; count++ } return sum / count }
      // A step is a jump between neighbouring ring averages: rings smooth out the surface's own
      // detail (coasts, clouds, city lights), leaving what is painted over the whole disc.
      const rings = []
      for (let k = 0; k <= 17; k++) { const d = r * 0.05 * k; let sum = 0; for (let a = 0; a < 48; a++) sum += luma(cx + Math.cos(a / 48 * 6.2832) * d, cy + Math.sin(a / 48 * 6.2832) * d); rings.push(sum / 48) }
      return { rings: rings.map(v => Math.round(v)), worst: Math.max(...rings.slice(1).map((v, i) => Math.abs(v - rings[i]))) }
    }, [shot.toString('base64'), world.x - Math.max(0, world.x - 320), world.y - Math.max(0, world.y - 240), world.r])
    report.push({ world: world.id, clock: world.clock, radiusPx: Math.round(world.r), worstRingStep: Math.round(steps.worst * 10) / 10, rings: steps.rings.join(' '), path })
  }
  console.table(report.map(({ rings, ...row }) => row)); for (const row of report) console.log(row.world, 'ring brightness, centre to limb:', row.rings)
  assert.deepEqual(errors, [])
  if (process.env.VEIL_ASSERT !== '0') for (const row of report) if (row.world !== 'custom') assert.ok(row.worstRingStep < 12, `${row.world}: a step of ${row.worstRingStep} in brightness across its disc`)
  console.log('GALAXY VEIL OK')
} finally { await browser.close() }
