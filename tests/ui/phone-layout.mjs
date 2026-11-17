/**
 * Phone and tablet layout check: portrait (390 x 844) and landscape (844 x 390) phones in
 * Chrome, and an iPad Pro 11 on its side in WebKit, all with touch.
 *
 *   tools/heavy.sh node tests/ui/phone-layout.mjs <label> [--record]
 *
 * Walks the lobby, the vehicle panel, the game for the buggy and the jet, King of the Hill
 * held, contested and won, the join QR view and the in-game menu. In every in-game state it
 * measures the thumb stick (when held) and its first-run hint, each action button, the minimap, the HUD, the hill strip, the
 * menu buttons, the controls card, the toast, any announcement and the vehicle's place on
 * screen, and fails if any two of them overlap, or if the thumb buttons stop forming one
 * grid of equal circles on two rows (tests/ui/thumbGrid.mjs). `--record` only reports, for capturing a
 * build known to fail. Match and score states are fixtures fed to the shell.
 *
 * It then plays a guest's first run on a slow phone: see the section near the end. That part
 * joins a room, so it needs the lane room server as well as the dev server on 5187.
 */
import { chromium, devices, webkit } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import { thumbGrid } from './thumbGrid.mjs'

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
  add('.touch-stick', 'stick'); add('.touch-stick-hint', 'stick'); add('.touch-actions button', 'actions'); add('.gear-actions button', 'actions'); add('.shell-minimap'); add('.shell-hud'); add('.match-hud')
  add('.hud-navigation'); add('.chat-toggle'); add('.spawn-help'); add('.shell-toast'); add('.match-announcement')
  const overlaps = []
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j]
    if (a.group !== b.group && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1) overlaps.push(`${a.name} × ${b.name}`)
  }
  const offscreen = boxes.filter(b => b.group !== 'vehicle' && (b.left < -1 || b.top < -1 || b.right > innerWidth + 1 || b.bottom > innerHeight + 1)).map(b => b.name)
  return { overlaps, offscreen, boxes: boxes.map(b => ({ name: b.name, box: [b.left, b.top, b.right, b.bottom].map(Math.round) })) }
})

