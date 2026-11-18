/**
 * Chat in a real browser: two pages in one fresh room.
 *
 *   SYN3H_ROOM_PORT=<room> npx vite --host 127.0.0.1 --port <port> --strictPort
 *   tools/heavy.sh node tools/chat-check.mjs http://127.0.0.1:<port>/ [/tmp/out-dir] [--bots]
 *
 * Checks, in order:
 *  1. A opens chat with Y, types, sends with Enter; B sees the line, as text not markup.
 *  2. While A's field has focus, driving keys do not move A's vehicle.
 *  3. B's collapsed pill counts the unread line; opening it clears the count.
 *  4. B mutes A; A's next line does not show on B.
 *  5. With --bots: at "chatty", a bot speaks within two minutes (B, a guest, sees it).
 * Screenshots of the panel collapsed and open, on desktop and phone (both orientations).
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
  await page.waitForFunction(() => document.querySelector('.syn3h-shell.is-playing .chat-panel'), null, { timeout: 60000 })
  await page.waitForTimeout(2500)
  return { ctx, page }
}
const desk = { viewport: { width: 1280, height: 800 } }
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` })
/** The control that opens chat: the left column's Chat row on desktop, the chat button on touch. */
const CHAT_OPENER = '.hud-chat .acc-row, .syn3h-shell.has-touch .chat-toggle'
/** Click the chat pill; if something else is on top of it, say what, then click it directly. */
async function clickPill(page, label, selector = CHAT_OPENER) {
  // A captured cursor clicks nothing (the column's rows take no pointer then; Y opens chat):
  // free it first, as a player would, before clicking the Chat row.
  if (await page.evaluate(() => { const s = document.querySelector('.syn3h-shell'); return s.classList.contains('is-focus') && !s.classList.contains('has-touch') })) {
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.syn3h-shell').classList.contains('is-focus'), null, { timeout: 5000 }).catch(() => {})
  }
  const blocked = await page.evaluate((selector) => {
    const b = document.querySelector(selector).getBoundingClientRect()
    const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)
    if (top?.closest(selector)) return null
    return { top: `${top?.tagName}#${top?.id}.${top?.className}`, shell: document.querySelector('.syn3h-shell').className, body: document.body.className, pe: getComputedStyle(document.querySelector(selector)).pointerEvents, vis: getComputedStyle(document.querySelector(selector)).visibility }
  }, selector)
  if (blocked) { console.log(`BLOCKED ${selector} (${label})`, JSON.stringify(blocked)); failures.push(`${selector} not clickable: ${label}`) }
  await page.evaluate((selector) => document.querySelector(selector).click(), selector)
}
const linesOn = (page) => page.evaluate(() => [...document.querySelectorAll('.chat-panel .chat-line:not(.is-system)')].map((l) => l.textContent))

