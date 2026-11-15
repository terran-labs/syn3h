/** Spray, wake and splash evidence through ordinary entry.
 * node tools/water/spray-check.mjs BASE OUT [prefix] [visual|cost]
 * Run through the shared heavy limiter, one browser at a time. Adapted from
 * water-transparency-check.mjs. The player is driven by setting its velocity every fixed step
 * (not teleported) so the real WaterEffects path makes the spray.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
const [base, out, prefix = 'after', mode = 'visual'] = process.argv.slice(2)
if (!base || !out) throw Error('BASE and OUT required')
mkdirSync(out, { recursive: true })
const report = { prefix, mode, errors: [], cases: [] }
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', e => report.errors.push(e.message))
try {
  const url = new URL(base); url.searchParams.set('room', `spray-${Date.now()}`); url.searchParams.set('name', 'S'); url.searchParams.set('vehicle', process.env.SPRAY_VEHICLE ?? 'buggy')
  await page.goto(url.href, { waitUntil: 'load', timeout: 120000 })
  await page.waitForFunction(() => window.syn3h?.shell, null, { timeout: 120000 })
  await page.evaluate(() => window.syn3h.shell.play())
  await page.waitForFunction(() => window.syn3hNet?.connected && window.syn3h.game.time > 3, null, { timeout: 120000 })
  const planet = process.env.SPRAY_PLANET ?? 'alpine', seed = Number(process.env.SPRAY_SEED ?? 7)
  report.planet = { planet, seed }
  await page.evaluate(async ({ planet, seed }) => {
    const s = window.syn3h
    const { applyPlanet } = await import('/src/world/planets.ts')
    applyPlanet(planet, seed)
    for (const [id, value] of Object.entries({ 'bots.count': 0, 'gfx.auto': false, 'gfx.level': 2, 'sun.timeOfDay': 12, 'sun.dayLength': 0, 'world.curve': 0, 'weather.storminess': 0 })) s.params.set(id, value)
  }, { planet, seed })
  await page.waitForTimeout(2500)
  // A straight run of open sea along -z (the vehicles' forward axis with no rotation).
  report.run = await page.evaluate(() => {
    const s = window.syn3h, t = s.terrain, size = t.wrapSize, sea = s.params.get('world.lavaAltitude').value
    const deep = (x, z) => t.liquidKindAt(x, z) === 'water' && sea - t.heightAt(x, z) > 4
    for (let x = -size / 2 + 40; x < size / 2 - 40; x += 10) for (let z = -size / 2 + 200; z < size / 2 - 40; z += 10) {
      let ok = true
      for (let d = 0; d <= 180 && ok; d += 6) for (const w of [-20, 0, 20]) if (!deep(x + w, z - d)) { ok = false; break }
      // Room for a tight circle at the start of the run.
      for (let a = 0; a < 6.28 && ok; a += .4) for (const r of [10, 20, 30]) if (!deep(x + Math.cos(a) * r, z - 30 + Math.sin(a) * r)) { ok = false; break }
      if (ok) return window.sprayRun = { x, z, sea }
    }
    throw Error('No open sea run')
  })
  await page.evaluate(() => {
    const s = window.syn3h, e = s.game.systems.find(x => x.underwater && x.spray)
    window.sprayEffects = e
    // Real wave heights for the wake if this build accepts them (WaterEffects passes nothing yet).
    e.spray.setWater?.(s.terrain)
    window.sprayRunInfo = { mode: 'idle', speed: 0, view: 'chase', x: 0, y: 0, z: 0 }
    const camera = { update() {
      const q = window.sprayRunInfo, p = s.player.body.translation(), c = s.game.camera
      if (q.mode === 'idle') return
      if (q.view === 'chase') { c.position.set(p.x + 3, p.y + 4.5, p.z + 13); c.lookAt(p.x, p.y + .3, p.z - 4) }
      else if (q.view === 'side') { c.position.set(p.x + 15, p.y + 2.2, p.z + 4); c.lookAt(p.x, p.y + .4, p.z + 3) }
      else if (q.view === 'high') { c.position.set(p.x + 9, p.y + 16, p.z + 22); c.lookAt(p.x, p.y, p.z + 6) }
      else if (q.view === 'circle') { c.position.set(q.cx + 4, q.cy + 30, q.cz + 30); c.lookAt(q.cx, q.cy, q.cz) }
      else if (q.view === 'drop') { c.position.set(q.x + 12, q.y + 4, q.z + 12); c.lookAt(q.x, q.y + 1, q.z) }
    }, fixedUpdate() {
      const q = window.sprayRunInfo; if (q.mode === 'idle') return
      const b = s.player.body
      if (q.mode === 'drive') {
        // Heading theta from -z, turning toward +x: a tight circle or an S-curve.
        const t = s.game.time - (q.t0 ?? 0)
        const theta = q.path === 'circle' ? q.speed / 12 * t : q.path === 'scurve' ? .55 * Math.sin(.8 * t) : 0
        b.setRotation({ x: 0, y: Math.sin(-theta / 2), z: 0, w: Math.cos(-theta / 2) }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true)
        // Hold the hull at the waterline with a vertical servo, like a planing hull, so a slow
        // wade does not sink: still velocity, never a teleport.
        const p = b.translation(), surface = s.terrain.liquidHeightAt(p.x, p.z)
        b.setLinvel({ x: q.speed * Math.sin(theta), y: Math.max(-6, Math.min(6, (surface + (q.lift ?? .05) - p.y) * 6)), z: -q.speed * Math.cos(theta) }, true)
      } else if (q.mode === 'drop') { const v = b.linvel(); b.setLinvel({ x: 0, y: v.y, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true) }
    } }
    s.game.systems.splice(s.game.systems.indexOf(e), 0, camera)
  })
  const start = async (speed, view, path = 'straight') => page.evaluate(({ speed, view, path }) => {
    const s = window.syn3h, r = window.sprayRunInfo, run = window.sprayRun
    // A circle of radius 12 m whose centre is 12 m to the right of the start, 30 m down the run.
    const x = path === 'circle' ? run.x - 12 : run.x, z = path === 'circle' ? run.z - 30 : run.z
    Object.assign(r, { mode: 'drive', speed, view, path, t0: s.game.time, cx: run.x, cy: run.sea, cz: run.z - 30 })
    s.player.body.setTranslation({ x, y: run.sea + .1, z }, true)
    s.player.body.setLinvel({ x: 0, y: 0, z: -speed }, true)
  }, { speed, view, path })
  const shot = async (label, extra = {}) => {
    const state = await page.evaluate(() => {
      const s = window.syn3h, sp = window.sprayEffects.spray, sim = sp.state ?? sp.sim, p = s.player.body.translation()
      const meshes = s.game.scene.children.filter(o => /spray|foam|ribbon/.test(o.name ?? '') || o.geometry?.isInstancedBufferGeometry)
      return { player: [p.x, p.y, p.z], surface: s.terrain.liquidHeightAt(p.x, p.z), velocity: s.player.body.linvel(),
        sim: sim && { droplets: sim.dropletCount, wakePoints: sim.wakePoints, rings: sim.ringCount },
        info: { ...s.game.renderer.info.render }, perf: { drawCalls: s.game.performance?.drawCalls, triangles: s.game.performance?.triangles } }
    })
    await page.screenshot({ path: `${out}/${prefix}-${label}.png` })
    report.cases.push({ label, ...extra, ...state })
  }
  if (mode === 'visual') {
    for (const [time, tag] of [[12, 'day'], [23.5, 'night']]) {
      await page.evaluate(t => window.syn3h.params.set('sun.timeOfDay', t), time)
      await start(22, 'chase'); await page.waitForTimeout(3500); await shot(`${tag}-skim-chase`)
      await start(22, 'side'); await page.waitForTimeout(3500); await shot(`${tag}-skim-side`)
      if (tag === 'day') {
        await start(22, 'high'); await page.waitForTimeout(3500); await shot(`${tag}-skim-high`)
        await start(14, 'circle', 'circle'); await page.waitForTimeout(5000); await shot(`${tag}-circle`)
        await start(20, 'high', 'scurve'); await page.waitForTimeout(5500); await shot(`${tag}-scurve`)
        await start(8, 'chase'); await page.waitForTimeout(4000); await shot(`${tag}-slow8`)
      }
      await start(2.5, 'chase'); await page.waitForTimeout(4000); await shot(`${tag}-wade`)
      await start(0, 'chase'); await page.waitForTimeout(3000); await shot(`${tag}-stationary`)
      // Entry splash: drop from 9 m and capture just after contact.
      await page.evaluate(() => {
        const s = window.syn3h, r = window.sprayRunInfo, run = window.sprayRun
        Object.assign(r, { mode: 'drop', view: 'drop', x: run.x, y: run.sea, z: run.z - 60 })
        s.player.body.setTranslation({ x: run.x, y: run.sea + 9, z: run.z - 60 }, true); s.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      })
      await page.waitForFunction(() => { const p = window.syn3h.player.body.translation(); return p.y < window.sprayRun.sea + .8 }, null, { timeout: 10000, polling: 'raf' })
      await page.waitForTimeout(60); await shot(`${tag}-splash`)
      await page.waitForTimeout(450); await shot(`${tag}-splash-late`)
    }
  }
  if (mode === 'cost') {
    for (const tier of [0, 1, 2]) {
      await page.evaluate(t => window.syn3h.params.set('gfx.level', t), tier)
      // Warm up dry: the spray allocates and draws empty.
      await page.evaluate(() => { const s = window.syn3h, run = window.sprayRun; window.sprayRunInfo.mode = 'idle'; s.player.body.setTranslation({ x: run.x, y: run.sea + 30, z: run.z }, true) })
      await page.waitForTimeout(3000)
      await page.evaluate(() => {
        const b = window.syn3h.game.renderer.backend
        window.sprayCounts = { pipelines: 0, stacks: [] }
        if (!window.sprayWrapped) {
          window.sprayWrapped = true
          const original = b.createRenderPipeline
          b.createRenderPipeline = function (...args) { window.sprayCounts.pipelines++; window.sprayCounts.stacks.push(args[0]?.object?.name || args[0]?.material?.type || '?'); return original.apply(this, args) }
        }
      })
      await start(22, 'chase'); await page.waitForTimeout(3500)
      const cost = await page.evaluate(async () => {
        const s = window.syn3h, sp = window.sprayEffects.spray, sim = sp.state
        const meshes = s.game.scene.children.filter(o => o.name === 'water-spray' || o.name === 'water-foam')
        const sample = async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); return { ...s.game.renderer.info.render } }
        const on = await sample()
        meshes.forEach(m => m.visible = false); const off = await sample(); meshes.forEach(m => m.visible = true)
        return { level: s.params.get('gfx.level').value, capacity: sim.cap, meshes: meshes.map(m => ({ name: m.name, instances: m.geometry.instanceCount, capacity: m.geometry.attributes[Object.keys(m.geometry.attributes).find(k => /A$/.test(k))].count })),
          sim: { droplets: sim.dropletCount, wakePoints: sim.wakePoints }, withSpray: on, withoutSpray: off, pipelinesAfterContact: window.sprayCounts.pipelines, created: window.sprayCounts.stacks }
      })
      report.cases.push({ tier, cost }); console.log(JSON.stringify({ tier, cost }))
    }
  }
} catch (e) { report.failure = e.stack; throw e }
finally { writeFileSync(`${out}/${prefix}-${mode}-report.json`, JSON.stringify(report, null, 2)); await browser.close() }
