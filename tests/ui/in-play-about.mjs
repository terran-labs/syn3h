// SOURCE-PREPARED, UNRUN. Separate allocation and dedicated app/room launcher required.
// Native Chrome mouse/keyboard; touch context is emulation, not physical hardware.
// The four-slice input gate remains a prerequisite, not replaced by this fixture.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../', import.meta.url))
const origin = process.env.SYN3H_URL, expected = process.env.UX_SOURCE_SHA, out = process.env.UX_EVIDENCE_DIR
assert.ok(origin && expected && out && process.env.UX_LAUNCH_MANIFEST)
const launch = JSON.parse(await readFile(process.env.UX_LAUNCH_MANIFEST, 'utf8'))
assert.equal(launch.head, expected); assert.equal(launch.origin, origin)
assert.equal(launch.env.SYN3H_NO_ROOM_SERVER, '1')
assert.ok(launch.roomPort !== 8787 && launch.roomPid && launch.vitePid)
const deadline = Date.now() + 480000
const budget = cap => { const ms = Math.min(cap, deadline - Date.now()); assert.ok(ms > 0, 'absolute fixture deadline'); return ms }
const bounded = async (promise, cap = 10000) => {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('bounded operation expired')), budget(cap)) })]) }
  finally { clearTimeout(timer) }
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const report = { source: expected, cases: [], errors: [], limits: ['No physical touch or gamepad-neutral proof', 'No Yoink/native-chord replacement for prerequisite input gate', 'No image assets added', 'Late pointer-lock promise race and real OS visibility require later native validation', 'Synthetic PauseState lifecycle transitions are not native OS visibility'] }
let browser, primary
const pages = [], pending = []
await mkdir(out, { recursive: true })
async function provenance() {
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: budget(5000) }).trim(), expected)
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', timeout: budget(5000) }).trim(), '')
  const result = []
  for (const path of ['src/ui/Shell.ts', 'src/ui/shell.css', 'src/ui/data/credits.ts', 'src/main.ts', 'src/core/Input.ts', 'src/weapons/Gear.ts']) {
    const local = await readFile(new URL(path, new URL('../../', import.meta.url)))
    const response = await fetch(new URL(`/${path}?raw`, origin), { signal: AbortSignal.timeout(budget(10000)) })
    assert.equal(response.status, 200)
    const text = await bounded(response.text())
    const literal = text.match(/^export default ("(?:[^"\\]|\\.)*")/m)
    assert.ok(literal, path); assert.equal(JSON.parse(literal[1]), local.toString())
    result.push({ path, sha256: hash(local) })
  }
  return result
}
const state = page => page.evaluate(() => ({ url: location.href, id: syn3hNet.id, host: syn3hNet.isHost,
  connected: syn3hNet.connected, playing: syn3h.shell.playing, menu: syn3h.shell.menuOpen,
  paused: syn3h.pause.paused, reason: syn3h.pause.reason, tick: syn3h.game.tick,
  suspended: syn3h.game.input.suspended, locked: !!document.pointerLockElement,
  sent: syn3hNet.bigRed.stats.sent, fizzled: syn3hNet.bigRed.stats.fizzled }))
