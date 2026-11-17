/**
 * Liquid look captures: water and lava from above, below and at the shore, with frame timing.
 *
 *   tools/heavy.sh node tools/liquid-look-shots.mjs http://127.0.0.1:5292/ /tmp/out [scenario,...] [--phone]
 *
 * Headed Chrome (headless paces frames oddly on this machine). One browser, closed at the end.
 * `--phone` uses a 390x844 viewport and 4x CPU throttling. Each scenario writes one or more
 * PNGs and a line of timing (median and p90 frame interval over two seconds of rAF).
 */
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'

const [base = 'http://127.0.0.1:5292/', out = '/tmp/liquid-look', list = '', ...flags] = process.argv.slice(2)
const phone = flags.includes('--phone')
const quality = Number(flags.find(f => f.startsWith('--quality='))?.split('=')[1] ?? 3)
await mkdir(out, { recursive: true })

/** In-page helpers, installed once per page load. */
const helpers = () => {
  const s = window.syn3h
  /** Spiral out from (x0, z0) for a point of liquid `kind` with depth in [min, max]. */
  window.findLiquid = (kind, min, max, x0 = 0, z0 = 0) => {
    const t = s.terrain
    for (let r = 0; r < 1600; r += 6) {
      const n = Math.max(8, Math.round(r / 4))
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r
        if (t.liquidKindAt?.(x, z) !== kind) continue
        const d = t.liquidHeightAt(x, z) - t.heightAt(x, z)
        if (d >= min && d <= max) return { x, z, surface: t.liquidHeightAt(x, z), ground: t.heightAt(x, z), depth: d }
      }
    }
    return null
  }
  /** Direction from a liquid point toward the nearest dry land, radians. */
  window.towardLand = (x, z) => {
    const t = s.terrain
    for (let r = 4; r < 400; r += 4) for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2
      if (!t.liquidKindAt?.(x + Math.cos(a) * r, z + Math.sin(a) * r)) return a
    }
    return 0
  }
  /** Hide every element that is not the canvas or one of its ancestors: a clean frame. */
  window.hideUi = () => {
    const canvas = document.querySelector('canvas')
    for (const el of document.body.querySelectorAll('*')) if (!el.contains(canvas) && el !== canvas) el.style.visibility = 'hidden'
  }
  window.frameStats = (ms = 2000) => new Promise(done => {
    const times = []; let last = performance.now(); const end = last + ms
    const tick = now => { times.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else { times.sort((a, b) => a - b); done({ frames: times.length, median: times[times.length >> 1], p90: times[Math.floor(times.length * 0.9)] }) } }
    requestAnimationFrame(tick)
  })
}

const wait = (page, ms) => page.waitForTimeout(ms)

/**
 * Scenarios. Each loads its planet fresh, places the vehicle and camera, and captures.
 * `pose(page, spot)` returns after placing; `shots` are [name, delay ms] pairs.
 */
