/**
 * Phone layout check, portrait (390 x 844) and landscape (844 x 390), with touch.
 *
 *   tools/heavy.sh node tests/ui/phone-layout.mjs <label> [--record]
 *
 * Walks the lobby, the vehicle panel, the game for the buggy and the jet, King of the Hill
 * held, contested and won, the join QR view and the in-game menu. In every in-game state it
 * measures the thumb stick, each action button, the minimap, the HUD, the hill strip, the
 * menu buttons, the controls card, the toast, any announcement and the vehicle's place on
 * screen, and fails if any two of them overlap. `--record` only reports, for capturing a
 * build known to fail. Match and score states are fixtures fed to the shell, so no room
 * server is needed: only the lane dev server on 5187.
 */
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'

const label = process.argv[2] ?? 'run'
const strict = !process.argv.includes('--record')
const out = 'tests/ui/artifacts/phone-layout'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5187/'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = { label, states: [], errors: [] }

const rows = ['> Phone QA   20  [KING] (you) (host)', '  Gevotek Spare Pilot   0  ', '  Mevigon Cone Marshal   0  ']
const status = extra => ['net: room phone-layout ping 17 ms delay 0 ms', 'host: you shared sliders open to all', 'mode: King of the Hill first to 60', ...rows, ...extra]
const scores = [{ name: 'Phone QA', score: 20, you: true }, { name: 'Gevotek Spare Pilot', score: 12 }, { name: 'Mevigon Cone Marshal', score: 3 }]
const koth = extra => ({ mode: 'koth', holderName: null, holderIsYou: false, contested: false, scores, target: 60, winner: null, ...extra })

/** Rectangles of everything that must stay apart, and the pairs that touch. */
const measure = page => page.evaluate(() => {
  const s = window.syn3h, cam = s.game.camera, p = s.player.body.translation()
  const at = (dx, dy, dz) => { const v = cam.position.clone().set(p.x + dx, p.y + dy, p.z + dz).project(cam); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight] }
  const pts = [-1.4, 1.4].flatMap(x => [-0.8, 1.2].flatMap(y => [-1.4, 1.4].map(z => at(x, y, z))))
  const boxes = [{ name: 'vehicle', group: 'vehicle', left: Math.min(...pts.map(q => q[0])), right: Math.max(...pts.map(q => q[0])), top: Math.min(...pts.map(q => q[1])), bottom: Math.max(...pts.map(q => q[1])) }]
  const add = (selector, group = selector) => {
    for (const el of document.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect(), style = getComputedStyle(el)
      if (!r.width || !r.height || style.visibility === 'hidden' || style.display === 'none') continue
      boxes.push({ name: selector + (el.dataset.action ? `[${el.dataset.action}]` : ''), group, left: r.left, right: r.right, top: r.top, bottom: r.bottom })
    }
  }
  add('.touch-stick', 'stick'); add('.touch-actions button', 'actions'); add('.shell-minimap'); add('.shell-hud'); add('.match-hud')
  add('.hud-navigation'); add('.spawn-help'); add('.shell-toast'); add('.match-announcement')
  const overlaps = []
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j]
    if (a.group !== b.group && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1) overlaps.push(`${a.name} × ${b.name}`)
  }
  const offscreen = boxes.filter(b => b.group !== 'vehicle' && (b.left < -1 || b.top < -1 || b.right > innerWidth + 1 || b.bottom > innerHeight + 1)).map(b => b.name)
  return { overlaps, offscreen, boxes: boxes.map(b => ({ name: b.name, box: [b.left, b.top, b.right, b.bottom].map(Math.round) })) }
})

for (const view of [{ name: 'portrait', viewport: { width: 390, height: 844 } }, { name: 'landscape', viewport: { width: 844, height: 390 } }]) {
  for (const vehicle of ['buggy', 'jet']) {
    const context = await browser.newContext({ ...view, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
    const page = await context.newPage()
    page.on('pageerror', e => report.errors.push(`${view.name} ${vehicle}: ${e.message}`))
    page.on('console', m => { if (m.type() === 'error') report.errors.push(`${view.name} ${vehicle}: ${m.text()}`) })
    await page.goto(`${base}?room=phone-${label}-${view.name}-${vehicle}&vehicle=${vehicle}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.syn3h?.game?.tick > 25, null, { timeout: 120000 })
    const shot = async (state, inGame = true) => {
      await page.screenshot({ path: `${out}/${label}-${view.name}-${vehicle}-${state}.png` })
      const m = inGame ? await measure(page) : { overlaps: [], offscreen: [] }
      report.states.push({ view: view.name, vehicle, state, overlaps: m.overlaps, offscreen: m.offscreen, boxes: m.boxes })
    }
    const panel = async id => {
      await page.evaluate(id => window.syn3h.shell.showPanel(id), id)
      await page.waitForFunction(id => { const p = document.querySelector('.lobby-panels'); return p.dataset.activePanel === id && p.dataset.busy === 'false' }, id)
      await page.waitForTimeout(300)
    }
    if (vehicle === 'buggy') {
      await page.waitForTimeout(3000)
      await panel('index'); await shot('lobby', false)
      await panel('vehicle'); await shot('vehicle-panel', false)
    }
    // Fixtures stand in for the room server so every state is the same on every run.
    await page.evaluate(() => { const s = window.syn3h.shell; s.onPlay = () => {}; s.play() })
    await page.evaluate(lines => window.syn3h.shell.setStatus(lines), status(['Gevotek Spare Pilot joined']))
    await page.waitForTimeout(1200)
    await shot('game')                                   // controls card and a toast on screen
    await page.waitForTimeout(5500)
    await page.evaluate(m => window.syn3h.shell.setMatchState(m), koth({ holderName: 'Phone QA', holderIsYou: true }))
    await page.waitForTimeout(400); await shot('hill-announce')
    await page.waitForTimeout(3200); await shot('hill-held')
    if (vehicle === 'buggy') {
      await page.evaluate(m => window.syn3h.shell.setMatchState(m), koth({ holderName: 'Phone QA', holderIsYou: true, contested: true }))
      await page.waitForTimeout(3200); await shot('hill-contested')
      await page.evaluate(m => window.syn3h.shell.setMatchState(m), koth({ holderName: 'Phone QA', holderIsYou: true, winner: 'Phone QA', winnerColor: '#ff8844', nextRoundIn: 6 }))
      await page.waitForTimeout(600); await shot('hill-winner')
      await page.evaluate(() => window.syn3h.shell.openJoin()); await page.waitForTimeout(500); await shot('join-qr', false)
      await page.evaluate(() => window.syn3h.shell.closeJoin())
      await page.evaluate(() => window.syn3h.shell.openMenu()); await page.waitForTimeout(2300); await shot('menu', false)
    }
    await context.close()
  }
}
await browser.close()
const bad = report.states.filter(s => s.overlaps.length || s.offscreen.length)
await writeFile(`${out}/${label}-report.json`, JSON.stringify(report, null, 1))
for (const s of report.states) console.log(`${s.view} ${s.vehicle} ${s.state}: ${s.overlaps.length || s.offscreen.length ? [...s.overlaps, ...s.offscreen.map(n => `${n} off screen`)].join('; ') : 'clear'}`)
console.log(`errors: ${JSON.stringify(report.errors)}`)
if (report.errors.length || (strict && bad.length)) process.exitCode = 1
