/**
 * Pipelines created when a bot that has never been near first comes close, and when Yoink
 * reels one in after a graphics level change. The far vehicle warm-up in
 * src/vehicles/skins/showroom.ts exists to make both zero. Counts are exact; this is not a
 * timing test. Starts its own Vite on 5185 with a room server on 8788: check both are free.
 *
 *   tools/heavy.sh node tests/vehicles2/arrival-pipelines.mjs "$PWD" <tag>
 *
 * Writes /tmp/vehicles2-prewarm/<tag>.json. Read windows '3 ARRIVAL' and '6 ARRIVAL + YOINK'.
 */
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
const root = process.argv[2], tag = process.argv[3], out = '/tmp/vehicles2-prewarm/'
const { chromium } = createRequire(root + '/package.json')('playwright-core')
const vite = spawn('npx', ['vite', '--port', '5185', '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore', env: { ...process.env, SYN3H_ROOM_PORT: '8788' } })
const report = { tag, errors: [], windows: {} }
let browser
try {
  for (let i = 0; i < 120; i++) { try { if ((await fetch('http://127.0.0.1:5185/')).ok) break } catch {} await new Promise(r => setTimeout(r, 500)) }
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('pageerror', e => report.errors.push(e.message))
  await page.goto('http://127.0.0.1:5185/', { waitUntil: 'load' })
  await page.waitForFunction(() => window.syn3h?.game.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false', null, { timeout: 240000 })
  await page.evaluate(room => { const input = document.querySelector('#shell-room'); input.value = room; input.dispatchEvent(new Event('input', { bubbles: true })) }, `prewarm-${Date.now()}`)
  await page.locator('.galaxy-label[data-world="volcanic"]').dispatchEvent('click')
  await page.waitForFunction(() => window.syn3h?.shell.playing && !window.syn3h.game.input.suspended && window.syn3hNet?.connected, null, { timeout: 120000 })
  report.backend = await page.evaluate(() => window.syn3h.game.renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2')
  await page.evaluate(() => {
    const device = window.syn3h.game.renderer.backend.device, log = window.__desc = []
    // Shader modules: is the code on arrival the same code the warm-up compiled?
    const mods = window.__mods = []
    if (device) { const real = device.createShaderModule.bind(device); device.createShaderModule = d => { let h = 0; const c = String(d.code); for (let i = 0; i < c.length; i++) h = (Math.imul(h, 31) + c.charCodeAt(i)) | 0; mods.push({ phase: window.__phase ?? 'before', label: String(d.label), hash: h, length: c.length }); return real(d) } }
    if (device) for (const name of ['createRenderPipeline', 'createRenderPipelineAsync']) {
      const real = device[name].bind(device)
      device[name] = d => { try { log.push({ t: Math.round(performance.now()), phase: window.__phase ?? 'before', label: String(d.label), targets: (d.fragment?.targets ?? []).map(x => x.format + (x.blend ? ':b' : '')).join(','), depth: d.depthStencil ? `${d.depthStencil.format}/${d.depthStencil.depthCompare}/${d.depthStencil.depthWriteEnabled}` : '-', samples: d.multisample?.count ?? 1, prim: `${d.primitive?.topology}/${d.primitive?.cullMode}/${d.primitive?.frontFace}`, buffers: (d.vertex?.buffers ?? []).map(b => `${b.stepMode ?? 'vertex'}:${b.arrayStride}:${(b.attributes ?? []).map(a => a.format).join('+')}`).join(' | '), vs: d.vertex?.module?.label ?? '', fs: d.fragment?.module?.label ?? '' }) } catch (e) { log.push({ label: String(d.label), error: String(e) }) } return real(d) }
    }
  })
  await page.evaluate(() => { const p = window.syn3h.params; p.set('gfx.auto', false); p.set('bots.canDrive', false); p.set('bots.canFire', false); p.set('bots.count', 0) })
  await page.waitForFunction(() => window.syn3h.bots.vehicles.length === 0)
  // A bot that has never been near: spawned in play, as far out as the slider allows.
  report.spawnRadius = await page.evaluate(id => { const p = window.syn3h.params, r = p.get(id); p.set(id, r.def.max ?? 200); return { id, value: p.get(id).value } }, process.env.SPAWN_ID ?? 'bots.spawnRadius')
  await page.waitForTimeout(500)
  await page.evaluate(() => { window.__phase = 'spawn-in-play'; window.syn3h.params.set('bots.count', 1) })
  await page.waitForFunction(() => window.syn3h.bots.vehicles.length === 1)
  await page.waitForTimeout(6000)
  report.shading = await page.evaluate(() => ({ level: window.syn3h.params.get('gfx.level')?.value, vehicleShading: window.syn3h.params.get('gfx.vehicleShading')?.value, bot: window.syn3h.bots.vehicles[0].kind }))
  // Both hang in the air, the bot `gap` metres ahead of the player, who faces it.
  const place = gap => page.evaluate(gap => {
    const s = window.syn3h, bot = s.bots.vehicles[0], p = s.player.body.translation()
    const y = Math.max(s.terrain.heightAt(p.x, p.z), s.terrain.heightAt(p.x, p.z - gap)) + 20
    for (const [v, z] of [[s.player, p.z], [bot, p.z - gap]]) {
      v.teleport(s.player.object.position.clone().set(p.x, y, z), 0)
      v.body.setGravityScale(0, true); v.body.setLinvel({ x: 0, y: 0, z: 0 }, true); v.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    }
  }, gap)
  await page.evaluate(() => {
    const device = window.syn3h.game.renderer.backend.device, labels = window.__labels = []
    if (device) for (const name of ['createRenderPipeline', 'createRenderPipelineAsync']) {
      const real = device[name].bind(device)
      device[name] = d => { labels.push(String(d.label)); return real(d) }
    }
    let fresh = 0; window.__fresh = () => { const n = fresh; fresh = 0; return n }
    // Performance's own counter, summed per frame, as a second witness.
    const tick = () => { fresh += window.syn3h.game.performance?.pipelinesFresh ?? 0; requestAnimationFrame(tick) }; requestAnimationFrame(tick)
  })
  const window_ = async (name, action, ms) => {
    await page.evaluate(() => { window.__labels.length = 0; window.__fresh() })
    await action(); await page.waitForTimeout(ms)
    const r = await page.evaluate(() => ({ labels: [...window.__labels], fresh: window.__fresh() }))
    const showroom = r.labels.filter(l => /showroom/i.test(l))
    report.windows[name] = { pipelines: r.labels.length, showroom: showroom.length, showroomNames: [...new Set(showroom)].slice(0, 12), others: [...new Set(r.labels.filter(l => !/showroom/i.test(l)))].slice(0, 12), pipelinesFresh: r.fresh }
  }
  report.spawnGap = await page.evaluate(() => { const s = window.syn3h, a = s.player.body.translation(), b = s.bots.vehicles[0].body.translation(); return Math.round(Math.hypot(a.x - b.x, a.z - b.z)) })
  await place(80)
  await page.evaluate(() => { window.__phase = 'far' })
  await window_('1 far, settling (warm happens here)', async () => {}, 9000)
  await page.evaluate(() => { window.__phase = 'arrival' })
  await window_('2 far, idle control', async () => {}, 4000)
  await window_('3 ARRIVAL: bot comes to 15 m', () => place(15), 4000)
  await window_('4 near, idle control', async () => {}, 3000)
  await page.evaluate(() => { window.__phase = 'later' })
  report.descriptors = await page.evaluate(() => window.__desc.filter(d => /showroom|Shadow|GTAO|SSS|SSGI|RTT|force field/i.test(d.label) && d.phase !== 'later'))
  report.modules = await page.evaluate(() => { const m = window.__mods, seen = new Map(); const out = { byPhase: {}, arrivalSeenBefore: 0, arrivalNew: 0, arrivalNewLabels: [] }; for (const x of m) { out.byPhase[x.phase] = (out.byPhase[x.phase] ?? 0) + 1; if (x.phase === 'arrival') { if (seen.has(x.hash)) out.arrivalSeenBefore++; else { out.arrivalNew++; out.arrivalNewLabels.push(x.label + ':' + x.length) } } else seen.set(x.hash, x.phase) } return out })
  report.cache = await page.evaluate(() => { const p = window.syn3h.game.renderer._pipelines; return p ? { pipelines: p.caches?.size, vertex: p.programs?.vertex?.size, fragment: p.programs?.fragment?.size } : null })
  report.warmNow = await page.evaluate(async () => ({ ...(await import('/src/vehicles/skins/showroom.ts')).showroomWarm }))
  const state = () => page.evaluate(() => { const s = window.syn3h, bot = s.bots.vehicles[0], m = []; bot.object.traverse(o => { if (o.isMesh && o.visible && o.material?.name) m.push(`${o.material.name}#${o.material.id}v${o.material.version} cast${+o.castShadow} env${o.material.envMap?.id ?? '-'}`) }); return { env: s.game.scene.environment?.id ?? null, lights: s.game.scene.children.filter(o => o.isLight).length, materials: [...new Set(m)].slice(0, 10) } })
  report.stateNear1 = await state()
  await place(80); await page.waitForTimeout(3000)
  report.stateFar = await state()
  await window_('4b SECOND ARRIVAL: same bot comes to 15 m again', () => place(15), 4000)
  report.stateNear2 = await state()
  await place(80); await page.waitForTimeout(3000)
  await window_('4c THIRD ARRIVAL at 22 m (inside 25, outside the 20 m shadow range)', () => place(22), 4000)
  await place(80); await page.waitForTimeout(1500)
  await window_('5 graphics level change while far', () => page.evaluate(() => { const p = window.syn3h.params, now = Number(p.get('gfx.level').value); p.set('gfx.level', now === 1 ? 2 : 1) }), 12000)
  report.levelAfter = await page.evaluate(() => ({ level: window.syn3h.params.get('gfx.level')?.value, vehicleShading: window.syn3h.params.get('gfx.vehicleShading')?.value }))
  await page.evaluate(() => window.syn3hNet.gear.select('yoink'))
  await place(18); await page.waitForTimeout(50)
  // The harness distance for gear is 18 m, inside FAR_IN, so the grab case is an arrival too:
  // measure the frames from the bot appearing at 18 m through a Yoink hold.
  await window_('6 ARRIVAL + YOINK after level change', async () => { await page.keyboard.down('KeyL'); await page.waitForTimeout(900); await page.keyboard.up('KeyL') }, 3500)
  report.warm = await page.evaluate(async () => (await import('/src/vehicles/skins/showroom.ts')).showroomWarm ?? null)
} catch (e) { report.failed = String(e) } finally {
  await browser?.close(); vite.kill('SIGTERM')
  await writeFile(`${out}${tag}.json`, JSON.stringify(report, null, 1)); console.log(JSON.stringify(report, null, 1))
}
