/**
 * First-use cost of each gear item, measured in a real browser. Run through tools/heavy.sh.
 *
 * A material that has never been drawn makes the renderer build its shader and pipeline in
 * the middle of play, which the player feels as a hitch on their first shot. This check
 * enters the game normally, uses each gear item twice and records, for each use, how many
 * render pipelines were created and the longest main-thread stall.
 *
 * Pipeline counts are exact. Gear materials are named "gear ...", so a pipeline can be
 * traced to the gear that needed it, and none may be built during a use: the gear compiles
 * its materials while the world appears (src/weapons/warm.ts), and again after a graphics
 * level change, which this check also forces. Pipelines built in the same window for
 * anything else (a vehicle's materials, the post chain) are reported, not asserted: they
 * are not the gear's. Stall times depend on how busy the machine is, so they are reported
 * but never asserted. Automatic quality is switched off so the governor cannot rebuild the
 * scene in the middle of a measurement. Set MIRA_GEAR_PIPELINES_MAX to allow some, for
 * measuring a build without the warm-up.
 */
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
const base = process.env.MIRA_URL
if (!base) throw new Error('Set MIRA_URL to the isolated lane preview')
const limit = Number(process.env.MIRA_GEAR_PIPELINES_MAX ?? 0)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(base, { waitUntil: 'load' })
  await page.waitForFunction(() => window.mira?.game.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false', null, { timeout: 120000 })
  await page.evaluate(room => { const input = document.querySelector('#shell-room'); input.value = room; input.dispatchEvent(new Event('input', { bubbles: true })) }, `gear-hitch-${Date.now()}`)
  await page.locator('.galaxy-label[data-world="volcanic"]').dispatchEvent('click')
  await page.waitForFunction(() => window.mira?.shell.playing && !window.mira.game.input.suspended && window.miraNet?.connected, null, { timeout: 60000 })
  const backend = await page.evaluate(() => window.mira.game.renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2')

  // One parked bot straight ahead gives Pesters, Yoink and the Bungee something to hold.
  await page.evaluate(() => { const p = window.mira.params; p.set('gfx.auto', false); p.set('bots.canDrive', false); p.set('bots.canFire', false); p.set('bots.count', 1) })
  await page.waitForFunction(() => window.mira.bots.vehicles.length === 1)
  // Both hang in the air, the bot 18 m from the player. The player faces it, or faces away
  // so that beams fly off into open sky and are on screen long enough to be drawn.
  const place = facing => page.evaluate(facing => {
    const s = window.mira, bot = s.bots.vehicles[0], p = s.player.body.translation()
    const y = Math.max(s.terrain.heightAt(p.x, p.z), s.terrain.heightAt(p.x, p.z - 18)) + 20
    for (const [v, z, yaw] of [[s.player, p.z, facing ? 0 : Math.PI], [bot, p.z - 18, 0]]) {
      v.teleport(s.player.object.position.clone().set(p.x, y, z), yaw)
      v.body.setGravityScale(0, true); v.body.setLinvel({ x: 0, y: 0, z: 0 }, true); v.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    }
  }, facing)
  await place(true)
  await page.evaluate(() => {
    // Count pipelines as the renderer asks the GPU for them; the cache size also shrinks.
    let made = 0
    const device = window.mira.game.renderer.backend.device
    if (device) for (const name of ['createRenderPipeline', 'createRenderPipelineAsync']) {
      const real = device[name].bind(device)
      device[name] = descriptor => { made++; (window.__pipelineLabels ??= []).push(`${Math.round(performance.now())} ${descriptor.label} ${descriptor.fragment?.targets?.length}t x${descriptor.multisample?.count ?? 1}`); return real(descriptor) }
    }
    const pipelines = () => made
    // Longest gap between animation frames and the longest task, between start() and stop().
    let last = 0, worst = 0, task = 0, running = false, from = 0
    new PerformanceObserver(list => { for (const e of list.getEntries()) if (running) task = Math.max(task, e.duration) }).observe({ entryTypes: ['longtask'] })
    const tick = t => { if (running) { if (last) worst = Math.max(worst, t - last); last = t; requestAnimationFrame(tick) } }
    window.__hitch = {
      start() { last = 0; worst = 0; task = 0; from = pipelines(); running = true; requestAnimationFrame(tick) },
      stop() { running = false; return { pipelines: pipelines() - from, worstFrameMs: Math.round(worst), longestTaskMs: Math.round(task) } },
    }
  })
  // Everything already in view compiles before the first measurement.
  await page.waitForTimeout(4000)

  const hold = async ms => { await page.keyboard.down('KeyL'); await page.waitForTimeout(ms); await page.keyboard.up('KeyL') }
  const uses = {
    beam: () => hold(400),
    red: async () => {
      await page.keyboard.down('KeyL')
      await page.waitForFunction(() => window.miraNet.bigRed.ready, null, { timeout: 15000 })
      await page.keyboard.up('KeyL')
    },
    pester: () => hold(450),
    bungee: async () => { await hold(120); await page.waitForTimeout(1500); await page.keyboard.press('KeyG') },
    yoink: () => hold(900),
  }
  const facesBot = { beam: false, red: false, pester: true, bungee: true, yoink: true }
  const report = { backend, gear: {}, afterLevelChange: {} }
  report.target = await page.evaluate(() => {
    const s = window.mira, n = window.miraNet, a = s.player.body.translation(), b = s.bots.vehicles[0].body.translation()
    return { picked: n.pesters.pick(), bot: n.vehicleIdOfBody(s.bots.vehicles[0].body.handle), ids: n.vehicleIds(), offset: [b.x - a.x, b.y - a.y, b.z - a.z].map(Math.round) }
  })
  // The same wait with no gear in use: pipelines the world makes on its own.
  await page.evaluate(() => window.__hitch.start())
  await page.waitForTimeout(3500)
  report.idle = await page.evaluate(() => window.__hitch.stop())
  const round = async into => {
    for (const [gear, use] of Object.entries(uses)) {
      into[gear] = []
      for (let n = 0; n < 2; n++) {
        await place(facesBot[gear])
        await page.evaluate(g => window.miraNet.gear.select(g), gear)
        await page.waitForTimeout(600)
        await page.evaluate(g => { window.__hitch.start(); (window.__pipelineLabels ??= []).push(`${Math.round(performance.now())} == ${g}`) }, gear)
        await use()
        // Long enough for the shot to land and its sparks to draw.
        await page.waitForTimeout(2500)
        into[gear].push(await page.evaluate(() => window.__hitch.stop()))
        await page.evaluate(() => window.__pipelineLabels.push(`${Math.round(performance.now())} == end`))
        await page.waitForTimeout(1000)
      }
    }
  }
  await round(report.gear)
  // A graphics level change replaces the render chain and every pipeline with it. The gear
  // must be compiled again along with the scene, not on its next use.
  report.warm = { before: await page.evaluate(async () => (await import('/src/weapons/warm.ts')).warmStats(window.mira.game)) }
  for (const level of [1, 2]) {
    await page.evaluate(level => { window.__pipelineLabels.push(`${Math.round(performance.now())} == level ${level}`); window.mira.params.set('gfx.level', level) }, level)
    await page.waitForFunction(async () => (await import('/src/weapons/warm.ts')).warmStats(window.mira.game)?.left === 0, null, { timeout: 120000, polling: 500 })
    await page.waitForTimeout(3000)
  }
  report.warm.after = await page.evaluate(async () => (await import('/src/weapons/warm.ts')).warmStats(window.mira.game))
  await round(report.afterLevelChange)
  report.stats = await page.evaluate(() => { const n = window.miraNet; return { shots: n.stats.shotsFired, red: n.bigRed.stats, pesters: n.pesters.stats, bungee: n.bungee.stats, yoink: n.yoink.stats } })
  report.errors = errors
  report.labels = await page.evaluate(() => window.__pipelineLabels ?? [])
  console.log(JSON.stringify(report, null, 2))
  // Each gear item must actually have been used, or a zero would mean nothing.
  assert.ok(report.stats.shots > 0, 'the tag beam fired')
  assert.ok(report.stats.red.sent > 0, 'Big Red fired')
  assert.ok(report.stats.pesters.launched > 0, 'a Pester launched')
  assert.deepEqual(errors, [])
  assert.ok(report.stats.bungee.launched > 0, 'the Bungee launched')
  assert.ok(report.stats.yoink.grabs + report.stats.yoink.gusts > 0, 'the Yoink was used')
  // Walk the log: which pipelines were built between each use's start and end marks.
  report.windows = []
  let open = null
  for (const line of report.labels) {
    const [, mark] = /^\d+ == (.+)$/.exec(line) ?? []
    if (mark === 'end') { if (open) report.windows.push(open); open = null }
    else if (mark) open = /^level/.test(mark) ? null : { gear: mark, gearPipelines: [], other: 0 }
    else if (open) { if (/renderPipeline_gear /.test(line)) open.gearPipelines.push(line); else open.other++ }
  }
  console.log(JSON.stringify(report.windows))
  assert.equal(report.windows.length, 20, 'every use was logged')
  for (const w of report.windows) assert.ok(w.gearPipelines.length <= limit, `${w.gear}: built ${w.gearPipelines.join(', ')} on use; the limit is ${limit}`)
  // The warm-up really ran, twice: at the start and for the level changes.
  assert.ok(report.labels.some(l => /renderPipeline_gear /.test(l)), 'gear pipelines were built by the warm-up')
  assert.ok(report.warm.after.armed >= 2, 'the warm-up ran again after the level change')
  console.log('GEAR HITCH CHECK OK')
} finally { await browser.close() }
