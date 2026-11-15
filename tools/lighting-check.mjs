/** Fixed-camera lighting isolation. Run through tools/heavy.sh after any release hold clears.
 * node tools/lighting-check.mjs <preview URL> <output directory> [--webgl]
 * Captures are diagnostic evidence, not a frame-time benchmark.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'

const [base, out] = process.argv.slice(2)
if (!base || !out) throw new Error('Supply preview URL and output directory')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = [], results = []
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  const url = new URL(base)
  url.searchParams.set('autoplay', '1')
  url.searchParams.set('room', `lighting-${Date.now().toString(36)}`)
  if (process.argv.includes('--webgl')) url.searchParams.set('webgl', '1')
  await page.goto(url.href, { waitUntil: 'load', timeout: 120000 })
  await page.locator('.shell-play').click({ timeout: 3000 }).catch(() => {})
  await page.waitForFunction(() => window.syn3h?.game?.tick > 120, null, { timeout: 90000 })
  await page.evaluate(() => {
    const s = window.syn3h, g = s.game
    g.renderer.setAnimationLoop(null)
    const env = g.systems.find(system => system.sunDirection && system.sunColor)
    if (!env) throw new Error('Environment unavailable')
    const terrain = g.scene.getObjectByName('terrain')
    const materials = new Map()
    terrain.traverse(o => { if (o.material && !materials.has(o.material)) materials.set(o.material, o.material.normalNode) })
    const receivers = []
    g.scene.traverse(o => { if (o.receiveShadow) receivers.push(o) })
    window.lightingCheck = { env, materials, receivers }
    for (const id of ['post.bloom', 'post.shafts', 'post.flare', 'post.motionBlur', 'post.heat', 'post.plunge', 'post.look', 'post.vignette', 'post.grain', 'post.contact']) s.params.set(id, 0)
  })
  const cases = [
    { name: 'low-original', hour: 17.6 },
    { name: 'low-no-shadows', hour: 17.6, shadows: false },
    { name: 'low-no-bump', hour: 17.6, bump: false },
    { name: 'low-neither', hour: 17.6, shadows: false, bump: false },
    { name: 'noon-no-ao', hour: 12 },
    { name: 'noon-ao', hour: 12, ao: true },
    { name: 'night-no-ao', hour: 23 },
    { name: 'night-ao', hour: 23, ao: true },
  ]
  for (const test of cases) {
    const state = await page.evaluate(async test => {
      const s = window.syn3h, g = s.game, d = window.lightingCheck
      s.params.set('sun.timeOfDay', test.hour)
      s.params.set('post.on', !!test.ao)
      for (const receiver of d.receivers) receiver.receiveShadow = test.shadows !== false
      for (const [material, normal] of d.materials) { material.normalNode = test.bump === false ? null : normal; material.needsUpdate = true }
      // No physics or camera updates: every case uses the same geometry and view.
      for (let i = 0; i < 24; i++) {
        d.env.update(0.25)
        for (const system of g.systems) if (system.vehicles instanceof Map) system.update(0)
        g.postChain.render(g.renderer, g.scene, g.camera, 16.667)
        await new Promise(requestAnimationFrame)
      }
      const beams = []
      s.player.object.traverse(o => { if (o.isSpotLight) beams.push({ name: o.name, position: o.position.toArray(), intensity: o.intensity }) })
      return { backend: g.backend, exposure: g.renderer.toneMappingExposure, beams, camera: g.camera.position.toArray() }
    }, test)
    await page.screenshot({ path: `${out}/${test.name}.png` })
    results.push({ ...test, ...state })
  }
  const report = { results, errors }
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}
