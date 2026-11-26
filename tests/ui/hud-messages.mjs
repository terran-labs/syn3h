// Incoming chat and the control tips on a desktop and on a phone either way up, in a jet. Bugs caught: a chat bubble drawn
// over the controls (the owner's screenshot, 25 November 2026) or over any other HUD element;
// tips that never teach E, Q and Space, or that come back after they were learned; chat toasts
// over the open sidebar; the full controls sheet as bare text on the scene.
//   MIRA_URL=http://127.0.0.1:5173/ tools/heavy.sh node tests/ui/hud-messages.mjs
import '../../tools/lib/legacy-env.mjs'
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { serverUrl } from './lib/server.mjs'

const base = serverUrl('hud-messages')
const shots = 'tests/ui/artifacts/hud-messages'
await mkdir(shots, { recursive: true })

/** Every visible fixed HUD box that intersects the chat strip or the tips, by name. */
const overlaps = () => {
  const shell = document.querySelector('.mira-shell'), box = el => el.getBoundingClientRect()
  const visible = el => { const s = getComputedStyle(el), b = box(el); return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05 && b.width > 2 && b.height > 2 && b.bottom > 0 && b.right > 0 && b.left < innerWidth && b.top < innerHeight }
  const mine = [...shell.querySelectorAll('.chat-strip, .spawn-help')].filter(visible)
  // Name labels follow vehicles round the screen; the strip steps back from them on its own (ChatCard.yield).
  const others = [...shell.querySelectorAll('*')].filter(el => (getComputedStyle(el).position === 'fixed' || el.matches('.touch-controls button, .focus-hud .fh-read, .gear-selector :is(.gs-meter, .gs-status, .gs-release)')) && visible(el) && !mine.some(m => m === el || m.contains(el) || el.contains(m)) && !el.closest('.vehicle-nameplates, .nameplate') && !(box(el).width >= innerWidth - 2 && box(el).height >= innerHeight - 2))
  const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5
  const name = el => `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join('.')}`
  const found = []
  for (const m of mine) for (const o of others) if (hit(box(m), box(o))) found.push(`${name(m)} x ${name(o)}`)
  if (mine.length === 2 && hit(box(mine[0]), box(mine[1]))) found.push('chat x tips')
  return { shown: mine.map(name), found }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const [width, height] of [[1280, 800], [1700, 1100]]) {
    const size = `${width}x${height}`
    const page = await browser.newPage({ viewport: { width, height } })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${base}?autoplay=1&vehicle=jet&room=hud-messages-${size}-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.game.tick > 30 && window.miraNet?.connected, null, { timeout: 180000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 180000 })
    await page.waitForFunction(() => window.mira.shell.playing && !document.querySelector('.mira-shell').classList.contains('is-descending'), null, { timeout: 180000 })
    await page.evaluate(() => { localStorage.removeItem('mira.tips.learned'); window.mira.params.set('daydream.seconds', 0, 'local'); window.mira.params.set('bots.count', 0) })

    // The driving view (exactly the cursor-captured view, hud.mode 1), with a line of chat in.
    await page.evaluate(() => { window.mira.params.set('hud.mode', 1, 'local'); window.mira.shell.inspector.open = false; window.mira.shell.tips.restart() })
    await page.evaluate(() => window.miraNet.chat.receive({ type: 'chat', from: 4242, text: 'Zeptock, that was an orange-level situation. Also beautiful.' }))
    await page.waitForFunction(() => document.querySelector('.chat-strip .chat-line') && document.querySelector('.spawn-help.is-tips:not([hidden])'), null, { timeout: 20000 })
    await page.waitForTimeout(500)
    const tips = await page.evaluate(() => [...document.querySelectorAll('.spawn-help.is-tips [data-tip]')].map(el => el.dataset.tip))
    assert.deepEqual(tips, ['jet.hover.liftoff', 'jet.hover.mode', 'jet.hover.move'], `${size}: a new pilot is told how to lift off, switch and move`)
    assert.match(await page.locator('.spawn-help [data-tip="jet.hover.liftoff"]').innerText(), /^E\s*hold: lift off and climb · Q\s*come down/, `${size}: the lift-off line names E and Q`)
    const strip = await page.locator('.chat-strip').boundingBox(), help = await page.locator('.spawn-help').boundingBox()
    assert.ok(strip.y < height / 3 && strip.x + strip.width > width - 40, `${size}: chat is in the upper right (${JSON.stringify(strip)})`)
    const card = await page.locator('.chat-strip .chat-line').last().evaluate(el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return { right: innerWidth - r.right, corners: [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius] } })
    assert.equal(Math.round(card.right), 16, `${size}: the chat card stands 16 px in from the right edge`)
    assert.equal(new Set(card.corners).size, 1, `${size}: the chat card is round on every corner (${card.corners})`)
    const map = await page.locator('.shell-minimap').boundingBox()
    assert.ok(help.x >= map.x + map.width, `${size}: the tips sit right of the minimap's box (${help.x} >= ${map.x + map.width})`)
    const clash = await page.evaluate(overlaps)
    await page.screenshot({ path: `${shots}/${size}-driving.png` })
    assert.deepEqual(clash.found, [], `${size}: chat and tips touch no other HUD element (${JSON.stringify(clash)})`)

    // Holding E lifts off; the lesson goes and the device remembers it.
    await page.keyboard.down('KeyE'); await page.waitForTimeout(900); await page.keyboard.up('KeyE')
    await page.waitForFunction(() => !document.querySelector('.spawn-help [data-tip="jet.hover.liftoff"]'), null, { timeout: 10000 })
    assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('mira.tips.learned') ?? '[]').includes('jet.hover.liftoff')), `${size}: lifting off is remembered`)
    await page.evaluate(() => window.mira.shell.tips.restart()); await page.waitForTimeout(400)
    assert.equal(await page.locator('.spawn-help [data-tip="jet.hover.liftoff"]').count(), 0, `${size}: a learned tip does not come back`)

    // H: the full sheet, on the house panel, not bare text on the scene.
    await page.keyboard.press('KeyH'); await page.waitForTimeout(300)
    const sheet = await page.evaluate(() => { const el = document.querySelector('.spawn-help'), s = getComputedStyle(el); return { full: el.classList.contains('is-full'), hidden: el.hidden, background: s.backgroundColor, shadow: s.textShadow } })
    assert.ok(sheet.full && !sheet.hidden, `${size}: H opens the full sheet`)
    const reach = await page.evaluate(() => { const r = [...document.querySelectorAll('.focus-hud .fh-read.fh-left, .focus-hud .fh-read.fh-right')].map(e => e.getBoundingClientRect()).filter(b => b.height); return { top: document.querySelector('.spawn-help').getBoundingClientRect().top, mid: Math.max(...r.map(b => (b.top + b.bottom) / 2)) } })
    assert.ok(reach.top >= reach.mid - 1, `${size}: the sheet stays below the readouts' centre line (${JSON.stringify(reach)})`)
    assert.notEqual(sheet.background, 'rgba(0, 0, 0, 0)', `${size}: the sheet has a backing (${sheet.background})`)
    assert.equal(sheet.shadow, 'none', `${size}: no shadow on the sheet's text`)
    await page.screenshot({ path: `${shots}/${size}-sheet.png` })
    await page.keyboard.press('KeyH')

    // Cursor free: the sidebar shows and chat toasts do not.
    await page.evaluate(() => { window.mira.params.set('hud.mode', 0, 'local'); window.mira.shell.inspector.open = true })
    await page.evaluate(() => window.miraNet.chat.receive({ type: 'chat', from: 4242, text: 'race you to the volcano' }))
    await page.waitForTimeout(400)
    assert.equal(await page.locator('.chat-strip').evaluate(el => getComputedStyle(el).display), 'none', `${size}: no chat toasts over the open sidebar`)
    assert.deepEqual(errors, [], `${size}: no page errors`)
    console.log(`${size}: ok`)
    await page.close()
  }
  // Phones: one toast, the newest; tips naming the on-screen buttons; clear of the PANELS pill,
  // the thumb buttons, the minimap and everything else.
  for (const [width, height] of [[390, 844], [844, 390]]) {
    const size = `${width}x${height}`
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
    await context.addInitScript(() => localStorage.setItem('mira.chat.overlay', '1'))
    const page = await context.newPage()
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${base}?autoplay=1&vehicle=jet&room=hud-messages-${size}-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.game.tick > 30 && window.miraNet?.connected, null, { timeout: 180000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 180000 })
    await page.waitForFunction(() => window.mira.shell.playing && !document.querySelector('.mira-shell').classList.contains('is-descending'), null, { timeout: 180000 })
    await page.evaluate(() => { localStorage.removeItem('mira.tips.learned'); window.mira.params.set('daydream.seconds', 0, 'local'); window.mira.params.set('bots.count', 0); window.mira.shell.tips.restart() })
    if (await page.locator('.world-inspector').isVisible()) await page.evaluate(() => window.mira.shell.returnToDriving())
    for (const text of ['race you to the volcano', 'Please do not do it again. Do it again.']) await page.evaluate(text => window.miraNet.chat.receive({ type: 'chat', from: 4242, text }), text)
    await page.waitForFunction(() => document.querySelector('.chat-strip .chat-line') && document.querySelector('.spawn-help.is-tips:not([hidden])'), null, { timeout: 20000 })
    await page.waitForTimeout(600)
    const shownLines = await page.locator('.chat-strip .chat-line').evaluateAll(ls => ls.filter(l => getComputedStyle(l).display !== 'none').length)
    assert.equal(shownLines, 1, `${size}: one chat line at a time on a phone`)
    const first = await page.locator('.spawn-help [data-tip]').first().innerText()
    assert.match(first, /THR \+/, `${size}: the tips name the on-screen buttons (${first})`)
    const pill = await page.locator('.hud-navigation').boundingBox(), help = await page.locator('.spawn-help').boundingBox()
    if (width < height) {
      // Upright: tips in the sky band between the gear list and the readouts, chat below the readouts.
      const bands = await page.evaluate(() => {
        const box = el => el.getBoundingClientRect(), seen = el => { const r = box(el); return r.height > 0 && getComputedStyle(el).visibility !== 'hidden' }
        const gear = [document.querySelector('.gear-selector'), ...document.querySelectorAll('.gear-selector :is(.gs-meter, .gs-status, .gs-release, .gs-drum)')].filter(e => e && seen(e))
        const reads = [...document.querySelectorAll('.focus-hud .fh-read.fh-left, .focus-hud .fh-read.fh-right')].filter(seen)
        return { gear: Math.max(...gear.map(e => box(e).bottom)), readTop: Math.min(...reads.map(e => box(e).top)), readBottom: Math.max(...reads.map(e => box(e).bottom)), tips: box(document.querySelector('.spawn-help')).toJSON(), chat: box(document.querySelector('.chat-strip')).toJSON() }
      })
      assert.ok(bands.tips.top >= bands.gear && bands.tips.bottom <= bands.readTop, `${size}: the tips sit between the gear list and the readouts ${JSON.stringify(bands)}`)
      assert.ok(bands.chat.top >= bands.readBottom, `${size}: the chat sits below the readouts ${JSON.stringify(bands)}`)
      assert.ok(help.y + help.height <= pill.y - 4, `${size}: the tips stay clear of the PANELS pill`)
    } else {
      // On its side: top right, right of the centre column the system toasts use.
      const strip = await page.locator('.chat-strip').boundingBox()
      assert.ok(strip.y < 40 && strip.x >= width / 2 + 149 && strip.x + strip.width >= width - 40, `${size}: the chat is top right, clear of the centre column (${JSON.stringify(strip)})`)
    }
    const clash = await page.evaluate(overlaps)
    await page.screenshot({ path: `${shots}/${size}-driving.png` })
    assert.deepEqual(clash.found, [], `${size}: chat and tips touch no other HUD element (${JSON.stringify(clash)})`)
    // Once the system toast has gone the chat line shows, and still touches nothing.
    await page.waitForFunction(() => document.querySelector('.shell-toast').hidden, null, { timeout: 30000 })
    await page.evaluate(text => window.miraNet.chat.receive({ type: 'chat', from: 4242, text }), 'race you to the volcano')
    await page.waitForFunction(() => { const l = document.querySelector('.chat-strip .chat-line:last-child'); return l && l.checkVisibility({ visibilityProperty: true }) }, null, { timeout: 10000 })
    await page.waitForTimeout(400)
    const corners = await page.locator('.chat-strip .chat-line').last().evaluate(el => { const s = getComputedStyle(el); return [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius] })
    assert.equal(new Set(corners).size, 1, `${size}: the chat card is round on every corner (${corners})`)
    const after = await page.evaluate(overlaps)
    await page.screenshot({ path: `${shots}/${size}-driving-chat.png` })
    assert.deepEqual(after.found, [], `${size}: with the toast gone, chat and tips touch nothing (${JSON.stringify(after)})`)
    // A Grapple with a cord attached: its status line ("Cord 24 m") and the way to let go appear
    // under its name, and the tips move down to clear them (Shell.measureBands). The rack's
    // controls are swapped for a frozen attached state, as tests/ui/thumb-grid.mjs does.
    await page.evaluate(() => {
      const rack = window.miraNet.gear; rack.select('bungee')
      const real = rack.controls(), noop = () => {}
      const fake = Object.freeze({ ...real, gear: 'bungee', state: 'ground', status: 'Cord 24 m', actions: Object.freeze([
        { id: 'reelIn', label: 'Reel in', keys: [], hold: true, start: noop, stop: noop },
        { id: 'payOut', label: 'Let out', keys: [], hold: true, start: noop, stop: noop },
        { id: 'release', label: 'Let go', keys: [], hold: false, start: noop },
      ]) })
      rack.controls = () => fake
    })
    await page.waitForFunction(() => [...document.querySelectorAll('.gear-selector .gs-status')].some(el => el.checkVisibility({ visibilityProperty: true }) && /cord/i.test(el.textContent)), null, { timeout: 10000 })
    await page.waitForTimeout(700)
    const cord = await page.evaluate(() => {
      const status = [...document.querySelectorAll('.gear-selector :is(.gs-status, .gs-release, .gs-meter)')].filter(el => el.checkVisibility({ visibilityProperty: true })).map(el => el.getBoundingClientRect().bottom)
      return { statusBottom: Math.max(...status), tipsTop: document.querySelector('.spawn-help').getBoundingClientRect().top, clash: null }
    })
    cord.clash = (await page.evaluate(overlaps)).found
    await page.screenshot({ path: `${shots}/${size}-cord.png` })
    if (width < height) assert.ok(cord.tipsTop >= cord.statusBottom, `${size}: the tips clear the Grapple's status line ${JSON.stringify(cord)}`)
    assert.deepEqual(cord.clash, [], `${size}: with a cord attached nothing touches (${JSON.stringify(cord)})`)
    assert.deepEqual(errors, [], `${size}: no page errors`)
    console.log(`${size}: ok`)
    await context.close()
  }
} finally { await browser.close() }
