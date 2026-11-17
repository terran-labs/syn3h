/**
 * Loads lab pages one after another on a freshly started dev server and reports console errors
 * and page errors for each: the cold-start check for the loft editor. Run through tools/heavy.sh.
 *
 *   node tools/buggy-fit/sections/coldLoad.mjs http://127.0.0.1:5392/ 'vehicle=loft-editor' ...
 */
import { chromium } from 'playwright-core'
const [base, ...queries] = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
let failed = 0
try {
  for (const q of queries) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = []
    page.on('pageerror', e => errors.push(`page: ${e.message}`))
    page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
    const t0 = Date.now()
    try {
      await page.goto(new URL(`vehicle-lab.html?${q}&idle=0`, base).href, { timeout: 180000 })
      await page.waitForFunction(() => window.vehicleLab?.ready, null, { timeout: 180000 })
      const st = await page.evaluate(() => { const s = window.vehicleLab.stats(); return `${window.vehicleLab.exhibit}, ${s.triangles} triangles, ${s.drawCalls} draws` })
      console.log(`${errors.length ? 'ERRORS' : 'ok'}  ${q}  (${((Date.now() - t0) / 1000).toFixed(1)} s; ${st})${errors.length ? '\n    ' + errors.join('\n    ') : ''}`)
    } catch (e) { errors.push(String(e)); console.log(`FAILED  ${q}: ${errors.join(' | ')}`) }
    if (errors.length) failed++
    await page.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
