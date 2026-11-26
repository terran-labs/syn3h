// The bottom-centre strip has one owner (src/ui/bottom-stack.css). Bug caught: the dev server's
// "New build available" button drawn over the pause bar's Exit world and Screenshot (the owner,
// 24 November 2026), and any other two things that place themselves at bottom centre on their
// own. What must stay true, at a phone upright and on its side, a laptop and a large desktop:
// - paused, with the build notice: every shown item of the strip is clear of every other;
// - paused: every pause button lies wholly inside the viewport (four of them on a phone);
// - in play, with the build notice and the slow-frames offer: likewise, and none
//   covers a thumb control;
// - Help and incoming Chat can both be read before and after a vehicle change.
// Every state measured is made the way the game makes it (its new-build event, a recommendation in
// its performance history, Shell.requestPause) and measured only once it holds and has stopped
// moving for several frames (steady), never after a fixed wait: a loaded machine is slower, not wrong.
//   MIRA_URL=http://127.0.0.1:5213/ node tests/ui/bottom-stack.mjs [out-dir]
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5213/'
const out = process.argv[2]
if (out) mkdirSync(out, { recursive: true })
const SIZES = [[390, 844, true], [844, 390, true], [1280, 800, false], [1700, 1100, false]]

/** The strip's shown items and the controls they must not cover, as boxes. */
const layout = () => {
  const box = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
  const shown = el => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0 }
  const items = [...document.querySelectorAll('.bottom-stack > *')].filter(shown).map(el => ({ name: el.id || el.className.split(' ')[0], ...box(el) }))
  const controls = [...document.querySelectorAll('.touch-controls button, .shell-minimap')].filter(shown).map(el => ({ name: el.className.split(' ')[0], ...box(el) }))
  const help = document.querySelector('.spawn-help')
  const chat = [...document.querySelectorAll('.chat-strip .chat-line')].filter(shown).map(box)
  return { items, controls, help: help && shown(help) ? box(help) : null, chat }
}
/**
 * Wait until `ready` holds and the strip, the controls and their opacity and visibility have
 * stayed the same for STEADY_FRAMES animation frames, so nothing is measured mid-fade or mid-move.
 * Every wait is on a condition: a loaded machine only makes it take longer.
 */
