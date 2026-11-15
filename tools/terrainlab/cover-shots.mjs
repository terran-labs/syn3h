/**
 * Close-up screenshots of the grass and flowers on a world: the player is parked on open
 * ground beside a spawn pad (PAD and SIDE in the environment pick which pad and how far to its side) and the game's own camera is used, by day and at night.
 *
 *   node tools/terrainlab/cover-shots.mjs [baseUrl] [outDir] [world,world,...]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const base = process.argv[2] ?? 'http://localhost:5191/'
const out = process.argv[3] ?? '/tmp/terrainlab-cover'
const worlds = (process.argv[4] ?? 'alpine.7,desert.7,volcanic.1').split(',')
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
  await page.goto(`${base}?autoplay=1&world=${world}&room=cover${Date.now().toString(36)}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.syn3h?.game?.tick > 90, null, { timeout: 90000 })
  await page.keyboard.press('KeyH').catch(() => {})
  // Park 45 m to the side of pad 2, off the road, facing the centre.
  await page.evaluate(([PAD, SIDE]) => {
    const s = window.syn3h, t = s.terrain, pad = t.data.layout.spawns[PAD]
    const x = pad.x - pad.dirZ * SIDE, z = pad.z + pad.dirX * SIDE
    const heading = Math.atan2(x, z)
    s.player.body.setTranslation({ x, y: t.heightAt(x, z) + 1.2, z }, true)
    s.player.body.setRotation({ x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) }, true)
    s.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    s.params.set('sun.dayLength', 0)
  }, [Number(process.env.PAD ?? 2), Number(process.env.SIDE ?? 45)])
  await page.waitForTimeout(3500)
  await page.screenshot({ path: `${out}/${name}-day.png` })
  await page.evaluate(() => window.syn3h.params.set('sun.timeOfDay', 22.5))
  await page.waitForTimeout(3500)
  await page.screenshot({ path: `${out}/${name}-night.png` })
}
await browser.close()
console.log(JSON.stringify({ out, errors }))
