/** How the water reads from the cameras a player actually has. Ordinary entry, no query flags.
 * node tools/water/look-check.mjs BASE OUT [webgpu|webgl] [world=alpine.7] [tiers=2]
 * Run through the absolute shared heavy limiter. Captures only: no timing claims.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
const [base, out, backend = 'webgpu', world = 'alpine.7', tiers = '2'] = process.argv.slice(2)
if (!base || !out) throw Error('BASE and OUT required')
mkdirSync(out, { recursive: true })
const report = { backend, world, errors: [], shots: [] }
const browser = await chromium.launch({ channel: 'chrome', headless: process.env.WATER_HEADED !== '1',
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', e => report.errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') report.errors.push('console: ' + m.text().slice(0, 300)) })
  const url = new URL(base); url.searchParams.set('room', `water-look-${Date.now()}`); url.searchParams.set('name', 'Look')
  if (backend === 'webgl') url.searchParams.set('webgl', '1')
  await page.goto(url.href, { waitUntil: 'load', timeout: 120000 })
  await page.waitForFunction(() => window.mira?.shell, null, { timeout: 120000 })
  await page.evaluate(() => window.mira.shell.play())
  await page.waitForFunction(() => window.miraNet?.connected && window.mira.game.time > 3, null, { timeout: 120000 })
  const [planet, seed] = world.split('.')
  await page.evaluate(async ({ planet, seed }) => {
    const s = window.mira
    const { applyPlanet } = await import('/src/world/planets.ts')
    applyPlanet(planet, Number(seed))
    for (const [id, value] of Object.entries({ 'bots.count': 0, 'gfx.auto': false, 'gfx.level': 2, 'sun.timeOfDay': 15.5, 'sun.dayLength': 0, 'weather.storminess': 0 })) s.params.set(id, value)
  }, { planet, seed })
  await page.waitForTimeout(3000)
  // A sea spot 6 to 14 m deep, and a camera system placed before the water effects.
  const spot = await page.evaluate(() => {
    const s = window.mira, t = s.terrain, level = s.params.get('world.lavaAltitude').value, size = t.wrapSize
    let spot
    outer: for (let x = -size / 2 + 32; x < size / 2 - 32; x += 8) for (let z = -size / 2 + 32; z < size / 2 - 32; z += 8) {
      const d = level - t.heightAt(x, z)
      if (t.liquidKindAt(x, z) === 'water' && d > 2.5 && d < 5 && level - t.heightAt(x + 40, z) > 8 && t.heightAt(x - 30, z) > level + 1) { spot = { x, z, y: level }; break outer }
    }
    if (!spot) throw Error('no shore spot')
    const sun = s.game.scene.children.find(o => o.isDirectionalLight)
    const q = window.waterLook = { spot, view: 'drive', sunAz: Math.atan2(sun.position.x - sun.target.position.x, sun.position.z - sun.target.position.z) }
    s.game.systems.splice(s.game.systems.findIndex(system => system.underwater), 0, {
      update() {
        const c = s.game.camera, p = q.spot
        const V = { // [dx, dy, dz, lookdx, lookdy, lookdz]
          drive: [-9, 2.4, 3, 30, -1.5, -4], shore: [14, 3, 0, -30, -1, 4], high: [8, 14, 12, -2, -1, -3],
          sun: [-Math.sin(q.sunAz) * 10, 2.2, -Math.cos(q.sunAz) * 10, Math.sin(q.sunAz) * 60, 0, Math.cos(q.sunAz) * 60], low: [-6, .7, 2, 40, .2, -6],
        }[q.view]
        c.position.set(p.x + V[0], p.y + V[1], p.z + V[2]); c.lookAt(p.x + V[3], p.y + V[4], p.z + V[5])
      },
      fixedUpdate() {
        const p = q.spot
        s.player.body.setTranslation({ x: p.x + 3, y: p.y + .1, z: p.z - 1 }, true)
        s.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true); s.player.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
        s.player.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true)
      },
    })
    return spot
  })
  report.spot = spot
  const shot = async name => {
    await page.waitForTimeout(1500)
    const info = await page.evaluate(() => ({ calls: window.mira.game.renderer.info.render.drawCalls, triangles: window.mira.game.renderer.info.render.triangles, env: !!window.mira.game.scene.environment }))
    await page.screenshot({ path: `${out}/${name}.png` }); report.shots.push({ name, ...info })
  }
  for (const tier of tiers.split(',').map(Number)) {
    await page.evaluate(t => window.mira.params.set('gfx.level', t), tier)
    await page.waitForTimeout(2500)
    for (const view of ['drive', 'low', 'sun', 'shore', 'high']) {
      await page.evaluate(v => { window.waterLook.view = v }, view)
      await shot(`${planet}-t${tier}-${view}`)
    }
  }
  // Diagnostic variants from the driving camera: WATER_VARIANTS='{"name":{"param.id":value}}'.
  const before = {}
  for (const [name, set] of Object.entries(JSON.parse(process.env.WATER_VARIANTS || '{}'))) {
    await page.evaluate(() => { window.waterLook.view = 'drive' })
    for (const [id, value] of Object.entries(set)) {
      if (id === 'hide') continue
      before[id] ??= await page.evaluate(id => window.mira.params.get(id).value, id)
      await page.evaluate(({ id, value }) => window.mira.params.set(id, value), { id, value })
    }
    if (set.hide) await page.evaluate(h => { window.mira.terrain.volcanics.group.visible = h !== 'water' }, set.hide)
    await shot(`${planet}-variant-${name}`)
    await page.evaluate(() => { window.mira.terrain.volcanics.group.visible = true })
    for (const [id, value] of Object.entries(before)) await page.evaluate(({ id, value }) => window.mira.params.set(id, value), { id, value })
  }
  // A gale, a calm, and dusk from the driving camera.
  await page.evaluate(() => { window.waterLook.view = 'drive'; window.mira.params.set('weather.storminess', 1) })
  await shot(`${planet}-storm-drive`)
  await page.evaluate(() => { window.mira.params.set('weather.storminess', 0); window.mira.params.set('sun.timeOfDay', 19.2) })
  await shot(`${planet}-dusk-drive`)
} catch (e) { report.errors.push(String(e.stack || e)) } finally {
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify({ errors: report.errors, shots: report.shots.length }))
if (report.errors.length) process.exit(1)
