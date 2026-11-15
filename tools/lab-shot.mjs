/**
 * Scripted screenshots of the vehicle lab, for reviewing a model from fixed angles.
 *
 *   node tools/lab-shot.mjs <base url> <output dir> <shot> [<shot> ...]
 *   node tools/lab-shot.mjs <base url> list
 *
 * A shot is `name=query@az,el,dist` or `name=query@x,y,z>x,y,z` (camera position, then the
 * point it looks at, in metres) or `name=query` for the query's own view. `query` is the
 * lab's URL query without `still=1`, which is added. Example:
 *
 *   node tools/lab-shot.mjs http://127.0.0.1:5201/ /tmp/shots \
 *     'under=vehicle=game&design=buggy-syn3h@30,-40,7' 'corner=vehicle=game&design=buggy-syn3h@-2.2,.9,-2.6>-1,.3,-1.3'
 *
 * Exits non zero on a page error. Run it through tools/heavy.sh.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const [base, out, ...shots] = process.argv.slice(2)
if (!base || !out) { console.error('usage: lab-shot.mjs <base url> <output dir|list> <shot>...'); process.exit(2) }
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('pageerror', (e) => errors.push(e.message))
  const open = async (query) => {
    await page.goto(new URL(`vehicle-lab.html?${query}${query ? '&' : ''}still=1`, base).href)
    await page.waitForFunction(() => window.vehicleLab?.ready, null, { timeout: 90000 })
  }
  if (out === 'list') {
    await open('')
    console.log(JSON.stringify(await page.evaluate(() => window.vehicleLab.vehicles()), null, 1))
  } else {
    mkdirSync(out, { recursive: true })
    for (const shot of shots) {
      const eq = shot.indexOf('='), at = shot.lastIndexOf('@')
      const name = shot.slice(0, eq), query = shot.slice(eq + 1, at < 0 ? undefined : at), cam = at < 0 ? '' : shot.slice(at + 1)
      await open(query)
      await page.evaluate(async (cam) => {
        const lab = window.vehicleLab
        if (cam.includes('>')) {
          const [p, t] = cam.split('>').map((s) => s.split(',').map(Number))
          lab.look(p, t)
        } else if (cam) {
          const [az, el, dist] = cam.split(',').map(Number)
          lab.orbit(az, el, dist)
        }
        await lab.frames(25)
      }, cam)
      const path = join(out, `${name}.png`)
      await page.screenshot({ path })
      console.log(path, JSON.stringify(await page.evaluate(() => window.vehicleLab.stats()?.designs ?? null)))
    }
  }
} finally { await browser.close() }
if (errors.length) { console.error('PAGE ERRORS', errors.slice(0, 5)); process.exit(1) }
