#!/usr/bin/env node
/**
 * Capture the release showcase at the top of what the game can draw: stills at 3840 x 2160
 * and short clips at a steady 60 frames per second, from a frozen release build, at the
 * Cinematic quality level. See docs/RELEASE-SHOWCASE.md.
 *
 *   /Users/vtn/dev/Syn3h/tools/heavy.sh node tools/showcase.mjs --version v26.11.1607 --publish
 *
 * Options:
 *   --version  release version, e.g. v26.11.1607 (required). Without --dir or --url the
 *              frozen build of that release is found from release-notes/history.tsv and
 *              ../Syn3h-stable/releases.tsv.
 *   --dir      frozen build directory to serve with serve-stable instead
 *   --url      an already running server instead (not stopped)
 *   --port     port for the server this tool starts (default 5348)
 *   --out      output root (default captures/ in this checkout); files go to <out>/<version>/
 *   --only     comma separated shot ids (see tools/lib/showcase-scenes.mjs)
 *   --preview  quick look while composing: 1280 x 720, short settling, no clips encoded big
 *   --publish  after capturing, upload the files to the GitHub release <version> and rewrite
 *              the README's showcase block (the change is left uncommitted)
 *   --publish-only  publish an earlier capture in <out>/<version>/ without capturing again
 *   --repo     GitHub repository (default terran-labs/syn3h)
 *
 * How a frame is made. Chrome runs headed on the real GPU. The page's clock is virtual:
 * requestAnimationFrame and performance.now are driven by this tool, one frame of exactly
 * 1/60 s at a time, and each frame waits for the GPU to finish. The game, its physics and its
 * renderer run unchanged; only the pacing is the tool's, so a frame that takes 200 ms on a
 * busy machine still shows the world as a 60 fps player would see it, and clips play back
 * smoothly. Before each picture the tool waits for shaders to finish compiling and for a run
 * of quiet frames, so terrain, shadows, clouds and temporal smoothing have settled.
 */
import { spawn, execFile } from 'node:child_process'
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { resolveCaptureTeleport } from './capture-landmarks.mjs'
import {
  CLIP, FRAME_LIMITS, README_WIDTH, assetNames, buildManifest, frameStats, frozenIdFor, fullJpegArgs, hudModeOf,
  judgeFrame, missingFeature, mp4Args, parseArgs, readmeWebpArgs, renderReadmeSection, replaceReadmeSection,
  sceneUrl, selectShots, webpAnimArgs,
} from './lib/showcase-scenes.mjs'

const run = promisify(execFile)
const FFMPEG = process.env.FFMPEG ?? '/opt/homebrew/bin/ffmpeg'
const CJPEG = process.env.CJPEG ?? '/opt/homebrew/bin/cjpeg'
const CWEBP = process.env.CWEBP ?? '/opt/homebrew/bin/cwebp'
const IMG2WEBP = process.env.IMG2WEBP ?? '/opt/homebrew/bin/img2webp'
const GPU_ARGS = ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']
const here = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(here, '..')

const options = parseArgs(process.argv.slice(2), ['version', 'dir', 'url', 'port', 'out', 'only', 'preview', 'publish', 'publish-only', 'repo'])
if (!options.version || !/^v[\w.-]+$/.test(options.version)) throw new Error('--version is required, like v26.11.1607')
if (options.dir && options.url) throw new Error('Give at most one of --dir or --url')
const version = options.version
const repo = typeof options.repo === 'string' ? options.repo : 'terran-labs/syn3h'
const preview = Boolean(options.preview)
const VIEW = preview ? { width: 1280, height: 720, dpr: 1 } : { width: 1920, height: 1080, dpr: 2 }
const SETTLE = preview ? { min: 30, quiet: 12, max: 240 } : { min: 120, quiet: 45, max: 900 }
const outDir = resolve(typeof options.out === 'string' ? options.out : join(root, 'captures'), version)
const shots = selectShots(typeof options.only === 'string' ? options.only.split(',') : null)
const runTag = Date.now().toString(36)

if (options['publish-only']) { await publish(); process.exit(0) }

// --- the server -------------------------------------------------------------------------
let server = null
let base = typeof options.url === 'string' ? options.url : null
if (!base) {
  const dir = typeof options.dir === 'string' ? resolve(options.dir) : await frozenDir(version)
  const port = Number(options.port ?? 5348)
  if (!(port > 1024 && port < 65536)) throw new Error('Bad --port')
  server = spawn(process.execPath, [join(here, 'serve-stable.mjs'), '--dir', dir, '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'] })
  console.log(`server pid ${server.pid} on port ${port}: ${dir}`)
  await new Promise((ok, fail) => {
    server.stdout.on('data', (d) => { if (String(d).includes('listening')) ok() })
    server.once('exit', (code) => fail(new Error(`serve-stable exited with ${code}`)))
  })
  base = `http://127.0.0.1:${port}/`
}
const stopServer = () => { if (server && server.exitCode === null) server.kill('SIGTERM') }
process.on('exit', stopServer)

async function frozenDir(v) {
  const history = await readFile(join(root, 'release-notes/history.tsv'), 'utf8')
  const releases = await readFile(resolve(root, '../Syn3h-stable/releases.tsv'), 'utf8')
  return resolve(root, '../Syn3h-stable', frozenIdFor(v, history, releases))
}

