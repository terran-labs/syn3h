/**
 * Drives the buggy on several planets and captures its tyre marks, so the per-surface looks
 * (src/vehicles/effects/treads.ts) can be judged by eye. Records which surfaces the wheels
 * crossed. Run through tools/heavy.sh:
 *
 *   node tools/terrainlab/tread-shots.mjs [baseUrl] [outDir] [world,world,...]
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'

const base = process.argv[2] ?? 'http://localhost:5197/'
const out = process.argv[3] ?? '/tmp/terrainlab/treads'
const worlds = (process.argv[4] ?? 'swamp.7,desert.7,alpine.7,ice.7,obsidian.7,moon.7,volcanic.1,archipelago.7').split(',')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const report = []
try {
  for (const world of worlds) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.routeWebSocket(/\/ws/, (s) => s.close())
    await page.goto(`${base}?autoplay=1&vehicle=buggy&world=${world}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.syn3h?.game?.tick > 60, null, { timeout: 120000 })
    await page.exposeFunction('treadShot', (name) => page.screenshot({ path: `${out}/${world}-${name}.png` }))
    const seen = await page.evaluate(async () => {
      const s = window.syn3h
      s.params.set('bots.count', 0); s.params.set('sun.timeOfDay', 11); s.params.set('sun.dayLength', 0)
      const kinds = {}
      // Straight, then a hard turn under throttle so the wheels slide, then straighten.
      for (const [steer, steps, shot] of [[0, 50, 'straight'], [0.9, 30], [0, 25]]) {
        s.game.input.external.y = 1; s.game.input.external.x = steer
        for (let i = 0; i < steps; i++) {
          await new Promise((r) => setTimeout(r, 50))
          const raw = s.player.body.linvel(), speed = Math.hypot(raw.x, raw.z)
          if (speed > 14) s.player.body.setLinvel({ x: raw.x * 14 / speed, y: raw.y, z: raw.z * 14 / speed }, true)
          for (const w of s.player.getWheelEffects?.() ?? []) {
            if (!w.grounded) continue
            const k = s.terrain.surfaceAt(w.point.x, w.point.z)
            kinds[k] = (kinds[k] ?? 0) + 1
          }
        }
        if (shot) await window.treadShot(shot)
      }
      s.game.input.external.y = 0; s.game.input.external.x = 0
      await new Promise((r) => setTimeout(r, 600))
      return { kinds, marks: s.game.scene.userData.vehicleEffects?.marks ?? 0 }
    })
    await page.screenshot({ path: `${out}/${world}.png` })
    report.push({ world, ...seen, errors })
    await page.close()
  }
} finally { await browser.close() }
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
if (report.some((r) => r.errors.length || !r.marks)) process.exitCode = 1
