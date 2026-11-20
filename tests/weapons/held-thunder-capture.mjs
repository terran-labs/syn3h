/**
 * Evidence (not a test): holding fire through two Plasma Thunder cooldowns. The button goes
 * down again straight after each shot, while Thunder recharges, and stays down; each charge
 * should start the moment the cooldown ends, with no second click. Writes a chart of the
 * charge, the button and each cooldown's end, and the numbers, to <out>.
 *
 *   SYN3H_URL=http://127.0.0.1:<port>/ tools/heavy.sh node tests/weapons/held-thunder-capture.mjs [out dir]
 */
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'

const base = (process.env.SYN3H_URL ?? 'http://127.0.0.1:5258/').replace(/\/+$/, '') + '/'
const out = process.argv[2] ?? '/tmp/held-thunder'
await mkdir(out, { recursive: true })
const errors = []
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.routeWebSocket(/\/ws(?:\?|$)/, socket => socket.close())
  const page = await context.newPage()
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${base}?planet=alpine&seed=7&autoplay=1&room=held-thunder-${Date.now()}`)
  await page.waitForFunction(() => window.syn3h?.shell?.playing && window.syn3hNet?.bigRed, null, { timeout: 120000 })
  const run = await page.evaluate(async () => {
    const s = window.syn3h, n = window.syn3hNet, p = s.params, red = n.bigRed
    p.set('bots.count', 0); p.set('daydream.seconds', 0)
    n.gear.select('red')
    const charge = p.get('bigRed.charge').value, cooldown = p.get('bigRed.cooldown').value
    const samples = [], ends = []
    let down = false
    const set = on => { down = on; s.game.input.external.fire = on }
    const wait = sec => new Promise(r => { const until = s.game.time + sec; const f = () => s.game.time >= until ? r() : requestAnimationFrame(f); f() })
    // Sample every fixed step: game time, charge, button, and when the cooldown ends.
    const step = red.fixedUpdate.bind(red)
    red.fixedUpdate = dt => { step(dt); samples.push({ t: s.game.time, charge: red.charge, down, readyAt: red.readyAt }) }
    const t0 = s.game.time
    // First shot: press, charge, release.
    set(true); await wait(charge + 0.2); set(false); await wait(0.05)
    for (let k = 0; k < 2; k++) {
      // Straight back down during the cooldown, and held: no second click.
      ends.push(red.readyAt)
      set(true); await wait(cooldown + charge + 0.3); set(false); await wait(0.05)
    }
    red.fixedUpdate = step
    return { t0, charge, cooldown, ends, samples, sent: red.stats.sent }
  })
  // When each held charge began, against the cooldown's end.
  const starts = run.ends.map(end => run.samples.find(x => x.t >= end - 1e-6 && x.charge >= 0 && x.down))
  const lines = run.ends.map((end, i) => `cooldown ${i + 1} ends ${(end - run.t0).toFixed(3)} s; charge began ${starts[i] ? `${(starts[i].t - run.t0).toFixed(3)} s (${((starts[i].t - end) * 1000).toFixed(0)} ms after)` : 'never'}`)
  lines.push(`shots sent: ${run.sent} (1 pressed, 2 held through a cooldown)`)
  const W = 1100, H = 260, span = run.samples.at(-1).t - run.t0, x = t => 40 + (t - run.t0) / span * (W - 60), y = v => H - 40 - v * (H - 70)
  const poly = (key, colour, f = v => v) => `<polyline fill="none" stroke="${colour}" stroke-width="2.5" points="${run.samples.map(sm => `${x(sm.t).toFixed(1)},${y(f(sm[key])).toFixed(1)}`).join(' ')}"/>`
  const svg = `<svg width="${W}" height="${H}" style="background:#181818">${run.ends.map(e => `<line x1="${x(e)}" x2="${x(e)}" y1="20" y2="${H - 40}" stroke="#e05555" stroke-dasharray="4 3"/>`).join('')}${poly('down', '#888', v => v ? 1.05 : 0)}${poly('charge', '#f2c14e', v => Math.max(0, v))}<text x="48" y="16" fill="#f2c14e" font-size="13">charge</text><text x="120" y="16" fill="#888" font-size="13">button held</text><text x="240" y="16" fill="#e05555" font-size="13">cooldown ends</text>${Array.from({ length: Math.floor(span) + 1 }, (_, t) => `<text x="${x(run.t0 + t)}" y="${H - 18}" fill="#aaa" font-size="12" text-anchor="middle">${t} s</text>`).join('')}</svg>`
  const sheet = await browser.newPage({ viewport: { width: 1160, height: 360 } })
  await sheet.setContent(`<body style="margin:0;background:#111;color:#eee;font:14px system-ui;padding:8px"><h3 style="margin:4px 0">Plasma Thunder, held through two cooldowns</h3>${svg}<pre>${lines.join('\n')}</pre></body>`)
  await sheet.screenshot({ path: `${out}/held-thunder.png`, fullPage: true })
  await writeFile(`${out}/held-thunder.json`, JSON.stringify(run))
  console.log(lines.join('\n'))
  if (errors.length) { console.log(`page errors: ${errors.slice(0, 3).join(' | ')}`); process.exit(1) }
  if (run.sent !== 3 || starts.some(x => !x)) process.exit(1)
  console.log('HELD THUNDER CAPTURE OK')
} finally { await browser.close() }
