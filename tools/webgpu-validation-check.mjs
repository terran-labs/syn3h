/**
 * WebGPU validation check: zero validation errors from load, through entering a world, 25
 * seconds of play with bots arriving, and leaving, at every quality level. A rejected command
 * buffer freezes the canvas on its last good frame while the HUD carries on, so any such
 * message fails the check.
 *
 *   tools/heavy.sh node tools/webgpu-validation-check.mjs URL [--headless] [--levels 0,3,5]
 *
 * Each level is chosen before load, as a saved player choice (pinned, automation off), and
 * runs twice: tapping a planet in the lobby (the descent), and ?autoplay=1 (no descent).
 * After the 25 seconds it also checks that the world is really being drawn: it moves the
 * player 200 m sideways and 40 m up, and the lower half of the picture must change (a frozen
 * or stale terrain keeps its pixels while the vehicles move), and the terrain must report
 * drawn chunks. An error count alone cannot see a picture that stopped following the camera.
 *
 * Uses the room server Vite starts. Exits 1 on any validation error or a frozen picture.
 */
import { chromium } from 'playwright-core'

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
const MIN_CHANGE = Number(opt('min-change') ?? 0.3)
try {
  for (const level of levels) {
    for (const path of ['descent', 'autoplay']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
      await context.addInitScript(q => { try { localStorage.setItem('syn3h.quality.v2', JSON.stringify({ level: q, auto: false, pinned: true, overrides: {} })) } catch {} }, level)
      const page = await context.newPage()
      let phase = 'load'
      const errors = []
      page.on('console', m => { const text = m.text(); if (VALIDATION.test(text)) errors.push({ phase, text: text.replace(/\s+/g, ' ').slice(0, 900) }) })
      page.on('pageerror', e => errors.push({ phase, text: `page error: ${String(e).slice(0, 300)}` }))
      const room = `validation-${level}-${path}-${Date.now()}`
      await page.goto(`${url}?room=${room}${path === 'autoplay' ? '&planet=badlands&seed=7&autoplay=1' : ''}`, { waitUntil: 'load', timeout: 180000 })
      if (path === 'descent') {
        await page.waitForFunction(() => window.syn3h?.shell && document.documentElement.dataset.boot !== 'loading' && window.syn3h.shell.galaxy?.live, null, { timeout: 180000, polling: 100 })
        await page.waitForTimeout(3000)
        phase = 'entry'
        await page.evaluate(() => {
          const current = window.syn3h.planets.currentPlanet().id
          const chip = [...document.querySelectorAll('.galaxy-label[data-world]')].find(c => c.dataset.world !== current && !c.dataset.world.includes('~') && c.dataset.world !== 'custom')
          chip.click()
        })
      }
      await page.waitForFunction(() => window.syn3h?.shell?.playing && window.syn3h.game.tick > 30, null, { timeout: 120000, polling: 100 })
      phase = 'play'
      await page.waitForTimeout(PLAY_MS)
      const state = await page.evaluate(() => ({ name: window.syn3h.game.quality.getQualityState().name, bots: window.syn3h.bots.vehicles.length }))
      // The picture must follow the camera: 200 m sideways and 40 m up must change it.
      const canvas = page.locator('#game')
      const before = await canvas.screenshot()
      await page.evaluate(() => {
        const { player, terrain } = window.syn3h, p = player.body.translation(), V = player.object.position.constructor
        const x = p.x + 200, z = p.z
        player.teleport(new V(x, terrain.heightAt(x, z) + 40, z), 0)
      })
      await page.waitForTimeout(2500)
      const after = await canvas.screenshot()
      const change = await changed(page, before, after)
      const chunks = await page.evaluate(() => window.syn3h.terrain.triangleStats?.().drawn ?? -1)
      const still = change < MIN_CHANGE || chunks === 0
      if (still) frozen++
      phase = 'exit'
      await page.evaluate(() => { const shell = window.syn3h.shell; shell.askExit(); shell.answerExit(true) })
      await page.waitForTimeout(6000)
      await context.close()
      total += errors.length
      const phases = ['load', 'entry', 'play', 'exit'].map(p => `${p} ${errors.filter(e => e.phase === p).length}`).join(', ')
      console.log(`level ${level} ${state.name}, ${path}: ${errors.length} validation errors (${phases}), bots ${state.bots}, picture changed ${(change * 100).toFixed(0)}% after moving, terrain triangles drawn ${chunks}${still ? ' FROZEN' : ''}`)
      for (const text of [...new Set(errors.map(e => `[${e.phase}] ${e.text}`))].slice(0, 3)) console.log(`  ${text}`)
    }
  }
} finally { await browser.close() }
console.log(total || frozen ? `FAIL: ${total} WebGPU validation errors, ${frozen} frozen pictures` : 'PASS: no WebGPU validation errors, the picture follows the camera')
process.exit(total || frozen ? 1 : 0)
