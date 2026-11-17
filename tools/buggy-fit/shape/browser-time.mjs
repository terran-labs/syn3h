/**
 * Regeneration time per edit in the browser: opens the shape exhibit, moves sliders through
 * the lab's control API 60 times and reads the exhibit's readout after each. Desktop Chrome,
 * headless, as tools/lab-shot.mjs launches it. Run through tools/heavy.sh.
 *
 *   node tools/buggy-fit/shape/browser-time.mjs http://127.0.0.1:5297/
 */
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(new URL('vehicle-lab.html?vehicle=buggy-shape&idle=0', process.argv[2]).href)
  await page.waitForFunction(() => window.vehicleLab?.ready, null, { timeout: 90000 })
  const times = await page.evaluate(async () => {
    const ids = ['noseLength', 'width', 'frontFlare', 'spoilerHeight', 'cockpitLength', 'haunchHeight'], out = []
    for (let i = 0; i < 60; i++) {
      window.vehicleLab.control(`shape.${ids[i % ids.length]}`, (i % 5) * .02)
      const text = [...document.querySelectorAll('div')].find(d => d.textContent?.startsWith('Regenerated in'))?.textContent ?? ''
      out.push(Number(/in ([\d.]+) ms/.exec(text)?.[1]))
      await window.vehicleLab.frames(1)
    }
    return { out, url: location.search, readout: [...document.querySelectorAll('div')].find(d => d.textContent?.startsWith('Regenerated in'))?.textContent }
  })
  const s = times.out.filter(Number.isFinite).sort((a, b) => a - b)
  console.log(`browser regenerate: median ${s[s.length >> 1]} ms, p95 ${s[Math.floor(s.length * .95)]} ms over ${s.length} edits; ${times.readout}; url ${times.url}; errors ${errors.length ? errors.join(' | ') : 'none'}`)
} finally { await browser.close() }
