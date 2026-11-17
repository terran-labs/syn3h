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
 * Uses the room server Vite starts. Exits 1 on any validation error.
 */
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const url = args.find(a => /^https?:/.test(a)) ?? 'http://127.0.0.1:5291/'
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }
const levels = (opt('levels') ?? '0,1,2,3,4,5').split(',').map(Number)
const PLAY_MS = 25000
const VALIDATION = /GPUValidationError|pipeline creation failed|Invalid (CommandBuffer|RenderPipeline|BindGroup|Texture)|WebGPU:/i

const browser = await chromium.launch({ channel: 'chrome', headless: args.includes('--headless'), args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
let total = 0
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
      phase = 'exit'
      await page.evaluate(() => { const shell = window.syn3h.shell; shell.askExit(); shell.answerExit(true) })
      await page.waitForTimeout(6000)
      await context.close()
      total += errors.length
      const phases = ['load', 'entry', 'play', 'exit'].map(p => `${p} ${errors.filter(e => e.phase === p).length}`).join(', ')
      console.log(`level ${level} ${state.name}, ${path}: ${errors.length} validation errors (${phases}), bots ${state.bots}`)
      for (const text of [...new Set(errors.map(e => `[${e.phase}] ${e.text}`))].slice(0, 3)) console.log(`  ${text}`)
    }
  }
} finally { await browser.close() }
console.log(total ? `FAIL: ${total} WebGPU validation errors` : 'PASS: no WebGPU validation errors')
process.exit(total ? 1 : 0)
