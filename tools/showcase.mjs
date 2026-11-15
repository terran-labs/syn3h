#!/usr/bin/env node
/**
 * Capture the release showcase: a fixed set of scenes from a frozen Syn3h build, one PNG
 * per scene, a looping GIF and a manifest. See docs/RELEASE-SHOWCASE.md.
 *
 *   tools/heavy.sh node tools/showcase.mjs \
 *     --dir ../Syn3h-stable/20261114-200625-bc8cb48 --version v26.11.1401 --port 5348
 *
 * Options:
 *   --dir      frozen build directory (dist/ plus server source), served with serve-stable
 *   --url      use an already running server instead of --dir (it is not stopped)
 *   --version  release version for the manifest and the output folder, e.g. v26.11.1401
 *   --port     port for the server this tool starts (default 5348)
 *   --out      output root (default /tmp/syn3h-showcase); files go to <out>/<version>/
 *   --only     comma separated scene ids, for staging work; the GIF then holds only those
 *   --headless run Chrome headless with the GPU flags tools/smoke.mjs uses (default headed)
 *   --hold     seconds each still is held in the GIF (default 1.5)
 *
 * Each scene opens in a fresh browser context and a fresh room with a fixed seed. Staging
 * runs inside the page through window.syn3h. A frame is accepted only after the scene's
 * pose check passes and the frame's measured colour statistics pass judgeFrame(); a scene
 * whose build lacks a feature is skipped with a reason, not failed.
 */
import { spawn, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { resolveCaptureTeleport } from './capture-landmarks.mjs'
import {
  FRAME_LIMITS, SCENES, MAX_GIF_BYTES, buildManifest, concatScript, frameStats, gifArgs, judgeFrame,
  missingFeature, parseArgs, sceneUrl,
} from './lib/showcase-scenes.mjs'

const run = promisify(execFile)
const FFMPEG = process.env.FFMPEG ?? '/opt/homebrew/bin/ffmpeg'
const GPU_ARGS = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist']
const WIDTH = 1280, HEIGHT = 720
const here = fileURLToPath(new URL('.', import.meta.url))

const options = parseArgs(process.argv.slice(2), ['dir', 'url', 'version', 'port', 'out', 'only', 'headless', 'hold'])
if (!options.version || !/^v[\w.-]+$/.test(options.version)) throw new Error('--version is required, like v26.11.1401')
if (!options.dir === !options.url) throw new Error('Give exactly one of --dir or --url')
const hold = Number(options.hold ?? 1.5)
const only = typeof options.only === 'string' ? options.only.split(',') : null
const scenes = only ? SCENES.filter((s) => only.includes(s.id)) : SCENES
if (only && scenes.length !== only.length) throw new Error(`Unknown scene in --only; known: ${SCENES.map((s) => s.id).join(', ')}`)
const outDir = resolve(options.out ?? '/tmp/syn3h-showcase', options.version)
const runTag = Date.now().toString(36)

// --- the server -------------------------------------------------------------------------
let server = null
let base = options.url
if (options.dir) {
  const port = Number(options.port ?? 5348)
  if (!(port > 1024 && port < 65536)) throw new Error('Bad --port')
  server = spawn(process.execPath, [join(here, 'serve-stable.mjs'), '--dir', resolve(options.dir), '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'] })
  console.log(`server pid ${server.pid} on port ${port}`)
  await new Promise((ok, fail) => {
    server.stdout.on('data', (d) => { if (String(d).includes('listening')) ok() })
    server.once('exit', (code) => fail(new Error(`serve-stable exited with ${code}`)))
  })
  base = `http://127.0.0.1:${port}/`
}
const stopServer = () => { if (server && server.exitCode === null) server.kill('SIGTERM') }
process.on('exit', stopServer)

