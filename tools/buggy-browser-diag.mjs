// Buggy browser diagnosis: does the real game drive like the headless sim?
//
//   MIRA_URL=http://127.0.0.1:5391/ node tools/buggy-browser-diag.mjs [--speed 30] [--presets Assisted,Balanced]
//
// Splits a sim/browser disagreement into harness, browser and terrain in one run:
//   A. The sim in the page. It imports tests/vehicles/miraScenarios.ts from the dev server and
//      runs the kicked slide and the full-lock step on the game's own modules. If A matches the
//      node sim, the code and the physics build are the same.
//   B. The real local player on a flat slab. It adds a 4 km flat collider 600 m above the player
//      in the terrain group and drops the player's buggy on it. Input and recording are scripted
//      per fixed physics step through the player's own fixedUpdate, so the full local-player path
//      runs (game input state, localSafety, the frame loop), and the frame rate cannot skew it.
//      If B matches A, the game's player path is the sim's; a difference left over on real
//      ground is the terrain's.
// It prints the peak slide angle (nose against travel), the seconds to settle after letting go,
// the least upright (1 level) and the fewest wheels down for each preset.
//
// It needs a Vite dev server for this checkout (a built page cannot import the scenarios).
// Run the server, this, and the server's stop inside one tools/heavy.sh job, on private ports
// (MIRA_ROOM_PORT, MIRA_VITE_CACHE), and stop the server by the PID you started. Written for the
// default handling change of 26 November 2026, when two buggy branches saw the sim and the game
// disagree; for that one the cause was terrain, not the harness.
import './lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import { browserEnv } from './lib/safe-env.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback }
const base = process.env.MIRA_URL
if (!base) { console.error('Set MIRA_URL to your own dev server, for example http://127.0.0.1:5391/'); process.exit(2) }
const speed = Number(arg('speed', 30))
const presets = arg('presets', 'Assisted,Balanced').split(',')

