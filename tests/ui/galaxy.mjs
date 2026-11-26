/**
 * The galaxy lobby draws reachable worlds and captions, swings when dragged, rests behind a
 * sheet and takes players straight into their selected world. Exercise desktop, phone and
 * flat fallback entry, the held-still lobby, and skipping a returning player's descent.
 *
 *   tools/heavy.sh node tests/ui/galaxy.mjs
 *
 * Needs a dev server; MIRA_URL picks it (default http://127.0.0.1:5187/).
 */
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { waitForState } from './stateWait.mjs'
const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5187/'
const out = 'tests/ui/artifacts/galaxy'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = []
const ready = page => page.waitForFunction(() => window.mira?.game?.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false' && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
// Sample a target the player can hit. Freeze orbital motion once it is found so
// the sampled point and the physical input refer to the same world.
async function reachableWorld(page, kind, preferred) {
  const target = await page.waitForFunction(({ kind, preferred }) => {
    const { shell, planets } = window.mira
    const galaxy = shell.galaxy, canvas = document.querySelector('.galaxy-canvas')
    if (!canvas || galaxy.opening) return
    const host = canvas.getBoundingClientRect()
    const worlds = galaxy.screen.filter(place => place.visible && place.id !== planets.currentPlanet().id)
    worlds.sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred) || b.radius - a.radius)
    for (const place of worlds) {
      if (kind === 'disc' && place.radius <= 6) continue
      const chip = document.querySelector(`.galaxy-label[data-world="${place.id}"]`)
      if (kind === 'caption' && (!chip || chip.hidden || chip.classList.contains('is-suppressed'))) continue
      const name = chip?.querySelector('strong').getBoundingClientRect()
      const x = kind === 'caption' ? name.left + name.width / 2 : host.left + place.x
      const y = kind === 'caption' ? name.top + name.height / 2 : host.top + place.y
      const hit = document.elementFromPoint(x, y)
      if (kind === 'caption' ? hit?.closest('.galaxy-label') !== chip : hit !== canvas) continue
      const nearer = [...galaxy.screen.filter(other => other.visible), galaxy.sunScreen]
        .some(other => other.depth < place.depth && Math.hypot(x - host.left - other.x, y - host.top - other.y) < other.radius)
      if (nearer) continue
      galaxy.clockHold = true
      return { id: place.id, x, y }
    }
  }, { kind, preferred }, { timeout: 30000 })
  return target.jsonValue()
}


