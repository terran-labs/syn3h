// A bot changing detail behind the galaxy used to link its shaders on the UI thread.
import '../../tools/lib/legacy-env.mjs'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal'] })
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true })
  const url = new URL(process.env.MIRA_URL)
  url.search = '?intro=0&tap=0&webgl=1&gfx=2'
  await page.goto(url.href, { waitUntil: 'commit' })
  await page.waitForFunction(() => {
    const { game, shell } = window.mira ?? {}
    return document.documentElement.dataset.boot === 'done' && shell?.galaxy?.live &&
      !shell.galaxy.opening && game.view() === 'covered' && !game.quality.isLoading
  }, null, { timeout: 120000 })
  const sample = () => page.evaluate(() => {
    const game = window.mira.game
    return { view: game.view(), calls: game.renderer.info.render.calls, tick: game.tick }
  })
  const start = await sample()
  await page.waitForTimeout(10000)
  const end = await sample()
  assert.equal(end.view, 'covered')
  assert.ok(end.tick > start.tick, 'world simulation advances while the galaxy is open')
  assert.equal(end.calls, start.calls, 'the ready opaque galaxy needs no routine world renders')
} finally {
  await browser.close()
}
