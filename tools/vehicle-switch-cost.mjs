#!/usr/bin/env node
/**
 * What a vehicle switch costs in play, after an in-play level change. For each backend and level:
 * enter, choose the level as a player does (quality.setLevel, behind the shell's veil), then switch
 * through every ordered pair of the player vehicles twice (first and repeat), standing still with
 * the camera orbited away. Per switch it prints render pipelines created, the frame with the most
 * script time in the two seconds after (with its biggest spans), the same for two seconds with no
 * switch, and how far the camera's yaw and pitch moved on the switch.
 *
 * Fails (exit 1) when any switch creates a render pipeline: nothing should be built in play.
 * Frame intervals are not judged: headless Chrome on a loaded machine paces frames slowly with or
 * without a switch, so script time per frame is the measure here.
 *
 *   MIRA_URL=http://127.0.0.1:<port>/ node tools/vehicle-switch-cost.mjs [--levels=2,3] [--backends=webgpu,webgl] [--out=file.json]
 *
 * Run it inside one tools/heavy.sh job with its own dev server (tests/ui/README.md).
 */
import { chromium } from 'playwright-core'
import { writeFile } from 'node:fs/promises'

const arg = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback
const base = process.env.MIRA_URL
if (!base) { console.error('vehicle-switch-cost: set MIRA_URL to a dev server'); process.exit(2) }
const levels = arg('levels', '0,1,2,3,4,5').split(',').map(Number)
const backends = arg('backends', 'webgpu,webgl').split(',')
const out = arg('out', '')
// From the buggy: every ordered pair of buggy, jet and hovercraft.
const ORDER = ['jet', 'hovercraft', 'buggy', 'hovercraft', 'jet', 'buggy']