// --- the virtual clock, installed before any page script --------------------------------
/* eslint-disable no-undef */
function installClock() {
  const realNow = performance.now.bind(performance)
  const realRaf = window.requestAnimationFrame.bind(window)
  const realCancel = window.cancelAnimationFrame.bind(window)
  const st = { virtual: false, now: 0, queue: new Map(), next: 2 ** 30, frames: 0 }
  performance.now = () => st.virtual ? st.now : realNow()
  window.requestAnimationFrame = (cb) => { if (!st.virtual) return realRaf(cb); const id = st.next++; st.queue.set(id, cb); return id }
  window.cancelAnimationFrame = (id) => { if (!st.queue.delete(id)) realCancel(id) }
  // Readiness the game reports itself. 'entered': in play, the descent over, the world's staged
  // rebuild finished and drawing resumed. 'bots': the room's bots have arrived (they arrive one
  // at a time, paced by measured frame times, which this clock makes 60 fps ones).
  const READY = {
    entered() {
      const s = window.syn3h, p = s.player
      return s.shell.playing && !s.shell.dropping && s.terrain.ready !== false && !s.game.holdDraws
        && (p.kind === 'jet' || p.kind === 'hovercraft' || p.wheelsGrounded > 0)
    },
    bots() {
      const s = window.syn3h, want = Math.min(4, s.params.get('bots.count')?.value ?? 4)
      return s.bots.vehicles.length >= want && !s.bots.arriving
    },
  }
  const gpuIdle = () => window.syn3h?.game?.renderer?.backend?.device?.queue.onSubmittedWorkDone()
  const clock = window.__showcaseClock = {
    get frames() { return st.frames },
    start() { if (!st.virtual) { st.now = realNow(); st.virtual = true } },
    async step(n = 1) {
      for (let i = 0; i < n; i++) {
        st.now += 1000 / 60; st.frames++
        try { window.showcase?.onFrame?.(st.frames - (window.showcase.t0 ?? 0)) } catch (e) { console.error('showcase onFrame', e) }
        const due = [...st.queue.values()]; st.queue.clear()
        for (const cb of due) { try { cb(st.now) } catch (e) { console.error(e) } }
        await gpuIdle()
      }
    },
    /** Step until shaders stop compiling and `quiet` frames in a row are calm, within min..max. */
    /**
     * Step frames until a named readiness check passes, or `max` frames. Returns the frames
     * taken, or -1. The checks are plain functions here (no eval, so a page CSP cannot block them).
     */
    async until(name, max) {
      const check = READY[name]
      for (let i = 0; i < max; i++) {
        try { if (check()) return i } catch { /* not built yet */ }
        await clock.step(1)
      }
      return -1
    },
    async settle({ min, quiet, max }) {
      let calm = 0, i = 0
      for (; i < max; i++) {
        await clock.step(1)
        const g = window.syn3h?.game, perf = g?.performance
        const busy = !g || (perf?.pipelinesFresh ?? 0) > 0 || g.quality?.isLoading
        calm = busy ? 0 : calm + 1
        if (i + 1 >= min && calm >= quiet) break
      }
      return { frames: i + 1, calm }
    },
  }
}

