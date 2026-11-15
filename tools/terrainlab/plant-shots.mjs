/**
 * One close-up per kind of plant: for each ground cover layer on a world, find a planted
 * instance near a spawn pad, move the vehicle out of the way, point the game's own camera
 * at the plant from a couple of metres (its cinematic pose), and take a day and a night shot.
 *
 *   node tools/terrainlab/plant-shots.mjs [baseUrl] [outDir] [world,world,...] [layer,layer,...]
 *
 * LAVA=1 starts beside a river (lava or water) and first takes a wide look along its bank.
 * NIGHT=0 skips the night shots.
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
    s.params.set('daydream.seconds', 0)
    s.params.set('camera.distance', 1.6)
    for (const el of document.querySelectorAll('body *')) {
      const t = el.firstChild?.textContent?.trim()
      if (el.children.length && (t === 'Controls' || /^New build available/.test(el.textContent?.trim() ?? ''))) el.style.display = 'none'
    }
  })
  // Start beside pad 2, or with LAVA=1 beside the middle of the longest river, so the
  // treadmills fill round there. By a river, first take a wide look along its bank.
  const byRiver = await page.evaluate((lava) => {
    const s = window.syn3h, t = s.terrain
    let x, z, look = null
    const rivers = [...t.data.lava.rivers].sort((a, b) => b.points.length - a.points.length)
    if (lava && rivers.length) {
      const pts = rivers[0].points, m = pts[Math.floor(pts.length / 2)], n = pts[Math.floor(pts.length / 2) + 1] ?? m
      const dx = n.x - m.x, dz = n.z - m.z, l = Math.hypot(dx, dz) || 1
      x = m.x - (dz / l) * 14; z = m.z + (dx / l) * 14
      look = { m, x: m.x - (dz / l) * 30 - (dx / l) * 12, z: m.z + (dx / l) * 30 - (dz / l) * 12 }
    } else {
      const pad = t.data.layout.spawns[2]
      x = pad.x - pad.dirZ * 45; z = pad.z + pad.dirX * 45
    }
    s.player.body.setTranslation({ x, y: t.heightAt(x, z) + 1.2, z }, true)
    s.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    if (look) {
      const V = s.camera.game.camera.position.constructor
      s.camera.setCinematicPose(new V(look.x, t.heightAt(look.x, look.z) + 3, look.z), new V(look.m.x, look.m.y, look.m.z))
    }
    return !!look
  }, process.env.LAVA === '1')
  await page.waitForTimeout(3500)
  if (byRiver) {
    await page.evaluate(() => window.syn3h.params.set('sun.timeOfDay', 11))
    await page.waitForTimeout(2500)
    await page.screenshot({ path: `${out}/${name}-river-day.png` })
    if (nights) {
      await page.evaluate(() => window.syn3h.params.set('sun.timeOfDay', 22.5))
      await page.waitForTimeout(2500)
      await page.screenshot({ path: `${out}/${name}-river-night.png` })
    }
  }
  const count = await page.evaluate(() => window.syn3h.terrain.cover.layers.length)
  for (let li = 0; li < count; li++) {
    if (only && !only.includes(li)) continue
    const found = await page.evaluate((li) => {
      const s = window.syn3h, t = s.terrain, layer = t.cover.layers[li]
      const g = layer.mesh.geometry
      const O = g.getAttribute('aOrigin').array, P = g.getAttribute('aParam').array
      const p = s.player.body.translation()
      let best = -1, bd = Infinity
      // Only the first instanceCount entries are live: planted cells are packed to the front.
      for (let i = 0; i < g.instanceCount; i++) {
        if (!(P[i * 4 + 1] > 0.6)) continue
        const d = Math.hypot(O[i * 3] - p.x, O[i * 3 + 2] - p.z)
        if (d > 6 && d < bd) { bd = d; best = i }
      }
      if (best < 0) return null
      const px = O[best * 3], py = O[best * 3 + 1], pz = O[best * 3 + 2]
      // Move the vehicle out of the shot and point the camera's cinematic pose at the plant
      // from 2.4 m away, looking slightly down at it.
      const dx = px - p.x, dz = pz - p.z, l = Math.hypot(dx, dz)
      const vx = px + (dz / l) * 14, vz = pz - (dx / l) * 14
      s.player.body.setTranslation({ x: vx, y: t.heightAt(vx, vz) + 1.0, z: vz }, true)
      s.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      const cx = px - (dx / l) * 2.4, cz = pz - (dz / l) * 2.4
      const V = s.camera.game.camera.position.constructor
      s.camera.setCinematicPose(new V(cx, t.heightAt(cx, cz) + 1.5, cz), new V(px, py + 0.35, pz))
      return { li, at: [px, pz] }
    }, li)
    if (!found) { console.log(`${name} layer ${li}: nothing planted nearby`); continue }
    await page.evaluate(() => window.syn3h.params.set('sun.timeOfDay', 11))
    await page.waitForTimeout(3500)
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
