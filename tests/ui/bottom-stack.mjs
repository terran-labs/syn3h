// The bottom-centre strip has one owner (src/ui/bottom-stack.css). Bug caught: the dev server's
// "New build available" button drawn over the pause bar's Exit world and Screenshot (the owner,
// 24 November 2026), and any other two things that place themselves at bottom centre on their
// own. What must stay true, at a phone upright and on its side, a laptop and a large desktop:
// - paused, with the build notice: every shown item of the strip is clear of every other;
// - in play, with the build notice and the slow-frames offer: likewise, and none
//   covers a thumb control.
//   MIRA_URL=http://127.0.0.1:5213/ node tests/ui/bottom-stack.mjs [out-dir]
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5213/'
const out = process.argv[2]
if (out) mkdirSync(out, { recursive: true })
const SIZES = [[390, 844, true], [844, 390, true], [1280, 800, false], [1960, 1300, false]]

/** The strip's shown items and the controls they must not cover, as boxes. */
const layout = () => {
  const box = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
  const shown = el => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0 }
  const items = [...document.querySelectorAll('.bottom-stack > *')].filter(shown).map(el => ({ name: el.id || el.className.split(' ')[0], ...box(el) }))
  const controls = [...document.querySelectorAll('.touch-controls button, .shell-minimap')].filter(shown).map(el => ({ name: el.className.split(' ')[0], ...box(el) }))
  return { items, controls }
}
const clash = (a, b) => a.right > b.left + 0.5 && a.left < b.right - 0.5 && a.bottom > b.top + 0.5 && a.top < b.bottom - 0.5

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const [width, height, touch] of SIZES) {
    const tag = `${width}x${height}`
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch })
    const page = await context.newPage()
    const errors = []; page.on('pageerror', error => errors.push(String(error.message).slice(0, 300)))
    await page.goto(`${base}?autoplay=1&room=bottom-stack-${tag}-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    await page.waitForFunction(() => document.querySelector('.mira-shell')?.classList.contains('is-playing') && !document.querySelector('.mira-shell').classList.contains('is-descending'), null, { timeout: 120000 })
    // A new build arrives (the dev server's own event and button, tools/manual-reload.mjs).
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('mira:new-build')))
    await page.waitForFunction(() => document.querySelector('.bottom-stack > #mira-build-notice'), null, { timeout: 5000 })

    // In play, with every driving notice shown at once.
    await page.evaluate(() => {
      const offer = document.querySelector('.performance-recommendation'); offer.hidden = false
      offer.querySelector('p').textContent = 'Running slow: frames are taking longer than they should.'
    })
    await page.waitForTimeout(300)
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
    await page.evaluate(() => mira.shell.requestPause())
    await page.locator('.pause-actions').waitFor({ state: 'visible' })
    await page.waitForTimeout(500)
    const paused = await page.evaluate(layout)
    if (out) await page.screenshot({ path: `${out}/${tag}-paused-build.png` })
    const names = paused.items.map(i => i.name)
    assert.ok(names.includes('pause-actions') && names.includes('mira-build-notice'), `${tag} paused: the pause bar and the build notice both show (${names})`)
    for (const [i, a] of paused.items.entries()) for (const b of paused.items.slice(i + 1)) assert.ok(!clash(a, b), `${tag} paused: ${a.name} and ${b.name} overlap ${JSON.stringify([a, b])}`)
    for (const a of paused.items) for (const c of paused.controls) assert.ok(!clash(a, c), `${tag} paused: ${a.name} covers ${c.name} ${JSON.stringify([a, c])}`)
    // The pause bar's own buttons can be pressed where they are drawn.
    const covered = await page.evaluate(() => [...document.querySelectorAll('.pause-actions button')].map(b => { const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return b.contains(top) ? null : `${b.className.split(' ')[0]} under ${top?.tagName}.${String(top?.className).split(' ').slice(0, 2).join('.')}` }).filter(Boolean))
    assert.deepEqual(covered, [], `${tag} paused: every pause button is on top where it is drawn`)
    assert.deepEqual(errors, [], `${tag}: no page errors`)
    await context.close()
    console.log(`${tag}: bottom stack ok`)
  }
} finally { await browser.close() }
