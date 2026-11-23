/**
 * Frame traces for the lobby and for the drop, as numbers rather than a pass or fail.
 *
 *  1. Lobby idle: five seconds of frame gaps in the galaxy at each graphics level.
 *  2. The drop: every frame gap from the tap to one second after landing, split into its
 *     phases (the flight across the system, the hold under the light while the world is
 *     built, the fall through the air, the first second on the ground), with main-thread
 *     long tasks and the terrain's own generation time beside them.
 *
 *   MIRA_URL=http://127.0.0.1:5193/ /Users/vtn/dev/Syn3h/tools/heavy.sh node tests/ui/drop-trace.mjs
 *
 * Options (environment): TRACE_LEVELS=0,1,2 (levels to trace), TRACE_WORLD=alpine,
 * TRACE_OUT=path.json. Headless numbers are this Mac's, not a phone's: they locate stalls
 * and compare a change against its base. They do not prove smoothness on a device.
 */
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import { writeFile } from 'node:fs/promises'
const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5193/'
const levels = (process.env.TRACE_LEVELS ?? '0,1,2').split(',').map(Number)
const world = process.env.TRACE_WORLD ?? 'alpine'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const ready = page => page.waitForFunction(() => window.mira?.game?.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false' && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
const stats = gaps => {
  if (!gaps.length) return { frames: 0 }
  const s = [...gaps].sort((a, b) => a - b), at = q => Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))] * 10) / 10
  const total = gaps.reduce((a, b) => a + b, 0)
  return { frames: gaps.length, seconds: Math.round(total / 100) / 10, fps: Math.round(gaps.length / total * 10000) / 10, p50: at(0.5), p95: at(0.95), max: at(1), over33: gaps.filter(g => g > 33.4).length, over50: gaps.filter(g => g > 50).length, over100: gaps.filter(g => g > 100).length }
}
const result = { base, world, when: new Date().toISOString(), idle: [], drops: [], errors: [] }
try {
  for (const level of levels) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const logs = []
    page.on('pageerror', e => result.errors.push(`level ${level}: ${e.message.slice(0, 200)}`))
    page.on('console', m => { const text = m.text(); if (m.type() === 'error') result.errors.push(`level ${level}: ${text.slice(0, 200)}`); if (/terrain regenerated/.test(text)) logs.push(text) })
    await page.goto(`${base}?room=trace-${level}-${Date.now()}`, { waitUntil: 'load' }); await ready(page)
    // The quality controller may move the level on a slow headless frame: hold it where asked.
    await page.evaluate(l => { window.__pin = setInterval(() => { if (window.mira.params.get('gfx.level')?.value !== l) window.mira.params.set('gfx.level', l) }, 400); window.mira.params.set('gfx.level', l) }, level)
    await page.waitForFunction(() => window.mira.shell.graphics.planetMaps >= window.mira.planets.PLANETS.length, null, { timeout: 60000 })
    await page.waitForTimeout(2500)
    // Long tasks (main-thread work over 50 ms) for the whole page from here on.
    await page.evaluate(() => { window.__long = []; try { new PerformanceObserver(list => { for (const e of list.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration)]) }).observe({ entryTypes: ['longtask'] }) } catch { /* Not offered: gaps alone. */ } })
    // 1. The lobby at rest.
    const idle = await page.evaluate(() => new Promise(resolve => { const gaps = []; let last = performance.now(); const end = last + 5000; const tick = now => { gaps.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else resolve(gaps.slice(1)) }; requestAnimationFrame(tick) }))
    result.idle.push({ level, canvas: await page.evaluate(() => { const c = document.querySelector('.galaxy-canvas'); return c ? `${c.width}x${c.height}` : 'not found' }), ...stats(idle) })
    // 2. The drop. Each frame records where the drop has got to.
    await page.evaluate(() => {
      const w = window, shell = document.querySelector('.mira-shell'), overlay = document.querySelector('.shell-overlay'); w.__frames = []; let last = performance.now()
      w.__t0 = last
      const tick = now => {
        const g = w.mira.shell.galaxy, descending = shell.classList.contains('is-descending'), playing = shell.classList.contains('is-playing')
        const fading = overlay.style.opacity === '0'
        const phase = !descending ? (playing ? 'ground' : 'before') : fading ? 'air' : g?.flightDone ? 'light' : 'flight'
        w.__frames.push([Math.round(now - w.__t0), now - last, phase]); last = now
        if (!w.__done) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    const where = await page.evaluate(id => window.mira.shell.galaxy.screen.find(s => s.id === id), world)
    const tapped = await page.evaluate(() => performance.now())
    await page.mouse.click(where.x, where.y)
    await page.waitForFunction(() => document.querySelector('.mira-shell').classList.contains('is-descending'), null, { timeout: 2000 })
    await page.waitForFunction(() => { const s = document.querySelector('.mira-shell'); return s.classList.contains('is-playing') && !s.classList.contains('is-descending') }, null, { timeout: 30000 })
    await page.waitForTimeout(1000)
    const trace = await page.evaluate(() => { window.__done = true; return { frames: window.__frames, long: window.__long, t0: window.__t0 } })
    const frames = trace.frames.filter(f => f[2] !== 'before'), phases = {}
    for (const name of ['flight', 'light', 'air', 'ground']) phases[name] = stats(frames.filter(f => f[2] === name).map(f => f[1]))
    result.drops.push({
      level, world, landedLevel: await page.evaluate(() => window.mira.params.get('gfx.level')?.value),
      tapToGroundMs: Math.round((frames.find(f => f[2] === 'ground')?.[0] ?? 0) - (tapped - trace.t0)),
      phases,
      stalls: frames.filter(f => f[1] > 50).map(f => `${Math.round(f[1])}ms ${f[2]}@${f[0]}`),
      longTasks: trace.long.filter(l => l[0] >= tapped).map(l => `${l[1]}ms@${Math.round(l[0] - trace.t0)}`),
      terrain: logs.slice(-2),
    })
    await page.close()
  }
} finally { await browser.close() }
console.log('LOBBY IDLE'); console.table(result.idle)
for (const d of result.drops) { console.log(`\nDROP level ${d.level} to ${d.world}: ${d.tapToGroundMs} ms tap to ground (landed at level ${d.landedLevel})`); console.table(d.phases); console.log('stalls over 50 ms:', d.stalls.join(', ') || 'none'); console.log('long tasks:', d.longTasks.join(', ') || 'none'); console.log('terrain:', d.terrain.join(' | ') || 'no rebuild logged') }
if (result.errors.length) console.log('\nconsole errors:', [...new Set(result.errors)].slice(0, 12))
if (process.env.TRACE_OUT) await writeFile(process.env.TRACE_OUT, JSON.stringify(result, null, 1))