// --- in-page staging helpers, installed after load ---------------------------------------
function pageHelpers() {
  const s = window.syn3h
  const V = s.game.camera.position.constructor
  const h = {
    V,
    onFrame: null,
    key(code, down) { window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true })) },
    forward(heading) { return { x: -Math.sin(heading), z: -Math.cos(heading) } },
    pos(body = s.player.body) { const t = body.translation(); return { x: t.x, y: t.y, z: t.z } },
    heading(body = s.player.body) { const q = body.rotation(); return Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)) },
    ground(x, z) { return Math.max(s.terrain.heightAt(x, z), s.terrain.liquidHeightAt?.(x, z) ?? -Infinity) },
    wet(x, z) { return (s.terrain.liquidHeightAt?.(x, z) ?? -Infinity) > s.terrain.heightAt(x, z) },
    place(vehicle, x, z, heading, clearance = 1.2, y) {
      const at = new V(x, y ?? h.ground(x, z) + clearance, z)
      vehicle.teleport(at, heading)
    },
    /** A point `ahead` metres forward and `side` metres right of (x, z) facing heading. */
    offset(p, heading, ahead, side) { const f = h.forward(heading); return { x: p.x + f.x * ahead - f.z * side, z: p.z + f.z * ahead + f.x * side } },
    setVelocity(body, v) { body.setLinvel(v, true) },
    /** Place the bots as companions at readable distances (10 to 40 m), all facing `heading`. */
    companions(p, heading, spots) {
      s.bots.vehicles.forEach((bot, i) => {
        const spot = spots[i % spots.length], at = h.offset(p, heading, spot.ahead, spot.side)
        const air = bot.kind === 'jet' ? (spot.air ?? 14) : 0
        h.place(bot, at.x, at.z, heading + (spot.turn ?? 0), 1.2 + air)
        if (spot.speed) { const f = h.forward(heading); h.setVelocity(bot.body, { x: f.x * spot.speed, y: 0, z: f.z * spot.speed }) }
      })
    },
    /** Drive along a road (or straight) with a simple steering controller, on the frame clock. */
    driveRoad(kind = 'volcano', throttle = true) {
      const pts = s.terrain.roadPaths?.().find((r) => r.kind === kind)?.points ?? []
      let index = 0, best = Infinity
      const p0 = h.pos()
      pts.forEach((q, i) => { const d = Math.hypot(q.x - p0.x, q.z - p0.z); if (d < best) { best = d; index = i } })
      return () => {
        h.key('KeyW', throttle)
        if (!pts.length || best > 40) return
        const p = h.pos()
        while (index < pts.length - 6 && Math.hypot(pts[index].x - p.x, pts[index].z - p.z) < 12) index++
        const t = pts[Math.min(index + 2, pts.length - 1)]
        const want = Math.atan2(p.x - t.x, p.z - t.z), have = h.heading()
        const err = Math.atan2(Math.sin(want - have), Math.cos(want - have))
        h.key('KeyA', err > 0.06); h.key('KeyD', err < -0.06)
      }
    },
    /** Search a ring of the world for the best scoring spot. */
    search(score, { radius = s.terrain.size * 0.45, step = 24 } = {}) {
      let best = null
      for (let x = -radius; x <= radius; x += step) for (let z = -radius; z <= radius; z += step) {
        for (let a = 0; a < 8; a++) {
          const heading = a * Math.PI / 4, v = score(x, z, heading)
          if (Number.isFinite(v) && (!best || v > best.score)) best = { x, z, heading, score: v }
        }
      }
      return best
    },
    /** Heading that faces the sun on the ground plane, from the scene's directional light. */
    sunHeading() {
      let light = null
      s.game.scene.traverse((o) => { if (o.isDirectionalLight && !light) light = o })
      if (!light) return 0
      const dx = light.position.x - light.target.position.x, dz = light.position.z - light.target.position.z
      return Math.atan2(-dx, -dz)
    },
    /** Hold the cinematic camera at a pose computed from the player each frame, with `fov`. */
    // The cinematic camera eases toward its pose at about rate 2 per second, so it trails a
    // moving subject by velocity / 2: lead the pose by `lead` seconds of travel to cancel that.
    follow(fn, fov, lead = 0.5) {
      const before = h.onFrame
      h.onFrame = (i) => {
        before?.(i)
        const v = s.player.body.linvel(), speed = Math.hypot(v.x, v.z)
        const f = speed > 3 ? { x: v.x / speed, z: v.z / speed } : h.forward(h.heading())
        const { from, to } = fn(h.pos(), f)
        const at = (p) => new V(p.x + v.x * lead, p.y + v.y * lead, p.z + v.z * lead)
        s.camera.setCinematicPose(at(from), at(to), fov)
      }
    },
    upright() { const q = s.player.body.rotation(); return 1 - 2 * (q.x * q.x + q.z * q.z) },
  }
  window.showcase = h
}

