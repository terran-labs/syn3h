// A descendant range must not press the entire glass card, and a drag across it must move it.
// (The material is chosen with three buttons beside its label since 22 November 2026; it has no
// slider to drag.) The card keeps whichever surface it has: the shader, or in a scrolling panel
// stack the CSS glass that scrolls with it (src/liquid-glass/scrolling.ts).
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'

const url = new URL(process.env.MIRA_URL ?? 'http://127.0.0.1:5173/')
url.searchParams.set('gfx', '3')
url.searchParams.set('glass', 'inline')
url.searchParams.set('room', 'glass-drag-' + Date.now())
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] })
try {
  const page = await browser.newPage({ viewport: { width: 744, height: 1133 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const touch = await page.context().newCDPSession(page)
  await page.goto(url.href)
  await page.locator('.lobby-gear[data-glass-surface="shader"]').tap({ timeout: 120000 })
  await page.locator('#lobby-settings [data-section=glass] > .wi-head').tap()
  for (const view of ['lobby', 'play']) {
    if (view === 'play') {
      await page.keyboard.press('Escape')
      await page.evaluate(() => { mira.params.set('bots.count', 0); mira.shell.play(true) })
      await page.waitForFunction(() => mira.shell.playing && !mira.shell.transitioning, null, { timeout: 150000 })
      await page.evaluate(() => { mira.shell.showPanels(); mira.shell.showCard('you') })
    }
    const card = view === 'lobby' ? '#lobby-settings' : '.mira-shell > .world-inspector:not(.lobby-settings) .wi-card.is-open'
    for (const id of ['glass.frostWidth']) {
      const slider = page.locator(card).locator(`[data-id="${id}"] input[type=range]`)
      await slider.evaluate(el => { const group = el.closest('details'); if (group) group.open = true })
      await slider.scrollIntoViewIfNeeded()
      await page.waitForFunction(sel => ['shader', 'scroll'].includes(document.querySelector(sel)?.dataset.glassSurface), card)
      // The card's opening motion and the stack's reveal move the slider for a few hundred ms after
      // the tap; a rect read while it moves sends the touch to whatever arrives there (another slider).
      await slider.evaluate(el => new Promise(done => {
        let last = '', still = 0
        const frame = () => { const r = el.getBoundingClientRect(), at = `${r.x},${r.y}`; still = at === last ? still + 1 : 0; last = at; if (still >= 5) done(); else requestAnimationFrame(frame) }
        requestAnimationFrame(frame)
      }))
      const surface = await page.evaluate(sel => document.querySelector(sel).dataset.glassSurface, card)
      const resting = await page.evaluate(sel => getComputedStyle(document.querySelector(sel)).backgroundColor, card)
      const rect = await slider.boundingBox()
      const thumb = await slider.evaluate(el => (el.valueAsNumber - Number(el.min)) / (Number(el.max) - Number(el.min)))
      const destination = thumb < .5 ? .8 : .2
      const point = x => [{ x: rect.x + 10 + (rect.width - 20) * x, y: rect.y + rect.height / 2 }]
      await page.evaluate(sel => {
        const el = document.querySelector(sel)
        window.dragFrames = []
        function frame() {
          window.dragFrames.push([el.dataset.glassSurface, getComputedStyle(el).backgroundColor])
          window.dragFrame = requestAnimationFrame(frame)
        }
        frame()
      }, card)
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(thumb) })
      for (let step = 1; step <= 5; step++) {
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(thumb + (destination - thumb) * step / 5) })
        await page.evaluate(() => new Promise(requestAnimationFrame))
      }
      const held = await page.evaluate(() => { cancelAnimationFrame(window.dragFrame); return window.dragFrames })
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      // Unpressed throughout: the same surface and the same body as at rest (transparent when the shader draws it).
      assert.ok(held.length >= 5 && held.every(([s, bg]) => s === surface && bg === resting) && (surface !== 'shader' || resting === 'rgba(0, 0, 0, 0)'), `${view} ${id}: ${surface} ${resting} ${JSON.stringify(held)}`)
      assert.notEqual(await slider.evaluate(el => (el.valueAsNumber - Number(el.min)) / (Number(el.max) - Number(el.min))), thumb)
    }
  }
} finally { await browser.close() }
