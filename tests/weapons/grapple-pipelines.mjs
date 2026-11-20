/**
 * What the Grapple builds in play after the covered world entry (Game.precompile): render
 * pipelines and shader modules, counted exactly while it is first used, a cord caught on the
 * ground and on a bot, let go, severed, and a hook that misses and sails away. The owner's rule:
 * a freeze in play is worse than a longer load. Prints the counts and labels per phase; exits 1
 * if anything the Grapple draws was built (labels "gear bungee ...").
 *
 *   SYN3H_URL=http://127.0.0.1:<port>/ tools/heavy.sh node tests/weapons/grapple-pipelines.mjs
 */
import { chromium } from 'playwright-core'

const base = (process.env.SYN3H_URL ?? 'http://127.0.0.1:5433/').replace(/\/+$/, '') + '/'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = []
let report
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('pageerror', e => errors.push(e.message))
  const url = new URL(base)
  url.searchParams.set('world', 'alpine.7~sun.dayLength=0,sun.timeOfDay=14')
  url.searchParams.set('autoplay', '1')
  url.searchParams.set('room', `grapple-pipelines-${Date.now()}`)
  await page.goto(url.href)
  await page.waitForFunction(() => window.syn3h?.shell?.playing && !window.syn3h.game.input.suspended && window.syn3hNet?.bungee && window.syn3h.game.tick > 60, null, { timeout: 180000 })
  await page.evaluate(() => { const p = window.syn3h.params; p.set('gfx.auto', false); p.set('bots.canDrive', false); p.set('bots.canFire', false); p.set('bots.count', 1); p.set('daydream.seconds', 0); p.set('bungee.cooldown', 0); p.set('bungee.hookSpeed', 60) })
  await page.waitForFunction(() => window.syn3h.bots.vehicles.length === 1, null, { timeout: 60000 })
  await page.waitForTimeout(3000)
  const backend = await page.evaluate(() => {
    const r = window.syn3h.game.renderer, device = r.backend.device, log = window.__built = []
    if (device) {
      for (const name of ['createRenderPipeline', 'createRenderPipelineAsync']) {
        const real = device[name].bind(device)
        device[name] = d => { log.push({ phase: window.__phase, kind: 'pipeline', label: String(d.label) }); return real(d) }
      }
      const real = device.createShaderModule.bind(device)
      device.createShaderModule = d => { log.push({ phase: window.__phase, kind: 'module', label: String(d.label) }); return real(d) }
    }
    window.__phase = 'idle'
    return r.backend.isWebGPUBackend ? 'webgpu' : 'webgl2'
  })
  await page.waitForTimeout(2000)
  // The bot held still 20 m ahead and 6 m up; the player held still too.
  await page.evaluate(() => {
    const s = window.syn3h, bot = s.bots.vehicles[0], p = s.player.body.translation()
    const f = s.game.camera.getWorldDirection(s.player.object.position.clone()); f.y = 0; f.normalize()
    window.__f = [f.x, f.z]
    const y = s.terrain.heightAt(p.x, p.z) + 1.5, bx = p.x + f.x * 20, bz = p.z + f.z * 20
    for (const [v, x, z, h] of [[s.player, p.x, p.z, y], [bot, bx, bz, Math.max(y, s.terrain.heightAt(bx, bz) + 1.5) + 6]]) {
      v.teleport(s.player.object.position.clone().set(x, h, z), Math.atan2(-f.x, -f.z))
      v.body.setGravityScale(0, true); v.body.setLinvel({ x: 0, y: 0, z: 0 }, true); v.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    }
    window.syn3hNet.gear.select('bungee')
  })
  await page.waitForTimeout(1000)
  const phase = (name, fn) => page.evaluate(([name, fn]) => { window.__phase = name; return new Function(fn)() }, [name, fn])
  const B = 'const s = window.syn3h, n = window.syn3hNet, b = n.bungee, [fx, fz] = window.__f;'
  // A cord on the ground, reeled, let go.
  await phase('ground', `${B} return b.launch([fx, -0.35, fz])`)
  await page.waitForFunction(() => window.syn3hNet.bungee.attached, null, { timeout: 5000 })
  await page.waitForTimeout(1200)
  await phase('released', `${B} b.letGo('released')`)
  await page.waitForTimeout(1500)
  // A cord on the bot, severed.
  await phase('bot', `${B} const a = s.player.body.translation(), t = s.bots.vehicles[0].body.translation(); return b.launch([t.x - a.x, t.y - a.y - 1.1, t.z - a.z])`)
  await page.waitForFunction(() => window.syn3hNet.bungee.attached, null, { timeout: 5000 })
  await page.waitForTimeout(1200)
  await phase('severed', `${B} b.letGo('severed')`)
  await page.waitForTimeout(1500)
  // A miss: a short cord shot flat across open ground, sailing away.
  await phase('sail', `${B} s.params.set('bungee.length', 25); return b.launch([fz, 0.12, -fx])`)
  await page.waitForTimeout(2500)
  const log = await page.evaluate(() => window.__built)
  const phases = ['idle', 'ground', 'released', 'bot', 'severed', 'sail']
  const per = Object.fromEntries(phases.map(p => [p, { pipelines: log.filter(x => x.phase === p && x.kind === 'pipeline').length, modules: log.filter(x => x.phase === p && x.kind === 'module').length, labels: [...new Set(log.filter(x => x.phase === p).map(x => x.label))].slice(0, 10) }]))
  const stats = await page.evaluate(() => window.syn3hNet.bungee.stats)
  report = { backend, phases: per, stats, errors: errors.slice(0, 3) }
} finally { await browser.close() }
console.log(JSON.stringify(report, null, 1))
const gear = Object.entries(report.phases).filter(([p]) => p !== 'idle').flatMap(([, v]) => v.labels).filter(l => /bungee|tether/i.test(l))
const inPlay = Object.entries(report.phases).filter(([p]) => p !== 'idle').reduce((n, [, v]) => n + v.pipelines + v.modules, 0)
console.log(`built in play after the idle window: ${inPlay}; of them the Grapple's: ${gear.length}`)
if (report.stats.attachedGround < 1 || report.stats.attachedVehicle < 1) { console.log('GRAPPLE PIPELINES: the cords did not catch'); process.exit(1) }
console.log(gear.length ? 'GRAPPLE BUILT IN PLAY' : 'GRAPPLE PIPELINES OK')
process.exit(gear.length ? 1 : 0)
