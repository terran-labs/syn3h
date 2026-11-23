/** Controlled views supplement shots.mjs. Run through tools/heavy.sh after any release hold.
 * node tools/water/audit.mjs BASE OUT MODE [VEHICLE]
 * MODE: wake, wind, mist, falls, current, vehicle. Each invocation closes its browser.
 * WATER_HEADED=1 measures a real window; falls also measures sheet-on/off render cost.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'

const [base, out, mode = 'wake', kind = 'buggy'] = process.argv.slice(2)
if (!base || !out) throw new Error('Provide a preview origin and output directory')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: process.env.WATER_HEADED !== '1',
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = { mode, kind, errors: [], samples: [] }
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', e => report.errors.push(e.message))
  // Visual and controller diagnostics are isolated from rooms and other players.
  await page.routeWebSocket(/\/ws/, socket => socket.close())
  const url = new URL(base)
  for (const [key, value] of Object.entries({ autoplay: '1', world: mode === 'wind' ? 'volcanic.7' : 'alpine.7', vehicle: kind })) url.searchParams.set(key, value)
  await page.goto(url.href, { waitUntil: 'load', timeout: 120000 })
  await page.waitForFunction(() => window.mira?.game.time > 3, null, { timeout: 120000 })
  const set = values => page.evaluate(values => {
    for (const [id, value] of Object.entries(values)) window.mira.params.set(id, value, 'local')
  }, values)
  const seconds = async n => {
    const target = await page.evaluate(n => window.mira.game.time + n, n)
    await page.waitForFunction(t => window.mira.game.time >= t, target, { timeout: 120000 })
  }
  await set({ 'bots.count': 0, 'sun.timeOfDay': 12, 'sun.dayLength': 0, 'world.curve': 0,
    'weather.storminess': 0, 'water.waves': true, 'water.sinking': true,
    'water.underwater': false, 'water.ripples': true, 'water.spray': true })
  await seconds(1)
  report.spot = await page.evaluate(mode => {
    const s = window.mira, t = s.terrain
    let p
    if (mode === 'wind') {
      p = t.data.vents.filter(v => v.kind === 'smoke').sort((a, b) => b.size - a.size)[0]
    } else if (mode === 'falls') {
      const mesh = t.volcanics.meshes.find(m => m.mesh.geometry.name === 'waterfall-sheet')?.mesh
      if (mesh) { const c = mesh.geometry.boundingSphere.center; p = { x: c.x, y: c.y, z: c.z } }
    } else if (mode === 'mist') {
      const river = t.data.lava.rivers.find(r => r.drops.length)
      if (river) p = river.points[river.drops[0].steepest.end]
    } else if (mode === 'current') {
      const river = t.data.lava.rivers.find(r => r.points.length > 15)
      if (river) p = river.points[Math.floor(river.points.length / 2)]
    } else {
      const size = t.wrapSize
      outer: for (let x = -size / 2 + 100; x < size / 2 - 100; x += 32) {
        for (let z = -size / 2 + 100; z < size / 2 - 100; z += 32) {
          if (t.liquidKindAt(x, z) === 'water' && t.heightAt(x, z) < -12 && t.heightAt(x + 100, z) < -12) {
            p = { x, y: t.liquidHeightAt(x, z), z }; break outer
          }
        }
      }
    }
    if (!p) throw new Error(`No suitable ${mode} location`)
    window.waterAuditSpot = { x: p.x, y: p.y, z: p.z }
    s.player.teleport({ x: p.x, y: p.y + (mode === 'current' ? -.2 : .3), z: p.z }, -Math.PI / 2)
    // Fixed elevated camera removes chase-camera waterline clipping from effect inspection.
    s.game.add({ update() {
      const q = ['wind', 'mist', 'falls'].includes(mode) ? window.waterAuditSpot : s.player.body.translation()
      s.game.camera.position.set(q.x - (mode === 'wind' ? 16 : 7), q.y + (mode === 'wind' ? 12 : 5), q.z + (mode === 'wind' ? 22 : 10))
      s.game.camera.lookAt(q.x, q.y + (mode === 'wind' ? 12 : 0), q.z)
    } })
    if (mode === 'wake') {
      let x = p.x
      s.game.add({ fixedUpdate(dt) {
        x += 16 * dt
        s.player.body.setTranslation({ x, y: t.liquidHeightAt(x, p.z) + .1, z: p.z }, true)
        s.player.body.setRotation({ x: 0, y: -Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }, true)
        s.player.body.setLinvel({ x: 16, y: 0, z: 0 }, true)
        s.player.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      } })
    }
    return window.waterAuditSpot
  }, mode)
  const sample = async label => {
    report.samples.push({ label, ...await page.evaluate(async () => {
      const s = window.mira, p = s.player.body.translation(), v = s.player.body.linvel()
      const w = await import('/src/world/weather/index.ts')
      const spot = window.waterAuditSpot, wind = w.windDrift(spot.x, spot.y, spot.z, { x: 0, y: 0, z: 0 })
      const effects = s.game.systems.find(system => system.spray)
      return { position: p, velocity: v, surface: s.terrain.liquidHeightAt(p.x, p.z),
        falls: s.terrain.volcanics.meshes.filter(m => m.mesh.geometry.name === 'waterfall-sheet').map(m => ({ vertices: m.mesh.geometry.attributes.position.count, centre: m.mesh.geometry.boundingSphere.center })),
        spray: effects && { emitted: effects.spray.particles?.emitted, ribbons: effects.spray.ribbons?.used, submerged: [...effects.spray.states.values()].map(v => v.submerged) },
        flow: s.terrain.liquidFlowAt(p.x, p.z, { x: 0, z: 0 }), wind }
    }) })
    await page.screenshot({ path: `${out}/${label}.png` })
  }
  if (mode === 'wind' || mode === 'mist') {
    await set({ 'lava.windX': 0, 'lava.windZ': 0 })
    await seconds(2); await sample('calm')
    await set({ 'weather.storminess': .7 })
    await seconds(3); await sample('wind')
    await set({ 'weather.windDirection': 180 })
    await seconds(3); await sample('wind-reversed')
  } else {
    await sample('start')
    for (let i = 1; i <= 5; i++) { await seconds(2); await sample(`${mode}-${i}`) }
  }
  if (mode === 'vehicle') {
    const key = kind === 'jet' ? 'KeyR' : 'KeyW'
    await page.keyboard.down(key)
    await seconds(3)
    await sample('driven')
    await page.keyboard.up(key)
  }
  if (mode === 'falls') {
    report.cost = await page.evaluate(async () => {
      const g = window.mira.game, r = g.renderer
      const sheets = window.mira.terrain.volcanics.meshes.filter(m => m.mesh.geometry.name === 'waterfall-sheet').map(m => m.mesh)
      r.setAnimationLoop(null)
      r.info.autoReset = false
      const rows = []
      for (const visible of [false, true, false]) {
        for (const mesh of sheets) mesh.visible = visible
        await r.compileAsync(g.scene, g.camera)
        const times = []
        for (let i = 0; i < 35; i++) {
          r.info.reset()
          const start = performance.now()
          r.render(g.scene, g.camera)
          await r.backend.device?.queue.onSubmittedWorkDone()
          if (i >= 5) times.push(performance.now() - start)
          await new Promise(resolve => setTimeout(resolve, 0))
        }
        times.sort((a, b) => a - b)
        rows.push({ visible, medianMs: times[Math.floor(times.length / 2)], calls: r.info.render.drawCalls })
      }
      return { sheets: sheets.length, rows }
    })
    report.cost.headed = process.env.WATER_HEADED === '1'
  }
} finally {
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify(report, null, 2))
