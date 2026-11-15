/** Browser acceptance for the shipped duckling defaults and local tag marker. */
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createServer as createNetServer } from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const out = process.argv[2]; assert.ok(out); await mkdir(out, { recursive: true })
const roomPort = await new Promise(resolve => { const s = createNetServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
process.env.SYN3H_ROOM_PORT = String(roomPort)
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?autoplay=1&room=ducks-${Date.now()}`)
  await page.waitForFunction(() => window.syn3h?.game.tick > 25 && window.syn3hNet?.connected, null, { timeout: 120000 })
  const defaults = await page.evaluate(() => {
    const s = window.syn3h
    return Object.fromEntries(['bots.tagBeams', 'bots.aggression', 'bots.followYou', 'bots.playfulness'].map(k => [k, s.params.get(k).value]))
  })
  assert.equal(defaults['bots.tagBeams'], false)
  assert.equal(defaults['bots.aggression'], 1)
  assert.ok(defaults['bots.followYou'] > 0)
  // A fresh single-player room assigns the human as "it". Inspect real networking wiring.
  const marker = await page.evaluate(() => {
    const n = window.syn3hNet, s = window.syn3h
    return { id: n.id, it: n.game.it, local: n.marker.local === s.player, targetLocal: n.marker.target === s.player, visible: n.marker.mesh.visible }
  })
  await page.screenshot({ path: `${out}/marker.png` })
  assert.equal(marker.it, marker.id, 'fresh room assigns local player as it')
  assert.ok(marker.targetLocal && marker.visible)
  await page.evaluate(() => {
    const s = window.syn3h
    window.__duckFrames = { frames: 0, following: 0, firing: 0 }
    s.game.add({ fixedUpdate() {
      const r = window.__duckFrames; r.frames++
      if (s.bots.brains.some(b => b.duck.active)) r.following++
      if (s.bots.vehicles.some(b => b.input.fire)) r.firing++
    } })
  })
  const samples = []
  for (const [phase, key, seconds] of [['gather', null, 8], ['follow', 'KeyW', 6], ['stop', 'ShiftLeft', 8]]) {
    if (key) await page.keyboard.down(key)
    const start = await page.evaluate(() => window.syn3h.game.tick)
    for (let i = 1; i <= seconds; i++) {
      await page.waitForFunction(t => window.syn3h.game.tick >= t, start + i * 50, { timeout: 60000 })
      samples.push(await page.evaluate(phase => {
        const s = window.syn3h, p = s.player.body.translation()
        return { phase, tick: s.game.tick, player: p, bots: s.bots.brains.map(b => ({ id: b.vehicle.id, kind: b.vehicle.kind, position: b.vehicle.body.translation(), distance: Math.hypot(b.vehicle.object.position.x - p.x, b.vehicle.object.position.z - p.z), playful: b.playful, duck: b.duck.active, mode: b.duck.mode, firing: b.vehicle.input.fire })) }
      }, phase))
    }
    // A high camera shows the followers behind the vehicle, outside the normal chase view.
    await page.evaluate(() => { const s = window.syn3h, p = s.player.object.position.clone(); s.camera.setCinematicPose(p.clone().add({ x: 30, y: 35, z: 40 }), p) })
    await page.waitForTimeout(1600)
    await page.screenshot({ path: `${out}/${phase}.png` })
    await page.evaluate(() => window.syn3h.camera.clearCinematicPose(0.5))
    if (key) await page.keyboard.up(key)
  }
  const frames = await page.evaluate(() => window.__duckFrames)
  await writeFile(`${out}/results.json`, JSON.stringify({ defaults, samples, marker, frames, errors }, null, 2))
  assert.ok(frames.following > 0)
  assert.equal(frames.firing, 0)
  assert.deepEqual(errors, [])
  assert.ok(samples.some(s => s.bots.some(b => b.duck)), 'at least one bot visibly follows')
  assert.ok(samples.every(s => s.bots.every(b => !b.firing)), 'default bots never fire')
  assert.ok(marker.local, 'marker follows local player slot')
  if (marker.it === marker.id) assert.ok(marker.targetLocal && marker.visible, 'local marker visible when it')
  console.log(JSON.stringify({ defaults, marker, frames, samples: samples.length, errors }))
  await browser.close()
  const smoke = await promisify(execFile)(process.execPath, ['tools/smoke.mjs', `http://127.0.0.1:${server.httpServer.address().port}/?room=ducks-smoke-${Date.now()}`, `${out}/smoke.png`], { maxBuffer: 1000000 })
  console.log(smoke.stdout)
} finally { await browser.close(); await server.close() }
