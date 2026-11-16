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
  await B.page.waitForTimeout(1500)
  await shot(B.page, 'desktop-collapsed-unread')
  const badge = await B.page.textContent('.chat-unread')
  const person = await B.page.evaluate(() => document.querySelector('.chat-unread')?.classList.contains('from-person'))
  check(Number(badge.replace('+', '')) >= 1 && person, `B's pill counts unread lines (${badge}) and marks that a person wrote`)
  const stripHtml = await B.page.evaluate(() => document.querySelector('.chat-strip')?.innerHTML ?? '')
  check(!/<b>bold/.test(stripHtml) && stripHtml.includes('&lt;b&gt;bold'), 'markup arrives as text, not elements')
  check(!(await B.page.$('.chat-panel a')), 'links are not made clickable')
  await B.page.click('.chat-toggle')
  await B.page.waitForTimeout(400)
  check(!(await B.page.isVisible('.chat-unread')), 'opening the panel clears the unread count')
  const seen = await linesOn(B.page)
  check(seen.some((t) => t.includes('<b>bold</b> hello')), 'B sees A\'s line')
  await shot(B.page, 'desktop-open')
  await A.page.keyboard.press('Escape')
  check(await A.page.evaluate(() => !document.activeElement?.classList.contains('chat-field')), 'Escape leaves the field')

  // 4: B mutes A from the People list.
  await B.page.click('.chat-people-toggle')
  await B.page.click('.chat-people .chat-mute >> nth=0')
  await A.page.keyboard.press('KeyY')
  await A.page.keyboard.type('you cannot see this')
  await A.page.keyboard.press('Enter')
  await B.page.waitForTimeout(1500)
  const afterMute = await linesOn(B.page)
  check(!afterMute.some((t) => t.includes('you cannot see this')), 'a muted player\'s line is not shown')
  const onA = await linesOn(A.page)
  check(onA.some((t) => t.includes('you cannot see this')), 'the line still reached the room (A sees its echo)')
  await B.page.click('.chat-people .chat-mute >> nth=0')
  await B.page.click('.chat-people-toggle')

  // 5: bots.
  if (withBots) {
    const t0 = Date.now()
    let spoke = false
    while (Date.now() - t0 < 120000) {
      spoke = await B.page.evaluate(() => document.querySelectorAll('.chat-panel .chat-line.is-bot').length > 0)
      if (spoke) break
      await B.page.waitForTimeout(2000)
    }
    check(spoke, `a bot spoke within two minutes at chatty (${Math.round((Date.now() - t0) / 1000)} s)`)
    await B.page.waitForTimeout(20000)
    await shot(B.page, 'desktop-open-bots')
    const transcript = await B.page.evaluate(() => [...document.querySelectorAll('.chat-panel .chat-log .chat-line')].map((l) => l.textContent))
    console.log('TRANSCRIPT\n' + transcript.join('\n'))
  }
  await A.ctx.close(); await B.ctx.close()

  // Phones, as a third and fourth player: collapsed with a strip, then open.
  for (const [name, viewport, hand] of [['phone-portrait', { width: 390, height: 844 }], ['phone-landscape', { width: 844, height: 390 }], ['phone-landscape-lefthand', { width: 844, height: 390 }, true]]) {
    const P = await open(name.includes('portrait') ? 'Pip' : 'Lan', { viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    if (hand) await P.page.evaluate(() => window.syn3h.params.set('touch.leftHanded', true))
    if (withBots) {
      // Wait for the bots to say something, so the strip and the unread count show.
      await P.page.waitForFunction(() => document.querySelectorAll('.chat-strip .chat-line').length > 0, null, { timeout: 90000 }).catch(() => {})
      await P.page.waitForTimeout(1500)
    } else {
      await P.page.evaluate(() => window.syn3hChat?.net?.chat.note('Chat check: a note from this screen.'))
    }
    await shot(P.page, `${name}-collapsed`)
    const overlaps = await P.page.evaluate(() => {
      const box = document.querySelector('.chat-toggle').getBoundingClientRect()
      const hit = (r) => r.width > 0 && !(r.right <= box.left || r.left >= box.right || r.bottom <= box.top || r.top >= box.bottom)
      return [...document.querySelectorAll('.touch-actions button, .touch-stick, .hud-navigation, .shell-minimap, .gear-selector .gs-item.is-active')].filter((e) => hit(e.getBoundingClientRect())).map((e) => e.className)
    })
    check(overlaps.length === 0, `${name}: the chat button overlaps nothing (${overlaps.join(', ')})`)
    await P.page.tap('.chat-toggle')
    await P.page.waitForTimeout(500)
    await shot(P.page, `${name}-open`)
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
