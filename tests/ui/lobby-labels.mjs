// The lobby's planet labels never pile up: in the settled lobby, at phone landscape (844x390,
// 667x375), phone portrait (390x844) and desktop (1440x900), no two visible labels intersect, no
// label covers a planet other than its own, and none covers the hint, the buttons or the
// settings gear. Planets that do not fit are left unnamed (they fade and show while focused),
// so how many are named is reported, not asserted.
//   SYN3H_URL=http://127.0.0.1:5173/ tools/heavy.sh node tests/ui/lobby-labels.mjs
// Screenshots go to tests/ui/artifacts/lobby-labels/.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const url = process.env.SYN3H_URL
assert.ok(url, 'SYN3H_URL is required')
const out = 'tests/ui/artifacts/lobby-labels'
await mkdir(out, { recursive: true })
const views = { landscape: [844, 390, true], 'landscape-small': [667, 375, true], portrait: [390, 844, true], desktop: [1440, 900, false] }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  for (const [name, [width, height, phone]] of Object.entries(views)) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone }), page = await context.newPage()
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${url}?room=lobby-labels-${name}-${Date.now()}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.syn3h?.game?.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false' && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
    // Hold the graphics level, as galaxy.mjs does: a slow headless browser would retire the galaxy.
    await page.evaluate(() => { window.__pin = setInterval(() => window.syn3h.params.set('gfx.level', 2), 400) })
    await page.waitForTimeout(3500)
    const named = []
    for (let sample = 0; sample < 3; sample++) {
      const s = await page.evaluate(() => {
        const box = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom } }
        const planets = window.syn3h.shell.galaxy.screen.filter(p => p.visible && p.x >= 0 && p.x <= innerWidth && p.y >= 0 && p.y <= innerHeight)
        const labels = [...document.querySelectorAll('.galaxy-label')].filter(c => !c.hidden && Number(getComputedStyle(c).opacity) > .05).map(c => ({ id: c.dataset.world, ...box(c) }))
        const fixed = [['hint', document.querySelector('.galaxy-hint')], ['settings gear', document.querySelector('.lobby-gear-dock')], ...[...document.querySelectorAll('.galaxy-links button')].map(b => [b.textContent, b])]
        return { planets, labels, fixed: fixed.filter(([, el]) => el && el.getBoundingClientRect().width).map(([what, el]) => ({ what, ...box(el) })) }
      })
      const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
      const onDisc = (r, p) => Math.hypot(Math.min(r.right, Math.max(r.left, p.x)) - p.x, Math.min(r.bottom, Math.max(r.top, p.y)) - p.y) < p.radius
      for (const label of s.labels) {
        for (const other of s.labels) if (other !== label) assert.ok(!hit(label, other), `${name}: the ${label.id} and ${other.id} labels overlap`)
        for (const p of s.planets) if (p.id !== label.id) assert.ok(!onDisc(label, p), `${name}: the ${label.id} label covers the ${p.id} planet`)
        for (const f of s.fixed) assert.ok(!hit(label, f), `${name}: the ${label.id} label covers the ${f.what}`)
      }
      named.push(`${s.labels.length}/${s.planets.length}`)
      if (sample === 0) await page.screenshot({ path: `${out}/check-${name}.png` })
      await page.waitForTimeout(1000)
    }
    assert.deepEqual(errors, [])
    console.log(`${name}: no overlaps; named ${named.join(', ')} PASS`)
    await context.close()
  }
} finally { await browser.close() }
