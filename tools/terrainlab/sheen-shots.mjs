/**
 * Looks down at the ground from above the buggy, facing the sun and away from it, to show
 * any pale wash on the terrain toward the sun, with the haze and the post effects switched
 * off in turn so the cause can be told apart.
 * Run through tools/heavy.sh:
 *
 *   node tools/terrainlab/sheen-shots.mjs [baseUrl] [outDir] [world] [hour]
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'

const base = process.argv[2] ?? 'http://localhost:5197/'
const out = process.argv[3] ?? '/tmp/terrainlab/sheen'
const world = process.argv[4] ?? 'volcanic.1'
const hour = process.argv[5]
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const report = []
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)) })
  await page.routeWebSocket(/\/ws/, (s) => s.close())
  await page.goto(`${base}?autoplay=1&vehicle=buggy&world=${world}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.syn3h?.game?.tick > 60, null, { timeout: 180000 })
  const sun = await page.evaluate((hour) => {
    const s = window.syn3h
    s.params.set('gfx.level', 2); s.params.set('bots.count', 0); s.params.set('sun.dayLength', 0)
    if (hour) s.params.set('sun.timeOfDay', Number(hour))
    s.params.set('terrain.groundCover', 0)
    s.game.quality.frame = () => {}
    const sky = s.game.scene.children.find((o) => 'sunDirection' in o)
    const d = sky.sunDirection.value
    return { x: d.x, y: d.y, z: d.z, hour: s.params.get?.('sun.timeOfDay') }
  }, hour)
  const cases = [
    ['default', {}],
    ['haze0', { 'weather.hazeDensity': 0, 'weather.aerial': 0 }],
    ['post0', { 'post.on': 0 }],
  ]
  for (const [name, set] of cases) {
    for (const view of ['toSun', 'fromSun']) {
      await page.evaluate(async ({ set, view }) => {
        const s = window.syn3h, defaults = window.sheenDefaults ??= Object.fromEntries(['weather.hazeDensity', 'weather.aerial', 'post.on'].map((id) => [id, s.params.get(id).value])), unused = {}
        for (const [id, v] of Object.entries({ ...unused, ...defaults, ...set })) s.params.set(id, v)
        const V = s.player.object.position.constructor, at = s.player.object.position
        const sky = s.game.scene.children.find((o) => 'sunDirection' in o), d = sky.sunDirection.value
        const len = Math.hypot(d.x, d.z) || 1, sign = view === 'toSun' ? -1 : 1
        // 9 m up and 7 m back from the buggy, on the side away from (or toward) the sun.
        s.camera.setCinematicPose(new V(at.x + sign * d.x / len * 7, at.y + 9, at.z + sign * d.z / len * 7), new V(at.x, at.y, at.z))
      }, { set, view })
      await page.waitForTimeout(3500)
      const file = `${out}/${name}-${view}.png`
      await page.screenshot({ path: file })
      report.push({ name, view })
    }
  }
  writeFileSync(`${out}/report.json`, JSON.stringify({ world, sun, report, errors }, null, 2))
  console.log(JSON.stringify({ world, sun, errors }))
} finally { await browser.close() }