// A tablet too: an iPad Pro 11 on its side, in WebKit as Safari runs it (no WebGPU there, so
// the game takes its WebGL path). Touch controls show at desktop width.
const safari = await webkit.launch()
const layouts = [
  { name: 'portrait', viewport: { width: 390, height: 844 } },
  { name: 'landscape', viewport: { width: 844, height: 390 } },
  { name: 'ipad', engine: safari, device: devices['iPad Pro 11 landscape'] },
]
for (const view of layouts) {
  for (const vehicle of ['buggy', 'jet']) {
    const context = view.engine ? await view.engine.newContext({ ...view.device }) : await browser.newContext({ viewport: view.viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
    const page = await context.newPage()
    page.on('pageerror', e => report.errors.push(`${view.name} ${vehicle}: ${e.message}`))
    page.on('console', m => { if (m.type() === 'error') report.errors.push(`${view.name} ${vehicle}: ${m.text()}`) })
    await page.goto(`${base}?room=phone-${label}-${view.name}-${vehicle}&vehicle=${vehicle}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.syn3h?.game?.tick > 25, null, { timeout: 120000 })
    const shot = async (state, inGame = true) => {
      await page.screenshot({ path: `${out}/${label}-${view.name}-${vehicle}-${state}.png` })
      const m = inGame ? { ...await measure(page), grid: await page.evaluate(thumbGrid) } : { overlaps: [], offscreen: [], grid: [] }
      report.states.push({ view: view.name, vehicle, state, overlaps: m.overlaps, offscreen: m.offscreen, grid: m.grid, boxes: m.boxes })
    }
    const panel = async id => {
      await page.evaluate(id => window.syn3h.shell.showPanel(id), id)
      await page.waitForFunction(id => { const p = document.querySelector('.lobby-panels'); return p.dataset.activePanel === id && p.dataset.busy === 'false' }, id)
      await page.waitForTimeout(300)
    }
    if (vehicle === 'buggy') {
      await page.waitForTimeout(3000)
      // The lobby has no vehicle panel since 985797ab (vehicles are chosen in play): the vehicle
      // chooser is checked in play below.
      await panel('index'); await shot('lobby', false)
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
// ---------------------------------------------------------------------------------------
// A guest's first run: arriving by an invite link that names a world, on a slow phone (CPU
// throttled four times), and walking all the way to driving. Needs the lane room server.
// ---------------------------------------------------------------------------------------
report.guest = []
const guestFailures = []
const check = (ok, message) => { if (!ok) guestFailures.push(message) }
for (const view of [{ name: 'portrait', viewport: { width: 390, height: 844 } }, { name: 'landscape', viewport: { width: 844, height: 390 } }]) {
  const context = await browser.newContext({ ...view, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const page = await context.newPage(), cdp = await context.newCDPSession(page)
  page.on('pageerror', e => report.errors.push(`guest ${view.name}: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') report.errors.push(`guest ${view.name}: ${m.text()}`) })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const started = Date.now()
  await page.goto(`${base}?room=guest-${label}-${view.name}-${started}&world=alpine.90210`, { waitUntil: 'commit' })
  const usable = () => page.waitForFunction(() => window.syn3h?.shell && !document.querySelector('.syn3h-loading:not([hidden])') && document.querySelector('.lobby-panels')?.dataset.busy === 'false', null, { timeout: 180000 })
  await usable()
  const usableMs = Date.now() - started
  // Hold the graphics level: a slow headless browser would otherwise step it down and retire the galaxy.
  await page.evaluate(() => { window.__pin = setInterval(() => window.syn3h.params.set('gfx.level', 2), 400) })
  const g = () => page.evaluate(() => window.syn3h.shell.graphics)
  const world = () => page.evaluate(() => ({ planet: window.syn3h.planets.currentPlanet().id, seed: window.syn3h.params.get('world.seed').value }))
  const settle = id => page.waitForFunction(id => { const p = document.querySelector('.lobby-panels'); return p.dataset.activePanel === id && p.dataset.busy === 'false' }, id, { timeout: 30000 })
  const fits = async name => {
    const overflow = await page.evaluate(() => {
      const wide = [...document.querySelectorAll('.lobby-panels > section:not([hidden]) *, .join-view:not([hidden]) *')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1) })
      return wide.slice(0, 3).map(el => el.className || el.tagName)
    })
    check(overflow.length === 0, `${view.name} ${name}: wider than the screen: ${overflow.join(', ')}`)
    await page.screenshot({ path: `${out}/${label}-guest-${view.name}-${name}.png` })
  }
  // The world in the link is the world in the lobby, and no other is offered before joining.
  const landed = await world()
  check(landed.planet === 'alpine' && landed.seed === 90210, `${view.name}: landed on ${landed.planet}.${landed.seed}, not alpine.90210`)
  const offered = await page.locator('.galaxy-label:not([data-world=custom]):not(.is-locked)').evaluateAll(list => list.map(label => label.dataset.world))
  check(offered.join() === 'alpine', `${view.name}: an invited guest is offered ${offered.join()}`)
  // While the maps are painted: the galaxy keeps drawing and a tap is answered.
  // The galaxy's frame rate while the maps are painted, measured on the open galaxy (behind a
  // panel it stops on purpose); then a tap must be answered promptly.
  const f0 = await page.evaluate(() => window.syn3h.shell.galaxy?.frames ?? 0), s0 = Date.now()
  await page.waitForTimeout(3000)
  const starFps = ((await page.evaluate(() => window.syn3h.shell.galaxy?.frames ?? 0)) - f0) / ((Date.now() - s0) / 1000)
  const t0 = Date.now()
  // The lobby's links are About (and Worlds only while the custom planet is offered, which it
  // is not: OFFER_CUSTOM_PLANET in Shell.ts). Any of them answers a tap the same way.
  await page.locator('.galaxy-links [data-goto=about]').tap()
  await page.waitForFunction(() => { const p = document.querySelector('.lobby-panels'); return p.dataset.busy === 'true' || p.dataset.activePanel === 'about' })
  const tapMs = Date.now() - t0
  await settle('about'); await page.waitForTimeout(5000)
  const during = await g()
  check(tapMs < 1000, `${view.name}: a tap took ${tapMs} ms to be answered while planets were painting`)
  check(starFps >= 8, `${view.name}: the galaxy fell to ${starFps.toFixed(1)} frames a second`)
  check(during.planetMaps >= 3, `${view.name}: only ${during.planetMaps} planet maps were painted`)
  await fits('about')
  // (The Worlds panel's re-roll and the Custom planet's lock were checked here; neither can be
  // reached from the lobby while the custom planet is not offered.)
  await page.evaluate(() => window.syn3h.shell.openJoin()); await page.waitForTimeout(600)
  const qr = await page.evaluate(() => { const r = document.querySelector('.join-view .invite-qr').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: innerHeight } })
  check(qr.top >= 0 && qr.bottom <= qr.height, `${view.name}: the QR code does not fit the screen (${Math.round(qr.top)} to ${Math.round(qr.bottom)} of ${qr.height})`)
  await fits('join-qr'); await page.evaluate(() => window.syn3h.shell.closeJoin())
  // On to driving: a tap on the world's label drops straight in.
  await page.evaluate(() => window.syn3h.shell.showPanel('index')); await settle('index'); await fits('index')
  // The index is the galaxy: every world's label and the links are on the screen.
  await page.waitForTimeout(1500)
  const off = await page.evaluate(() => [...document.querySelectorAll('.galaxy-label:not([hidden]), .galaxy-links button')].filter(el => { const r = el.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight }).map(el => el.textContent.trim()))
  check(off.length === 0, `${view.name}: off the screen in the galaxy: ${off.join(', ')}`)
  // A tap on the world is the whole way in: no form between the galaxy and the ground.
  await page.locator('.galaxy-label[data-world=alpine]').dispatchEvent('click')
  await page.waitForFunction(() => document.querySelector('.syn3h-shell').classList.contains('is-playing') && window.syn3hNet?.connected, null, { timeout: 60000 })
  await page.waitForTimeout(2500)
  const playing = await g(), driving = await world()
  check(!playing.galaxyLive, `${view.name}: lobby graphics contexts still live while playing: ${JSON.stringify(playing)}`)
  check(driving.planet === 'alpine' && driving.seed === 90210, `${view.name}: driving on ${driving.planet}.${driving.seed}`)
  await page.screenshot({ path: `${out}/${label}-guest-${view.name}-driving.png` })
  // Back in the menu the sky returns; a hidden tab stops it; the lowest graphics level holds it still.
  await page.evaluate(() => window.syn3h.shell.openMenu()); await page.waitForTimeout(2500)
  const menu = await g()
  // (The Custom planet's sliders were checked here; it is not offered: OFFER_CUSTOM_PLANET.)
  await page.evaluate(() => window.syn3h.shell.showPanel('index')); await settle('index')
  check(await page.evaluate(() => window.syn3h.shell.graphics.galaxyLive), `${view.name}: the galaxy did not come back with the menu`)
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
  const frames = () => page.evaluate(() => (window.syn3h.shell.galaxy?.frames ?? 0))
  const hidden0 = await frames(); await page.waitForTimeout(1500); const hidden1 = await frames()
  check(hidden1 === hidden0, `${view.name}: the galaxy drew ${hidden1 - hidden0} frames in a hidden tab`)
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); clearInterval(window.__pin); window.syn3h.params.set('gfx.level', 0); window.syn3h.shell.showPanel('index') })
  await settle('index'); await page.waitForTimeout(3000)
  // Held still, it comes to rest once the view has settled and the maps are in.
  let low0 = await g(), low1 = low0
  for (let i = 0; i < 10; i++) { low0 = await g(); await page.waitForTimeout(2000); low1 = await g(); if (low1.galaxyFrames === low0.galaxyFrames) break }
  check(low1.galaxyLive, `${view.name}: at graphics level 0 the galaxy is gone`)
  check(low1.galaxyFrames === low0.galaxyFrames, `${view.name}: at graphics level 0 the galaxy still animates (${low1.galaxyFrames - low0.galaxyFrames} frames in 2 s)`)
  await page.screenshot({ path: `${out}/${label}-guest-${view.name}-level0.png` })
  report.guest.push({ view: view.name, usableMs, tapMs, starFps: +starFps.toFixed(1), planetMaps: during.planetMaps, landed, driving })
  await context.close()
}
for (const row of report.guest) console.log(`guest ${row.view}: lobby usable in ${row.usableMs} ms at 4x throttle, tap answered in ${row.tapMs} ms, galaxy ${row.starFps} fps, ${row.planetMaps} maps`)
for (const failure of guestFailures) console.log(`GUEST FAIL ${failure}`)
if (strict && guestFailures.length) process.exitCode = 1
await browser.close(); await safari.close()
const bad = report.states.filter(s => s.overlaps.length || s.offscreen.length || s.grid.length)
await writeFile(`${out}/${label}-report.json`, JSON.stringify(report, null, 1))
for (const s of report.states) console.log(`${s.view} ${s.vehicle} ${s.state}: ${s.overlaps.length || s.offscreen.length || s.grid.length ? [...s.overlaps, ...s.offscreen.map(n => `${n} off screen`), ...s.grid.map(g => `thumb grid: ${g}`)].join('; ') : 'clear'}`)
console.log(`errors: ${JSON.stringify(report.errors)}`)
if (report.errors.length || (strict && bad.length)) process.exitCode = 1
