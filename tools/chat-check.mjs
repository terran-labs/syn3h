/**
 * Chat in a real browser: two pages in one fresh room.
 *
 *   SYN3H_ROOM_PORT=<room> npx vite --host 127.0.0.1 --port <port> --strictPort
 *   tools/heavy.sh node tools/chat-check.mjs http://127.0.0.1:<port>/ [/tmp/out-dir] [--bots]
 *
 * Chat is the last card in the sidebar's stack (src/ui/chat/ChatCard.ts). Checks, in order:
 *  1. A opens chat with Y (the panels, the Chat card, the caret in the field), types, sends
 *     with Enter; B sees the line, as text not markup.
 *  2. While A's field has focus, driving keys do not move A's vehicle.
 *  3. B's closed Chat card counts the unread line; opening it clears the count.
 *  4. B mutes A; A's next line does not show on B.
 *  5. With --bots: at "chatty", a bot speaks within two minutes (B, a guest, sees it).
 * Screenshots of the card closed and open, on desktop and phone (both orientations), and on a
 * phone with a stand-in on-screen keyboard (a shrunken visual viewport).
 * Exits non zero on any failure.
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const base = process.argv[2] ?? 'http://127.0.0.1:5183/'
const out = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : '/tmp/syn3h-chat-check'
const withBots = process.argv.includes('--bots')
mkdirSync(out, { recursive: true })
const room = `chat${Date.now().toString(36)}`
const failures = []
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] })
const errors = []
async function open(name, opts, extra = '') {
  const ctx = await browser.newContext(opts)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  await page.goto(`${base}?room=${room}&name=${name}&autoplay=1${extra}`)
  await page.waitForFunction(() => document.querySelector('.syn3h-shell.is-playing .world-inspector .wi-card[data-section="chat"]'), null, { timeout: 60000 })
  await page.waitForTimeout(2500)
  return { ctx, page }
}
const desk = { viewport: { width: 1280, height: 800 } }
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` })
const CHAT_HEAD = '.wi-card[data-section="chat"] > .wi-head'
/** The Chat card is open with the panels showing. */
const chatOpen = (page) => page.evaluate(() => window.syn3hChat.panel.isOpen)
/** Unread lines, as the card counts them (the same number the left column's row shows). */
const unreadOn = (page) => page.evaluate(() => window.syn3hChat.panel.unreadCount)
/** Show the panels as a player does: free the cursor if it is captured (Escape). */
async function showPanels(page) {
  if (await page.evaluate(() => !!document.pointerLockElement)) { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.pointerLockElement) }
  await page.locator('.world-inspector').waitFor({ state: 'visible' })
}
/** Click a control; if something else is on top of it, say what, then click it directly. */
async function clickPill(page, label, selector = CHAT_HEAD) {
  const blocked = await page.evaluate((selector) => {
    const b = document.querySelector(selector).getBoundingClientRect()
    const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)
    if (top?.closest(selector)) return null
    return { top: `${top?.tagName}#${top?.id}.${top?.className}`, shell: document.querySelector('.syn3h-shell').className, body: document.body.className, pe: getComputedStyle(document.querySelector(selector)).pointerEvents, vis: getComputedStyle(document.querySelector(selector)).visibility }
  }, selector)
  if (blocked) { console.log(`BLOCKED ${selector} (${label})`, JSON.stringify(blocked)); failures.push(`${selector} not clickable: ${label}`) }
  await page.evaluate((selector) => document.querySelector(selector).click(), selector)
}
/** Lines in the open Chat card's log (opens the card first if it is closed). */
async function linesOn(page) {
  if (!(await chatOpen(page))) await page.evaluate(() => window.syn3hChat.panel.openAndFocus())
  await page.waitForTimeout(300)
  return page.evaluate(() => [...document.querySelectorAll('.wi-card[data-section="chat"] .chat-log .chat-line:not(.is-system)')].map((l) => l.textContent))
}

