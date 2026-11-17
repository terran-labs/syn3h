// Nearest-neighbour enlargements of part of a screenshot, so single pixels can be inspected.
//   node tests/ui/wordmark-zoom.mjs <in.png> <out.png> <x0 y0 x1 y1 as fractions> <scale>
import { chromium } from 'playwright-core'
import { readFile } from 'node:fs/promises'
const [input, output, frac, scale = '6'] = process.argv.slice(2)
const [x0, y0, x1, y1] = frac.split(',').map(Number), k = Number(scale)
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  const data = `data:image/png;base64,${(await readFile(input)).toString('base64')}`
  const size = await page.evaluate(async src => { const i = new Image(); i.src = src; await i.decode(); return [i.width, i.height] }, data)
  const cx = Math.round(size[0] * x0), cy = Math.round(size[1] * y0), w = Math.round(size[0] * (x1 - x0)), h = Math.round(size[1] * (y1 - y0))
  await page.setViewportSize({ width: w * k, height: h * k })
  await page.setContent(`<body style="margin:0;overflow:hidden"><div style="width:${w * k}px;height:${h * k}px;overflow:hidden;position:relative"><img src="${data}" style="position:absolute;left:${-cx * k}px;top:${-cy * k}px;width:${size[0] * k}px;image-rendering:pixelated"></div></body>`)
  await page.waitForTimeout(100)
  await page.screenshot({ path: output })
} finally { await browser.close() }
