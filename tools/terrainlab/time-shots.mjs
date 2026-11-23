/**
 * Screenshots of the island at several times of day: from the air, from a spawn pad and
 * over the summit. Checks that the lava reads at night without washing the picture out.
 *
 *   node tools/terrainlab/time-shots.mjs [baseUrl] [outDir] [hours, e.g. 10.5,18.6,23]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const base = process.argv[2] ?? 'http://localhost:5191/'
const out = process.argv[3] ?? '/tmp/terrainlab-time'
const hours = (process.argv[4] ?? '10.5,18.6,23').split(',').map(Number)
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(`${base}?autoplay=1`, { waitUntil: 'load' })
await page.waitForFunction(() => window.mira?.game?.tick > 40, null, { timeout: 60000 })
await page.keyboard.press('KeyH').catch(() => {})
await page.evaluate(() => {
  const g = window.mira.game
  const orig = g.renderer.render.bind(g.renderer)
  window.__view = null
  g.renderer.render = (scene, cam) => {
    const v = window.__view
    if (v) { cam.position.set(...v.eye); cam.lookAt(...v.at); cam.updateMatrixWorld() }
    return orig(scene, cam)
  }
})
const info = await page.evaluate(() => {
  const t = window.mira.terrain
  const v = t.data.layout.volcano
  return { gx: v.gentleX, gz: v.gentleZ, S: t.summit(), pads: t.data.layout.spawns.map((p) => [p.x, p.z]) }
})
const shoot = async (name, eye, at) => {
  await page.evaluate((v) => { window.__view = v }, { eye, at })
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${out}/${name}.png` })
}
for (const hour of hours) {
  await page.evaluate((h) => { window.mira.params.set('sun.dayLength', 0); window.mira.params.set('sun.timeOfDay', h) }, hour)
  await page.waitForTimeout(2500) // let auto exposure settle
  const { gx, gz, S, pads } = info
  const tag = `h${hour}`
  await shoot(`${tag}-aerial`, [gx * 1150 + gz * 500, 620, gz * 1150 - gx * 500], [0, 90, 0])
  await shoot(`${tag}-pad4`, [pads[4][0] * 1.02, 17.5, pads[4][1] * 1.02], [0, 170, 0])
  // Standing on the shore beside pad 4, looking along the coast across the sea.
  const shore = await page.evaluate(([px, pz]) => { const t = window.mira.terrain; const l = Math.hypot(px, pz); let r = l; while (r < 1100 && t.heightAt(px / l * r, pz / l * r) > 1.5) r += 4; return [px / l * (r - 6), t.heightAt(px / l * (r - 6), pz / l * (r - 6)) + 2.5, pz / l * (r - 6)] }, pads[4])
  await shoot(`${tag}-shore`, shore, [shore[0] * 1.6 - shore[2] * 0.5, 0, shore[2] * 1.6 + shore[0] * 0.5])
  await shoot(`${tag}-summit`, [-gx * 230, S.rimHeight + 150, -gz * 230], [0, S.rimHeight - 20, 0])
}
await browser.close()
console.log(`wrote ${hours.length * 3} screenshots to ${out}`)
