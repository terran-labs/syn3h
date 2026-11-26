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
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium, devices, webkit } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import { thumbGrid } from './thumbGrid.mjs'

const label = process.argv[2] ?? 'run'
const strict = !process.argv.includes('--record')
const out = 'tests/ui/artifacts/phone-layout'
const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5187/'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = { label, states: [], errors: [] }

const rows = ['> Phone QA   20  [KING] (you) (host)', '  Gevotek Spare Pilot   0  ', '  Mevigon Cone Marshal   0  ']
const status = extra => ['net: room phone-layout ping 17 ms delay 0 ms', 'host: you shared sliders open to all', 'mode: King of the Hill first to 60', ...rows, ...extra]
const scores = [{ name: 'Phone QA', score: 20, you: true }, { name: 'Gevotek Spare Pilot', score: 12 }, { name: 'Mevigon Cone Marshal', score: 3 }]
const koth = extra => ({ mode: 'koth', holderName: null, holderIsYou: false, contested: false, scores, target: 60, winner: null, ...extra })

/** Rectangles of everything that must stay apart, and the pairs that touch. */
const measure = page => page.evaluate(() => {
  const s = window.mira, cam = s.game.camera, p = s.player.body.translation()
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
    // The owner's call (17 November 2026): the minimap stays in the lower left as on desktop and
    // the floating stick may land on top of it for a moment. The map takes no touches.
    if ([a.name, b.name].includes('.touch-stick') && [a.name, b.name].includes('.shell-minimap')) continue
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
    await page.waitForFunction(() => window.mira?.game?.tick > 25, null, { timeout: 120000 })
    // No daydream: this measures the layout, and the idle autopilot taking the wheel part way
    // through moved the vehicle (and the camera) under the stick hint, by timing and load.
    await page.evaluate(() => window.mira.params.set('daydream.seconds', 0))
    const shot = async (state, inGame = true) => {
      await page.screenshot({ path: `${out}/${label}-${view.name}-${vehicle}-${state}.png` })
      const m = inGame ? { ...await measure(page), grid: await page.evaluate(thumbGrid) } : { overlaps: [], offscreen: [], grid: [] }
      report.states.push({ view: view.name, vehicle, state, overlaps: m.overlaps, offscreen: m.offscreen, grid: m.grid, boxes: m.boxes })
    }
    const panel = async id => {
      await page.evaluate(id => window.mira.shell.showPanel(id), id)
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
    await page.evaluate(() => { const s = window.mira.shell; s.onPlay = () => {}; s.play() })
    await page.evaluate(lines => window.mira.shell.setStatus(lines), status(['Gevotek Spare Pilot joined']))
    await page.waitForTimeout(1200)
    await shot('game')                                   // controls card and a toast on screen
    // Last of the measured states, so it cannot shift the others: on its roof and still, Flip
    // upright takes BRAKE's place in the thumb grid (TouchControls setFlipReady). The vehicle
    // keeps its place and heading, is held still (kinematic) through the measurement, with a
    // moment for the camera to settle, then is put back exactly as it was.
    const flipState = async () => {
      const pose = await page.evaluate(() => { const v = window.mira.player, t = v.body.translation(), q = v.body.rotation(); return { t: { x: t.x, y: t.y, z: t.z }, q: { x: q.x, y: q.y, z: q.z, w: q.w } } })
      await page.evaluate(({ t, q }) => {
        const v = window.mira.player, b = v.body
        // Rolled over about its own nose: the heading, and so the camera, stay as they were.
        const roll = { x: 0, y: 0, z: 1, w: 0 }
        const r = { w: q.w * roll.w - q.x * roll.x - q.y * roll.y - q.z * roll.z, x: q.w * roll.x + q.x * roll.w + q.y * roll.z - q.z * roll.y, y: q.w * roll.y - q.x * roll.z + q.y * roll.w + q.z * roll.x, z: q.w * roll.z + q.x * roll.y - q.y * roll.x + q.z * roll.w }
        // Held still from the start (kinematic), so it cannot roll back by itself before the
        // offer's half second is up.
        b.setTranslation({ x: t.x, y: t.y + 0.6, z: t.z }, true); b.setRotation(r, true); b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true)
        b.setBodyType(2, true)
      }, pose)
      await page.locator('.touch-controls [data-action="flip"]').waitFor({ state: 'visible', timeout: 60000 })
      await page.waitForTimeout(1200); await shot('flip-offered')
      // The tap on FLIP is the player's activity: the idle autopilot's clock starts again.
      await page.evaluate(({ t, q }) => {
        const v = window.mira.player, b = v.body
        b.setBodyType(0, true); b.setTranslation(t, true); b.setRotation(q, true); b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true)
        window.mira.bots.daydream?.noteActivity()
      }, pose)
    }
    await page.waitForTimeout(5500)
    await page.evaluate(m => window.mira.shell.setMatchState(m), koth({ holderName: 'Phone QA', holderIsYou: true }))
    await page.waitForTimeout(400); await shot('hill-announce')
    await page.waitForTimeout(3200); await shot('hill-held')
    if (vehicle !== 'buggy') await flipState()
    if (vehicle === 'buggy') {
      await page.evaluate(m => window.mira.shell.setMatchState(m), koth({ holderName: 'Phone QA', holderIsYou: true, contested: true }))
      await page.waitForTimeout(3200); await shot('hill-contested')
      await page.evaluate(m => window.mira.shell.setMatchState(m), koth({ holderName: 'Phone QA', holderIsYou: true, winner: 'Phone QA', winnerColor: '#ff8844', nextRoundIn: 6 }))
      await page.waitForTimeout(600); await shot('hill-winner')
      await flipState()
      await page.evaluate(() => window.mira.shell.openJoin()); await page.waitForTimeout(500); await shot('join-qr', false)
      await page.evaluate(() => window.mira.shell.closeJoin())
      await page.evaluate(() => window.mira.shell.openMenu()); await page.waitForTimeout(2300); await shot('menu', false)
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
  const usable = () => page.waitForFunction(() => window.mira?.shell && !document.querySelector('.mira-loading:not([hidden])') && document.querySelector('.lobby-panels')?.dataset.busy === 'false', null, { timeout: 180000 })
  await usable()
  const usableMs = Date.now() - started
  // Hold the graphics level: a slow headless browser would otherwise step it down and retire the galaxy.
  await page.evaluate(() => { window.__pin = setInterval(() => window.mira.params.set('gfx.level', 2), 400) })
  const g = () => page.evaluate(() => window.mira.shell.graphics)
  const world = () => page.evaluate(() => ({ planet: window.mira.planets.currentPlanet().id, seed: window.mira.params.get('world.seed').value }))
  const settle = id => page.waitForFunction(id => { const p = document.querySelector('.lobby-panels'); return p.dataset.activePanel === id && p.dataset.busy === 'false' }, id, { timeout: 30000 })
  // Bugs caught: the page, a panel or a sheet can be pushed sideways by a finger (anything a
  // player can scroll is wider than its box), or a control a player needs, or text they read, is
  // cut off by the screen's edge. A picture that is neither a control nor text may run past the
  // edge on purpose (Welcome's carousel: the pictures either side of the front one), as long as
  // nothing then scrolls sideways; a figure's caption kept for screen readers is clipped to a
  // pixel, so it is not text anyone reads.
  const fits = async name => {
    const overflow = await page.evaluate(() => {
      const scope = '.lobby-panels > section:not([hidden]), .join-view:not([hidden]), dialog.lobby-sheet[open] .lobby-sheet-body'
      const problems = []
      const page = document.scrollingElement
      if (page.scrollWidth > innerWidth + 1) problems.push(`the page scrolls sideways (${page.scrollWidth} px)`)
      const roots = [...document.querySelectorAll(scope)], all = roots.flatMap(root => [root, ...root.querySelectorAll('*')])
      for (const el of all) {
        // Only auto and scroll can be moved by a finger; hidden and clip cannot.
        if (['auto', 'scroll'].includes(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1) problems.push(`${el.className || el.tagName} scrolls sideways`)
      }
      const reachable = el => el.matches('a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"]), [role=button], [contenteditable=true]') && !el.disabled && !el.closest('[inert]')
      const readable = el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
      for (const el of all) {
        const r = el.getBoundingClientRect(), style = getComputedStyle(el)
        if (r.width <= 1 || r.height <= 1 || style.visibility === 'hidden' || !(r.left < -1 || r.right > innerWidth + 1)) continue
        if (reachable(el)) problems.push(`a control is cut off: ${el.className || el.tagName}`)
        else if (readable(el)) problems.push(`text is cut off: ${el.className || el.tagName}`)
      }
      return problems.slice(0, 3)
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
  const f0 = await page.evaluate(() => window.mira.shell.galaxy?.frames ?? 0), s0 = Date.now()
  await page.waitForTimeout(3000)
  const starFrames = (await page.evaluate(() => window.mira.shell.galaxy?.frames ?? 0)) - f0
  const starFps = starFrames / ((Date.now() - s0) / 1000)
  const t0 = Date.now()
  // About is an icon above the settings gear and opens its own sheet (LobbySheet).
  await page.locator('.lobby-gear-dock .lobby-about').tap()
  // The Welcome guide (src/ui/welcome) in its sheet: its first section heading shows.
  await page.locator('dialog.lobby-sheet-about[open] .welcome-body > h3').first().waitFor({ state: 'visible', timeout: 30000 })
  const tapMs = Date.now() - t0
  await page.waitForTimeout(5000)
  const during = await g()
  // The outcome, not a tuned limit: the wait above fails if the tap is never answered (a dropped
  // tap), and the galaxy must keep drawing while the maps are painted. Its frame rate and the
  // tap's time are reported, not pinned: at 4x CPU throttle both follow the machine's load (a
  // floor of 8 fps failed the 2121 train at 5.7 fps, load 20 to 23, and passed at 13 at 11.5).
  check(starFrames > 0, `${view.name}: the galaxy drew no frames in 3 s while the maps were painted`)
  check(during.planetMaps >= 3, `${view.name}: only ${during.planetMaps} planet maps were painted`)
  await fits('about'); await page.keyboard.press('Escape'); await page.locator('dialog.lobby-sheet-about').waitFor({ state: 'hidden' })
  // (The Worlds panel's re-roll and the Custom planet's lock were checked here; neither can be
  // reached from the lobby while the custom planet is not offered.)
  await page.evaluate(() => window.mira.shell.openJoin()); await page.waitForTimeout(600)
  const qr = await page.evaluate(() => { const r = document.querySelector('.join-view .invite-qr').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: innerHeight } })
  check(qr.top >= 0 && qr.bottom <= qr.height, `${view.name}: the QR code does not fit the screen (${Math.round(qr.top)} to ${Math.round(qr.bottom)} of ${qr.height})`)
  await fits('join-qr'); await page.evaluate(() => window.mira.shell.closeJoin())
  // On to driving: a tap on the world's label drops straight in.
  await page.evaluate(() => window.mira.shell.showPanel('index')); await settle('index'); await fits('index')
  await page.waitForFunction(() => !window.mira.shell.galaxy.opening &&
    [...document.querySelectorAll('.galaxy-label:not([hidden]):not(.is-suppressed)')]
      .some(chip => Number(getComputedStyle(chip).opacity) > 0), null, { timeout: 30000 })
  // Projected discs and printed rows share the same CSS-pixel coordinate space. The whole
  // caption may clamp to an edge or shift sideways to clear the dock.
  const captions = await page.evaluate(() => {
    const { galaxy } = window.mira.shell
    const host = document.querySelector('.galaxy-canvas').getBoundingClientRect()
    const layer = document.querySelector('.galaxy-labels').getBoundingClientRect()
    const view = { left: Math.max(0, layer.left), right: Math.min(innerWidth, layer.right), top: Math.max(0, layer.top), bottom: Math.min(innerHeight, layer.bottom) }
    const faults = [], shown = []
    const epsilon = 1
    const fits = box => box.left >= view.left - epsilon && box.right <= view.right + epsilon &&
      box.top >= view.top - epsilon && box.bottom <= view.bottom + epsilon
    const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
    const blockers = [...document.querySelectorAll('.lobby-gear-dock, .lobby-version-dock, #lobby-settings')]
      .filter(el => getComputedStyle(el).visibility === 'visible')
      .map(el => ({ name: el.id || el.className, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && box.height > 0)
    for (const chip of document.querySelectorAll('.galaxy-label:not([hidden]):not(.is-suppressed)')) {
      const style = getComputedStyle(chip)
      if (style.visibility !== 'visible' || Number(style.opacity) <= 0) continue
      const id = chip.dataset.world, box = chip.getBoundingClientRect()
      const rows = [...chip.querySelector('.galaxy-caption-text').children]
        .filter(row => row.textContent.trim() && getComputedStyle(row).visibility === 'visible').map(row => {
          const range = document.createRange()
          range.selectNodeContents(row)
          return range.getBoundingClientRect()
        })
      if (rows.length === 0 || rows.some(row => row.width <= 0 || row.height <= 0 || !fits(row))) {
        faults.push(`${id}: caption text is clipped or missing`)
      }
      const place = galaxy.screen.find(planet => planet.id === id)
      const x = host.left + (place?.x ?? Infinity), y = host.top + (place?.y ?? Infinity), radius = place?.radius ?? 0
      const dx = x - clamp(x, view.left, view.right), dy = y - clamp(y, view.top, view.bottom)
      if (!place?.visible || Math.hypot(dx, dy) >= radius) {
        faults.push(`${id}: drawn caption without an on-screen disc`)
      } else {
        // The caption can contact the body on any side. Use the printed rows so an invisible
        // part of the button cannot make a detached name look as if it belongs to this disc.
        const contact = rows.some(row => Math.hypot(x - clamp(x, row.left, row.right),
          y - clamp(y, row.top, row.bottom)) <= radius + (rows[0]?.height ?? 0) + epsilon)
        if (!contact) faults.push(`${id}: printed caption does not contact its disc`)
        for (const front of [...galaxy.screen.filter(planet => planet.visible), galaxy.sunScreen]) {
          if (front.depth >= place.depth) continue
          const fx = host.left + front.x, fy = host.top + front.y
          if (rows.some(row => Math.hypot(fx - clamp(fx, row.left, row.right), fy - clamp(fy, row.top, row.bottom)) < front.radius - epsilon)) {
            faults.push(`${id}: caption text overlaps ${front.id ?? 'the sun'}`)
          }
        }
      }
      for (const other of [...shown, ...blockers]) {
        if (intersects(box, other.box)) faults.push(`${id}: caption overlaps ${other.name}`)
      }
      shown.push({ name: id, box })
    }
    if (shown.length === 0) faults.push('no drawn captions')
    for (const button of document.querySelectorAll('.galaxy-links button')) {
      if (!fits(button.getBoundingClientRect())) faults.push(`${button.textContent.trim()} off the screen`)
    }
    return faults
  })
  check(captions.length === 0, `${view.name}: in the galaxy: ${captions.join('; ')}`)
  // Hit the invited world's printed caption with a real touch. A suppressed button still
  // exists in the DOM, so a synthetic click could pass while the guest cannot use it.
  const alpine = await page.waitForFunction(() => {
    const { galaxy } = window.mira.shell
    const chip = document.querySelector('.galaxy-label[data-world=alpine]')
    const place = galaxy.screen.find(planet => planet.id === 'alpine')
    if (!place?.visible || !chip || chip.hidden || chip.classList.contains('is-suppressed')) return
    const name = chip.querySelector('strong').getBoundingClientRect()
    const x = name.left + name.width / 2, y = name.top + name.height / 2
    if (document.elementFromPoint(x, y)?.closest('.galaxy-label') !== chip) return
    const host = document.querySelector('.galaxy-canvas').getBoundingClientRect()
    const blocked = [...galaxy.screen.filter(planet => planet.visible), galaxy.sunScreen]
      .some(other => other.depth < place.depth && Math.hypot(x - host.left - other.x, y - host.top - other.y) < other.radius)
    if (blocked) return
    galaxy.clockHold = true
    return { x, y }
  }, null, { timeout: 30000 })
  const target = await alpine.jsonValue()
  await page.touchscreen.tap(target.x, target.y)
  await page.evaluate(() => { window.mira.shell.galaxy.clockHold = false })
  await page.waitForFunction(() => document.querySelector('.mira-shell').classList.contains('is-playing') && window.miraNet?.connected, null, { timeout: 60000 })
  await page.waitForTimeout(2500)
  const playing = await g(), driving = await world()
  check(!playing.galaxyLive, `${view.name}: lobby graphics contexts still live while playing: ${JSON.stringify(playing)}`)
  check(driving.planet === 'alpine' && driving.seed === 90210, `${view.name}: driving on ${driving.planet}.${driving.seed}`)
  await page.screenshot({ path: `${out}/${label}-guest-${view.name}-driving.png` })
  // Back in the menu the sky returns; a hidden tab stops it; the lowest graphics level holds it still.
  await page.evaluate(() => window.mira.shell.openMenu()); await page.waitForTimeout(2500)
  const menu = await g()
  // (The Custom planet's sliders were checked here; it is not offered: OFFER_CUSTOM_PLANET.)
  await page.evaluate(() => window.mira.shell.showPanel('index')); await settle('index')
  check(await page.evaluate(() => window.mira.shell.graphics.galaxyLive), `${view.name}: the galaxy did not come back with the menu`)
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
  const frames = () => page.evaluate(() => (window.mira.shell.galaxy?.frames ?? 0))
  const hidden0 = await frames(); await page.waitForTimeout(1500); const hidden1 = await frames()
  check(hidden1 === hidden0, `${view.name}: the galaxy drew ${hidden1 - hidden0} frames in a hidden tab`)
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); clearInterval(window.__pin); window.mira.params.set('gfx.level', 0); window.mira.shell.showPanel('index') })
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
