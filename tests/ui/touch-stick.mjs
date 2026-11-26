// The floating thumb stick, in WebKit on a phone, a phone on its side and a tablet. Bugs caught:
// the stick not appearing under the thumb, not driving, or the page or console erroring on a phone.
//   /Users/vtn/dev/Syn3h/tools/heavy.sh node tools/browser-checks.mjs touch-stick
// (It needs a room server: without one the page logs failed WebSocket connections, which this
// counts as errors. tests/ui/run-touch-stick.sh served it without one and ran the wrong file.)
//
// Drags are synthetic PointerEvents dispatched in the page (Playwright's WebKit has no touch
// drag), sent to whatever element is under the point as a real touch would be. Taps are also
// made with the real page.touchscreen, which goes through WebKit's own touch handling.
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { serverUrl } from './lib/server.mjs'

const base = serverUrl('touch-stick')
const out = 'tests/ui/artifacts/touch-stick'
await mkdir(out, { recursive: true })
const views = [['phone', 'iPhone 14'], ['landscape', 'iPhone 14 landscape'], ['tablet', 'iPad (gen 7)']]
const browser = await webkit.launch()
const near = (a, b, tolerance, message) => assert.ok(Math.abs(a - b) <= tolerance, `${message}: ${a} vs ${b}`)
const overlaps = (a, b) => a.x < b.x + b.width - 1 && a.x + a.width > b.x + 1 && a.y < b.y + b.height - 1 && a.y + a.height > b.y + 1

