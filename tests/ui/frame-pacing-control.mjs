/**
 * A control for every headless frame trace: how fast can this browser, on this machine, right
 * now, draw a blank page? If a blank page cannot hold 60 frames a second, frame gaps from the
 * same session measure the machine's load, not the game. Report this beside any frame trace.
 *
 *   SYN3H_URL=http://127.0.0.1:5193/ /Users/vtn/dev/Syn3h/tools/heavy.sh node tests/ui/frame-pacing-control.mjs
 *
 * On 15 November 2026, under load 5 to 7, a blank page measured p50 67 ms and p95 133 ms here.
 * Main-thread long tasks and CPU profiles (tests/ui/drop-profile.mjs) still carry signal then.
 */
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5193/'
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const measure = () => new Promise(resolve => { const gaps = []; let last = performance.now(); const end = last + 3000; const tick = now => { gaps.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else { const s = gaps.slice(1).sort((a, b) => a - b); resolve({ frames: s.length, p50: Math.round(s[s.length >> 1]), p95: Math.round(s[Math.floor(s.length * .95)]), max: Math.round(s.at(-1)) }) } }; requestAnimationFrame(tick) })
const out = []
const blank = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await blank.setContent('<body style="background:#123"><h1>blank</h1></body>')
out.push({ label: 'blank page, alone', ...await blank.evaluate(measure) })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(`${base}?room=control-${Date.now()}`, { waitUntil: 'load' })
await page.waitForFunction(() => window.syn3h?.game?.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false' && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
await page.waitForTimeout(3000)
out.push({ label: 'lobby', ...await page.evaluate(measure) })
await page.evaluate(() => { window.syn3h.game.renderer.setAnimationLoop(null); window.syn3h.shell.galaxy.enabled = false; document.querySelector('.syn3h-shell').style.display = 'none' })
await page.waitForTimeout(500)
out.push({ label: 'lobby page, shell hidden, loops stopped', ...await page.evaluate(measure) })
await page.evaluate(() => { document.getElementById('game').style.display = 'none' }); await page.waitForTimeout(500)
out.push({ label: '... and game canvas hidden', ...await page.evaluate(measure) })
await page.close()
out.push({ label: 'blank page, after lobby closed', ...await blank.evaluate(measure) })
console.table(out); await browser.close()
