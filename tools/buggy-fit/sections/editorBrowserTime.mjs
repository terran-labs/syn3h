/**
 * Regeneration time per slider edit in the browser for the loft editor exhibit: moves sliders
 * through the lab's control API and reads the exhibit's readout. Desktop Chrome, headless, as
 * tools/lab-shot.mjs launches it. Run through tools/heavy.sh.
 *
 *   node tools/buggy-fit/sections/editorBrowserTime.mjs http://127.0.0.1:5392/ [full]
 */
import { chromium } from 'playwright-core'
const full = process.argv[3] === 'full'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(new URL(`vehicle-lab.html?vehicle=loft-editor&idle=0${full ? '&full=1' : ''}`, process.argv[2]).href)
  await page.waitForFunction(() => window.vehicleLab?.ready, null, { timeout: 120000 })
  const r = await page.evaluate(async (n) => {
    const ids = ['deck', 'width', 'archFront', 'wingHeight', 'cockpitLength', 'tailKick'], body = [], whole = []
    const text = () => [...document.querySelectorAll('div')].find(d => d.textContent?.startsWith('Body regenerated'))?.textContent ?? ''
    for (let i = 0; i < n; i++) {
      window.vehicleLab.control(`loft.${ids[i % ids.length]}`, (i % 4) * .02)
      await new Promise(res => setTimeout(res, n < 10 ? 2500 : 50)); await window.vehicleLab.frames(2)
      const t = text(); body.push(Number(/in ([\d.]+) ms/.exec(t)?.[1])); const w = /built in ([\d.]+) ms/.exec(t); if (w) whole.push(Number(w[1]))
    }
    return { body, whole, last: text(), url: location.search }
  }, full ? 8 : 40)
  const med = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? `${s[s.length >> 1]} ms median, ${s[Math.floor(s.length * .95)]} ms p95 over ${s.length}` : 'none' }
  console.log(`body: ${med(r.body)}; whole buggy: ${med(r.whole)}; ${r.last}; url ${r.url}; errors ${errors.length ? errors.join(' | ') : 'none'}`)
} finally { await browser.close() }