const SCENARIOS = {
  'water-above': { planet: 'archipelago', vehicle: 'buggy', hour: 12, kind: 'water', min: 6, max: 30, mode: 'float', shots: [['water-above', 2500]] },
  'water-calm-chase': { planet: 'archipelago', vehicle: 'buggy', hour: 12, kind: 'water', min: 8, max: 40, mode: 'float', params: { 'weather.storminess': 0 }, shots: [['waves-calm', 3000]] },
  'water-rough-chase': { planet: 'archipelago', vehicle: 'buggy', hour: 12, kind: 'water', min: 8, max: 40, mode: 'float', params: { 'water.waveHeight': 3, 'weather.storminess': 1 }, shots: [['waves-rough', 3000]] },
  'water-under-up': { planet: 'archipelago', vehicle: 'buggy', hour: 12, kind: 'water', min: 8, max: 30, mode: 'under', look: 'up', shots: [['water-under-up', 3000]] },
  'water-under-bed': { planet: 'archipelago', vehicle: 'buggy', hour: 12, kind: 'water', min: 6, max: 20, mode: 'under', look: 'bed', shots: [['water-under-bed', 3000]] },
  'sea-2m-calm': { planet: 'archipelago', vehicle: 'buggy', hour: 12, kind: 'water', min: 15, max: 80, mode: 'float', cam: [12, 2], params: { 'weather.storminess': 0 }, shots: [['sea-2m-calm', 3000]] },
  'sea-2m-rough': { planet: 'archipelago', vehicle: 'buggy', hour: 12, kind: 'water', min: 15, max: 80, mode: 'float', cam: [12, 2], params: { 'weather.storminess': 1 }, shots: [['sea-2m-rough', 3000]] },
  'sea-2m-dusk': { planet: 'archipelago', vehicle: 'buggy', hour: 18.6, kind: 'water', min: 15, max: 80, mode: 'float', cam: [12, 2], params: { 'weather.storminess': 0.5 }, shots: [['sea-2m-dusk', 3000]] },
  'sea-30m-rough': { planet: 'archipelago', vehicle: 'buggy', hour: 12, kind: 'water', min: 15, max: 80, mode: 'float', cam: [40, 30], params: { 'weather.storminess': 1 }, shots: [['sea-30m-rough', 3000]] },
  'sea-30m-noref': { planet: 'archipelago', vehicle: 'buggy', hour: 12, kind: 'water', min: 15, max: 80, mode: 'float', cam: [40, 30], params: { 'weather.storminess': 1, 'water.reflection': 0 }, shots: [['sea-30m-noref', 3000]] },
  'sea-30m-novis': { planet: 'archipelago', vehicle: 'buggy', hour: 12, kind: 'water', min: 15, max: 80, mode: 'float', cam: [40, 30], params: { 'weather.storminess': 1, 'water.waveVisual': 0 }, shots: [['sea-30m-novis', 3000]] },
  'sea-30m-nohaze': { planet: 'archipelago', vehicle: 'buggy', hour: 12, kind: 'water', min: 15, max: 80, mode: 'float', cam: [40, 30], params: { 'weather.storminess': 1, 'weather.hazeDensity': 0, 'weather.aerial': 0 }, shots: [['sea-30m-nohaze', 3000]] },
  'sea-30m-calm-dusk': { planet: 'archipelago', vehicle: 'buggy', hour: 18.6, kind: 'water', min: 15, max: 80, mode: 'float', cam: [40, 30], params: { 'weather.storminess': 0 }, shots: [['sea-30m-calm-dusk', 3000]] },
  'dawn-ice': { planet: 'ice', vehicle: 'buggy', hour: 6.5, kind: 'water', min: 10, max: 200, mode: 'horizon', shots: [['dawn-ice', 3000]] },
  'dawn-archipelago': { planet: 'archipelago', vehicle: 'buggy', hour: 6.5, kind: 'water', min: 10, max: 200, mode: 'horizon', shots: [['dawn-archipelago', 3000]] },
  'lagoon': { planet: 'archipelago', vehicle: 'buggy', hour: 12, kind: 'water', min: 0.8, max: 3, mode: 'float', cam: [14, 5], shots: [['lagoon', 3000]] },
  'water-under-night': { planet: 'archipelago', vehicle: 'buggy', hour: 22, kind: 'water', min: 6, max: 20, mode: 'under', look: 'bed', shots: [['water-under-night', 3000]] },
  'water-under-deep': { planet: 'archipelago', vehicle: 'buggy', hour: 12, kind: 'water', min: 25, max: 80, mode: 'under', look: 'bed', shots: [['water-under-deep', 3000]] },
  'water-shore': { planet: 'archipelago', vehicle: 'buggy', hour: 12, kind: 'water', min: 0.3, max: 1.2, mode: 'shore', shots: [['water-shore', 2500]] },
  'lava-day': { planet: 'volcanic', vehicle: 'buggy', hour: 12, kind: 'lava', min: 2, max: 40, mode: 'shore', shots: [['lava-day', 2500]] },
  'lava-night': { planet: 'volcanic', vehicle: 'buggy', hour: 0, kind: 'lava', min: 2, max: 40, mode: 'shore', shots: [['lava-night', 2500]] },
  'lava-shore-day': { planet: 'volcanic', vehicle: 'buggy', hour: 12, kind: 'lava', min: 0.2, max: 1.2, mode: 'shore', shots: [['lava-shore-day', 2500]] },
  'lava-shore-night': { planet: 'volcanic', vehicle: 'buggy', hour: 0, kind: 'lava', min: 0.2, max: 1.2, mode: 'shore', shots: [['lava-shore-night', 2500]] },
  'lava-churn': { planet: 'volcanic', vehicle: 'buggy', hour: 18.5, kind: 'lava', min: 1, max: 3, mode: 'drive', shots: [['lava-churn-0', 1200], ['lava-churn-1', 500], ['lava-churn-2', 500]] },
  'lava-under': { planet: 'volcanic', vehicle: 'buggy', hour: 12, kind: 'lava', min: 6, max: 40, mode: 'under', look: 'level', shots: [['lava-under', 3000]] },
  'lava-cockpit': { planet: 'volcanic', vehicle: 'buggy', hour: 20, kind: 'lava', min: 6, max: 40, mode: 'cockpit', shots: [['lava-cockpit-0', 600], ['lava-cockpit-1', 1500]] },
  'water-entry': { planet: 'archipelago', vehicle: 'buggy', hour: 16, kind: 'water', min: 8, max: 40, mode: 'dive', shots: [['entry-0', 900], ['entry-1', 180], ['entry-2', 180], ['entry-3', 220], ['entry-4', 300], ['entry-5', 450]] },
  'water-splash': { planet: 'archipelago', vehicle: 'buggy', hour: 16, kind: 'water', min: 8, max: 40, mode: 'splash', impact: [24, -18], shots: [['splash-0', 60], ['splash-1', 220], ['splash-2', 260], ['splash-3', 320], ['splash-4', 420], ['splash-5', 600]] },
  'water-splash-slow': { planet: 'archipelago', vehicle: 'buggy', hour: 16, kind: 'water', min: 8, max: 40, mode: 'splash', impact: [2, -3], shots: [['splash-slow-0', 60], ['splash-slow-1', 300], ['splash-slow-2', 600]] },
  'water-wake': { planet: 'archipelago', vehicle: 'buggy', hour: 15, kind: 'water', min: 3, max: 30, mode: 'skim', shots: [['wake-0', 250], ['wake-1', 350]] },
  'waterline': { planet: 'archipelago', vehicle: 'buggy', hour: 12, kind: 'water', min: 8, max: 30, mode: 'cross', shots: [['waterline-0', 2500], ['waterline-1', 250], ['waterline-2', 150], ['waterline-3', 150], ['waterline-4', 150], ['waterline-5', 250]] },
}

