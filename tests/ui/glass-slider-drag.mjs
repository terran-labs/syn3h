// A descendant range must not press the entire glass card. Dragging the material
// selector also keeps the applied material until the player releases the thumb.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'

const url = new URL(process.env.SYN3H_URL ?? 'http://127.0.0.1:5173/')
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
      await page.evaluate(() => { syn3h.params.set('bots.count', 0); syn3h.shell.play(true) })
      await page.waitForFunction(() => syn3h.shell.playing && !syn3h.shell.transitioning, null, { timeout: 150000 })
      await page.evaluate(() => { syn3h.shell.showPanels(); syn3h.shell.showCard('you') })
    }
    const card = view === 'lobby' ? '#lobby-settings' : '.syn3h-shell > .world-inspector:not(.lobby-settings) .wi-card.is-open'
    for (const id of ['glass.frostWidth', 'hud.glass']) {
      const slider = page.locator(card).locator(`[data-id="${id}"] input[type=range]`)
      await slider.evaluate(el => { const group = el.closest('details'); if (group) group.open = true })
      await slider.scrollIntoViewIfNeeded()
      await page.waitForFunction(sel => document.querySelector(sel)?.dataset.glassSurface === 'shader', card)
      const rect = await slider.boundingBox()
      const thumb = await slider.evaluate(el => (el.valueAsNumber - Number(el.min)) / (Number(el.max) - Number(el.min)))
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
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(thumb + (.55 - thumb) * step / 5) })
        await page.evaluate(() => new Promise(requestAnimationFrame))
      }
      const held = await page.evaluate(() => { cancelAnimationFrame(window.dragFrame); return window.dragFrames })
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      assert.ok(held.length >= 5 && held.every(([surface, bg]) => surface === 'shader' && bg === 'rgba(0, 0, 0, 0)'), `${view} ${id}: ${JSON.stringify(held)}`)
      if (id === 'hud.glass') {
        await page.waitForFunction(() => document.documentElement.dataset.glassMaterial === 'frost')
        await page.locator(card).getByRole('button', { name: 'Liquid', exact: true }).tap()
      } else {
        assert.notEqual(await slider.evaluate(el => (el.valueAsNumber - Number(el.min)) / (Number(el.max) - Number(el.min))), thumb)
      }
    }
  }
} finally { await browser.close() }
