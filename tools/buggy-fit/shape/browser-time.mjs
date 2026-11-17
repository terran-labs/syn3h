/**
 * Regeneration time per edit in the browser: opens the shape exhibit, moves sliders through
 * the lab's control API and reads the exhibit's readout after each edit has been built, first
 * with the body alone, then with the whole buggy. Also reports the whole buggy's triangles at
 * near detail. Desktop Chrome, headless, as tools/lab-shot.mjs launches it. Run through
 * tools/heavy.sh.
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
  for (const bodyOnly of [true, false]) {
    const r = await page.evaluate(async bodyOnly => {
      const lab = window.vehicleLab, read = () => [...document.querySelectorAll('div')].find(d => / regenerated in /.test(d.textContent ?? '') && !d.children.length)?.textContent ?? ''
      lab.control('shape.body', bodyOnly); await window.buggyShapeSettled()
      const ids = ['noseLength', 'width', 'frontFlare', 'spoilerHeight', 'cockpitSize', 'lampSize', 'tailHeight', 'scoopSize'], out = []
      for (let i = 0; i < 60; i++) {
        lab.control(`shape.${ids[i % ids.length]}`, ((i % 5) - 2) * .04)
        await window.buggyShapeSettled()
        out.push(Number(/in ([\d.]+) ms/.exec(read())?.[1]))
        await lab.frames(1)
      }
      return { out, readout: read() }
    }, bodyOnly)
    const s = r.out.filter(Number.isFinite).sort((a, b) => a - b)
    console.log(`${bodyOnly ? 'body alone ' : 'whole buggy'}: median ${s[s.length >> 1]} ms, p95 ${s[Math.floor(s.length * .95)]} ms over ${s.length} edits; last: ${r.readout}`)
  }
  console.log(`errors ${errors.length ? errors.join(' | ') : 'none'}`)
} finally { await browser.close() }
