/**
 * First impression check: what a new player sees in the five seconds after Play, and how
 * the island reads at several hours from spawn pad 0 and from the summit.
 *
 *   node tests/ui/first-impression.mjs <label> [hours, e.g. 12,16.5,23] [--light-only|--first-only] [--az=335] [--record]
 *
 * Needs the lane dev server on 5187 (see tests/ui/README.md). Writes screenshots and
 * `<label>-report.json` to tests/ui/artifacts/first-impression/. One Chrome, run serially.
 */
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const label = process.argv[2] ?? 'run'
const hours = (process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : '12,17,23').split(',').map(Number)
const flag = name => process.argv.find(a => a.startsWith(`--${name}`))
/** `--record` skips the assertions, for capturing a build that is known to fail them. */
const strict = !flag('record')
const only = flag('light-only') ?? flag('first-only') ?? ''
/** Optional sun azimuth override in degrees, to compare sun placements: --az=335 */
const azimuth = flag('az=') ? Number(flag('az=').slice(5)) : null
const out = 'tests/ui/artifacts/first-impression'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5187/'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = { label, first: [], light: [], errors: [] }
const views = [
  { name: '1280x720', viewport: { width: 1280, height: 720 } },
  { name: '1920x1080', viewport: { width: 1920, height: 1080 } },
  { name: '390x844', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
]
/** Where the vehicle and the controls card are on screen, and whether they overlap. */
const layout = page => page.evaluate(() => {
  const s = window.syn3h, cam = s.game.camera, p = s.player.body.translation()
  const at = (dx, dy, dz) => { const v = cam.position.clone().set(p.x + dx, p.y + dy, p.z + dz).project(cam); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight] }
  // A 3 m cube round the body is a generous stand-in for the vehicle silhouette.
  const pts = [-1.5, 1.5].flatMap(x => [-1, 1.5].flatMap(y => [-1.5, 1.5].map(z => at(x, y, z))))
  const xs = pts.map(q => q[0]), ys = pts.map(q => q[1])
  const vehicle = { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
  const el = document.querySelector('.spawn-help'), r = el && !el.hidden && getComputedStyle(el).display !== 'none' ? el.getBoundingClientRect() : null
  const card = r && r.width ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null
  const overlap = !!card && card.left < vehicle.right && card.right > vehicle.left && card.top < vehicle.bottom && card.bottom > vehicle.top
  const round = o => o && Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]))
  return { vehicle: round(vehicle), card: round(card), overlap, hour: s.params.get('sun.timeOfDay').value, dayLength: s.params.get('sun.dayLength').value }
})
const open = async (view, room) => {
  const context = await browser.newContext(view)
  const page = await context.newPage()
  page.on('pageerror', e => report.errors.push(`${view.name}: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') report.errors.push(`${view.name}: ${m.text()}`) })
  await page.goto(`${base}?room=${room}&autoplay=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.syn3h?.game?.tick > 25, null, { timeout: 90000 })
  return { context, page }
}
try {
  if (only !== '--light-only') for (const view of views) {
    const { context, page } = await open(view, `fi-${label}-${view.name}`)
    await page.waitForTimeout(1500)
    const early = await layout(page)
    await page.screenshot({ path: `${out}/${label}-${view.name}-1s.png` })
    // Two ways out for the short card: the first input (keyboard, then touch) or its own timer.
    const byTimer = view.name === '1920x1080'
    if (byTimer) await page.waitForTimeout(4000)
    else if (view.hasTouch) await page.touchscreen.tap(60, 760)
    else { await page.keyboard.down('w'); await page.waitForTimeout(300); await page.keyboard.up('w') }
    await page.waitForTimeout(600)
    const gone = await layout(page)
    await page.waitForTimeout(byTimer ? 400 : 3000)
    await page.screenshot({ path: `${out}/${label}-${view.name}-5s.png` })
    let reopened = null, closed = null
    if (!view.hasTouch) {
      await page.keyboard.press('h'); await page.waitForTimeout(300); reopened = await layout(page)
      await page.screenshot({ path: `${out}/${label}-${view.name}-h.png` })
      await page.keyboard.press('h'); await page.waitForTimeout(300); closed = await layout(page)
    }
    report.first.push({ view: view.name, hidBy: byTimer ? 'timer' : 'input', early, gone, reopened, closed })
    if (strict) {
      assert.ok(early.card, `${view.name}: the controls card shows after Play`)
      assert.equal(early.overlap, false, `${view.name}: the card is clear of the vehicle`)
      assert.equal(gone.card, null, `${view.name}: the card leaves on ${byTimer ? 'its timer' : 'first input'}`)
      assert.equal(early.dayLength, 0, 'the clock is paused by default')
      if (reopened) { assert.ok(reopened.card, 'H reopens the card'); assert.equal(reopened.overlap, false, 'the full card is clear of the vehicle'); assert.equal(closed.card, null, 'H closes it again') }
    }
    await context.close()
  }
  if (only !== '--first-only') {
    const { context, page } = await open(views[0], `fi-${label}-light`)
    await page.waitForTimeout(9500) // past the controls card
    const info = await page.evaluate(() => { const s = window.syn3h, S = s.terrain.summit(); return { S, pad: s.terrain.spawnPoint(0) } })
    for (const place of ['pad0', 'summit']) {
      if (place === 'summit') {
        // Where the spiral road meets the rim road, driving along the rim with the lava lake
        // on the left. King of the Hill is on so the hill marker is part of the picture.
        await page.evaluate(({ S }) => {
          const s = window.syn3h, a = Math.atan2(38, 86), x = S.x + Math.cos(a) * S.rimRadius, z = S.z + Math.sin(a) * S.rimRadius
          s.params.set('game.mode', 1)
          s.player.teleport(s.game.camera.position.clone().set(x, s.terrain.heightAt(x, z) + 2, z), Math.PI - a)
        }, info)
        await page.waitForTimeout(4000)
      }
      for (const hour of hours) {
        await page.evaluate(({ h, az }) => { const p = window.syn3h.params; p.set('sun.dayLength', 0); p.set('sun.timeOfDay', h); if (az !== null) p.set('sun.azimuth', az) }, { h: hour, az: azimuth })
        await page.waitForTimeout(3000) // auto exposure settles
        await page.screenshot({ path: `${out}/${label}-light-${place}-h${hour}.png` })
        report.light.push({ place, hour, sun: await page.evaluate(() => window.syn3h.game.systems.find(x => x.sunDirection).sunDirection.toArray().map(n => +n.toFixed(3))) })
      }
    }
    await context.close()
  }
} finally {
  await browser.close()
  await writeFile(`${out}/${label}-report.json`, JSON.stringify(report, null, 1))
}
console.log(JSON.stringify(report, null, 1))
if (report.errors.length) process.exitCode = 1
