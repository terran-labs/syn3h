// The name through a round trip, with perf/smooth-entry's dive and reverse exit: a world
// clicked during the opening; entering a world and leaving it (the reverse flight, then the
// name kindled once, controls shown); and the same with reduced motion.
//   tools/heavy.sh node tests/ui/wordmark-roundtrip.mjs   (SYN3H_URL, default http://127.0.0.1:5241/)
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5241/'
const out = 'tests/ui/artifacts/wordmark'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] })
const state = page => page.evaluate(() => { const g = syn3h.shell.galaxy, root = document.documentElement; return { opening: !!g.opening, leaving: g.leaving !== null, returning: g.returning !== null, flight: !!g.flight, reverse: !!g.flight?.reverse, chosen: g.chosen, held: root.dataset.opening ?? null, playing: document.querySelector('.syn3h-shell').classList.contains('is-playing'), menu: syn3h.shell.menuVisible, links: getComputedStyle(document.querySelector('.galaxy-links')).visibility} })
const report = {}
try {
  for (const reduced of [false, true]) {
    const name = reduced ? 'reduced' : 'motion'
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: reduced ? 'reduce' : 'no-preference' }), page = await context.newPage()
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${base}?room=trip-${name}-${Date.now()}`)
    // The opening starts as loading ends: on the first frame after boot it must be playing
    // (with motion), never already over. Read on that frame, not after a clock.
    const atBoot = await (await page.waitForFunction(() => document.documentElement.dataset.boot === 'done' && window.syn3h?.shell?.galaxy && { opening: !!syn3h.shell.galaxy.opening }, null, { timeout: 120000 })).jsonValue()
    assert.equal(atBoot.opening, !reduced, reduced ? 'reduced motion: no opening' : 'the opening plays as loading ends')
    await page.waitForFunction(() => window.syn3h?.game?.tick > 25, null, { timeout: 120000 })
    await page.evaluate(() => { window.__pin = setInterval(() => syn3h.params.set('gfx.level', 2), 400) })
    // 1. A world clicked while the opening plays: it goes there, and the controls are not left held back.
    if (!reduced) {
      // The opening runs by the wall clock and a busy machine can reach this point after it has
      // ended, so play it again and hold it mid-flight (openingAt, the galaxy's hook for checks)
      // with the worlds out on their orbits. The click is then always made during the opening.
      await page.evaluate(() => { const g = syn3h.shell.galaxy; if (!g.opening) g.replayOpening(syn3h.params.get('lobby.intro').value); g.openingAt = 3.2; g.wake = 2 })
      await page.waitForFunction(() => syn3h.shell.galaxy.screen.some(p => p.visible), null, { timeout: 15000 })
      const during = await state(page)
      assert.equal(during.opening, true, 'the opening is still playing when the world is clicked')
      const world = await page.evaluate(() => syn3h.shell.galaxy.screen.find(p => p.visible))
      await page.mouse.click(world.x, world.y)
      await page.evaluate(() => { syn3h.shell.galaxy.openingAt = null })
      // The click ends the opening and starts the flight on the next frames: wait for that state.
      await page.waitForFunction(() => { const g = syn3h.shell.galaxy; return !g.opening && g.chosen >= 0 && !!g.flight }, null, { timeout: 10000 }).catch(() => {})
      const after = await state(page)
      assert.equal(after.opening, false, 'the click ends the opening'); assert.equal(after.held, null, 'and gives the controls back')
      assert.ok(after.chosen >= 0 && after.flight, 'and flies to the world')
      report.clickDuringOpening = { during, after }
    } else {
      const world = await page.evaluate(() => syn3h.shell.galaxy.screen.find(p => p.visible))
      await page.mouse.click(world.x, world.y)
    }
    // 2. Into the world, then out again by Leave world.
    await page.waitForFunction(() => document.querySelector('.syn3h-shell').classList.contains('is-playing') && !syn3h.shell.dropping, null, { timeout: 90000 })
    await page.waitForTimeout(1500)
    await page.evaluate(() => { const s = syn3h.shell; s.exitAsking = true; s.answerExit(true) })
    const samples = [], started = Date.now()
    while (Date.now() - started < 30000) {
      const now = { t: Date.now() - started, ...(await state(page)) }; samples.push(now)
      if (now.menu && !now.flight && !now.returning && now.t > 500) break
      await page.waitForTimeout(100)
    }
    const end = await state(page)
    assert.equal(end.held, null, `${name}: the controls are not left held back`); assert.equal(end.links, 'visible', `${name}: the lobby buttons are shown`)
    assert.equal(end.leaving, false, `${name}: the name is not left hidden`)
    // The name is kindled once: the replay starts only after the reverse flight has landed.
    const replays = samples.filter((s, i) => s.returning && !(samples[i - 1]?.returning)).length
    assert.ok(replays <= 1, `${name}: the name replays at most once (${replays})`)
    if (!reduced) { assert.equal(replays, 1, 'with motion it replays once'); const first = samples.find(s => s.returning); assert.equal(first.flight, false, 'after the flight, not under it') }
    await page.screenshot({ path: `${out}/trip-${name}-back.png` })
    report[name] = { samples: samples.length, replays, errors }
    assert.deepEqual(errors, [])
    await context.close()
  }
  console.log(JSON.stringify({ ok: true, report: { clickDuringOpening: report.clickDuringOpening?.after, motion: report.motion, reduced: report.reduced } }))
} finally { await browser.close() }
