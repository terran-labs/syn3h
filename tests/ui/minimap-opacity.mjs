// The owner, 15 November 2026: the minimap is "too faded out... at least 80% opaque in the
// center". Opacity, the feathering mask and the focus-state fade multiply, so a CSS value
// proves nothing. This measures the composited result from pixels.
//
// Method: put a solid white plate, then a solid black plate, directly behind the minimap and
// screenshot its centre both times. For any pixel, shown = a * map + (1 - a) * plate, so the
// difference between the two captures is (1 - a) * 255 and the map's own colour cancels out.
// White and black are the brightest and darkest scenes there can be. The vehicle is parked,
// so the map does not change between the paired captures.
//
//   node tests/ui/minimap-opacity.mjs        (game on MIRA_URL)
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5198/'
const FLOOR = 0.8
await mkdir('tests/ui/artifacts/minimap', { recursive: true })
const report = {}
for (const mode of (process.env.UX_VIEW ? [process.env.UX_VIEW] : ['desktop', 'ipad', 'phone'])) {
  const touch = mode !== 'desktop'
  const browser = await (touch ? webkit.launch() : chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const page = await browser.newPage(touch ? { ...devices[mode === 'ipad' ? 'iPad (gen 7)' : 'iPhone 14'] } : { viewport: { width: 1440, height: 1000 } })
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    // Screenshots are decoded to pixels in a blank page of the same browser: no image library needed.
    const decoder = await browser.newPage()
    const pixels = buffer => decoder.evaluate(async base64 => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob())
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
      const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0)
      return Array.from(context.getImageData(0, 0, bitmap.width, bitmap.height).data)
    }, buffer.toString('base64'))
    await page.goto(`${base}?autoplay=1&room=minimap-${mode}-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.game.tick > 60, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    await page.waitForTimeout(2500) // the vehicle settles on its pad
    const box = await page.locator('.shell-minimap').boundingBox()
    // The centre fifth of the map, clear of the feathered edge and the compass ring.
    const clip = { x: box.x + box.width * 0.4, y: box.y + box.height * 0.4, width: box.width * 0.2, height: box.height * 0.2 }
    const plate = colour => page.evaluate(colour => {
      let el = document.querySelector('#minimap-plate')
      if (!colour) { el?.remove(); return }
      const map = document.querySelector('.shell-minimap')
      if (!el) { el = document.createElement('div'); el.id = 'minimap-plate'; map.before(el) }
      const r = map.getBoundingClientRect()
      Object.assign(el.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, background: colour, zIndex: String(Number(getComputedStyle(map).zIndex) - 1), pointerEvents: 'none' })
    }, colour)
    const measure = async label => {
      const shots = {}
      for (const colour of ['#ffffff', '#000000']) {
        await plate(colour); await page.waitForTimeout(250)
        const buffer = await page.screenshot({ clip }); shots[colour] = await pixels(buffer)
        await writeFile(`tests/ui/artifacts/minimap/${mode}-${label}-${colour === '#ffffff' ? 'bright' : 'dark'}.png`, buffer)
      }
      await plate(null)
      const white = shots['#ffffff'], black = shots['#000000'], alphas = []
      for (let i = 0; i < white.length; i += 4) for (let c = 0; c < 3; c++) alphas.push(1 - (white[i + c] - black[i + c]) / 255)
      alphas.sort((a, b) => a - b)
      return { median: alphas[alphas.length >> 1], lowest: alphas[Math.floor(alphas.length * 0.02)] }
    }
    const result = { drive: await measure('drive') }
    if (!touch) {
      // Cursor captured: the map must not fade below the floor in the focus display either.
      await page.mouse.click(600, 420)
      await page.waitForFunction(() => document.querySelector('.mira-shell').classList.contains('is-focus'), null, { timeout: 5000 })
      await page.waitForTimeout(600)
      result.focus = await measure('focus')
    }
    for (const [state, alpha] of Object.entries(result)) {
      assert.ok(alpha.median >= FLOOR, `${mode} ${state}: minimap centre is ${(alpha.median * 100).toFixed(0)}% opaque, floor ${FLOOR * 100}%`)
      assert.ok(alpha.lowest >= FLOOR - 0.05, `${mode} ${state}: no faded patch in the centre (${(alpha.lowest * 100).toFixed(0)}%)`)
    }
    assert.deepEqual(errors, [])
    report[mode] = result
    console.log(`${mode}: minimap centre opacity ${Object.entries(result).map(([state, a]) => `${state} ${(a.median * 100).toFixed(0)}%`).join(', ')}`)
  } finally { await writeFile('tests/ui/artifacts/minimap/opacity.json', JSON.stringify(report, null, 2)); await browser.close() }
}
