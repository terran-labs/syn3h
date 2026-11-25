// Other vehicles' full-detail distance (src/vehicles/skins/mergeStatic.ts), seen: each kind of bot
// parked where the change shows, framed as a player looking at it would, at the old 30 m and the
// level's new distance. Run from a built checkout:
//
//   tools/heavy.sh node tools/vehicle-detail-frames.mjs <output directory> [checkout] [--phone]
//
// Alpine seed 4 at 15:00, High. For each kind of bot present: that bot alone in view, 55 m from the
// camera (past the old full-detail distance, inside High's new one), a 15 degree field of view
// on it; the others parked out of sight. One frame at each distance, and the detail level and
// paint each look showed.
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { serveStable } from './serve-stable.mjs'

const args = process.argv.slice(2).filter(a => !a.startsWith('--'))
const out = args[0] ?? '/tmp/vehicle-detail/frames', dir = args[1] ?? '.'
const phone = process.argv.includes('--phone')
await mkdir(out, { recursive: true })
const app = await serveStable({ dir, port: 0 })
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const notes = [], errors = []
try {
  const page = await browser.newPage({ viewport: phone ? { width: 844, height: 390 } : { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?planet=alpine&seed=4&autoplay=1&vehicle=buggy&daydream=0&room=vdf${Date.now().toString(36)}`)
  await page.waitForFunction(() => window.syn3h?.shell.playing && !window.syn3h.shell.transitioning && window.syn3hNet?.isHost, null, { timeout: 90000 })
  await page.addStyleTag({ content: 'body * { visibility: hidden !important } #game, #game * { visibility: visible !important }' })
  await page.evaluate(() => {
    const { params, game } = window.syn3h
    game.quality.setAuto(false); game.quality.manualChange = (_l, apply) => apply()
    params.set('bots.keepCount', true); params.set('bots.count', 6); params.set('sun.timeOfDay', 15); params.set('sun.dayLength', 0)
    game.quality.setLevel(3)
  })
  await page.waitForFunction(() => window.syn3h.game.quality.governor.level === 3 && !document.querySelector('.quality-change-veil'), null, { timeout: 90000 })
  await page.waitForFunction(() => { const { bots, materialize } = window.syn3h; return bots.vehicles.length >= 3 && bots.vehicles.every(v => !materialize.isMaterializing(v)) }, null, { timeout: 180000 })
  const level = await page.evaluate(() => { const { game, bots, params } = window.syn3h; for (const brain of bots.brainList) game.remove(brain, false); return { near: params.get('vehicle.detailNear').value, kinds: [...new Set(bots.vehicles.map(v => v.kind))] } })
  notes.push({ level })
  for (const kind of level.kinds) {
    for (const [label, near] of [['before-30m', 30], [`after-${level.near}m`, level.near]]) {
      const look = await page.evaluate(({ kind, near }) => {
        const { terrain, bots, player, camera, params } = window.syn3h
        params.set('vehicle.detailNear', near)
        const pad = terrain.spawnPoint(0).position, V = pad.constructor
        const eye = new V(pad.x, terrain.heightAt(pad.x, pad.z) + 3, pad.z)
        player.teleport(new V(pad.x, terrain.heightAt(pad.x, pad.z + 8) + 2, pad.z + 8), 0); player.body.setBodyType(2, true)
        let shown = null
        bots.vehicles.forEach((v, i) => {
          const here = !shown && v.kind === kind
          if (here) shown = v
          // The one in view 55 m ahead, broadside; the rest parked 400 m behind the camera.
          const x = here ? pad.x : pad.x + 20 * i, z = here ? pad.z - 55 : pad.z + 400
          v.teleport(new V(x, terrain.heightAt(x, z) + 1.5, z), here ? Math.PI / 2 : 0); v.body.setBodyType(2, true)
        })
        const target = shown.body.translation()
        camera.setCinematicPose(eye, new V(target.x, target.y, target.z), 15)
        return { kind }
      }, { kind, near })
      // The pose eases in: wait until the camera has arrived, then a moment for the detail swap.
      await page.waitForFunction(() => { const s = window.syn3h, c = s.camera.cinematic, cam = s.game.camera; return !c || (cam.position.distanceTo(c.position) < 0.05 && c.look.distanceTo(c.target) < 0.1) }, null, { timeout: 30000, polling: 200 }).catch(() => errors.push('camera did not settle'))
      await page.waitForTimeout(800)
      await page.screenshot({ path: `${out}/${kind}-${label}${phone ? '-phone' : ''}.png` })
      notes.push({ ...look, label })
    }
  }
} finally {
  await writeFile(`${out}/notes${phone ? '-phone' : ''}.json`, JSON.stringify({ notes, errors }, null, 2))
  await browser.close(); await app.close()
}
console.log(JSON.stringify({ notes, errors }))
process.exit(errors.length ? 1 : 0)
