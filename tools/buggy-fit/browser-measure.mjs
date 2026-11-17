/**
 * Loaded against generated buggy skin in a real browser: time from construction to ready,
 * triangles and draws at each detail level (the lab's own counts), and every model file
 * requested while the design loads.
 *
 *   tools/heavy.sh node tools/buggy-fit/browser-measure.mjs http://127.0.0.1:5297/
 *
 * The lab recounts every 15 frames, so each level waits 20. Needs the dev server. Each skin gets a fresh page, so neither shares the other's cache.
 */
import { chromium } from 'playwright-core'

const base = process.argv[2]
if (!base) { console.error('usage: browser-measure.mjs <base url>'); process.exit(2) }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const results = {}
try {
  for (const id of ['loaded', 'generated']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    const models = []
    page.on('request', r => { if (/\.(glb|gltf|bin)(\?|$)/.test(r.url())) models.push(new URL(r.url()).pathname) })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(new URL(`vehicle-lab.html?vehicle=buggy-fit&group=Skins&design=${id}&still=1`, base).href)
    await page.waitForFunction(() => window.vehicleLab?.ready, null, { timeout: 90000 })
    const levels = []
    for (const lod of [0, 1, 2]) {
      levels.push(await page.evaluate(async lod => { window.vehicleLab.setLod(lod); await window.vehicleLab.frames(20); const s = window.vehicleLab.stats(); return { detail: s.detail, triangles: s.triangles, drawCalls: s.drawCalls } }, lod))
    }
    results[id] = { readyMs: await page.evaluate(id => globalThis.buggySkinReadyMs?.[id], id), levels, models, errors }
    await page.close()
  }
} finally {
  await browser.close()
}
console.log(JSON.stringify(results, null, 1))