// --- shot staging -----------------------------------------------------------------------
// Each stage runs in the page before settling. It places actors (disclosed in the shot's
// `staging` text), may set showcase.onFrame to steer on the frame clock, and returns
// { frames } to run before the picture plus a check run just before it.
const STAGES = {
  lobby: { page: null, frames: 60 },

  'canyon-convoy': {
    frames: 200,
    page() {
      const s = window.syn3h, h = window.showcase, t = s.terrain
      // The sun behind and to the right: the haze glows less and the vehicles are lit.
      const spawn = s.terrain.spawnPoint(0), p = spawn.position
      const heading = h.sunHeading() + Math.PI * 0.8
      h.place(s.player, p.x, p.z, heading)
      h.companions(p, heading, [{ ahead: 34, side: -9, speed: 12 }, { ahead: 44, side: 8, speed: 12 }, { ahead: 28, side: 15, speed: 10 }, { ahead: 52, side: -2, air: 22, speed: 20 }])
      // A short push, then coast: the convoy stays ahead instead of being overtaken.
      h.onFrame = (i) => h.key('KeyW', i < 50)
    },
  },

  'volcano-fleet': {
    frames: 220,
    page() {
      const s = window.syn3h, h = window.showcase
      // On the volcano's flank, the low sun behind and to the left, the cone in view.
      const at = window.resolveCaptureTeleport(s.terrain, { landmark: 'slope' })
      const summit = s.terrain.summit()
      const back = { x: at.x + (at.x - summit.x) * 0.6, z: at.z + (at.z - summit.z) * 0.6 }
      const toCone = Math.atan2(back.x - summit.x, back.z - summit.z), sun = h.sunHeading()
      const d = Math.atan2(Math.sin(toCone - sun), Math.cos(toCone - sun))
      const heading = Math.abs(d) < Math.PI * 0.45 ? sun + Math.sign(d || 1) * Math.PI * 0.45 : toCone
      h.place(s.player, back.x, back.z, heading)
      h.companions(back, heading, [{ ahead: 30, side: -10, speed: 11 }, { ahead: 38, side: 10, speed: 11 }, { ahead: 46, side: -3, speed: 11 }, { ahead: 40, side: 5, air: 16, speed: 18 }])
      h.onFrame = (i) => h.key('KeyW', i < 50)
    },
  },

  'wings-glide': {
    frames: 80,
    // Clips start recording after this many staged frames: the camera has eased onto the car.
    preroll: 30,
    page() {
      const s = window.syn3h, h = window.showcase, t = s.terrain
      // A crest with a long drop ahead: the glide has room to show.
      const sun = h.sunHeading()
      const best = h.search((x, z, heading) => {
        if (h.wet(x, z)) return -Infinity
        const f = h.forward(heading), y = t.heightAt(x, z)
        const drop = y - Math.min(t.heightAt(x + f.x * 40, z + f.z * 40), t.heightAt(x + f.x * 80, z + f.z * 80))
        const behind = y - t.heightAt(x - f.x * 20, z - f.z * 20)
        if (!(drop > 18 && drop < 80 && behind > -4)) return -Infinity
        // Depth beyond the glide: water (a coast) 100 to 220 m ahead counts for a lot.
        // A coastline that runs along the glide: water on one side ahead, land on the other.
        let coast = 0
        for (let d = 80; d <= 200; d += 40) {
          const l = h.wet(x + f.x * d + f.z * 50, z + f.z * d - f.x * 50), r = h.wet(x + f.x * d - f.z * 50, z + f.z * d + f.x * 50)
          if (l !== r) coast++
        }
        // Keep the sun to the side: facing into it washes the haze out.
        const off = Math.abs(Math.atan2(Math.sin(heading - sun), Math.cos(heading - sun)))
        return -Math.abs(drop - 40) - Math.abs(behind) + coast * 12 - (off < 1 ? 40 : 0)
      }, { step: 32 })
      if (!best) throw new Error('no ridge found')
      const f = h.forward(best.heading)
      h.place(s.player, best.x, best.z, best.heading, 3)
      h.setVelocity(s.player.body, { x: f.x * 26, y: 4, z: f.z * 26 })
      // Wings at 0.8 s: off the crest first, then open, so a clip shows both.
      h.onFrame = (i) => { if (i === 48) h.key('Space', true); if (i === 54) h.key('Space', false) }
      // Behind and above, looking down the glide, as in the owner's canyon reference.
      h.follow((p, f) => ({ from: { x: p.x - f.x * 10 + f.z * 6, y: p.y + 5, z: p.z - f.z * 10 - f.x * 6 }, to: { x: p.x + f.x * 16 - f.z * 3, y: p.y - 5, z: p.z + f.z * 16 + f.x * 3 } }), 60)
      return { note: `ridge ${best.x.toFixed(0)},${best.z.toFixed(0)}` }
    },
    check() { const s = window.syn3h, h = window.showcase, p = h.pos(); const up = p.y - h.ground(p.x, p.z); return { ok: s.player.wingsOpen && up > 3, note: `wings ${s.player.wingsOpen ? 'open' : 'closed'}, ${up.toFixed(1)} m up` } },
  },

  'jet-tiny-world': {
    frames: 240,
    page() {
      const s = window.syn3h, h = window.showcase, t = s.terrain
      const summit = t.summit?.() ?? { x: 0, z: 0 }
      const x = summit.x + t.size * 0.22, z = summit.z + t.size * 0.1
      const heading = Math.atan2(x - summit.x, z - summit.z)
      h.place(s.player, x, z, heading, 0, h.ground(x, z) + 850)
      const f = h.forward(heading)
      h.setVelocity(s.player.body, { x: f.x * 70, y: 0, z: f.z * 70 })
      // Flight mode, then hold a gentle bank for the last stretch.
      h.onFrame = (i) => {
        if (i === 2) h.key('Space', true); if (i === 4) h.key('Space', false)
        h.key('KeyE', i > 4 && i < 60)
        h.key('KeyD', i > 60 && i < 100)
        // Look down past the jet, as a player does with the mouse: the game's own look input,
        // in CSS pixels per frame, then held so the chase camera keeps the manual view.
        window.dispatchEvent(new CustomEvent('syn3h:look', { detail: { dx: 0, dy: i > 20 && i < 56 ? 4 : 0 } }))
      }
    },
    check() {
      const s = window.syn3h, h = window.showcase, p = h.pos(), c = s.game.camera.position, up = p.y - h.ground(p.x, p.z)
      const seen = s.player.object.visible !== false
      return { ok: up > 200 && seen, note: `${up.toFixed(0)} m above ground; camera offset ${(c.x - p.x).toFixed(0)},${(c.y - p.y).toFixed(0)},${(c.z - p.z).toFixed(0)}; jet ${seen ? 'drawn' : 'hidden'}; v ${JSON.stringify(s.player.body.linvel(), (k, v) => typeof v === 'number' ? Math.round(v) : v)}` }
    },
  },

  'headlights-night': {
    frames: 160,
    page() {
      const s = window.syn3h, h = window.showcase, t = s.terrain
      const summit = t.summit?.() ?? { x: 0, z: 0 }
      const spawn = t.spawnPoint(0), p = spawn.position
      const heading = Math.atan2(p.x - summit.x, p.z - summit.z)
      h.place(s.player, p.x, p.z, heading)
      h.companions(p, heading, [{ ahead: 22, side: -10, turn: 0.6 }, { ahead: 28, side: 11, turn: -0.5 }, { ahead: 34, side: -4 }, { ahead: 26, side: 6, air: 12, speed: 6 }])
      h.onFrame = (i) => h.key('KeyW', i < 50)
    },
  },

  'swamp-river': {
    frames: 140,
    page() {
      const s = window.syn3h, h = window.showcase, t = s.terrain
      // A bank a few metres above a river: dry for 25 m ahead, water across the middle of the
      // view, a far shore beyond it, so the river reads as a river and leads the eye.
      const best = h.search((x, z, heading) => {
        const f = h.forward(heading), at = (d, side = 0) => ({ x: x + f.x * d - f.z * side, z: z + f.z * d + f.x * side })
        for (const d of [0, 10, 20, 25]) { const q = at(d); if (h.wet(q.x, q.z)) return -Infinity }
        let water = 0, level = null
        for (const d of [35, 45, 55]) for (const side of [-12, 0, 12]) { const q = at(d, side); if (h.wet(q.x, q.z)) { water++; level = t.liquidHeightAt(q.x, q.z) } }
        let far = 0
        for (const d of [90, 120, 150]) { const q = at(d); if (!h.wet(q.x, q.z)) far++ }
        const y = t.heightAt(x, z), above = level === null ? -1 : y - level
        let rough = 0
        for (const [a, b] of [[8, 0], [-8, 0], [0, 8], [0, -8]]) { const q = at(a, b); rough = Math.max(rough, Math.abs(t.heightAt(q.x, q.z) - y)) }
        return water >= 6 && far >= 1 && above > 1 && above < 10 && rough < 2 ? water + far * 2 - rough * 2 : -Infinity
      }, { step: 24 })
      if (!best) throw new Error('no river bank found')
      h.place(s.player, best.x, best.z, best.heading)
      // Companions on the near bank to either side, so the water in the middle stays clear.
      h.companions(best, best.heading, [{ ahead: 16, side: -17 }, { ahead: 22, side: 18 }, { ahead: 10, side: -28 }, { ahead: 34, side: 9, air: 12 }])
      h.onFrame = (i) => h.key('KeyW', i < 18)
      h.follow((p, f) => ({ from: { x: p.x - f.x * 10 + f.z * 2, y: p.y + 6, z: p.z - f.z * 10 - f.x * 2 }, to: { x: p.x + f.x * 40, y: p.y - 5, z: p.z + f.z * 40 } }), 64)
      return { note: `bank ${best.x.toFixed(0)},${best.z.toFixed(0)}` }
    },
  },

  'lava-night': {
    frames: 160,
    page() {
      const s = window.syn3h, h = window.showcase, t = s.terrain
      const summit = t.summit()
      let best = null
      for (let i = 0; i < 96; i++) {
        const a = i * Math.PI / 48, dx = -Math.cos(a), dz = -Math.sin(a)
        let x = summit.x + Math.cos(a) * t.size * 0.49, z = summit.z + Math.sin(a) * t.size * 0.49
        if (!h.wet(x, z)) continue
        for (let k = 0; k < 600 && h.wet(x, z); k++) { x += dx; z += dz }
        x += dx * 10; z += dz * 10
        const slope = Math.abs(t.heightAt(x + dx * 4, z + dz * 4) - t.heightAt(x - dx * 4, z - dz * 4)) + Math.abs(t.heightAt(x + dz * 3, z - dx * 3) - t.heightAt(x - dz * 3, z + dx * 3))
        const drop = t.heightAt(x, z) - (t.liquidHeightAt?.(x, z) ?? 0)
        const score = slope + Math.abs(drop - 1.5) * 0.5
        if (h.wet(x - dx * 25, z - dz * 25) && (!best || score < best.score)) best = { x, z, heading: Math.atan2(dx, dz), score }
      }
      if (!best) throw new Error('no lava shore found')
      // Face along the shore, the lava on the left, so the drive follows the beach.
      const along = best.heading + Math.PI / 2
      h.place(s.player, best.x, best.z, along)
      if (!window.__showcaseShot.drive) {
        // Two buggies parked on the beach ahead, 15 to 30 m off, with the game's own switch
        // that stops bots driving (bots.canDrive); the hovercraft and jet wait out of shot.
        s.params.set('bots.canDrive', false)
        // The beach side is the side with less lava across 5 to 40 m.
        const lava = (sign) => [5, 10, 20, 30, 40].reduce((n, d) => n + [10, 20, 30].filter((a) => { const q = h.offset(best, along, a, d * sign); return h.wet(q.x, q.z) }).length, 0)
        const land = lava(1) <= lava(-1) ? 1 : -1
        const buggies = s.bots.vehicles.filter((b) => b.kind.startsWith('buggy')), others = s.bots.vehicles.filter((b) => !b.kind.startsWith('buggy'))
        const spots = [{ ahead: 18, side: 12 * land, turn: -0.7 * land }, { ahead: 30, side: 6 * land, turn: 0.4 * land }]
        buggies.slice(0, 2).forEach((b, i) => { const q = h.offset(best, along, spots[i].ahead, spots[i].side); h.place(b, q.x, q.z, along + spots[i].turn) })
        others.concat(buggies.slice(2)).forEach((b, i) => { const q = h.offset(best, along, -90 - i * 15, 20 * land); h.place(b, q.x, q.z, along) })
      }
      if (window.__showcaseShot.drive) h.onFrame = (i) => { h.key('KeyW', true); const f = h.forward(h.heading()), p = h.pos(); const left = h.wet(p.x + f.z * 9, p.z - f.x * 9); h.key('KeyA', !left); h.key('KeyD', h.wet(p.x + f.z * 4, p.z - f.x * 4)) }
    },
    check() { return { ok: window.showcase.upright() > 0.85, note: `upright ${window.showcase.upright().toFixed(2)}` } },
  },

  'lagoon-hovercraft': {
    frames: 200,
    page() {
      const s = window.syn3h, h = window.showcase
      const sea = window.resolveCaptureTeleport(s.terrain, { landmark: 'sea', clearance: 1.5 })
      const summit = s.terrain.summit?.() ?? { x: 0, z: 0 }
      // Toward the islands, unless that faces the sun; then along the coast.
      let heading = Math.atan2(sea.x - summit.x, sea.z - summit.z)
      const sun = h.sunHeading(), d = Math.atan2(Math.sin(heading - sun), Math.cos(heading - sun))
      if (Math.abs(d) < Math.PI / 2) heading += Math.sign(d || 1) * (Math.PI / 2 - Math.abs(d) + 0.3)
      h.place(s.player, sea.x, sea.z, heading, 1.5)
      h.companions(sea, heading, [{ ahead: 34, side: -12, speed: 12 }, { ahead: 42, side: 12, speed: 12 }, { ahead: 50, side: 0, speed: 12 }, { ahead: 40, side: 6, air: 16, speed: 16 }])
      h.onFrame = (i) => h.key('KeyW', i < 60)
    },
  },
}

