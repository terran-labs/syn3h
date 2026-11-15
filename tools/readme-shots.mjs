#!/usr/bin/env node
/**
 * Vignette stills for the README's "How it is made" section, captured from the live site.
 *
 *   tools/heavy.sh node tools/readme-shots.mjs [--only id,id] [--base https://www.syn3h.com/]
 *                                              [--out /tmp/syn3h-readme-shots] [--headed]
 *
 * Each scene opens in its own browser context, poses the world through window.syn3h (params,
 * player, camera, shell) and takes a 1280 x 720 PNG into <out>/raw/. Every PNG is then scaled
 * to 840 px wide and written as JPEG into docs/readme/, at the best quality that stays under
 * 150 KB. Nothing is accepted automatically: a person looks at every frame.
 *
 * Network: by default the page's WebSocket is replaced by one that never connects, so a scene
 * sends nothing to a room and its parameter changes live only in that page. Scenes that need
 * the room (the invite QR) set `net: true` and use a fresh room named readme-<scene>-<run>.
 *
 * The staging helpers follow tools/showcase.mjs. Parameters are set in the page only.
 */
import { execFile, spawn } from 'node:child_process'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { resolveCaptureTeleport } from './capture-landmarks.mjs'
import { FRAME_LIMITS, frameStats, judgeFrame, parseArgs } from './lib/showcase-scenes.mjs'

const run = promisify(execFile)
const FFMPEG = process.env.FFMPEG ?? '/opt/homebrew/bin/ffmpeg'
const GPU_ARGS = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist']
const WIDTH = 1280, HEIGHT = 720, OUT_WIDTH = 840, MAX_BYTES = 150 * 1024
const repo = resolve(fileURLToPath(new URL('..', import.meta.url)))

const options = parseArgs(process.argv.slice(2), ['only', 'base', 'out', 'headed'])
const base = options.base ?? 'https://www.syn3h.com/'
const outRoot = resolve(options.out ?? '/tmp/syn3h-readme-shots')
const docsDir = join(repo, 'docs', 'readme')
const runTag = Date.now().toString(36)

// --- in-page helpers --------------------------------------------------------------------
/* eslint-disable no-undef */
function pageHelpers() {
  const s = window.syn3h
  const V = s.game.camera.position.constructor
  const h = {
    V,
    key(code, down) { window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true })) },
    forward(heading) { return { x: -Math.sin(heading), z: -Math.cos(heading) } },
    pos(body = s.player.body) { const t = body.translation(); return { x: t.x, y: t.y, z: t.z } },
    heading(body = s.player.body) { const q = body.rotation(); return Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)) },
    ground(x, z) { return Math.max(s.terrain.heightAt(x, z), s.terrain.liquidHeightAt?.(x, z) ?? -Infinity) },
    /** The island centre: the volcano summit, or the first spawn pad on a world without one. */
    centre() { const c = s.terrain.summit?.(); if (c) return c; const p = s.terrain.spawnPoint(0).position; return { x: p.x, z: p.z } },
    land(x, z) { return s.terrain.heightAt(x, z) },
    liquid(x, z) { return s.terrain.liquidHeightAt?.(x, z) ?? -Infinity },
    isWater(x, z) { return h.liquid(x, z) > h.land(x, z) + 0.5 },
    teleport(vehicle, x, z, heading, clearance = 1.5, y) {
      vehicle.teleport(new V(x, y ?? h.ground(x, z) + clearance, z), heading)
    },
    still(body) { body.setLinvel({ x: 0, y: 0, z: 0 }, true); body.setAngvel({ x: 0, y: 0, z: 0 }, true) },
    /** The sun's direction (towards the sun), read from the sky dome the scene draws. */
    sun() {
      const sky = s.game.scene.children.find((o) => 'sunDirection' in o && 'betaR' in o)
      const d = sky?.sunDirection?.value
      return d ? { x: d.x, y: d.y, z: d.z } : null
    },
    /** Hold the camera at a pose computed each frame, as in tools/showcase.mjs. */
    follow(fn, lead = 0.5, fov) {
      h.stopFollow?.()
      let live = true
      const tick = () => {
        if (!live) return
        const { from, to } = fn(), v = s.player.body.linvel()
        s.camera.setCinematicPose(new V(from.x + v.x * lead, from.y + v.y * lead, from.z + v.z * lead), new V(to.x + v.x * lead, to.y + v.y * lead, to.z + v.z * lead), fov)
        requestAnimationFrame(tick)
      }
      tick()
      h.stopFollow = () => { live = false; s.camera.clearCinematicPose?.() }
    },
    /** A fixed shot. */
    shot(from, to, fov) { h.follow(() => ({ from, to }), 0, fov) },
    /** Search outward from (x, z) along a ring for the first point that passes `test`. */
    ring(cx, cz, radii, test, steps = 72) {
      for (const r of radii) for (let i = 0; i < steps; i++) {
        const a = i / steps * Math.PI * 2, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r
        if (test(x, z)) return { x, z, a }
      }
      return null
    },
  }
  window.vignette = h
}
/* eslint-enable no-undef */

