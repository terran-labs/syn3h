// Lobby planet names do not flash (the owner, 26 November 2026: "I hate how they flash in and
// out. You are supposed to only have graceful motion with planet labels."). Rules, each a bug:
//  - no name appears or vanishes within a frame (it fades), and none jumps across the screen;
//  - no two shown names overlap;
//  - no shown name runs off the screen or into its edge margin.
// Every frame of 20 s of the settled lobby is sampled at 390x844 and 1280x800, with and without
// reduced motion. The fastest fade and a name's fastest own motion are reported, not pinned: they
// depend on how slowly a busy machine draws frames.
//
//   MIRA_URL=http://127.0.0.1:<port>/ /Users/vtn/dev/Syn3h/tools/heavy.sh node tests/ui/lobby-label-motion.mjs
import '../../tools/lib/legacy-env.mjs'
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const url = process.env.MIRA_URL
assert.ok(url, 'MIRA_URL is required')
const out = 'tests/ui/artifacts/lobby-label-motion'
await mkdir(out, { recursive: true })
/** A flash: a name's opacity changing by more than this between two drawn frames (a fade takes .35 s). */
const FLASH = 0.6
/** A jump: a shown name moving on its own, beyond its planet, by more than this between two drawn frames, px. */
const JUMP = 60, ROUNDING = 1.5
/** The least gap between a shown name and the screen's edge, px (labels.ts CAPTION_INSET). */
const INSET = 6
/** A name at half opacity or more is shown; below that it is part of a cross-fade, not a collision. */
const SHOWN = 0.5
const SECONDS = 20

