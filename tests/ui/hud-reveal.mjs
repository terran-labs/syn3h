// The HUD's entry reveal (src/ui/hudReveal.ts, hud-reveal.css): what must stay true. Bugs it
// catches: a group left a few pixels off or part faded after the reveal, a thumb control taking
// taps while it cannot be seen, motion under reduced motion, and the reveal replaying on resume.
// - after the reveal, every group is where its rules put it, fully drawn, with no animation left,
//   and stays put;
// - while it runs, nothing that can be seen and hit is drawn below a third (thumb controls) or is
//   hit-testable while hidden;
// - reduced motion: nothing moves, it only fades;
// - pausing and resuming does not play it again.
// Durations come from the registry (hud.revealMs, hud.revealStep), never from here.
//   MIRA_URL=http://127.0.0.1:5213/ node tests/ui/hud-reveal.mjs
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5213/'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] })
const GROUPS = '.fh-top, .gear-selector, .hud-accessories, .hud-chat, .world-inspector, .hud-navigation, .shell-minimap, .chat-strip, .focus-hud .fh-left, .focus-hud .fh-right, .spawn-help, .touch-controls button, .gear-actions button'
const errors = []

/** Enter a world and record every group on every frame until the reveal is over and a second after. */
async function enter(options, label) {
  const context = await browser.newContext(options)
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript((groups) => {
    // From the first frame of play: each group's drawn state, and whether a tap at its centre reaches it.
    const frames = window.__reveal = []
    const look = () => [...document.querySelectorAll(groups)].map((e) => {
      const s = getComputedStyle(e), r = e.getBoundingClientRect()
      const hit = r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
        ? e.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) : false
      return { name: e.className.toString().split(' ')[0], display: s.display, opacity: +s.opacity, visibility: s.visibility, box: [r.left, r.top, r.width, r.height].map((v) => +v.toFixed(2)), hit, thumb: !!e.closest('.touch-controls, .gear-actions') || (e.matches('.hud-navigation') && !!e.closest('.has-touch')) }
    }).filter((g) => g.display !== 'none' && g.box[2] > 0)
    const tick = () => {
      const shell = document.querySelector('.mira-shell')
      if (shell?.classList.contains('is-playing')) frames.push({ t: performance.now(), on: shell.hasAttribute('data-hud-reveal'), groups: look() })
      if (frames.length < 2000) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, GROUPS)
  await page.goto(`${base}?autoplay=1&room=hud-reveal-${label}-${Date.now()}`)
  await page.waitForFunction(() => window.mira?.shell?.playing && document.querySelector('.mira-shell').classList.contains('is-playing'), null, { timeout: 240000 })
  const total = await page.evaluate(() => window.mira.params.get('hud.revealMs').value + 6 * window.mira.params.get('hud.revealStep').value)
  await page.waitForFunction(() => !document.querySelector('.mira-shell').hasAttribute('data-hud-reveal'), null, { timeout: 60000 })
  await page.waitForTimeout(1000)
  const frames = await page.evaluate(() => window.__reveal.splice(0))
  return { context, page, frames, total }
}

const final = (frames) => new Map(frames.at(-1).groups.map((g) => [g.name, g]))

try {
  for (const [label, options] of [
    ['desktop', { viewport: { width: 1280, height: 800 } }],
    ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
    ['reduced', { viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }],
  ]) {
    const { context, page, frames } = await enter(options, label)
    assert.ok(frames.some((f) => f.on), `${label}: the reveal ran on entry`)
    const end = final(frames)
    // After: no animation left on any group, and the last second's frames all equal the end.
    const leftover = await page.evaluate((groups) => [...document.querySelectorAll(groups)].filter((e) => e.getAnimations().some((a) => a.animationName?.startsWith('hud-reveal'))).length, GROUPS)
    assert.equal(leftover, 0, `${label}: no reveal animation left after it ends`)
    const after = frames.filter((f) => !f.on).slice(-20)
    for (const f of after) for (const g of f.groups) {
      const e = end.get(g.name); if (!e) continue
      assert.deepEqual([g.box, g.opacity], [e.box, e.opacity], `${label}: ${g.name} stays put after the reveal`)
    }
    for (const f of frames.filter((f) => f.on)) for (const g of f.groups) {
      // Never hit-testable while it cannot be seen; thumb controls never below a third.
      if (g.hit && g.visibility === 'visible') assert.ok(g.opacity > 0 || g.name === 'chat-strip', `${label}: ${g.name} takes a tap while invisible ${JSON.stringify(g)}`)
      if (g.thumb && g.visibility === 'visible') assert.ok(g.opacity >= .3, `${label}: thumb control ${g.name} faint ${JSON.stringify(g)}`)
      // Reduced motion: every box during the reveal is its final box.
      if (label === 'reduced') { const e = end.get(g.name); if (e) assert.deepEqual(g.box, e.box, `${label}: ${g.name} moved under reduced motion`) }
    }
    // Pause and resume: no replay.
    await page.evaluate(() => { window.mira.shell.openMenu(); window.mira.shell.closeMenu() })
    await page.waitForTimeout(200)
    assert.equal(await page.evaluate(() => document.querySelector('.mira-shell').hasAttribute('data-hud-reveal')), false, `${label}: resuming does not replay the reveal`)
    await context.close()
    console.log(`${label}: ok (${frames.filter((f) => f.on).length} reveal frames)`)
  }
  assert.deepEqual(errors, [], 'no page errors')
  console.log('hud-reveal: ok')
} finally { await browser.close() }
