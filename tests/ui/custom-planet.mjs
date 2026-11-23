import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium, webkit } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
await mkdir('tests/ui/artifacts/custom', { recursive: true })
for (const { engine, name, viewport } of [{ engine: chromium, name: 'desktop', viewport: { width: 1280, height: 900 } }, { engine: chromium, name: 'phone', viewport: { width: 390, height: 844 } }, { engine: webkit, name: 'ipad', viewport: { width: 1024, height: 1366 } }]) {
  const browser = await engine.launch(engine === chromium ? { channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] } : {})
  try {
    const page = await browser.newPage({ viewport })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(process.env.MIRA_URL ?? 'http://127.0.0.1:5193/')
    await page.waitForFunction(() => window.mira?.shell?.galaxy?.live && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
    // The lobby hides the Custom planet for now (OFFER_CUSTOM_PLANET in src/ui/Shell.ts). This
    // check is kept for when it returns and has nothing to look at until then.
    if (!await page.evaluate(() => window.mira.shell.galaxy.options.worlds.some(world => world.id === 'custom'))) { console.log(`${name}: the Custom planet is hidden; nothing to check`); continue }
    await page.evaluate(() => { window.__pin = setInterval(() => window.mira.params.set('gfx.level', 2), 400) })
    await page.locator('.galaxy-label[data-world="custom"]').dispatchEvent('click')
    await page.waitForFunction(() => document.querySelector('.lobby-panels').dataset.activePanel === 'advanced', null, { timeout: 15000 })
    const settled = () => page.waitForFunction(() => {
      const g = window.mira.shell.galaxy, i = g.options.worlds.findIndex(w => w.id === 'custom'), world = g.options.worlds[i]
      return !world.forming && g.layers[i] === g.mapKey(world, [512, 256]) && g.closeKey === g.mapKey(world, [1024, 512])
    }, null, { timeout: 60000 })
    await settled()
    const before = await page.evaluate(() => { const g = window.mira.shell.galaxy; return { key: g.closeKey, data: [...g.maps.get(g.closeKey).data.slice(0, 160)] } })
    await page.evaluate(() => { const p = window.mira.params; p.set('world.seaKind', p.get('world.seaKind').value === 0 ? 1 : 0); p.set('terrain.treeCover', 0); p.set('terrain.volcanoHeight', 100); p.set('terrain.volcanoHeight', 200) })
    await page.waitForFunction(key => window.mira.shell.galaxy.closeKey !== key, before.key)
    await settled()
    const after = await page.evaluate(() => { const g = window.mira.shell.galaxy, w = g.options.worlds.find(w => w.id === 'custom'); return { key: g.closeKey, overrides: w.overrides, data: [...g.maps.get(g.closeKey).data.slice(0, 160)] } })
    assert.equal(after.overrides['terrain.treeCover'], 0)
    assert.equal(after.overrides['terrain.volcanoHeight'], 200)
    assert.notEqual(after.key, before.key)
    assert.notDeepEqual(after.data, before.data)
    await page.waitForTimeout(500)
    const exposed = await page.evaluate(() => {
      const g = window.mira.shell.galaxy, planet = g.screen.find(p => p.id === 'custom')
      const panel = document.querySelector('.lobby-panels').getBoundingClientRect()
      return planet && (planet.x + planet.radius < panel.left || planet.y + planet.radius < panel.top)
    })
    assert.equal(exposed, true, 'the whole Custom planet stays clear of the sliders')
    await page.screenshot({ path: `tests/ui/artifacts/custom/${name}.png` })
    assert.deepEqual(errors, [])
    console.log(`${name}: CUSTOM MAP OK`)
  } finally { await browser.close() }
}