// --- in-page helpers, installed into every scene page -----------------------------------
/* eslint-disable no-undef */
function pageHelpers() {
  const s = window.syn3h
  const V = s.game.camera.position.constructor
  const h = {
    V,
    key(code, down) { window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true })) },
    forward(heading) { return { x: -Math.sin(heading), z: -Math.cos(heading) } },
    pos() { const t = s.player.body.translation(); return { x: t.x, y: t.y, z: t.z } },
    // Forward is -Z turned by the heading, so heading = atan2(-forward.x, -forward.z).
    heading(body = s.player.body) { const q = body.rotation(); return Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)) },
    ground(x, z) { return Math.max(s.terrain.heightAt(x, z), s.terrain.liquidHeightAt?.(x, z) ?? -Infinity) },
    teleport(body, x, z, heading, clearance = 1.5, y) {
      const at = new V(x, y ?? h.ground(x, z) + clearance, z)
      if (body === s.player) s.player.teleport(at, heading)
      else body.teleport(at, heading)
    },
    /**
     * Hold the camera at a pose computed each frame from the player, until cleared. The
     * cinematic camera eases toward its pose at about rate 2 per second, so a moving player
     * would trail by velocity / 2; leading the pose by `lead` seconds of travel offsets that.
     * Use 0 to let the camera trail on purpose.
     */
    follow(fn, lead = 0.5) {
      h.stopFollow?.()
      let live = true
      const tick = () => {
        if (!live) return
        const { from, to } = fn(), v = s.player.body.linvel()
        s.camera.setCinematicPose(new V(from.x + v.x * lead, from.y + v.y * lead, from.z + v.z * lead), new V(to.x + v.x * lead, to.y + v.y * lead, to.z + v.z * lead))
        requestAnimationFrame(tick)
      }
      tick()
      h.stopFollow = () => { live = false; s.camera.clearCinematicPose?.() }
    },
    setVelocity(body, v) { body.setLinvel(v, true) },
  }
  window.showcase = h
}
/* eslint-enable no-undef */

// CSS that hides the controls card, the diagnostic panels and the menu chrome. The score
// scene keeps the scoreboard rows but not the developer lines.
const HIDE_CSS = `
  #hud, .tp-dfwv, .tp-rotv, .param-panel, .shell-minimap, .hud-navigation, .spawn-help,
  .shell-toast, .match-announcement, .shell-controls, .vehicle-help, .play-hints, .touch-controls, .syn3h-touch,
  .score-detail.is-developer, .build-line, .syn3h-nametags, .lobby-footer, .diagnostics, .syn3h-diagnostics
  { display: none !important; }
  * { cursor: none !important; }`
const HIDE_HUD = '.shell-hud { display: none !important; }'
const HIDE_LOBBY_INVITE = '.lobby-room-label, .invite-qr, .invite-link, .shell-invite, .lobby-message p:not(:first-child) { display: none !important; }'

