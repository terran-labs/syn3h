/**
 * Evidence for judging when the Mira name arrives (not a test): the owner, 19 November 2026,
 * "it should be fading in while the planets are spinning in". For the opening and for a return
 * to the lobby, at phone and desktop size, every drawn frame's name opacity (galaxy.markShown)
 * against the worlds' progress, as a chart, with six frames along the way.
 *
 *   Opening: the worlds' progress is their mean arrival (opening.ts openingState().arrive).
 *   Return:  a real exit from a world: the view's progress home (0 while it flies out of the
 *            world, then returnHome's ease, 1 once home), and the name's distance in pixels
 *            from where it rests (it must be dark until it is within a few).
 *
 *   MIRA_URL=http://127.0.0.1:<port>/ tools/heavy.sh node tests/ui/logo-timing-strip.mjs [out dir]
 */
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'

const base = (process.env.MIRA_URL ?? 'http://127.0.0.1:5258/').replace(/\/+$/, '') + '/'
const out = process.argv[2] ?? '/tmp/logo-timing'
await mkdir(out, { recursive: true })
const ready = page => page.waitForFunction(() => window.mira?.game?.tick > 25 && document.documentElement.dataset.boot === 'done' && window.mira.shell.galaxy, null, { timeout: 120000 })
const errors = []
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const summary = []
try {
  for (const [device, view] of [['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }], ['desktop', { viewport: { width: 1280, height: 800 } }]]) {
    const page = await browser.newPage(view)
    page.on('pageerror', e => errors.push(`${device}: ${e.message}`))
    await page.goto(`${base}?room=logo-timing-${Date.now()}`); await ready(page)
    await page.waitForTimeout(1500)
    const rest = await page.evaluate(() => { const b = window.mira.shell.galaxy.wordmarkScreenBox(); return b && [b.x + b.width / 2, b.y + b.height / 2] })
    for (const kind of ['opening', 'return']) {
      if (kind === 'return') {
        await page.locator('.galaxy-label[data-world="alpine"]').dispatchEvent('click')
        await page.waitForFunction(() => { const s = document.querySelector('.mira-shell'); return s.classList.contains('is-playing') && !s.classList.contains('is-descending') }, null, { timeout: 60000 })
        await page.waitForTimeout(1500)
      }
      // Record every frame: time, the name's opacity, the worlds' progress.
      await page.evaluate(async ([kind, rest]) => {
        const g = window.mira.shell.galaxy, O = await import('/src/ui/galaxy/opening.ts')
        window.__samples = []; window.__done = false
        if (kind === 'opening') g.replayOpening(window.mira.params.get('lobby.intro').value)
        else { const s = window.mira.shell; s.askExit(); s.answerExit(true) }
        const t0 = performance.now()
        let eased = false
        const tick = () => {
          const now = performance.now()
          let planets = 1
          if (kind === 'opening' && g.opening) {
            const t = g.opening.start === null ? -1 : (now - g.opening.start) / 1000, lanes = g.laneCache.length || 9
            const s = O.openingState(t, g.opening.mode, lanes); planets = s.arrive.reduce((a, b) => a + b, 0) / lanes
          } else if (kind === 'return') {
            if (g.returnTo && document.querySelector('.mira-shell').classList.contains('is-playing') === false) eased = true
            planets = g.returnTo && eased ? Math.min(1, (now - g.returnTo.start) / 1000 / O.RETURN_VIEW_SECONDS) : eased ? 1 : 0
          }
          const b = g.wordmarkScreenBox(), off = b && rest ? Math.hypot(b.x + b.width / 2 - rest[0], b.y + b.height / 2 - rest[1]) : null
          window.__samples.push({ t: (now - t0) / 1000, mark: g.markShown, planets, off })
          if (!window.__done) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }, [kind, rest])
      const length = kind === 'opening' ? 9 : 6, shots = []
      for (let i = 0; i < 6; i++) {
        const at = length * (i + 0.5) / 6
        await page.waitForFunction(at => (window.__samples.at(-1)?.t ?? 0) >= at, at, { timeout: 30000, polling: 'raf' })
        const s = await page.evaluate(() => window.__samples.at(-1))
        const file = `${device}-${kind}-${i}.png`
        await page.screenshot({ path: `${out}/${file}` })
        shots.push({ file, ...s })
      }
      await page.waitForFunction(length => (window.__samples.at(-1)?.t ?? 0) >= length, length, { timeout: 30000, polling: 'raf' })
      const samples = await page.evaluate(() => { window.__done = true; return window.__samples })
      // When the name reaches half and full, and the worlds' progress then.
      const first = p => samples.find(s => s.mark >= p)
      const half = first(0.5), full = first(0.99)
      const worstOff = Math.max(0, ...samples.filter(x => x.mark > 0.01 && x.off !== null).map(x => x.off))
      if (kind === 'return') summary.push(`${device} return: worst distance from its resting place while visible ${worstOff.toFixed(1)} px`)
      summary.push(`${device} ${kind}: name at half ${half ? `${half.t.toFixed(2)} s (worlds ${(half.planets * 100).toFixed(0)}%)` : 'never'}, full ${full ? `${full.t.toFixed(2)} s (worlds ${(full.planets * 100).toFixed(0)}%)` : 'never'}; worlds done ${(samples.find(s => s.planets >= 0.999)?.t ?? NaN).toFixed(2)} s`)
      // The chart: name opacity (gold) and the worlds' progress (blue) against time.
      const W = 900, H = 220, x = t => 40 + t / length * (W - 60), y = v => H - 30 - v * (H - 50)
      const line = (key, colour) => `<polyline fill="none" stroke="${colour}" stroke-width="2.5" points="${samples.map(s => `${x(s.t).toFixed(1)},${y(s[key]).toFixed(1)}`).join(' ')}"/>`
      const ticks = Array.from({ length: length + 1 }, (_, t) => `<text x="${x(t)}" y="${H - 10}" fill="#aaa" font-size="12" text-anchor="middle">${t} s</text>`).join('')
      const chart = `<svg width="${W}" height="${H}" style="background:#181818"><line x1="40" x2="${W - 20}" y1="${y(0)}" y2="${y(0)}" stroke="#444"/><line x1="40" x2="${W - 20}" y1="${y(1)}" y2="${y(1)}" stroke="#333"/>${ticks}${line('planets', '#6cb6ff')}${line('mark', '#f2c14e')}<text x="48" y="22" fill="#6cb6ff" font-size="13">${kind === 'opening' ? 'worlds arrived' : 'view back home'}</text><text x="220" y="22" fill="#f2c14e" font-size="13">Mira name opacity</text></svg>`
      const { readFileSync } = await import('node:fs')
      const frames = shots.map(s => `<figure><img src="data:image/png;base64,${readFileSync(`${out}/${s.file}`).toString('base64')}"><figcaption>${s.t.toFixed(2)} s: ${kind === 'opening' ? 'worlds' : 'view home'} ${(s.planets * 100).toFixed(0)}%, name ${(s.mark * 100).toFixed(0)}%</figcaption></figure>`).join('')
      const sheet = await browser.newPage({ viewport: { width: 1900, height: 400 } })
      await sheet.setContent(`<body style="margin:0;background:#111;color:#eee;font:14px system-ui"><h3 style="margin:8px">${device}: ${kind}</h3>${chart}<div style="display:flex;flex-wrap:wrap">${frames}</div><style>figure{margin:3px}img{width:${device === 'phone' ? 150 : 300}px;display:block}figcaption{font-size:11px;text-align:center}</style></body>`)
      await sheet.screenshot({ path: `${out}/${device}-${kind}.png`, fullPage: true })
      await sheet.close()
      await page.waitForTimeout(1000)
    }
    await page.close()
  }
} finally { await browser.close() }
console.log(summary.join('\n'))
if (errors.length) { console.log(`page errors: ${errors.slice(0, 3).join(' | ')}`); process.exit(1) }
console.log('LOGO TIMING STRIP OK')
