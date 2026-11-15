/**
 * A CPU profile of the drop: which functions hold the main thread from the tap on a world to
 * one second after landing. Prints each busy stretch over 150 ms with its app functions by
 * inclusive time, the long tasks and the drop's phases, and saves the profile for DevTools.
 * Unlike frame gaps, this stays meaningful on a loaded machine (see frame-pacing-control.mjs).
 *
 *   SYN3H_URL=http://127.0.0.1:5193/ LEVEL=1 /Users/vtn/dev/Syn3h/tools/heavy.sh node tests/ui/drop-profile.mjs
 *
 * PATCH=1 caches the logo renderer's saved GL state, the experiment that showed its
 * per-draw gl.getParameter calls were the stall.
 */
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
const level = Number(process.env.LEVEL ?? 1), base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5193/', out = 'tests/ui/artifacts/drop-profile'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(`${base}?room=prof-${Date.now()}`, { waitUntil: 'load' })
await page.waitForFunction(() => window.syn3h?.game?.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false' && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
await page.evaluate(l => { window.__pin = setInterval(() => { if (window.syn3h.params.get('gfx.level')?.value !== l) window.syn3h.params.set('gfx.level', l) }, 400); window.syn3h.params.set('gfx.level', l) }, level)
await page.waitForFunction(() => window.syn3h.shell.graphics.planetMaps >= window.syn3h.planets.PLANETS.length, null, { timeout: 60000 })
await page.waitForTimeout(2500)
if (process.env.PATCH) console.log('patched:', await page.evaluate(() => { const logo = window.syn3h.shell.galaxy.logo; if (!logo?.save) return 'no logo.save'; const first = logo.save(); logo.save = () => first; return 'logo.save cached' }))
const cdp = await page.context().newCDPSession(page)
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start')
await page.evaluate(() => { window.__long = []; new PerformanceObserver(list => { for (const e of list.getEntries()) window.__long.push([e.startTime, e.duration]) }).observe({ entryTypes: ['longtask'] }); window.__marks = []; const shell = document.querySelector('.syn3h-shell'), overlay = document.querySelector('.shell-overlay'); let was = ''; const tick = () => { const g = window.syn3h.shell.galaxy; const d = shell.classList.contains('is-descending'); const p = !d ? (shell.classList.contains('is-playing') ? 'ground' : 'before') : overlay.style.opacity === '0' ? 'air' : g?.flightDone ? 'light' : 'flight'; if (p !== was) { window.__marks.push([p, performance.now()]); was = p } if (!window.__done) requestAnimationFrame(tick) }; tick() })
const where = await page.evaluate(() => window.syn3h.shell.galaxy.screen.find(s => s.id === 'alpine'))
await page.mouse.click(where.x, where.y)
await page.waitForFunction(() => { const s = document.querySelector('.syn3h-shell'); return s.classList.contains('is-playing') && !s.classList.contains('is-descending') }, null, { timeout: 40000 })
await page.waitForTimeout(1000)
const { profile } = await cdp.send('Profiler.stop')
const info = await page.evaluate(() => { window.__done = true; return { long: window.__long, marks: window.__marks, origin: performance.timeOrigin } })
await writeFile(`${out}/drop-level${level}.cpuprofile`, JSON.stringify(profile))
// Aggregate: self time per function, and inclusive time per function, inside long tasks only.
const nodes = new Map(profile.nodes.map(n => [n.id, n])); const parent = new Map(); for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
const name = n => `${n.callFrame.functionName || '(anonymous)'} ${n.callFrame.url.split('/').slice(-2).join('/').split('?')[0]}:${n.callFrame.lineNumber + 1}`
// Long-task windows in profile time: find by gaps? Use sample timestamps relative to profile.startTime; map performance.now via first mark is unreliable, so detect busy windows from samples: consecutive non-idle samples.
let t = profile.startTime; const busy = []; let cur = null
profile.samples.forEach((id, i) => { t += profile.timeDeltas[i]; const n = nodes.get(id); const idle = ['(idle)', '(program)'].includes(n.callFrame.functionName) && false; const isIdle = n.callFrame.functionName === '(idle)'; if (!isIdle) { if (!cur) cur = { start: t, end: t, samples: [] }; cur.end = t; cur.samples.push([id, profile.timeDeltas[i]]) } else if (cur) { busy.push(cur); cur = null } })
if (cur) busy.push(cur)
const big = busy.filter(b => b.end - b.start > 150000).sort((a, b) => a.start - b.start)
console.log(`level ${level}; phases (ms from first mark):`, info.marks.map(m => `${m[0]}@${Math.round(m[1] - info.marks[0][1])}`).join(' '))
console.log('long tasks (ms from first mark):', info.long.map(l => `${Math.round(l[1])}ms@${Math.round(l[0] - info.marks[0][1])}`).join(' '))
for (const b of big) {
  const self = new Map(), incl = new Map()
  for (const [id, dt] of b.samples) { const n = nodes.get(id); self.set(name(n), (self.get(name(n)) ?? 0) + dt); const seen = new Set(); for (let at = id; at; at = parent.get(at)) { const k = name(nodes.get(at)); if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) ?? 0) + dt) } } }
  const top = (m, k) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([n, v]) => `   ${String(Math.round(v / 1000)).padStart(5)} ms  ${n}`).join('\n')
  console.log(`\n== busy ${Math.round((b.end - b.start) / 1000)} ms starting ${Math.round((b.start - profile.startTime) / 1000)} ms into profile\n inclusive, app code:\n${top(new Map([...incl].filter(([n]) => / src\//.test(n) || /\/src\//.test(n) || !/deps\/|\(root\)|\(program\)/.test(n))), 22)}\n self:\n${top(self, 12)}`)
}
await browser.close()
