/**
 * Gear in play after a quality climb: enter at Minimal (?gfx=0), climb to Low, Medium and High by
 * hand (quality.setLevel, the veiled path) or by the automatic path (the diagnostic sweep replays
 * the governor's boundary), and at each rung, once it has settled, use every gear effect: a bot's
 * Plasma Thunder and the player's, a Plasma Tag shot, the Grapple, a Chaser and the Yoink. Every
 * node build and render pipeline the renderer makes in those windows is listed by material name;
 * a gear material ("gear ...", "thunder fireworks ...") built there is a freeze in play.
 * Connected to a room (this page is the host, with four bots), at noon and at night, on WebGPU
 * and WebGL 2. Exits 1 if any gear material was built in a window.
 *
 *   SYN3H_URL=http://127.0.0.1:<port>/ tools/heavy.sh node tests/weapons/climb-gear-check.mjs [paths] [hours] [backends]
 *   e.g. ... climb-gear-check.mjs manual 12 webgpu; hours 'default' keeps the world's own hour;
 *   SYN3H_WORLD=archipelago:4 for another planet and seed
 */
import { chromium } from 'playwright-core'

const base = (process.env.SYN3H_URL ?? '').replace(/\/+$/, '') + '/'
if (!process.env.SYN3H_URL) throw new Error('Set SYN3H_URL')
const PATHS = (process.argv[2] ?? 'manual,auto').split(','), HOURS = (process.argv[3] ?? '12,22').split(',').map(h => h === 'default' ? null : Number(h))
// SYN3H_WORLD: planet and seed, e.g. archipelago:4 (default alpine:7).
const [PLANET, SEED] = (process.env.SYN3H_WORLD ?? 'alpine:7').split(':')
const BACKENDS = (process.argv[4] ?? 'webgpu,webgl2').split(',')
const GEAR = /gear |firework|pester|bungee|tether|impact|yoink|spark|flash|dust/i
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const rows = []
let bad = 0
try {
  for (const backend of BACKENDS) for (const hour of HOURS) for (const path of PATHS) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${base}?gfx=0&planet=${PLANET}&seed=${SEED}&autoplay=1&room=climb-${Date.now()}${backend === 'webgl2' ? '&webgl=1' : ''}`)
    await page.waitForFunction(() => window.syn3h?.shell?.playing && window.syn3hNet?.connected && !window.syn3h.game.input.suspended && window.syn3h.game.tick > 60, null, { timeout: 180000 })
    await page.evaluate(hour => {
      document.exitPointerLock?.()
      const s = window.syn3h, q = s.params
      q.set('bots.canDrive', false); q.set('bots.canFire', false); if (q.get('bots.keepCount')) q.set('bots.keepCount', true); q.set('bots.count', 4)
      if (hour !== null) { q.set('sun.dayLength', 0); q.set('sun.timeOfDay', hour) }; q.set('daydream.seconds', 0)
      q.set('bigRed.cooldown', 0.1); q.set('bungee.cooldown', 0); q.set('yoink.cooldown', 0)
      // Every build the backend makes, by material and object name, with the window it fell in.
      const b = s.game.renderer.backend, nb = b.createNodeBuilder, rp = b.createRenderPipeline
      window.__builds = []; window.__window = 'setup'
      const name = src => `${src?.material?.name || src?.material?.type || '?'} | ${src?.object?.name || src?.object?.type || '?'}`
      b.createNodeBuilder = function (object, renderer) { const x = nb.call(this, object, renderer), build = x.build; x.build = function (...a) { try { return build.apply(this, a) } finally { window.__builds.push([window.__window, 'node', name(this)]); x.build = build } }; return x }
      b.createRenderPipeline = function (source, ...a) { try { return rp.call(this, source, ...a) } finally { window.__builds.push([window.__window, 'pipeline', name(source)]) } }
    }, hour)
    await page.waitForFunction(() => window.syn3h.bots.vehicles.length === 4, null, { timeout: 90000 }).catch(() => {})
    await page.waitForTimeout(4000)
    const sweep = path === 'auto' ? 'window.__sweep ??= window.syn3h.game.quality.beginDiagnosticSweep()' : ''
    for (const rung of [1, 2, 3]) {
      await page.evaluate(([rung, path]) => {
        window.__window = `climb to ${rung}`
        const q = window.syn3h.game.quality
        if (path === 'auto') { window.__sweep ??= q.beginDiagnosticSweep(); window.__sweep.step(rung) } else q.setLevel(rung)
      }, [rung, path])
      // Settle: the veil (manual) or the change frames (automatic) and any warm-up they run.
      await page.waitForTimeout(6000)
      const level = await page.evaluate(() => window.syn3h.game.quality.getPerformanceSnapshot?.().quality?.level ?? null)
      await page.evaluate(rung => {
        window.__window = `use at ${rung}`
        const s = window.syn3h, n = window.syn3hNet, me = s.player.object.position, bot = s.bots.vehicles[0]
        const f = s.game.camera.getWorldDirection(me.clone()); f.y = 0; f.normalize()
        // A bot's Thunder at the ground 15 m ahead of the player, and the player's at the ground 20 m ahead.
        if (bot) { const t = me.clone().addScaledVector(f, 15); t.y = s.terrain.heightAt(t.x, t.z); const d = t.sub(bot.object.position).normalize(); n.fireBot(0xff00, [d.x, d.y, d.z]) }
        n.fire([f.x, -0.25, f.z], undefined, 'red')
        setTimeout(() => { n.gear.select?.('beam'); n.fire([f.x, -0.1, f.z]) }, 400)
        setTimeout(() => { n.gear.select?.('bungee'); n.bungee.launch([f.x, -0.35, f.z]) }, 800)
        setTimeout(() => { n.bungee.letGo?.('released'); n.gear.select?.('pester'); n.launchPester(0xff01) }, 1800)
        setTimeout(() => { n.gear.select?.('yoink'); n.yoink.press() }, 2600)
      }, rung)
      await page.waitForTimeout(5500)
      const built = await page.evaluate(rung => window.__builds.filter(([w]) => w === `use at ${rung}`), rung)
      const gear = built.filter(([, , n]) => GEAR.test(n))
      if (gear.length) bad += gear.length
      rows.push(`${backend} ${hour} ${path} rung ${rung} (level ${level}): ${built.length} built in use, ${gear.length} gear${gear.length ? ': ' + [...new Set(gear.map(g => g.slice(1).join(' ')))].join('; ') : ''}${built.length > gear.length ? ' | other: ' + [...new Set(built.filter(g => !GEAR.test(g[2])).map(g => g[2]))].slice(0, 4).join('; ') : ''}`)
    }
    if (errors.length) rows.push(`${backend} ${hour} ${path} page errors: ${errors.slice(0, 2).join(' | ')}`)
    await page.context().close()
  }
} finally { await browser.close() }
console.log(rows.join('\n'))
console.log(bad ? `GEAR BUILT ${bad} IN PLAY AFTER A CLIMB` : 'CLIMB GEAR CHECK OK')
process.exit(bad ? 1 : 0)