try {
  const A = await open('Ann', desk)
  const B = await open('Bea', desk)
  if (withBots) {
    // The host (A) turns chatter to chatty; guests cannot.
    await A.page.evaluate(() => window.syn3h.params.set('bots.chatterLevel', 2))
  }
  // The card is the last in the stack, titled Chat.
  const place = await A.page.evaluate(() => { const cards = [...document.querySelectorAll('.world-inspector .wi-cards > .wi-card')]; const chat = cards.at(-1); return { last: chat?.dataset.section, title: chat?.querySelector('h3')?.textContent } })
  check(place.last === 'chat' && place.title === 'Chat', `Chat is the last card in the stack (${JSON.stringify(place)})`)

  // 1 and 2: open with Y, hold W while typing, send.
  // Focus the page without pausing it: a canvas click plus Escape pauses when pointer lock
  // does not engage, and a paused game rightly ignores Y.
  await A.page.evaluate(() => { document.activeElement?.blur?.(); document.body.focus() })
  await A.page.keyboard.press('KeyY')
  await A.page.waitForTimeout(400)
  const focused = await A.page.evaluate(() => document.activeElement?.classList.contains('chat-field'))
  check(focused && await chatOpen(A.page), 'Y shows the panels, opens the Chat card and focuses the field')
  await A.page.keyboard.down('KeyW')
  await A.page.waitForTimeout(1500)
  await A.page.keyboard.up('KeyW')
  const typing = await A.page.evaluate(() => {
    const input = window.syn3h?.game?.input
    return input ? { typing: input.typing, y: input.state.y } : null
  })
  check(!!typing && (typing.typing === true && typing.y === 0), 'driving input is suspended while the field has focus')
  await A.page.keyboard.type('<b>bold</b> hello https://example.com/x')
  await A.page.keyboard.press('Enter')
  await B.page.waitForTimeout(1500)
  await shot(B.page, 'desktop-closed-unread')
  const unread = await unreadOn(B.page)
  const summary = await B.page.textContent(`${CHAT_HEAD} .wi-sum`)
  check(unread >= 1 && /new/.test(summary) && !/…|\.\.\./.test(summary), `B's closed Chat card counts unread lines (${unread}, "${summary}")`)
  // The left column's Chat row shows the same count, through chatLink.
  const rowCount = await B.page.evaluate(() => { const c = document.querySelector('.hud-chat .chat-count'); return c && !c.hidden ? Number(c.textContent.replace('+', '')) : 0 })
  check(rowCount === Math.min(unread, 9) || (unread > 9 && rowCount === 9), `the left column's Chat row shows the unread count (${rowCount} of ${unread})`)
  const stripHtml = await B.page.evaluate(() => document.querySelector('.chat-strip')?.innerHTML ?? '')
  check(!/<b>bold/.test(stripHtml) && stripHtml.includes('&lt;b&gt;bold'), 'markup arrives as text, not elements')
  await showPanels(B.page)
  await B.page.locator(CHAT_HEAD).scrollIntoViewIfNeeded()
  await clickPill(B.page, 'guest desktop')
  await B.page.waitForTimeout(500)
  check(await unreadOn(B.page) === 0, 'opening the card clears the unread count')
  check(!(await B.page.$('.wi-card[data-section="chat"] .chat-log a')), 'links are not made clickable')
  const seen = await linesOn(B.page)
  check(seen.some((t) => t.includes('<b>bold</b> hello')), 'B sees A\'s line')
  const newest = await B.page.evaluate(() => { const log = document.querySelector('.wi-card[data-section="chat"] .chat-log'); return log.scrollHeight - log.scrollTop - log.clientHeight < 24 })
  check(newest, 'the open log shows the newest line')
  await shot(B.page, 'desktop-open')
  await A.page.keyboard.press('Escape')
  check(await A.page.evaluate(() => !document.activeElement?.classList.contains('chat-field')), 'Escape leaves the field')

  // 4: B mutes A from the People list.
  await clickPill(B.page, 'guest people', '.chat-people-toggle')
  await clickPill(B.page, 'guest mute', '.chat-people .chat-mute')
  await A.page.keyboard.press('KeyY'); await A.page.waitForTimeout(300)
  await A.page.keyboard.type('you cannot see this')
  await A.page.keyboard.press('Enter')
  await B.page.waitForTimeout(1500)
  const afterMute = await linesOn(B.page)
  check(!afterMute.some((t) => t.includes('you cannot see this')), 'a muted player\'s line is not shown')
  const onA = await linesOn(A.page)
  check(onA.some((t) => t.includes('you cannot see this')), 'the line still reached the room (A sees its echo)')
  await clickPill(B.page, 'guest mute', '.chat-people .chat-mute')
  await clickPill(B.page, 'guest people', '.chat-people-toggle')

  // Driving with the cursor captured (headless Chrome grants a real lock), in Full and Driving
  // modes: Y frees the cursor, shows the panels on the Chat card with the caret in the field;
  // typing does not drive; Enter sends; Enter on the empty field captures the cursor again and
  // drives, in the interface mode the player had; Y then Escape does the same.
  for (const mode of [0, 1]) {
    await A.page.evaluate((m) => { document.activeElement?.blur?.(); window.syn3h.params.set('hud.mode', m) }, mode)
    await A.page.mouse.click(640, 400); await A.page.waitForTimeout(700)
    const st = () => A.page.evaluate(() => ({ lock: !!document.pointerLockElement, field: document.activeElement?.classList.contains('chat-field'), open: window.syn3hChat.panel.isOpen, y: window.syn3h.game.input.state.y, mode: window.syn3h.params.get('hud.mode')?.value }))
    const locked = (await st()).lock
    await A.page.keyboard.press('KeyY'); await A.page.waitForTimeout(500)
    const opened = await st()
    await A.page.keyboard.down('KeyW'); await A.page.keyboard.type(`locked line ${mode}`); await A.page.waitForTimeout(300)
    const typing = await st(); await A.page.keyboard.up('KeyW')
    await A.page.keyboard.press('Enter'); await A.page.waitForTimeout(800)
    await A.page.keyboard.press('Enter'); await A.page.waitForTimeout(700)
    const closed = await st()
    // The axis follows the key at the next rendered frame, which can take a while under load.
    await A.page.keyboard.down('KeyW'); await A.page.waitForFunction(() => window.syn3h.game.input.state.y === 1, null, { timeout: 2000 }).catch(() => {}); const driving = await st(); await A.page.keyboard.up('KeyW')
    await A.page.keyboard.press('KeyY'); await A.page.waitForTimeout(500)
    await A.page.keyboard.press('Escape'); await A.page.waitForTimeout(700)
    const esc = await st()
    const sent = (await A.page.evaluate(() => window.syn3hChat.net.chat.visible().map((l) => l.text))).some((t) => t.includes(`locked line ${mode}`))
    check(locked && opened.open && opened.field && !opened.lock && typing.y === 0 && sent && !closed.open && closed.lock && closed.mode === mode && driving.y === 1 && !esc.field && esc.lock && esc.mode === mode,
      `cursor captured, interface mode ${mode}: Y opens the Chat card with the caret, typing does not drive, the line arrives, Enter on empty drives again in the same mode, Y then Escape too (${JSON.stringify({ locked, opened, typing, sent, closed, driving, esc })})`)
  }
  await A.page.evaluate(() => window.syn3h.params.set('hud.mode', 0))

  // Chat off for the room: the host turns it off, a guest's line is refused and not relayed.
  await A.page.evaluate(() => window.syn3h.params.set('chat.on', false))
  // The setting reaches the guest through the room: wait for it rather than a fixed time.
  await B.page.waitForFunction(() => !window.syn3hChat.net.chat.canSend().ok, null, { timeout: 20000 }).catch(() => {})
  // The guest's screen stops offering chat, and the room refuses even a line sent past that gate.
  const gated = await B.page.evaluate(() => !window.syn3hChat.net.chat.canSend().ok)
  await B.page.evaluate(() => window.syn3hChat.net.send({ type: 'chat', text: 'can anyone hear me' }))
  await B.page.waitForTimeout(1500)
  const refused = await B.page.evaluate(() => window.syn3hChat.net.chat.lines.some((l) => l.system && /turned chat off/i.test(l.text)))
  const leaked = (await A.page.evaluate(() => window.syn3hChat.net.chat.visible().map((l) => l.text))).some((t) => t.includes('can anyone hear me'))
  check(gated && refused && !leaked, `chat off for the room: the guest cannot send (${gated}), the room refuses (${refused}), nothing relayed (${!leaked})`)
  await A.page.evaluate(() => window.syn3h.params.set('chat.on', true))
  await B.page.waitForTimeout(800)

  // 5: bots.
  if (withBots) {
    const t0 = Date.now()
    let spoke = false
    while (Date.now() - t0 < 120000) {
      spoke = await B.page.evaluate(() => window.syn3hChat.net.chat.visible().some((l) => l.bot))
      if (spoke) break
      await B.page.waitForTimeout(2000)
    }
    check(spoke, `a bot spoke within two minutes at chatty (${Math.round((Date.now() - t0) / 1000)} s), seen on the guest`)
    await shot(B.page, 'desktop-open-bots')
  }
  await A.ctx.close(); await B.ctx.close()

  // Each layout as a further player: the card closed with a strip over the game, then open.
  const layouts = [
    ['desktop-1280', { viewport: { width: 1280, height: 800 } }],
    ['desktop-1440', { viewport: { width: 1440, height: 900 } }],
    ['phone-portrait', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
    ['phone-landscape', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
    ['phone-landscape-lefthand', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, true],
  ]
  for (const [name, opts, hand] of layouts) {
    const touch = Boolean(opts.hasTouch)
    const P = await open(name.replace(/[^a-z]/g, '').slice(0, 10), opts)
    if (hand) await P.page.evaluate(() => window.syn3h.params.set('touch.leftHanded', true))
    // "Show new chat over the game": on by default on desktop, off on touch-first devices.
    // Off, an arriving line puts nothing over the view, the unread count rises and the log has it.
    const overlayDefault = await P.page.evaluate(() => window.syn3h.params.get('chat.overlay').value)
    check(overlayDefault === !touch, `${name}: "Show new chat over the game" is ${touch ? 'off' : 'on'} by default (${overlayDefault})`)
    const arrive = (text) => P.page.evaluate((text) => window.syn3hChat.net.chat.receive({ type: 'chat', from: 0xff00, text, t: 0 }), text)
    // The panels closed, as when driving.
    if (touch && await P.page.locator('.world-inspector').isVisible()) await P.page.locator('.inspector-toggle').tap()
    await P.page.evaluate(() => window.syn3h.params.set('chat.overlay', false))
    const unreadBefore = await unreadOn(P.page)
    await arrive('Overlay check: this line stays in the log.')
    await P.page.waitForTimeout(600)
    const off = await P.page.evaluate(() => ({ strip: document.querySelectorAll('.chat-strip .chat-line').length, marks: document.querySelectorAll('.vehicle-nameplate.is-speaking').length, inLog: window.syn3hChat.net.chat.visible().some((l) => l.text.includes('stays in the log')) }))
    const unreadAfter = await unreadOn(P.page)
    check(off.strip === 0 && off.marks === 0 && off.inLog && unreadAfter > unreadBefore, `${name}: with the switch off a line arrives, nothing shows over the view, the unread count rises (${unreadBefore} to ${unreadAfter}) and the log has it`)
    await P.page.evaluate(() => window.syn3h.params.set('chat.overlay', true))
    await arrive('Overlay check: this line shows over the game.')
    await P.page.waitForTimeout(600)
    const on = await P.page.evaluate(() => [...document.querySelectorAll('.chat-strip .chat-line')].some((l) => l.textContent.includes('shows over the game')))
    check(on, `${name}: with the switch on the line shows over the game, as before`)
    await shot(P.page, `${name}-closed`)
    const strip = await P.page.evaluate(() => {
      const hit = (a, b) => a.width > 0 && b.width > 0 && a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom
      const rects = (sel) => [...document.querySelectorAll(sel)].map((e) => [e.className?.baseVal ?? e.className, e.getBoundingClientRect()])
      const lines = [...document.querySelectorAll('.chat-strip .chat-line')].map((e) => e.getBoundingClientRect())
      const avoid = rects('.touch-actions button, .hud-navigation, .shell-minimap, .gear-selector .gs-item.is-active, .fh-read, .shell-toast:not([hidden]), #syn3h-build-notice, .build-banner')
      const reticle = { left: innerWidth / 2 - 60, right: innerWidth / 2 + 60, top: innerHeight / 2 - 60, bottom: innerHeight / 2 + 60, width: 120 }
      return { clash: lines.flatMap((l) => [...avoid.filter(([, r]) => hit(l, r)).map(([c]) => c), ...(hit(l, reticle) ? ['reticle'] : [])]), lines: lines.length }
    })
    check(strip.clash.length === 0 && strip.lines <= 3, `${name}: the strip (${strip.lines} lines) clears readouts, reticle, toasts and banner (${strip.clash.join(', ')})`)
    // Open as a player does: on touch the Panels button then the Chat header; on a desktop the header.
    if (touch) { await P.page.locator('.inspector-toggle').tap(); await P.page.locator('.world-inspector').waitFor({ state: 'visible' }); await P.page.locator(CHAT_HEAD).scrollIntoViewIfNeeded(); await P.page.locator(CHAT_HEAD).tap() }
    else { await showPanels(P.page); await P.page.locator(CHAT_HEAD).scrollIntoViewIfNeeded(); await clickPill(P.page, name) }
    await P.page.waitForTimeout(700)
    await P.page.locator('.wi-card[data-section="chat"] .chat-field').focus()
    await P.page.waitForTimeout(400)
    await shot(P.page, `${name}-open`)
    const shown = await P.page.evaluate(() => {
      const log = document.querySelector('.wi-card[data-section="chat"] .chat-log'), field = document.querySelector('.wi-card[data-section="chat"] .chat-field').getBoundingClientRect()
      const stack = document.querySelector('.world-inspector .wi-cards').getBoundingClientRect()
      return { open: window.syn3hChat.panel.isOpen, newest: log.scrollHeight - log.scrollTop - log.clientHeight < 24, field: field.top >= stack.top - 1 && field.bottom <= Math.min(stack.bottom, innerHeight) + 1, strip: document.querySelectorAll('.chat-strip .chat-line').length, fieldHeight: field.height }
    })
    check(shown.open && shown.newest && shown.field && shown.strip === 0 && shown.fieldHeight >= (touch ? 43.5 : 39.5), `${name}: open, the newest line and the field are in view, the strip gives way (${JSON.stringify(shown)})`)
    if (touch) {
      // The on-screen keyboard: headless browsers have none, so stand one in. The visual
      // viewport is shrunk to what a phone keyboard leaves (a little over half in portrait, a
      // little under half on its side) and told it resized; the field must stay above it.
      const left = name.includes('portrait') ? 0.55 : 0.45
      const kb = await P.page.evaluate(async (left) => {
        const vv = window.visualViewport, real = vv.height
        Object.defineProperty(vv, 'height', { configurable: true, get: () => Math.round(real * left) })
        vv.dispatchEvent(new Event('resize'))
        await new Promise((r) => setTimeout(r, 400))
        const field = document.querySelector('.wi-card[data-section="chat"] .chat-field').getBoundingClientRect()
        return { keyboardTop: Math.round(real * left), fieldBottom: Math.round(field.bottom), fieldTop: Math.round(field.top) }
      }, left)
      await shot(P.page, `${name}-keyboard`)
      check(kb.fieldBottom <= kb.keyboardTop && kb.fieldTop >= 0, `${name}: with a keyboard taking the lower ${Math.round((1 - left) * 100)}%, the field stays above it (${JSON.stringify(kb)})`)
      await P.page.evaluate(() => { delete window.visualViewport.height; window.visualViewport.dispatchEvent(new Event('resize')) })
    }
    // Escape (on a phone, the keyboard's own close) leaves the field and returns to driving.
    await P.page.keyboard.press('Escape'); await P.page.waitForTimeout(600)
    const after = await P.page.evaluate(() => ({ typing: window.syn3h.game.input.typing, field: document.activeElement?.classList.contains('chat-field'), maxHeight: document.querySelector('.world-inspector').style.maxHeight }))
    check(after.typing === false && !after.field && after.maxHeight === '', `${name}: leaving the field restores driving and the panel's height (${JSON.stringify(after)})`)
    await P.ctx.close()
  }
} catch (e) {
  console.log("ERROR", e?.stack ?? e); failures.push(String(e?.message ?? e))
} finally {
  await browser.close()
}
for (const e of errors) console.log('PAGE ERROR', e)
console.log(failures.length || errors.length ? `CHAT CHECK FAILED (${failures.length})` : 'CHAT CHECK PASSED', out)
process.exit(failures.length || errors.length ? 1 : 0)
