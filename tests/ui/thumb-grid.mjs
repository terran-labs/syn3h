// The touch thumb grid and the Tag aim stick on an iPhone 14, portrait and landscape, in WebKit.
//
//   MIRA_URL=http://127.0.0.1:5291/ node tests/ui/thumb-grid.mjs <out dir> <label> [--layout-only]
//
// For every vehicle and both hands it captures the play screen and checks the thumb grid rule
// (tests/ui/thumbGrid.mjs), with the Grapple's two extra buttons shown as well. Without
// --layout-only it then plays the Tag stick with synthetic PointerEvents, as touch-aim.mjs does
// (WebKit automation has no multi-touch drag): the reticle, a held Chaser sent on the lift, a
// cancelled one, Plasma Tag streaming, and a pinch in the orbit camera. `--layout-only` is for
// capturing a build from before this change, whose Tag is a plain button.
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { thumbGrid } from './thumbGrid.mjs'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5291/'
const out = process.argv[2] ?? 'tests/ui/artifacts/thumb-grid'
const label = process.argv[3] ?? 'new'
const layoutOnly = process.argv.includes('--layout-only')
await mkdir(out, { recursive: true })
const browser = await webkit.launch()
const centre = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
const failures = []
const check = (ok, message) => { if (!ok) { failures.push(message); console.log(`FAIL ${message}`) } }