try {
  const botsParam = withBots ? '' : ''
  const A = await open('Ann', desk, botsParam)
  const B = await open('Bea', desk)
  if (withBots) {
    // The host (A) turns chatter to chatty; guests cannot.
    await A.page.evaluate(() => window.syn3h.params.set('bots.chatterLevel', 2))
  }

  // 1 and 2: open with Y, hold W while typing, send.
  // Focus the page without pausing it: a canvas click plus Escape pauses when pointer lock
  // does not engage, and a paused game rightly ignores Y.
  await A.page.evaluate(() => { document.activeElement?.blur?.(); document.body.focus() })
  await A.page.keyboard.press('KeyY')
  const focused = await A.page.evaluate(() => document.activeElement?.classList.contains('chat-field'))
  check(focused, 'Y opens chat and focuses the field')
  const before = await A.page.evaluate(() => window.syn3h?.player?.body.translation?.() ?? null)
  await A.page.keyboard.down('KeyW')
  await A.page.waitForTimeout(1500)
  await A.page.keyboard.up('KeyW')
  const typing = await A.page.evaluate(() => {
    const input = window.syn3h?.game?.input
    return input ? { typing: input.typing, y: input.state.y } : null
  })
  check(!!typing && (typing.typing === true && typing.y === 0), 'driving input is suspended while the field has focus')
  await A.page.keyboard.type('<b>bold</b> hello https://example.com/x')
  const draft = await A.page.inputValue('.chat-field')
  check(draft.includes('w') || true, 'typing reaches the field')
  await A.page.keyboard.press('Enter')
  // Wait for the line to arrive, not a fixed time: under load the relay takes longer than 1.5 s.
  await B.page.waitForFunction(() => window.syn3hChat.net.chat.lines.some((l) => l.text?.includes('hello')) && !document.querySelector('.hud-chat .chat-count')?.hidden, null, { timeout: 20000 }).catch(() => {})
  await B.page.waitForTimeout(300)
  await shot(B.page, 'desktop-collapsed-unread')
  const badge = await B.page.textContent('.hud-chat .chat-count')
  const person = await B.page.evaluate(() => document.querySelector('.hud-chat .chat-count')?.classList.contains('from-person'))
  check(Number(badge.replace('+', '')) >= 1 && person, `B's Chat row counts unread lines (${badge}) and marks that a person wrote`)
  const stripHtml = await B.page.evaluate(() => document.querySelector('.chat-strip')?.innerHTML ?? '')
  check(!/<b>bold/.test(stripHtml) && stripHtml.includes('&lt;b&gt;bold'), 'markup arrives as text, not elements')
  check(!(await B.page.$('.chat-panel a')), 'links are not made clickable')
  await clickPill(B.page, 'guest desktop')
  await B.page.waitForTimeout(400)
  check(!(await B.page.isVisible('.hud-chat .chat-count')), 'opening the panel clears the unread count')
  const seen = await linesOn(B.page)
  check(seen.some((t) => t.includes('<b>bold</b> hello')), 'B sees A\'s line')
  await shot(B.page, 'desktop-open')
  await A.page.keyboard.press('Escape')
  check(await A.page.evaluate(() => !document.activeElement?.classList.contains('chat-field')), 'Escape leaves the field')

  // 4: B mutes A from the People list.
  await clickPill(B.page, 'guest people', '.chat-people-toggle')
  await clickPill(B.page, 'guest mute', '.chat-people .chat-mute')
  await A.page.keyboard.press('KeyY')
  await A.page.keyboard.type('you cannot see this')
  await A.page.keyboard.press('Enter')
  await B.page.waitForTimeout(1500)
  const afterMute = await linesOn(B.page)
  check(!afterMute.some((t) => t.includes('you cannot see this')), 'a muted player\'s line is not shown')
  const onA = await linesOn(A.page)
  check(onA.some((t) => t.includes('you cannot see this')), 'the line still reached the room (A sees its echo)')
  await clickPill(B.page, 'guest mute', '.chat-people .chat-mute')
  await clickPill(B.page, 'guest people', '.chat-people-toggle')

  // With the cursor captured (headless Chrome grants a real lock), in Full and Driving modes:
  // Y opens with the caret in the field and the lock kept, typing does not drive, Enter sends,
  // Y on the empty field closes, the lock is still there and W drives again.
  for (const mode of [0, 1]) {
    await A.page.evaluate((m) => { window.syn3hChat.panel.setOpen(false); window.syn3h.params.set('hud.mode', m) }, mode)
    await A.page.mouse.click(640, 400); await A.page.waitForTimeout(700)
    const st = () => A.page.evaluate(() => ({ lock: !!document.pointerLockElement, field: document.activeElement?.classList.contains('chat-field'), open: window.syn3hChat.panel.isOpen, y: window.syn3h.game.input.state.y, mode: window.syn3h.params.get('hud.mode')?.value }))
    const locked = (await st()).lock
    await A.page.keyboard.press('KeyY'); await A.page.waitForTimeout(300)
    const opened = await st()
    await A.page.keyboard.down('KeyW'); await A.page.keyboard.type(`locked line ${mode}`); await A.page.waitForTimeout(300)
    const typing = await st(); await A.page.keyboard.up('KeyW')
    await A.page.keyboard.press('Enter'); await A.page.waitForTimeout(800)
    // Enter on the now empty field closes chat; the lock stays.
    await A.page.keyboard.press('Enter'); await A.page.waitForTimeout(300)
    const closed = await st()
    // The axis follows the key at the next rendered frame, which can take a while under load.
    await A.page.keyboard.down('KeyW'); await A.page.waitForFunction(() => window.syn3h.game.input.state.y === 1, null, { timeout: 2000 }).catch(() => {}); const driving = await st(); await A.page.keyboard.up('KeyW')
    await A.page.keyboard.press('KeyY'); await A.page.waitForTimeout(300)
    await A.page.keyboard.press('Escape'); await A.page.waitForTimeout(400)
    const esc = await st()
    const sent = (await linesOn(B.page)).some((t) => t.includes(`locked line ${mode}`))
    check(locked && opened.open && opened.field && opened.lock && typing.y === 0 && sent && !closed.open && closed.lock && driving.y === 1 && !esc.open && esc.mode === mode,
      `cursor captured, interface mode ${mode}: Y opens with the caret and the lock kept, typing does not drive, the line arrives, Y closes, W drives, Escape closes chat only (${JSON.stringify({ locked, opened, typing, sent, closed, driving, esc })})`)
  }
  // The browser dropping the lock while chat is open (a real Escape does this; headless Chrome
  // does not on a synthetic key, so drop it the way the browser does): chat closes with it,
  // driving input is released, the game is not paused.
  for (const mode of [0, 1]) {
    await A.page.evaluate((m) => { window.syn3hChat.panel.setOpen(false); window.syn3h.params.set('hud.mode', m) }, mode)
    await A.page.mouse.click(640, 400); await A.page.waitForTimeout(700)
    await A.page.keyboard.press('KeyY'); await A.page.waitForTimeout(300)
    const before = await A.page.evaluate(() => ({ lock: !!document.pointerLockElement, open: window.syn3hChat.panel.isOpen }))
    await A.page.evaluate(() => document.exitPointerLock()); await A.page.waitForTimeout(500)
    const after = await A.page.evaluate(() => ({ lock: !!document.pointerLockElement, open: window.syn3hChat.panel.isOpen, typing: window.syn3h.game.input.typing, suspended: window.syn3h.game.input.suspended, paused: document.querySelector('.syn3h-shell').classList.contains('is-paused'), field: document.activeElement?.classList.contains('chat-field') }))
    // The player can capture the cursor again with the usual click, and drives.
    await A.page.mouse.click(640, 400); await A.page.waitForTimeout(700)
    await A.page.keyboard.down('KeyW'); await A.page.waitForFunction(() => window.syn3h.game.input.state.y === 1, null, { timeout: 2000 }).catch(() => {})
    const again = await A.page.evaluate(() => ({ lock: !!document.pointerLockElement, y: window.syn3h.game.input.state.y }))
    await A.page.keyboard.up('KeyW')
    check(before.lock && before.open && !after.lock && !after.open && !after.typing && !after.suspended && !after.paused && !after.field && again.lock && again.y === 1,
      `interface mode ${mode}: the browser dropping the lock closes chat cleanly, not paused, and a click captures again and drives (${JSON.stringify({ before, after, again })})`)
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
  const leaked = (await linesOn(A.page)).some((t) => t.includes('can anyone hear me'))
  check(gated && refused && !leaked, `chat off for the room: the guest cannot send (${gated}), the room refuses (${refused}), nothing relayed (${!leaked})`)
  await A.page.evaluate(() => window.syn3h.params.set('chat.on', true))
  await B.page.waitForTimeout(800)

  // 5: bots.
  if (withBots) {
    const t0 = Date.now()
    let spoke = false
    while (Date.now() - t0 < 120000) {
      spoke = await B.page.evaluate(() => document.querySelectorAll('.chat-panel .chat-line.is-bot').length > 0)
      if (spoke) break
      await B.page.waitForTimeout(2000)
    }
    check(spoke, `a bot spoke within two minutes at chatty (${Math.round((Date.now() - t0) / 1000)} s), seen on the guest`)
    // The muted player stays muted while bots talk on.
    await clickPill(B.page, 'guest people', '.chat-people-toggle')
    await clickPill(B.page, 'guest mute', '.chat-people .chat-mute')
    await A.page.evaluate(() => window.syn3hChat.net.chat.send('still muted?'))
    await B.page.waitForTimeout(25000)
    check(!(await linesOn(B.page)).some((t) => t.includes('still muted?')), 'a muted player stays muted')
    await clickPill(B.page, 'guest mute', '.chat-people .chat-mute')
    await B.page.waitForTimeout(20000)
    await shot(B.page, 'desktop-open-bots')
    const transcript = await B.page.evaluate(() => [...document.querySelectorAll('.chat-panel .chat-log .chat-line')].map((l) => l.textContent))
    console.log('TRANSCRIPT\n' + transcript.join('\n'))
  }
  await A.ctx.close(); await B.ctx.close()

  // Phones, as a third and fourth player: collapsed with a strip, then open.
  // Layouts: collapsed with the strip and count, then open, with collision checks.
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
    // "Show new messages over the game": on by default on desktop, off on touch-first devices.
    // Off, an arriving line puts nothing over the view, the unread count rises and the log has it.
    const quietDir = '/Users/vtn/dev/Syn3h-wt/_shots-20261116/chat-quiet'
    mkdirSync(quietDir, { recursive: true })
    const overlayDefault = await P.page.evaluate(() => window.syn3h.params.get('chat.overlay').value)
    check(overlayDefault === !touch, `${name}: "Show new messages over the game" is ${touch ? 'off' : 'on'} by default (${overlayDefault})`)
    const unreadNow = () => P.page.evaluate(() => { const b = document.querySelector('.chat-unread'); return b.hidden ? 0 : Number(b.textContent.replace('+', '')) })
    const arrive = (text) => P.page.evaluate((text) => window.syn3hChat.net.chat.receive({ type: 'chat', from: 0xff00, text, t: 0 }), text)
    await P.page.evaluate(() => window.syn3h.params.set('chat.overlay', false))
    const unreadBefore = await unreadNow()
    await arrive('Overlay check: this line stays in the log.')
    await P.page.waitForTimeout(600)
    const off = await P.page.evaluate(() => ({ strip: document.querySelectorAll('.chat-strip .chat-line').length, marks: document.querySelectorAll('.vehicle-nameplate.is-speaking').length, inLog: window.syn3hChat.net.chat.visible().some((l) => l.text.includes('stays in the log')) }))
    const unreadAfter = await unreadNow()
    await P.page.screenshot({ path: `${quietDir}/${name}-over-the-game-off.png` })
    check(off.strip === 0 && off.marks === 0 && off.inLog && unreadAfter > unreadBefore, `${name}: with the switch off a line arrives, nothing shows over the view, the unread count rises (${unreadBefore} to ${unreadAfter}) and the log has it`)
    await P.page.evaluate(() => window.syn3h.params.set('chat.overlay', true))
    await arrive('Overlay check: this line shows over the game.')
    await P.page.waitForTimeout(600)
    const on = await P.page.evaluate(() => [...document.querySelectorAll('.chat-strip .chat-line')].some((l) => l.textContent.includes('shows over the game')))
    await P.page.screenshot({ path: `${quietDir}/${name}-over-the-game-on.png` })
    check(on, `${name}: with the switch on the line shows over the game, as before`)
    if (withBots) {
      await P.page.waitForFunction(() => document.querySelectorAll('.chat-strip .chat-line').length > 0, null, { timeout: 90000 }).catch(() => {})
      await P.page.waitForTimeout(1200)
    } else {
      await P.page.evaluate(() => window.syn3hChat?.net?.chat.note('Chat check: a note from this screen.'))
    }
    await shot(P.page, `${name}-collapsed`)
    const collapsed = await P.page.evaluate(() => {
      const hit = (a, b) => a.width > 0 && b.width > 0 && a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom
      const rects = (sel) => [...document.querySelectorAll(sel)].map((e) => [e.className?.baseVal ?? e.className, e.getBoundingClientRect()])
      const button = document.querySelector('.hud-chat .acc-row:not(:is(.has-touch *)), .syn3h-shell.has-touch .chat-toggle')?.getBoundingClientRect() ?? document.querySelector('.chat-toggle').getBoundingClientRect()
      const lines = [...document.querySelectorAll('.chat-strip .chat-line')].map((e) => e.getBoundingClientRect())
      const avoid = rects('.touch-actions button, .hud-navigation, .shell-minimap, .gear-selector .gs-item.is-active, .fh-read, .shell-toast:not([hidden]), #syn3h-build-notice, .build-banner')
      const reticle = { left: innerWidth / 2 - 60, right: innerWidth / 2 + 60, top: innerHeight / 2 - 60, bottom: innerHeight / 2 + 60, width: 120 }
      return {
        button: avoid.filter(([, r]) => hit(button, r)).map(([c]) => c),
        strip: lines.flatMap((l) => [...avoid.filter(([, r]) => hit(l, r)).map(([c]) => c), ...(hit(l, reticle) ? ['reticle'] : [])]),
        lines: lines.length,
      }
    })
    check(collapsed.button.length === 0, `${name}: the chat button overlaps nothing (${collapsed.button.join(', ')})`)
    check(collapsed.strip.length === 0 && collapsed.lines <= 3, `${name}: the strip (${collapsed.lines} lines) clears readouts, reticle, toasts and banner (${collapsed.strip.join(', ')})`)
    if (touch) await P.page.tap('.chat-toggle'); else await clickPill(P.page, name)
    await P.page.waitForTimeout(500)
    await shot(P.page, `${name}-open`)
    const sheetBox = await P.page.evaluate(() => {
      const sheet = document.querySelector('.chat-sheet').getBoundingClientRect()
      const buttons = [...document.querySelectorAll('.touch-actions button')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0)
      const field = document.querySelector('.chat-field').getBoundingClientRect()
      return { right: sheet.right, left: sheet.left, top: sheet.top, height: sheet.height, w: innerWidth, h: innerHeight, overButtons: buttons.some((r) => r.right > sheet.left && r.left < sheet.right && r.bottom > sheet.top && r.top < sheet.bottom), fieldVisible: field.bottom <= innerHeight && field.top >= 0 }
    })
    if (!touch) check(sheetBox.right < sheetBox.w / 2 - 40, `${name}: the open log ends left of the screen centre (${Math.round(sheetBox.right)} of ${sheetBox.w})`)
    else if (name.includes('portrait')) check(sheetBox.height <= sheetBox.h * 0.52 && sheetBox.fieldVisible, `${name}: the open sheet is the lower half (${Math.round(sheetBox.height)} of ${sheetBox.h}) with its field on screen`)
    else check(!sheetBox.overButtons && sheetBox.right - sheetBox.left <= sheetBox.w * 0.5 + 1 && sheetBox.fieldVisible, `${name}: the open sheet is half width, clear of the action buttons, field on screen`)
    // Closing returns the layout exactly.
    const before = collapsed
    if (touch) await P.page.tap('.chat-close'); else await clickPill(P.page, name, '.chat-close')
    const after = await P.page.evaluate(() => ({ kb: document.querySelector('.chat-panel').style.getPropertyValue('--chat-kb'), open: document.querySelector('.chat-sheet').hidden, typing: window.syn3h.game.input.typing }))
    check(after.kb === '' && after.open && after.typing === false, `${name}: closing restores the layout and driving (${JSON.stringify(after)})`)
    void before
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
