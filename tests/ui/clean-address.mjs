// The public room never appears as ?room= anywhere a person can see or copy.
//   SYN3H_URL=http://127.0.0.1:<port>/ tools/heavy.sh node tests/ui/clean-address.mjs
// Needs the dev room server behind vite's /ws proxy. One browser, closed at the end.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'

const base = process.env.SYN3H_URL
assert.ok(base, 'SYN3H_URL is required')
const results = []
const pass = name => { results.push(name); console.log(`ok  ${name}`) }
const roomOf = href => new URL(href).searchParams.get('room')

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  const page = await context.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  // Every address the bar ever holds, so a brief room=lobby cannot slip past a poll.
  await page.addInitScript(() => {
    window.__addresses = [location.href]
    for (const name of ['pushState', 'replaceState']) {
      const original = history[name].bind(history)
      history[name] = (...args) => { const result = original(...args); window.__addresses.push(location.href); return result }
    }
  })
  const addresses = () => page.evaluate(() => window.__addresses)
  const booted = () => page.waitForFunction(() => window.syn3h?.game.tick > 10 && window.syn3h.shell, null, { timeout: 120000 })
  const enter = async () => {
    await page.evaluate(() => syn3h.shell.play())
    await page.waitForFunction(() => syn3h.shell.playing && window.syn3hNet?.connected, null, { timeout: 120000 })
  }
  const world = () => page.evaluate(() => ({ seed: syn3h.params.get('world.seed').value, planet: syn3h.planets.currentPlanet().id }))
  /** The string the QR encodes: read the rendered modules and find the text whose encoding they are. */
  const qrText = () => page.evaluate(async () => {
    const svg = document.querySelector('.join-view .invite-qr svg'), d = svg.querySelector('path').getAttribute('d')
    const dark = new Set([...d.matchAll(/M(\d+),(\d+)/g)].map(m => `${m[1] - 4},${m[2] - 4}`))
    const { encodeQr } = await import('/src/ui/QrCode.ts')
    const shown = document.querySelector('.join-view .invite-link').textContent
    const matches = text => { const m = encodeQr(text).modules; return m.every((row, y) => row.every((on, x) => on === dark.has(`${x},${y}`))) }
    // The visible link, and the same link with the room parameter it must not carry.
    const withRoom = new URL(shown); withRoom.searchParams.set('room', 'lobby')
    return { shown, decoded: matches(shown) ? shown : matches(withRoom.href) ? withRoom.href : null }
  })

  // 1. The galaxy lobby has no query.
  await page.goto(base); await booted()
  assert.equal(new URL(page.url()).search, ''); pass('galaxy lobby address has no query')

  // 2. Entering a world in the public room adds no room parameter. Pick a world that is not the
  // default, so the reload below cannot pass by landing on the default world.
  const seed = 1000 + Math.floor(Math.random() * 90000)
  await page.evaluate(seed => syn3h.planets.applyPlanet('alpine', seed), seed)
  await enter()
  assert.deepEqual(await world(), { seed, planet: 'alpine' }, 'the empty public room took this world')
  assert.equal(roomOf(page.url()), null, page.url())
  assert.equal(await page.evaluate(() => syn3hNet.ctx.room), 'lobby', 'still joins the public room internally')
  const before = await world()
  pass(`entering a world in the public room leaves no room parameter (${page.url()})`)

  // 4. Invite: link and QR without a room parameter, described in words.
  await page.evaluate(() => syn3h.shell.openJoin())
  const invite = await qrText()
  assert.equal(roomOf(invite.shown), null, invite.shown)
  assert.equal(invite.decoded, invite.shown, 'QR encodes exactly the shown link')
  assert.ok(new URL(invite.shown).searchParams.get('world'), 'invite carries the world')
  const words = await page.locator('.join-view').evaluate(el => ({ h1: el.querySelector('h1').textContent, room: el.querySelector('.join-room').textContent }))
  assert.equal(words.room, 'Public room'); assert.doesNotMatch(words.h1 + words.room, /lobby/i)
  pass(`invite link and decoded QR have no room parameter (${invite.decoded}; "${words.h1}", "${words.room}")`)
  await page.keyboard.press('Escape').catch(() => {})
  await page.evaluate(() => syn3h.shell.invite?.hide?.())

  // 3. Reloading in the world returns to the same world (the tab's saved session).
  await page.waitForTimeout(2500)
  await page.reload(); await booted()
  assert.equal(new URL(page.url()).search, '', 'reloaded lobby is clean')
  await enter()
  assert.deepEqual(await world(), before)
  assert.equal(roomOf(page.url()), null)
  pass(`reloading in the world returns to the same world (${before.planet} ${before.seed})`)
  assert.ok(!(await addresses()).some(href => roomOf(href) !== null), 'no address in this session carried a room')

  // 5. An old ?room=lobby link joins the public room and cleans the address.
  await page.goto(`${base}?room=lobby&world=volcanic.1`); await booted()
  assert.equal(roomOf(page.url()), null, page.url())
  await enter()
  assert.equal(await page.evaluate(() => syn3hNet.ctx.room), 'lobby')
  assert.equal(roomOf(page.url()), null, page.url())
  assert.equal((await addresses()).filter(href => roomOf(href) !== null).length, 1, 'only the typed entry address had it')
  pass('an old ?room=lobby link joins the public room and cleans the address')

  // 6. Owner flags never bring room=lobby back, through play, invite, menu and back.
  await page.goto(`${base}?wordmark=7&intro=2`); await booted()
  await enter()
  await page.evaluate(() => syn3h.shell.openJoin())
  const flagged = await qrText()
  await page.evaluate(() => { syn3h.shell.invite?.hide?.(); syn3h.shell.openMenu() })
  await page.evaluate(() => syn3h.shell.closeMenu())
  const seen = await addresses()
  assert.ok(seen.every(href => roomOf(href) === null), seen.join('\n'))
  assert.equal(new URL(page.url()).searchParams.get('wordmark'), '7')
  assert.equal(roomOf(flagged.decoded), null)
  pass(`?wordmark=7&intro=2 never brings room=lobby (in play: ${page.url()})`)

  // 7. A private room keeps its parameter in the bar and the invite.
  const party = `party-${Date.now()}`
  await page.goto(`${base}?room=${party}`); await booted()
  await enter()
  assert.equal(roomOf(page.url()), party)
  await page.evaluate(() => syn3h.shell.openJoin())
  const privateInvite = await qrText()
  assert.equal(roomOf(privateInvite.decoded), party)
  assert.equal(await page.locator('.join-view .join-room').textContent(), party)
  pass(`a private room keeps its parameter (${page.url()})`)

  // 8. A pinned ?v= link stays pinned in play and in the invite.
  await page.goto(`${base}?v=26.11.1605`); await booted()
  assert.equal(new URL(page.url()).search, '', 'lobby itself is clean')
  await enter()
  assert.equal(new URL(page.url()).searchParams.get('v'), '26.11.1605')
  await page.evaluate(() => syn3h.shell.openJoin())
  const pinned = await qrText()
  assert.equal(new URL(pinned.decoded).searchParams.get('v'), '26.11.1605')
  assert.equal(roomOf(pinned.decoded), null)
  pass(`a pinned ?v= link stays pinned (${page.url()}, invite ${pinned.decoded})`)

  console.log(`${results.length}/8 passed`)
  if (errors.length) console.log('page errors (not asserted):', errors.slice(0, 5))
} finally {
  await browser.close()
}