const STEADY_FRAMES = 6
const steady = (page, ready, what) => page.waitForFunction(([ready, frames]) => {
  const w = window
  const look = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return [r.left, r.top, r.width, r.height, s.opacity, s.visibility, s.display].map(v => typeof v === 'number' ? Math.round(v) : v).join() }
  const now = [...document.querySelectorAll('.bottom-stack > *, .touch-controls button, .shell-minimap, .spawn-help, .chat-strip .chat-line')].map(look).join('|')
  if (!new Function(`return (${ready})()`)()) { w.__steady = 0; w.__look = null; return false }
  w.__steady = now === w.__look ? (w.__steady ?? 0) + 1 : 0; w.__look = now
  return w.__steady >= frames
}, [ready.toString(), STEADY_FRAMES], { polling: 'raf', timeout: 60000 }).catch(error => { throw new Error(`${what}: never steady (${error.message.split('\n')[0]})`) })
const clash = (a, b) => a.right > b.left + 0.5 && a.left < b.right - 0.5 && a.bottom > b.top + 0.5 && a.top < b.bottom - 0.5

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const [width, height, touch] of SIZES) {
    const tag = `${width}x${height}`
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch })
    // The overlay is opt-in on touch-first devices.
    await context.addInitScript(() => localStorage.setItem('mira.chat.overlay', '1'))
    const page = await context.newPage()
    const errors = []; page.on('pageerror', error => errors.push(String(error.message).slice(0, 300)))
    await page.goto(`${base}?autoplay=1&vehicle=buggy&room=bottom-stack-${tag}-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    await page.waitForFunction(() => document.querySelector('.mira-shell')?.classList.contains('is-playing') && !document.querySelector('.mira-shell').classList.contains('is-descending'), null, { timeout: 120000 })
    await page.locator('.entry-warm-progress').waitFor({ state: 'hidden', timeout: 120000 })
    await page.waitForFunction(() => window.miraChat, null, { timeout: 30000 })
    for (const kind of ['buggy', touch ? 'jet' : 'hovercraft']) {
      const line = `Welcome to Mira. Take your time exploring the islands and see what’s beyond the ridge. (${kind})`
      await page.evaluate(({ kind, line }) => {
        if (window.mira.player.kind !== kind && window.mira.swapVehicle(kind)?.kind !== kind) {
          throw new Error(`Could not switch to ${kind}`)
        }
        window.mira.shell.showHelp(false)
        window.miraChat.net.chat.receive({ type: 'chat', from: 42, text: line, t: 0 })
      }, { kind, line })
      await steady(page, () => {
        const help = document.querySelector('.spawn-help')
        const line = document.querySelector('.chat-strip .chat-line:last-child')
        return !help.hidden && help.checkVisibility({ visibilityProperty: true }) && line && Number(getComputedStyle(line).opacity) === 1
      }, `${tag} ${kind} with Help and Chat`)
      const hud = await page.evaluate(layout)
      if (out) await page.screenshot({ path: `${out}/${tag}-${kind}-help-chat.png` })
      assert.ok(hud.help && hud.chat.length, `${tag} ${kind}: Help and Chat are both visible`)
      for (const bubble of hud.chat) {
        assert.ok(!clash(hud.help, bubble), `${tag} ${kind}: Chat covers Help ${JSON.stringify([bubble, hud.help])}`)
        for (const control of hud.controls) assert.ok(!clash(bubble, control), `${tag} ${kind}: Chat covers ${control.name}`)
      }
    }
    await page.evaluate(() => window.mira.swapVehicle('buggy'))
    // A new build arrives (the dev server's own event and button, tools/manual-reload.mjs).
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('mira:new-build')))
    await page.waitForFunction(() => document.querySelector('.bottom-stack > #mira-build-notice'), null, { timeout: 5000 })

    // In play, with every driving notice shown at once. The running-slow offer is shown the way
    // the game shows it: a recommendation in the performance history, published to the panel
    // (PerformancePanel.showRecommendation hides the offer on any publish without one). The
    // history sets its recommendation afresh at the end of every sampling window, so it is held
    // there for the rest of this visit, after each real sample.
    await page.evaluate(() => {
      const quality = window.mira.game.quality, history = quality.history, level = quality.governor.level
      const offer = Object.freeze({ level, targetLevel: Math.max(0, level - 1), observedFps: 24, bots: 4, fewerBots: false })
      const sample = history.sample.bind(history)
      history.sample = (...args) => { const changed = sample(...args); history.recommendation = offer; return changed }
      history.recommendation = offer
      quality.publishPerformance()
    })
    await steady(page, () => {
      const opaque = el => !!el && !el.hidden && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none' && Number(getComputedStyle(el).opacity) === 1
      const shell = document.querySelector('.mira-shell')
      return shell.classList.contains('is-playing') && !shell.classList.contains('is-paused') && opaque(document.querySelector('.bottom-stack > .performance-recommendation')) && opaque(document.getElementById('mira-build-notice'))
        && [...document.querySelectorAll('.touch-controls button:not([hidden])')].every(b => getComputedStyle(b).visibility !== 'hidden' && Number(getComputedStyle(b.closest('.touch-controls')).opacity) === 1)
    }, `${tag} in play`)
    const play = await page.evaluate(layout)
    if (out) await page.screenshot({ path: `${out}/${tag}-play-build-slow.png` })
    for (const [i, a] of play.items.entries()) for (const b of play.items.slice(i + 1)) assert.ok(!clash(a, b), `${tag} in play: ${a.name} and ${b.name} overlap ${JSON.stringify([a, b])}`)
    for (const a of play.items) for (const c of play.controls) assert.ok(!clash(a, c), `${tag} in play: ${a.name} covers ${c.name} ${JSON.stringify([a, c])}`)
    // Each item sits where the stack puts it: one gap apart, none flung off by a rule of its own.
    const column = [...play.items].sort((x, y) => x.top - y.top)
    for (const [i, a] of column.slice(1).entries()) assert.ok(a.top - column[i].bottom < 40, `${tag} in play: ${column[i].name} and ${a.name} are ${Math.round(a.top - column[i].bottom)}px apart, not one gap`)
    // The build notice takes a tap where it is drawn.
    assert.ok(await page.evaluate(() => { const n = document.getElementById('mira-build-notice'); const r = n.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === n && getComputedStyle(n).pointerEvents !== 'none' }), `${tag} in play: the build notice takes a tap`)
    assert.ok(play.items.length >= 2, `${tag} in play: the build notice and the offer both show (${play.items.map(i => i.name)})`)

    // Paused, with the build notice.
    // Paused as the player pauses (Shell.requestPause): wait for the thumb controls' fade out and
    // the pause bar's fade in to finish, so a control half faded is not measured as shown.
    await page.evaluate(() => mira.shell.requestPause())
    await steady(page, () => {
      const opaque = el => !!el && !el.hidden && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none' && Number(getComputedStyle(el).opacity) === 1
      const touch = document.querySelector('.touch-controls')
      return document.querySelector('.mira-shell').classList.contains('is-paused') && opaque(document.querySelector('.bottom-stack > .pause-actions')) && opaque(document.getElementById('mira-build-notice'))
        && (!touch || getComputedStyle(touch).visibility === 'hidden')
    }, `${tag} paused`)
    const paused = await page.evaluate(layout)
    if (out) await page.screenshot({ path: `${out}/${tag}-paused-build.png` })
    const names = paused.items.map(i => i.name)
    assert.ok(names.includes('pause-actions') && names.includes('mira-build-notice'), `${tag} paused: the pause bar and the build notice both show (${names})`)
    for (const [i, a] of paused.items.entries()) for (const b of paused.items.slice(i + 1)) assert.ok(!clash(a, b), `${tag} paused: ${a.name} and ${b.name} overlap ${JSON.stringify([a, b])}`)
    for (const a of paused.items) for (const c of paused.controls) assert.ok(!clash(a, c), `${tag} paused: ${a.name} covers ${c.name} ${JSON.stringify([a, c])}`)
    // The pause bar's own buttons can be pressed where they are drawn.
    const covered = await page.evaluate(() => [...document.querySelectorAll('.pause-actions button')].map(b => { const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return b.contains(top) ? null : `${b.className.split(' ')[0]} under ${top?.tagName}.${String(top?.className).split(' ').slice(0, 2).join('.')}` }).filter(Boolean))
    assert.deepEqual(covered, [], `${tag} paused: every pause button is on top where it is drawn`)
    // Bug caught: a fourth pause button (Report a bug) pushed past the screen's edge on a phone,
    // which the overlap checks above cannot see. Every pause button lies wholly inside the view.
    const outside = await page.evaluate(() => [...document.querySelectorAll('.pause-actions button')].filter(b => { const r = b.getBoundingClientRect(); return r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight }).map(b => b.className.split(' ')[0]))
    assert.deepEqual(outside, [], `${tag} paused: every pause button lies inside the viewport`)
    assert.deepEqual(errors, [], `${tag}: no page errors`)
    await context.close()
    console.log(`${tag}: bottom stack ok`)
  }
} finally { await browser.close() }
