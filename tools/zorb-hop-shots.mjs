/**
 * Frames of one Zorb hop and its bounces from the chase camera, through the real X and Space keys.
 *   node tools/zorb-hop-shots.mjs <base URL> <out dir> [desktop|phone]
 * Prints the ball's height above the ground at each frame.
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const [base = 'http://127.0.0.1:5431', out = '/tmp/zorb-hop', device = 'desktop'] = process.argv.slice(2)
await mkdir(out, { recursive: true })
const phone = device === 'phone'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal'] })
try {
  const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 720 }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone })
  await context.routeWebSocket(/\/ws/, (s) => s.close())
  const page = await context.newPage()
  await page.goto(`${base}/?autoplay=1&vehicle=buggy&seed=3`)
  await page.waitForFunction(() => window.mira?.game.tick > 200, null, { timeout: 120000 })
  await page.evaluate(() => { const s = window.mira; s.shell.play?.(); s.shell.closeMenu?.(); s.params.set('bots.count', 0); s.params.set('sun.dayLength', 0); s.params.set('sun.timeOfDay', 11); s.bots.daydream?.setBlocker?.(() => true) })
  if (phone) await page.evaluate(() => { window.mira.game.input.state.zorb = true }); else await page.keyboard.press('KeyX')
  await page.waitForTimeout(8000)
  await page.evaluate(() => { const s = window.mira; window.__t = s.game.time; s.game.input.state.special = !s.game.input.state.special })
  for (const [i, at] of [0.1, 0.4, 0.8, 1.2, 1.8, 2.6, 3.4].entries()) {
    await page.waitForFunction((at) => window.mira.game.time - window.__t >= at, at, { timeout: 60000 })
    const h = await page.evaluate(() => { const s = window.mira, z = s.player.zorb, c = z.centre(new s.player.object.position.constructor()); s.game.pause(); return +(c.y - z.radius - s.terrain.heightAt(c.x, c.z)).toFixed(2) })
    await page.waitForTimeout(150)
    await page.screenshot({ path: `${out}/${device}-${i + 1}.png` })
    console.log(`+${at}s ball base ${h} m`)
    await page.evaluate(() => window.mira.game.resume())
  }
} finally {
  await browser.close()
}
