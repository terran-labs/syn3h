/**
 * Parked screenshots of the ground on several planets, for before and after comparisons of
 * the terrain material, and a pixel comparison of two such sets. Run through tools/heavy.sh:
 *
 *   node tools/terrainlab/ground-shots.mjs shoot [baseUrl] [outDir] [world,world] [extra query]
 *   node tools/terrainlab/ground-shots.mjs compare [dirA] [dirB] [world,world]
 *
 * Plants and clouds move, so two runs of the same code differ a little; compare a change
 * against that noise floor (shoot the same code twice).
 */
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync } from 'node:fs'

const [mode, a, b, list, extra = ''] = process.argv.slice(2)
const worlds = (list ?? 'volcanic.1,desert.7,alpine.7,obsidian.7,ice.7').split(',')
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
try {
  if (mode === 'compare') {
    const page = await browser.newPage()
    for (const world of worlds) {
      const urls = [a, b].map((d) => 'data:image/png;base64,' + readFileSync(`${d}/${world}.png`).toString('base64'))
      const diff = await page.evaluate(async (urls) => {
        const data = []
        for (const u of urls) {
          const img = new Image(); img.src = u; await img.decode()
          const c = new OffscreenCanvas(img.width, img.height), x = c.getContext('2d')
          x.drawImage(img, 0, 0); data.push(x.getImageData(0, 0, img.width, img.height))
        }
        // Ground only: the lower 45 percent of the frame, away from the minimap corner.
        const { width: w, height: h } = data[0]
        let sum = 0, n = 0, worst = 0, over = 0
        for (let y = Math.floor(h * 0.55); y < h; y++) for (let x = Math.floor(w * 0.2); x < w; x++) {
          const i = (y * w + x) * 4
          const d = (Math.abs(data[0].data[i] - data[1].data[i]) + Math.abs(data[0].data[i + 1] - data[1].data[i + 1]) + Math.abs(data[0].data[i + 2] - data[1].data[i + 2])) / 3
          sum += d; n++; if (d > worst) worst = d; if (d > 12) over++
        }
        return { meanDiff: +(sum / n).toFixed(2), worst: +worst.toFixed(0), shareOver12: +(over / n).toFixed(4) }
      }, urls)
      console.log(world, JSON.stringify(diff))
    }
  } else {
    const base = a ?? 'http://localhost:5197/', out = b ?? '/tmp/terrainlab/ground'
    mkdirSync(out, { recursive: true })
    for (const world of worlds) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)) })
      await page.routeWebSocket(/\/ws/, (s) => s.close())
      await page.goto(`${base}?autoplay=1&vehicle=buggy&world=${world}${extra}`, { waitUntil: 'load' })
      await page.waitForFunction(() => window.mira?.game?.tick > 60, null, { timeout: 120000 })
      await page.evaluate(() => {
        const s = window.mira
        s.params.set('gfx.level', 2); s.params.set('bots.count', 0); s.params.set('sun.dayLength', 0); s.params.set('sun.timeOfDay', 10)
        s.params.set('terrain.groundCover', 0); s.params.set('weather.cloudCoverage', 0)
        s.game.quality.frame = () => {}
      })
      await page.waitForTimeout(6000)
      await page.screenshot({ path: `${out}/${world}.png` })
      console.log(world, JSON.stringify({ backend: await page.evaluate(() => window.mira.game.backend), errors }))
      await page.close()
    }
  }
} finally { await browser.close() }
