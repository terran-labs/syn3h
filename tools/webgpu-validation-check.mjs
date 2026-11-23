/**
 * WebGPU validation check: zero validation errors from load, through entering a world, 25
 * seconds of play with bots arriving, and leaving, at every quality level. A rejected command
 * buffer freezes the canvas on its last good frame while the HUD carries on, so any such
 * message fails the check.
 *
 *   tools/heavy.sh node tools/webgpu-validation-check.mjs URL [--headless] [--levels 0,3,5] [--world swamp]
 *
 * Each level is chosen before load, as a saved player choice (pinned, automation off), and
 * runs twice: tapping a planet in the lobby (the descent), and ?autoplay=1 (no descent).
 * After the 25 seconds it also checks that the world is really being drawn: it moves the
 * player 200 m sideways and 40 m up, and the lower half of the picture must change (a frozen
 * or stale terrain keeps its pixels while the vehicles move), and the terrain must report
 * drawn chunks. An error count alone cannot see a picture that stopped following the camera.
 *
 * Every run is at midday with the day clock stopped (sun.dayLength 0, sun.timeOfDay 12), set
 * as play begins, so the picture-change figures do not depend on when the check runs: a world
 * at night changes far fewer pixels for the same move (Badlands at 21:41 gave 9 to 30%).
 *
 * Uses the room server Vite starts. Exits 1 on any validation error or a frozen picture.
 */
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'

const args = process.argv.slice(2)
const url = args.find(a => /^https?:/.test(a)) ?? 'http://127.0.0.1:5291/'
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }
const levels = (opt('levels') ?? '0,1,2,3,4,5').split(',').map(Number)
const PLAY_MS = 25000
const VALIDATION = /GPUValidationError|pipeline creation failed|Invalid (CommandBuffer|RenderPipeline|BindGroup|Texture)|WebGPU:/i

const browser = await chromium.launch({ channel: 'chrome', headless: args.includes('--headless'), args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
let total = 0, frozen = 0
/** Share of pixels in the lower half that changed by more than 24 of 255 between two screenshots. */
async function changed(page, a, b) {
  return page.evaluate(async ([a, b]) => {
    const read = async base64 => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob())
      const canvas = new OffscreenCanvas(160, 90), ctx = canvas.getContext('2d')
      ctx.drawImage(bitmap, 0, 0, 160, 90)
      return ctx.getImageData(0, 45, 160, 45).data
    }
    const [x, y] = [await read(a), await read(b)]
    let moved = 0
    for (let i = 0; i < x.length; i += 4) if (Math.max(Math.abs(x[i] - y[i]), Math.abs(x[i + 1] - y[i + 1]), Math.abs(x[i + 2] - y[i + 2])) > 24) moved++
    return moved / (x.length / 4)
  }, [a.toString('base64'), b.toString('base64')])
}
/**
 * Calibrated on this machine: a frozen terrain (dd577fc9 at High) changed 1-2% of the lower
 * half; a correctly drawn move changed 18-89%. The 18% was flat desert sand filling both
 * frames (Ultra, by the descent, 16 November 2026, frames kept with --frames). 10% separates
 * the two with room on both sides.
 */
