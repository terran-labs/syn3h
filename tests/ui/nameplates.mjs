/** Source-prepared acceptance. Run only in an allocated browser slot, after integration.patch. */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5197/'
const out = 'tests/ui/artifacts/nameplates'
await mkdir(out, { recursive: true })
const room = `labels-${Date.now()}`
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
const errors = [], captures = []
async function open(name, viewport) {
  const context = await browser.newContext({ viewport }), page = await context.newPage()
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`))
  await page.goto(`${base}?room=${room}&name=${name}&autoplay=1`)
  await page.waitForFunction(() => window.syn3h?.shell && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
  await page.evaluate(() => { window.syn3h.shell.play(); document.activeElement?.blur?.(); window.__quality = setInterval(() => { window.syn3h.params.set('gfx.level', 2); window.syn3h.shell.stopAttract() }, 250) })
  await page.waitForFunction(() => window.syn3hNet?.connected, null, { timeout: 30000 })
  return page
}
async function capture(page, label) {
  await page.waitForTimeout(500)
  const state = await page.evaluate(async () => {
    const { HudExclusions } = await import('/src/ui/nameplates/HudExclusions.ts')
    const shell = window.syn3h.shell, hud = new HudExclusions(shell.element), exclusions = hud.read(innerWidth, innerHeight)
    hud.dispose()
    const labels = [...document.querySelectorAll('.vehicle-nameplate')].filter(el => !el.hidden && getComputedStyle(el).display !== 'none' && !el.closest('[hidden]')).map(el => {
      const b = el.getBoundingClientRect(), style = getComputedStyle(el)
      return { id: el.dataset.vehicle, bot: el.classList.contains('is-bot'), tick: el.classList.contains('is-tick'), text: el.textContent, width: b.width, height: b.height, opacity: Number(style.opacity), left: b.left, right: b.right, top: b.top, bottom: b.bottom }
    })
    return { labels, exclusions, nameplateCost: { ...window.syn3hNet.tags.stats }, curve: window.syn3h.params.get('world.curve').value, local: String(window.syn3hNet.id), presentation: shell.presentation, cameraMode: window.syn3h.params.get('camera.mode').value }
  })
  const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  assert.ok(state.labels.every(l => l.id !== state.local), 'never label the local player')
  for (let i = 0; i < state.labels.length; i++) {
    const a = state.labels[i]
    assert.ok(state.labels.slice(i + 1).every(b => !overlap(a, b)), `${label}: labels overlap`)
    assert.ok(state.exclusions.every(b => !overlap(a, b)), `${label}: label covers HUD`)
  }
  captures.push({ label, ...state })
  await page.screenshot({ path: `${out}/${label}.png` })
  await writeFile(`${out}/measurements.json`, JSON.stringify(captures, null, 2))
  return state
}
try {
  const a = await open('Observer', { width: 1440, height: 900 })
  const b = await open('Visitor', { width: 640, height: 480 })
  const c = await open('Companion', { width: 640, height: 480 })
  await a.waitForFunction(() => window.syn3hNet.remotes.size >= 2)
  assert.equal(await a.locator('.vehicle-nameplates').count(), 1, 'new module must be integrated')
  // DOM regression: touch controls are siblings of Shell, not descendants.
  assert.equal(await a.evaluate(async () => {
    const { HudExclusions } = await import('/src/ui/nameplates/HudExclusions.ts')
    const root = document.createElement('div'), touch = document.createElement('div')
    touch.className = 'touch-actions'; touch.style.cssText = 'position:fixed;left:17px;top:19px;width:37px;height:41px;display:block;opacity:1'
    document.body.append(root, touch)
    const hud = new HudExclusions(root), found = hud.read(innerWidth, innerHeight).some(r => r.left === 11 && r.top === 13 && r.right === 60 && r.bottom === 66)
    hud.dispose(); root.remove(); touch.remove(); return found
  }), true, 'sibling touch controls are protected')
  await a.evaluate(() => { const s = window.syn3h; s.params.set('bots.canDrive', false); s.params.set('bots.canFire', false); s.params.set('bots.count', 4) })
  await a.waitForFunction(() => window.syn3h.bots.vehicles.length >= 4, null, { timeout: 15000 })
  let center = await a.evaluate(() => { const s = window.syn3h, p = s.terrain.spawnPoint(0).position; return { x: p.x, y: p.y, z: p.z } })
  async function stage(far = false, curve = .71) {
    await a.evaluate(curve => window.syn3h.params.set('world.curve', curve), curve)
    await a.evaluate(p => {
      const s = window.syn3h, v = s.player.object.position.clone().set(p.x, s.terrain.heightAt(p.x, p.z + 18) + 2, p.z + 18)
      s.player.teleport(v, 0)
      s.bots.vehicles.forEach((bot, i) => { const x = p.x + (i - 1.5) * 24, z = p.z - 18 - i * 10; bot.teleport(v.clone().set(x, s.terrain.heightAt(x, z) + 2, z), 0) })
      s.camera.setCinematicPose(v.clone().set(p.x, p.y + 35, p.z + 70), v.clone().set(p.x, p.y + 4, p.z - 35), 60)
    }, center)
    await b.evaluate(({p, far}) => { const s = window.syn3h, z = p.z - (far ? 260 : 15), x = p.x - 45; s.player.teleport(s.player.object.position.clone().set(x, s.terrain.heightAt(x, z) + 2, z), 0) }, { p: center, far })
    await c.evaluate(({p, far}) => { const s = window.syn3h, z = p.z - (far ? 190 : 30), x = p.x + 45; s.player.teleport(s.player.object.position.clone().set(x, s.terrain.heightAt(x, z) + 2, z), 0) }, { p: center, far })
    await a.waitForTimeout(1500)
  }
  await stage()
  const near = await capture(a, 'desktop-near-day')
  for (const name of ['Visitor', 'Companion']) assert.ok(near.labels.some(l => !l.bot && l.text.includes(name)), `${name}: both remote human names are visible`)
  const person = near.labels.find(l => !l.bot), bot = near.labels.find(l => l.bot && !l.tick)
  assert.ok(person && bot, 'human and full bot labels must be present for comparison')
  assert.ok(bot.width / person.width >= .60 && bot.width / person.width <= .70, 'bot labels are 60 to 70 percent of human size')
  assert.ok(bot.height / person.height >= .60 && bot.height / person.height <= .70, 'bot label height is smaller too')
  assert.ok(bot.opacity < person.opacity, 'bot labels are fainter than human labels')
  assert.ok(near.labels.filter(l => l.bot && l.text.includes('BOT')).length >= 2, 'host-owned bots have smaller labels')
  await a.evaluate(() => window.syn3h.params.set('hud.nameplates', 1))
  assert.ok((await capture(a, 'people-only')).labels.every(l => !l.bot))
  await a.evaluate(() => window.syn3h.params.set('hud.nameplates', 2))
  assert.equal((await capture(a, 'off')).labels.length, 0)
  await a.evaluate(() => window.syn3h.params.set('hud.nameplates', 0))
  await b.evaluate(() => window.syn3h.game.input.toggleZorb())
  await b.waitForFunction(() => window.syn3h.player.zorb.radius > 4, null, { timeout: 15000 })
  await a.waitForFunction(() => [...window.syn3hNet.remotes.values()].some(r => r.vehicle.zorb.active), null, { timeout: 15000 })
  await capture(a, 'remote-zorb')
  await b.evaluate(() => window.syn3h.game.input.toggleZorb())
  await b.evaluate(() => { void window.syn3h.swapVehicle('jet') })
  await b.waitForFunction(() => window.syn3h.player.kind === 'jet', null, { timeout: 15000 })
  await a.waitForFunction(() => [...window.syn3hNet.remotes.values()].some(r => r.vehicle.kind === 'jet'), null, { timeout: 15000 })
  await capture(a, 'remote-materialize')
  await b.waitForFunction(() => window.syn3h.player.object.userData.materializing !== true, null, { timeout: 20000 })
  for (const curve of [0, .71, 1.8]) {
    await stage(false, curve); await capture(a, `desktop-curve-${curve}-near`)
    await stage(true, curve); await capture(a, `desktop-curve-${curve}-far`)
  }
  await stage(true, .71); await capture(a, 'desktop-far-day')
  await a.evaluate(() => window.syn3h.params.set('sun.timeOfDay', 0)); await capture(a, 'desktop-far-night')
  await stage(); await a.evaluate(() => window.syn3h.shell.setPresentation(true)); await capture(a, 'desktop-presentation-night')
  await a.evaluate(() => { window.syn3h.shell.setPresentation(false); window.syn3h.params.set('sun.timeOfDay', 12) })
  await a.setViewportSize({ width: 390, height: 844 }); await capture(a, 'phone-near-day')
  for (const curve of [.71, 1.8]) {
    await stage(true, curve); await capture(a, `phone-curve-${curve}-far`)
  }
  await stage(false, .71)
  await a.evaluate(() => window.syn3h.params.set('sun.timeOfDay', 0)); await capture(a, 'phone-near-night')
  await a.setViewportSize({ width: 1440, height: 900 })
  await a.evaluate(() => { window.syn3h.camera.clearCinematicPose(); window.syn3h.params.set('sun.timeOfDay', 12) })
  for (const mode of [0, 1, 2, 3, 4]) {
    await a.evaluate(mode => window.syn3h.params.set('camera.mode', mode), mode)
    await capture(a, `camera-${mode}`)
  }
  // Pausing stops the render loop; the observer must hide the layer without another frame.
  await a.evaluate(() => window.syn3h.shell.requestPause())
  await a.waitForFunction(() => document.querySelector('.vehicle-nameplates').hidden)
  await a.screenshot({ path: `${out}/paused.png` })
  await a.evaluate(() => window.syn3h.shell.requestResume())
  // Snow and bright sky need a real capture, not a CSS contrast assumption.
  await a.evaluate(() => window.syn3h.planets.applyPlanet('ice'))
  await a.waitForTimeout(2000)
  center = await a.evaluate(() => { const p = window.syn3h.terrain.spawnPoint(0).position; return { x: p.x, y: p.y, z: p.z } })
  await stage(); await a.evaluate(() => window.syn3h.params.set('sun.timeOfDay', 12)); await capture(a, 'snow-day')
  // Followers must get bot labels from replicas, not duplicate the host-owned set.
  await capture(b, 'follower')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, captures: captures.map(c => c.label), errors }))
} finally { await browser.close() }