async function open(context, vehicle, orient) {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${base}?autoplay=1&vehicle=${vehicle}&room=thumb-${label}-${orient}-${vehicle}-${Date.now()}`)
  await page.waitForFunction(() => window.mira?.game.tick > 30 && window.miraNet?.gear, null, { timeout: 120000 })
  await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
  if (await page.locator('.world-inspector').isVisible()) await page.locator('.panels-close').tap()
  await page.locator('.world-inspector').waitFor({ state: 'hidden' })
  await page.locator('.touch-controls').waitFor({ state: 'visible' })
  // Toasts and the first-run cards fade; give them time so the captures show the controls alone.
  await page.waitForTimeout(2500)
  await page.evaluate(() => {
    const targets = new Map()
    window.__touch = (type, id, x, y) => {
      if (type === 'pointerdown') targets.set(id, document.elementFromPoint(x, y))
      let target = targets.get(id) ?? document.body
      // Pointer capture retargets moves and the lift to the capturing element, as a real touch does.
      const captured = [...document.querySelectorAll('button, .touch-stick, canvas')].find((el) => el.hasPointerCapture?.(id))
      if (captured && type !== 'pointerdown') target = captured
      if (type === 'pointerup' || type === 'pointercancel') targets.delete(id)
      const capture = target.setPointerCapture
      target.setPointerCapture = function (pid) { try { capture.call(this, pid) } catch (error) { if (error.name !== 'NotFoundError') throw error } }
      try { target.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, composed: true })) } finally { target.setPointerCapture = capture }
    }
    // What the gear saw each frame: Input.poll's fire, recorded after every poll.
    const input = window.mira.game.input, poll = input.poll.bind(input)
    window.__fires = []
    input.poll = () => { const s = poll(); window.__fires.push(s.fire ? 1 : 0); return s }
  })
  return { page, errors }
}

/** Show the Grapple with a cord attached, so its LET OUT and LET GO buttons are on screen. */
const grappleAttached = (page) => page.evaluate(() => {
  const rack = window.miraNet.gear
  rack.select('bungee')
  const real = rack.controls()
  const noop = () => {}
  const fake = Object.freeze({ ...real, gear: 'bungee', state: 'ground', status: 'Cord 24 m', actions: Object.freeze([
    { id: 'reelIn', label: 'Reel in', keys: [], hold: true, start: noop, stop: noop },
    { id: 'payOut', label: 'Let out', keys: [], hold: true, start: noop, stop: noop },
    { id: 'release', label: 'Let go', keys: [], hold: false, start: noop },
  ]) })
  rack.__realControls = rack.controls
  rack.controls = () => fake
})
const grappleDetached = (page) => page.evaluate(() => { const rack = window.miraNet.gear; if (rack.__realControls) rack.controls = rack.__realControls; rack.select('beam') })

try {
  for (const [orient, device] of [['portrait', 'iPhone 14'], ['landscape', 'iPhone 14 landscape']]) {
    const context = await browser.newContext({ ...devices[device] })
    for (const vehicle of ['buggy', 'tank', 'hovercraft', 'jet']) {
      const { page, errors } = await open(context, vehicle, orient)
      for (const hand of ['right', 'left']) {
        await page.evaluate((left) => window.mira.params.set('touch.leftHanded', left), hand === 'left')
        await page.waitForTimeout(200)
        await page.screenshot({ path: `${out}/${label}-${orient}-${vehicle}-${hand}.png` })
        if (!layoutOnly) { const grid = await page.evaluate(thumbGrid); check(grid.length === 0, `${orient} ${vehicle} ${hand}: ${grid.join('; ')}`) }
        if (vehicle === 'buggy' || vehicle === 'jet') {
          await grappleAttached(page); await page.waitForTimeout(250)
          await page.screenshot({ path: `${out}/${label}-${orient}-${vehicle}-${hand}-grapple.png` })
          if (!layoutOnly) { const grid = await page.evaluate(thumbGrid); check(grid.length === 0, `${orient} ${vehicle} ${hand} grapple: ${grid.join('; ')}`) }
          await grappleDetached(page); await page.waitForTimeout(150)
        }
      }
      await page.evaluate(() => window.mira.params.set('touch.leftHanded', false))
      if (!layoutOnly && vehicle === 'buggy') await play(page, orient)
      check(errors.length === 0, `${orient} ${vehicle}: page errors ${JSON.stringify(errors)}`)
      await page.close()
    }
    await context.close()
  }
} finally {
  await browser.close()
}

/** The Tag stick, the reticle, Cancel, streaming and the pinch, with synthetic touches. */
async function play(page, orient) {
  const touch = (type, id, x, y) => page.evaluate((a) => window.__touch(...a), [type, id, x, y])
  const reticle = () => page.evaluate(() => {
    const g = [...document.querySelectorAll('.focus-hud svg [data-reticle]')].find((el) => getComputedStyle(el).display !== 'none')
    return g ? Number(getComputedStyle(g).opacity) : -1
  })
  const yaw = () => page.evaluate(() => window.mira.camera.yaw)
  const fires = () => page.evaluate(() => window.__fires.splice(0))
  const tag = centre(await page.locator('.touch-actions [data-action=fire]').boundingBox())
  const { width } = page.viewportSize()

  // Hidden on touch until Tag is pressed.
  check(await reticle() === 0, `${orient}: reticle hidden before Tag (${await reticle()})`)

  // Chaser: hold and drag aims, nothing is sent until the lift, then one press.
  await page.evaluate(() => window.miraNet.gear.select('pester'))
  await page.waitForTimeout(100); await fires()
  const yaw0 = await yaw()
  await touch('pointerdown', 7, tag.x, tag.y)
  await page.waitForTimeout(120)
  check(await reticle() > 0.9, `${orient}: reticle shown while Tag is held`)
  await page.screenshot({ path: `${out}/${label}-${orient}-strip-1-press.png` })
  const path = [[-20, -10], [-45, -22], [-60, -28], [-60, -28]]
  for (const [i, [dx, dy]] of path.entries()) {
    await touch('pointermove', 7, tag.x + dx, tag.y + dy); await page.waitForTimeout(160)
    await page.screenshot({ path: `${out}/${label}-${orient}-strip-${i + 2}-aim.png` })
  }
  check(await yaw() > yaw0 + 0.05, `${orient}: dragging Tag left turns the view left (${(((await yaw()) - yaw0) * 180 / Math.PI).toFixed(1)} deg)`)
  check((await fires()).every((f) => !f), `${orient}: a Chaser is not sent while Tag is held`)
  await touch('pointerup', 7, tag.x - 60, tag.y - 28)
  await page.waitForTimeout(40)
  await page.screenshot({ path: `${out}/${label}-${orient}-strip-6-release.png` })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${out}/${label}-${orient}-strip-7-after.png` })
  const sent = await fires()
  check(sent.filter((f, i) => f && !sent[i - 1]).length === 1, `${orient}: exactly one press on the lift (${sent.join('')})`)
  check(await reticle() === 0, `${orient}: reticle gone after the fade`)

  // Cancel: drag onto the ring and lift; nothing is sent.
  await touch('pointerdown', 8, tag.x, tag.y)
  await touch('pointermove', 8, tag.x + 20, tag.y - 20)
  const ring = await page.locator('.touch-cancel').boundingBox()
  const at = centre(ring)
  await touch('pointermove', 8, at.x, at.y); await page.waitForTimeout(150)
  check(await page.locator('.touch-cancel.is-armed').count() === 1, `${orient}: Cancel lights under the thumb`)
  check(ring.x >= 0 && ring.y >= 0 && ring.x + ring.width <= width, `${orient}: Cancel ring on screen ${JSON.stringify(ring)}`)
  await page.screenshot({ path: `${out}/${label}-${orient}-cancel.png` })
  await fires()
  await touch('pointerup', 8, at.x, at.y); await page.waitForTimeout(250)
  check((await fires()).every((f) => !f), `${orient}: a cancelled Chaser is not sent`)

  // Plasma Tag streams from the first touch, without dragging, and stops on the lift.
  await page.evaluate(() => window.miraNet.gear.select('beam'))
  await page.waitForTimeout(100); await fires()
  // Discard the frame polled before the synthetic press arrived, then sample while it is held.
  await touch('pointerdown', 9, tag.x, tag.y); await page.waitForTimeout(100); await fires(); await page.waitForTimeout(400)
  await page.screenshot({ path: `${out}/${label}-${orient}-reticle-beam.png` })
  const held = await fires()
  check(held.length > 5 && held.every((f) => f), `${orient}: Plasma Tag fires every frame Tag is held (${held.join('')})`)
  await touch('pointerup', 9, tag.x, tag.y); await page.waitForTimeout(200); await fires()
  await page.waitForTimeout(200)
  check((await fires()).every((f) => !f), `${orient}: Plasma Tag stops on the lift`)

  // Drive and aim at once, and Brake with a third finger while Tag is held.
  const driveX = width * 0.2, driveY = page.viewportSize().height - 110
  await touch('pointerdown', 1, driveX, driveY); await touch('pointermove', 1, driveX + 20, driveY - 40)
  await touch('pointerdown', 2, tag.x, tag.y); await touch('pointermove', 2, tag.x - 40, tag.y)
  const brake = centre(await page.locator('.touch-actions [data-action=brakes]').boundingBox())
  await touch('pointerdown', 3, brake.x, brake.y)
  const both = await page.evaluate(() => ({ y: window.mira.game.input.external.y, brakes: window.mira.game.input.external.brakes, fire: window.mira.game.input.external.fire }))
  check(both.y > 0.3 && both.brakes && both.fire, `${orient}: drive, Tag and Brake together ${JSON.stringify(both)}`)
  for (const [id, x, y] of [[3, brake.x, brake.y], [2, tag.x - 40, tag.y], [1, driveX, driveY]]) await touch('pointerup', id, x, y)

  // Pinch in the orbit camera, on the free right side: spreading zooms in, within the limits.
  await page.evaluate(() => { window.mira.params.set('camera.mode', 2); window.mira.params.set('camera.distance', 10) })
  const free = [width * 0.78, 120]
  const dist = () => page.evaluate(() => window.mira.params.get('camera.distance').value)
  await touch('pointerdown', 4, free[0] - 20, free[1]); await touch('pointerdown', 5, free[0] + 20, free[1])
  for (let i = 1; i <= 6; i++) { await touch('pointermove', 4, free[0] - 20 - i * 10, free[1]); await touch('pointermove', 5, free[0] + 20 + i * 10, free[1]) }
  const zoomedIn = await dist()
  check(zoomedIn < 10 && zoomedIn >= 0, `${orient}: spreading zooms in (${zoomedIn})`)
  for (let i = 1; i <= 60; i++) { await touch('pointermove', 4, free[0] - 80 + i * 1, free[1]); await touch('pointermove', 5, free[0] + 80 - i * 1, free[1]) }
  const zoomedOut = await dist()
  check(zoomedOut > zoomedIn && zoomedOut <= 25, `${orient}: pinching zooms out within the limit (${zoomedOut})`)
  await touch('pointerup', 4, 0, 0); await touch('pointerup', 5, 0, 0)
  // A pinch where one finger began on a button is that button's: no zoom.
  const before = await dist()
  await touch('pointerdown', 6, brake.x, brake.y); await touch('pointerdown', 4, free[0], free[1])
  for (let i = 1; i <= 6; i++) { await touch('pointermove', 6, brake.x - i * 10, brake.y - i * 10); await touch('pointermove', 4, free[0] + i * 10, free[1]) }
  check(await dist() === before, `${orient}: no zoom when a button owns one finger`)
  await touch('pointerup', 6, 0, 0); await touch('pointerup', 4, 0, 0)
  await page.evaluate(() => { window.mira.params.set('camera.mode', 0); window.mira.params.set('camera.distance', 6.25) })
}

console.log(failures.length ? `${failures.length} failed` : 'thumb grid and Tag stick: ok')
if (failures.length) process.exitCode = 1