const views = [['phone', 390, 844, true], ['desktop', 1280, 800, false]]
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] })
try {
  for (const [name, width, height, phone] of views) for (const reducedMotion of ['no-preference', 'reduce']) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, reducedMotion })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${url}?room=label-motion-${name}-${Date.now()}`)
    await page.waitForFunction(() => document.documentElement.dataset.boot === 'done' && window.mira?.shell?.galaxy && !window.mira.shell.galaxy.opening &&
      document.querySelectorAll('.galaxy-label:not([hidden])').length > 2, null, { timeout: 180000 })
    await page.evaluate(() => document.fonts.ready.then(() => true))
    await page.waitForTimeout(2000)
    // Sample every animation frame, with the planets the galaxy last laid out (its layout callback
    // runs each frame while it moves; with reduced motion it holds still and calls it rarely).
    const trace = await page.evaluate(seconds => new Promise(resolve => {
      const galaxy = window.mira.shell.galaxy, options = galaxy.options, original = options.onLayout
      const frames = []
      let planets = {}, laidOut = false, running = true
      for (const p of galaxy.screen ?? []) planets[p.id] = [p.x, p.y]
      const record = () => {
        const t = performance.now()
        const names = {}
        for (const chip of document.querySelectorAll('.galaxy-label')) {
          if (chip.hidden) continue
          const r = chip.getBoundingClientRect(), at = (chip.style.translate || '').split(' ').map(parseFloat)
          names[chip.dataset.world] = { opacity: Number(getComputedStyle(chip).opacity), box: [r.left, r.top, r.right, r.bottom], at }
        }
        frames.push({ t, planets: { ...planets }, names })
      }
      // In the layout callback when it runs, so names and planets are from the same frame; on a
      // plain animation frame only when it did not (reduced motion holds the galaxy still).
      options.onLayout = (places, chosen) => {
        original(places, chosen)
        planets = {}
        for (const p of places) planets[p.id] = [p.x, p.y]
        if (running) { record(); laidOut = true }
      }
      const tick = () => { if (!running) return; if (!laidOut) record(); laidOut = false; requestAnimationFrame(tick) }
      requestAnimationFrame(tick)
      setTimeout(() => { running = false; options.onLayout = original; resolve(frames) }, seconds * 1000)
    }), SECONDS)
    assert.ok(trace.length > 20, `${name}: frames sampled (${trace.length})`)
    let worstOpacity = 0, worstGlide = 0, overlaps = [], edges = [], fade = '', move = '', flashes = [], jumps = []
    for (let i = 1; i < trace.length; i++) {
      const a = trace[i - 1], b = trace[i], dt = Math.max(1e-3, (b.t - a.t) / 1000)
      for (const [id, now] of Object.entries(b.names)) {
        const was = a.names[id]
        if (!was) continue
        if (Math.abs(now.opacity - was.opacity) > FLASH) flashes.push(`${id} ${was.opacity.toFixed(2)} to ${now.opacity.toFixed(2)} at frame ${i}`)
        if (Math.min(now.opacity, was.opacity) >= SHOWN && now.at.length === 2 && was.at.length === 2 && a.planets[id] && b.planets[id]) {
          const step = Math.hypot((now.at[0] - was.at[0]) - (b.planets[id][0] - a.planets[id][0]), (now.at[1] - was.at[1]) - (b.planets[id][1] - a.planets[id][1]))
          if (step > JUMP) jumps.push(`${id} ${step.toFixed(0)} px at frame ${i}`)
        }
        // Over two frames: frame timestamps on a busy machine jitter more than a fade's own rate.
        const before = trace[i - 2]?.names[id]
        const rate = before ? Math.abs(now.opacity - before.opacity) / Math.max(1e-3, (b.t - trace[i - 2].t) / 1000) : 0
        if (rate > worstOpacity) { worstOpacity = rate; fade = `${id} ${before.opacity.toFixed(2)} to ${now.opacity.toFixed(2)} at frame ${i}` }
        // Only a name that can be seen on both frames: one may take a new place while faded out.
        // Over two frames as well, for the same timestamp jitter.
        const z = trace[i - 2], first = z?.names[id]
        if (first && Math.min(now.opacity, was.opacity, first.opacity) > 0.1 && now.at.length === 2 && first.at.length === 2 && z.planets[id] && b.planets[id]) {
          const own = Math.hypot((now.at[0] - first.at[0]) - (b.planets[id][0] - z.planets[id][0]), (now.at[1] - first.at[1]) - (b.planets[id][1] - z.planets[id][1]))
          const span = Math.max(1e-3, (b.t - z.t) / 1000)
          const speed = Math.max(0, own - ROUNDING) / span
          if (speed > worstGlide) { worstGlide = speed; move = `${id} ${own.toFixed(1)} px in ${(span * 1000).toFixed(0)} ms at frame ${i}, opacity ${now.opacity.toFixed(2)}` }
        }
      }
      const shown = Object.entries(b.names).filter(([, n]) => n.opacity >= SHOWN)
      for (const [j, [id, n]] of shown.entries()) {
        const [l, t, r, btm] = n.box
        if (l < INSET - .5 || t < INSET - .5 || r > width - INSET + .5 || btm > height - INSET + .5) edges.push(`${id} at ${n.box.map(v => v.toFixed(0))}`)
        for (const [other, o] of shown.slice(0, j)) {
          const [l2, t2, r2, b2] = o.box
          if (l < r2 - .5 && r > l2 + .5 && t < b2 - .5 && btm > t2 + .5) overlaps.push(`${id} and ${other} (opacities ${n.opacity.toFixed(2)}, ${o.opacity.toFixed(2)}, frame ${i})`)
        }
      }
    }
    const label = `${name} ${reducedMotion === 'reduce' ? 'reduced motion' : ''}`.trim()
    console.log(`${label}: fastest fade ${fade}; fastest move ${move}`)
    console.log(`${label}: ${trace.length} frames in ${SECONDS} s; fastest fade ${worstOpacity.toFixed(2)}/s, fastest own motion ${worstGlide.toFixed(0)} px/s (reported); flashes ${flashes.length}, jumps ${jumps.length}, overlaps ${overlaps.length}, edge ${edges.length}`)
    assert.deepEqual(flashes.slice(0, 5), [], `${label}: a name appeared or vanished within a frame`)
    assert.deepEqual(jumps.slice(0, 5), [], `${label}: a name jumped`)
    if (overlaps.length) console.log(`${label} overlaps:`, overlaps.slice(0, 8).join('; '))
    assert.deepEqual(overlaps, [], `${label}: shown names overlap`)
    assert.deepEqual([...new Set(edges)].slice(0, 5), [], `${label}: a shown name is within ${INSET} px of the edge`)
    await page.screenshot({ path: `${out}/${name}-${reducedMotion}.png` })
    assert.deepEqual(errors, [])
    await context.close()
  }
} finally { await browser.close() }
