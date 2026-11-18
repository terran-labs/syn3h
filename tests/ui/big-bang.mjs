// The cartoon Big Bang (the lobby's opening, src/ui/galaxy/opening.ts, and the veil's waiting
// pulse, index.html): a strip of frames from the waiting point to the settled lobby, desktop and
// phone, each stamped with its time; the frame times of the bang played in real time; and that
// the waiting point pulses under reduced motion too.
//   tools/heavy.sh node tests/ui/big-bang.mjs [out dir]   (SYN3H_URL, default http://127.0.0.1:5258/)
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { loadavg } from 'node:os'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5258/'
const out = process.argv[2] ?? 'tests/ui/artifacts/big-bang'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] })
const views = { desktop: { viewport: { width: 1280, height: 800 } }, phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } }
const stamp = (page, text) => page.evaluate(text => { let s = document.getElementById('strip-time'); if (!s) { s = document.createElement('div'); s.id = 'strip-time'; s.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:99999;font:600 15px/1 ui-monospace,monospace;color:#fff;background:rgb(0 0 0 / .6);padding:5px 8px;border-radius:6px'; document.body.append(s) } s.textContent = text }, text)
const report = {}
// The opening's length and its pop, as in src/ui/galaxy/opening.ts (OPENING_SECONDS, POP_SECONDS).
const LENGTH = 8.6, POP = 1.2
try {
  for (const [name, view] of Object.entries(views)) {
    // The waiting beat: the bundle held back, so the veil's point breathes on its own.
    {
      const context = await browser.newContext(view), page = await context.newPage()
      await page.route(/\/src\/main\.ts/, () => {})
      await page.goto(`${base}?room=bang-wait-${Date.now()}`, { waitUntil: 'commit' })
      await page.waitForSelector('.boot-point'); 
      for (const at of [0.4, 0.95]) { await page.waitForTimeout(at === 0.4 ? 400 : 550); await stamp(page, `waiting ${at.toFixed(2)} s into a beat`); await page.screenshot({ path: `${out}/${name}-00-wait-${at}.png` }) }
      await context.close()
    }
    const context = await browser.newContext(view), page = await context.newPage()
    await page.goto(`${base}?room=bang-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.game?.tick > 25 && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
    await page.evaluate(() => { window.__pin = setInterval(() => syn3h.params.set('gfx.level', 2), 400) })
    await page.waitForTimeout(5000)
    const times = [0.4, 0.9, 1.15, 1.35, 1.7, 2.2, 3.0, 4.0, 5.0, 6.0, 7.0, 7.8, 8.6, 9.2]
    for (const [i, t] of times.entries()) {
      await page.evaluate(t => { const g = syn3h.shell.galaxy; g.replayOpening(syn3h.params.get('lobby.intro').value); g.openingAt = t; g.wake = 2 }, t)
      await page.waitForTimeout(350); await stamp(page, `bang t = ${t.toFixed(2)} s`)
      await page.screenshot({ path: `${out}/${name}-${String(i + 1).padStart(2, '0')}-t${t.toFixed(2)}.png` })
    }
    await page.evaluate(() => { document.getElementById('strip-time')?.remove(); syn3h.shell.galaxy.openingAt = null })
    // The largest frame-to-frame change in the mean luminance of the whole galaxy canvas, at 30
    // frames a second through the bang: a flash would be a large jump.
    report[name] = { luminance: await page.evaluate(async ({ LENGTH }) => {
      const g = syn3h.shell.galaxy, gl = g.gl, w = g.canvas.width, h = g.canvas.height, px = new Uint8Array(w * h * 4)
      let last = null, worst = 0, at = 0, peak = 0
      g.replayOpening(syn3h.params.get('lobby.intro').value)
      for (let t = 0; t <= LENGTH; t += 1 / 30) {
        g.openingAt = t; g.wake = 2; g.last = 0; g.loop(performance.now())
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
        let sum = 0; for (let i = 0; i < px.length; i += 64) sum += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255
        const mean = sum / (px.length / 64); peak = Math.max(peak, mean)
        if (last !== null && Math.abs(mean - last) > worst) { worst = Math.abs(mean - last); at = t }
        last = mean
      }
      g.openingAt = null
      return { worstStep: +worst.toFixed(4), atSeconds: +at.toFixed(2), peakMean: +peak.toFixed(3) }
    }, { LENGTH }) }
    // Frame cost, the bang against the settled lobby in the same session, only on a quiet machine.
    if (loadavg()[0] < 8) {
      report[name].load = +loadavg()[0].toFixed(1)
      report[name].cost = await page.evaluate(async ({ LENGTH, POP }) => {
        const g = syn3h.shell.galaxy, gl = g.gl, px = new Uint8Array(4)
        // The galaxy's own frame, waited for to the GPU's finish: median of 40.
        const timed = setup => { const out = []; for (let i = 0; i < 40; i++) { setup(i); g.wake = 2; g.last = 0; gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t = performance.now(); g.loop(performance.now()); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); out.push(performance.now() - t) } out.sort((a, b) => a - b); return +out[20].toFixed(2) }
        const settledMs = timed(() => { g.opening = null; g.openingAt = null })
        const bangMs = timed(i => { g.replayOpening(syn3h.params.get("lobby.intro").value); g.openingAt = POP + (LENGTH - POP) * i / 40 })
        g.opening = null; g.openingAt = null
        // And requestAnimationFrame intervals over 4.2 s of each, in real time.
        const intervals = () => new Promise(done => { const gaps = []; let last = performance.now(); const start = last; const f = now => { gaps.push(now - last); last = now; if (now - start < 4200) requestAnimationFrame(f); else { gaps.sort((a, b) => a - b); done({ median: +gaps[gaps.length >> 1].toFixed(1), p95: +gaps[Math.floor(gaps.length * 0.95)].toFixed(1) }) } }; requestAnimationFrame(f) })
        g.wake = 2; const settledRaf = await intervals()
        g.replayOpening(syn3h.params.get('lobby.intro').value); const bangRaf = await intervals()
        return { settledMs, bangMs, settledRaf, bangRaf }
      }, { LENGTH, POP })
    } else report[name].cost = `not measured: load ${loadavg()[0].toFixed(1)}`
    await context.close()
  }
  // Reduced motion: the waiting point still visibly breathes (brightness), and nothing moves.
  {
    const context = await browser.newContext({ ...views.desktop, reducedMotion: 'reduce' }), page = await context.newPage()
    await page.route(/\/src\/main\.ts/, () => {})
    await page.goto(`${base}?room=bang-rm-${Date.now()}`, { waitUntil: 'commit' }); await page.waitForSelector('.boot-point')
    const samples = []
    for (let i = 0; i < 12; i++) { samples.push(await page.evaluate(() => { const st = getComputedStyle(document.querySelector('.boot-point')); return { filter: st.filter, scale: st.scale, rotate: st.rotate } })); await page.waitForTimeout(150) }
    assert.ok(new Set(samples.map(s => s.filter)).size > 3, 'reduced motion: the point still breathes')
    assert.ok(samples.every(s => (s.scale === 'none' || s.scale === '1') && (s.rotate === 'none' || s.rotate === '0deg')), 'reduced motion: no squash, stretch or wobble')
    report.reducedMotion = { filters: new Set(samples.map(s => s.filter)).size }
    await context.close()
  }
  console.log(JSON.stringify({ ok: true, report }))
} finally { await browser.close() }
