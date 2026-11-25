// Check live caption bounds, input, and reduced motion in Chrome.
// MIRA_URL=http://127.0.0.1:5173/ tools/heavy.sh node tests/ui/lobby-labels.mjs
import '../../tools/lib/legacy-env.mjs'
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

const url = process.env.MIRA_URL
assert.ok(url, 'MIRA_URL is required')
const out = 'tests/ui/artifacts/lobby-labels'
await mkdir(out, { recursive: true })
const views = [
  ['portrait', 390, 844, true, 'no-preference'],
  ['landscape', 844, 390, true, 'no-preference'],
  ['landscape-small', 667, 375, true, 'reduce'],
  ['desktop', 1440, 900, false, 'no-preference'],
  ['desktop-1280', 1280, 800, false, 'reduce'],
  ['desktop-1700', 1700, 1100, false, 'reduce'],
]
const requestedViews = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  for (const [name, width, height, phone, reducedMotion] of views) {
    if (requestedViews.length && !requestedViews.includes(name)) continue
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, reducedMotion })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${url}?tap=0&intro=0&webgl=1&gfx=2&room=lobby-labels-${name}-${Date.now()}`)
    await page.waitForFunction(() => document.documentElement.dataset.boot === 'done' &&
      !window.mira?.shell?.galaxy?.opening && [...document.querySelectorAll('.galaxy-label')].some(chip => getComputedStyle(chip).pointerEvents === 'auto'), null, { timeout: 120000 })
    await page.evaluate(() => document.fonts.ready.then(() => true))
    const measure = () => page.evaluate(() => [...document.querySelectorAll('.galaxy-label')]
      .filter(chip => !chip.hidden && Number(getComputedStyle(chip).opacity) > 0.05)
      .map(chip => ({ id: chip.dataset.world, box: chip.getBoundingClientRect().toJSON() })))
    const check = captions => {
      assert.ok(captions.length >= 2, `${name}: multiple visible captions`)
      for (const [i, { id, box }] of captions.entries()) {
        assert.ok(box.left >= 0 && box.top >= 0 && box.right <= width && box.bottom <= height, `${name}: ${id} fits the viewport`)
        for (const other of captions.slice(0, i)) {
          const b = other.box
          assert.ok(box.right <= b.left || box.left >= b.right || box.bottom <= b.top || box.top >= b.bottom, `${name}: ${id} overlaps ${other.id}`)
        }
      }
    }
    const dismiss = page.locator('.update-banner .update-dismiss')
    if (await dismiss.isVisible()) await dismiss.click()
    await page.waitForTimeout(900)
    if (name === 'desktop-1280' || name === 'desktop-1700') {
      const trace = await page.evaluate(async () => {
        const { captionBlocked, captionBox, captionClearance } = await import('/src/ui/galaxy/labels.ts')
        const shell = window.mira.shell, galaxy = shell.galaxy
        const chips = [...document.querySelectorAll('.galaxy-label')]
        const archipelago = chips.find(chip => chip.dataset.world === 'archipelago')
        // A reproducible wide caption exercises the dock corner at the initial orbit position.
        shell.galaxyWorlds.find(world => world.id === 'archipelago').nameSeed = 54 // Zephsaquis Minor
        shell.refreshGalaxyLabels(true)
        galaxy.clockHold = true
        const draw = async time => {
          const frame = galaxy.frames
          galaxy.clock = time
          galaxy.refreshCaptions()
          while (galaxy.frames === frame) await new Promise(requestAnimationFrame)
        }
        await new Promise(requestAnimationFrame)
        await new Promise(requestAnimationFrame)
        const rows = []
        for (let t = 0; t <= 1200; t += 30) {
          await draw(t)
          const visible = galaxy.screen.filter(p => p.visible)
          const nearest = visible.reduce((a, b) => a.depth < b.depth ? a : b)
          const shown = chips.filter(chip => !chip.hidden && !chip.classList.contains('is-suppressed'))
          const blockers = [shell.lobbySettings.dock, shell.lobbySettings.version].map(el => el.getBoundingClientRect().toJSON())
          for (const chip of shown) {
            const place = visible.find(p => p.id === chip.dataset.world)
            const rect = chip.querySelector('.galaxy-caption-text').getBoundingClientRect()
            if (captionClearance(rect, place, visible, galaxy.sunScreen) < 0) throw Error(`Foreground crosses ${place.id} at ${t}s`)
          }
          const describe = place => {
            const chip = chips.find(c => c.dataset.world === place.id)
            const scale = Number(chip.style.getPropertyValue('--caption-scale'))
            const size = shell.chipSize.get(chip)
            const text = shell.chipSize.get(chip.firstElementChild)
            const scaled = { width: size.width * scale, height: size.height * scale }
            const top = place.y + place.radius + 5 * scale
            const nominal = captionBox(place, top, scaled, innerWidth, innerHeight)
            const adjusted = captionBox(place, top, scaled, innerWidth, innerHeight, blockers)
            const clear = adjusted && captionClearance({
              left: (adjusted.left + adjusted.right - text.width * scale) / 2,
              right: (adjusted.left + adjusted.right + text.width * scale) / 2,
              top: adjusted.top, bottom: adjusted.top + text.height * scale,
            }, place, visible, galaxy.sunScreen)
            const clearOfCaptions = adjusted && !captionBlocked(adjusted, shown.filter(c => c !== chip).map(c => c.getBoundingClientRect()), 2)
            return {
              id: place.id, name: chip.querySelector('strong').textContent,
              planet: place, nominal, oldDockBlocked: !!nominal && captionBlocked(nominal, blockers), adjusted,
              clearOfForeground: clear > 1, clearOfCaptions,
              shown: shown.includes(chip), actual: shown.includes(chip) ? chip.getBoundingClientRect().toJSON() : null,
              opacity: Number(getComputedStyle(chip).opacity),
            }
          }
          const closest = describe(nearest)
          if (closest.clearOfForeground && closest.clearOfCaptions && !closest.shown) throw Error(`Nearest caption ${nearest.id} missing in free space at ${t}s`)
          rows.push({ orbitSeconds: t, closest, archipelago: describe(visible.find(p => p.id === 'archipelago')) })
        }
        await draw(0)
        // Reconstruct one-pixel crossings of the actual dock corner from the measured caption.
        const p = galaxy.screen.find(place => place.id === 'archipelago')
        const dock = shell.lobbySettings.dock.getBoundingClientRect().toJSON()
        const scale = Number(archipelago.style.getPropertyValue('--caption-scale'))
        const size = shell.chipSize.get(archipelago)
        const scaled = { width: size.width * scale, height: size.height * scale }
        const crossing = dock.top - 8 - scaled.height
        const atCorner = { ...p, x: dock.left - scaled.width / 2 + 12 }
        const dockCorner = []
        for (let dy = -30; dy <= 5; dy++) {
          galaxy.options.onLayout(galaxy.screen.map(place => place === p
            ? { ...atCorner, y: crossing + dy - p.radius - 5 * scale }
            : place))
          const drawn = archipelago.getBoundingClientRect()
          dockCorner.push({ dy, left: drawn.left, top: drawn.top, shown: !archipelago.classList.contains('is-suppressed') })
        }
        await draw(0)
        return { orbit: rows, dockCorner }
      })
      await writeFile(`${out}/${name}-trace.json`, JSON.stringify(trace, null, 2) + '\n')
      assert.ok(trace.orbit[0].archipelago.shown, `${name}: the settled archipelago caption is shown`)
      if (name === 'desktop-1280') assert.ok(trace.orbit[0].archipelago.oldDockBlocked, 'the wide caption reproduces the old dock rejection')
      assert.ok(trace.orbit.filter(row => row.closest.shown).length > 1, `${name}: nearest captions are shown through the orbit`)
      for (const [i, row] of trace.dockCorner.entries()) {
        const prior = trace.dockCorner[i - 1]
        assert.ok(row.shown, `${name}: caption stays visible while passing the dock corner`)
        if (prior?.shown) assert.ok(Math.abs(row.left - prior.left) < 4, `${name}: no horizontal jump at the dock corner`)
      }
    }
    const resting = await measure()
    check(resting)
    await page.waitForTimeout(400)
    const later = await measure()
    check(later)
    if (reducedMotion === 'reduce') assert.deepEqual(later, resting, `${name}: captions hold with reduced motion`)
    await page.screenshot({ path: `${out}/check-${name}.png` })

    // Intercept the shared world activation so both real input routes can run in the same lobby.
    const target = await page.evaluate(() => {
      const galaxy = window.mira.shell.galaxy
      galaxy.clockHold = true
      window.captionPicks = []
      galaxy.options.onTap = id => { window.captionPicks.push(id); return true }
      const inside = (p, x, y) => Math.hypot(p.x - x, p.y - y) < p.radius
      for (const p of galaxy.screen) {
        const chip = document.querySelector(`.galaxy-label[data-world="${p.id}"]`)
        if (!p.visible || getComputedStyle(chip).pointerEvents !== 'auto') continue
        const box = chip.getBoundingClientRect(), x = box.x + box.width / 2, y = box.y + box.height / 2
        if (document.elementFromPoint(x, y)?.closest('.galaxy-label') !== chip ||
            !document.elementFromPoint(p.x, p.y)?.matches('.galaxy-canvas')) continue
        const inFront = [...galaxy.screen.filter(s => s.visible), galaxy.sunScreen].filter(s => s.depth < p.depth)
        if (inFront.some(s => inside(s, x, y) || inside(s, p.x, p.y))) continue
        return { id: p.id, caption: { x, y }, globe: { x: p.x, y: p.y } }
      }
    })
    assert.ok(target, `${name}: a caption and its globe are both reachable`)
    const tap = ({ x, y }) => phone ? page.touchscreen.tap(x, y) : page.mouse.click(x, y)
    const picks = () => page.evaluate(() => window.captionPicks)
    await tap(target.caption)
    assert.deepEqual(await picks(), [target.id], `${name}: tap activates its caption exactly once`)
    await tap(target.globe)
    assert.deepEqual(await picks(), [target.id, target.id], `${name}: globe activates the same world`)
    await page.locator(`.galaxy-label[data-world="${target.id}"]`).press('Enter')
    assert.deepEqual(await picks(), Array(3).fill(target.id), `${name}: keyboard activates the caption`)
    await page.evaluate(() => document.activeElement.blur())

    // Dragging from text still pans the scene and does not select the caption.
    const cdp = phone ? await context.newCDPSession(page) : null
    const start = await page.evaluate(id => {
      const galaxy = window.mira.shell.galaxy
      const chip = document.querySelector(`.galaxy-label[data-world="${id}"]`)
      const box = chip.getBoundingClientRect(), x = box.x + box.width / 2, y = box.y + box.height / 2
      return { x, y, yaw: galaxy.yaw, onCaption: document.elementFromPoint(x, y)?.closest('.galaxy-label') === chip }
    }, target.id)
    assert.ok(start.onCaption, `${name}: the drag starts on a caption`)
    const from = { x: start.x, y: start.y }
    if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
    else { await page.mouse.move(from.x, from.y); await page.mouse.down() }
    for (let step = 1; step <= 5; step++) {
      const at = { x: from.x + step * (from.x > width / 2 ? -12 : 12), y: from.y }
      if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at] })
      else await page.mouse.move(at.x, at.y)
      await page.waitForTimeout(80)
      check(await measure())
    }
    if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    else await page.mouse.up()
    assert.deepEqual(await picks(), Array(3).fill(target.id), `${name}: dragging selects nothing`)
    await page.waitForFunction(yaw => Math.abs(window.mira.shell.galaxy.yaw - yaw) > 0.02, start.yaw, { timeout: 5000 })

    await page.evaluate(() => {
      for (const chip of document.querySelectorAll('.galaxy-label.is-suppressed')) {
        if (chip.tabIndex >= 0 || getComputedStyle(chip).pointerEvents !== 'none') throw Error('A suppressed caption can take focus or a pointer')
      }
    })
    const settings = page.locator('.lobby-gear-dock .lobby-gear')
    if (phone) await settings.tap()
    else await settings.click()
    await page.locator('#lobby-settings').waitFor({ state: 'visible' })
    assert.deepEqual(await picks(), Array(3).fill(target.id), `${name}: the Settings dock takes its own tap`)

    assert.deepEqual(errors, [])
    console.log(`${name}: caption bounds, caption/globe/keyboard activation, and drag PASS`)
    await context.close()
  }
} finally { await browser.close() }