try {
  for (const [name, device] of views) {
    const context = await browser.newContext({ ...devices[device] })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(`page: ${error.message}`))
    page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`) })
    await page.goto(`${base}?autoplay=1&room=touch-stick-${name}-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 90000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 90000 })
    if (await page.locator('.world-inspector').isVisible()) await page.locator('.inspector-toggle').tap()
    await page.locator('.world-inspector').waitFor({ state: 'hidden' })
    await page.locator('.touch-controls').waitFor({ state: 'visible' })
    const { width, height } = page.viewportSize()

    // Helpers in the page: a touch pointer sent to the element under the point, and the input.
    const dragThreshold = await page.evaluate(async () => {
      const { DRAG_THRESHOLD, stickRadius } = await import('/src/ui/TouchControls.ts')
      const targets = new Map()
      window.__touch = (type, id, x, y) => {
        if (type === 'pointerdown') targets.set(id, document.elementFromPoint(x, y))
        const target = targets.get(id) ?? document.body
        if (type === 'pointerup' || type === 'pointercancel') targets.delete(id)
        // WebKit automation cannot register a native multi-touch drag. Keep normal capture
        // for real taps; synthetic IDs need this narrow shim to exercise button handlers.
        const capture = target.setPointerCapture
        target.setPointerCapture = function(id) { try { capture.call(this, id) } catch (error) { if (error.name !== 'NotFoundError') throw error } }
        try { target.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1, bubbles: true, cancelable: true, composed: true })) } finally { target.setPointerCapture = capture }
      }
      window.__stick = () => {
        const el = document.querySelector('.touch-stick'), r = el.getBoundingClientRect(), s = window.mira.game.input.poll()
        return { active: el.classList.contains('is-active'), visible: getComputedStyle(el).visibility === 'visible', cx: r.left + r.width / 2, cy: r.top + r.height / 2, radius: stickRadius(el.offsetWidth), x: s.x, y: s.y, ex: window.mira.game.input.external.x ?? 0, ey: window.mira.game.input.external.y ?? 0, beam: window.mira.game.input.mouseFire }
      }
      return DRAG_THRESHOLD
    })
    const touch = (type, id, x, y) => page.evaluate(([type, id, x, y]) => window.__touch(type, id, x, y), [type, id, x, y])
    const stick = () => page.evaluate(() => window.__stick())

    // No permanent stick; the first-run hint is there, clear of the minimap and the buttons.
    let state = await stick()
    assert.equal(state.visible, false, 'no stick on screen before a drag')
    // The hint steps aside while the shell's spawn card is up, then shows until the first drag.
    const hint = page.locator('.touch-stick-hint')
    await hint.waitFor({ state: 'visible', timeout: 20000 })
    await page.waitForTimeout(400)
    assert.ok((await hint.innerText()).trim(), 'the first-run hint has instructions')
    const hintBox = await hint.boundingBox(), map = await page.locator('.shell-minimap').boundingBox()
    assert.ok(hintBox.x >= 0 && hintBox.y >= 0 && hintBox.x + hintBox.width <= width && hintBox.y + hintBox.height <= height, 'hint on screen')
    assert.ok(!overlaps(hintBox, map), `hint clears the minimap ${JSON.stringify([hintBox, map])}`)
    for (const button of await page.locator('.touch-actions button:visible').all()) assert.ok(!overlaps(hintBox, await button.boundingBox()), 'hint clears the touch buttons')
    await page.screenshot({ path: `${out}/${name}-first-run.png` })

    // A point in the drive region on the game view, clear of the minimap.
    const ox = Math.round(width * 0.3), oy = Math.round(map.y > height * 0.5 ? map.y * 0.6 : height * 0.6)
    assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [ox, oy]), 'game', 'drag starts on the game canvas')

    // Under the drag threshold nothing happens; past it the base appears where the touch went down.
    await touch('pointerdown', 1, ox, oy)
    const wobble = dragThreshold / 2
    await touch('pointermove', 1, ox + wobble, oy)
    state = await stick()
    assert.equal(state.active, false, 'a sub-threshold wobble is still a tap'); assert.equal(state.ex, 0)
    await touch('pointermove', 1, ox + Math.max(state.radius, dragThreshold + 1), oy)
    state = await stick()
    assert.equal(state.active, true, 'a drag makes a stick')
    near(state.cx, ox, 1, 'stick centred on touch-down x'); near(state.cy, oy, 1, 'stick centred on touch-down y')
    const radius = state.radius
    assert.ok(state.x > 0 && state.x <= 1, 'a right drag steers right'); assert.equal(state.y, 0, 'no throttle on a sideways drag')
    assert.equal(state.beam, false, 'a drive drag does not hold the tag beam')
    assert.equal(await hint.isVisible(), false, 'hint goes after the first drag')
    assert.equal(await page.evaluate(() => localStorage.getItem('mira.touch.driven')), '1')
    // Up is forward; down and left steer back and left.
    await touch('pointermove', 1, ox, oy - radius * 0.5)
    state = await stick(); assert.ok(state.y > 0, 'an upward drag drives forward'); assert.equal(state.x, 0, 'no steer on a vertical drag')
    await touch('pointermove', 1, ox - radius * 0.6, oy + radius * 0.8)
    state = await stick(); assert.ok(state.x < 0 && state.y < 0, 'a down-left drag drives back and left')
    await page.screenshot({ path: `${out}/${name}-mid-drag.png` })

    // A second finger in the region while the stick is held is ignored by the stick.
    await touch('pointerdown', 2, ox - 30, oy - 40)
    await touch('pointermove', 2, ox + 60, oy - 40)
    const second = await stick()
    near(second.cx, ox, 1, 'second finger does not move the base')
    assert.deepEqual([second.x, second.y], [state.x, state.y], 'second finger does not alter the drive input')
    await touch('pointerup', 2, ox + 60, oy - 40)
    assert.equal((await stick()).active, true, 'second finger lifting leaves the stick')

    // Dragging well past the base and outside the start region keeps steering.
    await touch('pointermove', 1, ox + radius * 3, oy)
    state = await stick()
    assert.ok(state.x > 0 && state.x <= 1, 'continued steering stays within the input range')
    assert.equal(state.y, 0, 'still level')
    near(state.cx, ox, 1, 'base stays anchored beyond radius'); near(state.cy, oy, 1, 'base y stays anchored')
    await page.screenshot({ path: `${out}/${name}-past-edge.png` })
    await touch('pointermove', 1, width * .9, oy)
    state = await stick(); near(state.cx, ox, 1, 'crossing the left region keeps the anchor'); assert.ok(state.x > 0, 'the drag still steers outside its start region')
    await touch('pointermove', 1, ox, oy)
    state = await stick(); assert.deepEqual([state.x, state.y], [0, 0], 'returning to the original centre releases the drive input')
    const brake = await page.locator('[data-action=brakes]').boundingBox()
    await touch('pointermove', 1, brake.x + brake.width / 2, brake.y + brake.height / 2)
    state = await stick(); near(state.cx, ox, 1, 'crossing a button keeps the base'); assert.equal(await page.evaluate(() => mira.game.input.external.brakes ?? false), false, 'sliding onto brake does not press it')

    await touch('pointerdown', 11, brake.x + brake.width / 2, brake.y + brake.height / 2)
    assert.equal(await page.evaluate(() => mira.game.input.external.brakes), true, 'second finger can hold brake while steering')
    near((await stick()).cx, ox, 1, 'button finger cannot move anchor')
    await touch('pointerup', 11, brake.x + brake.width / 2, brake.y + brake.height / 2)
    assert.equal((await stick()).active, true, 'button release leaves driving finger active')

    // Release: input zero at once, the stick fades out.
    await touch('pointerup', 1, ox + radius * 3, oy)
    state = await stick()
    assert.equal(state.active, false); assert.equal(state.ex, 0); assert.equal(state.ey, 0); assert.equal(state.x, 0)
    await page.locator('.touch-stick').waitFor({ state: 'hidden' })

    // pointercancel, window blur and a hidden page each let go.
    const midDrag = async (id) => { await touch('pointerdown', id, ox, oy); await touch('pointermove', id, ox, oy - Math.max(radius, dragThreshold + 1)); const s = await stick(); assert.ok(s.active && s.y > 0, 'driving') }
    await midDrag(3); await touch('pointercancel', 3, ox, oy - radius)
    state = await stick(); assert.equal(state.active, false); assert.equal(state.y, 0, 'pointercancel zeroes input')
    await midDrag(4); await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    state = await stick(); assert.equal(state.active, false); assert.equal(state.y, 0, 'blur zeroes input')
    await touch('pointermove', 4, ox, oy - radius * 2); assert.equal((await stick()).y, 0, 'a released finger cannot steer')
    await touch('pointerup', 4, ox, oy - radius * 2)
    await midDrag(5)
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')) })
    state = await stick(); assert.equal(state.active, false); assert.equal(state.y, 0, 'hidden page zeroes input')
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')) })
    await touch('pointerup', 5, ox, oy - radius)

    // A tap on the canvas in the region makes no stick, synthetic and real (after the fade).
    await page.locator('.touch-stick').waitFor({ state: 'hidden' })
    await touch('pointerdown', 6, ox, oy); await touch('pointermove', 6, ox + wobble, oy); await touch('pointerup', 6, ox + wobble, oy)
    assert.equal((await stick()).visible, false, 'synthetic tap makes no stick')
    await page.touchscreen.tap(ox, oy)
    state = await stick(); assert.equal(state.active, false, 'real tap makes no stick'); assert.equal(state.x, 0); assert.equal(state.y, 0)

    // A button in the drive region still gets its tap, and a drag that starts on it is no stick.
    await page.evaluate(([x, y]) => {
      const button = document.createElement('button'); button.id = 'stick-probe'; button.textContent = 'probe'; button.dataset.clicks = '0'
      Object.assign(button.style, { position: 'fixed', left: `${x - 30}px`, top: `${y - 20}px`, width: '60px', height: '40px', zIndex: 40 })
      button.addEventListener('click', () => { button.dataset.clicks = String(Number(button.dataset.clicks) + 1) })
      document.body.append(button)
    }, [ox, oy])
    await page.touchscreen.tap(ox, oy)
    assert.equal(await page.locator('#stick-probe').getAttribute('data-clicks'), '1', 'real tap reaches the button under it')
    await touch('pointerdown', 7, ox, oy); await touch('pointermove', 7, ox + 40, oy)
    state = await stick(); assert.equal(state.active, false, 'drag from a button is no stick'); assert.equal(state.x, 0)
    await touch('pointerup', 7, ox + 40, oy)
    await page.evaluate(() => document.querySelector('#stick-probe').remove())

    // A drag that starts on the minimap, which sits in the stick's corner, is a stick (the
    // owner, 17 November 2026): the map takes no touches.
    await touch('pointerdown', 8, map.x + map.width / 2, map.y + map.height / 2); await touch('pointermove', 8, map.x + map.width / 2 + 40, map.y + map.height / 2)
    assert.equal((await stick()).active, true, 'a stick from the minimap'); await touch('pointerup', 8, map.x + map.width / 2 + 40, map.y + map.height / 2)
    // Nor one that starts on the right side.
    await touch('pointerdown', 9, width * 0.7, oy); await touch('pointermove', 9, width * 0.7 - 40, oy)
    assert.equal((await stick()).active, false, 'no stick from the right side'); await touch('pointerup', 9, width * 0.7 - 40, oy)
    await page.evaluate(() => { window.mira.game.input.mouseFire = false })

    // Rotation ends the old gesture instead of relocating its base or leaving input held.
    await midDrag(10)
    await page.setViewportSize({ width: height, height: width })
    await page.waitForTimeout(100)
    state = await stick(); assert.equal(state.active, false); assert.equal(state.ex, 0); assert.equal(state.ey, 0)
    await touch('pointermove', 10, ox + 30, oy)
    assert.equal((await stick()).active, false, 'old finger cannot restart after rotation')
    await touch('pointerup', 10, ox + 30, oy)
    await page.setViewportSize({ width, height }); await page.waitForTimeout(100)

    // Once driven, never again on this device.
    await page.reload()
    await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 90000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 90000 })
    await page.locator('.touch-controls').waitFor({ state: 'visible' })
    assert.equal(await page.locator('.touch-stick-hint').isVisible(), false, 'hint stays away after a reload')
    assert.equal(await page.locator('.touch-stick').evaluate(el => getComputedStyle(el).visibility), 'hidden', 'still no permanent stick')

    assert.deepEqual(errors, [], `no page or console errors in ${name}`)
    console.log(`touch stick ok: ${name} ${width}x${height}, radius ${radius.toFixed(1)} px`)
    await context.close()
  }
} finally {
  await browser.close()
}
