/** Fresh ordinary entry, without a water URL or a direct enable call. Run via heavy.sh. */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const [base, out = '/tmp/water-normal-entry'] = process.argv.slice(2)
if (!base) throw new Error('Provide the preview origin')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = { errors: [], cases: [] }
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', e => report.errors.push(e.message))
  await page.routeWebSocket(/\/ws/, socket => socket.close())
  await page.goto(base, { waitUntil: 'load', timeout: 120000 })
  await page.waitForFunction(() => window.syn3h?.shell, null, { timeout: 120000 })
  await page.evaluate(() => window.syn3h.shell.play())
  await page.waitForFunction(() => window.syn3h.game.time > 4 && document.querySelector('.syn3h-shell')?.classList.contains('is-playing'), null, { timeout: 120000 })
  for (const world of ['volcanic', 'alpine', 'moon']) {
    await page.evaluate(async world => {
      const { applyPlanet } = await import('/src/world/planets.ts')
      applyPlanet(world, 7)
    }, world)
    await page.waitForTimeout(2000)
    const state = await page.evaluate(() => {
      const s = window.syn3h, flags = Object.fromEntries(['waves', 'sinking', 'underwater', 'ripples', 'spray'].map(k => [k, s.params.get(`water.${k}`).value]))
      return { flags, seaKind: s.params.get('world.seaKind').value, dry: s.terrain.data.settings.dry,
        seaMeshes: s.terrain.volcanics.sea.length, backend: s.game.backend, calls: s.game.performance.drawCalls }
    })
    report.cases.push({ world, ...state })
    assert.ok(Object.values(state.flags).every(Boolean), `${world}: water defaults are not all on`)
    if (world === 'volcanic') assert.equal(state.seaKind, 0)
    if (world === 'alpine') assert.equal(state.seaKind, 1)
    if (world === 'moon') assert.equal(state.seaMeshes, 0)
    await page.screenshot({ path: `${out}/${world}.png` })
  }
  await page.evaluate(() => {
    for (const name of ['waves', 'sinking', 'underwater', 'ripples', 'spray']) window.syn3h.params.set(`water.${name}`, false)
  })
  await page.waitForTimeout(2500)
  const off = await page.evaluate(() => ['waves', 'sinking', 'underwater', 'ripples', 'spray'].map(k => window.syn3h.params.get(`water.${k}`).value))
  assert.ok(off.every(v => v === false), 'Explicit off was overwritten')
  report.off = off
  assert.deepEqual(report.errors, [])
} finally { writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2)); await browser.close() }
console.log(JSON.stringify(report, null, 2))