const rows = [], failures = []
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] })
try {
  for (const backend of backends) for (const level of levels) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${base}?autoplay=1${backend === 'webgl' ? '&webgl=1' : ''}&room=switch-cost-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.game.tick > 60, null, { timeout: 180000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 180000 })
    await page.waitForFunction(() => !window.mira.game.scene.userData.playerVehicleCache?.pending, null, { timeout: 120000 }).catch(() => {})
    // Standing still, Auto off, and the level chosen in play as a player does.
    const veilStart = Date.now()
    await page.evaluate(level => { mira.params.set('daydream.seconds', 0); mira.params.set('gfx.auto', false); mira.game.quality.setLevel(level) }, level)
    // A level change still behind its veil leaves nothing drawn: every switch measured then is
    // meaningless, and the first frame after it builds the level's own pipelines. Fail instead.
    const lifted = await page.waitForFunction(level => mira.params.get('gfx.quality').value === level && !document.querySelector('.quality-change-veil') && !mira.shell.qualityVeil, level, { timeout: 120000 }).then(() => true, () => false)
    const veilMs = Date.now() - veilStart
    console.log(`${backend} L${level}: quality change veil ${lifted ? `lifted after ${veilMs} ms` : 'still up after 120 s'}`)
    if (!lifted) { failures.push(`${backend} L${level}: the quality change veil did not lift within 120 s; no switch measured`); await page.close(); continue }
    await page.waitForTimeout(3000)
    // Every pipeline created, with what it is for (material, object and the chain above it).
    await page.evaluate(() => {
      const b = mira.game.renderer.backend, make = b.createRenderPipeline
      window.__switchBuilt = []
      // Frames the game draws to the player's camera, to tell a page that is playing from one that is not.
      const r = mira.game.renderer, render = r.render
      window.__mainDraws = 0
      r.render = function (scene, camera, ...rest) { if (camera === mira.game.camera) window.__mainDraws++; return render.call(this, scene, camera, ...rest) }
      b.createRenderPipeline = function (ro, ...rest) {
        const m = ro?.material, o = ro?.object, chain = []
        for (let p = o; p && chain.length < 7; p = p.parent) chain.push(p.name || p.type)
        window.__switchBuilt.push(`${m?.type ?? '?'}${m?.name ? ` "${m.name}"` : ''} | ${o?.type ?? '?'}${o?.name ? ` "${o.name}"` : ''} | camera ${ro?.camera === mira.game.camera ? 'main' : ro?.camera?.type ?? '?'} | ${chain.join(' < ')}`)
        return make.call(this, ro, ...rest)
      }
    })
    const setting = await page.evaluate(() => ({ backend: mira.game.backend, level: mira.params.get('gfx.quality').value }))
    for (const round of ['first', 'repeat']) for (const kind of ORDER) {
      const row = await page.evaluate(async kind => {
        const { longFrames } = await import('/src/core/longFrames.ts')
        const game = mira.game, camera = game.camera
        const angles = () => { const e = new (camera.rotation.constructor)().setFromQuaternion(camera.quaternion, 'YXZ'); return [e.y, e.x] }
        const frame = () => new Promise(r => requestAnimationFrame(() => r()))
        // Orbit away from behind first, as a player looking around would, and let the view
        // finish easing there: the angles compared below are the drawn camera's, which follow the
        // orbit through a short slerp. Settled means under 0.05° of change between frames.
        mira.camera.look(300, -40)
        for (let i = 0, last = angles(); i < 180; i++) { await frame(); const now = angles(); if (Math.abs(now[0] - last[0]) + Math.abs(now[1] - last[1]) < 0.05 * Math.PI / 180) break; last = now }
        window.__switchBuilt.length = 0; const from = mira.player.kind, cursor = longFrames.read().cursor, made = game.pipelineCounter.created, before = angles()
        const t0 = performance.now()
        const drawnBefore = window.__mainDraws
        mira.swapVehicle(kind)
        const swapMs = performance.now() - t0
        await frame(); await frame()
        const after = angles()
        await new Promise(r => setTimeout(r, 2000))
        const frames = longFrames.read(cursor).frames, pipelines = game.pipelineCounter.created - made, drawn = window.__mainDraws - drawnBefore
        const heaviest = list => list.reduce((a, b) => (b.callbackMs > (a?.callbackMs ?? -1) ? b : a), null)
        const heavy = heaviest(frames)
        const spans = (heavy?.spans ?? []).sort((a, b) => b.ms - a.ms).slice(0, 3).map(s => `${s.name} ${s.ms.toFixed(1)}`)
        const baseCursor = longFrames.read().cursor
        await new Promise(r => setTimeout(r, 2000))
        const quiet = heaviest(longFrames.read(baseCursor).frames)
        const wrap = a => Math.atan2(Math.sin(a), Math.cos(a))
        return { from, to: mira.player.kind, swapMs: +swapMs.toFixed(1), pipelines, maxScriptMs: +(heavy?.callbackMs ?? 0).toFixed(1), spans,
          quietMaxScriptMs: +(quiet?.callbackMs ?? 0).toFixed(1), drawn, built: window.__switchBuilt.slice(), yawDeg: +(wrap(after[0] - before[0]) * 180 / Math.PI).toFixed(1), pitchDeg: +((after[1] - before[1]) * 180 / Math.PI).toFixed(1) }
      }, kind)
      // A switch is only measured if the game drew frames through it (a headless page draws 10 to 30
      // a second; a page behind a veil or paused draws none) and the camera's orbit moved
      // (the orbit is how the probe looks round; a still camera means the page is not playing).
      const invalid = row.drawn < 5 ? 'invalid: page not drawing' : Math.abs(row.yawDeg) + Math.abs(row.pitchDeg) < 1 ? 'invalid: camera did not move' : ''
      const line = { ...setting, round, ...row, invalid }
      rows.push(line)
      if (invalid) failures.push(`${line.backend} L${line.level} ${round} ${line.from} -> ${line.to}: ${invalid} (${row.drawn} frames drawn, yaw ${row.yawDeg}°)`)
      console.log(`${line.backend} L${line.level} ${round} ${line.from} -> ${line.to}: ${invalid ? `${invalid}; ` : ''}pipelines ${line.pipelines}, frames drawn ${row.drawn}, swap ${line.swapMs} ms, worst script ${line.maxScriptMs} ms (quiet ${line.quietMaxScriptMs}) [${line.spans.join(', ')}], yaw ${line.yawDeg}°, pitch ${line.pitchDeg}°`)
      if (line.built.length) { const g = {}; for (const x of line.built) g[x] = (g[x] ?? 0) + 1; for (const [k, n] of Object.entries(g)) console.log(`    ${n} x ${k}`) }
    }
    if (errors.length) console.log('page errors:', errors.slice(0, 3).join(' | '))
    await page.close()
  }
} finally { await browser.close() }
if (out) await writeFile(out, JSON.stringify(rows, null, 1))
const built = rows.filter(r => !r.invalid && r.pipelines > 0)
for (const f of failures) console.log(`INVALID: ${f}`)
console.log(built.length ? `FAIL: ${built.length} switches built pipelines in play` : failures.length ? `INVALID: ${failures.length} problems above; nothing was measured there` : `OK: ${rows.length} switches, no pipelines built in play`)
process.exit(built.length || failures.length ? 1 : 0)