// --- scene staging ----------------------------------------------------------------------
// Each stage runs in the page. It returns { ok, note } from a pose check made just before
// the screenshot; ok false means the intended pose was not reached and the frame is retried.
const STAGES = {
  async lobby(page) {
    await page.waitForFunction(() => document.querySelectorAll('.planet-card canvas').length >= 3, null, { timeout: 30000 })
    await page.waitForTimeout(4000)
    return { ok: true }
  },

  async 'buggy-volcano'(page) {
    // From the spawn pad the road runs toward the volcano. Drive up it with the normal chase
    // camera, which frames the car, the road and the peak together.
    await roadDrive(page, 4500)
    return page.evaluate(() => {
      const v = window.syn3h.player.body.linvel()
      return { ok: window.syn3h.player.wheelsGrounded > 0, note: `speed ${Math.hypot(v.x, v.z).toFixed(1)} m/s` }
    })
  },

  async 'wings-glide'(page) {
    // Launch from high above a dune field with forward speed, open the wings with Space and
    // glide. The pose check needs the wings open and the car well clear of the ground.
    await page.evaluate(() => {
      const s = window.syn3h, h = window.showcase
      const d = window.resolveCaptureTeleport(s.terrain, { landmark: 'dune' })
      h.teleport(s.player, d.x, d.z, d.heading, 0, h.ground(d.x, d.z) + 28)
      const f = h.forward(d.heading)
      h.setVelocity(s.player.body, { x: f.x * 26, y: 2, z: f.z * 26 })
      s.game.input.state.special = true
      h.follow(() => {
        const p = h.pos(), f = h.forward(h.heading())
        return { from: { x: p.x - f.x * 7 + f.z * 4, y: p.y + 4, z: p.z - f.z * 7 - f.x * 4 }, to: { x: p.x + f.x * 6, y: p.y - 1.5, z: p.z + f.z * 6 } }
      }, 0.25)
    })
    await page.waitForTimeout(2600)
    return page.evaluate(() => {
      const s = window.syn3h, h = window.showcase, p = h.pos()
      const above = p.y - h.ground(p.x, p.z)
      return { ok: s.player.wingsOpen && above > 4, note: `wings ${s.player.wingsOpen ? 'open' : 'closed'}, ${above.toFixed(1)} m up` }
    })
  },

  async 'bots-pursuit'(page) {
    // From the spawn pad, line the bots up behind the player, all rolling the same way, and
    // let their chase steering run for a moment. The camera sits ahead looking back at the pack.
    await page.waitForFunction(() => window.syn3h.bots.vehicles.length >= 4, null, { timeout: 20000 })
    await page.evaluate(() => {
      const s = window.syn3h, h = window.showcase
      const spawn = s.terrain.spawnPoint(0), heading = spawn.heading, f = h.forward(heading)
      const start = { x: spawn.position.x + f.x * 20, z: spawn.position.z + f.z * 20 }
      h.teleport(s.player, start.x, start.z, heading, 1.2)
      h.setVelocity(s.player.body, { x: f.x * 15, y: 0, z: f.z * 15 })
      s.bots.vehicles.forEach((bot, i) => {
        const back = 9 + i * 5, side = (i % 2 ? 1 : -1) * (3 + 1.5 * i)
        h.teleport(bot, start.x - f.x * back + f.z * side, start.z - f.z * back - f.x * side, heading, 1.2)
        h.setVelocity(bot.body, { x: f.x * 15, y: 0, z: f.z * 15 })
      })
      h.follow(() => {
        const p = h.pos()
        return { from: { x: p.x + f.x * 16 - f.z * 5, y: p.y + 7, z: p.z + f.z * 16 + f.x * 5 }, to: { x: p.x - f.x * 12, y: p.y, z: p.z - f.z * 12 } }
      }, 0)
    })
    await roadDrive(page, 1800, 0.5)
    return page.evaluate(() => {
      const s = window.syn3h, h = window.showcase, p = h.pos()
      const near = s.bots.vehicles.filter((b) => { const t = b.body.translation(); return Math.hypot(t.x - p.x, t.z - p.z) < 40 }).length
      return { ok: near >= 4, note: `${near} bots within 40 m` }
    })
  },

  async 'tag-beam'(page, scene, attempt, ctx) {
    // A second player joins the same room and parks ahead. The player sends a quick run of
    // slow tag beams at it, so the bolts string out along the line between the two.
    const other = await ctx.openPeer(scene, 'buggy')
    await page.waitForFunction(() => window.syn3hNet?.remotes?.size > 0 || document.querySelectorAll('.syn3h-nametags *').length > 0, null, { timeout: 20000 }).catch(() => {})
    const target = await other.evaluate(() => {
      const s = window.syn3h, h = window.showcase
      return { ...h.pos(), heading: h.heading() }
    })
    await page.evaluate((target) => {
      const s = window.syn3h, h = window.showcase
      const heading = target.heading, f = h.forward(heading)
      h.teleport(s.player, target.x - f.x * 18, target.z - f.z * 18, heading, 1.2)
    }, target)
    await page.waitForTimeout(2500)
    return page.evaluate(() => new Promise((done) => {
      const s = window.syn3h, h = window.showcase
      const p = h.pos(), f = h.forward(h.heading())
      h.follow(() => ({ from: { x: p.x + f.x * 9 - f.z * 21, y: p.y + 6, z: p.z + f.z * 9 + f.x * 21 }, to: { x: p.x + f.x * 9, y: p.y + 0.5, z: p.z + f.z * 9 } }))
      setTimeout(() => {
        for (let i = 0; i < 8; i++) setTimeout(() => window.syn3hNet.fire(), i * 110)
        setTimeout(() => done({ ok: window.syn3hNet.lasers.count >= 3, note: `${window.syn3hNet.lasers.count} beams in flight` }), 700)
      }, 2500)
    }))
  },

  async 'jet-flight'(page) {
    // Put the jet in the air over the island, nose toward the volcano, at cruising speed.
    await page.evaluate(() => {
      const s = window.syn3h, h = window.showcase
      const summit = s.terrain.summit()
      const x = summit.x + 520, z = summit.z + 120, heading = Math.atan2(x - summit.x, z - summit.z)
      h.teleport(s.player, x, z, heading, 0, 230)
      const f = h.forward(heading)
      h.setVelocity(s.player.body, { x: f.x * 55, y: 0, z: f.z * 55 })
      h.key('KeyR', true)
    })
    await page.waitForTimeout(3500)
    await page.evaluate(() => window.showcase.key('KeyR', false))
    return page.evaluate(() => {
      const h = window.showcase, p = h.pos()
      return { ok: p.y - h.ground(p.x, p.z) > 40, note: `${(p.y - h.ground(p.x, p.z)).toFixed(0)} m above ground` }
    })
  },

  async 'hovercraft-lava'(page) {
    // Out on the lava sea, heading back toward the island, seen from the side.
    await page.evaluate(() => {
      const s = window.syn3h, h = window.showcase
      const sea = window.resolveCaptureTeleport(s.terrain, { landmark: 'sea', clearance: 1.5 })
      const summit = s.terrain.summit()
      const heading = Math.atan2(sea.x - summit.x, sea.z - summit.z)
      h.teleport(s.player, sea.x, sea.z, heading, 1.5)
      h.key('KeyW', true)
      h.follow(() => {
        const p = h.pos(), f = h.forward(h.heading())
        return { from: { x: p.x - f.x * 5 + f.z * 4, y: p.y + 2.2, z: p.z - f.z * 5 - f.x * 4 }, to: { x: p.x + f.x * 8, y: p.y + 0.8, z: p.z + f.z * 8 } }
      })
    })
    await page.waitForTimeout(3500)
    return page.evaluate(() => {
      const s = window.syn3h, h = window.showcase, p = h.pos()
      h.key('KeyW', false)
      const lava = s.terrain.liquidHeightAt?.(p.x, p.z), ground = s.terrain.heightAt(p.x, p.z)
      return { ok: lava > ground && p.y > lava - 0.5, note: `over lava by ${(p.y - lava).toFixed(1)} m` }
    })
  },

  async 'lava-night'(page) {
    // Night on the shore of the lava sea: the buggy parked facing the lava, headlights on it.
    // Search round the island for a gentle beach, so the car sits level instead of on a cliff.
    await page.evaluate(() => {
      const s = window.syn3h, h = window.showcase, t = s.terrain
      const summit = t.summit()
      const lava = (x, z) => (t.liquidHeightAt?.(x, z) ?? -Infinity) > t.heightAt(x, z)
      let best = null
      for (let i = 0; i < 96; i++) {
        const a = i * Math.PI / 48, dx = -Math.cos(a), dz = -Math.sin(a)
        let x = summit.x + Math.cos(a) * t.size * 0.49, z = summit.z + Math.sin(a) * t.size * 0.49
        if (!lava(x, z)) continue
        for (let k = 0; k < 600 && lava(x, z); k++) { x += dx; z += dz }
        x += dx * 8; z += dz * 8
        // Level over the car's footprint and a gentle run down to the lava ahead.
        const slope = Math.abs(t.heightAt(x + dx * 4, z + dz * 4) - t.heightAt(x - dx * 4, z - dz * 4)) + Math.abs(t.heightAt(x + dz * 3, z - dx * 3) - t.heightAt(x - dz * 3, z + dx * 3))
        const drop = t.heightAt(x, z) - (t.liquidHeightAt?.(x, z) ?? 0)
        const score = slope + Math.abs(drop - 1.5) * 0.5
        if (lava(x - dx * 25, z - dz * 25) && (!best || score < best.score)) best = { x, z, heading: Math.atan2(dx, dz), score }
      }
      if (!best) throw new Error('no lava shore found')
      h.teleport(s.player, best.x, best.z, best.heading, 1.2)
      h.follow(() => {
        const p = h.pos(), f = h.forward(h.heading())
        return { from: { x: p.x - f.x * 6.5 + f.z * 2.5, y: p.y + 2.6, z: p.z - f.z * 6.5 - f.x * 2.5 }, to: { x: p.x + f.x * 20, y: p.y - 1, z: p.z + f.z * 20 } }
      })
    })
    await page.waitForTimeout(5000)
    return page.evaluate(() => {
      const s = window.syn3h, h = window.showcase, p = h.pos(), f = h.forward(h.heading())
      const ahead = { x: p.x + f.x * 20, z: p.z + f.z * 20 }
      const lavaAhead = (s.terrain.liquidHeightAt?.(ahead.x, ahead.z) ?? -Infinity) > s.terrain.heightAt(ahead.x, ahead.z)
      const q = s.player.body.rotation(), upright = 1 - 2 * (q.x * q.x + q.z * q.z)
      return { ok: s.player.wheelsGrounded > 0 && lavaAhead && upright > 0.9, note: `${lavaAhead ? 'facing the lava sea' : 'no lava ahead'}, upright ${upright.toFixed(2)}` }
    })
  },

  async 'king-of-the-hill'(page) {
    // Switch the room to King of the Hill, park on the rim, and wait for the match card to
    // show a few seconds held. The normal chase camera frames the rim posts well.
    await page.evaluate(() => window.syn3h.params.set('game.mode', 1))
    await page.evaluate(() => {
      const s = window.syn3h, h = window.showcase
      const t = window.resolveCaptureTeleport(s.terrain, { landmark: 'summit' })
      h.teleport(s.player, t.x, t.z, t.heading, 1.5)
    })
    const held = () => {
      const card = document.querySelector('.match-hud:not([hidden])')
      const m = card?.querySelector('.match-score.is-you')?.textContent.match(/(\d+)\s*\/\s*\d+/)
      return m ? Number(m[1]) : 0
    }
    await page.waitForFunction(held, null, { timeout: 30000 }).catch(() => {})
    await page.waitForFunction(`(${held})() >= 6`, null, { timeout: 30000 }).catch(() => {})
    const n = await page.evaluate(held)
    return { ok: n >= 6, note: `${n} s held on the match card` }
  },

  async 'other-world'(page) {
    // The alpine world from its spawn pad, driving up the road with the normal chase camera.
    await page.evaluate(() => window.showcase.key('KeyW', true))
    await page.waitForTimeout(2800)
    return page.evaluate(() => {
      window.showcase.key('KeyW', false)
      return { ok: window.syn3h.player.wheelsGrounded > 0, note: 'driving from the pad' }
    })
  },
}