// --- browser work -----------------------------------------------------------------------
async function features(page) {
  return page.evaluate(() => {
    const s = window.syn3h
    return {
      params: s.params.all().map((p) => p.def?.id ?? p.id),
      vehicles: [s.player?.kind].filter(Boolean),
      planets: (s.planets?.PLANETS ?? []).map((p) => p.id),
    }
  })
}

/** Open a shot: load, force the top quality, install the helpers. */
async function openShot(browser, shot) {
  const context = await browser.newContext({ viewport: { width: VIEW.width, height: VIEW.height }, deviceScaleFactor: VIEW.dpr })
  await context.addInitScript(installClock)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  // A WebGPU validation error means some frames were rejected and the canvas may be stale
  // while the HTML interface moves on: such a picture is not the game, so the shot fails.
  errors.gpu = []
  page.on('console', (m) => { const t = m.text(); if (/GPUValidationError|pipeline creation failed|device (was )?lost/i.test(t)) errors.gpu.push(t.slice(0, 300)) })
  await page.goto(sceneUrl(base, shot, runTag), { waitUntil: 'load' })
  await page.waitForFunction(() => window.syn3h?.game?.tick > 30, null, { timeout: 180000 })
  // Cinematic, fixed: automatic relief off, the clock of the sky stopped, no idle autopilot.
  await page.evaluate((shot) => {
    const s = window.syn3h
    const set = (id, v) => { if (s.params.get(id)) s.params.set(id, v) }
    set('gfx.auto', false); set('gfx.quality', 5); set('daydream.seconds', 0); set('sun.dayLength', 0)
    for (const [id, v] of Object.entries(shot.params ?? {})) set(id, v)
    window.__showcaseShot = shot
  }, shot)
  await page.evaluate(pageHelpers)
  await page.addScriptTag({ content: `window.resolveCaptureTeleport = ${resolveCaptureTeleport.toString()}` })
  return { context, page, errors }
}

