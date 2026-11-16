// Touch aiming and handedness on an iPhone 14, portrait and landscape, in WebKit.
//   SYN3H_URL=http://127.0.0.1:5213/ node tests/ui/touch-aim.mjs
// Serve the game first (see tests/ui/run-touch-stick.sh). Drags are synthetic PointerEvents sent
// to the element under the point, as tests/ui/touch-stick.mjs does: WebKit automation has no
// multi-touch drag. Screenshots of both hands in both orientations go to tests/ui/artifacts/touch-aim.
import { webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5213/'
const out = 'tests/ui/artifacts/touch-aim'
await mkdir(out, { recursive: true })
const browser = await webkit.launch()
const centre = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })

try {
  for (const [name, device] of [['portrait', 'iPhone 14'], ['landscape', 'iPhone 14 landscape']]) {
    const context = await browser.newContext({ ...devices[device] })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${base}?autoplay=1&room=touch-aim-${name}-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    if (await page.locator('.world-inspector').isVisible()) await page.locator('.inspector-toggle').tap()
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
      const actions = await page.locator('.touch-actions').boundingBox(), map = await page.locator('.shell-minimap').boundingBox()
      // Buttons sit on the aiming side, the minimap on the driving side.
      const buttonsRight = actions.x + actions.width / 2 > width / 2
      assert.equal(buttonsRight, hand === 'right', `${hand}: buttons on the ${hand === 'right' ? 'right' : 'left'}`)
      assert.equal(map.x + map.width / 2 < width / 2, hand === 'right', `${hand}: minimap above the stick`)
      const tab = await page.locator('.inspector-toggle').boundingBox()
      assert.ok(map.x + map.width <= tab.x || map.y + map.height <= tab.y || map.y >= tab.y + tab.height, `${hand}: minimap clears the Panels tab ${JSON.stringify([map, tab])}`)

      // Points on the game view: the stick finger low on the driving side, the aim finger above the buttons.
      const driveX = hand === 'right' ? width * 0.25 : width * 0.75, aimX = hand === 'right' ? width * 0.8 : width * 0.2
      const driveY = Math.min(height - 40, map.y + map.height + 60), aimY = Math.max(40, actions.y - 60)
      for (const [x, y] of [[driveX, driveY], [aimX, aimY]]) assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [x, y]), 'game', `${hand}: ${x},${y} is game view`)

      // Steer and aim at once: finger 1 drives forward and right, finger 2 drags 120 px toward the middle.
      const before = await state()
      await touch('pointerdown', 1, driveX, driveY); await touch('pointermove', 1, driveX + 30, driveY - 40)
      await touch('pointerdown', 2, aimX, aimY)
      const dir = hand === 'right' ? -1 : 1
      for (let i = 1; i <= 6; i++) await touch('pointermove', 2, aimX + dir * i * 20, aimY)
      let s = await state()
      assert.ok(s.x > 0.3 && s.y > 0.3, `${hand}: stick steers while aiming ${JSON.stringify(s)}`)
      const turned = (s.yaw - before.yaw) * 180 / Math.PI
      // Mouse convention: a drag to the right turns the view right (yaw falls).
      assert.ok(turned * dir < -20, `${hand}: the camera turns with the drag (${turned.toFixed(1)} deg)`)
      await page.waitForTimeout(150)
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
} finally {
  await browser.close()
}