/** Replace the room socket with one that never opens, so the page stays local. */
function offlineSocket() {
  class Offline extends EventTarget {
    constructor(url) {
      super(); this.url = String(url); this.readyState = 3
      setTimeout(() => { const e = new Event('error'); this.onerror?.(e); this.dispatchEvent(e); const c = new CloseEvent('close', { code: 1006 }); this.onclose?.(c); this.dispatchEvent(c) }, 50)
    }
    send() {} close() {}
  }
  Offline.CONNECTING = 0; Offline.OPEN = 1; Offline.CLOSING = 2; Offline.CLOSED = 3
  window.WebSocket = Offline
}

const HIDE_CSS = `
  #hud, .tp-dfwv, .tp-rotv, .param-panel, .hud-navigation, .spawn-help,
  .shell-toast, .match-announcement, .shell-controls, .vehicle-help, .play-hints, .touch-controls, .syn3h-touch,
  .score-detail.is-developer, .build-line, .syn3h-nametags, .lobby-footer, .diagnostics, .syn3h-diagnostics,
  .race-hud, .match-hud { display: none !important; }
  * { cursor: none !important; }`
const HIDE_HUD = '.shell-hud, .gear-selector, .zorb-toggle, .focus-hud, .syn3h-shell.is-playing > :not(.shell-minimap):not(canvas) { display: none !important; }'
const HIDE_MINIMAP = '.shell-minimap { display: none !important; }'
const HIDE_LOBBY_INVITE = '.lobby-room-label, .invite-qr, .invite-link, .shell-invite, .lobby-message p:not(:first-child), .galaxy-population { display: none !important; }'