async function enterWorld(page, shot) {
  const mode = hudModeOf(shot)
  await page.evaluate((mode) => {
    const s = window.syn3h
    if (mode !== null && s.params.get('hud.mode')) s.params.set('hud.mode', mode)
    // From here the page runs on the frame clock, so everything the game measures in frames
    // (bot pacing, the descent, the staged world rebuild) sees a steady 60 fps.
    window.__showcaseClock.start()
    s.shell.play(); document.activeElement?.blur?.()
  }, mode)
  const entered = await page.evaluate(() => window.__showcaseClock.until('entered', 3600))
  if (entered < 0) throw new Error('the world did not finish entering within 60 s of game time')
  const bots = await page.evaluate(() => window.__showcaseClock.until('bots', 2400))
  if (bots < 0) console.log(`  bots: only ${await page.evaluate(() => window.syn3h.bots.vehicles.length)} arrived within 40 s of game time`)
  // The controls card shown on arrival is a passing notice; let it go as it would in play.
  await page.waitForFunction(() => { const c = document.querySelector('.spawn-help'); return !c || c.hidden || getComputedStyle(c).opacity === '0' }, null, { timeout: 15000 }).catch(() => {})
  await page.evaluate(() => document.fonts.ready)
}

async function waitLobby(page) {
  await page.waitForFunction(() => {
    const galaxy = window.syn3h?.shell?.galaxy
    if (!galaxy?.live || document.documentElement.dataset.boot !== 'done') return false
    return [...document.querySelectorAll('.galaxy-label')].filter((l) => { const b = l.getBoundingClientRect(); return b.width > 0 && Number(getComputedStyle(l).opacity) > 0 }).length >= 3
  }, null, { timeout: 60000 })
  await page.evaluate(() => document.fonts.ready)
}

async function rgbOf(png) {
  const child = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vf', 'scale=320:180', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
  const chunks = []
  child.stdout.on('data', (c) => chunks.push(c))
  child.stdin.end(png)
  await new Promise((ok, fail) => child.on('close', (code) => code === 0 ? ok() : fail(new Error(`ffmpeg decode exited ${code}`))))
  return Buffer.concat(chunks)
}

async function shoot(cdp, format) {
  const { data } = await cdp.send('Page.captureScreenshot', format === 'png' ? { format: 'png' } : { format: 'jpeg', quality: 92, optimizeForSpeed: true })
  return Buffer.from(data, 'base64')
}

/** Run a shot's staging and settling on the frame clock. Returns the pose note. */
/**
 * Run a shot's staging on the frame clock. A still stages, runs the recipe's frames, then
 * settles. A clip settles first where the player arrived, then stages, so the recording
 * starts at the staged moment (the launch off the ridge, say) rather than after it.
 */
