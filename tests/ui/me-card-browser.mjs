// The Me card in a real browser: linked and saved names, the vehicle picker by mouse and by
// keyboard, Randomize three times with frames across one change, and a second player seeing
// the name and colours change. Run through tools/heavy.sh against a running dev server:
//   tools/heavy.sh node tests/ui/me-card-browser.mjs http://127.0.0.1:5447 /tmp/me-card
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const base = process.argv[2] ?? 'http://127.0.0.1:5173'
const out = process.argv[3] ?? '/tmp/me-card'
await mkdir(out, { recursive: true })
const room = `mecard-${Date.now().toString(36)}`
const report = { room, errors: [], steps: [] }
const step = (name, value) => { report.steps.push({ name, value }); console.log(name, JSON.stringify(value)) }
let browser
// Daydream (the idle autopilot) hides the panels; this check sits still for long stretches.
const ready = async page => {
  await page.waitForFunction(() => window.syn3h?.game.tick > 60 && window.syn3hNet?.connected, null, { timeout: 180000 })
  await page.evaluate(() => window.syn3h.params.set('daydream.seconds', 0))
}
const meCard = '.wi-card[data-section="you"]'
async function openMe(page) {
  await page.waitForFunction(() => window.syn3h.shell.playing && !window.syn3h.shell.transitioning, null, { timeout: 90000 })
  await page.evaluate(() => window.syn3h.shell.showCard('you'))
  const card = page.locator(meCard)
  // The panels appear once the arrival has finished, which a loaded machine can stretch.
  await card.waitFor({ state: 'visible', timeout: 90000 })
  if (!(await card.evaluate(c => c.classList.contains('is-open')))) await card.locator('.wi-head').click()
  await page.waitForTimeout(600)
}
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
  const contextA = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await contextA.addInitScript(() => {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return
    if (localStorage.getItem('syn3h.playerName') === null) {
      localStorage.setItem('syn3h.playerName', 'Captain Ozzie')
      localStorage.setItem('syn3h.playerNameSource', 'typed')
    }
  })
  const a = await contextA.newPage()
  a.on('pageerror', e => report.errors.push(`A: ${e.message}`))
  const entry = `${base}/?autoplay=1&room=${room}`
  await a.goto(`${entry}&name=${encodeURIComponent(' <Link>  Pilot ')}`, { waitUntil: 'load' })
  await ready(a)
  await a.evaluate(() => window.syn3h.params.set('bots.count', 0))
  await openMe(a)
  // The tank is hidden: three segments.
  step('segments', await a.locator('.wi-vehicle-option').evaluateAll(b => b.map(x => x.textContent)))
  assert.deepEqual(await a.locator('.wi-vehicle-option').evaluateAll(b => b.map(x => x.textContent)), ['Buggy', 'Jet', 'Hovercraft'])
  await a.locator(meCard).screenshot({ path: `${out}/desktop-expanded.png` })

  // The linked name is shared by the card, vehicle and room without saving it over the preference.
  assert.equal(await a.locator('.wi-name-input').inputValue(), 'Link Pilot')
  assert.deepEqual(await a.evaluate(() => [
    window.syn3h.player.name,
    window.syn3hNet.players.get(window.syn3hNet.id)?.name,
    localStorage.getItem('syn3h.playerName'),
  ]), ['Link Pilot', 'Link Pilot', 'Captain Ozzie'])

  // Typing the already saved name must replace the link name locally and in the room.
  await a.locator('.wi-name-input').click()
  await a.keyboard.press('Meta+A'); await a.keyboard.type('Captain Ozzie'); await a.keyboard.press('Enter')
  step('saved name', await a.evaluate(() => localStorage.getItem('syn3h.playerName')))
  assert.equal(await a.evaluate(() => localStorage.getItem('syn3h.playerName')), 'Captain Ozzie')
  assert.equal(await a.evaluate(() => window.syn3h.player.name), 'Captain Ozzie')
  await a.waitForFunction(() => window.syn3hNet.players.get(window.syn3hNet.id)?.name === 'Captain Ozzie')
  // Escape cancels an edit.
  await a.locator('.wi-name-input').click(); await a.keyboard.type('xyz'); await a.keyboard.press('Escape')
  assert.equal(await a.locator('.wi-name-input').inputValue(), 'Captain Ozzie')
  await a.goto(entry, { waitUntil: 'load' }); await ready(a); await openMe(a)
  step('name after ordinary entry', await a.locator('.wi-name-input').inputValue())
  assert.equal(await a.locator('.wi-name-input').inputValue(), 'Captain Ozzie')

  // A second player in the same room sees the name, then a rename.
  const contextB = await browser.newContext({ viewport: { width: 900, height: 700 } })
  const b = await contextB.newPage()
  b.on('pageerror', e => report.errors.push(`B: ${e.message}`))
  await b.goto(`${base}/?autoplay=1&room=${room}`, { waitUntil: 'load' })
  await ready(b)
  const idA = await a.evaluate(() => window.syn3hNet.id)
  const nameOnB = () => b.evaluate(id => window.syn3hNet.players.get(id)?.name, idA)
  await b.waitForFunction(id => window.syn3hNet.players.get(id)?.name === 'Captain Ozzie', idA, { timeout: 20000 })
  step('B sees', await nameOnB())
  await a.waitForTimeout(2100)
  await a.locator('.wi-name-roll').click()
  const rolled = await a.locator('.wi-name-input').inputValue()
  const renamedAt = Date.now()
  await b.waitForFunction(([id, name]) => window.syn3hNet.players.get(id)?.name === name, [idA, rolled], { timeout: 10000 })
  step('rolled name reaches B (ms)', { rolled, ms: Date.now() - renamedAt })

  // Vehicle picker by mouse, then by keyboard.
  for (const label of ['Jet', 'Hovercraft', 'Buggy']) {
    await a.locator('.wi-vehicle-option', { hasText: label }).click(); await a.waitForTimeout(800)
    step(`mouse ${label}`, await a.evaluate(() => [window.syn3h.player.kind, document.querySelector('.wi-vehicle-option[aria-checked=true]')?.textContent]))
  }
  assert.match(await a.evaluate(() => window.syn3h.player.kind), /^buggy/)
  await a.locator('.wi-vehicle-option[aria-checked=true]').focus()
  await a.keyboard.press('ArrowRight'); await a.waitForTimeout(800)
  step('key right', await a.evaluate(() => [window.syn3h.player.kind, document.activeElement?.textContent]))
  assert.equal(await a.evaluate(() => window.syn3h.player.kind), 'jet')
  await a.keyboard.press('End'); await a.waitForTimeout(800)
  assert.equal(await a.evaluate(() => window.syn3h.player.kind), 'hovercraft')
  await a.keyboard.press('ArrowRight'); await a.waitForTimeout(800)
  step('key wraps', await a.evaluate(() => window.syn3h.player.kind))
  assert.match(await a.evaluate(() => window.syn3h.player.kind), /^buggy/)

  // Randomize three times; frames across the third change, locally and on B.
  const sample = page => page.evaluate(() => ({ ...window.syn3h.player.colors }))
  const remote = () => b.evaluate(id => ({ ...window.syn3hNet.remotes.get(id)?.vehicle.colors }), idA)
  for (let press = 1; press <= 3; press++) {
    await a.locator('.wi-randomize').click()
    const frames = []
    const t0 = Date.now()
    for (let f = 0; f < 6; f++) {
      // On the third press, frames of the colours row (small, so quick) across the change.
      if (press === 3) await a.locator('.wi-vehicle').screenshot({ path: `${out}/randomize-${f}.png`, animations: 'allow' })
      frames.push({ ms: Date.now() - t0, a: await sample(a), seenOnB: await remote() })
      await a.waitForTimeout(press === 3 ? 60 : 220)
    }
    step(`randomize ${press}`, frames)
  }
  const final = await sample(a)
  await b.waitForFunction(([id, body]) => window.syn3hNet.remotes.get(id)?.vehicle.colors.body === body, [idA, final.body], { timeout: 5000 })
  step('saved tint', await a.evaluate(() => localStorage.getItem('syn3h.vehicle')))

  // Collapsed header.
  await a.locator(`${meCard} .wi-head`).click(); await a.waitForTimeout(600)
  await a.locator(`${meCard} .wi-head`).screenshot({ path: `${out}/desktop-collapsed.png` })
  await a.screenshot({ path: `${out}/desktop-page.png` })
  await contextB.close()
  await contextA.close()

  // Phone.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const p = await phone.newPage()
  p.on('pageerror', e => report.errors.push(`phone: ${e.message}`))
  await p.goto(`${base}/?autoplay=1&room=${room}-phone`, { waitUntil: 'load' })
  await ready(p)
  await p.locator('.inspector-toggle').tap().catch(() => p.locator('.inspector-toggle').click())
  await openMe(p)
  const fits = await p.locator('.wi-vehicle-picker').evaluate(g => ({ clipped: [...g.querySelectorAll('span')].filter(s => s.scrollWidth > s.clientWidth).map(s => s.textContent), width: g.getBoundingClientRect().width, scroll: g.scrollWidth, client: g.clientWidth, heights: [...g.children].map(c => Math.round(c.getBoundingClientRect().height)), rows: new Set([...g.children].map(c => Math.round(c.getBoundingClientRect().top))).size }))
  step('phone picker', fits)
  assert.deepEqual(fits.clipped, []); assert.equal(fits.rows, 1); assert.ok(fits.scroll <= fits.client + 1); assert.ok(fits.heights.every(h => h >= 44))
  await p.locator(meCard).screenshot({ path: `${out}/phone-expanded.png` })
  await p.screenshot({ path: `${out}/phone-page.png` })
  await p.locator(`${meCard} .wi-head`).click(); await p.waitForTimeout(600)
  await p.locator(`${meCard} .wi-head`).screenshot({ path: `${out}/phone-collapsed.png` })
  await phone.close()
  assert.deepEqual(report.errors, [])
} catch (e) {
  report.failure = String(e?.stack ?? e); process.exitCode = 1
  for (const context of browser?.contexts() ?? []) for (const [i, page] of context.pages().entries()) await page.screenshot({ path: `${out}/failure-${i}.png` }).catch(() => {})
} finally {
  await browser?.close()
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  if (report.failure) console.log('FAILED', report.failure)
}
