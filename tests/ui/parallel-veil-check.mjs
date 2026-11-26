// The room-move veil (index.html html[data-room-move], src/ui/parallelUniverse.ts) at the hit-test
// level. Written by the independent reviewer of fix/full-room-notice (crowd-launch,
// tools/parallel-veil-check.mjs, 25 November 2026), which verified both controls; brought onto the
// branch with two cases added for the defect it found next. Bugs caught:
// - the destination lobby shown and tappable during a move (the review's P1 of 4052d5f8): with
//   autoplay held at a painted lobby, the centre of the screen is the veil, and without the hold
//   it is the galaxy (the control that proves the check can fail);
// - a ready game left behind a veil that never lifts (its P1 of 866db46c): the game's script
//   arriving after the move note has expired, so main.ts never took the hold over;
// - a dark screen for ever when the game's script never arrives: within the bound the veil says
//   "This is taking a while." and offers Reload.
// Run against a built candidate served by your own local Worker (wrangler dev --local):
//   tools/heavy.sh node tests/ui/parallel-veil-check.mjs <loopback port>
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const port = Number(process.argv[2])
assert(Number.isInteger(port) && port > 0 && port <= 65535, 'Pass the local Worker port')
const base = 'http://127.0.0.1:' + port
const MAIN_SCRIPT = /\/assets\/index-[\w-]+\.js(\?|$)/
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] })
const phone = () => browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
try {
  // 1 and 2: the veil covers a painted destination lobby; without the hold the lobby is on top.
  for (const removeHold of [false, true]) {
    const page = await phone()
    await page.addInitScript(removeHold => {
      sessionStorage.setItem('mira.roomMove', JSON.stringify({ reason: 'full', asked: 'lobby', hops: 1, at: Date.now() }))
      // Hold autoplay at the lobby so both variants have a real lobby to expose.
      const has = URLSearchParams.prototype.has
      URLSearchParams.prototype.has = function (key, ...rest) {
        return key === 'autoplay' ? false : has.call(this, key, ...rest)
      }
      if (removeHold) {
        new MutationObserver(() => {
          document.documentElement?.removeAttribute('data-room-move')
        }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-room-move'] })
      }
    }, removeHold)
    await page.goto(base + '/?autoplay=1&webgl=1&gfx=1&room=p-aaaaaaaaaaaaaaaaaaaaaa')
    await page.waitForFunction(() => document.documentElement.dataset.boot === 'done' && document.querySelector('.galaxy-label'))
    await page.waitForFunction(() => {
      const canvas = document.querySelector('.galaxy-canvas')
      return canvas?.getBoundingClientRect().height > 0
    })
    await page.waitForTimeout(1000) // Let the ordinary boot veil finish its fade.
    // The lobby is its canvas and the planet names over it: since the names rework a name can
    // orbit through this point, and it is as much the exposed lobby as the canvas behind it.
    const top = await page.evaluate(() => {
      const e = document.elementFromPoint(195, 380)
      return e?.closest('.boot-veil') ? 'boot-veil' : e?.closest('.galaxy-canvas, .galaxy-ui') ? 'lobby' : String(e?.className ?? '')
    })
    assert.equal(top, removeHold ? 'lobby' : 'boot-veil')
    console.log(removeHold ? 'Disabling the hold exposes the destination lobby' : 'The move veil covers the ready destination lobby')
    await page.close()
  }

  // 3: the game's script arrives after the note has expired (fresh when the page read it, stale
  // by the time main.ts reads it): once the game is on screen the veil goes and takes no input.
  {
    const page = await phone()
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('check.seeded')) {
        sessionStorage.setItem('check.seeded', '1')
        sessionStorage.setItem('mira.roomMove', JSON.stringify({ reason: 'full', asked: 'lobby', hops: 1, at: Date.now() - 119_000 }))
      }
    })
    await page.route(MAIN_SCRIPT, async route => { await new Promise(r => setTimeout(r, 4000)); await route.continue() })
    await page.goto(base + '/?autoplay=1&webgl=1&gfx=1&room=p-bbbbbbbbbbbbbbbbbbbbbb')
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-room-move')), true, 'the page set the hold from its fresh note')
    await page.waitForFunction(() => { const s = document.querySelector('.mira-shell'); return s?.classList.contains('is-playing') && !s.classList.contains('is-descending') && document.documentElement.dataset.boot !== 'ready' }, null, { timeout: 180000 })
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-room-move'), null, { timeout: 2000 })
      .catch(() => { throw new Error('a ready game stayed behind the move veil after the note expired') })
    await page.waitForTimeout(1200) // the veil's own fade
    const top = await page.evaluate(() => document.elementFromPoint(195, 380)?.className ?? '')
    assert.notEqual(top, 'boot-veil', 'the ready game takes input')
    console.log(`A late script after the note expired: the hold went with the game on screen (centre: ${top || 'none'})`)
    await page.close()
  }

  // 4: the game's script never arrives: within the bound, a plain line and a way forward.
  {
    const page = await phone()
    await page.addInitScript(() => {
      sessionStorage.setItem('mira.roomMove', JSON.stringify({ reason: 'full', asked: 'lobby', hops: 1, at: Date.now() }))
    })
    await page.route(MAIN_SCRIPT, route => route.abort())
    await page.goto(base + '/?autoplay=1&webgl=1&gfx=1&room=p-cccccccccccccccccccccc')
    await page.waitForSelector('#move-reload', { state: 'visible', timeout: 50000 })
      .catch(() => { throw new Error('no way forward 50 s into a move whose game never arrived') })
    const said = await page.evaluate(() => document.querySelector('.boot-status')?.textContent)
    assert.equal(said, 'This is taking a while.')
    assert.equal(await page.evaluate(() => document.elementFromPoint(195, 380)?.closest('.boot-veil') !== null), true, 'the veil, not a half-built page, is what shows')
    console.log('No game script at all: within 45 s the veil says it is taking a while and offers Reload')
    await page.close()
  }

  // 5: storage blocked at the getter (a SecurityError from window.sessionStorage itself): the game
  // still starts (the review's P2 of 866db46c: it showed "Mira couldn't start" before networking).
  {
    const page = await phone(), errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.addInitScript(() => {
      for (const name of ['sessionStorage', 'localStorage']) Object.defineProperty(window, name, { configurable: true, get() { throw new DOMException('The operation is insecure.', 'SecurityError') } })
    })
    await page.goto(base + '/?autoplay=1&webgl=1&gfx=1')
    await page.waitForFunction(() => { const s = document.querySelector('.mira-shell'); return s?.classList.contains('is-playing') && !s.classList.contains('is-descending') }, null, { timeout: 180000 })
      .catch(async () => { throw new Error(`the game did not start with storage blocked: ${await page.evaluate(() => document.getElementById('fatal')?.textContent?.slice(0, 120))} ${errors.slice(0, 2)}`) })
    console.log('Storage blocked at the getter: the game starts')
    await page.close()
  }
} finally {
  await browser.close()
}
