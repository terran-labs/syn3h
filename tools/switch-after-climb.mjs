// A player vehicle switch after an in-play quality change: pipelines built and the switch's own
// script time. The vehicle-switch builder's finding (tests/ui/artifacts/switch-cost.mjs on their
// branch) was a first switch after an in-play level change building pipelines; entering at a
// level built none. Run from a built checkout:
//
//   tools/heavy.sh node tools/switch-after-climb.mjs <built checkout> [label]
//
// Per backend (WebGPU, WebGL 2): enter at Medium, then climb in play through the shell's veil
// (as a player does) to High, then Ultra. After each climb, switch buggy, jet, hovercraft, buggy:
// each the first switch to that kind at that level. For each switch, the render pipelines
// created in the two seconds after it and the swap call's time. Also each climb's veil time.
import { writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { serveStable } from './serve-stable.mjs'

const args = process.argv.slice(2).filter(a => !a.startsWith('--'))
const dir = args[0] ?? '.', label = args[1] ?? 'build'
const app = await serveStable({ dir, port: 0 })
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
const out = { label, runs: [], errors: [] }
try {
  for (const webgl of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
    page.on('pageerror', e => out.errors.push(`${webgl ? 'webgl' : 'webgpu'}: ${e.message}`))
    await page.routeWebSocket(/\/ws/, (s) => s.close())
    await page.goto(`http://127.0.0.1:${app.server.address().port}/?autoplay=1&vehicle=buggy&gfx=2&daydream=0${webgl ? '&webgl=1' : ''}`)
    await page.waitForFunction(() => window.syn3h?.shell, null, { timeout: 120000 })
    await page.evaluate(() => window.syn3h.shell.play())
    await page.waitForFunction(() => window.syn3h.game.tick > 120 && window.syn3h.shell.playing && !window.syn3h.shell.transitioning, null, { timeout: 120000 })
    await page.evaluate(() => { const s = window.syn3h; s.params.set('bots.count', 0); s.game.quality.setAuto(false) })
    for (const level of [3, 4]) {
      const t0 = Date.now()
      await page.evaluate(level => window.syn3h.game.quality.setLevel(level), level)
      await page.waitForFunction(level => window.syn3h.game.quality.governor.level === level && !document.querySelector('.quality-change-veil'), level, { timeout: 120000 })
      const climbMs = Date.now() - t0
      await page.waitForTimeout(1500)
      const switches = []
      for (const kind of ['jet', 'hovercraft', 'buggy']) {
        const r = await page.evaluate(async (kind) => {
          const s = window.syn3h, game = s.game, made = game.pipelineCounter.created
          const t = performance.now(); s.swapVehicle(kind); const swapMs = performance.now() - t
          const end = performance.now() + 2000
          while (performance.now() < end) await new Promise(r => requestAnimationFrame(r))
          return { to: s.player.kind, swapMs: +swapMs.toFixed(1), pipelines: game.pipelineCounter.created - made }
        }, kind)
        switches.push(r)
      }
      out.runs.push({ backend: webgl ? 'webgl' : 'webgpu', level, climbMs, switches })
      console.log(`${label} ${webgl ? 'WebGL 2' : 'WebGPU'} level ${level}: climb ${climbMs} ms; ${switches.map(s => `${s.to} ${s.pipelines} pipelines ${s.swapMs} ms`).join('; ')}`)
    }
    await page.close()
  }
} catch (e) { out.errors.push(String(e)) } finally {
  await writeFile(`/tmp/syn3h-queue/switch-after-climb-${label}.json`, JSON.stringify(out, null, 2))
  await browser.close(); await app.close()
}
console.log(JSON.stringify({ errors: out.errors }))
process.exit(out.errors.length ? 1 : 0)