async function stage(page, shot, { clip = false } = {}) {
  const id = shot.stage ?? shot.id
  const recipe = STAGES[id]
  if (!recipe) throw new Error(`no staging for ${id}`)
  await page.evaluate(() => window.__showcaseClock.start())
  let settle = null
  if (clip) settle = await page.evaluate((o) => window.__showcaseClock.settle(o), SETTLE)
  // Staging counts its frames from here.
  await page.evaluate(() => { window.showcase.t0 = window.__showcaseClock.frames })
  const note = recipe.page ? await page.evaluate(`(function ${recipe.page.toString()})()`) : null
  if (clip) { await page.evaluate((n) => window.__showcaseClock.step(n), recipe.preroll ?? 6); return { note: note?.note ?? null, settle, check: recipe.check } }
  await page.evaluate((n) => window.__showcaseClock.step(n), recipe.frames)
  settle = await page.evaluate((o) => window.__showcaseClock.settle(o), SETTLE)
  const check = recipe.check ? await page.evaluate(`(function ${recipe.check.toString()})()`) : { ok: true }
  return { ok: check.ok, note: [note?.note, check.note].filter(Boolean).join('; ') || null, settle }
}

async function captureShot(browser, shot) {
  const started = Date.now()
  const { context, page, errors } = await openShot(browser, shot)
  try {
    const cdp = await context.newCDPSession(page)
    if (shot.hud === 'lobby') await waitLobby(page)
    const have = await features(page)
    if (shot.vehicle && shot.hud !== 'lobby') have.vehicles.push(shot.vehicle) // checked after entry below
    const missing = missingFeature(shot, have)
    if (missing) return { skipped: missing }
    if (shot.hud !== 'lobby') {
      await enterWorld(page, shot)
      const kind = await page.evaluate(() => window.syn3h.player.kind)
      if (shot.vehicle && kind !== shot.vehicle) return { skipped: `build spawned ${kind}, not ${shot.vehicle}` }
    }
    const build = await page.evaluate(() => ({ backend: window.syn3h.game.backend ?? null, quality: window.syn3h.game.quality.getQualityState?.()?.name ?? null, hudMode: window.syn3h.params.get('hud.mode')?.value ?? null, canvas: [window.syn3h.game.renderer.domElement.width, window.syn3h.game.renderer.domElement.height] }))
    const names = assetNames(shot)
    if (shot.kind === 'still') {
      const pose = await stage(page, shot)
      if (errors.gpu.length) return { failed: `${errors.gpu.length} WebGPU errors, first: ${errors.gpu[0]}` }
      const png = await shoot(cdp, 'png')
      const stats = frameStats(await rgbOf(png))
      const verdict = judgeFrame(stats, FRAME_LIMITS)
      if (!verdict.ok) return { failed: verdict.reason, stats }
      await writeFile(join(outDir, names.png), png)
      return { record: { ...pick(shot), files: names, pose: pose.note, poseOk: pose.ok, settle: pose.settle, stats, render: build, pageErrors: errors, seconds: Math.round((Date.now() - started) / 1000) } }
    }
    // A clip: the lobby dive starts from the lobby with a real key press; the others stage first.
    const frames = join(outDir, `.${shot.id}-frames`)
    await rm(frames, { recursive: true, force: true }); await mkdir(frames, { recursive: true })
    let pose = { note: null, ok: true }
    if (shot.hud === 'lobby') {
      await page.evaluate(() => { const s = window.syn3h; if (s.params.get('hud.mode')) s.params.set('hud.mode', 1); s.params.set('gfx.auto', false); s.params.set('gfx.quality', 5) })
      await page.evaluate(() => window.__showcaseClock.start())
      await page.evaluate((o) => window.__showcaseClock.settle(o), SETTLE)
      await page.locator('.galaxy-label.is-current').focus()
      await page.keyboard.press('Enter')
    } else {
      pose = await stage(page, shot, { clip: true })
    }
    const total = Math.round(shot.seconds * CLIP.fps)
    for (let i = 0; i < total; i++) {
      await page.evaluate(() => window.__showcaseClock.step(1))
      await writeFile(join(frames, `${String(i + 1).padStart(4, '0')}.jpg`), await shoot(cdp, 'jpeg'))
      if (i % 60 === 59) console.log(`  ${shot.id}: ${i + 1}/${total} frames`)
    }
    if (errors.gpu.length) return { failed: `${errors.gpu.length} WebGPU errors, first: ${errors.gpu[0]}` }
    if (pose.check) {
      const check = await page.evaluate(`(function ${pose.check.toString()})()`)
      pose = { ok: check.ok, note: [pose.note, check.note].filter(Boolean).join('; ') || null }
    }
    const middle = await readFile(join(frames, `${String(Math.ceil(total / 2)).padStart(4, '0')}.jpg`))
    const stats = frameStats(await rgbOf(middle))
    const verdict = judgeFrame(stats, FRAME_LIMITS)
    if (!verdict.ok) return { failed: `middle frame ${verdict.reason}`, stats }
    return { record: { ...pick(shot), files: names, pose: pose.note, poseOk: pose.ok, frames: total, stats, render: build, pageErrors: errors, seconds: Math.round((Date.now() - started) / 1000) } }
  } finally {
    await context.close()
  }
}

const pick = (shot) => ({ id: shot.id, kind: shot.kind, hud: shot.hud, title: shot.title, staging: shot.staging, planet: shot.planet ?? null, seed: shot.seed, vehicle: shot.vehicle ?? null, params: shot.params ?? {}, reference: shot.reference, extra: Boolean(shot.extra) })