/** Drive along the volcano road with a simple steering controller for `ms`. */
async function roadDrive(page, ms, throttle = 1) {
  await page.evaluate(({ ms, throttle }) => new Promise((done) => {
    const s = window.syn3h, h = window.showcase
    const road = s.terrain.roadPaths?.().find((r) => r.kind === 'volcano')
    const pts = road?.points ?? []
    let index = 0, best = Infinity
    const p0 = h.pos()
    pts.forEach((q, i) => { const d = Math.hypot(q.x - p0.x, q.z - p0.z); if (d < best) { best = d; index = i } })
    let tick = 0
    const timer = setInterval(() => {
      tick++
      h.key('KeyW', (tick % 10) / 10 < throttle)
      if (!pts.length || best > 40) return
      const p = h.pos()
      while (index < pts.length - 6 && Math.hypot(pts[index].x - p.x, pts[index].z - p.z) < 12) index++
      const t = pts[Math.min(index + 2, pts.length - 1)]
      const want = Math.atan2(p.x - t.x, p.z - t.z), have = h.heading()
      const err = Math.atan2(Math.sin(want - have), Math.cos(want - have))
      h.key('KeyA', err > 0.06); h.key('KeyD', err < -0.06)
    }, 50)
    setTimeout(() => { clearInterval(timer); for (const k of ['KeyW', 'KeyA', 'KeyD']) h.key(k, false); done() }, ms)
  }), { ms, throttle })
}