const ready = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: budget(15000) })
try {
  report.provenance = await provenance()
  browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: budget(30000) })
  for (const touch of [false, true]) {
    const context = await bounded(browser.newContext({ hasTouch: touch, viewport: touch ? { width: 390, height: 640 } : { width: 1280, height: 900 }, serviceWorkers: 'block' }))
    const page = await bounded(context.newPage()); pages.push(page)
    for (const [object, names] of [[page, ['evaluate']], [page.keyboard, ['down', 'up', 'press']]]) {
      for (const name of names) { const original = object[name].bind(object); object[name] = (...args) => bounded(original(...args), 15000) }
    }
    page.setDefaultTimeout(10000)
    const sockets = [], images = [], documents = [], modules = []
    page.on('websocket', ws => { sockets.push(ws.url()); ws.on('framereceived', ({ payload }) => {
      try { if (['update', 'full-reload', 'prune'].includes(JSON.parse(String(payload)).type)) report.errors.push('HMR changed source') } catch {}
    }) })
    page.on('pageerror', error => report.errors.push(String(error)))
    page.on('request', request => { if (request.resourceType() === 'image') images.push(request.url()) })
    page.on('response', response => {
      const path = new URL(response.url()).pathname
      if (response.request().resourceType() !== 'document' && path !== '/src/ui/Shell.ts') return
      pending.push((async () => {
        assert.equal(response.status(), 200); assert.equal(response.fromServiceWorker(), false)
        const bytes = await bounded(response.body())
        if (path === '/src/ui/Shell.ts') {
          const map = bytes.toString().match(/sourceMappingURL=data:application\/json(?:;charset=[^;,]+)?;base64,([^\s]+)/)
          assert.ok(map); assert.ok(JSON.parse(Buffer.from(map[1], 'base64')).sourcesContent.includes(await readFile(new URL('../../src/ui/Shell.ts', import.meta.url), 'utf8')))
          modules.push(hash(bytes))
        } else documents.push({ url: response.url(), sha256: hash(bytes) })
      })().catch(error => report.errors.push(String(error))))
    })
    const url = new URL(origin); url.searchParams.set('room', `ux-guide-${touch}-${Date.now()}`)
    url.searchParams.set('world', 'alpine.1518~bots.count=0')
    await page.goto(url.href, { timeout: budget(60000) })
    await ready(page, () => window.syn3h?.shell?.galaxy?.live)
    await page.locator('.galaxy-label.is-current').focus(); await page.keyboard.press('Enter')
    await ready(page, () => window.syn3hNet?.connected && syn3h.shell.playing && !syn3h.shell.dropping)
    if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
    if (touch) await page.locator('.inspector-toggle').click()
    const session = page.locator('.rail-players')
    if (!await session.evaluate(el => el.open)) await session.locator('summary').click()
    const entry = page.locator('.rail-about'), dialog = page.locator('.in-play-about')
    await entry.focus()
    // Native held fire. Real charge, no pending-state seeding or direct cancel call.
    const digit = await page.evaluate(() => syn3hNet.gear.list().indexOf('red') + 1)
    assert.ok(digit > 0); await page.keyboard.press(`Digit${digit}`)
    await ready(page, () => syn3hNet.gear.current === 'red')
    await entry.focus(); await page.keyboard.down('KeyL')
    await ready(page, () => syn3hNet.bigRed.ready)
    const before = await state(page), socketCount = sockets.length
    // Transparent call/return observer: each original is invoked once with this/args.
    await page.evaluate(() => {
      const restorers = [], order = []
      for (const [object, key] of [[syn3hNet.gear, 'cancelActions'], [syn3h.game.input, 'cancelFireUntilNeutral']]) {
        const own = Object.getOwnPropertyDescriptor(object, key), original = object[key]
        object[key] = function (...args) { order.push({ key, suspended: syn3h.game.input.suspended }); return original.apply(this, args) }
        restorers.push(() => own ? Object.defineProperty(object, key, own) : delete object[key])
      }
      window.guideTrace = { order, restore() { restorers.reverse().forEach(fn => fn()) } }
      const last = [...syn3h.game.systems].reverse().find(system => typeof system.postPhysics === 'function')
      if (!last) throw new Error('Normal post-physics hook unavailable')
      const own = Object.getOwnPropertyDescriptor(last, 'postPhysics'), original = last.postPhysics
      last.postPhysics = function (...args) {
        const result = original.apply(this, args)
        if (guideTrace.immediate && !guideTrace.firstStep) guideTrace.firstStep = {
          sent: syn3hNet.bigRed.stats.sent, fizzled: syn3hNet.bigRed.stats.fizzled, fire: syn3h.game.input.state.fire }
        return result
      }
      restorers.push(() => own ? Object.defineProperty(last, 'postPhysics', own) : delete last.postPhysics)
      document.querySelector('.rail-about').addEventListener('click', () => queueMicrotask(() => {
        guideTrace.immediate = { fire: syn3h.game.input.state.fire, sent: syn3hNet.bigRed.stats.sent, suspended: syn3h.game.input.suspended }
      }), { once: true })
    })
    await entry.click(); await dialog.waitFor({ state: 'visible' })
    const trace = await page.evaluate(() => ({ order: guideTrace.order, immediate: guideTrace.immediate }))
    assert.deepEqual(trace.order.slice(0, 2).map(x => x.key), ['cancelActions', 'cancelFireUntilNeutral'])
    assert.ok(trace.order.slice(0, 2).every(x => !x.suspended))
    assert.equal(trace.immediate.fire, false); assert.equal(trace.immediate.sent, before.sent)
    await ready(page, tick => syn3h.game.tick > tick, before.tick)
    await ready(page, () => !!guideTrace.firstStep)
    const firstStep = await page.evaluate(() => guideTrace.firstStep)
    assert.deepEqual(firstStep, { sent: before.sent, fizzled: before.fizzled, fire: false })
    const opened = await state(page)
    assert.equal(opened.sent, before.sent); assert.equal(opened.fizzled, before.fizzled)
    assert.equal(opened.url, before.url); assert.equal(opened.id, before.id); assert.equal(opened.host, before.host)
    assert.ok(opened.connected && opened.playing && !opened.menu && !opened.paused && opened.suspended && !opened.locked)
    assert.equal(sockets.length, socketCount)
    assert.equal(await dialog.locator('a[href*="/brand/licenses/"]').count(), 10)
    const licences = await page.evaluate(() => {
      const hrefs = selector => [...document.querySelectorAll(selector)].map(a => a.getAttribute('href')).sort()
      return { modal: hrefs('.in-play-about a[href*="/brand/licenses/"]'), lobby: hrefs('[data-panel="about"] a[href*="/brand/licenses/"]') }
    })
    assert.deepEqual(licences.modal, licences.lobby)
    assert.equal(await dialog.locator('img').count(), 0); assert.deepEqual(images, [])
    await dialog.locator('h2').focus()
    for (const key of ['p', 'j', 'h', 'w']) await page.keyboard.press(key)
    assert.ok(await dialog.evaluate(el => el.open))
    for (let i = 0; i < 18; i++) {
      await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab')
      assert.ok(await page.evaluate(() => document.querySelector('.in-play-about').contains(document.activeElement)))
    }
    await dialog.locator('.shell-credits summary').click()
    await dialog.locator('.shell-credits li').last().scrollIntoViewIfNeeded()
    await page.keyboard.press('Escape')
    assert.ok(await entry.evaluate(el => el === document.activeElement))
    assert.equal((await state(page)).locked, false)
    assert.equal(await page.evaluate(() => syn3h.game.input.state.fire), false)
    await page.keyboard.up('KeyL')
    // Fresh gesture after neutral must work, with the normal cooldown unchanged.
    const cooldownEnd = await page.evaluate(() => syn3h.game.time + syn3h.params.get('bigRed.cooldown').value + .1)
    await ready(page, time => syn3h.game.time >= time, cooldownEnd)
    await page.keyboard.down('KeyL'); await ready(page, () => syn3hNet.bigRed.ready)
    await page.keyboard.up('KeyL'); await ready(page, sent => syn3hNet.bigRed.stats.sent === sent + 1, before.sent)
    await entry.click()
    await page.evaluate(() => syn3h.pause.pause('hidden')) // explicit synthetic lifecycle
    await page.evaluate(() => syn3h.pause.resume('hidden'))
    assert.equal(await page.evaluate(() => syn3h.game.input.suspended), true)
    assert.ok(await page.evaluate(() => document.querySelector('.in-play-about').contains(document.activeElement)))
    await dialog.locator('.about-back').click()
    const returned = await state(page); assert.ok(!returned.paused && !returned.suspended && !returned.locked)
    // Prior user pause is preserved. Synthetic activation avoids the pause veil;
    // native entry itself was exercised above. No forced/private pause state.
    await page.locator('.rail-pause').click()
    await page.evaluate(() => document.querySelector('.rail-about').click())
    await dialog.waitFor({ state: 'visible' })
    const paused = await state(page)
    await page.keyboard.press('Escape')
    assert.equal((await state(page)).reason, 'user'); assert.equal((await state(page)).tick, paused.tick)
    // Close while hidden, then resume the same reason: no stranded suspension.
    await page.evaluate(() => syn3h.pause.resume('user'))
    await entry.click()
    await page.evaluate(() => syn3h.pause.pause('hidden'))
    await dialog.locator('.about-back').click()
    assert.equal((await state(page)).suspended, true)
    await page.evaluate(() => syn3h.pause.resume('hidden'))
    assert.equal((await state(page)).suspended, false)
    // Real click opener disappears before close: use the current session entry fallback.
    await entry.click()
    await page.evaluate(() => {
      const old = document.querySelector('.rail-about')
      const copy = old.cloneNode(true); old.replaceWith(copy)
      window.guideRestoreEntry = () => copy.replaceWith(old)
    })
    await dialog.locator('.about-back').click()
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.rail-about')), true)
    await page.evaluate(() => { guideRestoreEntry(); guideTrace.restore() })
    const finalState = await state(page)
    assert.equal(finalState.id, before.id); assert.equal(finalState.url, before.url)
    assert.ok(finalState.connected); assert.equal(sockets.length, socketCount)
    assert.deepEqual(images, [])
    report.cases.push({ finalState, touchContext: touch, before, opened, returned, paused, trace, socketCount, documents, modules })
    await bounded(context.close())
  }
  report.finalProvenance = await provenance(); assert.deepEqual(report.finalProvenance, report.provenance)
} catch (error) { primary = error; report.failure = String(error.stack ?? error) }
finally {
  for (const page of pages) if (!page.isClosed()) {
    try { await page.evaluate(() => window.guideTrace?.restore()) } catch (error) { report.errors.push(String(error)) }
  }
  try { if (browser) await bounded(browser.close(), 15000) } catch (error) { report.errors.push(String(error)) }
  // Browser closed: no new response callbacks should start; drain all queued work.
  try { for (let cursor = 0; cursor < pending.length;) { const end = pending.length; await bounded(Promise.allSettled(pending.slice(cursor, end))); cursor = end } }
  catch (error) { report.errors.push(String(error)) }
  try { await bounded(writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)), 3000) }
  catch (error) { report.errors.push(String(error)); console.error(JSON.stringify(report)) }
  if (primary) throw primary
  assert.deepEqual(report.errors, [])
}