// --- encoding ---------------------------------------------------------------------------
async function encodeStill(record) {
  const png = join(outDir, record.files.png)
  // Full size: PNG decoded to PPM by ffmpeg, then libjpeg-turbo at quality 93, 4:4:4.
  const ppm = await new Promise((ok, fail) => {
    const child = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', png, '-f', 'image2pipe', '-vcodec', 'ppm', 'pipe:1'])
    const chunks = []; child.stdout.on('data', (c) => chunks.push(c))
    child.on('close', (code) => code === 0 ? ok(Buffer.concat(chunks)) : fail(new Error(`ppm ${code}`)))
  })
  const jpeg = await new Promise((ok, fail) => {
    const child = spawn(CJPEG, fullJpegArgs())
    const chunks = []; child.stdout.on('data', (c) => chunks.push(c))
    child.on('close', (code) => code === 0 ? ok(Buffer.concat(chunks)) : fail(new Error(`cjpeg ${code}`)))
    child.stdin.end(ppm)
  })
  await writeFile(join(outDir, record.files.full), jpeg)
  await run(CWEBP, readmeWebpArgs(png, join(outDir, record.files.readme)))
}

async function encodeClip(record) {
  const frames = join(outDir, `.${record.id}-frames`)
  await run(FFMPEG, mp4Args({ pattern: join(frames, '%04d.jpg'), output: join(outDir, record.files.mp4) }))
  // The README copy: every second frame (30 fps), scaled, as an animated WebP.
  const small = join(frames, 'small')
  await mkdir(small, { recursive: true })
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(CLIP.fps), '-i', join(frames, '%04d.jpg'),
    '-vf', `fps=${CLIP.webpFps},scale=${CLIP.webpWidth}:-2:flags=lanczos`, '-q:v', '2', join(small, '%04d.jpg')])
  const list = (await readdir(small)).filter((f) => f.endsWith('.jpg')).sort().map((f) => join(small, f))
  await run(IMG2WEBP, webpAnimArgs({ frames: list, output: join(outDir, record.files.webp) }), { maxBuffer: 1 << 26 })
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', list[Math.floor(list.length / 2)], '-q:v', '2', join(outDir, record.files.poster)])
  await rm(frames, { recursive: true, force: true })
}

// --- publishing -------------------------------------------------------------------------
async function publish() {
  const manifest = JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8'))
  const files = ['manifest.json']
  for (const c of manifest.captured) for (const [kind, file] of Object.entries(c.files)) if (kind !== 'png') files.push(file)
  for (const file of files) await access(join(outDir, file))
  console.log(`uploading ${files.length} files to ${repo} release ${version}`)
  await run('gh', ['release', 'upload', version, ...files.map((f) => join(outDir, f)), '--clobber', '--repo', repo], { maxBuffer: 1 << 24 })
  const readmePath = join(root, 'README.md')
  const readme = await readFile(readmePath, 'utf8')
  const date = manifest.generatedAt?.slice(0, 10)
  await writeFile(readmePath, replaceReadmeSection(readme, renderReadmeSection({ repo, version, captured: manifest.captured, date })))
  console.log('README showcase block rewritten; review and commit it: git diff README.md')
}

// --- the run ----------------------------------------------------------------------------
const t0 = Date.now()
try {
  const build = await (await fetch(new URL('build.json', base))).json()
  console.log(`build ${build.id} (${String(build.commit).slice(0, 8)}) -> ${outDir}`)
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: GPU_ARGS })
  const captured = [], skipped = []
  try {
    for (const shot of shots) {
      console.log(`shot ${shot.id}`)
      let result
      try { result = await captureShot(browser, shot) } catch (error) { result = { failed: String(error.message).split('\n')[0] } }
      if (result.record) {
        captured.push(result.record)
        console.log(`  ok in ${result.record.seconds} s${result.record.pose ? ` (${result.record.pose})` : ''}${result.record.poseOk === false ? ' POSE MISSED' : ''}`)
      } else {
        skipped.push({ id: shot.id, title: shot.title, reason: result.skipped ?? `capture failed: ${result.failed}` })
        console.log(`  skipped: ${skipped.at(-1).reason}`)
      }
    }
  } finally {
    await browser.close()
  }
  stopServer()
  for (const record of captured) {
    if (record.kind === 'still') await encodeStill(record); else await encodeClip(record)
    record.bytes = {}
    for (const [kind, file] of Object.entries(record.files)) record.bytes[kind] = (await stat(join(outDir, file))).size
  }
  const seconds = Math.round((Date.now() - t0) / 1000)
  const manifest = buildManifest({
    version, build, captured, skipped, seconds, generatedAt: new Date().toISOString(),
    browser: { channel: 'chrome', headless: false, viewport: `${VIEW.width}x${VIEW.height}`, deviceScaleFactor: VIEW.dpr, clock: 'virtual, 60 fps', readmeWidth: README_WIDTH, preview },
  })
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`captured ${captured.length}, skipped ${skipped.length} in ${seconds} s -> ${outDir}`)
  if (skipped.length) console.log(`skipped: ${skipped.map((s) => `${s.id} (${s.reason})`).join('; ')}`)
  if (options.publish) {
    if (preview) throw new Error('Refusing to publish a --preview capture')
    if (!captured.length) throw new Error('Nothing captured; nothing published')
    await publish()
  }
} finally {
  stopServer()
}
