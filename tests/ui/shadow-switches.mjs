// The shadow and canary link switches do what their names say (core/flashSwitches.ts). Bug caught:
// a switch the owner sets on his phone to test one cause that silently changes nothing, or
// changes something else, so his test answers the wrong question. Without a switch the level's
// shadows are untouched (two 1024 cascades at Medium, a colour target each, soft filtering, fade).
// With ?shadowCascades=1&shadowMap=512&shadowColor=0&shadowFilter=hard&shadowFade=0&frameCanary=1:
// one cascade, 512 maps, no colour target, basic shadow maps, no fade, and the canary counting a
// command buffer the test withholds. On a touch device (emulated: coarse pointer, phone size),
// where sun shadows are held off by the device gate, the switches do nothing alone, and with
// ?shadows=1 the gate lifts and they apply: the link the owner opens on his phone must test what
// it says.
//   MIRA_URL=http://127.0.0.1:5187/ tools/heavy.sh node tests/ui/shadow-switches.mjs
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { waitForState } from './stateWait.mjs'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5187/'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
async function look(query, touch = false) {
  const page = await browser.newPage(touch ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 720 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(() => {
    const live = new Map(); window.__live = live
    const ct = GPUDevice.prototype.createTexture
    GPUDevice.prototype.createTexture = function (d) { const t = ct.call(this, d); live.set(t, { label: d.label || '', w: d.size.width ?? d.size[0] }); return t }
    const td = GPUTexture.prototype.destroy; GPUTexture.prototype.destroy = function () { live.delete(this); return td.call(this) }
  })
  await page.goto(`${base}?autoplay=1&gfx=2&${query}&room=shadow-switches-${Date.now()}`)
  await waitForState(page, 'the world running at Medium', () => window.mira?.game?.tick > 60 && window.mira.shell.playing, undefined, 180)
  await page.evaluate(() => { window.mira.params.set('gfx.auto', false); window.mira.params.set('gfx.quality', 2) })
  await page.waitForTimeout(3000)
  const state = await page.evaluate(() => {
    const g = window.mira.game
    let light = null; g.scene.traverse(o => { if (o.isDirectionalLight && o.shadow?.shadowNode) light = o })
    const csm = light?.shadow?.shadowNode
    const textures = [...window.__live.values()]
    return {
      backend: g.backend,
      cascades: csm?.lights?.length ?? null, fade: csm?.fade ?? null, type: g.renderer.shadowMap.type,
      depthMaps: textures.filter(t => t.label === 'ShadowDepthTexture').map(t => t.w),
      colourMaps: textures.filter(t => t.label === 'ShadowMap').length,
      canary: !!g.frameCanary,
      coarse: matchMedia('(pointer: coarse)').matches,
      shadowQuality: window.mira.params.get('gfx.shadowQuality')?.value,
      // Off is the cascade node disabled with 1-pixel maps (world/Environment.ts buildLight).
      shadowsOn: g.renderer.shadowMap.enabled && csm?.enabled?.value !== false && light.shadow.autoUpdate,
    }
  })
  return { page, errors, state }
}
try {
  {
    const { page, errors, state } = await look('')
    if (state.backend !== 'webgpu') { console.log(`skipped: this browser started ${state.backend}`); process.exit(0) }
    assert.equal(state.cascades, 2, 'Medium has two cascades'); assert.equal(state.fade, true); assert.equal(state.type, 1, 'soft (PCF) shadows')
    assert.ok(state.depthMaps.length >= 2 && state.depthMaps.every(w => w === 1024), `1024 maps (${state.depthMaps})`)
    assert.ok(state.colourMaps >= 2, 'a colour target per cascade'); assert.equal(state.canary, false)
    assert.deepEqual(errors, [])
    console.log('no switch:', JSON.stringify(state))
    await page.close()
  }
  {
    const { page, errors, state } = await look('shadowCascades=1&shadowMap=512&shadowColor=0&shadowFilter=hard&shadowFade=0&frameCanary=1')
    assert.equal(state.cascades, 1, 'one cascade'); assert.equal(state.fade, false, 'no fade'); assert.equal(state.type, 0, 'basic shadow maps')
    assert.ok(state.depthMaps.length >= 1 && state.depthMaps.every(w => w === 512), `512 maps (${state.depthMaps})`)
    assert.equal(state.colourMaps, 0, 'no colour target'); assert.equal(state.canary, true)
    // The canary: nothing dropped in play, then a withheld command buffer counted.
    await page.waitForTimeout(4000)
    const before = await page.evaluate(() => ({ dropped: window.mira.game.frameCanary.dropped, checked: window.mira.game.frameCanary.checked }))
    assert.equal(before.dropped, 0, 'no dropped command buffer in normal play'); assert.ok(before.checked > 0, 'buffers checked')
    await page.evaluate(() => window.mira.game.frameCanary.withholdNext(1))
    await waitForState(page, 'the withheld buffer counted', () => window.mira.game.frameCanary.dropped === 1, undefined, 30)
    const report = await page.evaluate(() => window.mira.game.frameCanary.reportLines().join('\n'))
    assert.match(report, /Frame canary: 1 of \d+ command buffers dropped/)
    assert.deepEqual(errors, [])
    console.log('all switches:', JSON.stringify(state), '\n' + report)
    await page.close()
  }
  // A touch device: the gate holds shadows off, and the switches alone change nothing.
  {
    const { page, errors, state } = await look('shadowCascades=1&shadowColor=0&frameCanary=1', true)
    assert.equal(state.coarse, true, 'emulated as a touch device')
    assert.equal(state.shadowQuality, 0, 'the device gate holds sun shadows off')
    // three keeps a 1-pixel placeholder depth texture while shadows are off; no real map is made.
    assert.equal(state.shadowsOn, false, 'no shadow drawn'); assert.equal(state.colourMaps, 0)
    assert.ok(state.depthMaps.every(w => w <= 1), `no shadow maps drawn (${state.depthMaps})`)
    assert.equal(state.canary, true, 'the canary does not depend on shadows')
    assert.deepEqual(errors, [])
    console.log('touch, gated:', JSON.stringify(state))
    await page.close()
  }
  // The phone link: ?shadows=1 lifts the gate, and the switches apply.
  {
    const { page, errors, state } = await look('shadows=1&shadowCascades=1&shadowColor=0&frameCanary=1', true)
    assert.equal(state.coarse, true)
    assert.ok(state.shadowQuality > 0, `?shadows=1 lifts the gate (shadowQuality ${state.shadowQuality})`)
    assert.equal(state.shadowsOn, true, 'shadows drawn'); assert.equal(state.cascades, 1, 'one cascade')
    assert.ok(state.depthMaps.some(w => w > 1), `shadow maps drawn (${state.depthMaps})`)
    assert.equal(state.colourMaps, 0, 'no colour target'); assert.equal(state.canary, true)
    await page.waitForTimeout(4000)
    const c = await page.evaluate(() => ({ dropped: window.mira.game.frameCanary.dropped, checked: window.mira.game.frameCanary.checked }))
    assert.equal(c.dropped, 0); assert.ok(c.checked > 0, 'buffers checked')
    assert.deepEqual(errors, [])
    console.log('touch, ?shadows=1:', JSON.stringify(state), JSON.stringify(c))
    await page.close()
  }
  console.log('ok')
} finally { await browser.close() }
