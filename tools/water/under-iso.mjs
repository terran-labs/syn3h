/** Isolate what is seen above the horizon from under water. node tools/water/under-iso.mjs BASE OUT [webgpu|webgl]
 * Run through the shared heavy limiter. Captures and scene facts only.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
const [base, out, backend = 'webgpu'] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const report = { backend, errors: [], shots: [], frames: [] }
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', e => report.errors.push(e.message))
  const url = new URL(base); url.searchParams.set('room', `water-iso-${Date.now()}`); url.searchParams.set('name', 'Iso')
  if (backend === 'webgl') url.searchParams.set('webgl', '1')
  await page.goto(url.href, { waitUntil: 'load', timeout: 120000 })
  await page.waitForFunction(() => window.syn3h?.shell, null, { timeout: 120000 })
  await page.evaluate(() => window.syn3h.shell.play())
  await page.waitForFunction(() => window.syn3hNet?.connected && window.syn3h.game.time > 3, null, { timeout: 120000 })
  await page.evaluate(async () => {
    const s = window.syn3h
    const { applyPlanet } = await import('/src/world/planets.ts')
    applyPlanet('alpine', 7)
    for (const [id, value] of Object.entries({ 'bots.count': 0, 'gfx.auto': false, 'gfx.level': 2, 'sun.timeOfDay': 12, 'sun.dayLength': 0, 'weather.storminess': 0, 'world.curve': 0, 'post.on': true, 'post.clouds': 1 })) s.params.set(id, value)
  })
  await page.waitForTimeout(3000)
  report.scene = await page.evaluate(() => {
    const s = window.syn3h, t = s.terrain, level = s.params.get('world.lavaAltitude').value, size = t.wrapSize
    let spot
    outer: for (let x = -size / 2 + 32; x < size / 2 - 32; x += 8) for (let z = -size / 2 + 32; z < size / 2 - 32; z += 8) {
      const d = level - t.heightAt(x, z)
      if (t.liquidKindAt(x, z) === 'water' && d > 9 && d < 16) { spot = { x, z, y: level }; break outer }
    }
    if (!spot) throw Error('No deep water capture location')
    // Stop the live loop before pinning the pose: shell descent and chase updates must
    // not change the camera between the normal and cloud-isolation captures.
    s.game.renderer.setAnimationLoop(null)
    window.iso = { spot, pitch: 6, depth: 2 }
    window.isoRender = () => {
      const g = s.game, p = window.iso.spot, c = g.camera
      c.position.set(p.x, p.y - window.iso.depth, p.z)
      c.lookAt(p.x + 30, p.y - window.iso.depth + window.iso.pitch, p.z)
      c.updateMatrixWorld(true)
      const effect = g.systems.find(system => system.underwater)
      effect.underwater.update(.25)
      if (g.postChain) g.postChain.render(g.renderer, g.scene, c, 1000 / 60)
      else g.renderer.render(g.scene, c)
      return { camera: c.matrixWorld.toArray(), blend: effect.underwater.amount,
        postTier: g.postChain?.tier, clouds: g.postChain?.built?.clouds,
        builds: g.postChain?.builds, backend: g.backend }
    }
    const sea = s.terrain.volcanics.newSea.material
    return { spot, level,
      sea: { transparent: sea.transparent, side: sea.side, depthWrite: sea.depthWrite, forceSinglePass: sea.forceSinglePass, envMap: !!sea.envMap, envMapIntensity: sea.envMapIntensity },
      children: s.game.scene.children.map(o => ({ type: o.type, name: o.name, renderOrder: o.renderOrder, visible: o.visible, transparent: o.material?.transparent, depthWrite: o.material?.depthWrite, sky: !!(o.sunDirection && o.betaR), kids: o.children.length })) }
  })
  const shot = async (name, before, after) => {
    if (before) await page.evaluate(before)
    // Two settled draws let the newly selected post graph compile before capture.
    await page.evaluate(() => window.isoRender())
    await page.waitForTimeout(250)
    const frame = await page.evaluate(() => window.isoRender())
    report.frames.push({ name, ...frame })
    await page.screenshot({ path: `${out}/${name}.png` }); report.shots.push(name)
    if (after) await page.evaluate(after)
  }
  await shot('a-normal')
  report.underwater = await page.evaluate(async () => {
    const effect = window.syn3h.game.systems.find(s => s.underwater)
    for (let i = 0; i < 90; i++) effect.bubbles.update(1 / 30, true)
    const sampled = effect.bubbles.field.particles.map(p => ({ particle: p, y: p.y }))
    for (let i = 0; i < 20; i++) effect.bubbles.update(1 / 30, true)
    const surviving = sampled.filter(p => effect.bubbles.field.particles.includes(p.particle))
    return { blend: effect.underwater.amount, bubbles: effect.bubbles.field.particles.length,
      tracked: surviving.length, rises: surviving.map(p => p.particle.y - p.y) }
  })
  await shot('a-clouds-off', () => window.syn3h.params.set('post.clouds', 0), () => window.syn3h.params.set('post.clouds', 1))
  await shot('b-water-hidden', () => { window.syn3h.terrain.volcanics.group.visible = false }, () => { window.syn3h.terrain.volcanics.group.visible = true })
  await shot('c-no-reflection', () => window.syn3h.params.set('water.reflection', 0), () => window.syn3h.params.set('water.reflection', 1))
  await shot('d-sky-hidden', () => { const sky = window.syn3h.game.scene.children.find(o => o.sunDirection && o.betaR); window.isoSky = sky; sky.visible = false }, () => { window.isoSky.visible = true })
  await shot('e-underwater-off', () => window.syn3h.params.set('water.underwater', false), () => window.syn3h.params.set('water.underwater', true))
  await shot('f-up', () => { window.iso.pitch = 40 })
  await shot('g-above', () => { window.iso.depth = -2; window.iso.pitch = 6 })
  await shot('h-above-clouds-off', () => window.syn3h.params.set('post.clouds', 0))
  const normal = report.frames.find(f => f.name === 'a-normal')
  const isolated = report.frames.find(f => f.name === 'a-clouds-off')
  if (JSON.stringify(normal.camera) !== JSON.stringify(isolated.camera)) throw Error('Camera changed in cloud comparison')
  if (normal.blend !== 1 || isolated.blend !== 1) throw Error('Underwater blend did not settle')
  if (backend === 'webgpu' && !normal.clouds) throw Error('Volumetric cloud pass was not active')
  if (!report.underwater.tracked || report.underwater.rises.some(d => !(d > 0))) throw Error('No tracked rising bubbles')
} catch (e) { report.errors.push(String(e.stack || e)) } finally {
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2)); await browser.close()
}
console.log(JSON.stringify({ errors: report.errors, shots: report.shots.length }))

if (report.errors.length) process.exitCode = 1
