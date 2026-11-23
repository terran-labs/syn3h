// Leaving a world on a touch device takes every in-play touch control with it; entering brings
// them back. The bug it catches (the owner, 23 November 2026, on an iPhone): "your expanding
// panels button on my iPhone is visible even after I exit the world". The Panels control stayed
// on screen, tappable and drawn by the glass shader, through the whole climb out of a world while
// the galaxy faded in (since the phone Panels control of v26.11.2000; v26.11.2200 hid it only
// once the lobby had opened).
//   MIRA_URL=http://127.0.0.1:5213/ node tests/ui/play-controls-leave.mjs
// What must stay true, in WebKit (the iPhone's engine) and Chrome, portrait and landscape:
// - In play: the Panels control and the thumb buttons are visible and tappable; no lobby control is.
// - From the moment Leave world is confirmed (by the panels' Leave world, and by the pause
//   screen's Exit), through the climb and in the lobby: no in-play touch control (Panels, thumb
//   buttons, stick, Cancel ring, gear buttons, idle status line) is visible or tappable, and none
//   keeps a shader-drawn glass face.
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium, webkit } from 'playwright-core'
import assert from 'node:assert/strict'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5213/'
const IN_PLAY = '.hud-navigation, .hud-navigation .inspector-toggle, .touch-actions button, .touch-stick.is-active, .touch-cancel.is-shown, .gear-actions button, .daydream-pill'
const LOBBY = '.lobby-gear-dock > button'

/** The elements matching `selector` a player can see, each with whether a tap at its centre reaches it. */
const shown = (page, selector) => page.evaluate(sel => [...document.querySelectorAll(sel)].flatMap(el => {
  const r = el.getBoundingClientRect()
  if (!r.width || !r.height || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return []
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
  return [{ name: (el.getAttribute('class') ?? el.tagName).split(' ')[0], tappable: !!hit && (hit === el || el.contains(hit)), glass: el.dataset.glassSurface ?? '' }]
}), selector)
/** In-play controls that still carry a shader-drawn face, shown or not. */
const faces = page => page.evaluate(sel => [...document.querySelectorAll(sel)].filter(el => el.dataset.glassSurface === 'shader').map(el => (el.getAttribute('class') ?? el.tagName).split(' ')[0]), IN_PLAY)

for (const [engine, launch] of [['webkit', () => webkit.launch()], ['chromium', () => chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] })]]) {
  for (const [w, h] of [[390, 844], [844, 390]]) {
    for (const exit of ['panels', 'pause']) {
      const label = `${engine} ${w}x${h} ${exit}`
      const browser = await launch()
      try {
        const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: engine === 'chromium', hasTouch: true })
        await context.addInitScript(() => { try { localStorage.setItem('mira.glassMaterial.v2', 'Liquid'); localStorage.setItem('mira.touch.driven', '1') } catch { /* Storage is optional. */ } })
        const page = await context.newPage()
        await page.goto(`${base}?autoplay=1&vehicle=buggy-syn3h&room=leave-${engine}-${w}-${exit}-${Date.now()}`)
        await page.waitForFunction(() => window.mira?.shell.playing && !window.mira.shell.transitioning, null, { timeout: 180000 })
        await page.evaluate(() => { window.mira.params.set('bots.count', 0); window.mira.bots.daydream?.setBlocker?.(() => true) })
        await page.waitForTimeout(1500)

        const play = await shown(page, IN_PLAY)
        assert.ok(play.some(c => c.name === 'hud-navigation' && c.tappable), `${label}: the Panels control is tappable in play: ${JSON.stringify(play)}`)
        assert.ok(play.filter(c => c.name !== 'hud-navigation' && c.name !== 'shell-menu-button').length >= 4, `${label}: the thumb buttons show in play: ${JSON.stringify(play)}`)
        assert.deepEqual(await shown(page, LOBBY), [], `${label}: no lobby control in play`)

        if (exit === 'panels') {
          await page.locator('.hud-navigation .inspector-toggle').tap()
          await page.locator('.exit-world').tap()
        } else {
          await page.evaluate(() => window.mira.shell.showPanels())
          await page.locator('.rail-pause').tap()
          await page.locator('.pause-exit').tap()
        }
        // Sample every frame from the confirming tap until the lobby has settled.
        await page.evaluate(sel => {
          window.leaveFrames = []
          const sample = () => {
            const bad = [...document.querySelectorAll(sel)].filter(el => {
              const r = el.getBoundingClientRect()
              return (r.width && r.height && el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) || el.dataset.glassSurface === 'shader'
            }).map(el => (el.getAttribute('class') ?? el.tagName).split(' ')[0])
            // From the moment leaving has begun: the climb (transitioning), then the lobby.
            if (window.mira.shell.transitioning || !window.mira.shell.playing) window.leaveFrames.push({ transitioning: window.mira.shell.transitioning, bad })
            if (window.leaveFrames.length < 600 && (window.mira.shell.transitioning || window.mira.shell.playing || window.leaveFrames.length < 30)) requestAnimationFrame(sample)
            else window.leaveDone = true
          }
          requestAnimationFrame(sample)
        }, IN_PLAY)
        await page.locator('.exit-leave').tap()
        await page.waitForFunction(() => !window.mira.shell.playing && !window.mira.shell.transitioning, null, { timeout: 60000 })
        await page.waitForTimeout(1500)
        const frames = await page.evaluate(() => window.leaveFrames)
        const seen = frames.filter(f => f.bad.length)
        assert.equal(seen.length, 0, `${label}: an in-play control showed in ${seen.length} of ${frames.length} frames on the way out: ${JSON.stringify(seen.slice(0, 3))}`)
        assert.deepEqual(await shown(page, IN_PLAY), [], `${label}: no in-play control in the lobby`)
        assert.deepEqual(await faces(page), [], `${label}: no in-play control keeps a glass face in the lobby`)
        assert.ok((await shown(page, LOBBY)).some(c => c.tappable), `${label}: the lobby's own controls are back`)
        console.log(`${label}: ok (${frames.length} frames on the way out)`)
      } finally { await browser.close() }
    }
  }
}
