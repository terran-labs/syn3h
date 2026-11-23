// The lobby's opening (src/ui/galaxy/opening.ts) gives way to the player. The bugs it catches:
// a tap or a key during the opening that does not end it, or ends it with the lobby's controls,
// the planets' captions or the name still held back; and reduced motion getting an opening, or
// getting the lobby without its sound starting.
//  - Skip, in Chromium: a tap (phone) and a key (desktop) at several points through the opening.
//  - Reduced motion, Chromium with sound allowed: no opening at all, controls and captions at
//    once, sound running.
//  - Reduced motion, WebKit with Safari's gesture rule (the tap-to-begin path, ?tap=1): the
//    prompt, then one tap starts the sound and shows the lobby, with no opening.
//
//   MIRA_URL=http://127.0.0.1:<port>/ tools/heavy.sh node tests/ui/opening-skip.mjs
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium, webkit } from 'playwright-core'
import assert from 'node:assert/strict'

const base = (process.env.MIRA_URL ?? 'http://127.0.0.1:5258/').replace(/\/+$/, '') + '/'
const ready = page => page.waitForFunction(() => window.mira?.game?.tick > 25 && document.documentElement.dataset.boot === 'done' && window.mira.shell.galaxy, null, { timeout: 120000 })
/** The lobby as the player sees it: is the opening running, and is anything still held back? */
const lobby = page => page.evaluate(() => {
  const g = window.mira.shell.galaxy
  return { opening: Boolean(g.opening), held: document.documentElement.dataset.opening ?? null, unrevealed: document.querySelectorAll('.galaxy-label.is-unrevealed').length, mark: g.markShown ?? 0, audio: window.mira.audio.state }
})
const failures = []
const check = async (name, run) => { try { await run(); console.log(`${name}: PASS`) } catch (error) { failures.push(`${name}: ${error.message.split('\n')[0]}`); console.log(`${name}: FAIL ${error.message.split('\n')[0]}`) } }

const chrome = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  for (const [device, view, input] of [['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, 'tap'], ['desktop', { viewport: { width: 1280, height: 800 } }, 'key']]) {
    const page = await chrome.newPage(view)
    await page.goto(`${base}?room=opening-skip-${Date.now()}`); await ready(page)
    for (const at of [0.5, 1.5, 3, 6]) {
      await check(`${device}: a ${input} at ${at} s skips the opening`, async () => {
        await page.evaluate(() => { const g = window.mira.shell.galaxy; g.replayOpening(window.mira.params.get('lobby.intro').value) })
        await page.waitForTimeout(at * 1000)
        assert.equal((await lobby(page)).opening, true, 'the opening is playing before the input')
        // Empty sky near the top, away from every world and control.
        if (input === 'tap') await page.touchscreen.tap(view.viewport.width / 2, 40); else await page.keyboard.press('x')
        // Read once the galaxy has drawn the result: headless frames on a busy machine can be
        // far apart, and these values are written per drawn frame. The controls and captions
        // show on the first frame after the input. The name may still be on its own fade from
        // when it was first drawable (WORDMARK_FADE_SECONDS, the same everywhere it arrives),
        // which on a busy machine can begin after the skip: what must hold is that it arrives.
        await page.waitForFunction(() => { const g = window.mira.shell.galaxy; return !g.opening && !document.documentElement.dataset.opening && !document.querySelector('.galaxy-label.is-unrevealed') && g.markShown > 0.5 }, null, { timeout: 5000, polling: 'raf' }).catch(() => {})
        const after = await lobby(page)
        assert.deepEqual({ opening: after.opening, held: after.held, unrevealed: after.unrevealed }, { opening: false, held: null, unrevealed: 0 }, `ended with nothing held back: ${JSON.stringify(after)}`)
        assert.ok(after.mark > 0.5, `the name arrives: ${after.mark}`)
      })
    }
    await page.close()
  }
  await check('reduced motion, sound allowed: no opening, everything at once, sound running', async () => {
    const page = await chrome.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' })
    await page.addInitScript(() => { window.__sawOpening = false; const watch = () => { if (window.mira?.shell?.galaxy?.opening) window.__sawOpening = true; requestAnimationFrame(watch) }; requestAnimationFrame(watch) })
    await page.goto(`${base}?room=opening-rm-${Date.now()}`); await ready(page)
    await page.waitForTimeout(1500)
    const state = await lobby(page)
    assert.equal(await page.evaluate(() => window.__sawOpening), false, 'no opening ran')
    assert.deepEqual({ held: state.held, unrevealed: state.unrevealed }, { held: null, unrevealed: 0 }, JSON.stringify(state))
    assert.equal(state.audio, 'running')
    await page.close()
  })
} finally {
  await chrome.close()
}

const safari = await webkit.launch()
try {
  await check('reduced motion, WebKit with the gesture rule: one tap starts the sound and shows the lobby, no opening', async () => {
    const page = await safari.newPage({ viewport: { width: 402, height: 874 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' })
    await page.addInitScript(() => {
      const Native = window.AudioContext
      window.AudioContext = class extends Native {
        constructor(...args) { super(...args); void super.suspend() }
        resume() { return window.__gesture ? super.resume() : new Promise(() => {}) }
      }
      for (const t of ['pointerup', 'touchend', 'keydown', 'click', 'mousedown']) window.addEventListener(t, e => { if (!e.isTrusted) return; window.__gesture = true; setTimeout(() => { window.__gesture = false }) }, { capture: true })
    })
    await page.goto(`${base}?tap=1&room=opening-rm-webkit-${Date.now()}`)
    await page.waitForFunction(() => document.querySelector('.tap-gate.is-shown'), null, { timeout: 120000 })
    assert.notEqual(await page.evaluate(() => window.mira.audio.state), 'running', 'sound is held before the tap')
    await page.touchscreen.tap(201, 300)
    await page.waitForFunction(() => document.documentElement.dataset.boot === 'done' && window.mira.audio.state === 'running', null, { timeout: 5000 })
    await page.waitForTimeout(800)
    const state = await lobby(page)
    assert.deepEqual({ opening: state.opening, held: state.held, unrevealed: state.unrevealed }, { opening: false, held: null, unrevealed: 0 }, JSON.stringify(state))
    await page.close()
  })
} finally {
  await safari.close()
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1) }
console.log('opening skip: ok')
