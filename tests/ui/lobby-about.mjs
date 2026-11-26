// Welcome pictures are requested only on open. A swipe or a key moves one picture,
// and closing returns focus to a Welcome button that still works.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { serverUrl } from './lib/server.mjs'

const base = serverUrl('lobby-about')
const isPicture = request => /\/welcome\/[^/]+\.(avif|webp|jpe?g|png)$/i.test(new URL(request.url()).pathname)

async function swipeLeft(page, image) {
  await image.scrollIntoViewIfNeeded()
  const { x, y, width, height } = await image.boundingBox()
  const point = fraction => [{ x: x + width * fraction, y: y + height / 2 }]
  const touch = await page.context().newCDPSession(page)
  try {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(0.8) })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(0.5) })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(0.2) })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await touch.detach()
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const [name, viewport, phone] of [
    ['phone', { width: 320, height: 568 }, true],
    ['desktop', { width: 1280, height: 800 }, false],
  ]) {
    const context = await browser.newContext({ viewport, hasTouch: phone, isMobile: phone, reducedMotion: 'reduce' })
    try {
      const page = await context.newPage()
      const requests = [], errors = []
      page.on('request', request => { if (isPicture(request)) requests.push(request.url()) })
      page.on('pageerror', error => errors.push(error.message))
      const url = new URL(base)
      url.search = new URLSearchParams({ tap: '0', intro: '0', room: `about-${name}-${Date.now()}` })
      await page.goto(url.href, { waitUntil: 'commit' })
      await page.waitForFunction(() => document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
      await page.locator('.boot-veil').waitFor({ state: 'hidden' })
      const welcome = page.getByRole('button', { name: 'Welcome', exact: true })
      const dialog = page.locator('.lobby-sheet-about')
      const ring = dialog.locator('.welcome-ring')
      await welcome.waitFor({ state: 'visible' })
      assert.deepEqual(requests, [], `${name}: no Welcome image requested before opening`)

      const pictureResponse = page.waitForResponse(response => isPicture(response.request()) && response.ok())
      await Promise.all([pictureResponse, phone ? welcome.tap() : welcome.click()])
      await ring.waitFor({ state: 'visible' })
      const close = dialog.getByRole('button', { name: 'Close', exact: true })
      assert.equal(await close.evaluate(button => button === document.activeElement), true, `${name}: focus enters the sheet`)
      if (phone) {
        const dock = page.locator('.lobby-gear-dock .lobby-control')
        for (const control of await dock.all()) assert.equal(await control.isVisible(), false)
        await page.keyboard.press('Tab')
        assert.ok(await dialog.evaluate(sheet => sheet.contains(document.activeElement)), 'Tab stays in Welcome')
      }

      const slide = ring.locator('.welcome-ring-track').getByRole('listitem')
      const image = slide.getByRole('img')
      const currentSlide = async () => {
        assert.equal(await slide.count(), 1, `${name}: exactly one slide is exposed to assistive technology`)
        assert.equal(await slide.getAttribute('data-slot'), 'front', `${name}: the front slide is the accessible one`)
        assert.equal(await image.count(), 1, `${name}: the active image has an accessible role`)
        assert.ok((await image.getAttribute('alt'))?.trim(), `${name}: the active image has alternative text`)
        return slide.evaluate(item => Array.from(item.parentElement.children).indexOf(item))
      }
      const before = await currentSlide()
      const count = await ring.locator('.welcome-ring-card').count()
      assert.ok(count > 1, `${name}: the carousel has another picture`)
      if (phone) await swipeLeft(page, image)
      else {
        await ring.locator('[data-ring=next]').focus()
        await page.keyboard.press('ArrowRight')
      }
      assert.equal(await currentSlide(), (before + 1) % count, `${name}: the input advances exactly one picture`)
      assert.ok((await ring.getByRole('status').textContent())?.trim(), `${name}: the change is announced`)

      if (phone) await close.tap()
      else await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      assert.equal(await welcome.evaluate(button => button === document.activeElement), true, `${name}: closing restores focus`)
      if (phone) {
        for (const control of await page.locator('.lobby-gear-dock .lobby-control').all()) await control.tap({ trial: true })
      }
      await page.keyboard.press('Enter')
      await ring.waitFor({ state: 'visible' })
      assert.deepEqual(errors, [], `${name}: no page errors`)
      console.log(`${name}: Welcome image loading, carousel and focus passed`)
    } finally {
      await context.close()
    }
  }
} finally {
  await browser.close()
}