const MIN_CHANGE = Number(opt('min-change') ?? 0.1)
/** --frames DIR keeps each run's before and after pictures, to look at by eye. */
const framesDir = opt('frames')
const runs = Number(opt('runs') ?? 1)
/** --world ID picks the planet the descent dives into (default badlands); swamp is the haziest. */
const diveWorld = opt('world') ?? 'badlands'
try {
  for (const level of levels) {
    for (const path of (opt('paths') ?? 'descent,autoplay').split(',')) for (let run = 0; run < runs; run++) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
      await context.addInitScript(q => { try { localStorage.setItem('mira.quality.v2', JSON.stringify({ level: q, auto: false, pinned: true, overrides: {} })) } catch {} }, level)
      const page = await context.newPage()
      let phase = 'load'
      const errors = []
      page.on('console', m => { const text = m.text(); if (VALIDATION.test(text)) errors.push({ phase, text: text.replace(/\s+/g, ' ').slice(0, 900) }) })
      page.on('pageerror', e => errors.push({ phase, text: `page error: ${String(e).slice(0, 300)}` }))
      const room = `validation-${level}-${path}-${Date.now()}`
      await page.goto(`${url}?room=${room}${path === 'autoplay' ? '&planet=badlands&seed=7&autoplay=1' : ''}`, { waitUntil: 'load', timeout: 180000 })
      if (path === 'descent') {
        await page.waitForFunction(() => window.mira?.shell && document.documentElement.dataset.boot !== 'loading' && window.mira.shell.galaxy?.live, null, { timeout: 180000, polling: 100 })
        await page.waitForTimeout(3000)
        phase = 'entry'
        await page.evaluate(world => {
          const current = window.mira.planets.currentPlanet().id
          // Badlands, as autoplay uses: textured ground, so the picture-change test means
          // something (flat desert sand fills both frames and changed as little as 18%).
          const chips = [...document.querySelectorAll('.galaxy-label[data-world]')].filter(c => c.dataset.world !== current && !c.dataset.world.includes('~') && c.dataset.world !== 'custom')
          const chip = chips.find(c => c.dataset.world === world) ?? chips[0]
          chip.click()
        }, diveWorld)
      }
      await page.waitForFunction(() => window.mira?.shell?.playing && window.mira.game.tick > 30, null, { timeout: 120000, polling: 100 })
      phase = 'play'
      // Midday, clock stopped: see the header.
      await page.evaluate(() => { const p = window.mira.params; p.set('sun.dayLength', 0); p.set('sun.timeOfDay', 12) })
      await page.waitForTimeout(PLAY_MS)
      const hour = await page.evaluate(() => window.mira.params.get('sun.timeOfDay').value)
      const state = await page.evaluate(() => ({ name: window.mira.game.quality.getQualityState().name, bots: window.mira.bots.vehicles.length }))
      // The picture must follow the camera: 200 m sideways and 40 m up must change it.
      const canvas = page.locator('#game')
      const before = await canvas.screenshot()
      await page.evaluate(() => {
        const { player, terrain } = window.mira, p = player.body.translation(), V = player.object.position.constructor
        const x = p.x + 200, z = p.z
        player.teleport(new V(x, terrain.heightAt(x, z) + 40, z), 0)
      })
      await page.waitForTimeout(2500)
      const after = await canvas.screenshot()
      const change = await changed(page, before, after)
      if (framesDir) { await mkdir(framesDir, { recursive: true }); for (const [name, png] of [['before', before], ['after', after]]) await writeFile(`${framesDir}/level${level}-${path}-${run}-${name}.png`, png) }
      const chunks = await page.evaluate(() => window.mira.terrain.triangleStats?.().drawn ?? -1)
      const still = change < MIN_CHANGE || chunks === 0
      if (still) frozen++
      phase = 'exit'
      await page.evaluate(() => { const shell = window.mira.shell; shell.askExit(); shell.answerExit(true) })
      await page.waitForTimeout(6000)
      await context.close()
      total += errors.length
      const phases = ['load', 'entry', 'play', 'exit'].map(p => `${p} ${errors.filter(e => e.phase === p).length}`).join(', ')
      console.log(`level ${level} ${state.name}, ${path}: ${errors.length} validation errors (${phases}), bots ${state.bots}, hour ${Number(hour).toFixed(1)}, picture changed ${(change * 100).toFixed(0)}% after moving, terrain triangles drawn ${chunks}${still ? ' FROZEN' : ''}`)
      for (const text of [...new Set(errors.map(e => `[${e.phase}] ${e.text}`))].slice(0, 3)) console.log(`  ${text}`)
    }
  }
} finally { await browser.close() }
console.log(total || frozen ? `FAIL: ${total} WebGPU validation errors, ${frozen} frozen pictures` : 'PASS: no WebGPU validation errors, the picture follows the camera')
process.exit(total || frozen ? 1 : 0)