// --- the scenes -------------------------------------------------------------------------
// `passage` names the README passage each still illustrates. `stage(page)` poses the world
// and returns { ok, note }. Params are applied after play and before staging.
const SCENES = [
  {
    id: 'lobby', passage: 'A world from a number', lobby: true, seed: 7,
    css: HIDE_LOBBY_INVITE, limits: { minMeanLuma: 6 },
    async stage(page) {
      await page.waitForFunction(() => {
        const g = window.syn3h?.shell?.galaxy
        if (!g?.live || document.documentElement.dataset.boot !== 'done') return false
        if (g.logo && g.logo.introTime < 3.6) return false
        return document.querySelectorAll('.galaxy-label').length >= 3
      }, null, { timeout: 40000 })
      await settle(page, 2500)
      return { ok: true }
    },
  },
  {
    // Ice moon from below its frozen horn: violet dusk, pale cliffs, the buggy for scale.
    id: 'ice-moon', passage: 'A world from a number', planet: 'ice', seed: 3, vehicle: 'buggy',
    params: { 'sun.timeOfDay': 16.4 },
    async stage(page) {
      await page.evaluate(() => {
        const s = window.syn3h, h = window.vignette, top = window.vignette.centre()
        // A dry, fairly level spot about 700 m from the horn, facing it.
        const spot = h.ring(top.x, top.z, [700, 620, 780, 540], (x, z) => !h.isWater(x, z) && Math.abs(h.land(x + 4, z) - h.land(x - 4, z)) + Math.abs(h.land(x, z + 4) - h.land(x, z - 4)) < 1.2)
        if (!spot) throw new Error('no dry ground near the horn')
        const heading = Math.atan2(spot.x - top.x, spot.z - top.z)
        h.teleport(s.player, spot.x, spot.z, heading, 1.2)
        const f = h.forward(heading)
        h.follow(() => {
          const p = h.pos()
          return { from: { x: p.x - f.x * 8 + f.z * 3, y: p.y + 2.4, z: p.z - f.z * 8 - f.x * 3 }, to: { x: p.x + f.x * 40, y: p.y + 7, z: p.z + f.z * 40 } }
        }, 0, 55)
      })
      await settle(page, 4500)
      return groundedNote(page)
    },
  },
  {
    // Alpine, the second candidate for "a different kind of world": pines, granite, snow peak.
    id: 'alpine', passage: 'A world from a number', planet: 'alpine', seed: 11, vehicle: 'buggy',
    params: { 'sun.timeOfDay': 15.8 },
    async stage(page) {
      await page.evaluate(() => {
        const s = window.syn3h, h = window.vignette, top = window.vignette.centre()
        const spot = h.ring(top.x, top.z, [900, 820, 980, 740], (x, z) => !h.isWater(x, z) && Math.abs(h.land(x + 4, z) - h.land(x - 4, z)) + Math.abs(h.land(x, z + 4) - h.land(x, z - 4)) < 1.2)
        if (!spot) throw new Error('no ground near the peak')
        const heading = Math.atan2(spot.x - top.x, spot.z - top.z)
        h.teleport(s.player, spot.x, spot.z, heading, 1.2)
        const f = h.forward(heading)
        h.follow(() => {
          const p = h.pos()
          return { from: { x: p.x - f.x * 8 - f.z * 3, y: p.y + 2.4, z: p.z - f.z * 8 + f.x * 3 }, to: { x: p.x + f.x * 40, y: p.y + 8, z: p.z + f.z * 40 } }
        }, 0, 55)
      })
      await settle(page, 4500)
      return groundedNote(page)
    },
  },
  {
    // The seam: the hovercraft sits on the tile edge, and the minimap (which wraps) shows the
    // island cut into the corners around it. Minimap kept; the rest of the HUD hidden.
    id: 'wrap-seam', passage: 'A world without an edge', planet: 'archipelago', seed: 5, vehicle: 'hovercraft',
    keepMinimap: true, params: { 'sun.timeOfDay': 15 },
    async stage(page) {
      await page.evaluate(() => {
        const s = window.syn3h, h = window.vignette, t = s.terrain, top = window.vignette.centre()
        // The tile edge furthest from the island's centre, on both axes: a corner of the tile.
        const half = t.size / 2
        const x = top.x + half, z = top.z + half
        h.teleport(s.player, x - 6, z - 6, Math.PI * 0.75, 1.5)
        h.key('KeyW', true)
        h.follow(() => {
          const p = h.pos(), f = h.forward(h.heading())
          return { from: { x: p.x - f.x * 10 + f.z * 6, y: p.y + 5, z: p.z - f.z * 10 - f.x * 6 }, to: { x: p.x + f.x * 10, y: p.y, z: p.z + f.z * 10 } }
        })
      })
      await settle(page, 2500)
      return page.evaluate(() => {
        const s = window.syn3h, h = window.vignette, t = s.terrain, top = window.vignette.centre(), p = h.pos()
        h.key('KeyW', false)
        const dx = ((p.x - top.x) % t.size + t.size) % t.size, dz = ((p.z - top.z) % t.size + t.size) % t.size
        return { ok: true, note: `tile ${t.size} m; at ${dx.toFixed(0)}, ${dz.toFixed(0)} from the island centre` }
      })
    },
  },
  {
    // Low sun behind the volcano, camera on the far side so the cone eclipses it and the
    // shafts fan out round the summit. Placed from the sky's own sun direction.
    id: 'sun-shafts', passage: 'Light that agrees with itself', planet: 'alpine', seed: 11, vehicle: 'buggy',
    params: { 'sun.timeOfDay': 17.2, 'post.shafts': 1, 'post.shaftLength': 1, 'weather.cloudCoverage': 0.35 },
    async stage(page) {
      await page.evaluate(() => {
        const s = window.syn3h, h = window.vignette, t = s.terrain, top = window.vignette.centre()
        const sun = h.sun(); if (!sun) throw new Error('no sky sun direction')
        const len = Math.hypot(sun.x, sun.z), ux = sun.x / len, uz = sun.z / len
        // Away from the sun, about 900 m from the summit, on dry ground.
        let at = null
        for (let r = 550; r > 250 && !at; r -= 25) {
          const x = top.x - ux * r, z = top.z - uz * r
          if (!h.isWater(x, z) && !(h.liquid(x, z) > h.land(x, z))) at = { x, z }
        }
        at ??= { x: top.x - ux * 600, z: top.z - uz * 600 }
        const heading = Math.atan2(-ux, -uz)
        h.teleport(s.player, at.x, at.z, heading, 1.2)
        const peak = h.land(top.x, top.z)
        h.shot({ x: at.x - ux * 12 + uz * 4, y: h.ground(at.x, at.z) + 3, z: at.z - uz * 12 - ux * 4 }, { x: top.x, y: peak, z: top.z }, 55)
      })
      await settle(page, 5000)
      return page.evaluate(() => { const sun = window.vignette.sun(); return { ok: sun.y > 0.02, note: `sun elevation ${(Math.asin(sun.y) * 180 / Math.PI).toFixed(1)} deg` } })
    },
  },
  {
    // Raymarched clouds at a low sun: a wide upward view with heavier cover, sun to the side.
    id: 'clouds-dusk', passage: 'Light that agrees with itself', planet: 'alpine', seed: 11, vehicle: 'buggy',
    params: { 'sun.timeOfDay': 17.6, 'weather.cloudCoverage': 0.55, 'weather.cloudDensity': 0.55 },
    async stage(page) {
      await page.evaluate(() => {
        const s = window.syn3h, h = window.vignette, t = s.terrain, top = window.vignette.centre()
        const sun = h.sun(), len = Math.hypot(sun.x, sun.z), ux = sun.x / len, uz = sun.z / len
        // Look 50 degrees off the sun so the clouds are side lit, over the peak.
        const a = Math.atan2(uz, ux) + 1.4, lx = Math.cos(a), lz = Math.sin(a)
        const x = top.x - lx * 800, z = top.z - lz * 800
        h.teleport(s.player, x, z, Math.atan2(-lx, -lz), 1.2)
        const y = h.ground(x, z)
        h.shot({ x, y: y + 8, z }, { x: x + lx * 300, y: y + 105, z: z + lz * 300 }, 65)
      })
      await settle(page, 6000)
      return { ok: true }
    },
  },
  {
    // Night: stars and moonlight over the ice moon, headlights on the ice.
    id: 'night', passage: 'Light that agrees with itself', planet: 'ice', seed: 3, vehicle: 'buggy',
    params: { 'sun.timeOfDay': 23, 'sky.stars': 1.5, 'weather.cloudCoverage': 0.1 }, limits: { minMeanLuma: 8 },
    async stage(page) {
      await page.evaluate(() => {
        const s = window.syn3h, h = window.vignette, top = window.vignette.centre()
        const spot = h.ring(top.x, top.z, [650, 560, 740], (x, z) => !h.isWater(x, z) && Math.abs(h.land(x + 4, z) - h.land(x - 4, z)) < 1)
        const heading = Math.atan2(spot.x - top.x, spot.z - top.z)
        h.teleport(s.player, spot.x, spot.z, heading, 1.2)
        const f = h.forward(heading)
        h.follow(() => {
          const p = h.pos()
          return { from: { x: p.x - f.x * 8 + f.z * 3, y: p.y + 2.2, z: p.z - f.z * 8 - f.x * 3 }, to: { x: p.x + f.x * 40, y: p.y + 5, z: p.z + f.z * 40 } }
        }, 0, 60)
      })
      await settle(page, 5000)
      return groundedNote(page)
    },
  },
  {
    // The hovercraft riding the swells on the open sea, low side view so the waves read.
    id: 'swells', passage: 'Water that carries you', planet: 'desert', seed: 11, vehicle: 'hovercraft',
    params: { 'sun.timeOfDay': 16.8, 'water.waveHeight': 2.6, 'water.waveLength': 50 },
    async stage(page) {
      await openSea(page)
      await page.evaluate(() => {
        const s = window.syn3h, h = window.vignette
        const sun = h.sun(), len = Math.hypot(sun.x, sun.z), ux = sun.x / len, uz = sun.z / len
        h.follow(() => {
          const p = h.pos(), f = h.forward(h.heading())
          return { from: { x: p.x + ux * 10 - f.x * 5, y: p.y + 4.5, z: p.z + uz * 10 - f.z * 5 }, to: { x: p.x, y: p.y - 0.5, z: p.z } }
        }, 0, 50)
      })
      await settle(page, 4000)
      return page.evaluate(() => { const h = window.vignette, p = h.pos(); h.key('KeyW', false); return { ok: h.isWater(p.x, p.z), note: `on water, ${(p.y - h.liquid(p.x, p.z)).toFixed(1)} m above the mean surface` } })
    },
  },
  {
    // From just under the surface: the buggy sinks off the shore and the lens follows it down.
    id: 'underwater', passage: 'Water that carries you', planet: 'desert', seed: 11, vehicle: 'buggy',
    params: { 'sun.timeOfDay': 13, 'water.underwater': true }, limits: { minLumaStdDev: 6 },
    async stage(page) {
      await openSea(page, 3, 6)
      await page.evaluate(() => {
        const s = window.syn3h, h = window.vignette, p = h.pos(), surface = h.liquid(p.x, p.z)
        // Sit the car a metre under the surface in shallow water, camera alongside it, looking
        // slightly up so the underside of the waves fills the top of the frame.
        h.teleport(s.player, p.x, p.z, h.heading(), 0, h.land(p.x, p.z) + 0.8)
        h.follow(() => {
          const q = h.pos(), f = h.forward(h.heading()), w = h.liquid(q.x, q.z)
          return { from: { x: q.x - f.x * 6 + f.z * 4, y: w - 0.9, z: q.z - f.z * 6 - f.x * 4 }, to: { x: q.x, y: q.y + 0.4, z: q.z } }
        }, 0, 70)
      })
      await settle(page, 3500)
      return page.evaluate(() => {
        const s = window.syn3h, h = window.vignette, c = s.game.camera.position
        const under = c.y < h.liquid(c.x, c.z)
        return { ok: under, note: `camera ${(h.liquid(c.x, c.z) - c.y).toFixed(2)} m under the surface` }
      })
    },
  },
  {
    // Four machines: the player in the tank plus three mixed-fleet bots, parked in a row.
    id: 'lineup', passage: 'Machines with opinions', planet: 'desert', seed: 11, vehicle: 'tank', net: true,
    params: { 'sun.timeOfDay': 16.2, 'bots.count': 4, 'bots.fleet': 1, 'bots.canDrive': false },
    async stage(page) {
      await page.waitForFunction(() => window.syn3h.bots.vehicles.length >= 4, null, { timeout: 45000 })
      await page.evaluate(() => {
        const s = window.syn3h, h = window.vignette
        const spawn = s.terrain.spawnPoint(0), heading = spawn.heading, f = h.forward(heading)
        const base = { x: spawn.position.x + f.x * 25, z: spawn.position.z + f.z * 25 }
        // One of each kind, ordered buggy, hovercraft, jet; skip the duplicate buggy.
        const seen = new Set(), picks = []
        for (const b of s.bots.vehicles) if (!seen.has(b.kind)) { seen.add(b.kind); picks.push(b) }
        for (const b of s.bots.vehicles) if (!picks.includes(b)) { b.teleport(new h.V(base.x + 400, h.ground(base.x + 400, base.z) + 2, base.z), heading) }
        const all = [s.player, ...picks]
        all.forEach((v, i) => {
          const side = (i - (all.length - 1) / 2) * 8
          const x = base.x - f.z * side, z = base.z + f.x * side
          h.teleport(v, x, z, heading, v.kind === 'jet' ? 0.6 : 1.2)
        })
        window.vignette.lineup = all
        h.shot({ x: base.x + f.x * 30, y: h.ground(base.x, base.z) + 5, z: base.z + f.z * 30 }, { x: base.x, y: h.ground(base.x, base.z) + 1.2, z: base.z }, 45)
      })
      await settle(page, 3500)
      return page.evaluate(() => {
        const kinds = window.vignette.lineup.map((v) => v.kind)
        return { ok: new Set(kinds).size >= 4, note: kinds.join(', ') }
      })
    },
  },
  {
    // The buggy gliding on its hex wings off a dune, as in tools/showcase.mjs.
    id: 'wings-glide', passage: 'Machines with opinions', planet: 'desert', seed: 11, vehicle: 'buggy',
    params: { 'sun.timeOfDay': 16.6 },
    async stage(page) {
      await page.evaluate(() => {
        const s = window.syn3h, h = window.vignette
        const d = window.resolveCaptureTeleport(s.terrain, { landmark: 'dune' })
        h.teleport(s.player, d.x, d.z, d.heading, 0, h.ground(d.x, d.z) + 30)
        const f = h.forward(d.heading)
        s.player.body.setLinvel({ x: f.x * 26, y: 2, z: f.z * 26 }, true)
        s.game.input.state.special = true
        h.follow(() => {
          const p = h.pos(), f = h.forward(h.heading())
          return { from: { x: p.x - f.x * 6 + f.z * 5, y: p.y + 2.5, z: p.z - f.z * 6 - f.x * 5 }, to: { x: p.x + f.x * 4, y: p.y - 1, z: p.z + f.z * 4 } }
        }, 0.25, 55)
      })
      await settle(page, 2600)
      return page.evaluate(() => {
        const s = window.syn3h, h = window.vignette, p = h.pos(), up = p.y - h.ground(p.x, p.z)
        return { ok: s.player.wingsOpen && up > 4, note: `wings ${s.player.wingsOpen ? 'open' : 'closed'}, ${up.toFixed(1)} m up` }
      })
    },
  },
  {
    // The jet low and fast over the desert, lit from behind the camera, plume toward the lens.
    id: 'jet-plume', passage: 'Machines with opinions', planet: 'desert', seed: 11, vehicle: 'jet',
    params: { 'sun.timeOfDay': 15.8 },
    async stage(page) {
      await page.evaluate(() => {
        const s = window.syn3h, h = window.vignette, top = h.centre(), sun = h.sun()
        const len = Math.hypot(sun.x, sun.z), ux = sun.x / len, uz = sun.z / len
        // Fly across the sun line, so the camera behind and to the sun side sees a lit flank.
        const heading = Math.atan2(uz, -ux)
        const x = top.x - ux * 500, z = top.z - uz * 500
        h.teleport(s.player, x, z, heading, 0, h.ground(x, z) + 45)
        const f = h.forward(heading)
        s.player.body.setLinvel({ x: f.x * 40, y: 0, z: f.z * 40 }, true)
        s.game.input.state.special = true // forward flight: the plume follows throttle
        h.key('KeyR', true)
        h.follow(() => {
          const p = h.pos(), f = h.forward(h.heading())
          return { from: { x: p.x - f.x * 13 + ux * 5, y: p.y + 2, z: p.z - f.z * 13 + uz * 5 }, to: { x: p.x + f.x * 4, y: p.y, z: p.z + f.z * 4 } }
        }, 0.5, 50)
      })
      await settle(page, 2000)
      return page.evaluate(() => { const h = window.vignette, p = h.pos(); return { ok: p.y - h.ground(p.x, p.z) > 15, note: `${(p.y - h.ground(p.x, p.z)).toFixed(0)} m up` } })
    },
  },
  {
    // A vehicle rolling inside the Zorb ball, low three-quarter view.
    id: 'zorb', passage: 'Machines with opinions', planet: 'desert', seed: 11, vehicle: 'buggy',
    params: { 'sun.timeOfDay': 16.2 },
    async stage(page) {
      await page.evaluate(() => {
        const s = window.syn3h, h = window.vignette
        const spawn = s.terrain.spawnPoint(0), f = h.forward(spawn.heading)
        h.teleport(s.player, spawn.position.x + f.x * 15, spawn.position.z + f.z * 15, spawn.heading, 1.5)
        s.game.input.toggleZorb?.() ?? (s.game.input.state.zorb = true)
      })
      await settle(page, 4500)
      await page.evaluate(() => {
        const h = window.vignette
        h.key('KeyW', true); setTimeout(() => h.key('KeyW', false), 900)
        h.follow(() => {
          const p = h.pos(), f = h.forward(h.heading())
          return { from: { x: p.x + f.x * 14 + f.z * 8, y: p.y + 3, z: p.z + f.z * 14 - f.x * 8 }, to: { x: p.x, y: p.y + 1, z: p.z } }
        }, 0.5, 55)
      })
      await settle(page, 2200)
      return page.evaluate(() => { const s = window.syn3h; window.vignette.key('KeyW', false); return { ok: s.game.input.state.zorb === true, note: `zorb ${s.game.input.state.zorb ? 'on' : 'off'}` } })
    },
  },
  {
    // Bots following the player across the desert, camera ahead looking back at the pack.
    id: 'company', passage: 'Company', planet: 'desert', seed: 11, vehicle: 'buggy', net: true,
    params: { 'sun.timeOfDay': 16.4, 'bots.count': 5, 'bots.fleet': 1, 'bots.followYou': 1, 'bots.freeSpirit': 0 },
    async stage(page) {
      await page.waitForFunction(() => window.syn3h.bots.vehicles.length >= 4, null, { timeout: 45000 })
      // The player waits on level ground; the bots start 25 to 45 m away and drive up to it.
      // The camera looks over the player's shoulder at the pack coming in.
      await page.evaluate(() => {
        const s = window.syn3h, h = window.vignette
        const spawn = s.terrain.spawnPoint(0), heading = spawn.heading, f = h.forward(heading)
        const start = { x: spawn.position.x + f.x * 20, z: spawn.position.z + f.z * 20 }
        h.teleport(s.player, start.x, start.z, heading, 1.2)
        h.still(s.player.body)
        s.bots.vehicles.forEach((bot, i) => {
          const back = 25 + i * 5, side = (i % 2 ? 1 : -1) * (2 + 2.5 * i)
          h.teleport(bot, start.x + f.x * back + f.z * side, start.z + f.z * back - f.x * side, heading + Math.PI, bot.kind === 'jet' ? 4 : 1.2)
          bot.body.setLinvel({ x: -f.x * 10, y: 0, z: -f.z * 10 }, true)
        })
        const p = h.pos(), g = h.ground(p.x, p.z)
        h.shot({ x: p.x - f.x * 9 + f.z * 3, y: g + 3.2, z: p.z - f.z * 9 - f.x * 3 }, { x: p.x + f.x * 25, y: g + 1, z: p.z + f.z * 25 }, 50)
      })
      await settle(page, 2200)
      return page.evaluate(() => {
        const s = window.syn3h, h = window.vignette, p = h.pos()
        const near = s.bots.vehicles.filter((b) => { const t = b.body.translation(); return Math.hypot(t.x - p.x, t.z - p.z) < 40 }).length
        return { ok: near >= 3, note: `${near} bots within 40 m` }
      })
    },
  },
  {
    // The Multiplayer panel in the lobby, with the QR code the game draws itself.
    id: 'multiplayer-qr', passage: 'A room that sleeps', lobby: true, seed: 7, net: true, limits: { minMeanLuma: 6 },
    async stage(page) {
      await page.waitForFunction(() => document.documentElement.dataset.boot === 'done', null, { timeout: 40000 })
      await settle(page, 2000)
      await page.evaluate(() => window.syn3h.shell.showPanel('multiplayer'))
      await page.waitForFunction(() => document.querySelector('[data-panel="multiplayer"] .invite-qr svg, [data-panel="multiplayer"] .invite-qr canvas, [data-panel="multiplayer"] .invite-qr *'), null, { timeout: 15000 }).catch(() => {})
      await settle(page, 1200)
      return page.evaluate(() => {
        const qr = document.querySelector('[data-panel="multiplayer"] .invite-qr')
        const box = qr?.getBoundingClientRect()
        return { ok: Boolean(box && box.width > 40), note: box ? `QR ${box.width.toFixed(0)} px at ${box.x.toFixed(0)}, ${box.y.toFixed(0)}` : 'no QR' }
      })
    },
  },
]

