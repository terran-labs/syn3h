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

const rows = []
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
    await page.evaluate(level => { mira.params.set('daydream.seconds', 0); mira.params.set('gfx.auto', false); mira.game.quality.setLevel(level) }, level)
    await page.waitForFunction(level => mira.params.get('gfx.quality').value === level && !document.querySelector('.quality-change-veil') && !mira.shell.qualityVeil, level, { timeout: 120000 }).catch(() => {})
    await page.waitForTimeout(3000)
    const setting = await page.evaluate(() => ({ backend: mira.game.backend, level: mira.params.get('gfx.quality').value }))
    for (const round of ['first', 'repeat']) for (const kind of ORDER) {
      const row = await page.evaluate(async kind => {
        const { longFrames } = await import('/src/core/longFrames.ts')
        const game = mira.game, camera = game.camera
        const angles = () => { const e = new (camera.rotation.constructor)().setFromQuaternion(camera.quaternion, 'YXZ'); return [e.y, e.x] }
        const frame = () => new Promise(r => requestAnimationFrame(() => r()))
        // Orbit away from behind first, as a player looking around would.
        mira.camera.look(300, -40); await frame(); await frame()
        const from = mira.player.kind, cursor = longFrames.read().cursor, made = game.pipelineCounter.created, before = angles()
        const t0 = performance.now()
        mira.swapVehicle(kind)
        const swapMs = performance.now() - t0
        await frame(); await frame()
        const after = angles()
        await new Promise(r => setTimeout(r, 2000))
        const frames = longFrames.read(cursor).frames, pipelines = game.pipelineCounter.created - made
        const heaviest = list => list.reduce((a, b) => (b.callbackMs > (a?.callbackMs ?? -1) ? b : a), null)
        const heavy = heaviest(frames)
        const spans = (heavy?.spans ?? []).sort((a, b) => b.ms - a.ms).slice(0, 3).map(s => `${s.name} ${s.ms.toFixed(1)}`)
        const baseCursor = longFrames.read().cursor
        await new Promise(r => setTimeout(r, 2000))
        const quiet = heaviest(longFrames.read(baseCursor).frames)
        const wrap = a => Math.atan2(Math.sin(a), Math.cos(a))
        return { from, to: mira.player.kind, swapMs: +swapMs.toFixed(1), pipelines, maxScriptMs: +(heavy?.callbackMs ?? 0).toFixed(1), spans,
          quietMaxScriptMs: +(quiet?.callbackMs ?? 0).toFixed(1), yawDeg: +(wrap(after[0] - before[0]) * 180 / Math.PI).toFixed(1), pitchDeg: +((after[1] - before[1]) * 180 / Math.PI).toFixed(1) }
      }, kind)
      const line = { ...setting, round, ...row }
      rows.push(line)
      console.log(`${line.backend} L${line.level} ${round} ${line.from} -> ${line.to}: pipelines ${line.pipelines}, swap ${line.swapMs} ms, worst script ${line.maxScriptMs} ms (quiet ${line.quietMaxScriptMs}) [${line.spans.join(', ')}], yaw ${line.yawDeg}°, pitch ${line.pitchDeg}°`)
    }
    if (errors.length) console.log('page errors:', errors.slice(0, 3).join(' | '))
    await page.close()
  }
} finally { await browser.close() }
if (out) await writeFile(out, JSON.stringify(rows, null, 1))
const built = rows.filter(r => r.pipelines > 0)
console.log(built.length ? `FAIL: ${built.length} switches built pipelines in play` : `OK: ${rows.length} switches, no pipelines built in play`)
process.exit(built.length ? 1 : 0)
