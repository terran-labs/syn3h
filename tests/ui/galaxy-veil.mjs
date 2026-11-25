/**
 * Worlds level with the sun: captures of the arrangement that once showed a "cutting shape",
 * a world beside the sun and at its depth drawn as a pale sphere with a darker disc inside.
 * The sun's glow was added over every pixel of a world farther than the sun and almost none
 * over nearer pixels, so the plane at the sun's depth sliced each sphere it passed through.
 *
 * The script holds the system still, looks along the orbital plane as the owner did, views
 * the same seeded Volcanic world at a fixed time with its sphere crossing the solar depth
 * plane, and saves the frame. It asserts what can be measured: across such a world's disc, from its
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
  const page = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${base}?world=volcanic.1&room=veil-${Date.now()}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.mira?.shell?.galaxy?.live && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
  await page.evaluate(() => { window.__pin = setInterval(() => window.mira.params.set('gfx.level', 2), 400); window.mira.params.set('gfx.level', 2) })
  await page.waitForFunction(() => window.mira.shell.graphics.planetMaps >= window.mira.planets.PLANETS.length, null, { timeout: 60000 })
  // Map completion is asynchronous. Hold both the camera and the orbital clock before reading
  // the displayed disc. Choose the viewing angle from the actual orbit so respacing it does
  // not change which time, terrain or world we measure.
  const clock = 24
  const world = await page.evaluate(async clock => {
    const shell = window.mira.shell, g = shell.galaxy
    shell.stopAttract()
    const index = g.options.worlds.findIndex(w => w.id === 'volcanic')
    const { position: [x, y, z], radius } = g.places(clock)[index]
    const pitch = 0.1, distance = 9
    // Put the centre half a radius farther from the eye than the sun. The sun's depth
    // then falls inside the globe, where the historical per-pixel cutoff drew a ring.
    const centreDistance = distance + radius / 2
    const along = (distance ** 2 + x ** 2 + y ** 2 + z ** 2 - centreDistance ** 2) / (2 * distance)
    const turn = Math.acos((along - y * Math.sin(pitch)) / (Math.hypot(x, z) * Math.cos(pitch)))
    g.clockHold = true
    g.clock = clock
    for (const side of [-1, 1]) {
      g.pitch = pitch; g.distance = distance; g.reach = distance
      g.yaw = Math.atan2(x, z) + side * turn
      const frame = g.frames
      g.wake = 2
      const deadline = performance.now() + 10_000
      while (g.frames === frame) {
        if (performance.now() > deadline) throw Error('The held galaxy did not draw the solar-depth fixture')
        await new Promise(resolve => requestAnimationFrame(resolve))
      }
      const disc = g.screen[index]
      if (disc.visible && !g.screen.some(other => other !== disc && other.visible &&
          other.depth < disc.depth && Math.hypot(other.x - disc.x, other.y - disc.y) < other.radius + disc.radius)) {
        return { id: disc.id, x: disc.x, y: disc.y, r: disc.radius, clock }
      }
    }
    throw Error('Volcanic is occluded on both sides of the solar-depth test view')
  }, clock)
  const clip = { x: Math.min(1280 - 640, Math.max(0, Math.round(world.x - 320))),
    y: Math.min(800 - 480, Math.max(0, Math.round(world.y - 240))), width: 640, height: 480 }
  const path = `${out}/${tag}-0-${world.id}.png`
  const shot = await page.screenshot({ path, clip, style: '.galaxy-labels { visibility: hidden !important }' })
  // Brightness over concentric rings of the disc, centre to 85 percent of the radius.
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
  }, [shot.toString('base64'), world.x - clip.x, world.y - clip.y, world.r])
  report.push({ world: world.id, clock: world.clock, radiusPx: Math.round(world.r), worstRingStep: Math.round(steps.worst * 10) / 10, rings: steps.rings.join(' '), path })
  console.table(report.map(({ rings, ...row }) => row)); for (const row of report) console.log(row.world, 'ring brightness, centre to limb:', row.rings)
  assert.deepEqual(errors, [])
  if (process.env.VEIL_ASSERT !== '0') for (const row of report) if (row.world !== 'custom') assert.ok(row.worstRingStep < 12, `${row.world}: a step of ${row.worstRingStep} in brightness across its disc`)
  console.log('GALAXY VEIL OK')
} finally { await browser.close() }
