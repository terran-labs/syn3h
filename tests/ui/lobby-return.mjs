/**
 * Leaving a world brings the lobby back to the view a fresh load rests at (the owner,
 * 17 November 2026: the lobby was upside down after exiting a planet, and the name slid in
 * from a screen edge). For each exit, from several worlds, at desktop and phone sizes, with
 * and without orbiting the lobby first, and with reduced motion:
 *
 *   - the view comes to rest at the fresh-load pose (heading, tilt above the plane, zoom);
 *   - the wordmark rests where it rests on a fresh load, above the orbital plane;
 *   - at every frame of the way back the wordmark is either fully transparent or within a few
 *     pixels of that resting place: it fades in where it belongs, never slides in.
 *
 *   SYN3H_URL=http://127.0.0.1:5187/ /Users/vtn/dev/Syn3h/tools/heavy.sh node tests/ui/lobby-return.mjs
 *
 * Needs a dev server; SYN3H_URL picks it.
 */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { waitForState } from './stateWait.mjs'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5187/'
const out = 'tests/ui/artifacts/lobby-return'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = [], report = []
const ready = page => page.waitForFunction(() => window.syn3h?.game?.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false' && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a))

/** The galaxy's view and the wordmark's place, as drawn. */
const look = page => page.evaluate(() => {
  const g = window.syn3h.shell.galaxy, box = g.wordmarkScreenBox()
  return { logo: g.options.logo?.()?.box, target: g.target, reach: g.reach, framing: g.framing, yaw: g.yaw, pitch: g.pitch, distance: g.distance, fresh: g.freshPose(), shown: g.markShown, centre: box && [box.x + box.width / 2, box.y + box.height / 2], markY: g.markPlaced?.centre[1] ?? null, home: g.returningHome }
})
/** The lobby at rest: no opening, no return, the name fully shown and its rig still. */
const rested = page => waitForState(page, 'the lobby at rest with the name shown', () => {
  const g = window.syn3h.shell.galaxy
  return !g.opening && !g.returningHome && g.returning === null && g.markShown > 0.999 && !document.querySelector('.syn3h-shell').classList.contains('is-descending')
}, undefined, 60)

const views = [
  ...(process.env.ONLY === 'phone' ? [] : [{ name: 'desktop', viewport: { width: 1440, height: 900 } }]),
  { name: 'phone', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
]
try {
  for (const view of views) for (const reduced of [false, true]) {
    const tag = `${view.name}${reduced ? '-reduced' : ''}`
    const context = await browser.newContext({ ...view, reducedMotion: reduced ? 'reduce' : 'no-preference' }), page = await context.newPage()
    page.on('pageerror', e => errors.push(`${tag}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error') errors.push(`${tag}: ${m.text()}`) })
    await page.goto(`${base}?room=lobby-return-${tag}-${Date.now()}`, { waitUntil: 'load' }); await ready(page)
    // The idle drift back to the standard tilt (a tall phone opens steeper, then settles over
    // about 25 s) runs after any rest, fresh or returned: hold it off so both are compared at
    // the same moment of the same view.
    await page.evaluate(() => { window.syn3h.params.set('lobby.returnDelay', 60); window.__pin = setInterval(() => window.syn3h.params.set('gfx.level', 2), 400) })
    await page.keyboard.press('Shift')
    await rested(page)
    const fresh = await look(page)
    assert.ok(fresh.centre, `${tag}: the name is drawn in the lobby`)
    assert.ok(Math.abs(wrap(fresh.yaw - fresh.fresh.yaw)) < 0.2 && Math.abs(fresh.pitch - fresh.fresh.pitch) < 1e-3, `${tag}: a fresh load rests at freshPose (${JSON.stringify(fresh)})`)
    await page.screenshot({ path: `${out}/${tag}-fresh.png` })
    const tolerance = Math.max(6, Math.min(view.viewport.width, view.viewport.height) * 0.015)
    const worlds = reduced ? ['desert'] : ['alpine', 'desert', 'volcanic']
    for (const [i, world] of worlds.entries()) {
      const orbit = i % 2 === 1
      if (orbit) {
        // Orbit the lobby first: round and down, so the view starts somewhere else entirely.
        const at = { x: view.viewport.width * 0.5, y: view.viewport.height * 0.2 }
        await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.move(at.x + view.viewport.width * 0.35, at.y + view.viewport.height * 0.3, { steps: 10 }); await page.mouse.up()
        await page.waitForTimeout(400)
      }
      const known = await page.evaluate(id => window.syn3h.planets.PLANETS.some(p => p.id === id), world)
      if (!known) continue
      await page.locator(`.galaxy-label[data-world="${world}"]`).dispatchEvent('click')
      await waitForState(page, `playing on ${world}`, () => { const s = document.querySelector('.syn3h-shell'); return s.classList.contains('is-playing') && !s.classList.contains('is-descending') }, undefined, 40)
      await page.waitForTimeout(1500)
      // Every frame from the exit until the lobby rests: the name's opacity and centre.
      await page.evaluate(() => {
        const w = window; w.__frames = []; w.__done = false
        const tick = () => { const g = w.syn3h.shell.galaxy, b = g.wordmarkScreenBox(); w.__frames.push({ t: Math.round(performance.now()), shown: g.markShown, centre: b && [b.x + b.width / 2, b.y + b.height / 2], pitch: g.pitch, home: g.returningHome, reach: g.reach, target: g.target.map(v => +v.toFixed(3)), rig: g.markRig.pose && { yaw: g.markRig.pose.yaw, pitch: g.markRig.pose.pitch, reach: g.markRig.pose.reach } }); if (!w.__done) requestAnimationFrame(tick) }
        requestAnimationFrame(tick)
        const s = w.syn3h.shell; s.askExit(); s.answerExit(true)
      })
      await waitForState(page, 'the return to start', () => window.syn3h.shell.galaxy.returningHome || !document.querySelector('.syn3h-shell').classList.contains('is-playing'), undefined, 20)
      await waitForState(page, 'the return to end', () => !window.syn3h.shell.galaxy.returningHome && !document.querySelector('.syn3h-shell').classList.contains('is-descending'), undefined, 40)
      const landed = await look(page)
      await rested(page)
      const after = await look(page)
      const frames = await page.evaluate(() => { window.__done = true; return window.__frames })
      await page.screenshot({ path: `${out}/${tag}-${world}${orbit ? '-orbited' : ''}.png` })
      const name = `${tag} from ${world}${orbit ? ' after orbiting' : ''}`
      assert.ok(Math.abs(wrap(landed.yaw - landed.fresh.yaw)) < 0.05, `${name}: heading home (${landed.yaw} vs ${landed.fresh.yaw})`)
      assert.ok(Math.abs(landed.pitch - landed.fresh.pitch) < 1e-3, `${name}: tilt home (${landed.pitch} vs ${landed.fresh.pitch})`)
      assert.ok(Math.abs(landed.distance / landed.fresh.distance - 1) < 1e-3, `${name}: zoom home (${landed.distance} vs ${landed.fresh.distance})`)
      assert.ok(after.pitch > 0, `${name}: the camera is above the plane`)
      assert.ok(after.markY > 0, `${name}: the name stands above the plane (${after.markY})`)
      const off = Math.hypot(after.centre[0] - fresh.centre[0], after.centre[1] - fresh.centre[1])
      assert.ok(off < tolerance, `${name}: the name rests ${off.toFixed(1)} px from its fresh-load place (fresh ${JSON.stringify(fresh)}, after ${JSON.stringify(after)})`)
      let worst = 0
      for (const f of frames) {
        if (f.shown <= 0.01 || !f.centre) continue
        const d = Math.hypot(f.centre[0] - fresh.centre[0], f.centre[1] - fresh.centre[1])
        worst = Math.max(worst, d)
        if (d >= tolerance) console.log(JSON.stringify({ name, fresh: fresh.centre, rest: after, around: frames.slice(Math.max(0, frames.indexOf(f) - 4), frames.indexOf(f) + 4) }, null, 1))
        assert.ok(d < tolerance, `${name}: a frame showed the name at ${(f.shown * 100).toFixed(0)}% opacity ${d.toFixed(1)} px from its place`)
      }
      report.push({ view: tag, world, orbited: orbit, frames: frames.length, worstVisibleOffPx: +worst.toFixed(1), restOffPx: +off.toFixed(1), pitch: +after.pitch.toFixed(3) })
    }
    // A panel opened from play and closed again returns home the same way (desktop only: the HUD's Worlds button).
    if (view.name === 'desktop' && !reduced) {
      await page.locator('.galaxy-label[data-world="alpine"]').dispatchEvent('click')
      await waitForState(page, 'playing on alpine', () => { const s = document.querySelector('.syn3h-shell'); return s.classList.contains('is-playing') && !s.classList.contains('is-descending') }, undefined, 40)
      await page.evaluate(() => window.syn3h.shell.openMenu('worlds'))
      await page.evaluate(() => window.syn3h.shell.showPanel('index'))
      await rested(page)
      const after = await look(page)
      assert.ok(Math.abs(after.pitch - after.fresh.pitch) < 1e-3 && after.markY > 0, `${tag} via a panel: home and above the plane (${JSON.stringify(after)})`)
      report.push({ view: tag, world: 'alpine via panel', pitch: +after.pitch.toFixed(3) })
    }
    await context.close()
  }
  assert.deepEqual(errors, [], 'no page errors')
  console.table(report)
  console.log('lobby-return: ok')
} finally {
  await browser.close()
}