/**
 * Wait `ms` of wall time and at least as much game time (physics ticks at 60 Hz), so a
 * busy machine that renders few frames still lets the scene settle. Capped at a minute.
 */
async function settle(page, ms) {
  const start = await page.evaluate(() => window.syn3h?.game?.tick ?? null)
  await page.waitForTimeout(ms)
  if (start == null) return
  await page.waitForFunction((t) => window.syn3h.game.tick >= t, start + Math.round(ms * 0.06), { timeout: 60000 }).catch(() => {})
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

async function groundedNote(page) {
  return page.evaluate(() => {
    const s = window.syn3h, q = s.player.body.rotation(), upright = 1 - 2 * (q.x * q.x + q.z * q.z)
    return { ok: upright > 0.85, note: `wheels ${s.player.wheelsGrounded ?? '?'}, upright ${upright.toFixed(2)}` }
  })
}

/** Put the player on open water a few hundred metres out from the island, facing along the coast. */
async function openSea(page, depth = 12, maxDepth = Infinity) {
  await page.evaluate(([depth, maxDepth]) => {
    const s = window.syn3h, h = window.vignette, top = window.vignette.centre()
    const spot = h.ring(top.x, top.z, [700, 800, 900, 1000, 1100, 1200], (x, z) => { const d = h.liquid(x, z) - h.land(x, z), e = h.liquid(x + 30, z) - h.land(x + 30, z); return d > depth && e > depth && d < maxDepth && e < maxDepth }, 144)
    if (!spot) throw new Error('no open water')
    const heading = spot.a + Math.PI / 2
    h.teleport(s.player, spot.x, spot.z, Math.atan2(-Math.cos(heading), -Math.sin(heading)), 0.6)
  }, [depth, maxDepth])
  await settle(page, 1500)
}

// --- capture ----------------------------------------------------------------------------
function sceneUrl(scene) {
  const url = new URL(scene.page ?? '', base)
  if (scene.page) return url.href
  url.searchParams.set('room', `readme-${scene.id}-${runTag}`.slice(0, 40))
  if (scene.planet) url.searchParams.set('planet', scene.planet)
  if (scene.seed != null) url.searchParams.set('seed', String(scene.seed))
  if (scene.vehicle) url.searchParams.set('vehicle', scene.vehicle)
  if (!scene.lobby) url.searchParams.set('autoplay', '1')
  url.searchParams.set('name', 'Readme')
  return url.href
}

async function rgbOf(png) {
  const child = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vf', 'scale=320:180', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
  const chunks = []
  child.stdout.on('data', (c) => chunks.push(c))
  child.stdin.end(png)
  await new Promise((ok, fail) => child.on('close', (code) => code === 0 ? ok() : fail(new Error(`ffmpeg decode exited ${code}`))))
  return Buffer.concat(chunks)
}

/**
 * Scale to OUT_WIDTH and write JPEG at the best ffmpeg quality (2 is best, 31 worst) that
 * fits MAX_BYTES. q 4 to 5 is about quality 82 in libjpeg terms.
 */
async function writeJpeg(pngPath, jpgPath, crop) {
  const filters = [crop ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}` : null, `scale=${OUT_WIDTH}:-2:flags=lanczos`].filter(Boolean).join(',')
  for (let q = 4; q <= 12; q++) {
    await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', pngPath, '-vf', filters, '-q:v', String(q), jpgPath])
    const bytes = (await stat(jpgPath)).size
    if (bytes <= MAX_BYTES) return { bytes, q }
  }
  throw new Error(`${jpgPath} is over ${MAX_BYTES} bytes even at q 12`)
}

async function captureScene(browser, scene) {
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 })
  try {
    if (!scene.net) await context.addInitScript(offlineSocket)
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(sceneUrl(scene), { waitUntil: 'load' })
    if (scene.page) {
      await page.addStyleTag({ content: '* { cursor: none !important; }' })
    } else {
      await page.waitForFunction(() => window.syn3h?.game?.tick > 30, null, { timeout: 90000 })
      await page.addStyleTag({ content: HIDE_CSS + (scene.lobby ? '' : HIDE_HUD) + (scene.keepMinimap ? '' : HIDE_MINIMAP) + (scene.css ?? '') })
      await page.evaluate(pageHelpers)
      await page.addScriptTag({ content: `window.resolveCaptureTeleport = ${resolveCaptureTeleport.toString()}` })
      // No idle daydream: the poses stay where the script puts them.
      await page.evaluate(() => window.syn3h.params.set('daydream.seconds', 0))
      if (!scene.lobby) {
        await page.evaluate(() => { window.syn3h.shell.play(); document.activeElement?.blur?.() })
        await settle(page, 1500)
      }
      if (scene.params) await page.evaluate((p) => { for (const [id, v] of Object.entries(p)) window.syn3h.params.set(id, v) }, scene.params)
    }
    await page.evaluate(() => document.fonts.ready)
    const limits = { ...FRAME_LIMITS, ...scene.limits }
    let last = null
    for (let attempt = 1; attempt <= 2; attempt++) {
      const pose = await scene.stage(page)
      const png = await page.screenshot({ type: 'png' })
      const verdict = judgeFrame(frameStats(await rgbOf(png)), limits)
      last = { png, pose, verdict }
      console.log(`  attempt ${attempt}: pose ${pose.ok ? 'ok' : 'missed'}${pose.note ? ` (${pose.note})` : ''}, ${verdict.ok ? 'frame ok' : verdict.reason}`)
      if (pose.ok && verdict.ok) break
    }
    if (errors.length) console.log(`  page errors: ${errors.slice(0, 3).join(' | ')}`)
    return last
  } finally {
    await context.close()
  }
}

const wanted = typeof options.only === 'string' ? new Set(options.only.split(',')) : null
const scenes = SCENES.filter((s) => !wanted || wanted.has(s.id))
if (wanted && scenes.length !== wanted.size) throw new Error(`Unknown scene in --only; known: ${SCENES.map((s) => s.id).join(', ')}`)
await mkdir(join(outRoot, 'raw'), { recursive: true })
await mkdir(docsDir, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: !options.headed, args: GPU_ARGS })
const report = []
try {
  for (const scene of scenes) {
    console.log(`scene ${scene.id} (${scene.passage})`)
    try {
      const shot = await captureScene(browser, scene)
      const raw = join(outRoot, 'raw', `${scene.id}.png`)
      await writeFile(raw, shot.png)
      const jpg = join(docsDir, `${scene.id}.jpg`)
      const { bytes, q } = await writeJpeg(raw, jpg, scene.crop)
      report.push({ id: scene.id, passage: scene.passage, ok: shot.pose.ok && shot.verdict.ok, note: shot.pose.note ?? '', bytes, q })
      console.log(`  wrote ${jpg} ${bytes} bytes (q ${q})`)
    } catch (error) {
      report.push({ id: scene.id, passage: scene.passage, ok: false, note: error.message.split('\n')[0] })
      console.log(`  failed: ${error.message.split('\n')[0]}`)
    }
  }
} finally {
  await browser.close()
}
await writeFile(join(outRoot, `report-${runTag}.json`), JSON.stringify(report, null, 2) + '\n')
console.table(report)