const views = [
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
  { name: 'phone', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
]

async function tabThroughWorlds(page, required, visit) {
  const worldControls = '.galaxy-label[data-world], .galaxy-world-key[data-world]'
  const visited = new Set()
  for (let i = 0; i < 60 && visited.size < required.length; i++) {
    await page.keyboard.press('Tab')
    const id = await page.evaluate(selector => {
      const focus = document.activeElement
      return focus.matches(selector) ? focus.dataset.world : null
    }, worldControls)
    if (!id || !required.includes(id) || visited.has(id)) continue
    const name = await page.locator(`.galaxy-label[data-world="${id}"] strong`).textContent()
    const focused = page.locator(':focus').and(page.locator(worldControls))
    assert.equal(await focused.and(page.getByRole('button', { name: name.trim() })).count(), 1,
      `${id}: the button reached by real Tab announces its world name`)
    await visit(id)
    visited.add(id)
  }
  assert.deepEqual([...visited].sort(), [...required].sort(), 'real Tab reaches every requested world')
}

async function verifyWorldInput(view) {
  const context = await browser.newContext({ ...view, reducedMotion: 'reduce' })
  try {
    const page = await context.newPage()
    const open = async path => {
      const url = new URL(base)
      url.searchParams.set('room', `galaxy-access-${view.name}-${path}-${Date.now()}`)
      url.searchParams.set('gfx', '3')
      await page.goto(url.href)
      await ready(page)
      await page.evaluate(() => document.fonts.ready.then(() => true))
      await waitForState(page, 'the settled Galaxy with the Moon caption omitted', () => {
        const { galaxy } = window.mira.shell
        const moon = document.querySelector('.galaxy-label[data-world="moon"]')
        return galaxy.live && !galaxy.opening && galaxy.painted >= window.mira.planets.PLANETS.length &&
          moon?.classList.contains('is-suppressed')
      }, undefined, 120)
      const omitted = await page.locator('.galaxy-label[data-world="moon"]').evaluate(chip => ({
        disabled: chip.disabled, tabIndex: chip.tabIndex, pointerEvents: getComputedStyle(chip).pointerEvents,
      }))
      assert.deepEqual(omitted, { disabled: true, tabIndex: -1, pointerEvents: 'none' },
        `${view.name}: the omitted Moon caption's old screen box cannot be activated`)
      const fallback = page.locator('button.galaxy-world-key[data-world="moon"]')
      assert.equal(await fallback.count(), 1, `${view.name}: Moon has a separate keyboard button`)
      assert.equal(await fallback.evaluate(button => getComputedStyle(button).pointerEvents), 'none',
        `${view.name}: the Moon keyboard target leaves canvas picking intact`)
    }
    const tapDisc = async id => {
      const target = await page.evaluate(async id => {
        const { pickLobbyTarget } = await import('/src/ui/galaxy/Galaxy.ts')
        const { galaxy } = window.mira.shell
        const canvas = document.querySelector('.galaxy-canvas'), host = canvas.getBoundingClientRect()
        const disc = galaxy.screen.find(place => place.id === id && place.visible)
        if (!disc) return null
        const offsets = [[0, 0], ...[0.4, 0.7, 0.9, 0.98].flatMap(radius =>
          Array.from({ length: 24 }, (_, i) => [radius * Math.cos(i * Math.PI / 12), radius * Math.sin(i * Math.PI / 12)]))]
        for (const [dx, dy] of offsets) {
          const x = disc.x + dx * disc.radius, y = disc.y + dy * disc.radius
          const point = { x: host.left + x, y: host.top + y }
          if (document.elementFromPoint(point.x, point.y) === canvas &&
              pickLobbyTarget(galaxy.screen, galaxy.sunScreen, x, y, 0) === id) return point
        }
        return null
      }, id)
      assert.ok(target, `${view.name}: ${id} has a tappable pixel on its visible disc`)
      if (view.hasTouch) await page.touchscreen.tap(target.x, target.y)
      else await page.mouse.click(target.x, target.y)
    }
    const enteredMoon = () => waitForState(page, `${view.name}: actual Moon ingress`, () =>
      window.mira.shell.playing && !window.mira.shell.dropping && window.mira.planets.currentPlanet().id === 'moon',
    undefined, 120)

    await open('pointer')
    const worlds = await page.evaluate(() => {
      const { shell, planets } = window.mira
      window.__worldInput = { taps: [], original: shell.tapWorld }
      // Keep the real input and picking code. Only suppress the descent after it dispatches.
      shell.tapWorld = id => { window.__worldInput.taps.push(id); return true }
      return planets.PLANETS.map(planet => planet.id)
    })
    assert.equal(worlds.length, 9, 'the access check exercises all nine recipes')
    for (const id of worlds) {
      const stops = await page.locator(`.galaxy-label[data-world="${id}"], .galaxy-world-key[data-world="${id}"]`)
        .evaluateAll(buttons => buttons.filter(button => button.tabIndex === 0 && !button.disabled &&
          !button.closest('[hidden], [inert]')).length)
      assert.equal(stops, 1, `${view.name}: ${id} has exactly one Tab stop`)
      await tapDisc(id)
      assert.deepEqual(await page.evaluate(() => window.__worldInput.taps.splice(0)), [id],
        `${view.name}: the real disc pointer dispatches ${id} exactly once`)
    }
    await tabThroughWorlds(page, worlds, async id => {
      for (const key of ['Enter', 'Space']) {
        await page.keyboard.press(key)
        assert.deepEqual(await page.evaluate(() => window.__worldInput.taps.splice(0)), [id],
          `${view.name}: ${key} dispatches ${id} exactly once from its real Tab stop`)
      }
    })
    await page.evaluate(() => { window.mira.shell.tapWorld = window.__worldInput.original })
    await tapDisc('moon')
    await enteredMoon()

    await open('keyboard')
    await tabThroughWorlds(page, ['moon'], async () => {
      assert.equal(await page.locator('.galaxy-world-key[data-world="moon"]:focus').count(), 1,
        `${view.name}: the real Moon Tab stop is its separate world button`)
      await page.keyboard.press('Enter')
      await enteredMoon()
    })
  } finally {
    await context.close()
  }
}

try {
  for (const view of views) {
    const context = await browser.newContext(view), page = await context.newPage()
    page.on('pageerror', e => errors.push(`${view.name}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error') errors.push(`${view.name}: ${m.text()}`) })
    await page.goto(`${base}?room=galaxy-${view.name}-${Date.now()}`, { waitUntil: 'load' })
    await ready(page)
    // Headless Chrome draws slowly, and the game would step its graphics level down to the
    // lowest, which retires the galaxy. Hold the level so this checks the galaxy itself.
    await page.evaluate(() => { window.__pin = setInterval(() => window.mira.params.set('gfx.level', 2), 400) })
    // The opening (src/ui/galaxy/opening.ts) runs about nine seconds; a key skips straight to the
    // settled lobby, as for a player, and the checks below are of that lobby.
    await page.keyboard.press('Shift')
    await page.evaluate(() => document.fonts.ready.then(() => true))
    const state = () => page.evaluate(() => {
      const { galaxy } = window.mira.shell
      const canvas = document.querySelector('.galaxy-canvas')
      const host = canvas.getBoundingClientRect()
      const view = { left: Math.max(0, host.left), top: Math.max(0, host.top), right: Math.min(innerWidth, host.right), bottom: Math.min(innerHeight, host.bottom) }
      const chips = [...document.querySelectorAll('.galaxy-label')]
      const drawn = chip => {
        const style = getComputedStyle(chip)
        return !chip.hidden && !chip.classList.contains('is-suppressed') && style.visibility === 'visible' && Number(style.opacity) > 0
      }
      const labels = chips.filter(drawn).map(chip => {
        const name = chip.querySelector('strong')
        const rows = [...chip.querySelector('.galaxy-caption-text').children]
          .filter(row => row.textContent.trim() && getComputedStyle(row).visibility === 'visible').map(row => {
            const range = document.createRange()
            range.selectNodeContents(row)
            return range.getBoundingClientRect().toJSON()
          })
        const box = name.getBoundingClientRect()
        return { id: chip.dataset.world, x: box.left + box.width / 2, y: box.top, rows, name: name.textContent.trim() }
      })
      const suppressed = chips.filter(chip => chip.classList.contains('is-suppressed'))
        .map(chip => ({ id: chip.dataset.world, disabled: chip.disabled, tabIndex: chip.tabIndex, pointerEvents: getComputedStyle(chip).pointerEvents }))
      const discs = galaxy.screen.filter(place => place.visible && place.radius > 0)
      const required = discs.filter(place => {
        const overlaps = [...discs, galaxy.sunScreen].some(other => other !== place && other.radius > 0 &&
          Math.hypot(place.x - other.x, place.y - other.y) < place.radius + other.radius)
        if (overlaps) return false
        // Probe the part of the disc the player can actually hit, including limbs at the edge.
        const offsets = [[0, 0], ...Array.from({ length: 8 }, (_, i) =>
          [0.8 * Math.cos(i * Math.PI / 4), 0.8 * Math.sin(i * Math.PI / 4)])]
        const x = host.left + place.x, y = host.top + place.y
        const limbX = Math.max(view.left + 0.01, Math.min(x, view.right - 0.01))
        const limbY = Math.max(view.top + 0.01, Math.min(y, view.bottom - 0.01))
        return (Math.hypot(limbX - x, limbY - y) < place.radius && document.elementFromPoint(limbX, limbY) === canvas) ||
          offsets.some(([dx, dy]) => document.elementFromPoint(x + dx * place.radius, y + dy * place.radius) === canvas)
      }).map(place => ({ id: place.id, x: host.left + place.x, y: host.top + place.y, radius: place.radius }))
      const seats = discs.map(place => ({ id: place.id, x: host.left + place.x, y: host.top + place.y, radius: place.radius }))
      return { open: document.querySelector('.mira-shell').classList.contains('galaxy-open'), live: galaxy.live, frames: galaxy.frames, view, labels, suppressed, required, seats, ids: chips.map(chip => chip.dataset.world) }
    })
    await waitForState(page, 'the opening to settle with multiple drawn captions', () => {
      if (window.mira.shell.galaxy.opening || document.documentElement.dataset.opening) return false
      const shown = [...document.querySelectorAll('.galaxy-label:not([hidden]):not(.is-suppressed)')]
      return shown.filter(chip => Number(getComputedStyle(chip).opacity) > 0).length >= 2
    }, undefined, 30)
    const first = await state()
    assert.equal(first.open, true); assert.equal(first.live, true)
    const planets = await page.evaluate(() => window.mira.planets.PLANETS.map(p => p.id))
    assert.deepEqual(first.ids.sort(), [...planets].sort(), `${view.name}: a caption for each recipe; Custom is hidden for now`)
    assert.ok(first.labels.length >= 2, `${view.name}: the lobby draws multiple captions`)
    assert.ok(first.required.length, `${view.name}: the default arrival has reachable, unoccluded discs`)
    if (view.name === 'desktop') {
      const disc = first.seats.find(place => place.id === 'volcanic')
      assert.ok(disc && Math.hypot(Math.max(first.view.left - disc.x, disc.x - first.view.right, 0),
        Math.max(first.view.top - disc.y, disc.y - first.view.bottom, 0)) < disc.radius, 'desktop: Volcanic disc is on screen')
      assert.ok(first.labels.some(label => label.id === 'volcanic' && label.name), 'desktop: Volcanic name is drawn')
    }
    const missing = first.required.filter(place => !first.labels.some(label => label.id === place.id && label.name))
    assert.deepEqual(missing, [], `${view.name}: every reachable, unoccluded disc has a visible name (unless discs overlap)`)
    for (const { id, rows } of first.labels) {
      assert.ok(rows.length > 0 && rows.every(row => row.width > 0 && row.height > 0 &&
        row.left >= first.view.left && row.right <= first.view.right && row.top >= first.view.top && row.bottom <= first.view.bottom),
      `${view.name}: all of ${id}'s drawn caption lines fit; ${JSON.stringify(rows)}`)
      const disc = first.seats.find(place => place.id === id)
      assert.ok(disc && rows.some(row => {
        const dx = Math.max(row.left - disc.x, disc.x - row.right, 0)
        const dy = Math.max(row.top - disc.y, disc.y - row.bottom, 0)
        return Math.hypot(dx, dy) <= disc.radius + rows[0].height
      }), `${view.name}: ${id}'s printed caption stays within one line of its disc`)
    }
    for (const item of first.suppressed) {
      assert.equal(item.disabled, true, `${view.name}: suppressed ${item.id} is a disabled button`)
      assert.equal(item.tabIndex, -1, `${view.name}: suppressed ${item.id} is outside the Tab order`)
      assert.equal(item.pointerEvents, 'none', `${view.name}: suppressed ${item.id} is not a pointer target`)
    }
    await page.screenshot({ path: `${out}/${view.name}-home.png` })
    // Dragging empty space swings the view: the worlds move across the screen.
    const from = { x: view.viewport.width * 0.5, y: view.viewport.height * 0.16 }
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x + 160, from.y + 30, { steps: 8 }); await page.mouse.up()
    // The swing plays out over drawn frames: wait until a label has moved, as the assertion needs.
    await waitForState(page, 'a label moved by the swing, with frames drawn', first => [...document.querySelectorAll('.galaxy-label:not([hidden]):not(.is-suppressed)')].some(l => { const r = l.querySelector('strong').getBoundingClientRect(), b = first.labels.find(x => x.id === l.dataset.world); return b && Math.hypot(r.left + r.width / 2 - b.x, r.top - b.y) > 25 }) && window.mira.shell.galaxy.frames > first.frames, first, 30)
    const swung = await state()
    assert.ok(swung.frames > first.frames, 'it keeps drawing')
    assert.ok(swung.labels.some(l => { const before = first.labels.find(b => b.id === l.id); return before && Math.hypot(l.x - before.x, l.y - before.y) > 25 }), `${view.name}: the view swung`)
    await page.screenshot({ path: `${out}/${view.name}-swung.png` })
    // Behind a panel the galaxy dims and stops drawing; back at the index it is bright again.
    // About is a sheet from its icon above the gear: behind it the galaxy dims and holds still too.
    await page.locator('.lobby-about').click()
    // Dimmed to the sheet's level (tuning, Shell's SHEET_BACKDROP): below 1 and settled there.
    await waitForState(page, 'the galaxy dimmed behind the sheet', () => { const g = window.mira.shell.galaxy; return g.backdrop < 1 && g.dim === g.backdrop }, undefined, 15)
    // A map arriving, or the camera still easing home, draws a frame; then it rests.
    let rests = false
    const frames = () => page.evaluate(() => window.mira.shell.galaxy.frames)
    for (let i = 0; i < 20 && !rests; i++) { const f = await frames(); await page.waitForTimeout(1200); rests = await frames() === f }
    assert.ok(rests, `${view.name}: the galaxy keeps drawing behind a panel`)
    await page.screenshot({ path: `${out}/${view.name}-panel.png` })
    await page.keyboard.press('Escape'); await page.locator('.lobby-sheet-about').waitFor({ state: 'hidden' })
    await page.waitForFunction(() => window.mira.shell.galaxy.dim === 1, null, { timeout: 15000 })
    // Tapping a world drops straight into it: no form, no panel, one motion to the ground.
    const target = await reachableWorld(page, 'disc', 'alpine')
    // Observe the visual transition in the page. Screenshots on a busy host can miss a phase
    // and wall time includes room and graphics preparation, so report duration as a measurement.
    await page.evaluate(() => {
      const root = document.querySelector('.mira-shell'), game = document.getElementById('game')
      const drop = window.__drop = { start: performance.now(), end: 0, blurred: false }
      const observer = new MutationObserver(records => {
        if (/blur\(/.test(game.style.filter) || records.some(record => record.target === game && /blur\(/.test(record.oldValue ?? ''))) {
          drop.blurred = true
        }
        if (root.classList.contains('is-playing') && !root.classList.contains('is-descending')) {
          drop.end = performance.now()
          observer.disconnect()
        }
      })
      observer.observe(root, { attributeFilter: ['class'] })
      observer.observe(game, { attributeFilter: ['style'], attributeOldValue: true })
    })
    if (view.hasTouch) await page.touchscreen.tap(target.x, target.y)
    else await page.mouse.click(target.x, target.y)
    await page.waitForFunction(() => document.querySelector('.mira-shell').classList.contains('is-descending'), null, { timeout: 1000 })
    await page.waitForTimeout(900); await page.screenshot({ path: `${out}/${view.name}-flying.png` })
    await page.waitForTimeout(1300); await page.screenshot({ path: `${out}/${view.name}-descent-dive.png` })
    await page.waitForTimeout(1500); await page.screenshot({ path: `${out}/${view.name}-descent-arrive.png` })
    await page.waitForFunction(() => { const s = document.querySelector('.mira-shell'); return s.classList.contains('is-playing') && !s.classList.contains('is-descending') }, null, { timeout: 15000 })
    assert.equal(await page.evaluate(() => window.mira.planets.currentPlanet().id), target.id)
    const drop = await page.evaluate(() => window.__drop)
    assert.ok(drop.blurred, `${view.name}: the unskipped descent showed the blur transition`)
    assert.ok(drop.end > drop.start, `${view.name}: the descent finished`)
    console.log(`${view.name}: the drop took ${Math.round(drop.end - drop.start)} ms`)
    // (A slow headless browser can have dropped the graphics level by now, which retires the galaxy.)
    assert.notEqual(await page.evaluate(() => window.mira.shell.galaxy?.live), true, 'the galaxy gives its graphics back')
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('game')).filter), 'none', 'the game is sharp again')
    assert.equal(await page.evaluate(() => window.mira.game.input.suspended), false, 'and it takes input')
    await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${view.name}-landed.png` })
    await context.close()
  }
  for (const view of views) await verifyWorldInput(view)

  // The lowest graphics level keeps the galaxy, held still: no frames while nothing moves, a
  // drag draws, and a tap still flies to a world.
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    page.on('pageerror', e => errors.push(`still: ${e.message}`))
    await page.goto(`${base}?room=galaxy-still-${Date.now()}`, { waitUntil: 'load' }); await ready(page)
    await page.evaluate(() => { window.__pin = setInterval(() => { window.mira.shell.stopAttract(); window.mira.params.set('gfx.level', 0) }, 200) })
    // Every map painted first: each one arriving is a reason to draw.
    await page.waitForFunction(() => window.mira.shell.graphics.planetMaps >= window.mira.planets.PLANETS.length, null, { timeout: 60000 })
    // Count renderer decisions. A busy machine can go a whole second without delivering
    // a frame, and a map upload or presence refresh legitimately interrupts an idle window.
    const idleWindow = await page.evaluate(() => new Promise(resolve => {
      const galaxy = window.mira.shell.galaxy
      let frames = galaxy.frames, idle = galaxy.idle, since = performance.now()
      const deadline = since + 60_000
      const sample = now => {
        if (galaxy.frames !== frames) { frames = galaxy.frames; idle = galaxy.idle; since = now }
        if (galaxy.live && galaxy.idle - idle >= 5 && now - since >= 1500) {
          resolve({ frames, settled: true })
        } else if (now >= deadline) {
          resolve({ frames, settled: false })
        } else requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    }))
    assert.ok(idleWindow.settled, 'the live Minimal lobby skips drawing for a sustained interval while its loop runs')
    await page.mouse.move(195, 140); await page.mouse.down(); await page.mouse.move(330, 170, { steps: 8 }); await page.mouse.up()
    await page.waitForFunction(frames => window.mira.shell.galaxy.frames > frames, idleWindow.frames)
    await page.screenshot({ path: `${out}/still-swung.png` })
    // Held still or not, a tap is the whole drop, drawn as it goes.
    const target = await reachableWorld(page, 'caption', 'desert')
    await page.touchscreen.tap(target.x, target.y)
    await page.waitForFunction(() => { const s = document.querySelector('.mira-shell'); return s.classList.contains('is-playing') && !s.classList.contains('is-descending') }, null, { timeout: 20000 })
    assert.equal(await page.evaluate(() => window.mira.planets.currentPlanet().id), target.id)
    await page.close()
  }
  // A returning player: the descent is shorter, and a key lands at once.
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.addInitScript(() => localStorage.setItem('mira.descents', '3'))
    await page.goto(`${base}?room=galaxy-skip-${Date.now()}`, { waitUntil: 'load' }); await ready(page)
    await page.evaluate(() => { window.__pin = setInterval(() => window.mira.params.set('gfx.level', 2), 400) })
    const target = await reachableWorld(page, 'caption', 'desert')
    await page.mouse.click(target.x, target.y)
    await page.waitForFunction(() => document.querySelector('.mira-shell').classList.contains('is-descending'), null, { timeout: 1000 })
    // A key lands at once: it skips the blurred fall through the air (Shell.descent), which an
    // unskipped drop always shows. Watched as state, not timed, so a busy machine cannot fail it.
    await page.evaluate(() => { const game = document.getElementById('game'); window.__blurred = false; new MutationObserver(() => { if (/blur/.test(game.style.filter)) window.__blurred = true }).observe(game, { attributes: true, attributeFilter: ['style'] }) })
    // The skip listens from the frame after the drop starts: press after two frames.
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); await page.keyboard.press('w')
    await page.waitForFunction(() => { const s = document.querySelector('.mira-shell'); return s.classList.contains('is-playing') && !s.classList.contains('is-descending') }, null, { timeout: 15000 })
    assert.equal(await page.evaluate(() => window.__blurred), false, 'a key skips the fall through the air')
    assert.equal(await page.evaluate(() => localStorage.getItem('mira.descents')), '4')
    assert.equal(await page.evaluate(() => window.mira.planets.currentPlanet().id), target.id)
    await page.close()
  }
  // There is no other lobby. Where the galaxy's shader will not start, its world names stay
  // as a row of buttons and a tap goes straight into that world.
  const flat = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await flat.addInitScript(() => { const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return this.className === 'galaxy-canvas' ? null : get.call(this, kind, ...rest) } })
  await flat.goto(`${base}?room=galaxy-flat-${Date.now()}`, { waitUntil: 'load' }); await ready(flat)
  assert.equal(await flat.evaluate(() => document.querySelector('.mira-shell').classList.contains('galaxy-flat')), true)
  assert.equal(await flat.locator('.planet-card').count(), 0)
  // Every world must be reachable, including those in the same column as the Settings dock.
  for (const choice of await flat.locator('.galaxy-label[data-world]').all()) await choice.click({ trial: true })
  await flat.screenshot({ path: `${out}/flat.png` })
  await flat.locator('.galaxy-label[data-world=desert]').click()
  await flat.waitForFunction(() => document.querySelector('.mira-shell').classList.contains('is-playing'), null, { timeout: 20000 })
  assert.equal(await flat.evaluate(() => window.mira.planets.currentPlanet().id), 'desert')
  await flat.close()
  // Without WebGL 2 at all the lobby says so plainly (the game cannot draw there either).
  const bare = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await bare.addInitScript(() => { const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return kind === 'webgl2' && !this.isConnected ? null : get.call(this, kind, ...rest) } })
  await bare.goto(`${base}?room=galaxy-bare-${Date.now()}`, { waitUntil: 'load' })
  await bare.waitForSelector('.lobby-unsupported:not([hidden])', { timeout: 120000 })
  assert.equal(await bare.evaluate(() => Boolean(window.mira?.shell?.galaxy)), false)
  await bare.waitForFunction(() => document.documentElement.dataset.boot === 'done', null, { timeout: 120000 }); await bare.waitForTimeout(1500)
  await bare.screenshot({ path: `${out}/no-webgl2.png` })
  await bare.close()
  console.log(JSON.stringify({ ok: true, errors }))
} finally { await browser.close() }
if (errors.length) { console.log(errors); process.exitCode = 1 }
