/**
 * Screenshots of the Terrain Lab viewer for a list of seeds and views.
 *
 *   node tools/terrainlab/lab-shots.mjs [outDir] [seeds] [views] [extra query]
 *   node tools/terrainlab/lab-shots.mjs /tmp/lab 1,7 aerial,coast "night=1"
 *   node tools/terrainlab/lab-shots.mjs /tmp/lab ref:Freestyle aerial,low
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const out = process.argv[2] ?? '/tmp/terrainlab-lab'
const seeds = (process.argv[3] ?? '1').split(',')
const views = (process.argv[4] ?? 'aerial,low,coast,crater,breach,crags,rim').split(',')
const extra = process.argv[5] ? `&${process.argv[5]}` : ''
const base = process.env.LAB_URL ?? 'http://localhost:5191/terrainlab.html'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
const report = []
for (const seed of seeds) {
  const isRef = seed.startsWith('ref:')
  const q = isRef ? `ref=${seed.slice(4)}` : `seed=${seed}`
  await page.goto(`${base}?${q}&clean=1${extra}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.terrainLab?.frames > 5, null, { timeout: 30000 })
  const tag = isRef ? seed.slice(4) : `seed${seed}`
  for (const view of views) {
    await page.evaluate((v) => window.terrainLab.setView(v), view)
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${out}/${tag}-${view}.png` })
  }
  report.push(await page.evaluate(() => {
    const l = window.terrainLab
    return { seed: l.data?.seed, ms: l.generateMs && +l.generateMs.toFixed(1), timings: l.data?.timings, min: l.min, max: l.max }
  }))
}
await browser.close()
console.log(JSON.stringify({ report, errors }, null, 1))
