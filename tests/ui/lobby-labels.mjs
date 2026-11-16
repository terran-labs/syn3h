// The lobby's planet labels on phones: every planet named, and nothing covering anything.
//   SYN3H_URL=http://127.0.0.1:5173/ tools/heavy.sh node tests/ui/lobby-labels.mjs
// For each view, three moments a second apart: in every one, no label overlaps a planet, the
// hint, the wordmark or a button, and no planet sits under the hint or a button. Every planet
// must be named in at least two of the three: while the orbits turn, a planet can be boxed in
// against the sun for a moment, and it is named again as it moves on.
// Screenshots go to tests/ui/artifacts/lobby-labels/.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const url = process.env.SYN3H_URL
assert.ok(url, 'SYN3H_URL is required')
const out = 'tests/ui/artifacts/lobby-labels'
await mkdir(out, { recursive: true })
const views = { portrait: [390, 844], landscape: [844, 390], 'landscape-small': [667, 375] }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  for (const [name, [width, height]] of Object.entries(views)) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }), page = await context.newPage()
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${url}?room=lobby-labels-${name}-${Date.now()}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.syn3h?.game?.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false' && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
    // Hold the graphics level, as galaxy.mjs does: a slow headless browser would retire the galaxy.
    await page.evaluate(() => { window.__pin = setInterval(() => window.syn3h.params.set('gfx.level', 2), 400) })
    await page.waitForTimeout(3500)
    const named = new Map()
    for (let sample = 0; sample < 3; sample++) {
      const s = await page.evaluate(() => {
        const box = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom } }
        const planets = window.syn3h.shell.galaxy.screen.filter(p => p.visible && p.x >= 0 && p.x <= innerWidth && p.y >= 0 && p.y <= innerHeight)
        const labels = [...document.querySelectorAll('.galaxy-label')].filter(c => !c.hidden && getComputedStyle(c).opacity !== '0').map(c => ({ id: c.dataset.world, ...box(c) }))
        const fixed = [['wordmark', document.querySelector('.shell-logo')], ['hint', document.querySelector('.galaxy-hint')], ...[...document.querySelectorAll('.galaxy-links button')].map(b => [b.textContent, b])]
        return { planets, labels, fixed: fixed.filter(([, el]) => el && el.getBoundingClientRect().width).map(([what, el]) => ({ what, ...box(el) })) }
      })
      const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
      const onDisc = (r, p) => Math.hypot(Math.min(r.right, Math.max(r.left, p.x)) - p.x, Math.min(r.bottom, Math.max(r.top, p.y)) - p.y) < p.radius
      for (const label of s.labels) {
        for (const p of s.planets) assert.ok(!onDisc(label, p), `${name}: the ${label.id} label covers the ${p.id} planet`)
        for (const f of s.fixed) assert.ok(!hit(label, f), `${name}: the ${label.id} label covers the ${f.what}`)
      }
      for (const p of s.planets) for (const f of s.fixed.filter(f => f.what !== 'wordmark')) assert.ok(!onDisc(f, p), `${name}: the ${p.id} planet sits under the ${f.what}`)
      for (const p of s.planets) named.set(p.id, (named.get(p.id) ?? 0) + (s.labels.some(l => l.id === p.id) ? 1 : 0))
      if (sample === 0) await page.screenshot({ path: `${out}/check-${name}.png` })
      await page.waitForTimeout(1000)
    }
    for (const [id, count] of named) assert.ok(count >= 2, `${name}: ${id} was named in only ${count} of 3 moments`)
    assert.deepEqual(errors, [])
    console.log(`${name}: ${named.size} planets named, nothing covered PASS`)
    await context.close()
  }
} finally { await browser.close() }