const chosen = list ? list.split(',') : Object.keys(SCENARIOS)
const browser = await chromium.launch({ channel: 'chrome', headless: false, // Uncapped frames tear screenshots: only for timing runs (--uncapped).
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', ...(flags.includes('--uncapped') ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])] })
const results = {}
try {
  for (const name of chosen) {
    const sc = SCENARIOS[name]
    if (!sc) { console.log(`unknown scenario ${name}`); continue }
    const page = await browser.newPage({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 720 }, deviceScaleFactor: phone ? 3 : 1 })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    await page.routeWebSocket(/\/ws/, socket => socket.close())
    if (phone) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }) }
    await page.goto(`${base}?autoplay=1&vehicle=${sc.vehicle}&planet=${sc.planet}&seed=1`)
    await page.waitForFunction(() => window.syn3h?.game.tick > 10, null, { timeout: 120000 })
    await page.evaluate(helpers)
    const spot = await page.evaluate(({ sc, quality }) => {
      const s = window.syn3h
      s.params.set('bots.count', 0); s.params.set('sun.timeOfDay', sc.hour); s.params.set('sun.dayLength', 0)
      s.params.set('gfx.quality', quality)
      // Provisional shared wave numbers from the liquid-feel builder (not the shipped defaults).
      s.params.set('water.waveHeight', 2.4); s.params.set('water.waveLength', 36)
      for (const [k, v] of Object.entries(sc.params ?? {})) s.params.set(k, v)
      const spot = window.findLiquid(sc.kind, sc.min, sc.max, s.player.body.translation().x, s.player.body.translation().z)
      if (!spot) return null
      const land = window.towardLand(spot.x, spot.z)
      spot.land = land
      const input = s.game.input.external
      const cam = s.camera
      const V = s.game.camera.position.constructor
      if (sc.mode === 'float' || sc.mode === 'drive') {
        // Face along the shore so the liquid fills the view.
        s.player.teleport({ x: spot.x, y: spot.surface + 1.5, z: spot.z }, land + Math.PI / 2)
        if (sc.mode === 'drive') { input.y = 1; input.x = 0.15 }
      } else if (sc.mode === 'dive') {
        // Launched from 50 m out and 14 m up so it hits the water at about 30 m/s near the
        // spot; the camera holds still 25 m to the side, 5 m up, watching the impact.
        const h = land + Math.PI, back = 50
        s.player.teleport({ x: spot.x - Math.cos(h) * back, y: spot.surface + 14, z: spot.z - Math.sin(h) * back }, h)
        s.player.body.setLinvel({ x: Math.cos(h) * 30, y: -6, z: Math.sin(h) * 30 }, true)
        const side = h + Math.PI / 2
        s.camera.setCinematicPose(new V(spot.x + Math.cos(side) * 25, spot.surface + 5, spot.z + Math.sin(side) * 25), new V(spot.x, spot.surface + 2, spot.z))
      } else if (sc.mode === 'splash') {
        // Park the player far away; the splash is driven straight through the water effects.
        const h = land + Math.PI, side = h + Math.PI / 2
        window.splashAt = { x: spot.x, y: spot.surface, z: spot.z, h }
        s.camera.setCinematicPose(new V(spot.x + Math.cos(side) * 22, spot.surface + 4, spot.z + Math.sin(side) * 22), new V(spot.x, spot.surface + 2.5, spot.z))
      } else if (sc.mode === 'skim') {
        // Thrown flat along the water, away from land, at speed: bow spray, rooster tail, wake.
        const h = land + Math.PI
        s.player.teleport({ x: spot.x, y: spot.surface + 0.6, z: spot.z }, h)
        s.player.body.setLinvel({ x: Math.cos(h) * 30, y: 0, z: Math.sin(h) * 30 }, true)
        input.y = 1
      } else if (sc.mode === 'shore') {
        // On the land, looking out over the liquid.
        const d = 14
        const x = spot.x + Math.cos(land) * d, z = spot.z + Math.sin(land) * d
        s.player.teleport({ x, y: s.terrain.heightAt(x, z) + 2, z }, land + Math.PI)
      } else if (sc.mode === 'cockpit') {
        // First person, the vehicle pushed down under the lava.
        s.params.set('camera.mode', 1)
        s.player.teleport({ x: spot.x, y: spot.surface - 1.8, z: spot.z }, land)
      } else if (sc.mode === 'under' || sc.mode === 'cross') {
        s.player.teleport({ x: spot.x, y: spot.ground + 1.2, z: spot.z }, land)
      }
      return spot
    }, { sc, quality })
    if (!spot) { results[name] = { error: 'no liquid spot' }; await page.close(); continue }
    await wait(page, 1500)
    if (sc.mode === 'horizon') {
      // Over open water, looking toward the sun at the horizon.
      await page.evaluate(({ spot }) => {
        const s = window.syn3h, V = s.game.camera.position.constructor
        const sky = s.game.scene.children.find(o => 'sunDirection' in o)
        const d = sky?.sunDirection?.value ?? { x: 1, z: 0 }, len = Math.hypot(d.x, d.z) || 1
        s.camera.setCinematicPose(new V(spot.x, spot.surface + 6, spot.z), new V(spot.x + d.x / len * 400, spot.surface + 6, spot.z + d.z / len * 400))
      }, { spot })
    }
    if (sc.mode === 'shore' || sc.mode === 'float') {
      await page.evaluate(({ sc, spot }) => {
        const s = window.syn3h, V = s.game.camera.position.constructor
        const back = sc.cam?.[0] ?? (sc.mode === 'shore' ? 22 : 16), a = spot.land
        const x = spot.x + Math.cos(a) * back, z = spot.z + Math.sin(a) * back
        const y = Math.max(s.terrain.heightAt(x, z), spot.surface) + (sc.cam?.[1] ?? (sc.mode === 'shore' ? 5 : 3.5))
        const fx = spot.x - Math.cos(a) * 30, fz = spot.z - Math.sin(a) * 30
        s.camera.setCinematicPose(new V(x, y, z), new V(fx, spot.surface, fz))
      }, { sc, spot })
    }
    if (sc.mode === 'under' || sc.mode === 'cross') {
      await page.evaluate(({ sc, spot }) => {
        const s = window.syn3h, p = s.player.body.translation()
        const V = s.game.camera.position.constructor
        const y = sc.mode === 'cross' ? spot.surface + 1.2 : Math.min(spot.surface - 2, p.y + 1.5)
        const pos = new V(p.x - Math.cos(spot.land) * 6, y, p.z - Math.sin(spot.land) * 6)
        const tgt = sc.look === 'up' ? new V(p.x + Math.cos(spot.land) * 3, spot.surface + 8, p.z + Math.sin(spot.land) * 3)
          : sc.look === 'bed' ? new V(p.x + Math.cos(spot.land) * 10, spot.ground, p.z + Math.sin(spot.land) * 10)
          : new V(p.x + Math.cos(spot.land) * 10, y, p.z + Math.sin(spot.land) * 10)
        s.camera.setCinematicPose(pos, tgt)
        window.crossPose = { pos, tgt, spot }
      }, { sc, spot })
    }
    if (sc.mode === 'splash') {
      await wait(page, 2500)
      await page.evaluate(([h, v]) => {
        const s = window.syn3h, a = window.splashAt
        const fx = s.game.systems.find(x => x.spray && x.underwater)
        const P = s.game.camera.position.constructor
        const at = new P(a.x, a.y, a.z), vel = new P(Math.cos(a.h) * h, v, Math.sin(a.h) * h)
        fx.spray.vehicle('splash-demo', at, vel, 0, 1 / 60)
        fx.spray.vehicle('splash-demo', at, vel, 1, 1 / 60)
      }, sc.impact)
    }
    const shots = []
    for (const [shot, delay] of sc.shots) {
      await wait(page, delay)
      if (sc.mode === 'cross' && shot === sc.shots[1][0]) {
        // One move of the wanted lens from above the surface to well below it; the lens rule
        // carries the camera through the surface over about a second.
        await page.evaluate(() => { const c = window.crossPose; c.pos.y -= 3; c.tgt.y -= 3; window.syn3h.camera.setCinematicPose(c.pos, c.tgt) })
      }
      await page.evaluate(() => window.hideUi())
      const path = `${out}/${shot}${phone ? '-phone' : ''}.png`
      await page.screenshot({ path })
      shots.push(path)
    }
    const timing = await page.evaluate(ms => window.frameStats(ms), Number(flags.find(f => f.startsWith('--ms='))?.split('=')[1] ?? 2000))
    const state = await page.evaluate(() => {
      const s = window.syn3h, c = s.game.camera.position, p = s.player.body.translation()
      return { camera: c.toArray().map(v => +v.toFixed(2)), vehicle: [p.x, p.y, p.z].map(v => +v.toFixed(2)), liquidAtCamera: +(s.terrain.liquidHeightAt?.(c.x, c.z) ?? NaN).toFixed(2), lavaDepth: s.player.lavaDepth, info: s.game.renderer.info?.render }
    })
    results[name] = { spot, timing, state, shots, errors: errors.slice(0, 5) }
    console.log(name, JSON.stringify({ timing, state: { ...state, info: undefined }, errors: errors.length }))
    await page.close()
  }
} finally {
  await browser.close()
  await writeFile(`${out}/results${phone ? '-phone' : ''}.json`, JSON.stringify(results, null, 2))
}
