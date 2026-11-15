/** Isolate what is seen above the horizon from under water. node tools/water/under-iso.mjs BASE OUT
 * Run through the shared heavy limiter. Captures and scene facts only.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
const [base, out] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const report = { errors: [], shots: [] }
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', e => report.errors.push(e.message))
  const url = new URL(base); url.searchParams.set('room', `water-iso-${Date.now()}`); url.searchParams.set('name', 'Iso')
  await page.goto(url.href, { waitUntil: 'load', timeout: 120000 })
  await page.waitForFunction(() => window.syn3h?.shell, null, { timeout: 120000 })
  await page.evaluate(() => window.syn3h.shell.play())
  await page.waitForFunction(() => window.syn3hNet?.connected && window.syn3h.game.time > 3, null, { timeout: 120000 })
  await page.evaluate(async () => {
    const s = window.syn3h
    const { applyPlanet } = await import('/src/world/planets.ts')
    applyPlanet('alpine', 7)
    for (const [id, value] of Object.entries({ 'bots.count': 0, 'gfx.auto': false, 'gfx.level': 2, 'sun.timeOfDay': 12, 'sun.dayLength': 0, 'weather.storminess': 0 })) s.params.set(id, value)
  })
  await page.waitForTimeout(3000)
  report.scene = await page.evaluate(() => {
    const s = window.syn3h, t = s.terrain, level = s.params.get('world.lavaAltitude').value, size = t.wrapSize
    let spot
    outer: for (let x = -size / 2 + 32; x < size / 2 - 32; x += 8) for (let z = -size / 2 + 32; z < size / 2 - 32; z += 8) {
      const d = level - t.heightAt(x, z)
      if (t.liquidKindAt(x, z) === 'water' && d > 9 && d < 16) { spot = { x, z, y: level }; break outer }
    }
    window.iso = { spot, pitch: 6 }
    s.game.systems.splice(s.game.systems.findIndex(system => system.underwater), 0, {
      update() { const p = window.iso.spot, c = s.game.camera; c.position.set(p.x, p.y - 2, p.z); c.lookAt(p.x + 30, p.y - 2 + window.iso.pitch, p.z) },
      fixedUpdate() { const p = window.iso.spot; s.player.body.setTranslation({ x: p.x - 6, y: p.y - 5, z: p.z }, true); s.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true) },
    })
    const sea = s.terrain.volcanics.newSea.material
    return { spot, level,
      sea: { transparent: sea.transparent, side: sea.side, depthWrite: sea.depthWrite, forceSinglePass: sea.forceSinglePass, envMap: !!sea.envMap, envMapIntensity: sea.envMapIntensity },
      children: s.game.scene.children.map(o => ({ type: o.type, name: o.name, renderOrder: o.renderOrder, visible: o.visible, transparent: o.material?.transparent, depthWrite: o.material?.depthWrite, sky: !!(o.sunDirection && o.betaR), kids: o.children.length })) }
  })
  const shot = async (name, before, after) => {
    if (before) await page.evaluate(before)
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${out}/${name}.png` }); report.shots.push(name)
    if (after) await page.evaluate(after)
  }
  await shot('a-normal')
  await shot('b-water-hidden', () => { window.syn3h.terrain.volcanics.group.visible = false }, () => { window.syn3h.terrain.volcanics.group.visible = true })
  await shot('c-no-reflection', () => window.syn3h.params.set('water.reflection', 0), () => window.syn3h.params.set('water.reflection', 1))
  await shot('d-sky-hidden', () => { const sky = window.syn3h.game.scene.children.find(o => o.sunDirection && o.betaR); window.isoSky = sky; sky.visible = false }, () => { window.isoSky.visible = true })
  await shot('e-underwater-off', () => window.syn3h.params.set('water.underwater', false), () => window.syn3h.params.set('water.underwater', true))
  await shot('f-up', () => { window.iso.pitch = 40 })
} catch (e) { report.errors.push(String(e.stack || e)) } finally {
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2)); await browser.close()
}
console.log(JSON.stringify({ errors: report.errors, shots: report.shots.length }))
