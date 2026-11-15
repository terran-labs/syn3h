/**
 * Acceptance for the single scene pass (src/fx/post/PostChain.ts). Functional only: counts,
 * colours and errors, never timings. Run serially through tools/heavy.sh.
 *
 *   tools/heavy.sh node tools/single-pass-check.mjs URL OUTPUT_DIR [--webgl]
 *
 * The game loop is stopped and frames are drawn by hand from a fixed camera, so every
 * frame is the same view unless the check moves it. It asserts:
 *
 *   once        with occlusion, contact shadows and indirect light on, the scene is drawn
 *               through the player's camera exactly once a frame, no scene render repeats
 *               into the same target (each sun shadow map updates once), and the draw count
 *               is at most the post-off count plus one draw per full-screen pass.
 *   first       the first frame after a rebuild matches a frame with those three effects
 *               off (unoccluded, not black), and later frames differ (the effects work).
 *   rejection   a camera cut, a jump of one world tile and a resize each discard the
 *               screen-space history for exactly one frame.
 *   stable      indirect light at its slider maximum converges; it feeds on last frame's
 *               colour, so a gain above one would brighten without bound.
 *   steady      no pipeline rebuild while nothing changes, and no page or GPU error.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const [base, out] = process.argv.slice(2)
assert.ok(base && out, 'URL and output directory required')
mkdirSync(out, { recursive: true })
const webgl = process.argv.includes('--webgl')
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = { backend: null, errors: [], checks: {} }
let failure = null
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } })
  page.on('pageerror', e => report.errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error' || /validation|GL_INVALID|WebGL: INVALID/i.test(m.text())) report.errors.push(m.text()) })
  const url = new URL(base)
  url.searchParams.set('autoplay', '1'); url.searchParams.set('room', `single-pass-${Date.now()}`)
  if (webgl) url.searchParams.set('webgl', '1')
  await page.goto(url.href, { timeout: 120000 })
  await page.waitForFunction(() => window.syn3h?.game?.tick > 150, null, { timeout: 120000 })

  report.backend = await page.evaluate(async () => {
    const s = window.syn3h, g = s.game, r = g.renderer
    for (const [id, v] of Object.entries({ 'bots.count': 0, 'sun.dayLength': 0, 'sun.timeOfDay': 15, 'gfx.auto': false, 'gfx.level': 2, 'post.on': true,
      // Frame-to-frame differences must come from the effects under test alone.
      'post.temporal': false, 'post.motionBlur': 0, 'post.grain': 0, 'post.heat': 0, 'post.plunge': 0, 'post.clouds': 0 })) s.params.set(id, v)
    await new Promise(done => setTimeout(done, 1500))
    r.setAnimationLoop(null)
    g.quality.frame = () => {}
    document.querySelector('.syn3h-shell')?.setAttribute('style', 'display:none')
    const chain = g.postChain
    // Every render call this frame: what was drawn, through which camera, into which target.
    const calls = []
    const render = r.render
    r.render = function (object, camera) {
      calls.push({ scene: !!object.isScene, player: camera === g.camera, target: r.getRenderTarget()?.texture.uuid ?? 'canvas' })
      return render.call(this, object, camera)
    }
    // Ground, horizon, and the vehicle's wheels and underside where occlusion must land.
    const patches = [[0.5, 0.5], [0.5, 0.75], [0.3, 0.7], [0.7, 0.7], [0.5, 0.9], [0.5, 0.64], [0.45, 0.65], [0.55, 0.65], [0.5, 0.6]]
    const fixture = window.singlePass = {
      async frame() {
        calls.length = 0
        g.camera.updateMatrixWorld()
        chain.render(r, g.scene, g.camera, 16.667)
        // Read before yielding: the renderer resets its counters on the next frame.
        const draws = r.info.render.drawCalls
        await new Promise(requestAnimationFrame)
        const perTarget = {}
        for (const c of calls) if (c.scene) perTarget[c.target] = (perTarget[c.target] ?? 0) + 1
        return { draws, playerScenes: calls.filter(c => c.scene && c.player).length, sceneTargets: Object.values(perTarget), quads: calls.filter(c => !c.scene).length,
          history: chain.u.screenHistory.value, resets: chain.screenHistoryResets, builds: chain.builds, tier: chain.tier }
      },
      async frames(n) { let last; for (let i = 0; i < n; i++) last = await this.frame(); return last },
      /** Mean linear colour of the scene pass in each fixed patch, as one flat list. */
      // WebGL reads a render target from the bottom row up; patches are given top down.
      async colour() {
        const pass = chain.built.disposables.find(d => d.scene === g.scene)
        const w = pass.renderTarget.width, h = pass.renderTarget.height, all = []
        const T = await import(performance.getEntriesByType('resource').find(e => e.name.includes('/three_webgpu.js')).name)
        for (const [x, y] of patches) {
          const data = await r.readRenderTargetPixelsAsync(pass.renderTarget, Math.round(x * w) - 8, Math.round((g.backend === 'webgl' ? 1 - y : y) * h) - 8, 16, 16)
          const rgb = [0, 0, 0]
          for (let i = 0; i < data.length; i++) if (i % 4 < 3) rgb[i % 4] += data instanceof Uint16Array ? T.DataUtils.fromHalfFloat(data[i]) : data[i]
          all.push(...rgb.map(v => v / 256))
        }
        return all
      },
      set(values) { for (const [id, v] of Object.entries(values)) s.params.set(id, v) },
      // Side of the wrapping world tile in metres (shared/protocol.ts WRAP_SIZES).
      tile: [1024, 2048, 4096][s.params.get('terrain.planetSize')?.value] ?? 0,
    }
    void fixture
    return g.backend
  })
  if (webgl) assert.equal(report.backend, 'webgl')
  const frame = () => page.evaluate(() => window.singlePass.frame())
  const frames = n => page.evaluate(n => window.singlePass.frames(n), n)
  const colour = () => page.evaluate(() => window.singlePass.colour())
  const set = values => page.evaluate(values => window.singlePass.set(values), values)
  const diff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])))
  const screen = { 'post.ao': 1, 'post.gi': 1, 'post.contact': 1 }
  const none = { 'post.ao': 0, 'post.gi': 0, 'post.contact': 0 }

  // once
  await set({ 'post.on': false }); const off = await frames(4)
  await set({ 'post.on': true, ...none }); const plain = await frames(4)
  await set(screen); const on = await frames(8)
  report.checks.once = { off, plain, on }
  assert.equal(on.tier, 'full')
  assert.equal(on.playerScenes, 1, 'scene drawn through the player camera once')
  assert.ok(on.sceneTargets.every(n => n === 1), 'no scene render repeats into one target: shadow maps update once a frame')
  assert.equal(on.sceneTargets.length, plain.sceneTargets.length, 'screen light adds no scene render')
  assert.ok(off.draws > 20, 'draw counter is live')
  assert.ok(on.draws <= off.draws + on.quads, `draws ${on.draws} within post-off ${off.draws} plus ${on.quads} full-screen passes`)

  // first
  // Some surfaces animate by clock (lava glow, embers), so two frames of the same pipeline
  // can differ. Measure that first and allow for it; the effects must still exceed it.
  await set(none); await frames(6); const earlier = await colour(); await frames(6); const reference = await colour()
  const noise = diff(earlier, reference)
  await set(screen); const firstFrame = await frame(); const first = await colour()
  // Strong settings for the proof that history is applied: where the camera spawned decides
  // how much default-strength occlusion happens to fall inside the patches.
  await set({ 'post.ao': 2, 'post.gi': 4 }); await frames(10); const settled = await colour(); await set(screen)
  report.checks.first = { noise, reference, first, settled, firstFrame }
  assert.equal(firstFrame.history, 0, 'no history on the first frame after a rebuild')
  assert.ok(Math.max(...first) > 0.01, 'first frame is not black')
  assert.ok(diff(first, reference) <= 0.0005 + 2 * noise, 'first frame after a rebuild is unoccluded')
  assert.ok(diff(settled, reference) > 0.01 + 2 * noise, 'screen light changes the picture once history exists')
  await page.screenshot({ path: `${out}/settled.png` })

  // rejection
  const rejection = {}
  const move = (dx) => page.evaluate(dx => { window.syn3h.game.camera.position.x += dx }, dx)
  const expectReset = async (name, act) => {
    const before = await frames(3); assert.equal(before.history, 1, `${name}: history valid before`)
    await act(); const at = await frame(); const after = await frame()
    rejection[name] = { before: before.resets, at, after }
    assert.equal(at.history, 0, `${name}: history rejected on the frame`)
    assert.equal(at.resets, before.resets + 1, `${name}: one reset counted`)
    assert.equal(after.history, 1, `${name}: history valid again one frame later`)
  }
  await expectReset('cut', () => move(120))
  const tile = await page.evaluate(() => window.singlePass.tile)
  if (tile > 0) await expectReset('wrap', () => move(tile)); else rejection.wrap = 'no tile size on this world'
  await expectReset('resize', () => page.setViewportSize({ width: 800, height: 600 }).then(() => page.evaluate(() => window.dispatchEvent(new Event('resize')))))
  const still = await frames(6)
  assert.equal(still.resets, rejection.resize.at.resets, 'a still camera never rejects history')
  report.checks.rejection = rejection

  // stable
  await set({ 'post.gi': 4 }); await frames(30); const g30 = await colour()
  await frames(30); const g60 = await colour(); await frames(60); const g120 = await colour()
  report.checks.stable = { g30, g60, g120 }
  assert.ok(g120.every(Number.isFinite), 'indirect light stays finite')
  assert.ok(diff(g120, g60) <= Math.max(0.002, 0.02 * Math.max(...g60)), 'indirect light at maximum has converged')
  await set({ 'post.gi': 1 })

  // steady
  const a = await frames(5), b = await frames(60)
  report.checks.steady = { builds: [a.builds, b.builds] }
  assert.equal(b.builds, a.builds, 'no rebuild in steady state')
  assert.deepEqual(report.errors, [], 'no page or GPU errors')
} catch (error) { failure = String(error?.stack ?? error); process.exitCode = 1 }
finally {
  writeFileSync(`${out}/report.json`, JSON.stringify({ ...report, failure }, null, 2))
  console.log(JSON.stringify({ backend: report.backend, failure, errors: report.errors.slice(0, 5), errorCount: report.errors.length, checks: report.checks }, null, 1))
  await browser.close()
}