const browser = await chromium.launch({ channel: 'chrome', headless: true, env: browserEnv(), args: ['--enable-unsafe-webgpu'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []; page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}?autoplay=1&room=buggy-diag-${Date.now()}`)
  await page.waitForFunction(() => window.mira?.game.tick > 30 && window.mira.player, null, { timeout: 180000 })
  await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 180000 })
  // The idle autopilot would take the wheel during a long run.
  await page.evaluate(() => window.mira.params.set('daydream.seconds', 0, 'local'))
  console.log('player:', await page.evaluate(() => `${window.mira.player.constructor.name}, kind ${window.mira.player.kind}, local ${window.mira.player.isLocal}`))

  // A. The sim scenarios, in the page.
  const a = await page.evaluate(async ({ presets, speed }) => {
    const sc = await import('/tests/vehicles/miraScenarios.ts')
    const { BUGGY_PRESETS } = await import('/src/vehicles/buggyParams.ts')
    const { params } = await import('/shared/params.ts')
    const keep = Object.fromEntries(params.all().map((p) => [p.def.id, p.value]))
    const use = (name) => { sc.resetParams(); for (const [id, v] of Object.entries(BUGGY_PRESETS.find((p) => p.name === name)?.values ?? {})) params.set(id, v) }
    const out = []
    for (const name of presets) {
      use(name); const k = await sc.kick(speed, 40, true)
      use(name); const l = await sc.fullLock(speed, 1)
      out.push(`${name}: 40 deg slide, counter-steer: recovered ${Number.isFinite(k.recovered) ? `${k.recovered.toFixed(2)} s` : 'never'}; full lock 1 s: peak slide ${l.worstSlip.toFixed(1)} deg`)
    }
    for (const [id, v] of Object.entries(keep)) params.set(id, v)
    return out
  }, { presets, speed }).catch((e) => [`failed: ${e.message.slice(0, 300)}`])
  for (const line of a) console.log(`A sim in the page at ${speed} m/s, ${line}`)

  // B. The real player on a flat slab.
  const slab = await page.evaluate(async () => {
    const ph = await import('/src/core/physics.ts')
    const m = window.mira, p0 = m.player.body.translation()
    const y = Math.max(m.terrain.heightAt(p0.x, p0.z), 0) + 600
    m.game.world.createCollider(ph.RAPIER.ColliderDesc.cuboid(2000, 1, 2000).setTranslation(p0.x, y - 1, p0.z).setFriction(1).setCollisionGroups(ph.groups(ph.GROUP_TERRAIN, ph.GROUP_ALL)))
    return { x: p0.x, y, z: p0.z }
  })
  await page.evaluate((speed) => {
    const m = window.mira, p = m.player, fixed = p.fixedUpdate.bind(p), post = p.postPhysics.bind(p)
    // Signed angle (degrees) from the nose (local -Z) to the velocity, as miraScenarios.slip.
    const slip = (b) => { const r = b.rotation(), v = b.linvel(); const fx = -2 * (r.x * r.z + r.w * r.y), fz = -(1 - 2 * (r.x * r.x + r.y * r.y)); return Math.atan2(fz * v.x - fx * v.z, fx * v.x + fz * v.z) * 180 / Math.PI }
    window.__diag = null
    p.fixedUpdate = (dt) => {
      const j = window.__diag, s = m.game.input.state
      if (j) {
        j.t += dt
        const b = p.body, v = b.linvel(), sp = Math.hypot(v.x, v.z), sl = slip(b)
        if (j.phase === 'settle' && j.t > 1.5) { j.phase = 'accel'; j.t = 0 }
        else if (j.phase === 'accel' && (sp >= speed || j.t > 60)) {
          j.phase = 'test'; j.t = 0; j.v0 = sp
          if (j.kick) {
            // Yaw the body 40 degrees about world up, as miraScenarios.kick does.
            const r = b.rotation(), a = 40 * Math.PI / 180, sn = Math.sin(a / 2), c = Math.cos(a / 2)
            b.setRotation({ x: c * r.x + sn * r.z, y: c * r.y + sn * r.w, z: c * r.z - sn * r.x, w: c * r.w - sn * r.y }, true)
            b.setAngvel({ x: 0, y: 0, z: 0 }, true)
          }
        }
        s.y = j.phase === 'settle' ? 0 : 1
        s.x = j.phase !== 'test' ? 0 : j.kick ? (Math.abs(sl) > 1 ? Math.sign(sl) : 0) : (j.t <= 1 ? 1 : 0)
      }
      fixed(dt)
    }
    p.postPhysics = (dt) => {
      post(dt)
      const j = window.__diag
      if (!j || j.phase !== 'test') return
      const b = p.body, v = b.linvel(), sp = Math.hypot(v.x, v.z), sl = slip(b), w = b.angvel(), r = b.rotation()
      j.upright = Math.min(j.upright, 1 - 2 * (r.x * r.x + r.z * r.z)); j.wheels = Math.min(j.wheels, p.wheelsGrounded)
      if (sp > 2) j.peak = Math.max(j.peak, Math.abs(sl))
      const after = j.kick ? j.t : j.t - 1
      if (after > 0) { const still = Math.abs(sl) < 3 && Math.abs(w.y) < 0.3; if (still && j.settled === Infinity) j.settled = after; else if (Math.abs(sl) > 6) j.settled = Infinity }
      if (j.t >= (j.kick ? 5 : 7)) { j.done = true; window.__diag = null }
    }
  }, speed)
  const run = async (label, kick) => {
    await page.evaluate((s) => { const m = window.mira; m.player.teleport(new m.player.object.position.constructor(s.x, s.y + 1.5, s.z), 0) }, slab)
    const r = await page.evaluate((kick) => new Promise((resolve) => {
      const j = { phase: 'settle', t: 0, kick, peak: 0, settled: Infinity, upright: 1, wheels: 4 }
      window.__diag = j
      const wait = () => j.done ? resolve({ ...j, settled: Number.isFinite(j.settled) ? j.settled : null }) : setTimeout(wait, 100)
      wait()
    }), kick)
    console.log(`B real player on a flat slab, ${label}: from ${r.v0.toFixed(1)} m/s, peak slide ${r.peak.toFixed(1)} deg, settled ${r.settled === null ? 'never' : `${r.settled.toFixed(2)} s`}, least upright ${r.upright.toFixed(2)}, fewest wheels down ${r.wheels}`)
  }
  for (const name of presets) {
    await page.evaluate(async (name) => {
      const { BUGGY_PRESETS } = await import('/src/vehicles/buggyParams.ts'); const { applyPreset } = await import('/shared/presets.ts')
      const preset = BUGGY_PRESETS.find((p) => p.name === name); if (preset) applyPreset(preset)
    }, name)
    await run(`${name}, full lock 1 s at ${speed} m/s`, false)
    await run(`${name}, 40 deg slide at ${speed} m/s, counter-steer`, true)
  }
  if (errors.length) console.log('page errors:', JSON.stringify(errors.slice(0, 5)))
} finally { await browser.close() }