// --- capture loop -----------------------------------------------------------------------
async function rgbOf(png) {
  // ffmpeg decodes the PNG to raw RGB at a quarter size; the statistics need no more.
  const child = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vf', 'scale=320:180', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
  const chunks = []
  child.stdout.on('data', (c) => chunks.push(c))
  child.stdin.end(png)
  await new Promise((ok, fail) => child.on('close', (code) => code === 0 ? ok() : fail(new Error(`ffmpeg decode exited ${code}`))))
  return Buffer.concat(chunks)
}

async function features(page) {
  return page.evaluate(() => {
    const s = window.syn3h
    return {
      params: s.params.all().map((p) => p.def?.id ?? p.id),
      vehicles: [s.player.kind],
      planets: (s.planets?.PLANETS ?? []).map((p) => p.id),
      net: Boolean(window.syn3hNet),
      cinematic: typeof s.camera?.setCinematicPose === 'function',
    }
  })
}

async function applyParams(page, params) {
  if (!params) return
  await page.evaluate((params) => { for (const [id, v] of Object.entries(params)) window.syn3h.params.set(id, v) }, params)
}

/** Open a scene page: load, wait for the world, hide the chrome, install the helpers. */
async function openScenePage(context, scene) {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(sceneUrl(base, scene, runTag), { waitUntil: 'load' })
  await page.waitForFunction(() => window.syn3h?.game?.tick > 30, null, { timeout: 90000 })
  await page.addStyleTag({ content: HIDE_CSS + (scene.lobby ? HIDE_LOBBY_INVITE : HIDE_HUD) })
  await page.evaluate(pageHelpers)
  await page.addScriptTag({ content: `window.resolveCaptureTeleport = ${resolveCaptureTeleport.toString()}` })
  return { page, errors }
}

