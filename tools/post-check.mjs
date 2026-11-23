/**
 * Post effects check: screenshots of the game with post effects off and on at a few hours,
 * on WebGPU or WebGL 2, and any page or console errors.
 *
 *   tools/heavy.sh node tools/post-check.mjs [base url] [out dir] [--webgl] [--hours 17.6,12,23] [--set id=value,...]
 *
 * Headless Chrome frame rates are not game performance; this checks looks and errors only.
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined }
const webgl = args.includes('--webgl'); if (webgl) args.splice(args.indexOf('--webgl'), 1)
const hours = (flag('--hours') ?? '17.6,12,23').split(',').map(Number)
const sets = (flag('--set') ?? '').split(',').filter(Boolean).map((kv) => kv.split('='))
const views = (flag('--views') ?? 'off,on').split(',')
const base = args[0] ?? 'http://127.0.0.1:5207/'
const out = args[1] ?? '/tmp/post-check'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('crash', () => console.log('PAGE CRASHED'))
page.on('close', () => console.log('PAGE CLOSED'))
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/AudioContext|index count of 0/.test(m.text())) errors.push(`${m.type()}: ${m.text()}`.slice(0, 400)) })
const url = `${base}${base.includes('?') ? '&' : '?'}autoplay=1&post=1&room=postfx-${Date.now().toString(36)}${webgl ? '&webgl=1' : ''}`
await page.goto(url, { waitUntil: 'load', timeout: 120000 })
await page.waitForFunction(() => window.mira?.game?.tick > 25, null, { timeout: 45000 }).catch(() => {})
await page.locator('.shell-play').click({ timeout: 3000 }).catch(() => {})
await page.waitForFunction(() => window.mira?.game?.tick > 25, null, { timeout: 30000 }).catch(async () => { console.log(JSON.stringify({ stuck: true, errors }, null, 2)); await page.screenshot({ path: `${out}/stuck.png` }); process.exit(1) })
// --volcano <distance>: park the vehicle that far from the summit, facing it.
const volcano = flag('--volcano')
if (volcano) {
  const info = await page.evaluate(async (dist) => {
    const s = window.mira, t = s.terrain, top = t.summit?.()
    if (!top) return null
    const x = top.x + dist, z = top.z
    const y = t.heightAt(x, z) + 2
    // Try both heading conventions; keep the one whose camera ends up facing the summit.
    const at = () => s.game.camera.position.clone().set(x, y, z)
    let best = null
    for (const h of [Math.PI / 2, -Math.PI / 2, 0, Math.PI]) {
      s.player.teleport(at(), h)
      await new Promise((r) => setTimeout(r, 1500))
      const cam = s.game.camera, d = { x: top.x - cam.position.x, z: top.z - cam.position.z }
      const f = cam.getWorldDirection(cam.position.clone())
      const score = (f.x * d.x + f.z * d.z) / Math.hypot(d.x, d.z)
      if (!best || score > best.score) best = { h, score }
    }
    s.player.teleport(at(), best.h)
    await new Promise((r) => setTimeout(r, 1500))
    return { top, best }
  }, Number(volcano))
  console.log('volcano', JSON.stringify(info))
}
// --face-sun: turn the sun's azimuth until it sits behind the view centre (the volcano at spawn).
if (process.argv.includes('--face-sun')) {
  await page.evaluate(() => window.mira.params.set('post.on', true))
  let best = null
  for (let az = 0; az < 360; az += 5) {
    await page.evaluate((a) => window.mira.params.set('sun.azimuth', a), az)
    await page.waitForTimeout(120)
    const [u, v, vis] = await page.evaluate(() => { const c = window.mira.game.postChain; const s = c.u.sunUv.value; return [s.x, s.y, c.u.sunVis.value] })
    const d = Math.abs(u - 0.5) - vis
    if (vis > 0.2 && (!best || d < best.d)) best = { az, d, u, v, vis }
  }
  if (best) await page.evaluate((a) => window.mira.params.set('sun.azimuth', a), best.az)
  console.log('sun azimuth', best)
}
// --drive: hold W through the views (speed streaks).
if (process.argv.includes('--drive')) await page.keyboard.down('KeyW')
const results = []
for (const hour of hours) {
  await page.evaluate((h) => window.mira.params.set('sun.timeOfDay', h), hour)
  for (const view of views) {
    // 'off' is today's game; 'on' is the post chain plus any --set values (applied only to
    // 'on'; each is reset to its default for 'off').
    await page.evaluate(({ on, sets }) => {
      const p = window.mira.params
      p.set('post.on', on)
      for (const [k, v] of sets) p.set(k, on ? (isNaN(Number(v)) ? v === 'true' : Number(v)) : p.get(k).def.default)
    }, { on: view !== 'off', sets })
    await page.waitForTimeout(2500)
    const state = await page.evaluate(() => {
      const g = window.mira.game
      const chain = g.postChain
      return { motion: chain ? +chain.u.motionAmount.value.toFixed(3) : null, backend: g.backend, tier: chain?.tier, builds: chain?.builds, draws: g.renderer.info.render.drawCalls, exposure: +g.renderer.toneMappingExposure.toFixed(3), level: window.mira.params.get('gfx.level').value, sunUv: chain ? [chain.u.sunUv.value.x, chain.u.sunUv.value.y].map((n) => +n.toFixed(3)) : null, sunVis: chain ? +chain.u.sunVis.value.toFixed(3) : null }
    })
    const shot = `${out}/${webgl ? 'webgl' : 'webgpu'}-h${hour}-${view}.png`
    await page.screenshot({ path: shot })
    results.push({ hour, view, shot, ...state })
  }
}
await browser.close()
console.log(JSON.stringify({ url, results: results.map((r) => JSON.stringify(r)), errors }, null, 1))
