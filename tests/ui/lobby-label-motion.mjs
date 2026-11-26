// Lobby planet names move gracefully (the owner, 26 November 2026: "I hate how they flash in
// and out. You are supposed to only have graceful motion with planet labels."). Bugs caught:
//  - a name appearing or vanishing in one frame (suppression, a dropped line, a side change);
//  - a name jumping to another side of its planet instead of gliding there;
//  - two names overlapping, or a name pressed against the screen's edge.
// Every frame of 20 s of the settled lobby is sampled at 390x844 and 1280x800, in the galaxy's own
// layout callback, so each name is read with its planet's position on the same frame. Limits are
// rates, not per-frame steps, because headless frames on a busy machine come far slower than 60
// a second; at 60 fps they are about a tenth of full opacity and 4 px a frame.
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
/** Opacity eases over .35 s (shell.css): its fastest moment, ease-out from the start, is under 5 per second. */
const OPACITY_RATE = 6
/** A name's own motion, beyond its planet's, px/s: the capped glide (Shell CAPTION_GLIDE_SPEED, 240) with room for one frame's rounding. */
const GLIDE_RATE = 260, ROUNDING = 1.5
/** The least gap between a shown name and the screen's edge, px (labels.ts CAPTION_INSET). */
const INSET = 6
/** A name at this opacity or more is shown: it must not overlap another shown name. */
const SHOWN = 0.3
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
    // Sample inside the galaxy's layout callback: planets and names from the same frame.
    const trace = await page.evaluate(seconds => new Promise(resolve => {
      const galaxy = window.mira.shell.galaxy, options = galaxy.options, original = options.onLayout
      const frames = []
      options.onLayout = (places, chosen) => {
        original(places, chosen)
        const t = performance.now(), planets = {}
        for (const p of places) planets[p.id] = [p.x, p.y]
        const names = {}
        for (const chip of document.querySelectorAll('.galaxy-label')) {
          if (chip.hidden) continue
          const r = chip.getBoundingClientRect(), at = (chip.style.translate || '').split(' ').map(parseFloat)
          names[chip.dataset.world] = { opacity: Number(getComputedStyle(chip).opacity), box: [r.left, r.top, r.right, r.bottom], at }
        }
        frames.push({ t, planets, names })
      }
      setTimeout(() => { options.onLayout = original; resolve(frames) }, seconds * 1000)
    }), SECONDS)
    assert.ok(trace.length > 20, `${name}: frames sampled (${trace.length})`)
    let worstOpacity = 0, worstGlide = 0, overlaps = [], edges = []
    for (let i = 1; i < trace.length; i++) {
      const a = trace[i - 1], b = trace[i], dt = Math.max(1e-3, (b.t - a.t) / 1000)
      for (const [id, now] of Object.entries(b.names)) {
        const was = a.names[id]
        if (!was) continue
        worstOpacity = Math.max(worstOpacity, Math.abs(now.opacity - was.opacity) / dt)
        // Only a name that was or is showing: a hidden one may be moved while invisible.
        if (Math.max(now.opacity, was.opacity) > 0.02 && now.at.length === 2 && was.at.length === 2 && a.planets[id] && b.planets[id]) {
          const own = Math.hypot((now.at[0] - was.at[0]) - (b.planets[id][0] - a.planets[id][0]), (now.at[1] - was.at[1]) - (b.planets[id][1] - a.planets[id][1]))
          worstGlide = Math.max(worstGlide, Math.max(0, own - ROUNDING) / dt)
        }
      }
      const shown = Object.entries(b.names).filter(([, n]) => n.opacity >= SHOWN)
      for (const [j, [id, n]] of shown.entries()) {
        const [l, t, r, btm] = n.box
        if (l < INSET - .5 || t < INSET - .5 || r > width - INSET + .5 || btm > height - INSET + .5) edges.push(`${id} at ${n.box.map(v => v.toFixed(0))}`)
        for (const [other, o] of shown.slice(0, j)) {
          const [l2, t2, r2, b2] = o.box
          if (l < r2 - .5 && r > l2 + .5 && t < b2 - .5 && btm > t2 + .5) overlaps.push(`${id} and ${other}`)
        }
      }
    }
    const label = `${name} ${reducedMotion === 'reduce' ? 'reduced motion' : ''}`.trim()
    console.log(`${label}: ${trace.length} frames in ${SECONDS} s; fastest opacity change ${worstOpacity.toFixed(2)}/s (limit ${OPACITY_RATE}); fastest own motion ${worstGlide.toFixed(0)} px/s (limit ${GLIDE_RATE}); overlaps ${overlaps.length}; edge ${edges.length}`)
    assert.ok(worstOpacity <= OPACITY_RATE, `${label}: a name changed opacity at ${worstOpacity.toFixed(2)}/s`)
    assert.ok(worstGlide <= GLIDE_RATE, `${label}: a name moved on its own at ${worstGlide.toFixed(0)} px/s`)
    assert.deepEqual([...new Set(overlaps)], [], `${label}: shown names overlap`)
    assert.deepEqual([...new Set(edges)].slice(0, 5), [], `${label}: a shown name is within ${INSET} px of the edge`)
    // Reduced motion: a name never moves on its own, it fades out, takes its new place unseen, and fades in.
    if (reducedMotion === 'reduce') assert.ok(worstGlide <= 30, `${label}: a name moved on its own at ${worstGlide.toFixed(0)} px/s`)
    await page.screenshot({ path: `${out}/${name}-${reducedMotion}.png` })
    assert.deepEqual(errors, [])
    await context.close()
  }
} finally { await browser.close() }