async function captureScene(browser, scene) {
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 })
  const peers = []
  try {
    const { page, errors } = await openScenePage(context, scene)
    const have = await features(page)
    if (scene.vehicle && !have.vehicles.includes(scene.vehicle)) return { skipped: `build has no ${scene.vehicle}` }
    const missing = missingFeature(scene, have)
    if (missing) return { skipped: missing }
    if (!scene.lobby) {
      await page.evaluate(() => { window.syn3h.shell.play(); document.activeElement?.blur?.() })
      if (scene.vehicle !== 'jet') await page.waitForFunction(() => window.syn3h.player.wheelsGrounded > 0 || window.syn3h.player.kind === 'hovercraft', null, { timeout: 20000 }).catch(() => {})
    }
    await applyParams(page, scene.params)
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.evaluate(() => document.fonts.ready)
    const stage = STAGES[scene.id]
    if (!stage) return { skipped: 'no staging written for this scene yet' }
    // A second player in the same room, for scenes that need two vehicles. Opened once per
    // scene, in its own context so it has its own identity.
    const ctx = {
      async openPeer(peerScene, vehicle) {
        if (peers.length) return peers[0].page
        const peerContext = await browser.newContext({ viewport: { width: 640, height: 360 } })
        const peer = await openScenePage(peerContext, { ...peerScene, vehicle })
        peers.push({ context: peerContext, page: peer.page })
        await peer.page.evaluate(() => { window.syn3h.shell.play(); document.activeElement?.blur?.() })
        await peer.page.waitForTimeout(2000)
        return peer.page
      },
    }
    const limits = { ...FRAME_LIMITS, ...scene.limits }
    let last = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      const pose = await stage(page, scene, attempt, ctx)
      const png = await page.screenshot({ type: 'png' })
      const stats = frameStats(await rgbOf(png))
      const verdict = judgeFrame(stats, limits)
      last = { pose, stats, verdict }
      console.log(`  ${scene.id} attempt ${attempt}: pose ${pose.ok ? 'ok' : 'missed'}${pose.note ? ` (${pose.note})` : ''}, ${verdict.ok ? 'frame ok' : verdict.reason}`)
      if (pose.ok && verdict.ok) return { png, stats, pose, attempt, errors }
    }
    return { failed: last.verdict.ok ? `pose not reached: ${last.pose.note ?? ''}` : last.verdict.reason, stats: last.stats, errors }
  } finally {
    for (const peer of peers) await peer.context.close()
    await context.close()
  }
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

