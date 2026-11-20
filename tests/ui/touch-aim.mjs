// Touch aiming and handedness on an iPhone 14, portrait and landscape, in WebKit.
//   SYN3H_URL=http://127.0.0.1:5213/ node tests/ui/touch-aim.mjs
// Serve the game first (see tests/ui/run-touch-stick.sh). Drags are synthetic PointerEvents sent
// to the element under the point, as tests/ui/touch-stick.mjs does: WebKit automation has no
// multi-touch drag. Screenshots of both hands in both orientations go to tests/ui/artifacts/touch-aim.
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5213/'
const out = 'tests/ui/artifacts/touch-aim'
await mkdir(out, { recursive: true })
const browser = await webkit.launch()
const centre = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
const overlaps = (a, b) => a.x < b.x + b.width - 1 && a.x + a.width > b.x + 1 && a.y < b.y + b.height - 1 && a.y + a.height > b.y + 1

try {
  for (const [name, device] of [['portrait', 'iPhone 14'], ['landscape', 'iPhone 14 landscape']]) {
    const context = await browser.newContext({ ...devices[device] })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${base}?autoplay=1&room=touch-aim-${name}-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    if (await page.locator('.world-inspector').isVisible()) await page.locator('.panels-close').tap()
    await page.locator('.world-inspector').waitFor({ state: 'hidden' })
    await page.locator('.touch-controls').waitFor({ state: 'visible' })
    await page.evaluate(() => {
      const targets = new Map()
      window.__touch = (type, id, x, y) => {
        if (type === 'pointerdown') targets.set(id, document.elementFromPoint(x, y))
        const target = targets.get(id) ?? document.body
        if (type === 'pointerup') targets.delete(id)
        const capture = target.setPointerCapture
        target.setPointerCapture = function (id) { try { capture.call(this, id) } catch (error) { if (error.name !== 'NotFoundError') throw error } }
        try { target.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, composed: true })) } finally { target.setPointerCapture = capture }
      }
      window.__state = () => ({ yaw: window.syn3h.camera.yaw, x: window.syn3h.game.input.external.x ?? 0, y: window.syn3h.game.input.external.y ?? 0, brakes: window.syn3h.game.input.external.brakes ?? false })
    })
    const touch = (type, id, x, y) => page.evaluate((a) => window.__touch(...a), [type, id, x, y])
    const state = () => page.evaluate(() => window.__state())
    const { width, height } = page.viewportSize()

    for (const hand of ['right', 'left']) {
      await page.evaluate((left) => window.syn3h.params.set('touch.leftHanded', left), hand === 'left')
      assert.equal(await page.locator('.touch-controls').getAttribute('data-hand'), hand)
      await page.waitForTimeout(100)
      const box = (selector) => page.locator(selector).first().boundingBox()
      // What is drawn: the union of an element's visible text, not its (sometimes full width) box.
      const ink = (selector) => page.evaluate((selector) => {
        const root = document.querySelector(selector); if (!root) return null
        const rects = [...root.querySelectorAll('*'), root].filter((e) => !e.children.length && e.textContent.trim() && e.checkVisibility?.({ visibilityProperty: true, opacityProperty: true })).map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height)
        if (!rects.length) return null
        const x = Math.min(...rects.map((r) => r.left)), y = Math.min(...rects.map((r) => r.top))
        return { x, y, width: Math.max(...rects.map((r) => r.right)) - x, height: Math.max(...rects.map((r) => r.bottom)) - y }
      }, selector)
      const actions = await box('.touch-actions'), map = await box('.shell-minimap')
      assert.equal(actions.x + actions.width / 2 > width / 2, hand === 'right', `${hand}: buttons on the ${hand} side`)
      // The minimap is in the lower corner on the stick's side, as on desktop (the owner, 17
      // November 2026), clear of the centre third, the player's vehicle, the buttons and the HUD.
      // The stick may land on it.
      assert.ok(height - (map.y + map.height) <= 40 && (hand === 'right' ? map.x <= 40 : width - (map.x + map.width) <= 90), `${name} ${hand}: minimap in the lower ${hand === 'right' ? 'left' : 'right'} corner ${JSON.stringify(map)}`)
      const vehicle = await page.evaluate(() => {
        const { camera } = window.syn3h.game, v = camera.position.clone().copy(window.syn3h.player.object.position).project(camera)
        return { x: (v.x + 1) / 2 * innerWidth - 70, y: (1 - v.y) / 2 * innerHeight - 50, width: 140, height: 100 }
      })
      const clear = (other, what) => assert.ok(other && !overlaps(map, other), `${name} ${hand}: minimap clears ${what} ${JSON.stringify([map, other])}`)
      clear({ x: width / 3, y: height / 3, width: width / 3, height: height / 3 }, 'the centre third')
      clear(vehicle, 'the vehicle')
      clear(actions, 'the buttons')
      for (const [selector, what] of [['.gear-selector', 'the gear selector'], ['.inspector-toggle', 'the Panels tab'], ['.fh-top', 'the heading line'], ['.fh-left', 'the speed readout'], ['.fh-right', 'the height readout']]) {
        const other = await ink(selector)
        assert.ok(other, `${name} ${hand}: ${what} is on screen`)
        clear(other, what)
      }
      assert.ok(map.width >= 88, `${hand}: minimap stays readable (${map.width} px)`)

      // Points on the game view: the stick finger low on the driving side, where a thumb rests; the aim finger above the buttons.
      const driveX = hand === 'right' ? width * 0.25 : width * 0.75, aimX = hand === 'right' ? width * 0.8 : width * 0.2
      const driveY = height - 110, aimY = Math.max(40, actions.y - 60)
      for (const [x, y] of [[driveX, driveY], [aimX, aimY]]) assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [x, y]), 'game', `${hand}: ${x},${y} is game view`)

      // Steer and aim at once: finger 1 drives forward and right, finger 2 drags 120 px toward the middle.
      const before = await state()
      await touch('pointerdown', 1, driveX, driveY); await touch('pointermove', 1, driveX + 30, driveY - 40)
      // The stick stays clear of the speed and height readouts (it may cover the minimap).
      const base = await box('.touch-stick')
      for (const selector of ['.fh-left', '.fh-right']) { const other = await ink(selector); assert.ok(other, selector); assert.ok(!overlaps(base, other), `${name} ${hand}: stick clears ${selector} ${JSON.stringify([base, other])}`) }
      await touch('pointerdown', 2, aimX, aimY)
      const dir = hand === 'right' ? -1 : 1
      for (let i = 1; i <= 6; i++) await touch('pointermove', 2, aimX + dir * i * 20, aimY)
      let s = await state()
      assert.ok(s.x > 0.3 && s.y > 0.3, `${hand}: stick steers while aiming ${JSON.stringify(s)}`)
      const turned = (s.yaw - before.yaw) * 180 / Math.PI
      // Mouse convention: a drag to the right turns the view right (yaw falls).
      assert.ok(turned * dir < -20, `${hand}: the camera turns with the drag (${turned.toFixed(1)} deg)`)
      // A toast as long as a real one gets (a cut room name and a long player name) shows in one
      // line and covers nothing the player reads or touches.
      await page.evaluate(() => window.syn3h.shell.toast('Joined room touch-aim-…794854727 as Bartholomew'))
      await page.waitForTimeout(150)
      const toast = await box('.shell-toast')
      assert.ok(toast && toast.height < 32, `${name} ${hand}: toast is one line ${JSON.stringify(toast)}`)
      const covers = [['.shell-minimap', 'minimap'], ['.touch-actions', 'buttons'], ['.touch-stick', 'stick'], ['.inspector-toggle', 'Panels tab']]
      for (const [selector, what] of covers) { const other = await box(selector); assert.ok(!overlaps(toast, other), `${name} ${hand}: toast clears the ${what} ${JSON.stringify([toast, other])}`) }
      for (const [selector, what] of [['.gear-selector', 'gear selector'], ['.fh-top', 'heading'], ['.fh-left', 'speed readout'], ['.fh-right', 'height readout']]) {
        const other = await ink(selector); assert.ok(other, what); assert.ok(!overlaps(toast, other), `${name} ${hand}: toast clears the ${what} ${JSON.stringify([toast, other])}`)
      }
      await page.screenshot({ path: `${out}/${name}-${hand}-hand.png` })
      // The aiming finger does not move the stick, and the stick finger does not aim.
      const yaw = (await state()).yaw
      await touch('pointermove', 1, driveX - 30, driveY - 40)
      s = await state()
      assert.ok(s.x < -0.3, `${hand}: stick still steers`); assert.ok(Math.abs(s.yaw - yaw) < 0.05, `${hand}: steering does not aim`)
      await touch('pointerup', 2, aimX, aimY); await touch('pointerup', 1, driveX, driveY)
      assert.equal((await state()).x, 0, `${hand}: stick released`)

      // A finger that starts on a button never aims, even when it then drags.
      const brake = centre(await page.locator('[data-action=brakes]').boundingBox())
      const yaw0 = (await state()).yaw
      await touch('pointerdown', 3, brake.x, brake.y)
      for (let i = 1; i <= 5; i++) await touch('pointermove', 3, brake.x - i * 20, brake.y - i * 10)
      s = await state()
      assert.equal(s.brakes, true, `${hand}: brake held`); assert.ok(Math.abs(s.yaw - yaw0) < 0.05, `${hand}: a button finger does not aim`)
      await touch('pointerup', 3, brake.x - 100, brake.y - 50)
      assert.equal((await state()).brakes, false)
    }

    // The hand persists on this device; the hint names the side to drive on.
    await page.reload()
    await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 120000 })
    assert.equal(await page.locator('.touch-controls').getAttribute('data-hand'), 'left', 'left hand survives a reload')
    assert.match(await page.locator('.touch-stick-label').textContent(), /Drag on the right to drive/)
    // It is a Me card setting in the sidebar.
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    if (!(await page.locator('.world-inspector').isVisible())) await page.locator('.inspector-toggle').tap()
    assert.ok(await page.locator('.wi-cards > [data-section=you]').getByText('Left-handed touch', { exact: false }).count() > 0, 'setting listed in the Me card')
    await page.evaluate(() => window.syn3h.params.set('touch.leftHanded', false))

    assert.deepEqual(errors, [], `${name}: no page errors`)
    await context.close()
    console.log(`${name}: ok`)
  }
  // Desktop: a toast sits below the heading line, clear of it, the sidebar and the readouts.
  const desktop = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await desktop.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(`${base}?autoplay=1&room=touch-aim-desktop-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    // Toasts are hidden while the sidebar is open (exploration.css); clicking into the game closes it.
    if (await page.locator('.world-inspector').isVisible()) { await page.mouse.click(720, 650); await page.locator('.world-inspector').waitFor({ state: 'hidden' }) }
    await page.evaluate(() => window.syn3h.shell.toast('Joined room touch-aim-…794854727 as Bartholomew'))
    await page.waitForTimeout(400)
    const toast = await page.locator('.shell-toast').boundingBox()
    assert.ok(Number(await page.locator('.shell-toast').evaluate((e) => getComputedStyle(e).opacity)) > 0.5, 'desktop: toast visible')
    for (const selector of ['.fh-left', '.fh-right']) {
      const other = await page.locator(selector).first().boundingBox()
      assert.ok(!other || !overlaps(toast, other), `desktop: toast clears ${selector}`)
    }
    const heading = await page.locator('.fh-top').first().boundingBox()
    assert.ok(heading && !overlaps(toast, heading), `desktop: toast clears the heading line ${JSON.stringify([toast, heading])}`)
    const rail = page.locator('.world-inspector')
    if (await rail.isVisible()) assert.ok(!overlaps(toast, await rail.boundingBox()), 'desktop: toast clears the sidebar')
    console.log('desktop: ok')
    await page.screenshot({ path: `${out}/desktop-toast.png` })
  } finally { await desktop.close() }
} finally {
  await browser.close()
}
