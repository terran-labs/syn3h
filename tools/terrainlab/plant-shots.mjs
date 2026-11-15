/**
 * One close-up per kind of plant: for each ground cover layer on a world, find a planted
 * instance near a spawn pad, park the vehicle a few metres from it facing it, pull the
 * game's own camera in, and take a day and a night shot.
 *
 *   node tools/terrainlab/plant-shots.mjs [baseUrl] [outDir] [world,world,...] [layer,layer,...]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const base = process.argv[2] ?? 'http://localhost:5191/'
const out = process.argv[3] ?? '/tmp/vegetation-plants'
const worlds = (process.argv[4] ?? 'alpine.7,desert.7,volcanic.1').split(',')
const only = process.argv[5] ? process.argv[5].split(',').map(Number) : null
const nights = process.env.NIGHT !== '0'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
for (const world of worlds) {
  const name = world.split('.')[0]
  await page.goto(`${base}?autoplay=1&world=${world}&room=plants${Date.now().toString(36)}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.syn3h?.game?.tick > 90, null, { timeout: 90000 })
  await page.evaluate(() => {
    const s = window.syn3h
    s.params.set('sun.dayLength', 0)
    s.params.set('camera.distance', 1.6)
    for (const el of document.querySelectorAll('body *')) {
      const t = el.firstChild?.textContent?.trim()
      if (el.children.length && (t === 'Controls' || /^New build available/.test(el.textContent?.trim() ?? ''))) el.style.display = 'none'
    }
  })
  // Start beside pad 2, so the treadmills fill round there.
  await page.evaluate(() => {
    const s = window.syn3h, t = s.terrain, pad = t.data.layout.spawns[2]
    const x = pad.x - pad.dirZ * 45, z = pad.z + pad.dirX * 45
    s.player.body.setTranslation({ x, y: t.heightAt(x, z) + 1.2, z }, true)
    s.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
  })
  await page.waitForTimeout(2500)
  const count = await page.evaluate(() => window.syn3h.terrain.cover.layers.length)
  for (let li = 0; li < count; li++) {
    if (only && !only.includes(li)) continue
    const found = await page.evaluate((li) => {
      const s = window.syn3h, t = s.terrain, layer = t.cover.layers[li]
      const g = layer.mesh.geometry
      const O = g.getAttribute('aOrigin').array, P = g.getAttribute('aParam').array
      const p = s.player.body.translation()
      let best = -1, bd = Infinity
      for (let i = 0; i < P.length / 4; i++) {
        if (!(P[i * 4 + 1] > 0.6)) continue
        const d = Math.hypot(O[i * 3] - p.x, O[i * 3 + 2] - p.z)
        if (d > 6 && d < bd) { bd = d; best = i }
      }
      if (best < 0) return null
      const px = O[best * 3], pz = O[best * 3 + 2]
      // Park 3.2 m from the plant, facing it, so the chase camera looks past the vehicle at it.
      const dx = px - p.x, dz = pz - p.z, l = Math.hypot(dx, dz)
      const x = px - (dx / l) * 3.6, z = pz - (dz / l) * 3.6
      const heading = Math.atan2(dx, dz)
      s.player.body.setTranslation({ x, y: t.heightAt(x, z) + 1.0, z }, true)
      s.player.body.setRotation({ x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) }, true)
      s.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      s.player.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      return { li, at: [px, pz] }
    }, li)
    if (!found) { console.log(`${name} layer ${li}: nothing planted nearby`); continue }
    await page.evaluate(() => window.syn3h.params.set('sun.timeOfDay', 11))
    await page.waitForTimeout(2200)
    await page.screenshot({ path: `${out}/${name}-${li}-day.png` })
    if (nights) {
      await page.evaluate(() => window.syn3h.params.set('sun.timeOfDay', 22.5))
      await page.waitForTimeout(2200)
      await page.screenshot({ path: `${out}/${name}-${li}-night.png` })
    }
  }
}
await browser.close()
console.log(JSON.stringify({ out, errors }))