try {
  const build = await (await fetch(new URL('build.json', base))).json()
  console.log(`build ${build.id} (${build.commit.slice(0, 7)}) -> ${outDir}`)
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  const headless = Boolean(options.headless)
  const browser = await chromium.launch({ channel: 'chrome', headless, args: GPU_ARGS })
  const captured = [], skipped = [], files = []
  try {
    for (const scene of scenes) {
      console.log(`scene ${scene.id}`)
      let result
      try { result = await captureScene(browser, scene) } catch (error) { result = { failed: error.message.split('\n')[0] } }
      if (result.png) {
        const file = `${scene.id}.png`
        await writeFile(join(outDir, file), result.png)
        captured.push({ id: scene.id, title: scene.title, file, attempt: result.attempt, stats: result.stats, pose: result.pose.note ?? null, pageErrors: result.errors })
      } else {
        skipped.push({ id: scene.id, title: scene.title, reason: result.skipped ?? `capture failed: ${result.failed}`, stats: result.stats ?? null })
        console.log(`  skipped: ${skipped.at(-1).reason}`)
      }
    }
  } finally {
    await browser.close()
  }
  if (!captured.length) throw new Error('No scene captured')

  const list = join(outDir, '.concat.txt')
  await writeFile(list, concatScript(captured.map((c) => join(outDir, c.file)), hold))
  const gif = join(outDir, 'syn3h-showcase.gif')
  await run(FFMPEG, gifArgs({ list, output: gif }))
  await rm(list)
  const gifBytes = (await stat(gif)).size
  if (gifBytes > MAX_GIF_BYTES) throw new Error(`GIF is ${gifBytes} bytes, over the ${MAX_GIF_BYTES} limit`)

  for (const file of [...captured.map((c) => c.file), 'syn3h-showcase.gif']) {
    const bytes = await readFile(join(outDir, file))
    files.push({ file, bytes: bytes.length, sha256: sha256(bytes) })
  }
  const manifest = buildManifest({
    version: options.version, build, files, captured, skipped, hold,
    browser: { channel: 'chrome', headless, viewport: `${WIDTH}x${HEIGHT}`, args: GPU_ARGS },
    generatedAt: new Date().toISOString(),
  })
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`captured ${captured.map((c) => c.id).join(', ')}`)
  if (skipped.length) console.log(`skipped ${skipped.map((s) => `${s.id} (${s.reason})`).join('; ')}`)
  console.log(`gif ${gifBytes} bytes; manifest ${join(outDir, 'manifest.json')}`)
} finally {
  stopServer()
}
