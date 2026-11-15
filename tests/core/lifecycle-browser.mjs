/**
 * The game does not run in a background tab. This check plays, hides the page for ten
 * seconds, and asserts that in that time the game took no physics step, drew no frame and
 * ran no animation frame callback, and that the page's CPU time barely moved. Then it shows
 * the page and asserts a clean return: steps resume at the ordinary rate with no catch-up
 * burst, and no page error at any point.
 *
 * Hiding: another tab is brought to the front. If this browser still reports the page as
 * visible (some headless modes do), the visibility is emulated by overriding document.hidden
 * and dispatching visibilitychange; the report says which was used, since emulation proves
 * the game's own handling but not that the browser stopped anything by itself.
 *
 *   SYN3H_URL=http://127.0.0.1:5199/ /Users/vtn/dev/Syn3h/tools/heavy.sh node tests/core/lifecycle-browser.mjs
 */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5187/'
const HIDDEN_MS = 10000
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = {}
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  // Count every animation frame callback the page runs, whoever asked for it.
  await context.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window)
    window.__rafRuns = 0
    window.__rafCallers = {}
    window.requestAnimationFrame = (callback) => {
      // While the check asks (window.__traceRaf), remember who scheduled each frame.
      const who = window.__traceRaf ? (new Error().stack ?? '').split('\n').slice(2, 5).map(line => line.trim().replace(/^at /, '').replace(/\?[^:)]*/, '')).join(' < ') : ''
      return raf((now) => { window.__rafRuns++; if (who) window.__rafCallers[who] = (window.__rafCallers[who] ?? 0) + 1; callback(now) })
    }
  })
  const page = await context.newPage(), errors = []
  const offline = /WebSocket connection|Bad Gateway|ERR_CONNECTION_REFUSED/
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error' && !offline.test(m.text())) errors.push(m.text()) })
  await page.goto(`${base}?room=lifecycle-${Date.now()}&autoplay=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.syn3h?.game?.tick > 100 && document.querySelector('.syn3h-shell')?.classList.contains('is-playing'), null, { timeout: 180000 })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  const cpu = async () => { const { metrics } = await cdp.send('Performance.getMetrics'); const get = n => metrics.find(m => m.name === n)?.value ?? 0; return { task: get('TaskDuration'), script: get('ScriptDuration') } }
  const sample = () => page.evaluate(() => ({ tick: window.syn3h.game.tick, raf: window.__rafRuns, draws: window.syn3h.game.frames, paused: window.syn3h.game.isPaused, state: window.syn3h.lifecycle.state, hidden: document.hidden }))

  // Hide: a second tab in front.
  const other = await context.newPage(); await other.setContent('<title>elsewhere</title><p>elsewhere</p>'); await other.bringToFront()
  await page.waitForTimeout(300)
  let method = 'another tab in front'
  if (!(await page.evaluate(() => document.hidden))) {
    method = 'emulated document.hidden'
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hidden === true }); window.__hidden = true; document.dispatchEvent(new Event('visibilitychange')) })
  }
  await page.waitForTimeout(500) // Lets a frame already queued when the page was hidden run out.
  await page.evaluate(() => { window.__traceRaf = true })
  const before = await sample(), cpuBefore = await cpu()
  assert.equal(before.state, 'hidden'); assert.equal(before.paused, true)
  await page.waitForTimeout(HIDDEN_MS)
  const after = await sample(), cpuAfter = await cpu()
  report.hidden = { method, seconds: HIDDEN_MS / 1000, steps: after.tick - before.tick, frames: after.draws - before.draws, animationFrames: after.raf - before.raf, taskSeconds: +(cpuAfter.task - cpuBefore.task).toFixed(3), scriptSeconds: +(cpuAfter.script - cpuBefore.script).toFixed(3) }
  report.hidden.scheduledBy = await page.evaluate(() => { window.__traceRaf = false; return window.__rafCallers })
  assert.equal(report.hidden.steps, 0, 'physics stepped while hidden')
  assert.equal(report.hidden.frames, 0, 'frames were drawn while hidden')
  assert.equal(report.hidden.animationFrames, 0, 'animation frame callbacks ran while hidden')
  // Ten seconds of play costs seconds of main-thread time; a paused page should cost almost none.
  assert.ok(report.hidden.taskSeconds < 0.5, `main thread ran ${report.hidden.taskSeconds} s while hidden`)

  // Show again.
  if (method === 'emulated document.hidden') await page.evaluate(() => { window.__hidden = false; document.dispatchEvent(new Event('visibilitychange')) })
  await other.close(); await page.bringToFront()
  await page.waitForFunction(() => window.syn3h.lifecycle.state === 'active' && !window.syn3h.game.isPaused, null, { timeout: 5000 })
  const back = await sample()
  await page.waitForTimeout(100)
  const first = await sample()
  await page.waitForTimeout(2000)
  const later = await sample()
  report.resume = { stepsInFirstTenth: first.tick - back.tick, stepsInNextTwoSeconds: later.tick - first.tick, framesInNextTwoSeconds: later.draws - first.draws }
  // 50 steps a second: a tenth of a second is five steps, plus one frame's worth of slack. A
  // catch-up burst after ten hidden seconds would be hundreds.
  assert.ok(report.resume.stepsInFirstTenth <= 12, `burst of ${report.resume.stepsInFirstTenth} steps on return`)
  assert.ok(report.resume.stepsInNextTwoSeconds > 20, 'the game did not resume stepping')
  assert.ok(report.resume.stepsInNextTwoSeconds <= 110, `stepped ${report.resume.stepsInNextTwoSeconds} times in two seconds`)
  assert.ok(report.resume.framesInNextTwoSeconds > 5, 'the game did not resume drawing')

  // The player's own pause goes through the same state: it stops the loop, survives the page
  // being hidden and shown again, and only the player's resume ends it.
  const run = async () => { const a = await sample(); await page.waitForTimeout(1500); const b = await sample(); return { steps: b.tick - a.tick, frames: b.draws - a.draws, animationFrames: b.raf - a.raf } }
  await page.evaluate(() => window.syn3h.pause.pause('user')); await page.waitForTimeout(300)
  report.userPause = await run()
  assert.deepEqual(report.userPause, { steps: 0, frames: 0, animationFrames: 0 }, 'the game ran while paused by the player')
  await page.evaluate(() => { window.syn3h.pause.pause('hidden'); window.syn3h.pause.resume('hidden') }); await page.waitForTimeout(300)
  report.userPauseAfterHideAndShow = await run()
  assert.deepEqual(report.userPauseAfterHideAndShow, { steps: 0, frames: 0, animationFrames: 0 }, 'showing the page ended the player\'s pause')
  await page.evaluate(() => window.syn3h.pause.resume('user')); await page.waitForTimeout(100)
  report.userResume = await run()
  assert.ok(report.userResume.steps > 15 && report.userResume.steps <= 85, `after the player's resume: ${report.userResume.steps} steps in 1.5 s`)
  report.errors = errors
  assert.deepEqual(errors, [])
  console.log(JSON.stringify(report, null, 2)); console.log('PAGE LIFECYCLE OK')
} catch (error) { console.log(JSON.stringify(report, null, 2)); throw error } finally { await browser.close() }
