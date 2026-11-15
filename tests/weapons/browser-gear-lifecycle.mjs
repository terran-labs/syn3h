/**
 * Gear lifecycle across worlds, in two real browsers. Run through tools/heavy.sh with
 * SYN3H_URL pointing at an isolated dev server.
 *
 * The owner's report: a Grapple anchored on one planet, then Exit world and a different
 * planet, and the cord still hung somewhere in the sky. Here player A anchors a Grapple
 * (the Bungee) to the ground while B watches, then:
 *   1. Exit world, then enter another planet from the galaxy: A has no cord and B sees it gone.
 *   2. Anchors again and the planet changes in place while playing (no Exit world): the same.
 */
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
const base = process.env.SYN3H_URL
if (!base) throw new Error('Set SYN3H_URL to the isolated lane preview')
const out = '/tmp/syn3h-gear-lifecycle/current'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = [], received = [], report = {}
const room = `gear-lifecycle-${Date.now()}`
let A
try {
  async function open(watch) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    page.on('pageerror', e => errors.push(e.message))
    if (watch) page.on('websocket', ws => ws.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string') return
      try { received.push(JSON.parse(payload)) } catch {}
    }))
    // Enter from the ordinary galaxy, as a player does.
    await page.goto(base, { waitUntil: 'load' })
    await page.waitForFunction(() => window.syn3h?.game.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false', null, { timeout: 120000 })
    await page.evaluate(room => { const input = document.querySelector('#shell-room'); input.value = room; input.dispatchEvent(new Event('input', { bubbles: true })) }, room)
    await page.locator('.galaxy-label[data-world="volcanic"]').dispatchEvent('click')
    await page.waitForFunction(() => window.syn3h?.shell.playing && !window.syn3h.game.input.suspended && window.syn3hNet?.connected, null, { timeout: 60000 })
    return page
  }
  A = await open(false)
  const B = await open(true)
  const idA = await A.evaluate(() => window.syn3hNet.id)
  await B.waitForFunction(id => window.syn3hNet.players.has(id), idA)
  console.log(`Both players in room ${room}; A is ${idA}`)

  /** A anchors a Grapple to the ground just ahead and below, and B sees the cord. */
  async function anchor() {
    await A.evaluate(() => {
      const s = window.syn3h, n = window.syn3hNet
      s.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      // Straight down and a little ahead: the ground under the vehicle, in any world.
      const q = s.player.object.quaternion, ahead = s.player.object.position.clone().set(0, 0, -1).applyQuaternion(q)
      return n.bungee.launch([ahead.x * 0.3, -1, ahead.z * 0.3])
    })
    await A.waitForFunction(() => window.syn3hNet.bungee.attached, null, { timeout: 10000 })
    const cord = await A.evaluate(() => { const c = window.syn3hNet.bungee.mine; return { to: c.to, at: c.at && [c.at.x, c.at.y, c.at.z], rest: c.rest } })
    assert.equal(cord.to, null, 'The Grapple must anchor to the ground, not a vehicle')
    await B.waitForFunction(id => { const c = window.syn3hNet.bungee.cords.get(id); return c && !c.hook && c.at }, idA, { timeout: 10000 })
    return cord
  }
  const noCord = page => page.evaluate(() => {
    const b = window.syn3hNet.bungee
    return { cords: b.cords.size, count: b.count, attached: b.attached, mine: Boolean(b.mine) }
  })
  const empty = { cords: 0, count: 0, attached: false, mine: false }

  // 1. Exit world, then a different planet from the galaxy.
  report.first = await anchor()
  console.log(`A anchored at ${report.first.at.map(v => v.toFixed(1)).join(', ')}`)
  const offsBefore = received.filter(m => m.type === 'cord' && m.from === idA && m.cord.s === 'off').length
  await A.evaluate(() => document.querySelector('.exit-world').click())
  await A.waitForFunction(() => !window.syn3h.shell.playing)
  // The exit itself lets go, before any new world is chosen.
  await A.waitForFunction(() => window.syn3hNet.bungee.cords.size === 0, null, { timeout: 5000 })
  await B.waitForFunction(id => !window.syn3hNet.bungee.cords.has(id), idA, { timeout: 5000 })
  assert.ok(received.filter(m => m.type === 'cord' && m.from === idA && m.cord.s === 'off').length > offsBefore, 'B must hear A\'s cord go off')
  console.log('Exit world released the cord for A and for B')
  await A.locator('.galaxy-label[data-world="desert"]').dispatchEvent('click')
  await A.waitForFunction(() => window.syn3h.shell.playing && window.syn3h.planets.currentPlanet().id === 'desert', null, { timeout: 60000 })
  await B.waitForFunction(() => window.syn3h.planets.currentPlanet().id === 'desert', null, { timeout: 60000 })
  await A.waitForTimeout(1500)
  report.afterNewPlanet = { A: await noCord(A), B: await noCord(B) }
  assert.deepEqual(report.afterNewPlanet.A, empty, 'A must have no cord on the new planet')
  assert.ok(!(await B.evaluate(id => window.syn3hNet.bungee.cords.has(id), idA)), 'B must not draw A\'s old cord on the new planet')
  await A.screenshot({ path: `${out}/new-planet-A.png` })
  console.log('Entered another planet with no cord')

  // 2. A cord, and the planet changes in place while A keeps playing.
  await A.waitForFunction(() => window.syn3hNet.connected && window.syn3h.shell.playing)
  await A.waitForTimeout(2000)
  report.second = await anchor()
  await A.evaluate(() => window.syn3h.planets.applyPlanet('alpine'))
  await A.waitForFunction(() => window.syn3h.planets.currentPlanet().id === 'alpine')
  await B.waitForFunction(() => window.syn3h.planets.currentPlanet().id === 'alpine', null, { timeout: 60000 })
  await A.waitForFunction(() => window.syn3hNet.bungee.cords.size === 0, null, { timeout: 5000 })
  await B.waitForFunction(id => !window.syn3hNet.bungee.cords.has(id), idA, { timeout: 5000 })
  await A.waitForTimeout(1500)
  report.afterWorldChange = { A: await noCord(A), B: await noCord(B) }
  assert.deepEqual(report.afterWorldChange.A, empty, 'A must have no cord after the world changed under it')
  assert.ok(!(await B.evaluate(id => window.syn3hNet.bungee.cords.has(id), idA)), 'B must not keep A\'s cord after the world changed')
  console.log('An in-place world change released the cord for A and for B')

  report.relays = received.filter(m => m.type === 'cord' && m.from === idA).map(m => m.cord.s)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify(report, null, 2))
  console.log('GEAR LIFECYCLE BROWSER OK')
} catch (error) {
  console.log(JSON.stringify({ errors, relays: received.filter(m => m.type === 'cord').map(m => [m.from, m.cord.s]) }, null, 2))
  if (A) await A.screenshot({ path: `${out}/failure.png` }).catch(() => {})
  throw error
} finally { await browser.close() }
