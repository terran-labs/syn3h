/**
 * Headless smoke test. Loads the running dev server in the system Chrome, drives forward
 * for a few seconds, and reports what happened.
 *
 *   node tools/smoke.mjs [url] [screenshot.png]
 *
 * Exits non zero on a page error, a console error, or if the vehicle fell through the world.
 */
import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'http://localhost:5173/'
const shot = process.argv[3] ?? '/tmp/syn3h-smoke.png'

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })

await page.goto(url, { waitUntil: 'load' })
await page.waitForFunction(() => window.syn3h?.game?.tick > 25, null, { timeout: 30000 }).catch(() => {})

const read = () => page.evaluate(() => {
  const s = window.syn3h
  if (!s) return null
  const p = s.player.body.translation()
  return {
    backend: s.game.backend, tick: s.game.tick, fps: Math.round(s.game.fps),
    pos: [p.x, p.y, p.z].map((n) => +n.toFixed(2)),
    ground: +s.terrain.heightAt(p.x, p.z).toFixed(2),
    params: s.params.all().length,
    hud: (document.querySelector('.shell-hud') ?? document.getElementById('hud')).textContent,
  }
})

// Dismiss the start screen if there is one.
await page.locator('.shell-play').click({ timeout: 3000 }).catch(() => {})
await page.waitForTimeout(500)
const before = await read()
await page.keyboard.down('KeyW')
await page.waitForTimeout(3000)
await page.keyboard.up('KeyW')
const after = await read()
await page.screenshot({ path: shot })
await browser.close()

console.log(JSON.stringify({ before, after, errors, screenshot: shot }, null, 2))
const fell = !after || after.pos[1] < after.ground - 2
const moved = before && after && Math.hypot(after.pos[0] - before.pos[0], after.pos[2] - before.pos[2]) > 1
if (errors.length || fell || !moved) {
  console.error(`SMOKE FAILED: errors=${errors.length} fell=${fell} moved=${moved}`)
  process.exit(1)
}
console.log('SMOKE OK')
